"""Thin HTTP client for the gateway's ArchiveVehiclePositionHistory
event. Prefect-agnostic — no `@task`, no `prefect` import — so it's
unit-testable with plain pytest, same reasoning as
flows/user_crud_test/client.py."""

from __future__ import annotations

import httpx


class GatewayClient:
    def __init__(self, base_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=120.0)
        self._headers = {"X-API-Key": api_key}

    def archive_vehicle_position_history(self) -> int:
        response = self._client.post(
            f"{self._base_url}/events/archive-vehicle-position-history",
            json={},
            headers=self._headers,
        )
        response.raise_for_status()
        return int(response.json())
