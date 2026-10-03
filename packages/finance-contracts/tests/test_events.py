"""Event shape: idempotency keys and the versioned schema."""

from __future__ import annotations

from finance_contracts import (
    EVENT_BUDGET_THRESHOLD_REACHED,
    EVENT_SCHEMA_VERSION,
    BudgetThresholdReached,
    DomainEvent,
)


def test_event_wire_shape_is_versioned_and_commands_attributed() -> None:
    ev = DomainEvent(
        event_id="e-1",
        command_id="c-1",
        event_type="finance.transaction.registered",
        occurred_at="2026-10-03T12:00:00+00:00",
        payload={"entity_id": "tx-9"},
    )
    assert ev.to_wire() == {
        "event_id": "e-1",
        "command_id": "c-1",
        "event_type": "finance.transaction.registered",
        "occurred_at": "2026-10-03T12:00:00+00:00",
        "schema_version": "1",
        "payload": {"entity_id": "tx-9"},
    }


def test_event_carries_both_ids_for_at_least_once_delivery() -> None:
    ev = DomainEvent("e-1", "c-1", "finance.x.y", "2026-10-03T12:00:00+00:00", {})
    wire = ev.to_wire()
    assert wire["event_id"] and wire["command_id"]
    assert wire["schema_version"] == EVENT_SCHEMA_VERSION == "1"


def test_budget_threshold_key_is_idempotent_per_threshold_per_period() -> None:
    alert = BudgetThresholdReached(
        budget_id="b-1",
        category="Alimentacao",
        threshold=80,
        period="2026-10",
        spent_amount="80.00",
        limit_amount="100.00",
        currency="BRL",
    )
    assert alert.idempotency_key() == "b-1:80:2026-10"
    # Same threshold, next period -> a NEW key: the ruler fires again.
    next_month = BudgetThresholdReached("b-1", "Alimentacao", 80, "2026-11", "0", "100.00", "BRL")
    assert next_month.idempotency_key() != alert.idempotency_key()
    # A different threshold is a different firing.
    other = BudgetThresholdReached("b-1", "Alimentacao", 100, "2026-10", "100.00", "100.00", "BRL")
    assert other.idempotency_key() != alert.idempotency_key()


def test_budget_threshold_event_type_is_named() -> None:
    assert EVENT_BUDGET_THRESHOLD_REACHED == "finance.budget.thresholdReached"
    alert = BudgetThresholdReached("b-1", "Alimentacao", 50, "2026-10", "50.00", "100.00", "BRL")
    payload = alert.to_payload()
    assert payload["threshold"] == 50
    # Money crosses the wire as an exact decimal string, never as a float.
    assert payload["spent_amount"] == "50.00"
    assert isinstance(payload["spent_amount"], str)
