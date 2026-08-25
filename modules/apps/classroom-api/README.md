# classroom-api

Headless realtime API for "Aulas" (Classes): a host opens a room and
shares their screen or camera live, alongside a shared notepad and
chat. Node/TypeScript, same stack as `bookclub-api`/`post-api`.

## Room and chat go through domain-api; video never touches this service at all

Room and Message are the SAME generic `domain-api`/`domain-worker`
aggregates `bookclub-api` uses (same CQRS pipeline `Post` uses:
`lib/domainApiClient.ts` POSTs a command, gets 202, domain-worker
applies it and publishes a domain event) — `documentId` is always sent
as `""`: a class has no document, only a host's shared screen/camera
and a notepad, neither of which domain-api knows anything about.

Video is peer-to-peer WebRTC, entirely between browsers — this service
never sees a video frame, only relays opaque signaling payloads
(SDP offers/answers, ICE candidates) between exactly two participants
by userId (`ws/roomHub.ts`'s `sendTo`). The host is the one media
source; each viewer opens its own `RTCPeerConnection` directly to the
host (a mesh centered on the host), so this is only practical for a
small class — an SFU would be the next step if that ever needs to
change. See `front/src/lib/useClassSocket.ts` for the client side of
the signaling dance.

### Realtime relies on domain-api's SSE relay, not an immediate local broadcast

`GET /rooms/:id/events` on domain-api relays its shared Redis event
bus (`domain.events`), filtered to one room, over Server-Sent Events.
This service opens ONE such SSE connection per active room (not one
per participant), and translates `message.created` into this
service's own existing WebSocket message (`chat:message`) for every
participant connected to that room. Unlike bookclub-api, there's no
`room.updated` case to handle: nothing here ever calls `UpdateRoom`
(no page turns), so that event never fires for a room this service
created.

Ephemeral, never-persisted realtime state -- the shared notepad, live
WebRTC signaling -- stays exactly as before: handled directly by this
service's own WebSocket layer (`ws/roomHub.ts`), never touching
domain-api at all.

## No Postgres tables of its own

Unlike `bookclub-api` (which owns `bookclub_document`, a PDF blob
table), this service has nothing that needs its own persistence: no
document, and the notepad is deliberately ephemeral (last-write-wins,
lost when the room empties — see `ws/roomHub.ts`'s own comment).
`DATABASE_URL` is used purely to validate Better Auth sessions against
post-api's shared `user`/`session` tables — there's no local schema,
no migration step, no `db:migrate` script.

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
upgrade request can't attach as a header. `routes/rooms.ts`'s
`sessionRequestHeaders` accepts the same token as a `?token=` query
param on `GET /rooms/:id/ws`, folding it into a synthetic Authorization
header before calling `getSession()`. front's `classroomApi.ts`
(`wsUrl`) appends it automatically when a Discord bearer token is set;
omitted entirely otherwise.

## Realtime protocol (`GET /rooms/:id/ws`)

Client → server messages: `chat:send`, `notepad:update` (full replaced
content, last-write-wins), `webrtc:signal` (`{to, payload}` — opaque
relay, see `app.ts`'s own comment).

Server → client messages: `init` (status, host, participants, chat
history, current notepad content), `participant:join`/`leave`,
`chat:message`, `notepad:update`, `webrtc:signal` (`{from, payload}`).

A closed room (`DELETE /rooms/:id`, host only) stays viewable — the
`init` payload still carries everything — but the WS goes read-only:
no new chat, notepad edits, or signaling past that point.

## Running locally

```
cp .env.example .env   # BETTER_AUTH_SECRET must match post-api's; DOMAIN_API_KEY needs its own entry in DOMAIN_API_KEYS
npm install
npm run dev
```

## Testing

```
npm test
```
