from __future__ import annotations

import httpx

from flows.brt_gps_poller.schemas import BusPositionCapture
from flows.shared.loader import Loader


class GatewayBusPositionLoader(Loader[list[BusPositionCapture]]):
    """Posts the whole batch as one RecordVehiclePositions event through
    the gateway — one HTTP round-trip and one domain_event_store audit
    row per poll, not one per position. The domain side upserts by
    vehicle_id (see api/domain/app/domain/vehicle_position/events.py),
    so this keeps landing the same "latest known position" row per
    vehicle every poll rather than growing an append-only history.
    BRT's own fleet is far smaller than SPPO's (hundreds, not tens of
    thousands), but the same generous timeout is kept for consistency
    and to absorb any slow poll without a code change."""

    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client(timeout=90.0)
        self._headers = {"X-API-Key": api_key}

    def load(self, data: list[BusPositionCapture]) -> None:
        if not data:
            self.logger.info("No positions to load, skipping the request entirely")
            return

        response = self._client.post(
            f"{self._base_url}/events/record-vehicle-positions",
            json={"positions": [position.model_dump(mode="json") for position in data]},
            headers=self._headers,
        )
        response.raise_for_status()
        self.logger.info(f"Loaded {response.json()} positions via the gateway")
