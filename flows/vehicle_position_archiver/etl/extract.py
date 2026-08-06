"""Fetches every VehiclePositionHistory row through the gateway. The
domain has no pruning opinion of its own anymore (see
api/domain/app/domain/vehicle_position/history_events.py), so this
flow has to pull everything and decide for itself what's old enough
to archive.
"""

from __future__ import annotations

import httpx

from flows.shared.extractor import Extractor
from flows.vehicle_position_archiver.schemas import VehiclePositionHistoryRow


class GatewayHistoryExtractor(Extractor[list[VehiclePositionHistoryRow]]):
    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client(timeout=120.0)
        self._headers = {"X-API-Key": api_key}

    def extract(self) -> list[VehiclePositionHistoryRow]:
        response = self._client.get(
            f"{self._base_url}/events/list-vehicle-position-history", headers=self._headers
        )
        response.raise_for_status()
        rows = [VehiclePositionHistoryRow.model_validate(row) for row in response.json()]
        self.logger.info(f"Fetched {len(rows)} VehiclePositionHistory rows")
        return rows
