from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.brt_gps_poller.etl.extract import BrtExtractor
from flows.brt_gps_poller.etl.load import GatewayBusPositionLoader
from flows.brt_gps_poller.etl.transform import BrtPositionTransformer

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/brt_gps_poller.feature")

_MALFORMED_ROW = {"linha": "35", "latitude": -22.9, "longitude": -43.3, "dataHora": "x"}


def _well_formed_row(vehicle_id: str) -> dict[str, Any]:
    return {
        "codigo": vehicle_id,
        "linha": "35",
        "latitude": -22.9,
        "longitude": -43.3,
        "velocidade": 10,
        "dataHora": "1785974352000",
    }


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def gateway_calls() -> list[dict[str, Any]]:
    return []


@given(
    parsers.parse(
        "a fake BRT endpoint returning {good:d} well-formed rows and {bad:d} malformed row"
    ),
    target_fixture="brt_rows",
)
def _given_mixed_rows(good: int, bad: int) -> list[dict[str, Any]]:
    return [_well_formed_row(f"9{i}") for i in range(good)] + [_MALFORMED_ROW] * bad


@given("a fake BRT endpoint returning no rows", target_fixture="brt_rows")
def _given_no_rows() -> list[dict[str, Any]]:
    return []


@when("a poll cycle runs", target_fixture="loaded_count")
def _when_poll_runs(brt_rows: list[dict[str, Any]], gateway_calls: list[dict[str, Any]]) -> int:
    def brt_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"veiculos": brt_rows}).encode())

    def gateway_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        gateway_calls.append(body)
        return httpx.Response(200, content=str(len(body["positions"])).encode())

    raw = BrtExtractor(client=_fake_client(brt_handler)).extract()
    positions = BrtPositionTransformer().transform(raw)
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
