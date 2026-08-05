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
        # httpx's own default (5s) is nowhere near enough for a batch
        # that can be tens of thousands of rows (a full city-wide SPPO
        # poll) — confirmed live: the gateway needs longer than that
        # just to receive, validate, and bulk-insert the request body.
        # Comfortably above the gateway's own GATEWAY_REQUEST_TIMEOUT_SECONDS
        # (60s) so a slow upstream surfaces as the gateway's own timeout
        # error, not an ambiguous client-side one.
        self._client = client or httpx.Client(timeout=90.0)
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
