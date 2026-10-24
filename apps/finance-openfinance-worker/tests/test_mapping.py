"""Mapeamento da transação do banco para o comando do ledger (função pura)."""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_openfinance_worker.sync.mapping import (  # noqa: E402
    amount_decimal,
    bill_to_command,
    credit_card_to_command,
    exchange_to_command,
    financing_to_command,
    investment_transaction_to_command,
    loan_to_command,
    map_category,
    merchant_name,
    occurred_at_iso,
    raw_to_command,
    transaction_to_command,
)


def test_category_mapping():
    assert map_category("FOOD_AND_DRINK_RESTAURANT") == "Alimentação"
    assert map_category("TRANSPORTATION_TAXIS_AND_RIDE_SHARES") == "Transporte"
    assert map_category("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY") == "Contas"
    assert map_category("INCOME_SALARY") == "Renda Extra"
    assert map_category("SOMETHING_WEIRD") == "Outros"
    assert map_category(None) == "Outros"


def test_transfers_have_their_own_category_not_outros():
    # Pix/transferências são a maior parte do extrato do BTG; jogá-los em
    # "Outros" esconde tudo. Têm categoria própria.
    assert map_category("TRANSFER_OUT_TRANSFER_OUT_FROM_APPS") == "Transferências"
    assert map_category("TRANSFER_IN_ACCOUNT_TRANSFER") == "Transferências"
    assert map_category("TRANSFER_OUT_WIRE") == "Transferências"


def test_merchant_name_prefers_counterparty_then_transaction_name():
    assert merchant_name({"counterparty": {"alias": "Netflix"}}) == "Netflix"
    assert merchant_name({"counterparty": {"name": "NETFLIX LTDA"}}) == "NETFLIX LTDA"
    # counterparty null mas o transaction_name é o estabelecimento (cartão)
    assert merchant_name({"counterparty": None, "transaction_name": "CAFE LAMAS LTDA"}) == "CAFE LAMAS LTDA"
    # transaction_name genérico (meio de pagamento) não serve como lugar
    assert merchant_name({"counterparty": None, "transaction_name": "Pix"}) == ""
    assert merchant_name({"transaction_name": "InternalTransfer"}) == ""


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


def test_credit_card_maps_limits_and_last4():
    cmd = credit_card_to_command(
        {"id": "cc1", "name": "Cartão Universitário", "credit_card_network": "VISA",
         "payment_methods": [{"identification_number": "4453"}],
         "limits": [{"limit_amount": {"amount": "5000.00", "currency": "BRL"},
                      "available_amount": {"amount": "3800.00", "currency": "BRL"},
                      "used_amount": {"amount": "1200.00", "currency": "BRL"}}]},
        user_id="u", consent_id="c1",
    )
    assert cmd["polp_card_id"] == "cc1"
    assert cmd["brand"] == "VISA"
    assert cmd["last4"] == "4453"
    assert cmd["credit_limit"] == "5000.00"
    assert cmd["available_limit"] == "3800.00"
    assert cmd["balance"] == "1200.00"


def test_bill_maps_total():
    cmd = bill_to_command(
        {"id": "b1", "due_date": "2026-11-10", "status": "OPEN",
         "total_amount": {"amount": "175.50", "currency": "BRL"}},
        user_id="u", consent_id="c1", card_id="cc1",
    )
    assert cmd["polp_bill_id"] == "b1"
    assert cmd["polp_card_id"] == "cc1"
    assert cmd["total_amount"] == "175.50"


def test_loan_maps_contract_and_outstanding():
    cmd = loan_to_command(
        {"id": "l1", "product_name": "Crédito Consignado", "product_type": "EMPRESTIMOS",
         "product_sub_type": "CREDITO_PESSOAL_COM_CONSIGNACAO", "contract_amount": "50000.0000",
         "next_instalment_amount": "1250.0000", "currency": "BRL", "due_date": "2028-01-15",
         "interest_rates": [{"pre_fixed_rate": "0.150000"}],
         "scheduled_instalments": {"total_number_of_instalments": 48, "paid_instalments": 12},
         "payments": {"contract_outstanding_balance": "45000.00"}},
        user_id="u", consent_id="c1",
    )
    assert cmd["polp_loan_id"] == "l1"
    assert cmd["contract_amount"] == "50000.00"
    assert cmd["outstanding_balance"] == "45000.00"
    assert cmd["installment_amount"] == "1250.00"
    assert cmd["total_installments"] == "48"


def test_exchange_maps_amount():
    cmd = exchange_to_command(
        {"id": "x1", "type": "COMPRA", "amount": {"amount": "1000.00", "currency": "BRL"},
         "target_currency": "USD", "occurred_at": "2026-10-01T10:00:00Z"},
        user_id="u", consent_id="c1",
    )
    assert cmd["polp_exchange_id"] == "x1"
    assert cmd["amount"] == "1000.00"
    assert cmd["target_currency"] == "USD"


def test_investment_transaction_maps_movement():
    # Forma real de renda variável: valor em ``transaction_value``, o movimento
    # em ``transaction_type`` (ALUGUEIS), a direção em ``type`` (SAIDA), e o
    # vínculo em ``variable_income_id``.
    cmd = investment_transaction_to_command(
        {"id": "it1", "type": "SAIDA", "transaction_type": "ALUGUEIS",
         "transaction_value": {"amount": "5.88", "currency": "BRL"},
         "variable_income_id": "inv-real", "transaction_date": "2026-08-14"},
        user_id="u", consent_id="c1", invest_id="inv1", family="variable-incomes",
    )
    assert cmd["polp_tx_id"] == "it1"
    assert cmd["polp_invest_id"] == "inv-real"
    assert cmd["type"] == "ALUGUEIS"
    assert cmd["amount"] == "5.88"


def test_raw_serializes_the_whole_payload():
    cmd = raw_to_command({"id": "r1", "any": ["field", 1]}, user_id="u", consent_id="c1",
                         resource="credit_cards", external_id="r1")
    assert cmd["resource"] == "credit_cards"
    assert cmd["external_id"] == "r1"
    assert '"any"' in cmd["payload"]
