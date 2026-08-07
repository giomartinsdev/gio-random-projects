# This test reads back a pyarrow Table, which has no type stubs pyright
# can find — same intrinsic gap as the transform module itself.
# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import io
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pyarrow.parquet as pq
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.etl.transform import ArchivePlanner
from flows.vehicle_position_archiver.schemas import VehiclePositionHistoryRow

scenarios("../features/transform.feature")


def _row(row_id: int, vehicle_id: str, minutes_ago: int) -> VehiclePositionHistoryRow:
    return VehiclePositionHistoryRow(
        id=row_id,
        vehicle_id=vehicle_id,
        data={"speed_kmh": float(minutes_ago)},
        captured_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
    )


@pytest.fixture()
def rows() -> list[VehiclePositionHistoryRow]:
    return []


@given(
    parsers.parse(
        '{count:d} history rows for vehicle "{vehicle_id}" and {count2:d} for vehicle "{vehicle_id2}"'
    )
)
def _given_two_vehicles(
    rows: list[VehiclePositionHistoryRow],
    count: int,
    vehicle_id: str,
    count2: int,
    vehicle_id2: str,
) -> None:
    rows.extend(_row(i, vehicle_id, minutes_ago=i) for i in range(count))
    rows.extend(_row(100 + i, vehicle_id2, minutes_ago=i) for i in range(count2))


@given(parsers.parse('{count:d} history rows for vehicle "{vehicle_id}"'))
def _given_one_vehicle(rows: list[VehiclePositionHistoryRow], count: int, vehicle_id: str) -> None:
    rows.extend(_row(i, vehicle_id, minutes_ago=i) for i in range(count))


@when(parsers.parse("the archive is planned with keep_per_vehicle {keep:d}"), target_fixture="plan")
def _when_planned(rows: list[VehiclePositionHistoryRow], keep: int) -> Any:
    return ArchivePlanner(keep_per_vehicle=keep).transform(rows)


@when("the archive is planned with the default keep_per_vehicle", target_fixture="plan")
def _when_planned_default(rows: list[VehiclePositionHistoryRow]) -> Any:
    return ArchivePlanner().transform(rows)


@then("B1's 2 oldest rows are archived and B2 is untouched")
def _then_b1_archived(plan: Any) -> None:
    assert sorted(plan.archived_ids) == [10, 11]


@then(parsers.parse('the object key starts with "{prefix}" and ends with "{suffix}"'))
def _then_object_key(plan: Any, prefix: str, suffix: str) -> None:
    assert plan.object_key is not None
    assert plan.object_key.startswith(prefix)
    assert plan.object_key.endswith(suffix)


@then(parsers.parse("the Parquet file holds exactly {count:d} rows with speeds {s1:g} and {s2:g}"))
def _then_parquet_contents(plan: Any, count: int, s1: float, s2: float) -> None:
    table = pq.read_table(io.BytesIO(plan.parquet_bytes))
    parsed = table.to_pylist()
    assert len(parsed) == count
    speeds = sorted(json.loads(row["data"])["speed_kmh"] for row in parsed)
    assert speeds == [s1, s2]


@then("nothing is archived")
def _then_nothing_archived(plan: Any) -> None:
    assert plan.object_key is None
    assert plan.archived_ids == []
    assert plan.parquet_bytes == b""
