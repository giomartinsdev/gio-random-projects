# domain-api

The write/read front door of the CQRS side of this stack: every write
is a command answered with a `202 Accepted`, persisted by the paired
domain-worker (see `modules/apps/domain-worker`), and read back through
plain GETs. Shares one Postgres database and Redis with everything else
on the network.

## Writes: commands, not CRUD

`POST` to any collection answers `202 {"command_id": ..., "status":
"accepted"}` — the API published the command to Redis, the domain-worker
BLPOPs `domain.commands.queue`, dispatches by action prefix (`user.`,
`post.`, `room.`, `message.`, `deal.`), writes the audit row (success or
failure, always), and publishes the resulting domain event only on
success. Nothing here writes application tables in the HTTP handler.

Current aggregates and their endpoints (all require `X-API-Key` — see
`local.domain_api_keys` in `modules/infra/terraform/secrets.tf`; each
caller gets its own identity so the audit log can name them):

| collection | endpoints |
|---|---|
| users, posts, rooms, messages | `POST/GET/PUT/DELETE` — see `openapi.yaml` |
| deals | `POST /deals` (ingest, action `deal.upsert`), `GET /deals?source=&limit=`, `GET /deals/{source}/{source_deal_id}` |

## The deals contract specifically

`POST /deals` is the scrapers' ingest path (`deal.upsert`): upsert by
`(source, source_deal_id)` — the Go worker owns the `raw_deals` table
and reports insert vs update via `RETURNING (xmax = 0)`. First-seen
rows publish a **`deal.created`** event; re-polls of the same deal only
update columns and the audit row, no event — at ~2 scrapers × 1800s
polls, dedupe there is what keeps the event queue honest. `posted_at`
is first-seen-wins (a deal's age is when its source published it, not
when we last saw it).

The event lands on the durable `domain.events.queue` Redis list (every
domain-worker event is RPUSHed there before its pub/sub broadcast —
capped by `DOMAIN_EVENTS_QUEUE_MAX`), where the **events-announcer**
worker consumes it for Discord announcing. Any new consumer of deal
events reads that list, not the database.

## Runtime

- env: `DATABASE_URL`, `REDIS_ADDR`, `HTTP_ADDR`, `DOMAIN_API_KEYS`,
  `RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`, `OTEL_EXPORTER_OTLP_ENDPOINT`
  (empty = telemetry off), `OTEL_SERVICE_NAME`.
- deploy: `go-ci-cd.yml` builds/pushes the image and redeploys via
  `terraform apply -replace=module.compute_apps_domain_api...`; the
  terraform module owns the env wiring.