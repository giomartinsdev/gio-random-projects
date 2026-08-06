# This test reads back a pyarrow Table, which has no type stubs pyright
# can find — same intrinsic gap as the transform module itself.
# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import io
import json
from datetime import UTC, datetime, timedelta

import pyarrow.parquet as pq

from flows.vehicle_position_archiver.etl.transform import ArchivePlanner
from flows.vehicle_position_archiver.schemas import VehiclePositionHistoryRow


def _row(row_id: int, vehicle_id: str, minutes_ago: int) -> VehiclePositionHistoryRow:
    return VehiclePositionHistoryRow(
        id=row_id,
        vehicle_id=vehicle_id,
        data={"speed_kmh": float(minutes_ago)},
        captured_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
    )


def test_keeps_only_the_10_newest_rows_per_vehicle() -> None:
    # Given 12 rows for B1 (newest = minutes_ago 0) and 3 rows for B2
    rows = [_row(i, "B1", minutes_ago=i) for i in range(12)] + [
        _row(100 + i, "B2", minutes_ago=i) for i in range(3)
    ]

    # When planning the archive
    plan = ArchivePlanner(keep_per_vehicle=10).transform(rows)

    # Then only B1's 2 oldest rows (ids 10, 11) are archived — B2 is untouched
    assert sorted(plan.archived_ids) == [10, 11]
    assert plan.object_key is not None
    assert plan.object_key.startswith("vehicle-position-history/")
    assert plan.object_key.endswith(".parquet")


def test_archived_parquet_bytes_contain_exactly_the_archived_rows() -> None:
    # Given 12 rows for one vehicle
    rows = [_row(i, "B1", minutes_ago=i) for i in range(12)]

    # When planning the archive
    plan = ArchivePlanner(keep_per_vehicle=10).transform(rows)

    # Then the Parquet file holds exactly the 2 archived rows
    table = pq.read_table(io.BytesIO(plan.parquet_bytes))
    parsed = table.to_pylist()
    assert len(parsed) == 2
    speeds = sorted(json.loads(row["data"])["speed_kmh"] for row in parsed)
    assert speeds == [10.0, 11.0]


def test_no_archive_needed_when_every_vehicle_is_within_the_keep_count() -> None:
    # Given only 3 rows for one vehicle (under the default keep=10)
    rows = [_row(i, "B1", minutes_ago=i) for i in range(3)]

    # When planning the archive
    plan = ArchivePlanner().transform(rows)

    # Then there's nothing to archive
    assert plan.object_key is None
    assert plan.archived_ids == []
    assert plan.parquet_bytes == b""
