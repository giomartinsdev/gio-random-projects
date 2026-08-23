# domain

Go event-driven CRUD service. Two binaries from one module:

- **domain-api** (`cmd/api`) — REST interface. `GET` reads straight from
  Postgres. `POST`/`PUT`/`DELETE` never touch the database — they
  publish a `Command` onto Redis pub/sub and respond `202 Accepted` with
  a `command_id`. The write is applied asynchronously.
- **domain-worker** (`cmd/worker`) — the only writer to the database.
  Runs two loops: a relay that subscribes to the pub/sub command channel
  and pushes every message onto a Redis list (turning fire-and-forget
  pub/sub into something durable a consumer can drain at its own pace),
  and a processing loop that pops from that list, applies the write,
  records an `audit_log` row (success or failure), and publishes the
  outcome on a second pub/sub channel.

```
domain-api --publish--> domain.commands (pub/sub)
                          │
                    [worker relays]
                          ▼
                domain.commands.queue (list)
                          │
                   [worker BLPOPs]
                          ▼
                     Postgres write + audit_log row
                          │
                          ▼
                  domain.events (pub/sub, outcome)
```

Only entity implemented: **User** (`name`, `email`). The
Command/Processed event shapes, the repository pattern, and the audit
write are meant to be copied per-entity, not made generic — there's
only one entity using this pattern so far, so a generic abstraction
would be indirection with nothing else to justify it.

## Running locally

```
cp .env.example .env   # set POSTGRES_PASSWORD
docker compose up --build
```

`domain-api` listens on `:8000` (or `$API_PORT`). Because writes are
async, `POST /users` returns `202 {"command_id": "...", "status":
"accepted"}` — poll `GET /users` (or subscribe to `domain.events`) to
see the result land.

## Endpoints

| Method | Path         | Behavior                                  |
|--------|--------------|--------------------------------------------|
| GET    | /healthz     | liveness                                   |
| GET    | /users       | list, direct DB read                       |
| GET    | /users/{id}  | direct DB read, 404 if missing             |
| POST   | /users       | publishes `user.create`, 202               |
| PUT    | /users/{id}  | publishes `user.update`, 202               |
| DELETE | /users/{id}  | publishes `user.delete`, 202               |

## Not done yet

No tests, no CI, no deploy wiring (compose.yaml runs it locally only —
nothing in `infra/cloudflared/config.yml` points at it, matching the
rest of this repo's "declared = deployed" rule; add a route there when
it's actually pushed to gio-server).
