"""Renderização das mensagens proativas do atendimento (§5, diagrama).

O worker é o **encarregado da conversa com o cliente**: além de responder ao
que o usuário manda, ele consome o tópico de eventos de domínio
(``domain.events``) e avisa o cliente do que o sistema fez — a confirmação de
uma transação aplicada, uma transferência concluída e, principalmente, o
**alerta de orçamento** que ninguém tinha como mandar antes.

Determinístico (golden-file friendly, §12.4): o mesmo evento sempre produz a
mesma string. Um evento que não é deste contexto devolve ``None`` (no-op).
"""

from __future__ import annotations

from typing import Any, Mapping

from finance_contracts import (
    EVENT_BUDGET_THRESHOLD_REACHED,
    EVENT_TRANSACTION_CATEGORIZED,
    EVENT_TRANSACTION_REGISTERED,
    EVENT_TRANSFER_COMPLETED,
)
from finance_customersupport_worker.rendering.text import _br

# Os nomes do contrato compartilhado (finance_contracts.events) são a fonte
# única; re-exportados aqui só para o handler por event_name.
TRANSACTION_REGISTERED = EVENT_TRANSACTION_REGISTERED
TRANSACTION_CATEGORIZED = EVENT_TRANSACTION_CATEGORIZED
TRANSFER_COMPLETED = EVENT_TRANSFER_COMPLETED
BUDGET_THRESHOLD_REACHED = EVENT_BUDGET_THRESHOLD_REACHED


def phone_to_jid(user_id: str) -> str:
    """``user_id`` (E.164 sem +) -> JID do WhatsApp.

    O ``user_id`` do financeiro é o telefone (o mesmo que o worker deriva do
    ``remoteJid``); para falar de volta é preciso recompor o sufixo. Se já vier
    com ``@`` (um JID), é devolvido como está — não remonta o que já existe.
    """
    if not user_id:
        return user_id
    return user_id if "@" in user_id else f"{user_id}@s.whatsapp.net"


def _label(kind: str) -> tuple[str, str]:
    return {
        "EXPENSE": ("💸", "Despesa"),
        "INCOME": ("💰", "Receita"),
        "TRANSFER": ("🔁", "Transferência"),
    }.get(kind, ("🧾", "Lançamento"))


def _abs_br(amount: object) -> str:
    """Valor em módulo para exibição: o rótulo já diz a direção do dinheiro.

    O sinal negativo é convenção de ARMAZENAMENTO (o net soma ``SUM(amount)``),
    não de conversa — mostrar "Despesa de R$ -70,00" é ruído. ``-0,00`` e
    ``0,00`` viram ``0,00``.
    """
    text = str(amount)
    if text.startswith("-"):
        text = text[1:]
    return _br(text)


def render_event(event_name: str, payload: Mapping[str, Any]) -> str | None:
    """Traduz um evento de domínio na mensagem de atendimento, ou ``None``."""
    if event_name == TRANSACTION_REGISTERED:
        emoji, label = _label(str(payload.get("transaction_type", "")))
        return (
            f"{emoji} {label} de R$ {_abs_br(payload.get('amount', '0'))} "
            f"em *{payload.get('category', '')}* registrada ✅"
        )

    if event_name == TRANSFER_COMPLETED:
        return (
            f"🔁 Transferência de R$ {_abs_br(payload.get('amount', '0'))} "
            f"concluída ✅"
        )

    if event_name == TRANSACTION_CATEGORIZED:
        return f"🏷️ Categorizado como *{payload.get('category', '')}* ✅"

    if event_name == BUDGET_THRESHOLD_REACHED:
        threshold = payload.get("threshold", 0)
        # A régua 100% é um estouro; 50/80 são avisos.
        emoji = "🚨" if int(threshold) >= 100 else "⚠️"
        return (
            f"{emoji} Você atingiu *{threshold}%* do orçamento de "
            f"*{payload.get('category', '')}* "
            f"(R$ {_abs_br(payload.get('spent_amount', '0'))} de "
            f"R$ {_abs_br(payload.get('limit_amount', '0'))})"
        )

    return None
