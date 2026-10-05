"""The §3.4 invariants the ACL owns, each with the case that breaks it.

These are the tests that would fail on the *old*, broken behaviour -- a
float amount quietly becoming inexact, a naive timestamp being assumed to
be UTC, a transfer silently spanning two users, a budget ruler firing twice.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from finance_api.application.commands import CommandRouter
from finance_api.domain.commands import (
    BudgetPeriodState,
    RegisterTransactionCommand,
    SetCategoryBudgetCommand,
    TransferBetweenAccountsCommand,
)
from finance_api.domain.errors import ValidationError
from finance_api.domain.money import Money, MoneyError, sum_money, to_decimal
from finance_api.domain.occurred_at import TimestampError, parse_occurred_at
from finance_contracts import ACTION_REGISTER_TRANSACTION

BASE = {
    "user_id": "user-1",
    "account_id": "acct-1",
    "transaction_type": "EXPENSE",
    "category": "Alimentacao",
    "occurred_at": "2026-10-03T09:00:00-03:00",
}


# ------------------------------------------- #1 Money is never a float

def test_float_amount_is_refused_not_rounded() -> None:
    with pytest.raises(MoneyError):
        to_decimal(45.0)


def test_bool_is_not_an_amount() -> None:
    # bool is an int subclass; `True` would otherwise sail through as 1.
    with pytest.raises(MoneyError):
        to_decimal(True)


def test_integer_amount_is_exact() -> None:
    assert to_decimal(45) == Decimal("45")


def test_exact_sums_of_decimals_where_floats_drift() -> None:
    total = sum_money(
        [Money.from_wire("0.1", "BRL"), Money.from_wire("0.2", "BRL")], "BRL"
    )
    assert total.to_wire() == "0.3"
    assert total.amount == Decimal("0.3")
    # The bug this prevents, stated as a fact about float arithmetic:
    assert 0.1 + 0.2 != 0.3


def test_money_crosses_the_wire_as_a_string_not_a_number() -> None:
    wire = Money.from_wire("45.00", "BRL").to_wire()
    assert isinstance(wire, str)
    # A JSON number would be re-parsed as float on the far side.
    assert wire == "45.00"


def test_adding_different_currencies_is_refused() -> None:
    with pytest.raises(MoneyError):
        Money(Decimal("1"), "BRL") + Money(Decimal("1"), "USD")


def test_non_finite_amounts_are_refused() -> None:
    for bad in ("NaN", "Infinity", "-Infinity"):
        with pytest.raises(MoneyError):
            Money.from_wire(bad, "BRL")


def test_currency_must_be_a_three_letter_code() -> None:
    for bad in ("BR", "BRLL", "12"):
        with pytest.raises(MoneyError):
            Money(Decimal("1"), bad)


def test_money_is_immutable() -> None:
    money = Money.from_wire("45.00", "BRL")
    with pytest.raises(Exception):
        money.amount = Decimal("0")  # type: ignore[misc]


# ------------------------------- #4 OccurredAt tz-aware, stored in UTC

def test_naive_timestamp_is_refused() -> None:
    with pytest.raises(TimestampError) as excinfo:
        parse_occurred_at("2026-10-03T09:00:00")
    assert "timezone-aware" in str(excinfo.value)


def test_naive_datetime_object_is_refused() -> None:
    with pytest.raises(TimestampError):
        parse_occurred_at(datetime(2026, 10, 3, 9, 0, 0))


def test_offset_is_normalised_to_utc() -> None:
    # 09:00 in São Paulo is 12:00 UTC. Getting this wrong shifts every
    # report by three hours and looks fine in a UTC-only test.
    moment = parse_occurred_at("2026-10-03T09:00:00-03:00")
    assert moment.utcoffset() == timedelta(0)
    assert moment.hour == 12


def test_zulu_suffix_is_accepted_and_is_utc() -> None:
    moment = parse_occurred_at("2026-10-03T12:00:00Z")
    assert moment == datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def test_aware_datetime_objects_pass_through_to_utc() -> None:
    moment = parse_occurred_at(datetime(2026, 10, 3, 9, 0, tzinfo=timezone(timedelta(hours=-3))))
    assert moment == datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def test_garbage_timestamp_is_refused() -> None:
    with pytest.raises(TimestampError):
        parse_occurred_at("ontem de manhã")


# ------------------------------------------- #2 and #3 transfer semantics

def transfer_payload(**overrides: object) -> dict:
    payload = {
        "user_id": "user-1",
        "from_account_id": "acct-1",
        "to_account_id": "acct-2",
        "amount": "100.00",
        "currency": "BRL",
        "occurred_at": "2026-10-03T09:00:00-03:00",
        "account_owners": {"acct-1": "user-1", "acct-2": "user-1"},
    }
    payload.update(overrides)
    return payload


def test_transfer_payload_carries_both_legs_in_one_object() -> None:
    # #2: there is no representable "just the debit". Both legs travel as
    # one command, which is what lets the worker apply them atomically.
    command = TransferBetweenAccountsCommand.from_payload(transfer_payload())
    payload = command.to_payload()
    assert payload["from_account_id"] == "acct-1"
    assert payload["to_account_id"] == "acct-2"
    assert payload["amount"] == "100.00"


def test_transfer_across_users_is_refused() -> None:
    # #3: a mixed-owner transfer never reaches the wire.
    payload = transfer_payload(account_owners={"acct-1": "user-1", "acct-2": "user-2"})
    with pytest.raises(ValidationError) as excinfo:
        TransferBetweenAccountsCommand.from_payload(payload)
    assert "across users" in str(excinfo.value) or "may not move money" in str(excinfo.value)


def test_transfer_without_an_owner_map_is_refused() -> None:
    # Isolation must be *proved*, not assumed: without the owner map the
    # ACL cannot claim both accounts are the same user's.
    payload = transfer_payload()
    del payload["account_owners"]
    with pytest.raises(ValidationError) as excinfo:
        TransferBetweenAccountsCommand.from_payload(payload)
    assert "account_owners is required" in str(excinfo.value)


def test_transfer_to_the_same_account_is_refused() -> None:
    with pytest.raises(ValidationError) as excinfo:
        TransferBetweenAccountsCommand.from_payload(
            transfer_payload(to_account_id="acct-1")
        )
    assert "must differ" in str(excinfo.value)


def test_transfer_of_a_non_positive_amount_is_refused() -> None:
    for bad in ("0", "-10.00"):
        with pytest.raises(ValidationError):
            TransferBetweenAccountsCommand.from_payload(transfer_payload(amount=bad))


def test_transfer_account_missing_from_the_owner_map_is_refused() -> None:
    with pytest.raises(ValidationError):
        TransferBetweenAccountsCommand.from_payload(
            transfer_payload(account_owners={"acct-1": "user-1"})
        )


# ------------------------------------------------ #5 budget ruler fires once

def test_ruler_fires_once_per_threshold_per_period() -> None:
    state = BudgetPeriodState("budget-1", "2026-10", Decimal("100"), Decimal("85"))
    assert state.thresholds_to_fire() == (50, 80)

    after = state.after_firing(80)
    # A second gasto past 80% in the same period must NOT alert again.
    assert 80 not in after.thresholds_to_fire()


def test_replaying_the_same_crossing_does_not_refire() -> None:
    state = BudgetPeriodState("budget-1", "2026-10", Decimal("100"), Decimal("85"))
    fired = state.after_firing(80).after_firing(80)
    assert 80 not in fired.thresholds_to_fire()


def test_a_new_period_fires_again() -> None:
    next_period = BudgetPeriodState("budget-1", "2026-11", Decimal("100"), Decimal("85"))
    assert 50 in next_period.thresholds_to_fire()


def test_thresholds_above_the_spend_do_not_fire() -> None:
    state = BudgetPeriodState("budget-1", "2026-10", Decimal("100"), Decimal("40"))
    assert state.thresholds_to_fire() == ()


def test_all_three_ruler_steps_fire_in_order_at_full_spend() -> None:
    state = BudgetPeriodState("budget-1", "2026-10", Decimal("100"), Decimal("100"))
    assert state.thresholds_to_fire() == (50, 80, 100)


def test_budget_payload_is_exact_money_with_a_valid_period() -> None:
    command = SetCategoryBudgetCommand.from_payload(
        {"user_id": "u", "category": "Alimentacao", "limit": "100.00", "currency": "BRL", "period": "2026-10"}
    )
    payload = command.to_payload()
    assert payload["limit"] == "100.00"
    assert payload["thresholds"] == [50, 80, 100]


def test_budget_with_a_malformed_period_is_refused() -> None:
    for bad in ("2026-10-03", "2026/10", "outubro"):
        with pytest.raises(ValidationError):
            SetCategoryBudgetCommand.from_payload(
                {"user_id": "u", "category": "c", "limit": "10.00", "currency": "BRL", "period": bad}
            )


def test_budget_with_an_undocumented_threshold_is_refused() -> None:
    with pytest.raises(ValidationError):
        SetCategoryBudgetCommand.from_payload(
            {
                "user_id": "u",
                "category": "c",
                "limit": "10.00",
                "currency": "BRL",
                "period": "2026-10",
                "thresholds": [50, 75],
            }
        )


# ------------------------------------------------------ command validation

def test_register_rejects_an_unknown_transaction_type() -> None:
    with pytest.raises(ValidationError):
        RegisterTransactionCommand.from_payload(
            dict(BASE, transaction_type="MAYBE", amount="1.00", currency="BRL")
        )


def test_register_rejects_an_unknown_source() -> None:
    with pytest.raises(ValidationError):
        RegisterTransactionCommand.from_payload(
            dict(BASE, amount="1.00", currency="BRL", source_type="TELEPATHY")
        )


def test_register_accepts_the_web_channel_source() -> None:
    # O SPA manda WEB_MANUAL; é um lançamento manual legítimo, distinto do
    # WhatsApp só para o extrato dizer de onde veio.
    cmd = RegisterTransactionCommand.from_payload(
        dict(BASE, amount="1.00", currency="BRL", source_type="WEB_MANUAL")
    )
    assert cmd.source_type == "WEB_MANUAL"


def test_register_requires_a_user_and_an_account() -> None:
    for missing in ("user_id", "account_id", "category"):
        payload = dict(BASE, amount="1.00", currency="BRL")
        payload.pop(missing)
        with pytest.raises(ValidationError):
            RegisterTransactionCommand.from_payload(payload)


def test_register_normalises_the_timestamp_into_the_payload() -> None:
    command = RegisterTransactionCommand.from_payload(
        dict(BASE, amount="45.00", currency="BRL")
    )
    assert command.to_payload()["occurred_at"] == "2026-10-03T12:00:00+00:00"


def test_register_accepts_a_negative_income_amount_field_as_given() -> None:
    # The sign is the caller's data; the ACL's job is to keep it exact, not
    # to silently flip it. Type/amount sign semantics belong to the worker.
    command = RegisterTransactionCommand.from_payload(
        dict(BASE, amount="-45.00", currency="BRL", transaction_type="INCOME")
    )
    assert command.to_payload()["amount"] == "-45.00"


# ---------------------------------------------------- router envelope shape

def test_router_builds_the_house_envelope() -> None:
    router = CommandRouter(domain_api=_NullPort())
    envelope = router.build_envelope(
        ACTION_REGISTER_TRANSACTION, dict(BASE, amount="45.00", currency="BRL")
    )
    assert envelope.to_wire()["action"] == ACTION_REGISTER_TRANSACTION
    assert set(envelope.to_wire()) == {"action", "payload"}


def test_router_refuses_an_unknown_action_without_touching_the_port() -> None:
    port = _NullPort()
    with pytest.raises(ValidationError):
        CommandRouter(domain_api=port).build_envelope("finance.unknown", {})
    assert port.calls == []


def test_router_refuses_a_non_object_payload() -> None:
    with pytest.raises(ValidationError):
        CommandRouter(domain_api=_NullPort()).build_envelope(
            ACTION_REGISTER_TRANSACTION, "not-an-object"  # type: ignore[arg-type]
        )


class _NullPort:
    """A port that records calls and returns nothing usable."""

    def __init__(self) -> None:
        self.calls: list[object] = []

    def send_async(self, envelope: object) -> object:
        self.calls.append(envelope)
        raise AssertionError("send_async must not be reached")

    def send_sync(self, envelope: object) -> object:
        self.calls.append(envelope)
        raise AssertionError("send_sync must not be reached")


# ------------------------------------------------------------- update/remove

def test_update_transaction_accepts_partial_patch_and_abs_amount() -> None:
    from finance_api.domain.commands import UpdateTransactionCommand

    cmd = UpdateTransactionCommand.from_payload(
        {
            "user_id": "5511000000000",
            "transaction_id": "01HX",
            "amount": "-45.00",  # negativo chega aqui? a UI manda absoluto; a borda absolui
            "transaction_type": "EXPENSE",
        }
    )
    payload = cmd.to_payload()
    assert payload["amount"] == "45.00"  # absoluto, sinal decidido no worker
    assert payload["transaction_type"] == "EXPENSE"
    assert "occurred_at" not in payload  # não veio — patch parcial


def test_update_transaction_requires_all_owner_fields() -> None:
    import pytest

    from finance_api.domain.commands import UpdateTransactionCommand
    from finance_api.domain.errors import ValidationError

    with pytest.raises(ValidationError):
        UpdateTransactionCommand.from_payload({"transaction_id": "x"})


def test_remove_transaction_round_trips() -> None:
    from finance_api.domain.commands import RemoveTransactionCommand

    cmd = RemoveTransactionCommand.from_payload(
        {"user_id": "5511000000000", "transaction_id": "01HX"}
    )
    assert cmd.to_payload() == {"user_id": "5511000000000", "transaction_id": "01HX"}


def test_acl_routes_update_and_remove_actions() -> None:
    from finance_api.application.commands import known_write_actions

    names = set(known_write_actions())
    assert "finance.transaction.update" in names
    assert "finance.transaction.remove" in names


# ------------------------------------------------------------------ webhook


# ------------------------------------------------------------------ webhook

def test_webhook_hmac_signature_valid_and_invalid(monkeypatch) -> None:
    import hashlib
    import hmac as _h
    import os

    from fastapi.testclient import TestClient

    from finance_api.application.ports import DomainApiPort
    from finance_api.presentation import openfinanceroutes as routes
    from finance_api.presentation.app import create_app
    from finance_api.presentation.dependencies import Container

    class _Fake:
        status_code = 200

    calls = []

    def fake_post(url, timeout):
        calls.append(url)
        return _Fake()

    monkeypatch.setattr(routes.httpx, "post", fake_post)
    monkeypatch.setenv("OF_TICK_BASE_URL", "http://tick:8088")
    monkeypatch.setenv("OF_WEBHOOK_SECRET", "sekret123")

    class _Router:
        def build_envelope(self, *a, **k): ...

    container = Container(router=_Router(), api_keys={"k": "test"})
    app = create_app(container)
    client = TestClient(app)

    body = b'{"event": "accounts.transactions"}'
    good = _h.new(b"sekret123", body, hashlib.sha256).hexdigest()
    bad = _h.new(b"outro", body, hashlib.sha256).hexdigest()

    r_ok = client.post(
        "/openfinance/webhooks/polp/sekret123",
        content=body,
        headers={"X-Webhook-Signature": good, "Content-Type": "application/json"},
    )
    assert r_ok.status_code == 202, r_ok.text
    assert r_ok.json()["mode"] == "tick"
    assert calls == ["http://tick:8088/tick/sekret123"]

    r_bad = client.post(
        "/openfinance/webhooks/polp/sekret123",
        content=body,
        headers={"X-Webhook-Signature": bad, "Content-Type": "application/json"},
    )
    assert r_bad.status_code == 404
    assert calls == ["http://tick:8088/tick/sekret123"], "assinatura errada não pode tocar o conector"

    # sem assinatura (probe): frescor mesmo assim
    r_bare = client.post("/openfinance/webhooks/polp/sekret123", content=b"{}")
    assert r_bare.status_code == 202

    # segredo do caminho errado: 404
    r_path = client.post("/openfinance/webhooks/polp/wrong", content=b"{}")
    assert r_path.status_code == 404
