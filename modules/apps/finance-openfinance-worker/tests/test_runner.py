"""O loop de sync, com provedor e finance-api falsos."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Mapping

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_contracts import ACTION_OF_ACCOUNT_SYNCED, ACTION_REGISTER_TRANSACTION  # noqa: E402
from finance_openfinance_worker.sync.runner import Syncer  # noqa: E402


class FakePolp:
    def __init__(self, *, consent_status: str = "AUTHORISED", user_id: str = "5521") -> None:
        self._status = consent_status
        self._user = user_id
        self.tx_params: list[Mapping[str, str]] = []

    def consents(self) -> list[Mapping[str, Any]]:
        return [{"id": "c1", "status": self._status, "cliente_user_id": self._user}]

    def consent_accounts(self, _: str) -> list[Mapping[str, Any]]:
        return [{"id": "acct-1", "consent_id": "c1", "type": "CONTA_DEPOSITO_A_VISTA",
                 "branch_code": "0001", "number": "123",
                 "balance": {"available_amount": {"amount": "1500.00", "currency": "BRL"}, "updated_at": "2026-10-04T10:00:00Z"}}]

    def account_transactions(self, _: str, params=None) -> list[Mapping[str, Any]]:
        self.tx_params.append(params or {})
        return [
            {"id": "t1", "credit_debit_type": "DEBITO", "transaction_amount": {"amount": "45.00", "currency": "BRL"},
             "category_ref": "FOOD_AND_DRINK_RESTAURANT", "transaction_date_time": "2026-10-04T12:00:00Z"},
            {"id": "t2", "credit_debit_type": "CREDITO", "transaction_amount": {"amount": "3500.00", "currency": "BRL"},
             "category_ref": "INCOME_SALARY", "transaction_date_time": "2026-10-05T09:00:00Z"},
        ]


class FakeFinance:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Mapping[str, Any]]] = []

    def submit(self, action: str, payload: Mapping[str, Any]) -> dict:
        self.calls.append((action, payload))
        return {"status": "accepted"}


def test_run_once_publishes_account_and_transactions():
    finance = FakeFinance()
    polp = FakePolp()
    counts = Syncer(polp=polp, finance=finance, backfill_days=7).run_once()

    assert counts == {"consents": 1, "accounts": 1, "transactions": 2}
    actions = [a for a, _ in finance.calls]
    assert actions.count(ACTION_OF_ACCOUNT_SYNCED) == 1
    assert actions.count(ACTION_REGISTER_TRANSACTION) == 2

    account = next(p for a, p in finance.calls if a == ACTION_OF_ACCOUNT_SYNCED)
    assert account["polp_account_id"] == "acct-1"
    assert account["balance_amount"] == "1500.00"
    assert account["user_id"] == "5521"

    # A janela de busca usa updated_at (pega novas e atualizadas).
    assert "fromUpdatedAt" in polp.tx_params[0]


def test_non_authorised_consent_is_skipped():
    finance = FakeFinance()
    counts = Syncer(polp=FakePolp(consent_status="AWAITING_AUTHORIZATION"), finance=finance).run_once()
    assert counts["consents"] == 0
    assert finance.calls == []


def test_consent_without_user_is_skipped():
    finance = FakeFinance()
    counts = Syncer(polp=FakePolp(user_id=""), finance=finance).run_once()
    assert counts["accounts"] == 0
    assert finance.calls == []
