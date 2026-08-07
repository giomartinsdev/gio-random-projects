"""Every event for the Stop domain. Only a bulk upsert and a plain list
exist — no GetById/Update/Delete, since nothing in this system fetches,
edits, or removes a single stop individually (flows/gtfs_importer always
writes the whole feed, and any future reader wants either "every stop"
or the domain-agnostic filtering a trip-planner would do on top of
that) — same reasoning as vehicle_position/events.py's own docstring.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.domain.base import DomainEvent, ListAll
from app.domain.stop.entity import Stop

if TYPE_CHECKING:
    from sqlmodel import Session

# Same reasoning as vehicle_position/events.py's own _CHUNK_SIZE:
# Postgres's 65535 bind-parameter ceiling, and a city-wide GTFS feed can
# be tens of thousands of stops.
_CHUNK_SIZE = 5000


class StopInput(BaseModel):
    """One stop — shape produced by flows/gtfs_importer's transform stage."""

    id: str
    name: str
    latitude: float
    longitude: float


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class UpsertStops(DomainEvent[Stop]):
    """Bulk upserts stops by their GTFS stop_id — same chunked
    ON CONFLICT shape as RecordVehiclePositions (see
    app/domain/vehicle_position/events.py), needed here for the same
    reason: a single GTFS import can be tens of thousands of rows.
    """

    stops: list[StopInput]

    def handle(self, session: Session) -> int:
        if not self.stops:
            return 0

        # Same dialect split as RecordVehiclePositions — Postgres in
        # production, sqlite in tests/local dev.
        bind = session.get_bind()
        insert = pg_insert if bind.dialect.name == "postgresql" else sqlite_insert

        # A single bulk statement can't target the same conflicting row
        # twice — same GTFS stop_id could plausibly repeat within one
        # feed (observed: some stops are listed once per direction),
        # so keep only the last occurrence in this batch.
        by_id = {stop.id: stop for stop in self.stops}
        stops = list(by_id.values())

        for batch in _chunks(stops, _CHUNK_SIZE):
            rows: list[dict[str, Any]] = [s.model_dump() for s in batch]
            stmt = insert(Stop).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "name": stmt.excluded.name,
                    "latitude": stmt.excluded.latitude,
                    "longitude": stmt.excluded.longitude,
                },
            )
            session.exec(stmt)

        session.commit()
        return len(stops)


class ListStops(ListAll[Stop]):
    """Every stop, unfiltered. Deciding what "close enough" to a given
    location means is a future trip-planner's job, not the domain's —
    same "mechanical only" stance as every other list event here."""
