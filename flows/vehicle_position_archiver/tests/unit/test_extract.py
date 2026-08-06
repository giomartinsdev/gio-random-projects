from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx

from flows.vehicle_position_archiver.etl.extract import GatewayHistoryExtractor

if TYPE_CHECKING:
    from collections.abc import Callable

API_KEY = "test-key"


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_extract_fetches_from_the_right_path_with_the_api_key_header() -> None:
    # Given a fake gateway returning two history rows
    seen: dict[str, object] = {}
    row = {
        "id": 1,
        "vehicle_id": "B1",
        "data": {"speed_kmh": 10.0},
        "captured_at": datetime.now(UTC).isoformat(),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["api_key"] = request.headers.get("x-api-key")
        return httpx.Response(200, json=[row, {**row, "id": 2}])

    extractor = GatewayHistoryExtractor("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When extracting
    rows = extractor.extract()

    # Then it hit the right event with the api key and parsed both rows
    assert seen["path"] == "/events/list-vehicle-position-history"
    assert seen["api_key"] == API_KEY
    assert [r.id for r in rows] == [1, 2]
    assert rows[0].vehicle_id == "B1"


def test_extract_raises_on_a_server_error() -> None:
    # Given a gateway that fails
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"boom")

    extractor = GatewayHistoryExtractor("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When extracting
    # Then the error propagates rather than being swallowed
    try:
        extractor.extract()
    except httpx.HTTPStatusError as exc:
        assert exc.response.status_code == 500
    else:
        raise AssertionError("expected an HTTPStatusError")
