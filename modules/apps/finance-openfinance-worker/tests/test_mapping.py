"""Mapeamento da transação do banco para o comando do ledger (função pura)."""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_openfinance_worker.sync.mapping import (  # noqa: E402
    amount_decimal,
    map_category,
    occurred_at_iso,
    transaction_to_command,
)


def test_category_mapping():
    assert map_category("FOOD_AND_DRINK_RESTAURANT") == "Alimentação"
    assert map_category("TRANSPORTATION_TAXIS_AND_RIDE_SHARES") == "Transporte"
    assert map_category("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY") == "Contas"
    assert map_category("INCOME_SALARY") == "Renda Extra"
    assert map_category("SOMETHING_WEIRD") == "Outros"
    assert map_category(None) == "Outros"


def test_amount_is_decimal_string_module():
    assert amount_decimal({"amount": "45.00", "currency": "BRL"}) == "45.00"
    assert amount_decimal({"amount": "1500", "currency": "BRL"}) == "1500.00"
    assert amount_decimal(None) == "0.00"


def test_occurred_at_is_tz_aware_utc():
    assert occurred_at_iso("2026-10-04T12:00:00Z").endswith("+00:00")
    # naive do provedor assume UTC
    assert "+00:00" in occurred_at_iso("2026-10-04T12:00:00")


def test_expense_vs_income_by_credit_debit():
    debit = transaction_to_command(
        {"id": "t1", "credit_debit_type": "DEBITO", "transaction_amount": {"amount": "45.00", "currency": "BRL"},
         "category_ref": "FOOD_AND_DRINK_RESTAURANT", "transaction_date_time": "2026-10-04T12:00:00Z"},
        user_id="5521", of_account_id="acct-1",
    )
    assert debit["transaction_type"] == "EXPENSE"
    assert debit["amount"] == "45.00"
    assert debit["external_id"] == "t1"
    assert debit["source_type"] == "OPEN_FINANCE_SYNC"
    assert debit["of_account_id"] == "acct-1"

    credit = transaction_to_command(
        {"id": "t2", "credit_debit_type": "CREDITO", "transaction_amount": {"amount": "3500.00", "currency": "BRL"},
         "category_ref": "INCOME_SALARY", "transaction_date_time": "2026-10-05T09:00:00Z"},
        user_id="5521", of_account_id="acct-1",
    )
    assert credit["transaction_type"] == "INCOME"
    assert credit["category"] == "Renda Extra"


def test_transaction_without_id_is_skipped():
    assert transaction_to_command({"credit_debit_type": "DEBITO"}, user_id="u", of_account_id="a") is None


def test_counterparty_alias_is_preferred():
    cmd = transaction_to_command(
        {"id": "t3", "credit_debit_type": "DEBITO", "transaction_amount": {"amount": "1.00", "currency": "BRL"},
         "transaction_date_time": "2026-10-04T12:00:00Z",
         "counterparty": {"name": "NETFLIX ENTRETENIMENTO BRASIL LTDA.", "alias": "Netflix"}},
        user_id="u", of_account_id="a",
    )
    assert cmd["counterparty"] == "Netflix"
