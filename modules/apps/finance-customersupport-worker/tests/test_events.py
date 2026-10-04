"""Testes do atendimento proativo por eventos de domínio (§5, diagrama).

O worker é o encarregado da conversa: ele lê o tópico ``domain.events`` (onde o
domain-worker publica a transação concluída) e avisa o cliente. Aqui se testa a
função pura que traduz evento → mensagem e o roteamento por ``user_id``.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from finance_contracts import (
    EVENT_BUDGET_THRESHOLD_REACHED,
    EVENT_TRANSACTION_CATEGORIZED,
    EVENT_TRANSACTION_REGISTERED,
    EVENT_TRANSFER_COMPLETED,
)
from finance_customersupport_worker.rendering.events import (
    phone_to_jid,
    render_event,
)


def test_render_registered_expense():
    out = render_event(
        EVENT_TRANSACTION_REGISTERED,
        {"transaction_type": "EXPENSE", "amount": "-45.00", "category": "Alimentação"},
    )
    # Despesa é exibida em módulo: o rótulo "Despesa" já diz a direção; o
    # sinal negativo no amount é convenção de armazenamento, não de conversa.
    assert out == "💸 Despesa de R$ 45,00 em *Alimentação* registrada ✅"


def test_render_registered_income():
    out = render_event(
        EVENT_TRANSACTION_REGISTERED,
        {"transaction_type": "INCOME", "amount": "3500.00", "category": "Renda Extra"},
    )
    assert out == "💰 Receita de R$ 3.500,00 em *Renda Extra* registrada ✅"


def test_render_transfer_completed():
    out = render_event(EVENT_TRANSFER_COMPLETED, {"amount": "100.00"})
    assert out == "🔁 Transferência de R$ 100,00 concluída ✅"


def test_render_categorized():
    out = render_event(EVENT_TRANSACTION_CATEGORIZED, {"category": "Lazer"})
    assert out == "🏷️ Categorizado como *Lazer* ✅"


def test_render_budget_warning_and_exceeded():
    warn = render_event(
        EVENT_BUDGET_THRESHOLD_REACHED,
        {"category": "Alimentação", "threshold": 80, "spent_amount": "-80.00", "limit_amount": "100.00"},
    )
    assert warn == "⚠️ Você atingiu *80%* do orçamento de *Alimentação* (R$ 80,00 de R$ 100,00)"
    over = render_event(
        EVENT_BUDGET_THRESHOLD_REACHED,
        {"category": "Alimentação", "threshold": 100, "spent_amount": "-110.00", "limit_amount": "100.00"},
    )
    assert over.startswith("🚨")


def test_render_unknown_event_is_none():
    assert render_event("finance.alguma.coisa", {"x": 1}) is None


def test_phone_to_jid():
    assert phone_to_jid("5521981962914") == "5521981962914@s.whatsapp.net"
    # Já é um JID: não remonta.
    assert phone_to_jid("5521981962914@s.whatsapp.net") == "5521981962914@s.whatsapp.net"
