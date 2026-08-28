# observability

The Grafana stack: **grafana** (dashboards), **loki** (logs),
**prometheus** (metrics), **tempo** (traces), and **alloy** (the single
OTLP collector everything funnels through). Five containers, one
module — the pieces only exist to serve each other, the same reason
beszel's hub+agent and the registry+watchtower pair each live in one
module.

```
apps (docker network)  ──OTLP http://alloy:4318──┐
browsers (SPAs)        ──OTLP otel.giomartins.dev─┤  ingress → 127.0.0.1:4318
                                                  ▼
                                            ALLOY :4317/:4318
                                            ├─ traces  ──otlp──→  tempo :3200
                                            ├─ metrics ──remote write──→ prometheus :9090
every container's stdout ──ALLOY (docker.sock) ──→ loki :3100
PROMETHEUS ── scrape ──→ alloy/grafana/loki/tempo /metrics
```

## What each piece is for

- **alloy** is the only thing apps and browsers talk to. One
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318` env var per app (see
  each `compute/apps/*` module) sends traces and metrics to one place
  (host-networked tela-api uses the loopback publish instead). It also
  tails **every container's stdout** through the Docker API
  (read-only `docker.sock` mount) and pushes that to Loki — so logs
  flow for postgres, redis, minio, ingress, and anything else that
  never grew a telemetry package, with zero per-app work.
- **loki** stores logs, ingested exactly once per line: alloy's
  `loki.write` (docker scrape) is the ONLY log path. Apps deliberately
  do NOT forward logs over OTLP — that would double-ingest every line
  (once via OTLP, once via the stdout scrape). Trace correlation
  instead rides in the stdout JSON itself: the Go slog handler and the
  pino mixin both inject `trace_id`/`span_id` into the line,
  and Grafana's Loki datasource has a derived field linking the match
  into Tempo. (Loki's native OTLP endpoint stays available — schema
  v13 + structured metadata are on — for if that tradeoff ever flips.)
- **prometheus** runs with `--web.enable-remote-write-receiver`: apps
  push OTLP metrics through alloy (no `/metrics` endpoint on any app to
  scrape or expose), and prometheus itself scrapes the stack's own
  four `/metrics` endpoints.
- **tempo** stores traces (local backend, 7d retention).
- **grafana** is the front door at `grafana.giomartins.dev` —
  datasources and one "Apps Overview" dashboard are provisioned from
  the config volume (no clicking). Cloudflare Access is the outer
  layer (Google SSO, same as beszel); the Terraform-generated admin
  password (seeded into Vaultwarden as `GRAFANA_ADMIN_PASSWORD`) is the
  inner one.

## Hostnames & exposure

| hostname | port | access |
|---|---|---|
| `grafana.giomartins.dev` | 127.0.0.1:3000 | Cloudflare Access (Google SSO) + Grafana's own login |
| `otel.giomartins.dev` | 127.0.0.1:4318 | **No Access** — public visitors' browsers send SPA telemetry here. Controls: alloy's OTLP receiver CORS allowlist (the two SPA origins plus Discord's `*.discordsays.com` Activity iframe) and it only accepts OTLP payloads. In `excluded_hostnames` for the same reason as the API hostnames. |

Everything else (loki, prometheus, tempo, alloy's gRPC port, grafana's
UI from inside the network) is internal-only — no published ports.

## Config lifecycle

Every config file is written straight into its container at create
time via the docker provider's `upload` (templates/ → `templatefile`)
— the same pattern as ingress's nginx conf. Consequences worth knowing:

- A config change **recreates that container** (upload is ForceNew).
  Telemetry data lives in docker volumes, so nothing is lost — grafana
  dashboards/datasources are re-provisioned on boot, loki/tempo/
  prometheus re-open their stores.
- `upload` can't mkdir; every target path (e.g.
  `/etc/grafana/provisioning/datasources/`) already exists in the base
  image. If an image ever drops one, that upload fails loudly at plan
  time — fall back to a one-shot alpine init container for that file.

The containers run as root (`user = "0"`): a fresh docker volume is
root:root 0755 and loki/tempo/grafana don't chown their data dirs the
way postgres's entrypoint does, and alloy needs the host's docker.sock
(same as beszel-agent and watchtower). Ports are loopback-only, so
root-in-container buys no network exposure; tighten with a chown pass
if it ever matters.

Each container also carries `memory = 512` and a 10m×3 log rotation —
unlike the rest of this repo's containers, deliberately: this stack
shares the box with postgres, redis, minio, five apps, and the Project
Zomboid server, and a bounded OOM-restart on an observability container
beats it squeezing everything else. If one starts cycling, raise its
ceiling (and check what's leaking).

## Retention (kept small on purpose — shared VPS)

| store | retention |
|---|---|
| loki | 7 days (`limits_config.retention_period`, enforced by the compactor) |
| tempo | 3 days (`block_retention` — span volume from the SFU-heavy apps dwarfs log volume; traces age out of usefulness faster than logs) |
| prometheus | 15 days (CLI flag) |

## Adding a new app

1. Give its container `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318`
   and `OTEL_SERVICE_NAME=<name>` (every existing app module does this
   — see `compute/apps/domain_api/main.tf`).
2. Point its OpenTelemetry SDK at that endpoint. Go: `internal/telemetry`
   (copy domain-api's). TS backend: `src/telemetry.ts` + `src/logger.ts`
   (copy post-api's). A browser SPA instead gets `src/telemetry.ts`
   (copy either SPA's) and `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` in
   ts-frontend-ci-cd.yml — its telemetry goes over the public
   `otel.giomartins.dev`, so the origin belongs in the root main.tf's
   `frontend_origins` list too.
3. That's it — traces/metrics/logs start flowing; stdout logs were
   already covered by the docker scrape.