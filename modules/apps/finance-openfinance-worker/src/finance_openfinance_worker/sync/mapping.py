"""Mapeamento da taxonomia da Polp (``category_ref``) para as categorias do
ledger, e a tradução de uma transação do banco para o payload do comando.

Funções puras: o que se prova aqui é a regra (sinal pelo crédito/débito,
mês/instante tz-aware, categoria), sem rede.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

# Prefixo da taxonomia da Polp -> categoria do ledger. A ordem importa: o
# primeiro prefixo que casa vence (FOOD_AND_DRINK antes de GENERAL_*). O mapa é
# curto de propósito — o valor cru fica em external_category para um mapa
# melhor depois.
_CATEGORY_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("FOOD_AND_DRINK", "Alimentação"),
    ("TRANSPORTATION", "Transporte"),
    ("TRAVEL", "Transporte"),
    ("RENT_AND_UTILITIES", "Contas"),
    ("BANK_FEES", "Contas"),
    ("ENTERTAINMENT", "Lazer"),
    ("MEDICAL", "Saúde"),
    ("PERSONAL_CARE", "Saúde"),
    ("GENERAL_SERVICES_EDUCATION", "Educação"),
    ("HOME_IMPROVEMENT", "Moradia"),
    ("GENERAL_MERCHANDISE", "Compras"),
    ("INCOME", "Renda Extra"),
    ("GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT", "Impostos"),
)


def map_category(category_ref: str | None) -> str:
    if not category_ref:
        return "Outros"
    for prefix, category in _CATEGORY_BY_PREFIX:
        if category_ref.startswith(prefix):
            return category
    return "Outros"


def amount_decimal(amount: Mapping[str, Any] | None) -> str:
    """``{"amount":"45.00","currency":"BRL"}`` -> ``"45.00"`` (módulo)."""
    if not amount:
        return "0.00"
    raw = str(amount.get("amount", "0"))
    try:
        # normaliza para 2 casas sem passar por float
        return str(Decimal(raw).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return "0.00"


def occurred_at_iso(value: str | None) -> str:
    """ISO do banco -> ISO tz-aware em UTC (o ledger exige fuso)."""
    if not value:
        return datetime.now(timezone.utc).isoformat()
    text = value.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc).isoformat()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def transaction_to_command(
    tx: Mapping[str, Any], *, user_id: str, of_account_id: str
) -> dict[str, Any] | None:
    """Traduz uma transação do Polp no payload de ``finance.transaction.register``.

    Devolve ``None`` quando a transação não tem id (sem ``external_id`` não há
    idempotência — melhor pular que duplicar).
    """
    external_id = str(tx.get("id", "") or "")
    if not external_id:
        return None
    is_credit = str(tx.get("credit_debit_type", "")).upper() == "CREDITO"
    amount = amount_decimal(tx.get("transaction_amount"))
    counterparty = tx.get("counterparty") or {}
    cp_name = str(counterparty.get("alias") or counterparty.get("name") or "") if isinstance(counterparty, Mapping) else ""
    return {
        "user_id": user_id,
        "account_id": of_account_id,
        "transaction_type": "INCOME" if is_credit else "EXPENSE",
        "amount": amount,
        "currency": str((tx.get("transaction_amount") or {}).get("currency", "BRL")) if isinstance(tx.get("transaction_amount"), Mapping) else "BRL",
        "category": map_category(tx.get("category_ref")),
        "occurred_at": occurred_at_iso(tx.get("transaction_date_time")),
        "source_type": "OPEN_FINANCE_SYNC",
        "external_id": external_id,
        "of_account_id": of_account_id,
        "counterparty": cp_name,
        "external_category": str(tx.get("category_ref") or ""),
    }
