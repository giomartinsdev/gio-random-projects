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
        self.investments_called = False

    def consents(self) -> list[Mapping[str, Any]]:
        return [{"id": "c1", "status": self._status, "cliente_user_id": self._user}]

    def consent_accounts(self, _: str) -> list[Mapping[str, Any]]:
        return [{"id": "acct-1", "consent_id": "c1", "type": "CONTA_DEPOSITO_A_VISTA",
                 "branch_code": "0001", "number": "123",
                 "balance": {"available_amount": {"amount": "1500.00", "currency": "BRL"}, "updated_at": "2026-10-04T10:00:00Z"}}]

    def investments(self, _: str) -> list[Mapping[str, Any]]:
        self.investments_called = True
        return []

    def investment_transactions(self, _: str, *, family: str = "") -> list[Mapping[str, Any]]:
        return []

    def credit_cards(self, _: str) -> list[Mapping[str, Any]]:
        return []

    def bills(self, _: str) -> list[Mapping[str, Any]]:
        return []

    def loans(self, _: str) -> list[Mapping[str, Any]]:
        return []

    def financings(self, _: str) -> list[Mapping[str, Any]]:
        return []

    def exchanges(self, _: str) -> list[Mapping[str, Any]]:
        return []

    def account_reserved_balances(self, _: str) -> list[Mapping[str, Any]]:
        return []

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

    assert counts == {
        "consents": 1, "accounts": 1, "transactions": 2, "investments": 0,
        "credit_cards": 0, "bills": 0, "loans": 0, "financings": 0,
        "exchanges": 0, "investment_transactions": 0, "raw": 4,
    }
    actions = [a for a, _ in finance.calls]
    assert actions.count(ACTION_OF_ACCOUNT_SYNCED) == 1
    assert actions.count(ACTION_REGISTER_TRANSACTION) == 2

    account = next(p for a, p in finance.calls if a == ACTION_OF_ACCOUNT_SYNCED)
    assert account["polp_account_id"] == "acct-1"
    assert account["balance_amount"] == "1500.00"
    assert account["user_id"] == "5521"

    # A PRIMEIRA passada é o backfill: janela por DATA e transações marcadas
    # historical=True (silenciosas).
    assert "fromDate" in polp.tx_params[0]
    assert all(c["historical"] is True for a, c in finance.calls if a == ACTION_REGISTER_TRANSACTION)


def test_second_pass_is_incremental_and_notifies():
    # Depois do backfill, o incremental filtra por created_at e NÃO marca
    # historical — é o dia a dia, que notifica.
    finance = FakeFinance()
    polp = FakePolp()
    syncer = Syncer(polp=polp, finance=finance, backfill_days=7)
    syncer.run_once()  # backfill
    finance.calls.clear()
    syncer.run_once()  # incremental
    assert "fromCreatedAt" in polp.tx_params[-1]
    assert all(c["historical"] is False for a, c in finance.calls if a == ACTION_REGISTER_TRANSACTION)


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


def test_investments_are_republished_every_pass_for_the_backfill():
    # O "passado" volta sozinho: não há guarda de "já visto" para investimentos
    # (diferente de contas/transações), então cada poll reenvia todas as posições
    # e o upsert por polp_invest_id é idempotente. É isto que preenche o
    # histórico que ficou preso no 422 da ACL.
    from finance_contracts import ACTION_INVESTMENT_SYNCED

    class WithInvestments(FakePolp):
        def investments(self, _: str) -> list[Mapping[str, Any]]:
            self.investments_called = True
            return [
                {
                    "_family": "bank-fixed-incomes",
                    "id": "inv-1",
                    "product_name": "CDB Itaú",
                    "balance": {
                        "quantity": "10",
                        "purchase_unit_price": {"amount": "100.00"},
                        "gross_amount": {"amount": "1050.00"},
                        "net_amount": {"amount": "1040.00"},
                        "income_tax": {"amount": "10.00"},
                        "financial_transaction_tax": {"amount": "0.00"},
                        "updated_at": "2026-10-05T00:00:00Z",
                    },
                }
            ]

    finance = FakeFinance()
    polp = WithInvestments()
    syncer = Syncer(polp=polp, finance=finance, backfill_days=7)

    counts = syncer.run_once()
    assert counts["investments"] == 1
    # Segunda passada: reenvia (o passado se recupera), não só o delta.
    counts = syncer.run_once()
    assert counts["investments"] == 1
    published = [p for a, p in finance.calls if a == ACTION_INVESTMENT_SYNCED]
    assert [p["polp_invest_id"] for p in published] == ["inv-1", "inv-1"]


# o tick server: segredo no caminho + corpo ignorado + sync serializado
import threading
import time
import urllib.error
import urllib.request

from finance_openfinance_worker.tick_server import start_tick_server


class _Server:
    def __enter__(self):
        self.syncs: list[int] = []
        self.lock = threading.Lock()

        def sync():
            with self.lock:
                self.syncs.append(1)
            time.sleep(0.1)  # deixa a corrida acontecer
            return {"transactions": len(self.syncs)}

        self.server = start_tick_server("127.0.0.1:18091", "sek", sync)
        time.sleep(0.2)
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        return False


def test_tick_runs_sync_and_secret_gates():
    with _Server() as s:
        r = urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:18091/tick/sek", method="POST", data=b"anything"))
        assert r.status == 200
        assert "accepted" in r.read().decode()
        # o sync roda em thread: aguardar concluir antes do assert de contagem
        for _ in range(50):
            if s.syncs:
                break
            time.sleep(0.05)
        assert len(s.syncs) >= 1
        try:
            urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:18091/tick/wrong", method="POST", data=b"{}"))
            raise AssertionError("segredo errado devia ser 404")
        except urllib.error.HTTPError as e:
            assert e.code == 404
        assert len(s.syncs) == 1


def test_no_secret_means_no_server():
    from finance_openfinance_worker.tick_server import start_tick_server as st
    assert st("127.0.0.1:18092", "", lambda: {}) is None
