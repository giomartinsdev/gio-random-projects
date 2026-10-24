"""NLU mínima por regras: texto do WhatsApp -> intent + valores.

Sem LLM no caminho crítico: um parser determinístico cobre o vocabulário do
§5.1 e é testável com golden files. O que não casa vira ``desconhecido`` e o
worker responde pedindo para reformular — nunca inventa uma transação.

O resultado é um `Intent` com action `finance.*` (as do contrato compartilhado)
e um payload no shape que a `finance-api` valida.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from finance_contracts import (
    ACTION_GET_CASH_FLOW_HISTORY,
    ACTION_GET_CATEGORY_BREAKDOWN,
    ACTION_GET_MONTHLY_DASHBOARD,
    ACTION_REGISTER_TRANSACTION,
    ACTION_SET_CATEGORY_BUDGET,
)

# "gastei 45", "paguei 120,50", "recebi 3500" — o número é a parte que importa.
_AMOUNT = r"(\d{1,3}(?:\.\d{3})*,\d{2}|\d+(?:[.,]\d{1,2})?)"
_EXPENSE = re.compile(rf"\b(gastei|paguei|comprei|despesa)\b[^\d]*{_AMOUNT}", re.IGNORECASE)
_INCOME = re.compile(rf"\b(recebi|ganhei|receita|entrou)\b[^\d]*{_AMOUNT}", re.IGNORECASE)
_BUDGET = re.compile(rf"\b(or[çc]amento|limite)\b[^\d]*{_AMOUNT}", re.IGNORECASE)

# Leituras (§4.2). A ordem importa: "gráfico dos meus gastos" contém "gastos"
# (que casaria com dashboard), então gráfico e extrato são testados antes.
_CHART = re.compile(r"\b(gr[aá]fico|grafico|chart)\b", re.IGNORECASE)
_EXTRATO = re.compile(r"\b(extrato|detalhe|detalhado|lista)\b", re.IGNORECASE)
_DASHBOARD = re.compile(
    r"\b(como est[ãa]o|resumo|dashboard|quanto (gastei|recebi)|meus gastos|balan[çc]o|saldo)\b",
    re.IGNORECASE,
)

# Categorias por palavra-chave, para o caso comum. Sem acerto, "Outros".
_CATEGORIES = (
    (re.compile(r"\b(almo[çc]o|jantar|comida|mercado|padaria|restaurante|lanche)\b", re.IGNORECASE), "Alimentação"),
    (re.compile(r"\b(uber|ônibus|onibus|táxi|taxi|combustível|combustivel|gasolina|estacionamento)\b", re.IGNORECASE), "Transporte"),
    (re.compile(r"\b(luz|água|agua|internet|aluguel|condom[ií]nio|telefone|celular)\b", re.IGNORECASE), "Contas"),
    (re.compile(r"\b(freela|freelance|salário|salario|pagamento)\b", re.IGNORECASE), "Renda Extra"),
)


@dataclass(frozen=True, slots=True)
class Intent:
    """O que o texto do usuário pediu. ``action`` vazio = não entendi."""

    action: str
    payload: dict[str, Any]
    kind: str = "desconhecido"

    @property
    def understood(self) -> bool:
        return bool(self.action)

    @property
    def is_read(self) -> bool:
        """Uma leitura (§4.2) viaja por ``POST /queries``, não ``/commands``."""
        return self.action.startswith("finance.query.")


def _to_decimal_str(raw: str) -> str:
    """``"1.234,50"`` / ``"45,00"`` / ``"45.00"`` -> ``"1234.50"`` (Decimal exato).

    O domínio proíbe float (§3.4); o NLU entrega string decimal, nunca número.
    """
    text = raw.strip()
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")
    return text


def _category(text: str) -> str:
    for pattern, name in _CATEGORIES:
        if pattern.search(text):
            return name
    return "Outros"


def parse(text: str, *, phone: str, occurred_at: str) -> Intent:
    """Extrai o intent do texto. ``phone`` vira o ``user_id``; ``occurred_at``
    é tz-aware em ISO (quem chama carimba o tempo)."""
    clean = (text or "").strip()
    if not clean:
        return Intent("", {}, "desconhecido")

    budget = _BUDGET.search(clean)
    if budget:
        return Intent(
            ACTION_SET_CATEGORY_BUDGET,
            {
                "user_id": phone,
                "category": _category(clean),
                "limit": _to_decimal_str(budget.group(2)),
                "currency": "BRL",
                "period": occurred_at[:7],
            },
            "orcamento",
        )

    # Leituras (§4.2): "gráfico" e "extrato" antes de dashboard, porque
    # "gráfico dos meus gastos" contém "gastos" (que casaria com dashboard).
    if _CHART.search(clean):
        return Intent(
            ACTION_GET_CASH_FLOW_HISTORY,
            {"user_id": phone, "month": occurred_at[:7]},
            "grafico",
        )
    if _EXTRATO.search(clean):
        return Intent(
            ACTION_GET_CATEGORY_BREAKDOWN,
            {"user_id": phone, "month": occurred_at[:7]},
            "extrato",
        )
    if _DASHBOARD.search(clean):
        return Intent(
            ACTION_GET_MONTHLY_DASHBOARD,
            {"user_id": phone, "month": occurred_at[:7]},
            "resumo",
        )

    expense = _EXPENSE.search(clean)
    income = _INCOME.search(clean)
    match = expense or income
    if match:
        kind = "despesa" if expense else "receita"
        return Intent(
            ACTION_REGISTER_TRANSACTION,
            {
                "user_id": phone,
                "account_id": phone,
                "transaction_type": "EXPENSE" if expense else "INCOME",
                "amount": _to_decimal_str(match.group(2)),
                "currency": "BRL",
                "category": _category(clean),
                "occurred_at": occurred_at,
                "source_type": "WHATSAPP_MANUAL",
            },
            kind,
        )

    return Intent("", {}, "desconhecido")
