# domain

Go event-driven CRUD service, DDD-layered, all source under `src/`.
Two binaries from one module:

- **domain-api** (`src/cmd/api`) — REST interface (chi router). `GET`
  reads straight from Postgres. `POST`/`PUT`/`DELETE` never touch the
  database — they publish an `application.Command` onto Redis pub/sub
  and respond `202 Accepted` with a `command_id`. The write is applied
  asynchronously. Every `/users` route requires an `X-API-Key` header
  (401 without one); a missing/invalid key is also rate-limited per
  source IP (`RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`) since every such
  request ends in 401 anyway — the limiter just slows down
  brute-forcing/scanning for a valid key. A valid key skips the limiter
  entirely.
- **domain-worker** (`src/cmd/worker`) — the only writer to the
  database. Runs two loops: a relay that subscribes to the pub/sub
  command channel and pushes every message onto a Redis list (turning
  fire-and-forget pub/sub into something durable a consumer can drain
  at its own pace), and a processing loop that pops from that list,
  applies the write via `application/user`'s `CommandHandler`, records
  an `audit_log` row (success or failure), and publishes the resulting
  domain event on a second pub/sub channel.

```
domain-api --publish--> domain.commands (pub/sub)
                          │
                    [worker relays]
                          ▼
                domain.commands.queue (list)
                          │
                   [worker BLPOPs]
                          ▼
       application/user.CommandHandler -> domain/user aggregate
                          │
                          ▼
              Postgres write + audit_log row
                          │
                          ▼
                  domain.events (pub/sub, typed domain event)
```

## Layout (`src/`)

```
domain/user/          pure domain: User aggregate, invariants, domain events, Repository port
application/          use cases: Command envelope, ports (CommandPublisher/Consumer, EventPublisher)
application/user/     CreateInput/UpdateInput/DeleteInput, Service, CommandHandler
application/audit/    audit Entry + Repository port (cross-cutting, not aggregate-specific)
infrastructure/postgres/  Repository port implementations (pgx)
infrastructure/redis/     CommandBus (publish + relay), CommandQueue (BLPOP), EventBus
infrastructure/http/      chi router, handlers, API-key auth + rate limiting, OpenAPI/Swagger
infrastructure/config/    env-based config, no secret defaults
cmd/api, cmd/worker/      composition roots — the only place everything gets wired together
```

Only the User entity is implemented; the Command/Event shapes and the
domain → application → infrastructure layering are meant to be copied
per-aggregate as more get added, not made generic ahead of a second
real use.

## Running locally

```
cp .env.example .env   # set POSTGRES_PASSWORD and DOMAIN_API_KEYS
docker compose up --build
```

`domain-api` listens on `:8000` (or `$API_PORT`).

- `GET /healthz`, `GET /docs` (Swagger UI), `GET /openapi.yaml` — public.
- Everything under `/users` needs `X-API-Key: <one of DOMAIN_API_KEYS>`.

Because writes are async, `POST /users` returns `202
{"command_id": "...", "status": "accepted"}` — poll `GET /users` (or
subscribe to `domain.events`) to see the result land.

## Deploying

CI (`.github/workflows/domain-build-push.yml`, standard GitHub-hosted
runner) builds both images on every push touching `api/domain/**` and
pushes them to this homelab's own registry
(`registry.giomartins.dev`/`localhost:5000` — see
`infra/arcane-templates/templates/registry`). On the server:

```
docker compose -f compose.yaml -f compose.prod.yaml up -d
```

pulls `localhost:5000/domain-api:latest` and `domain-worker:latest`
instead of building — needs `docker login localhost:5000` once on the
host with the registry's own credentials.

## Not done yet

No automated tests (no godog/testcontainers setup for this Go service
yet, unlike this repo's Python services).
