# api/

Every subfolder here with a `Dockerfile` is its own independently
deployable API. `.github/workflows/api-build-push.yml` discovers them
dynamically on every push — add a new one and it starts building/pushing
to `registry.giomartins.dev` with zero workflow changes.

## Adding a new API

```
api/<name>/
  Dockerfile      # required — this is what marks it as a deployable service
  ...whatever the service needs
```

The folder name becomes both the Docker build context and the image name:
`api/<name>/` → `registry.giomartins.dev/<name>:latest` +
`registry.giomartins.dev/<name>:<git-sha>`.

Build context for every service's `Dockerfile` is `api/` itself (not
`api/<name>/`) — see the CI workflow — specifically so each one can
`COPY shared shared` alongside its own code. Wire it up the same way in
any new service:

```dockerfile
COPY shared shared
COPY <name>/app app
```

```python
# app/__init__.py
from shared.auto_trace import install
install(["app"])
```

Add `OTEL_SERVICE_NAME=<name>` when you run it, wrap the CMD with
`opentelemetry-instrument`, and that's the entire telemetry setup — see
below.

## Telemetry

Every service gets full tracing automatically, with **zero
per-request/per-route code** — the same "define it, don't register it"
principle as `flows/shared/auto_trace.py`. Two layers, both automatic:

1. **Framework-level spans** (HTTP request/response, outgoing httpx
   calls, SQLAlchemy queries) — via `opentelemetry-instrument`, which
   wraps the container's start command (see each service's `Dockerfile`)
   and activates whatever auto-instrumentation packages
   `opentelemetry-bootstrap -a install` found and installed at build
   time, purely from env vars at runtime. No code involved at all.
2. **Method-level spans inside the service's own code** (domain logic,
   auth checks, proxy forwarding, ...) — via `shared/auto_trace.py`, an
   import hook installed once from each service's `app/__init__.py`
   (`install(["app"])`). Every function and class method under `app.*`
   gets wrapped with a span the moment its module is imported, nested
   under whichever framework-level span (1) is active — no manual
   instrumentation, no decorators to remember to add to a new class.

`shared/` is a plain Python package, not a pip dependency — each
service's Dockerfile `COPY`s it in directly (build context is `api/`,
see above) since every service here ships as its own independent image
with its own dependency set; there's no shared venv to import a common
package from across them the way `flows/` can.

Runtime env vars (same shape as `prefect.yaml`'s tracing setup):

```yaml
environment:
  OTEL_SERVICE_NAME: <name>
  OTEL_TRACES_EXPORTER: otlp
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_EXPORTER_OTLP_ENDPOINT: https://otel.giomartins.dev
  OTEL_EXPORTER_OTLP_HEADERS: "CF-Access-Client-Id={{ ... }},CF-Access-Client-Secret={{ ... }}"
```

Verified locally end to end (debug OTel collector, real requests through
both services): a request into `domain` produces one trace spanning
the FastAPI HTTP span → `app.service.dispatcher.dispatch` →
`app.domain.base.Create.handle` → the SQLAlchemy insert; a request
through `gateway` produces `app.auth.require_api_key` →
`app.proxy.forward` → the outbound httpx call to `domain`, all under
one trace id.

## Current services

- **`domain/`** — the DDD/event-driven domain API (Python 3.14,
  FastAPI, SQLModel) + its own Postgres, brought up together via
  `domain/compose.yaml`. See `domain/README.md` for how the API's
  internal convention works (define an entity + events, everything else
  is automatic) — that's a separate, inner convention from this folder's
  "one Dockerfile = one deployable service" one.
- **`gateway/`** — auth + reverse proxy in front of `domain`, brought up
  alone via `gateway/compose.yaml`. See `gateway/README.md`.
