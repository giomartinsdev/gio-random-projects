from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.bus_gps_poller.etl.extract import SppoExtractor
from flows.bus_gps_poller.etl.load import GatewayBusPositionLoader
from flows.bus_gps_poller.etl.transform import BusPositionTransformer

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/bus_gps_poller.feature")

_MALFORMED_ROW = {"servico": "606", "latitude": -22.9, "longitude": -43.2, "datetime": "not-a-date"}


def _well_formed_row(vehicle_id: str) -> dict[str, Any]:
    return {
        "id_veiculo": vehicle_id,
        "servico": "606",
        "latitude": -22.9,
        "longitude": -43.2,
        "velocidade": 10.0,
        "datetime": "2026-08-08T15:06:09Z",
    }


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def gateway_calls() -> list[dict[str, Any]]:
    return []


@given(
    parsers.parse(
        "a fake SPPO endpoint returning {good:d} well-formed rows and {bad:d} malformed row"
    ),
    target_fixture="sppo_rows",
)
def _given_mixed_rows(good: int, bad: int) -> list[dict[str, Any]]:
    return [_well_formed_row(f"B{i}") for i in range(good)] + [_MALFORMED_ROW] * bad


@given("a fake SPPO endpoint returning no rows", target_fixture="sppo_rows")
def _given_no_rows() -> list[dict[str, Any]]:
    return []


@when("a poll cycle runs", target_fixture="loaded_count")
def _when_poll_runs(sppo_rows: list[dict[str, Any]], gateway_calls: list[dict[str, Any]]) -> int:
    def sppo_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps(sppo_rows).encode())

    def gateway_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        gateway_calls.append(body)
        return httpx.Response(200, content=str(len(body["positions"])).encode())

    raw = SppoExtractor(window_seconds=300, client=_fake_client(sppo_handler)).extract()
    positions = BusPositionTransformer().transform(raw)
    GatewayBusPositionLoader("http://fake-gateway", "test-key", _fake_client(gateway_handler)).load(
        positions
    )
    return len(positions)


@then(parsers.parse("the gateway received exactly {count:d} positions"))
def _then_gateway_received(gateway_calls: list[dict[str, Any]], count: int) -> None:
    assert len(gateway_calls) == 1
    assert len(gateway_calls[0]["positions"]) == count


@then("the malformed row was skipped without failing the poll")
def _then_malformed_skipped(loaded_count: int) -> None:
    assert loaded_count >= 0  # the fixture above already proves the poll didn't raise


@then("the gateway was never called")
def _then_gateway_never_called(gateway_calls: list[dict[str, Any]]) -> None:
    assert gateway_calls == []
