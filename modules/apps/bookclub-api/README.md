# bookclub-api

Headless realtime API for "Clube do Livro": someone uploads a PDF and
opens a room, others join, and everyone sees the host turn pages,
draw/point on the current page, and chat -- live, over one WebSocket
per room. Node/TypeScript, same stack as `post-api`.

## Rooms and chat go through domain-api; the PDF blob doesn't

Room and Message are generic `domain-api`/`domain-worker` aggregates
now (same CQRS pipeline `Post` uses: `lib/domainApiClient.ts` POSTs a
command, gets 202, domain-worker applies it and publishes a domain
event). `domain-api` deliberately knows nothing bookclub-specific --
"only the host may turn the page" and every other realtime rule here
is enforced by this service, not by domain-api/domain-worker, which
only understand the generic shape "a room has a host and a current
page" (the exact same generic ownership check `Post`'s `author_id`
already has, applied to `host_id`).

The one thing that does NOT go through domain-api: `bookclub_document`
(the uploaded PDF's bytes), still direct Postgres in this service's
own database -- a multi-MB binary blob doesn't fit a JSON command
envelope. A Room only references its PDF by an opaque `document_id`
string; domain-api has no idea a PDF exists.

### Realtime relies on domain-api's SSE relay, not an immediate local broadcast

`GET /rooms/:id/events` on domain-api relays its shared Redis event
bus (`domain.events`), filtered to one room, over Server-Sent Events.
This service opens ONE such SSE connection per active room (not one
per participant -- see `app.ts`'s `ensureRoomSubscription`), and
translates `room.updated` / `message.created` into this service's own
existing WebSocket messages (`page:changed` / `chat:message`) for
every participant connected to that room.

Concretely: when the host turns a page, this service PUTs an update to
domain-api and returns immediately -- it does **not** broadcast
`page:changed` itself. That broadcast only happens once domain-worker
actually applies the write and the resulting event comes back over
SSE. This adds a small round trip most users won't notice, but it's a
deliberate trade-off for a single source of truth: page state and
"clear this page's drawings" always arrive together, for every client,
driven by the same event, instead of racing an optimistic local
broadcast against the async confirmation.

SSE reaching this service (not the browser) is also why it's SSE and
not a browser `EventSource` straight from the frontend: this
connection needs the same `X-API-Key` every other domain-api caller
sends, which `EventSource` can't attach as a custom header.

Ephemeral, never-persisted realtime state -- live cursors, the host's
laser pointer, an in-progress pen stroke -- stays exactly as before:
broadcast directly by this service's own WebSocket layer
(`ws/roomHub.ts`), never touching domain-api at all.

## Auth: shared session with post-api, not a second login

There's no `/api/auth/*` here and no sign-up page for this service --
login only ever happens through post-api. `lib/auth.ts` builds its own
Better Auth instance purely to call `getSession()`, pointed at the
**same** Postgres database and using the **same** `BETTER_AUTH_SECRET`
and `crossSubDomainCookies` (`domain: ".giomartins.dev"`) as post-api,
so a session cookie set by post-api's login also validates here. If
post-api's cookie config ever changes, this file needs the matching
change.

A Discord Activity session (see post-api/README.md) never has a
cookie at all -- it's a bearer token instead, which a WebSocket
upgrade request and a plain `fetch` for PDF bytes can't attach as a
header. `routes/rooms.ts`'s `sessionRequestHeaders` accepts the same
token as a `?token=` query param on both `GET /rooms/:id/ws` and
`GET /rooms/:id/pdf` as a fallback, folding it into a synthetic
Authorization header before calling `getSession()`. front's
`bookclubApi.ts` (`pdfUrl`/`wsUrl`) appends it automatically when a
Discord bearer token is set; omitted entirely otherwise.

## Realtime protocol (`GET /rooms/:id/ws`)

Client → server messages: `chat:send` (optionally carries
`requestedPage`, a "can we go to page N?" ask anyone can send),
`page:set` (host only), `cursor:move`, `draw:stroke` (host only),
`text:add` (host only), `draw:clear` (host only).

Server → client messages: `init` (page, host, participants, chat
history, current page's drawing/text annotations), `participant:join`/
`leave`, `chat:message`, `page:changed`, `cursor:update`, `draw:stroke`,
`text:add`, `draw:clear`.

Live cursors and pen strokes/text annotations are **not** persisted --
only chat history is (through domain-api's Message aggregate).
Drawing/text reset whenever the host turns the page.

## Running locally

```
cp .env.example .env   # BETTER_AUTH_SECRET must match post-api's; DOMAIN_API_KEY needs its own entry in DOMAIN_API_KEYS
npm install
npm run db:migrate
npm run dev
```
