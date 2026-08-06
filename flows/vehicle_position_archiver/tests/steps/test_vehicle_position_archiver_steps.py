from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.etl.extract import GatewayHistoryExtractor
from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader
from flows.vehicle_position_archiver.etl.transform import ArchivePlanner

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/vehicle_position_archiver.feature")

BUCKET = "vehicle-position-archive"


def _history_row(row_id: int, minutes_ago: int) -> dict[str, Any]:
    return {
        "id": row_id,
        "vehicle_id": "B1",
        "data": {"speed_kmh": float(minutes_ago)},
        "captured_at": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat(),
    }


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def gateway_calls() -> list[str]:
    return []


@given(
    parsers.parse("a fake gateway with {count:d} history rows for one vehicle"),
    target_fixture="history_rows",
)
def _given_history_rows(count: int) -> list[dict[str, Any]]:
    return [_history_row(i, minutes_ago=i) for i in range(count)]


@when("an archive run happens", target_fixture="archive_result")
def _when_archive_run_happens(
    history_rows: list[dict[str, Any]], gateway_calls: list[str]
) -> dict[str, Any]:
    put_bodies: list[dict[str, Any]] = []
    delete_id_counts: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        gateway_calls.append(request.url.path)
        if request.url.path == "/events/list-vehicle-position-history":
            return httpx.Response(200, json=history_rows)
        if request.url.path == "/events/create-bucket":
            return httpx.Response(200, json=True)
        if request.url.path == "/events/put-object":
            put_bodies.append(json.loads(request.content))
            return httpx.Response(200, json=None)
        if request.url.path == "/events/delete-vehicle-position-history-batch":
            ids = request.url.params.get_list("ids")
            delete_id_counts.append(len(ids))
            return httpx.Response(200, json=len(ids))
        raise AssertionError(f"unexpected request to {request.url.path}")

    client = _fake_client(handler)
    rows = GatewayHistoryExtractor("http://fake-gateway", "test-key", client).extract()
    plan = ArchivePlanner(keep_per_vehicle=10).transform(rows)
    GatewayArchiveLoader("http://fake-gateway", "test-key", BUCKET, client).load(plan)

    return {"put_bodies": put_bodies, "delete_id_counts": delete_id_counts}


@then(parsers.parse("{count:d} rows were uploaded to MinIO and deleted from the domain"))
def _then_rows_archived(archive_result: dict[str, Any], count: int) -> None:
    assert len(archive_result["put_bodies"]) == 1
    assert archive_result["delete_id_counts"] == [count]


@then("nothing was uploaded or deleted")
def _then_nothing_archived(archive_result: dict[str, Any]) -> None:
    assert archive_result["put_bodies"] == []
    assert archive_result["delete_id_counts"] == []
