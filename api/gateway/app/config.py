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
    api_keys: str = ""
    # 10.0 was fine for single-row CRUD but too tight for a bulk-create
    # batch (bus_gps_poller can post tens of thousands of rows in one
    # event) — confirmed live: a 35k-row SPPO poll timed out end to end
    # at the old default.
    request_timeout_seconds: float = 60.0

    @property
    def parsed_api_keys(self) -> dict[str, str]:
        return _parse_api_keys(self.api_keys)


settings = Settings()
