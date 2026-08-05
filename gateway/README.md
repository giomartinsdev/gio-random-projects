# Gateway

Auth + reverse proxy in front of `../api`. Python 3.14, FastAPI, httpx.
Every request needs a valid `X-API-Key` header (checked in `app/auth.py`)
before it's forwarded anywhere — the API behind it never has to think
about authentication at all, and never sees the key itself (stripped
before forwarding, see `app/proxy.py`).

```
client --X-API-Key--> gateway --(no key, plain proxy)--> api --> db
```

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `GATEWAY_UPSTREAM_URL` | `http://api:8000` | Where proxied requests go |
| `GATEWAY_API_KEYS` | `""` | `key1:client-a,key2:client-b` — each key maps to a client name, used only for identifying who a request came from |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | `10.0` | Timeout for the upstream call |

Generate a key with something like `openssl rand -hex 32` — the "client
name" side of the mapping is just a label, not a secret.

## Behavior

- Every path except `/health` requires the header. Missing or unknown key
  → `401`, no request ever reaches the API.
- Everything else about a request (method, path, query string, JSON
  body) passes through unchanged.
- `/health` is unauthenticated on purpose — it's what a container
  healthcheck hits.

## Running locally

```bash
pip install -r requirements-dev.txt
GATEWAY_UPSTREAM_URL=http://localhost:8000 GATEWAY_API_KEYS=dev-key:local uvicorn app.main:app --reload
```

## Checks

```bash
mypy app
pytest
```

Tests proxy against a fake in-process upstream (an ASGI transport, not a
real second server) — see `app/tests/test_proxy.py`.
