"""Cliente da finance-api para o conector.

O conector NÃO tem banco e NÃO fala com o domain-api: ele publica comandos
(``finance.*``) na finance-api, que os relaya — a mesma porta de escrita do
worker conversacional, com a key própria do conector (§1.1).
"""

from __future__ import annotations

from typing import Any, Mapping

import httpx


class FinanceApiClient:
    def __init__(self, base_url: str, api_key: str, *, timeout_s: float = 15.0) -> None:
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._timeout = timeout_s

    def submit(self, action: str, payload: Mapping[str, Any]) -> dict:
        resp = httpx.post(
            f"{self._base}/commands",
            headers={"X-API-Key": self._key, "Content-Type": "application/json"},
            json={"action": action, "payload": dict(payload)},
            timeout=self._timeout,
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"finance-api {resp.status_code}: {resp.text[:200]}")
        try:
            return resp.json()
        except ValueError:
            return {}
