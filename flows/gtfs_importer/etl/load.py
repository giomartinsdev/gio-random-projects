from __future__ import annotations

import httpx

from flows.gtfs_importer.schemas import GtfsCapture
from flows.shared.loader import Loader


class GatewayGtfsLoader(Loader[GtfsCapture]):
    """Posts stops, lines, and route-stops each as one bulk event
    through the gateway — three round-trips per import (not one per
    row), same reasoning as GatewayBusPositionLoader. Order matters:
    Stop/Line rows must exist before ReplaceRouteStops runs, since
    RouteStop's own foreign keys point at them (see
    api/domain/app/domain/line/route_stop_entity.py)."""

    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._base_url = gateway_url.rstrip("/")
        # A full city-wide GTFS import can be tens of thousands of rows
        # per event — same reasoning as GatewayBusPositionLoader's own
        # 90s timeout.
        self._client = client or httpx.Client(timeout=90.0)
        self._headers = {"X-API-Key": api_key}

    def load(self, data: GtfsCapture) -> None:
        self._post("upsert-stops", {"stops": [s.model_dump(mode="json") for s in data.stops]})
        self._post("upsert-lines", {"lines": [line.model_dump(mode="json") for line in data.lines]})
        # Every line_id in the feed, not just ones with route-stops in
        # this batch — that's what correctly empties a line's stop
        # sequence if it lost one entirely between reimports, instead of
        # leaving its old rows stale (see ReplaceRouteStops' own
        # docstring).
        line_ids = [line.id for line in data.lines]
        self._post(
            "replace-route-stops",
            {
                "line_ids": line_ids,
                "stops": [rs.model_dump(mode="json") for rs in data.route_stops],
            },
        )

    def _post(self, event_path: str, payload: dict[str, object]) -> None:
        response = self._client.post(
            f"{self._base_url}/events/{event_path}", json=payload, headers=self._headers
        )
        response.raise_for_status()
        self.logger.info(f"Loaded via {event_path}: {response.json()}")
