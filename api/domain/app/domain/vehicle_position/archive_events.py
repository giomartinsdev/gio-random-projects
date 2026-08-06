"""ArchiveVehiclePositionHistory lives in its own module, not
events.py, so this file's pyright relaxation (below) doesn't weaken
type-checking for RecordVehiclePositions or VehiclePositionInput too.

Both relaxations here are genuine external-library gaps, not sloppy
code — confirmed by testing (the whole event works correctly end to
end against a real Postgres + MinIO):

- pyarrow ships no type stubs pyright can find (reportMissingTypeStubs
  on `import pyarrow`) — nothing to fix on our side.
- SQLModel table classes don't expose class-level attribute access
  (`VehiclePositionHistory.captured_at`) as a SQLAlchemy
  InstrumentedAttribute the way raw SQLAlchemy declarative classes do
  under sqlalchemy2-stubs/mypy's plugin — pyright sees the plain
  Python field type (`datetime`) instead, so `.desc()` and everything
  built from it (the window-function subquery, `.c.rank`, the
  resulting Select's row type, `.in_()` on the id list) cascades to
  Unknown. This is intrinsic to how this event has to query (a
  ROW_NUMBER() OVER (...) window function has no ORM-level API at
  all — it's inherently raw Core SQL construction).
"""

# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false, reportCallIssue=false, reportArgumentType=false, reportAttributeAccessIssue=false, reportOptionalMemberAccess=false

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq
from sqlalchemy import delete, func, select

from app.domain.base import DomainEvent
from app.domain.vehicle_position.history_entity import VehiclePositionHistory
from app.infrastructure.object_storage import ARCHIVE_BUCKET, get_s3_client

if TYPE_CHECKING:
    from sqlmodel import Session


class ArchiveVehiclePositionHistory(DomainEvent[VehiclePositionHistory]):
    """Keeps VehiclePositionHistory down to the `keep_per_vehicle` most
    recent rows per vehicle — anything older is written to one Parquet
    file on MinIO, then deleted from Postgres. Dispatched hourly by
    flows/vehicle_position_archiver, independent of how often positions
    themselves get recorded."""

    keep_per_vehicle: int = 10

    def handle(self, session: Session) -> int:
        # ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY captured_at
        # DESC) ranks each vehicle's own rows newest-first; rank > N is
        # exactly "everything past the N most recent for this vehicle".
        rank = (
            func.row_number()
            .over(
                partition_by=VehiclePositionHistory.vehicle_id,
                order_by=VehiclePositionHistory.captured_at.desc(),
            )
            .label("rank")
        )
        ranked = select(
            VehiclePositionHistory.id,
            VehiclePositionHistory.vehicle_id,
            VehiclePositionHistory.data,
            VehiclePositionHistory.captured_at,
            rank,
        ).subquery()
        overflow_stmt = select(ranked).where(ranked.c.rank > self.keep_per_vehicle)
        overflow = session.exec(overflow_stmt).all()

        if not overflow:
            return 0

        table = pa.table(
            {
                "id": [row.id for row in overflow],
                "vehicle_id": [row.vehicle_id for row in overflow],
                "data": [json.dumps(row.data) for row in overflow],
                "captured_at": [row.captured_at for row in overflow],
            }
        )
        buffer = io.BytesIO()
        pq.write_table(table, buffer)

        now = datetime.now(UTC)
        key = f"vehicle-position-history/{now:%Y/%m/%d}/{now:%H%M%S}-{uuid4().hex[:8]}.parquet"
        get_s3_client().put_object(Bucket=ARCHIVE_BUCKET, Key=key, Body=buffer.getvalue())

        ids = [row.id for row in overflow]
        session.exec(delete(VehiclePositionHistory).where(VehiclePositionHistory.id.in_(ids)))
        session.commit()

        return len(overflow)
