"""Exercises flow.py's own @task/@flow wiring — not just the ETL classes
underneath it (see test_vehicle_position_archiver_steps.py for that).
Prefect flows are plain callables; calling one directly spins up a
short-lived local Prefect server for orchestration, same as running the
flow for real, just without a persistent one.
"""

# MagicMock's own __call__/attribute stubs are untyped by design —
# monkeypatching flow.py's module-level ETL classes with lambdas
# returning a MagicMock is genuinely dynamic here, not a real typing gap.
# pyright: reportUnknownArgumentType=false, reportUnknownLambdaType=false

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver import flow as flow_module
from flows.vehicle_position_archiver.schemas import VehiclePositionHistoryRow

scenarios("../features/flow_orchestration.feature")


@pytest.fixture()
def fake_loader() -> MagicMock:
    return MagicMock()


@given(
    parsers.parse("a fake GatewayHistoryExtractor returning {count:d} history rows for one vehicle")
)
def _given_fake_extractor(monkeypatch: pytest.MonkeyPatch, count: int) -> None:
    rows = [
        VehiclePositionHistoryRow(
            id=i,
            vehicle_id="B1",
            data={"speed_kmh": float(i)},
            captured_at=datetime.now(UTC) - timedelta(minutes=i),
        )
        for i in range(count)
    ]
    fake_extractor = MagicMock()
    fake_extractor.extract.return_value = rows
    monkeypatch.setattr(flow_module, "GatewayHistoryExtractor", lambda *_a, **_k: fake_extractor)


@when(parsers.parse("the vehicle_position_archiver flow runs with keep_per_vehicle {keep:d}"))
def _when_flow_runs(monkeypatch: pytest.MonkeyPatch, fake_loader: MagicMock, keep: int) -> None:
    monkeypatch.setattr(flow_module, "GatewayArchiveLoader", lambda *_a, **_k: fake_loader)
    flow_module.vehicle_position_archiver(
        gateway_url="http://fake-gateway", api_key="test-key", keep_per_vehicle=keep
    )


@then(parsers.parse("the loader received a plan archiving exactly {count:d} rows"))
def _then_loader_received(fake_loader: MagicMock, count: int) -> None:
    assert fake_loader.load.called
    plan: Any = fake_loader.load.call_args[0][0]
    assert len(plan.archived_ids) == count
