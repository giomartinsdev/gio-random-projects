"""Dispatches ArchiveVehiclePositionHistory through the gateway — mirrors
flows/bus_gps_poller's GatewayBusPositionLoader (same Loader base, same
"log the domain's own count, don't hand it back up to the flow" shape),
even though there's no extract/transform stage here: the whole job is
one signal ("archive now"), not a payload that needs fetching or
reshaping, so this flow only has a Load stage.
"""

from __future__ import annotations

import httpx

from flows.shared.loader import Loader


class GatewayArchiveLoader(Loader[None]):
    """Dispatches ArchiveVehiclePositionHistory through the gateway. All
    the actual work (prune-to-10-per-vehicle, write Parquet, upload to
    MinIO) happens in the domain API's own handle() — see
    api/domain/app/domain/vehicle_position/archive_events.py."""

    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client(timeout=120.0)
        self._headers = {"X-API-Key": api_key}

    def load(self, data: None) -> None:  # noqa: ARG002 — Loader's contract takes data; there's nothing to pass since this is a trigger, not a payload
        response = self._client.post(
            f"{self._base_url}/events/archive-vehicle-position-history",
            json={},
            headers=self._headers,
        )
        response.raise_for_status()
        self.logger.info(f"Archived {response.json()} old position-history rows")
