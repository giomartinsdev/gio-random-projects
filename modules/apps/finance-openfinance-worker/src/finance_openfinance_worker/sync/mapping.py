"""Mapeamento da taxonomia da Polp (``category_ref``) para as categorias do
ledger, e a tradução de uma transação do banco para o payload do comando.

Funções puras: o que se prova aqui é a regra (sinal pelo crédito/débito,
mês/instante tz-aware, categoria), sem rede.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

# Prefixo da taxonomia da Polp -> categoria do ledger. A ORDEM importa — o
# prefixo mais específico vence, então os filhos de FOOD_AND_DRINK/TRANSPORT etc.
# vêm antes do pai. Cobrimos os prefixos de topo da taxonomia (a lista completa
# da doc da Polp); qualquer coisa não coberta cai em "Outros".
_CATEGORY_BY_PREFIX: tuple[tuple[str, str], ...] = (
    # Alimentação
    ("FOOD_AND_DRINK", "Alimentação"),
    # Transporte
    ("TRANSPORTATION", "Transporte"),
    ("TRAVEL", "Transporte"),
    # Contas e moradia
    ("RENT_AND_UTILITIES", "Contas"),
    ("BANK_FEES", "Contas"),
    ("HOME_IMPROVEMENT", "Moradia"),
    # Saúde
    ("MEDICAL", "Saúde"),
    ("PERSONAL_CARE", "Saúde"),
    # Lazer / compras
    ("ENTERTAINMENT", "Lazer"),
    ("GENERAL_MERCHANDISE", "Compras"),
    ("GENERAL_SERVICES_EDUCATION", "Educação"),
    # Governo/impostos
    ("GOVERNMENT_AND_NON_PROFIT", "Impostos"),
    # Movimentações entre contas / Pix — são transferências, não consumo. Ficam
    # numa categoria própria em vez de "Outros", que é o balde de lixo.
    ("TRANSFER_IN", "Transferências"),
    ("TRANSFER_OUT", "Transferências"),
    # Crédito (empréstimos/financiamentos)
    ("LOAN_", "Empréstimos"),
    # Receitas (depois de TRANSFER_ para TRANSFER_IN_* não cair aqui)
    ("INCOME", "Renda Extra"),
)

# transaction_name genérico: quando é só o meio de pagamento, não serve como
# nome do lugar (o nome real está no counterparty ou numa compra de cartão).
_GENERIC_NAMES = frozenset(
    {
        "pix", "ted", "doc", "tef", "boleto", "cartao", "cartão", "internaltransfer",
        "transferencia", "transferência", "deposito", "depósito", "saque",
        "valorrendimentosaldoremunerado", "estornovalorrendimentosaldoremunerado",
        "bankslip", "cardbankslip", "outros", "other",
    }
)


def map_category(category_ref: str | None) -> str:
    if not category_ref:
        return "Outros"
    for prefix, category in _CATEGORY_BY_PREFIX:
        if category_ref.startswith(prefix):
            return category
    return "Outros"


def merchant_name(tx: Mapping[str, Any]) -> str:
    """O nome do lugar/pessoa da transação, do mais específico ao genérico.

    Preferência: o ``counterparty`` enriquecido (razão social/fantasia do
    CNPJ) → o ``transaction_name`` quando NÃO é só o meio de pagamento (num
    cartão, ``transaction_name`` é o estabelecimento, ex. "CAFE LAMAS LTDA").
    """
    counterparty = tx.get("counterparty")
    if isinstance(counterparty, Mapping):
        name = counterparty.get("alias") or counterparty.get("name")
        if name:
            return str(name).strip()
    raw = str(tx.get("transaction_name", "") or "").strip()
    if raw and raw.lower() not in _GENERIC_NAMES:
        return raw
    return ""


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
        # O nome do lugar/pessoa: do counterparty enriquecido ou do
        # transaction_name (num cartão é o estabelecimento).
        "counterparty": merchant_name(tx),
        "external_category": str(tx.get("category_ref") or ""),
        "description": str(tx.get("transaction_name", "") or ""),
    }


def investment_to_command(inv: Mapping[str, Any], *, user_id: str, consent_id: str) -> dict[str, Any] | None:
    """Mapeia uma posição de investimento do provedor no comando
    ``finance.investment.synced``. Campos de money são sempre strings decimais.

    Formas aceitas (o provedor varia): ``balance.amount`` OU
    ``invested_amount``/``gross_amount`` diretos; rendimento percentual em
    ``yield_percent``/``rate``.
    """
    def _money(obj: Any) -> tuple[str, str]:
        if isinstance(obj, Mapping):
            return str(obj.get("amount", "0.00")), str(obj.get("currency", "BRL") or "BRL")
        return str(obj or "0.00"), "BRL"

    inv_invested = inv.get("invested_amount") or inv.get("invested") or {}
    inv_gross = (inv.get("balance") if isinstance(inv.get("balance"), Mapping) else inv.get("gross_amount") or inv.get("gross") or {})
    invested_amount, currency = _money(inv_invested)
    gross_amount, currency2 = _money(inv_gross)
    if currency2 and not currency:
        currency = currency2
    yield_pct = str(inv.get("yield_percent") or inv.get("rate") or "0")
    inv_type = str(inv.get("type") or inv.get("investment_type") or "OUTRO")
    name = str(inv.get("name") or inv.get("asset_name") or inv_type)
    institution = str(inv.get("issuer_name") or inv.get("institution_name") or "")
    if not institution:
        return None
    return {
        "user_id": user_id,
        "polp_consent_id": consent_id,
        "polp_invest_id": str(inv.get("id", "")),
        "institution_name": institution,
        "type": inv_type,
        "name": name,
        "currency": currency or "BRL",
        "invested_amount": invested_amount,
        "gross_amount": gross_amount,
        "yield_percent": yield_pct,
        "updated_at": str(inv.get("update_date_time") or inv.get("updated_at") or ""),
    }
