from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.etl.extract import GatewayHistoryExtractor

if TYPE_CHECKING:
    from collections.abc import Callable

    from flows.vehicle_position_archiver.schemas import VehiclePositionHistoryRow

scenarios("../features/extract.feature")

API_KEY = "test-key"


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def seen() -> dict[str, object]:
    return {}


@given(parsers.parse("a fake gateway with {count:d} history rows"))
def _given_gateway_with_rows(seen: dict[str, object], count: int) -> None:
    row = {
        "id": 1,
        "vehicle_id": "B1",
        "data": {"speed_kmh": 10.0},
        "captured_at": datetime.now(UTC).isoformat(),
    }
    seen["rows"] = [{**row, "id": i + 1} for i in range(count)]
    seen["status"] = 200


@given("a fake gateway that returns a server error")
def _given_gateway_error(seen: dict[str, object]) -> None:
    seen["status"] = 500


@when("history is extracted", target_fixture="outcome")
def _when_extracted(seen: dict[str, object]) -> dict[str, object]:
    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["api_key"] = request.headers.get("x-api-key")
        if seen["status"] == 500:
            return httpx.Response(500, content=b"boom")
        return httpx.Response(200, json=seen["rows"])

    extractor = GatewayHistoryExtractor("https://gateway.example", API_KEY, _fake_gateway(handler))
    try:
        rows = extractor.extract()
    except httpx.HTTPStatusError as exc:
        return {"error": exc}
    return {"rows": rows}


@then(parsers.parse('it hit "{path}" with the API key'))
def _then_hit_path(seen: dict[str, object], path: str) -> None:
    assert seen["path"] == path
    assert seen["api_key"] == API_KEY


@then(parsers.parse("{count:d} rows were parsed back, ids in order"))
def _then_rows_parsed(outcome: dict[str, object], count: int) -> None:
    rows = cast("list[VehiclePositionHistoryRow]", outcome["rows"])
    assert [r.id for r in rows] == list(range(1, count + 1))


@then(parsers.parse("the error propagates as an HTTPStatusError with status {status:d}"))
def _then_error_propagates(outcome: dict[str, object], status: int) -> None:
    error = outcome["error"]
    assert isinstance(error, httpx.HTTPStatusError)
    assert error.response.status_code == status
