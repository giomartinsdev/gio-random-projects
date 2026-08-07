# Gateway

Reverse proxy in front of `../domain` AND `../bora-api` — the one thing
in this whole system exposed to the internet. Python 3.14, FastAPI,
httpx. Two distinct surfaces, two distinct trust models:

```
                                    X-API-Key required
flows, scripts  ────────────────>  gateway  ──(no key, plain proxy)──>  domain
                                       │
browser (bora. frontend)  ─────────────┤  no key, IP rate-limited
  /nearby-stops                        │
  /trip-options                        └────────────────────────────>  bora-api
  /geocode
```

- **The catch-all** (`/{path:path}`, every method): requires `X-API-Key`
  (checked in `app/auth.py`), proxies to `GATEWAY_UPSTREAM_URL`
  (`domain`). The key is stripped before forwarding — `domain` never
  sees it and never has to think about auth at all. This is for trusted
  internal callers (flows, scripts) only.
- **Three literal routes** — `/nearby-stops`, `/trip-options`,
  `/geocode` — registered *before* the catch-all (Starlette matches
  routes in registration order, not by specificity) so they never fall
  through to it. No `X-API-Key` required, since these exist specifically
  for the frontend's anonymous browser traffic; proxy to
  `GATEWAY_BORA_API_UPSTREAM_URL` (`bora-api`) instead. Rate-limited by
  caller IP rather than API key (see `app/main.py`'s `_rate_limit_key`),
  and the only routes CORS applies to.

`bora-api` itself has no auth, rate-limit, or CORS of its own — same
trust relationship `domain` already has with this gateway. Don't expose
`bora-api` on its own hostname; everything reaches it through here.

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `GATEWAY_UPSTREAM_URL` | `http://api:8000` | Where the authenticated catch-all proxies to (`domain`) |
| `GATEWAY_BORA_API_UPSTREAM_URL` | `http://bora-api:8000` | Where the three public routes proxy to (`bora-api`) |
| `GATEWAY_API_KEYS` | `""` | `key1:client-a,key2:client-b` — each key maps to a client name, used only for identifying who a request came from |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | `10.0` | Timeout for the upstream call |
| `GATEWAY_MAX_BODY_BYTES` | `50000000` | Hard cap on request body size (see Behavior below) |
| `GATEWAY_RATE_LIMIT` | `120/minute` | Rate limit — per API key on the catch-all, per caller IP on the public routes (`slowapi`/`limits` string syntax) |
| `GATEWAY_CORS_ORIGINS` | `http://localhost:5173,http://localhost:4173` | Comma-separated origins allowed to call the public routes cross-origin — **override this for a real deployment**, the default only covers local dev |

Generate an API key with something like `openssl rand -hex 32` — the
"client name" side of the mapping is just a label, not a secret.

## Behavior

- Every catch-all path except `/health` requires the header. Missing or
  unknown key → `401`, no request ever reaches `domain`. The three
  public routes never check for a key at all.
- Everything else about a proxied request (method, path, query string,
  JSON body) passes through unchanged, up to two limits:
  - **Body size** — capped at `GATEWAY_MAX_BODY_BYTES`. Enforced against
    the actual bytes streamed off the wire (not just a trusted
    `Content-Length` header), so a leaked key or a buggy/malicious
    client can't force the gateway — or the upstream it forwards the
    same body to — to buffer an unbounded request in memory. Over the
    cap → `413`, before the body is ever forwarded.
  - **Rate limit** — `GATEWAY_RATE_LIMIT` requests per window. Over the
    limit → `429` with a `Retry-After` header.
- `/health` is unauthenticated and unlimited on purpose — it's what a
  container healthcheck hits.

## Telemetry

Automatic, zero-code — see `../README.md#telemetry` for how it works
(same mechanism across every service under `api/`).

## Running locally

```bash
pip install -r requirements-dev.txt
GATEWAY_UPSTREAM_URL=http://localhost:8001 GATEWAY_BORA_API_UPSTREAM_URL=http://localhost:8002 GATEWAY_API_KEYS=dev-key:local uvicorn app.main:app --reload
```

## Checks

```bash
ruff check .
ruff format --check .
pyright .
pytest
```

Tests proxy against a real upstream server running in its own
testcontainer (see `app/tests/conftest.py`) — a real TCP hop, not an
in-process ASGI transport standing in for one. The same fake upstream
plays both the `domain` and `bora-api` roles across the two feature
files (`proxy.feature` for the authenticated catch-all,
`public_routes.feature` for the three public routes).
