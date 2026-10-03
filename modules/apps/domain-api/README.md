# domain-api

The write/read front door of the CQRS side of this stack: every write
is a command answered with a `202 Accepted`, persisted by the paired
domain-worker (see `modules/apps/domain-worker`), and read back through
plain GETs. Shares one Postgres database and RabbitMQ with everything
else on the network.

## Writes: commands, not CRUD

`POST` to any collection answers `202 {"command_id": ..., "status":
"accepted"}` — the API publishes the command to RabbitMQ, the
domain-worker consumes `domain.commands.queue`, dispatches by action prefix (`user.`,
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

## POST /sync — the exception, not the pattern

`POST /sync` takes the same `{"action", "payload"}` envelope, publishes
it on the **same async broker as everything else**, then holds the HTTP
request open, polling `audit_log` by `command_id` (the worker writes
that row unconditionally — success or failure — so the row, not the
RabbitMQ publish, is the proof of "applied") until it lands or 10s pass:

| outcome | response |
|---|---|
| applied | `200 {command_id, status: "written", entity_id}` |
| rejected by the worker (validation, unknown action, ...) | `422 {command_id, status: "failed", error}` |
| no audit row within 10s | `504 {command_id, status: "queued"}` — **timeout ≠ not written**: the command stays queued behind a busy/down worker and may still land. Only `written` is a confirmation. |

Use the plain `202` path unless your caller literally cannot proceed
until the write is durable. Today the only such caller is **cch-api**
(its room registry must survive a restart that happens seconds after a
room is created); its structural writes (`cchroom.*`, `cchdeck.upsert`)
go through `/sync`, while its fire-and-forget play counts use the normal
async `202`. New services: default to async — reach for `/sync` only
when the caller needs the confirmation, and say so in your own docs.

## The deals contract specifically

`POST /deals` is the scrapers' ingest path (`deal.upsert`): upsert by
`(source, source_deal_id)` — the Go worker owns the `raw_deals` table
and reports insert vs update via `RETURNING (xmax = 0)`. First-seen
rows publish a **`deal.created`** event; re-polls of the same deal only
update columns and the audit row, no event — at ~2 scrapers × 1800s
polls, dedupe there is what keeps the event queue honest. `posted_at`
is first-seen-wins (a deal's age is when its source published it, not
when we last saw it).

The event lands on the durable `domain.events.queue` RabbitMQ queue (the
`domain.events` fanout exchange delivers to it, capped by
`DOMAIN_EVENTS_QUEUE_MAX` with drop-head overflow), where the
**events-announcer** worker consumes it for Discord announcing. Live
subscribers — such as this API's SSE endpoint — bind an ephemeral,
auto-delete queue to the same exchange. Any new consumer of deal events
reads that queue, not the database.

## Runtime

- env: `DATABASE_URL`, `RABBITMQ_URL`, `HTTP_ADDR`, `DOMAIN_API_KEYS`,
  `RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`, `OTEL_EXPORTER_OTLP_ENDPOINT`
  (empty = telemetry off), `OTEL_SERVICE_NAME`.
- deploy: `go-ci-cd.yml` builds/pushes the image and redeploys via
  `terraform apply -replace=module.compute_apps_domain_api...`; the
  terraform module owns the env wiring.