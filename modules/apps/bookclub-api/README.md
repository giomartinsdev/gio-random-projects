# bookclub-api

Headless realtime API for "Clube do Livro": someone uploads a PDF and
opens a room, others join, and everyone sees the host turn pages,
draw/point on the current page, and chat -- live, over one WebSocket
per room. Node/TypeScript, same stack as `post-api`.

## Why this one owns its own tables (unlike post-api)

`post-api` deliberately has zero tables of its own -- every post write
goes through `domain-api`'s async command pipeline (see its own
README). This service does NOT follow that pattern for rooms,
documents, and chat messages: it reads/writes them directly against
Postgres.

Reasoning: domain-api's CQRS pipeline (publish a command over Redis,
apply it asynchronously, return 202 and let the client re-poll) fits
simple entity writes with eventual consistency. A WebSocket handling
"who's the host", "what page are we on", and "broadcast this chat
message to everyone right now" needs synchronous reads on every single
inbound message -- there's no natural way to do that through a queue
without reinventing a synchronous read path anyway. So: direct
Postgres, same exception this repo already makes for Better Auth's own
tables.

## Auth: shared session with post-api, not a second login

There's no `/api/auth/*` here and no sign-up page for this service --
login only ever happens through post-api. `lib/auth.ts` builds its own
Better Auth instance purely to call `getSession()`, pointed at the
**same** Postgres database and using the **same** `BETTER_AUTH_SECRET`
and `crossSubDomainCookies` (`domain: ".giomartins.dev"`) as post-api,
so a session cookie set by post-api's login also validates here. If
post-api's cookie config ever changes, this file needs the matching
change.

## Storage: PDF bytes live in Postgres

`bookclub_document.data` is a `bytea` column, not an object store --
this repo has no MinIO/S3 yet, and homelab-scale PDFs (a chapter, a
short book) fit comfortably. Uploads are capped at 25MB
(`routes/rooms.ts`).

## Realtime protocol (`GET /rooms/:id/ws`)

Client → server messages: `chat:send`, `page:set` (host only),
`cursor:move`, `draw:stroke` (host only), `draw:clear` (host only).

Server → client messages: `init` (page, host, participants, chat
history, current page's drawing), `participant:join`/`leave`,
`chat:message`, `page:changed`, `cursor:update`, `draw:stroke`,
`draw:clear`.

Live cursors and pen strokes are **not** persisted -- only chat
history is. Drawing resets whenever the host turns the page (see
`ws/roomHub.ts`).

## Running locally

```
cp .env.example .env   # BETTER_AUTH_SECRET must match post-api's
npm install
npm run db:migrate
npm run dev
```
