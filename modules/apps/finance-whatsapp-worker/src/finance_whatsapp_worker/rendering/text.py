"""Renderização da resposta de WhatsApp (texto simples).

Card em texto com emojis. Determinístico (golden-file friendly, §12.4):
o mesmo ``Intent`` + resultado sempre produz a mesma string.
"""

from __future__ import annotations

import math
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping

from finance_whatsapp_worker.nlu.parser import Intent


def render(intent: Intent, outcome: str, *, entity_id: str = "", error: str = "") -> str:
    """Constrói a resposta pro usuário a partir do intent e do desfecho.

    ``outcome`` é o desfecho da finance-api: ``written`` (aplicado), ``failed``
    (recusado) ou ``queued`` (na fila — pode ser aplicado).
    """
    if not intent.understood:
        return "Não entendi 🤔. Tente algo como *gastei 45 no almoço* ou *recebi 3500 de freela*."

    amount = intent.payload.get("amount") or intent.payload.get("limit", "")
    category = intent.payload.get("category", "")
    emoji = "💸" if intent.kind == "despesa" else "💰" if intent.kind == "receita" else "🎯"
    label = {"despesa": "Despesa", "receita": "Receita", "orcamento": "Orçamento"}.get(intent.kind, "Comando")

    if outcome == "written" or outcome == "accepted":
        return f"{emoji} {label} de R$ {_br(amount)} em *{category}* registrada ✅"
    if outcome == "queued":
        return f"{emoji} {label} de R$ {_br(amount)} em *{category}* está na fila; pode ser confirmada daqui a pouco ⏳"
    # failed
    detail = f" ({error})" if error else ""
    return f"⚠️ Não consegui registrar {label.lower()} de R$ {_br(amount)} em *{category}*{detail}."


def _br(amount: str) -> str:
    """``"1234.50"`` -> ``"1.234,50"`` só para exibição (o dado gravado é cru)."""
    if not amount:
        return amount
    integer, _, cents = amount.partition(".")
    negative = integer.startswith("-")
    if negative:
        integer = integer[1:]
    groups = f"{int(integer):,}".replace(",", ".") if integer.isdigit() else integer
    out = f"{groups},{cents or '00'}"
    return f"-{out}" if negative else out


def _cents(value: object) -> int:
    """Valor monetário (string decimal) em centavos, para a barra proporcional."""
    try:
        return int((Decimal(str(value)) * 100).to_integral_value())
    except (InvalidOperation, ValueError):
        return 0


def _bar(cents: int, peak: int, width: int = 10) -> str:
    """Barra proporcional em blocos ``█`` (a "top categorias com barra", §5.2)."""
    if peak <= 0:
        return ""
    filled = max(1, math.ceil(width * min(abs(cents), peak) / peak))
    return "█" * filled


def render_dashboard(body: Mapping[str, Any]) -> str:
    """Card do resumo mensal (§5.2): receitas/despesas/saldo, top categorias, alertas."""
    income = body.get("income", "0.00")
    expense = body.get("expense", "0.00")
    net = body.get("net", "0.00")
    month = body.get("month", "")
    lines = [
        f"📊 *Resumo de {month}*",
        f"💰 Receitas: R$ {_br(str(income))}",
        f"💸 Despesas: R$ {_br(str(expense))}",
        f"⚖️ Saldo: R$ {_br(str(net))}",
    ]

    categories = body.get("top_categories") or []
    if isinstance(categories, (list, tuple)) and categories:
        peak = max((abs(_cents(c.get("amount", "0"))) for c in categories if isinstance(c, Mapping)), default=0)
        lines.append("")
        lines.append("*Top categorias*")
        for c in categories:
            if not isinstance(c, Mapping):
                continue
            amt = _cents(c.get("amount", "0"))
            lines.append(f"{c.get('category', '')} {_bar(amt, peak)} R$ {_br(str(c.get('amount', '0')))}")

    budgets = body.get("budgets") or []
    alerts = [b for b in budgets if isinstance(b, Mapping) and (b.get("thresholds_reached") or [])]
    if alerts:
        lines.append("")
        lines.append("*Alertas de orçamento*")
        for b in alerts:
            fired = b.get("thresholds_reached") or []
            pct = max(fired) if fired else 0
            lines.append(
                f"⚠️ {b.get('category', '')}: {pct}% do limite "
                f"(R$ {_br(str(b.get('spent_amount', '0')))} de R$ {_br(str(b.get('limit_amount', '0')))})"
            )
    return "\n".join(lines)


def render_breakdown(body: Mapping[str, Any]) -> str:
    """Extrato em texto: a lista detalhada de despesas por categoria (§5.2)."""
    categories = body.get("categories") or []
    month = body.get("month", "")
    if not isinstance(categories, (list, tuple)) or not categories:
        return f"📄 Nenhuma despesa registrada em {month}."
    lines = [f"📄 *Extrato de {month}*"]
    for c in categories:
        if not isinstance(c, Mapping):
            continue
        lines.append(f"• {c.get('category', '')}: R$ {_br(str(c.get('amount', '0')))}")
    return "\n".join(lines)


def render_chart_caption(body: Mapping[str, Any]) -> str:
    """Legenda que acompanha o PNG do fluxo de caixa (§5.2)."""
    month = body.get("month", "")
    net = body.get("net", "0.00")
    return f"📈 Fluxo de caixa de {month} — saldo R$ {_br(str(net))}"
