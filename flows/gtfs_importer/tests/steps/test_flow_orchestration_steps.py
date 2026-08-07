"""Exercises flow.py's own @task/@flow wiring — not just the ETL classes
underneath it (see test_extract_steps.py/test_transform_steps.py/
test_load_steps.py for those). Same shape as
flows/bus_gps_poller/tests/steps/test_flow_orchestration_steps.py.
"""

# MagicMock's own __call__/attribute stubs are untyped by design —
# monkeypatching flow.py's module-level ETL classes with lambdas
# returning a MagicMock is genuinely dynamic here, not a real typing gap.
# pyright: reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownMemberType=false

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.gtfs_importer import flow as flow_module

if TYPE_CHECKING:
    from flows.gtfs_importer.schemas import GtfsCapture

scenarios("../features/flow_orchestration.feature")


@pytest.fixture()
def fake_loader() -> MagicMock:
    return MagicMock()


@given(parsers.parse("a fake GtfsExtractor returning {count:d} well-formed stop"))
def _given_fake_extractor(monkeypatch: pytest.MonkeyPatch, count: int) -> None:
    fake_extractor = MagicMock()
    fake_extractor.extract.return_value = {
        "stops": [
            {"stop_id": f"S{i}", "stop_name": f"Stop {i}", "stop_lat": "-22.9", "stop_lon": "-43.2"}
            for i in range(count)
        ],
        "routes": [],
        "trips": [],
        "stop_times": [],
    }
    monkeypatch.setattr(flow_module, "GtfsExtractor", lambda: fake_extractor)


@when("the gtfs_importer flow runs")
def _when_flow_runs(monkeypatch: pytest.MonkeyPatch, fake_loader: MagicMock) -> None:
    monkeypatch.setattr(flow_module, "GatewayGtfsLoader", lambda *_a, **_k: fake_loader)
    flow_module.gtfs_importer(gateway_url="http://fake-gateway", api_key="test-key")


@then(parsers.parse("the loader received a capture with {count:d} stop"))
def _then_loader_received(fake_loader: MagicMock, count: int) -> None:
    assert fake_loader.load.called
    capture: GtfsCapture = fake_loader.load.call_args[0][0]
    assert len(capture.stops) == count
