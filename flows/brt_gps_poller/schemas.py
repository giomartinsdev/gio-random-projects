from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — Pydantic resolves field annotations at class-creation time, not just for static typing
)

from pydantic import BaseModel


class BusPositionCapture(BaseModel):
    """One vehicle's GPS ping, parsed and typed — the shape
    api/domain's RecordVehiclePositions event expects (see
    api/domain/app/domain/vehicle_position/events.py's
    VehiclePositionInput). Same shape as flows/bus_gps_poller's own
    BusPositionCapture — kept as its own copy here rather than a shared
    import, since each flow stays self-contained/independently
    deployable (see flows/README.md)."""

    mode: str
    line_code: str
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float
    captured_at: datetime
    color_hex: str | None = None
