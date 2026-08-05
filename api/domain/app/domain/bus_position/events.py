"""Every event for the BusPosition domain. Only a bulk-create exists —
positions are never fetched/updated/deleted individually through this
API (that's what a future read-side/dashboard query would be for), so
there's no GetById/ListAll/Update/Delete here to keep unused routes off
the router.
"""

from __future__ import annotations

from datetime import (
    datetime,  # noqa: TC003 — Pydantic resolves field annotations at class-creation time, not just for static typing
)

from pydantic import BaseModel

from app.domain.base import CreateMany
from app.domain.bus_position.entity import BusPosition


class BusPositionInput(BaseModel):
    """One vehicle's GPS ping — shape produced by
    flows/bus_gps_poller's transform stage, passed straight through
    into BusPosition.data verbatim."""

    mode: str
    line_code: str
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float
    captured_at: datetime
    color_hex: str | None = None


class CreateBusPositions(CreateMany[BusPosition]):
    positions: list[BusPositionInput]

    def to_entities(self) -> list[BusPosition]:
        return [
            BusPosition(data=position.model_dump(mode="json"), captured_at=position.captured_at)
            for position in self.positions
        ]
