"""Every event for the VehiclePosition domain. Positions are never
fetched/updated/deleted individually through this API — no GetById/
Update/Delete here to keep unused routes off the router — but
ListVehiclePositionsByLines exists for the one read shape a caller
genuinely needs: a handful of lines' current positions, not a single
vehicle and not the whole city (see its own docstring).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, ClassVar

from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlmodel import select

from app.domain.base import DomainEvent
from app.domain.vehicle.entity import Vehicle
from app.domain.vehicle_position.entity import VehiclePosition
from app.domain.vehicle_position.history_entity import VehiclePositionHistory

if TYPE_CHECKING:
    from sqlmodel import Session

# Postgres caps a single query at 65535 bind parameters — Vehicle's 4
# columns/row means >16383 rows would blow that limit outright, and a
# real SPPO poll can be 35k+ rows city-wide. Chunking keeps every
# statement comfortably under that ceiling regardless of column count,
# while still doing O(chunks) round-trips instead of O(rows) the way a
# session.merge()-per-row loop did (confirmed too slow by testing: that
# version timed out end to end on a real ~35k-row poll).
_CHUNK_SIZE = 5000


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


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class RecordVehiclePositions(DomainEvent[VehiclePosition]):
    """Upserts each vehicle's registry row (Vehicle) and latest position
    (VehiclePosition) by vehicle_id — overwrite semantics, not an
    insert per poll, since only the current picture is ever needed.
    Bounds both tables to fleet size regardless of poll frequency. Also
    appends one row per vehicle to VehiclePositionHistory (unbounded by
    this event alone — flows/vehicle_position_archiver is what keeps
    that table down to the 10 most recent rows per vehicle, archiving
    the rest to Parquet on MinIO; see history_events.py for the
    policy-free primitives that flow calls to do it)."""

    positions: list[VehiclePositionInput]

    def handle(self, session: Session) -> int:
        if not self.positions:
            return 0

        now = datetime.now(UTC)
        # SQLAlchemy's ON CONFLICT support is dialect-specific — Postgres
        # in production, sqlite in tests/local dev (see infrastructure/db.py).
        # session.bind is only None for a session never bound to an
        # engine/connection, which get_session() (infrastructure/db.py)
        # never produces.
        bind = session.get_bind()
        insert = pg_insert if bind.dialect.name == "postgresql" else sqlite_insert

        # A single bulk statement can't target the same conflicting row
        # twice (Postgres: "ON CONFLICT DO UPDATE command cannot affect
        # row a second time") — the same vehicle_id could plausibly
        # appear more than once within one poll window, so keep only
        # each vehicle's last-seen row in this batch.
        by_vehicle_id = {position.vehicle_id: position for position in self.positions}
        positions = list(by_vehicle_id.values())

        for batch in _chunks(positions, _CHUNK_SIZE):
            vehicle_rows: list[dict[str, Any]] = [
                {"id": p.vehicle_id, "mode": p.mode, "first_seen_at": now, "last_seen_at": now}
                for p in batch
            ]
            vehicle_stmt = insert(Vehicle).values(vehicle_rows)
            # Only last_seen_at is touched on conflict — first_seen_at
            # from the VALUES list only ever applies to an actual
            # insert, so an existing vehicle's original first_seen_at
            # is left alone.
            vehicle_stmt = vehicle_stmt.on_conflict_do_update(
                index_elements=["id"], set_={"last_seen_at": vehicle_stmt.excluded.last_seen_at}
            )
            session.exec(vehicle_stmt)

            position_rows: list[dict[str, Any]] = [
                {
                    "id": p.vehicle_id,
                    "data": p.model_dump(mode="json"),
                    "captured_at": p.captured_at,
                }
                for p in batch
            ]
            position_stmt = insert(VehiclePosition).values(position_rows)
            position_stmt = position_stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "data": position_stmt.excluded.data,
                    "captured_at": position_stmt.excluded.captured_at,
                },
            )
            session.exec(position_stmt)

            history_rows: list[dict[str, Any]] = [
                {
                    "vehicle_id": p.vehicle_id,
                    "data": p.model_dump(mode="json"),
                    "captured_at": p.captured_at,
                }
                for p in batch
            ]
            # Plain bulk insert, no ON CONFLICT — id is autoincrement,
            # every row here is genuinely new (this is the append-only
            # side of the model, unlike vehicle/vehicleposition above).
            session.exec(insert(VehiclePositionHistory).values(history_rows))

        session.commit()
        return len(positions)


class ListVehiclePositionsByLines(DomainEvent[VehiclePosition]):
    """Every current VehiclePosition row for the given line_codes — a
    mechanical filter over the same JSON payload every poller already
    writes (see VehiclePositionInput.line_code above), not a business
    rule. Lets a caller (e.g. bora-api's trip-planning logic) pull live
    positions for the handful of lines it cares about instead of every
    vehicle city-wide."""

    __http_method__: ClassVar[str] = "GET"

    # Defaults to empty (not required) — same reasoning as
    # DeleteVehiclePositionHistoryBatch's `ids` in history_events.py:
    # a GET with no line_codes at all is a valid, explicit "nothing
    # requested" rather than a 422, and an empty list can't otherwise be
    # expressed as a query string (no key present looks identical to an
    # empty list to FastAPI's query-param binding either way).
    line_codes: list[str] = []  # noqa: RUF012 — Pydantic deep-copies mutable defaults per instance, unlike a dataclass

    def handle(self, session: Session) -> list[VehiclePosition]:
        if not self.line_codes:
            return []
        # .op("->>") — dialect-agnostic JSON text-extraction operator,
        # not a dialect-specific comparator (e.g. JSONB's own .astext) —
        # works the same whether `data`'s runtime column type is
        # Postgres's JSONB (production) or plain JSON (sqlite, if ever
        # used locally) per Document's own with_variant() split.
        return list(
            session.exec(
                select(VehiclePosition).where(
                    VehiclePosition.data.op("->>")("line_code").in_(self.line_codes)  # pyright: ignore[reportAttributeAccessIssue, reportUnknownMemberType, reportUnknownVariableType, reportUnknownArgumentType] — data is dict[str, Any] to pyright, but a real SQLAlchemy Column at runtime
                )
            ).all()
        )
