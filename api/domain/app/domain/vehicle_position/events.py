"""Every event for the VehiclePosition domain. Only a bulk upsert
exists — positions are never fetched/updated/deleted individually
through this API (that's a future read-side/dashboard query's job), so
there's no GetById/ListAll/Update/Delete here to keep unused routes off
the router.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.domain.base import DomainEvent
from app.domain.vehicle.entity import Vehicle
from app.domain.vehicle_position.entity import VehiclePosition

if TYPE_CHECKING:
    from sqlmodel import Session


class VehiclePositionInput(BaseModel):
    """One vehicle's GPS ping — shape produced by
    flows/bus_gps_poller's transform stage."""

    mode: str
    line_code: str
    vehicle_id: str
    latitude: float
    longitude: float
    speed_kmh: float
    captured_at: datetime
    color_hex: str | None = None


class RecordVehiclePositions(DomainEvent[VehiclePosition]):
    """Upserts each vehicle's registry row (Vehicle) and latest position
    (VehiclePosition) by vehicle_id — overwrite semantics, not an
    insert per poll, since only the current picture is ever needed.
    Bounds both tables to fleet size regardless of poll frequency."""

    positions: list[VehiclePositionInput]

    def handle(self, session: Session) -> int:
        now = datetime.now(UTC)
        for position in self.positions:
            vehicle = session.get(Vehicle, position.vehicle_id)
            if vehicle is None:
                session.add(
                    Vehicle(
                        id=position.vehicle_id,
                        mode=position.mode,
                        first_seen_at=now,
                        last_seen_at=now,
                    )
                )
            else:
                vehicle.last_seen_at = now

            # merge(), not add() — upserts by primary key: updates the
            # existing row's `data`/`captured_at` in place if a
            # VehiclePosition for this vehicle_id already exists,
            # inserts a new row otherwise. Exactly the "overwrite, don't
            # append" behavior this event exists for.
            session.merge(
                VehiclePosition(
                    id=position.vehicle_id,
                    data=position.model_dump(mode="json"),
                    captured_at=position.captured_at,
                )
            )

        session.commit()
        return len(self.positions)
