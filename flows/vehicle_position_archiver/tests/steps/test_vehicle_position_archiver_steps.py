from __future__ import annotations

import httpx
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.client import GatewayClient

scenarios("../features/vehicle_position_archiver.feature")


@given(
    parsers.parse("a fake gateway that archives {count:d} rows"), target_fixture="gateway_client"
)
def _given_fake_gateway(count: int) -> GatewayClient:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=str(count).encode())

    fake = httpx.Client(transport=httpx.MockTransport(handler))
    return GatewayClient(base_url="http://fake-gateway", api_key="test-key", client=fake)


@when("the archiver runs", target_fixture="archived_count")
def _when_archiver_runs(gateway_client: GatewayClient) -> int:
    return gateway_client.archive_vehicle_position_history()


@then(parsers.parse("it reports {count:d} rows archived"))
def _then_reports_count(archived_count: int, count: int) -> None:
    assert archived_count == count
