# domain-api

The write/read front door of the CQRS side of this stack: every write
is a command answered with a `202 Accepted`, persisted by the paired
domain-worker (see `modules/apps/domain-worker`), and read back through
plain GETs. Shares one Postgres database and RabbitMQ with everything
else on the network.

## Writes: commands, not CRUD

`POST /commands` is the default write door: it decodes the bare
`{"action", "payload"}` envelope, publishes it with a fresh server-side id,
and answers `202 {"command_id": ..., "status": "accepted"}`. The
domain-worker consumes `domain.commands.queue`, dispatches by action family
(`club.`, `partida.`, `clubs.*`, `finance.*`, `preferencia.`, ...), writes
the audit row (success or failure, always), and publishes the resulting
domain event only on success. Nothing here writes application tables in the
HTTP handler.

The current surface is the **FC Clubs Hub**: public Pro Clubs data
(clubs, squads, matches, analytics) plus the per-person preferences the
hub's SPA and services use. All routes require `X-API-Key` — see
`local.domain_api_keys` in `modules/infra/terraform/secrets.tf`; each
caller gets its own identity so the audit log can name them. See
`openapi.yaml` for the full route list.

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
until the write is durable. Today the clubs services use `/sync` for
their structural writes (club, partida, watchlist, claim, notify) and
the normal async `202` for append-only, high-volume ones (snapshot,
anuncio). New services: default to async — reach for `/sync` only when
the caller needs the confirmation, and say so in your own docs.

## Runtime

- env: `DATABASE_URL`, `RABBITMQ_URL`, `HTTP_ADDR`, `DOMAIN_API_KEYS`,
  `RATE_LIMIT_RPS`/`RATE_LIMIT_BURST`, `OTEL_EXPORTER_OTLP_ENDPOINT`
  (empty = telemetry off), `OTEL_SERVICE_NAME`.
- deploy: `go-ci-cd.yml` builds/pushes the image and redeploys via
  `terraform apply -replace=module.compute_apps_domain_api...`; the
  terraform module owns the env wiring.
