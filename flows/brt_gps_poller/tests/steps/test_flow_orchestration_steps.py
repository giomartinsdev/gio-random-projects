"""Exercises flow.py's own @task/@flow wiring — not just the ETL classes
underneath it (see test_brt_gps_poller_steps.py for that). Prefect flows
are plain callables; calling one directly spins up a short-lived local
Prefect server for orchestration, same as running the flow for real,
just without a persistent one.
"""

# MagicMock's own __call__/attribute stubs are untyped by design —
# monkeypatching flow.py's module-level ETL classes with lambdas
# returning a MagicMock is genuinely dynamic here, not a real typing gap.
# pyright: reportUnknownArgumentType=false, reportUnknownLambdaType=false

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.brt_gps_poller import flow as flow_module

scenarios("../features/flow_orchestration.feature")


@pytest.fixture()
def fake_loader() -> MagicMock:
    return MagicMock()


@given(parsers.parse("a fake BrtExtractor returning {count:d} well-formed row"))
def _given_fake_extractor(monkeypatch: pytest.MonkeyPatch, count: int) -> None:
    fake_extractor = MagicMock()
    fake_extractor.extract.return_value = [
        {
            "codigo": str(i),
            "linha": "35",
            "latitude": -22.9,
            "longitude": -43.3,
            "velocidade": 10,
            "dataHora": "1785974352000",
        }
        for i in range(count)
    ]
    monkeypatch.setattr(flow_module, "BrtExtractor", lambda: fake_extractor)


@when("the brt_gps_poller flow runs")
def _when_flow_runs(monkeypatch: pytest.MonkeyPatch, fake_loader: MagicMock) -> None:
    monkeypatch.setattr(flow_module, "GatewayBusPositionLoader", lambda *_a, **_k: fake_loader)
    flow_module.brt_gps_poller(gateway_url="http://fake-gateway", api_key="test-key")


@then(parsers.parse("the loader received exactly {count:d} position"))
def _then_loader_received(fake_loader: MagicMock, count: int) -> None:
    assert fake_loader.load.called
    loaded: list[Any] = fake_loader.load.call_args[0][0]
    assert len(loaded) == count
