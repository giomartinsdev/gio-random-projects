"""Thin, typed, read-only wrapper over the gateway's domain-event
endpoints this service actually calls. No business logic lives here —
just HTTP plus response shaping — the same "loader"-style role
flows/*/etl/load.py plays for the pollers, just for reads instead of
writes.
"""

from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — Pydantic resolves field annotations at class-creation time, not just for static typing
)
from typing import Any

import httpx
from pydantic import BaseModel


class StopRecord(BaseModel):
    id: str
    name: str
    latitude: float
    longitude: float
    mode: str = "bus"


class LineRecord(BaseModel):
    id: str
    code: str
    name: str
    mode: str


class RouteStopRecord(BaseModel):
    line_id: str
    stop_id: str
    direction_id: int
    sequence: int


class VehiclePositionRecord(BaseModel):
    """Mirrors app/domain/vehicle_position/entity.py's VehiclePosition
    shape as it comes back over the wire — `data` is the raw
    mode/line_code/vehicle_id/latitude/longitude/speed_kmh/captured_at/
    color_hex payload every poller writes (see
    api/domain/app/domain/vehicle_position/events.py's
    VehiclePositionInput)."""

    id: str
    data: dict[str, Any]
    captured_at: datetime


class DomainClient:
    """Everything bora-api knows about stops/lines/route-stops/live
    positions comes through here, never a direct call to the domain —
    same "gateway is the only door" convention every other caller in
    this system (flows, the frontend-to-be) follows."""

    def __init__(self, gateway_url: str, api_key: str, client: httpx.Client | None = None) -> None:
        self._base_url = gateway_url.rstrip("/")
        self._client = client or httpx.Client(timeout=30.0)
        self._headers = {"X-API-Key": api_key}

    def list_stops(self) -> list[StopRecord]:
        return [StopRecord.model_validate(row) for row in self._get("list-stops")]

    def list_lines(self) -> list[LineRecord]:
        return [LineRecord.model_validate(row) for row in self._get("list-lines")]

    def list_route_stops(self) -> list[RouteStopRecord]:
        return [RouteStopRecord.model_validate(row) for row in self._get("list-route-stops")]

    def list_vehicle_positions_by_lines(self, line_codes: list[str]) -> list[VehiclePositionRecord]:
        # Mirrors the domain event's own early return — skips a request
        # that would come back empty anyway.
        if not line_codes:
            return []
        rows = self._get("list-vehicle-positions-by-lines", params={"line_codes": line_codes})
        return [VehiclePositionRecord.model_validate(row) for row in rows]

    def _get(self, event_path: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        response = self._client.get(
            f"{self._base_url}/events/{event_path}", params=params, headers=self._headers
        )
        response.raise_for_status()
        result: list[dict[str, Any]] = response.json()
        return result
