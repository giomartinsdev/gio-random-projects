"""Gateway configuration, read once from the environment.

API_KEYS format: `key1:client-a,key2:client-b` — each key maps to a
client name used only for logging/audit (see auth.py); the gateway never
needs to know more about a caller than "who are you" to decide whether to
proxy their request.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


def _parse_api_keys(raw: str) -> dict[str, str]:
    if not raw.strip():
        return {}
    pairs = (entry.split(":", 1) for entry in raw.split(",") if entry.strip())
    return {key.strip(): client.strip() for key, client in pairs}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GATEWAY_")

    upstream_url: str = "http://api:8000"
    # Where the three public, unauthenticated routes below proxy to —
    # bora-api is otherwise identical to `upstream_url` in trust level
    # (an internal service, never exposed on its own), just reached via
    # a different set of literal paths instead of the catch-all. See
    # app/main.py's own comment on why these can't share the catch-all.
    bora_api_upstream_url: str = "http://bora-api:8000"
    api_keys: str = ""
    # 10.0 was fine for single-row CRUD but too tight for a bulk-create
    # batch (bus_gps_poller can post tens of thousands of rows in one
    # event) — confirmed live: a 35k-row SPPO poll timed out end to end
    # at the old default.
    request_timeout_seconds: float = 60.0
    # 50MB — headroom over the largest known legitimate body (a 35k-row
    # SPPO poll is a few MB of JSON) while still bounding per-request
    # memory use. proxy.py enforces this against the actual bytes
    # streamed off the wire, not just a trusted Content-Length header —
    # a leaked key or a buggy client sending an unbounded/chunked body
    # otherwise has no cap on how much the gateway (and, since it
    # forwards the same body, the domain) buffers in memory per request.
    max_body_bytes: int = 50_000_000
    # Per calling API key (see _rate_limit_key in app/main.py) — a
    # single leaked key or misbehaving client is bounded without
    # throttling every other client sharing the gateway. The same
    # limiter also covers the public bora-api-facing routes, keyed by
    # caller IP there instead (no API key on that surface — see
    # _rate_limit_key).
    rate_limit: str = "120/minute"
    # Comma-separated origins the frontend is served from — the browser
    # calls the public bora-api-facing routes below cross-origin (the
    # frontend and this gateway are served from different origins), and
    # gets silently blocked by CORS without this. No default covering a
    # real domain on purpose: unlike everything else here, this is one
    # setting a real deployment MUST override explicitly (see
    # gateway/README.md) rather than inherit a guessable default for.
    cors_origins: str = "http://localhost:5173,http://localhost:4173"

    @property
    def parsed_api_keys(self) -> dict[str, str]:
        return _parse_api_keys(self.api_keys)

    @property
    def parsed_cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
