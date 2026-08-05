from __future__ import annotations

import httpx

from flows.bus_gps_poller.schemas import BusPositionCapture
from flows.shared.loader import Loader


class GatewayBusPositionLoader(Loader[list[BusPositionCapture]]):
    """Posts the whole batch as one CreateBusPositions event through the
    gateway — one HTTP round-trip and one domain_event_store audit row
    per poll, not one per position (see api/domain/app/domain/base.py's
    CreateMany)."""

    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client()
        self._headers = {"X-API-Key": api_key}

    def load(self, data: list[BusPositionCapture]) -> None:
        if not data:
            self.logger.info("No positions to load, skipping the request entirely")
            return

        response = self._client.post(
            f"{self._base_url}/events/create-bus-positions",
            json={"positions": [position.model_dump(mode="json") for position in data]},
            headers=self._headers,
        )
        response.raise_for_status()
        self.logger.info(f"Loaded {response.json()} positions via the gateway")
