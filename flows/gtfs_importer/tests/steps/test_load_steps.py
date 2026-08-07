from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.gtfs_importer.etl.load import GatewayGtfsLoader
from flows.gtfs_importer.schemas import GtfsCapture, LineCapture, RouteStopCapture, StopCapture

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/load.feature")


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def requests_seen() -> list[httpx.Request]:
    return []


@given("a fake gateway")
def _given_fake_gateway() -> None:
    pass


@given(
    parsers.parse("a capture with {stops:d} stop, {lines:d} line, and {route_stops:d} route-stop"),
    target_fixture="capture",
)
def _given_capture(stops: int, lines: int, route_stops: int) -> GtfsCapture:
    return GtfsCapture(
        stops=[
            StopCapture(id=f"S{i}", name=f"Stop {i}", latitude=-22.9, longitude=-43.2)
            for i in range(stops)
        ],
        lines=[
            LineCapture(id=f"L{i}", code=f"L{i}", name=f"Line {i}", mode="bus")
            for i in range(lines)
        ],
        route_stops=[
            RouteStopCapture(line_id="L0", stop_id=f"S{i}", direction_id=0, sequence=i)
            for i in range(route_stops)
        ],
    )


@given(
    parsers.parse('a capture with lines "{l1}" and "{l2}" but route-stops only for "{only}"'),
    target_fixture="capture",
)
def _given_capture_partial_route_stops(l1: str, l2: str, only: str) -> GtfsCapture:
    return GtfsCapture(
        stops=[],
        lines=[
            LineCapture(id=l1, code=l1, name=l1, mode="bus"),
            LineCapture(id=l2, code=l2, name=l2, mode="bus"),
        ],
        route_stops=[RouteStopCapture(line_id=only, stop_id="S0", direction_id=0, sequence=0)],
    )


@when("the capture is loaded")
def _when_loaded(capture: GtfsCapture, requests_seen: list[httpx.Request]) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return httpx.Response(200, json=0)

    loader = GatewayGtfsLoader("http://fake-gateway", "test-key", client=_fake_client(handler))
    loader.load(capture)


@then(parsers.parse("exactly {count:d} requests were made"))
def _then_request_count(requests_seen: list[httpx.Request], count: int) -> None:
    assert len(requests_seen) == count


@then(parsers.parse('the requests were, in order, "{p1}", "{p2}", "{p3}"'))
def _then_request_order(requests_seen: list[httpx.Request], p1: str, p2: str, p3: str) -> None:
    paths = [str(request.url).rsplit("/", maxsplit=1)[-1] for request in requests_seen]
    assert paths == [p1, p2, p3]


@then(parsers.parse('the replace-route-stops request\'s line_ids are "{l1}" and "{l2}"'))
def _then_replace_line_ids(requests_seen: list[httpx.Request], l1: str, l2: str) -> None:
    replace_request = next(r for r in requests_seen if str(r.url).endswith("replace-route-stops"))
    body: dict[str, Any] = json.loads(replace_request.content)
    assert body["line_ids"] == [l1, l2]
