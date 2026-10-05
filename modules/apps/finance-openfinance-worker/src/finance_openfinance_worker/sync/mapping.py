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


_INVESTMENT_TYPES: dict[str, str] = {
    "BANK_FIXED_INCOMES": "RENDA_FIXA_BANCARIA",
    "CDB": "CDB", "RDB": "RDB", "LCI": "LCI", "LCA": "LCA",
    "DEBENTURES": "DEBENTURE", "CRI": "CRI", "CRA": "CRA",
    "FUNDS": "FUNDO",
    "TREASURE_TITLES": "TESOURO_DIRETO",
    "VARIABLE_INCOMES": "ACAO",
}
def investment_to_command(inv, *, user_id: str, consent_id: str) -> dict[str, Any] | None:
    """Normaliza UMA posição de investimento (qualquer das 5 famílias do
    Celcoin/Polp) no comando ``finance.investment.synced``. Money sempre
    string decimal (§3.4). Investido = quantidade × preço de compra; bruto =
    balance.gross_amount; rendimento = derivado no worker."""
    fam = str(inv.get("_family", ""))
    balance = inv.get("balance") if isinstance(inv.get("balance"), Mapping) else {}
    if not isinstance(balance, Mapping) or not balance:
        return None

    rem = inv.get("remuneration") if isinstance(inv.get("remuneration"), Mapping) else {}
    indexers = []
    if rem.get("indexer"):
        part = str(rem.get("indexer"))
        pct_p = rem.get("post_fixed_indexer_percentage")
        pre = rem.get("pre_fixed_rate")
        if pct_p is not None:
            indexers.append(f"{float(str(pct_p)) * 100:.0f}% {part}")
        elif pre is not None:
            indexers.append(f"{float(str(pre)) * 100:.2f}% {part}")
    yield_label = (" · ".join(indexers)) if indexers else str(inv.get("indexer") or "")
    yield_pct = (str(rem.get("post_fixed_indexer_percentage") or "")
                 if rem.get("post_fixed_indexer_percentage") is not None else str(rem.get("pre_fixed_rate") or ""))

    # invested: purchase_unit_price × quantity (bank/credit) — nos demais, net
    # não existe: invested é bruto na compra; o provedor dá purchase_unit_price
    qty = str(balance.get("quantity") or balance.get("quota_quantity") or balance.get("transaction_quantity") or "0")
    try:
        qty_f = float(qty)
    except ValueError:
        qty_f = 0.0
    pu = balance.get("purchase_unit_price") or inv.get("issue_unit_price") or {}
    pu_amount = str((pu or {}).get("amount", "0.00"))
    # Ações/fundos não entregam preço de compra confiável: invested desconhecido
    # é string vazia (a UI mostra "—"), nunca um zero mentiroso.
    if fam in ("variable-incomes", "funds") or float(pu_amount or 0) <= 0:
        invested = ""
    else:
        try:
            invested = f"{qty_f * float(pu_amount):.2f}"
        except (ValueError, TypeError):
            invested = ""

    gross = str((balance.get("gross_amount") or {}).get("amount", "0.00"))
    net = str((balance.get("net_amount") or {}).get("amount", gross))
    income_tax = str((balance.get("income_tax") or {}).get("amount", "0.00"))
    iof = str((balance.get("financial_transaction_tax") or {}).get("amount", "0.00"))
    currency = str((balance.get("gross_amount") or {}).get("currency", "BRL") or "BRL")

    # identity
    name = (str(inv.get("product_name") or "")
            or str(inv.get("name") or "")
            or (str(inv.get("ticker") or ""))
            or (str(inv.get("debtor_name") or "").title())
            or str(inv.get("investment_type") or fam))
    if fam == "variable-incomes":
        ticker = str(inv.get("ticker") or "")
        if ticker and not name.startswith(ticker):
            name = f"{ticker} · {name}"
    institution = str(inv.get("issuer_institution_cnpj_number") or inv.get("debtor_cnpj_number") or "")
    institution_label = {
        "60746948000112": "Itaú Unibanco",
        "33000167000101": "Petrobras (emissor)",
    }.get(institution) or (f"emissor {institution[:8]}…" if institution else "B3")
    fam_key = fam.replace("-", "_").upper()
    itype = (_INVESTMENT_TYPES.get(str(inv.get("investment_type") or "").upper())
             or _INVESTMENT_TYPES.get(fam_key) or "OUTRO")

    return {
        "user_id": user_id,
        "polp_consent_id": consent_id,
        "polp_invest_id": str(inv.get("id", "")),
        "family": fam,
        "institution_name": institution_label,
        "type": itype,
        "name": name,
        "currency": currency,
        "invested_amount": invested,
        "gross_amount": gross,
        "net_amount": net,
        "income_tax": income_tax,
        "iof": iof,
        "quantity": qty,
        "purchase_unit_price": pu_amount,
        "indexer": str(rem.get("indexer") or "") if isinstance(rem, Mapping) else "",
        "indexer_rate": yield_pct,
        "yield_label": yield_label,
        "due_date": str(inv.get("due_date") or ""),
        "isin_code": str(inv.get("isin_code") or ""),
        "ticker": str(inv.get("ticker") or ""),
        "updated_at": str((balance.get("updated_at")) or inv.get("updated_at") or ""),
    }
