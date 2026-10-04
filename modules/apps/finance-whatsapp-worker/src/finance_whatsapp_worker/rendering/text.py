"""Renderização da resposta de WhatsApp (texto simples).

Card em texto com emojis. Determinístico (golden-file friendly, §12.4):
o mesmo ``Intent`` + resultado sempre produz a mesma string.
"""

from __future__ import annotations

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

    if outcome == "written":
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
