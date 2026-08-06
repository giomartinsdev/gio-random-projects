# Gateway

Auth + reverse proxy in front of `../domain`. Python 3.14, FastAPI,
httpx. Every request needs a valid `X-API-Key` header (checked in
`app/auth.py`) before it's forwarded anywhere — the API behind it never
has to think about authentication at all, and never sees the key itself
(stripped before forwarding, see `app/proxy.py`).

```
client --X-API-Key--> gateway --(no key, plain proxy)--> api --> db
```

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `GATEWAY_UPSTREAM_URL` | `http://api:8000` | Where proxied requests go |
| `GATEWAY_API_KEYS` | `""` | `key1:client-a,key2:client-b` — each key maps to a client name, used only for identifying who a request came from |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | `10.0` | Timeout for the upstream call |
| `GATEWAY_MAX_BODY_BYTES` | `50000000` | Hard cap on request body size (see Behavior below) |
| `GATEWAY_RATE_LIMIT` | `120/minute` | Per-API-key rate limit (`slowapi`/`limits` string syntax, e.g. `"60/minute"`) |

Generate a key with something like `openssl rand -hex 32` — the "client
name" side of the mapping is just a label, not a secret.

## Behavior

- Every path except `/health` requires the header. Missing or unknown key
  → `401`, no request ever reaches the API.
- Everything else about a request (method, path, query string, JSON
  body) passes through unchanged, up to two limits:
  - **Body size** — capped at `GATEWAY_MAX_BODY_BYTES`. Enforced against
    the actual bytes streamed off the wire (not just a trusted
    `Content-Length` header), so a leaked key or a buggy/malicious
    client can't force the gateway — or the upstream it forwards the
    same body to — to buffer an unbounded request in memory. Over the
    cap → `413`, before the body is ever forwarded.
  - **Rate limit** — `GATEWAY_RATE_LIMIT` requests per window, per
    calling API key (not per IP — every real caller sits behind
    Cloudflare's edge IPs, so IP-based limiting would throttle everyone
    together). Over the limit → `429`.
- `/health` is unauthenticated and unlimited on purpose — it's what a
  container healthcheck hits.

## Telemetry

Automatic, zero-code — see `../README.md#telemetry` for how it works
(same mechanism across every service under `api/`).

## Running locally

```bash
pip install -r requirements-dev.txt
GATEWAY_UPSTREAM_URL=http://localhost:8000 GATEWAY_API_KEYS=dev-key:local uvicorn app.main:app --reload
```

## Checks

```bash
ruff check .
ruff format --check .
pyright .
pytest
```

Tests proxy against a fake in-process upstream (an ASGI transport, not a
real second server) — see `app/tests/test_proxy.py`.
