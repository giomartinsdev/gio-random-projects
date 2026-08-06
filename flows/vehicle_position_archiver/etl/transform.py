"""Pure-Python replacement for the ROW_NUMBER() OVER (PARTITION BY
vehicle_id ORDER BY captured_at DESC) window-function query api/domain's
ArchiveVehiclePositionHistory used to run server-side — see
api/domain/app/domain/vehicle_position/history_events.py's module
docstring for why that decision moved here: group history rows by
vehicle_id, rank each vehicle's own rows newest-first, and everything
past `keep_per_vehicle` is what gets archived.
"""

# pyarrow ships no type stubs pyright can find — nothing to fix on our
# side, confirmed working at runtime (same relaxation api/domain's
# archive-building code needed before this logic moved here).
# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import io
import json
from collections import defaultdict
from datetime import UTC, datetime
from uuid import uuid4

import pyarrow as pa
import pyarrow.parquet as pq

from flows.shared.transformer import Transformer
from flows.vehicle_position_archiver.schemas import ArchivePlan, VehiclePositionHistoryRow

_NOTHING_TO_ARCHIVE = ArchivePlan(object_key=None, parquet_bytes=b"", archived_ids=[])


class ArchivePlanner(Transformer[list[VehiclePositionHistoryRow], ArchivePlan]):
    def __init__(self, keep_per_vehicle: int = 10) -> None:
        super().__init__()
        self._keep_per_vehicle = keep_per_vehicle

    def transform(self, data: list[VehiclePositionHistoryRow]) -> ArchivePlan:
        by_vehicle: dict[str, list[VehiclePositionHistoryRow]] = defaultdict(list)
        for row in data:
            by_vehicle[row.vehicle_id].append(row)

        overflow: list[VehiclePositionHistoryRow] = []
        for rows in by_vehicle.values():
            rows.sort(key=lambda row: row.captured_at, reverse=True)
            overflow.extend(rows[self._keep_per_vehicle :])

        if not overflow:
            self.logger.info("Nothing to archive — no vehicle exceeds keep_per_vehicle")
            return _NOTHING_TO_ARCHIVE

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

        self.logger.info(f"Archiving {len(overflow)} rows to {key}")
        return ArchivePlan(
            object_key=key,
            parquet_bytes=buffer.getvalue(),
            archived_ids=[row.id for row in overflow],
        )
