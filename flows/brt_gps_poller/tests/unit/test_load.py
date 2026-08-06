# This test asserts against a raw wire-level JSON body (json.loads
# returns Any) — genuinely dynamic, not a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx

from flows.brt_gps_poller.etl.load import GatewayBusPositionLoader
from flows.brt_gps_poller.schemas import BusPositionCapture

if TYPE_CHECKING:
    from collections.abc import Callable

API_KEY = "test-key"


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _capture(vehicle_id: str = "901008") -> BusPositionCapture:
    return BusPositionCapture(
        mode="brt",
        line_code="35",
        vehicle_id=vehicle_id,
        latitude=-22.9,
        longitude=-43.3,
        speed_kmh=10.0,
        captured_at=datetime.now(UTC),
    )


def test_load_posts_the_whole_batch_as_one_request_with_the_api_key_header() -> None:
    # Given a fake gateway that records what it received
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["api_key"] = request.headers.get("x-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"2")

    loader = GatewayBusPositionLoader("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When loading two captures
    loader.load([_capture("901008"), _capture("901011")])

    # Then exactly one request hit record-vehicle-positions with both rows and the api key
    assert seen["path"] == "/events/record-vehicle-positions"
    assert seen["api_key"] == API_KEY
    body = seen["body"]
    assert isinstance(body, dict)
    assert len(body["positions"]) == 2
    assert {p["vehicle_id"] for p in body["positions"]} == {"901008", "901011"}


def test_load_skips_the_request_entirely_when_there_is_nothing_to_load() -> None:
    # Given a fake gateway that fails the test if it's ever called
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("gateway should not be called with an empty batch")

    loader = GatewayBusPositionLoader("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When loading an empty list
    loader.load([])

    # Then no request was made (handler raising would have failed the test)
