# This test asserts against a raw wire-level JSON body (json.loads
# returns Any) — genuinely dynamic, not a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.brt_gps_poller.etl.load import GatewayBusPositionLoader
from flows.brt_gps_poller.schemas import BusPositionCapture

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/load.feature")

API_KEY = "test-key"


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _capture(vehicle_id: str) -> BusPositionCapture:
    return BusPositionCapture(
        mode="brt",
        line_code="35",
        vehicle_id=vehicle_id,
        latitude=-22.9,
        longitude=-43.3,
        speed_kmh=10.0,
        captured_at=datetime.now(UTC),
    )


@pytest.fixture()
def captures() -> list[BusPositionCapture]:
    return []


@pytest.fixture()
def calls() -> list[tuple[str, str, str | None]]:
    return []


@given(parsers.parse('{count:d} captures for vehicles "{v1}" and "{v2}"'))
def _given_two_captures(captures: list[BusPositionCapture], count: int, v1: str, v2: str) -> None:
    assert count == 2
    captures.extend([_capture(v1), _capture(v2)])


@given("no captures")
def _given_no_captures() -> None:
    return


@when("the batch is loaded", target_fixture="request_bodies")
def _when_batch_loaded(
    captures: list[BusPositionCapture], calls: list[tuple[str, str, str | None]]
) -> list[dict[str, object]]:
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.headers.get("x-api-key")))
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=b"2")

    loader = GatewayBusPositionLoader("https://gateway.example", API_KEY, _fake_gateway(handler))
    loader.load(captures)
    return bodies


@then(parsers.parse('exactly {count:d} request was made to "{path}"'))
def _then_exactly_one_request(
    calls: list[tuple[str, str, str | None]], count: int, path: str
) -> None:
    matching = [c for c in calls if c[1] == path]
    assert len(matching) == count


@then("the request carried the API key")
def _then_carried_api_key(calls: list[tuple[str, str, str | None]]) -> None:
    assert calls[0][2] == API_KEY


@then("the request body contains both vehicle ids")
def _then_body_contains_both(request_bodies: list[dict[str, object]]) -> None:
    body = request_bodies[0]
    positions = body["positions"]
    assert isinstance(positions, list)
    assert {p["vehicle_id"] for p in positions} == {"901008", "901011"}


@then("no request was made")
def _then_no_request(calls: list[tuple[str, str, str | None]]) -> None:
    assert calls == []
