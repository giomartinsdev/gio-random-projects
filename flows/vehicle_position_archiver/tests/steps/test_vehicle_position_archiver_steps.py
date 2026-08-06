from __future__ import annotations

import httpx
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader

scenarios("../features/vehicle_position_archiver.feature")

_ArchiverSetup = tuple[GatewayArchiveLoader, list[str]]


@given(
    parsers.parse("a fake gateway that archives {count:d} rows"), target_fixture="archiver_setup"
)
def _given_fake_gateway(count: int) -> _ArchiverSetup:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, content=str(count).encode())

    loader = GatewayArchiveLoader(
        gateway_url="http://fake-gateway",
        api_key="test-key",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    return loader, calls


@when("the archiver runs")
def _when_archiver_runs(archiver_setup: _ArchiverSetup) -> None:
    loader, _calls = archiver_setup
    loader.load(None)


@then("the gateway received the archive event")
def _then_gateway_received_the_archive_event(archiver_setup: _ArchiverSetup) -> None:
    _loader, calls = archiver_setup
    assert calls == ["/events/archive-vehicle-position-history"]
