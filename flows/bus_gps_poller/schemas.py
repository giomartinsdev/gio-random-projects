from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — Pydantic resolves field annotations at class-creation time, not just for static typing
)

from pydantic import BaseModel


class BusPositionCapture(BaseModel):
    """One vehicle's GPS ping, parsed and typed — the shape
    api/domain's CreateBusPositions event expects (see
    api/domain/app/domain/bus_position/events.py's BusPositionInput)."""

    mode: str
    line_code: str
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float
    captured_at: datetime
    color_hex: str | None = None
