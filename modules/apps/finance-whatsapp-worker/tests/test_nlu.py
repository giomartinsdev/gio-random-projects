"""Testes do NLU por regras e da renderização.

Funções puras, mas escritas como GWT (o `.feature` da integração cobre a
travessia; aqui o detalhe que um erro de regex quebraria em silêncio): o valor
vira string decimal exata (nunca float, §3.4), a categoria casa por palavra, e o
desconhecido não inventa transação.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import pytest

from finance_contracts import (
    ACTION_GET_CASH_FLOW_HISTORY,
    ACTION_GET_CATEGORY_BREAKDOWN,
    ACTION_GET_MONTHLY_DASHBOARD,
)
from finance_whatsapp_worker.nlu.parser import parse
from finance_whatsapp_worker.rendering.text import (
    render,
    render_breakdown,
    render_chart_caption,
    render_dashboard,
)

WHEN = "2026-10-04T12:00:00+00:00"


@pytest.mark.parametrize(
    "text,kind,amount,category",
    [
        ("Gastei 45 no almoço hoje", "despesa", "45", "Alimentação"),
        ("paguei 120,50 de uber", "despesa", "120.50", "Transporte"),
        ("Gastei 1.234,56 no mercado", "despesa", "1234.56", "Alimentação"),
        ("Recebi 3500 de freela", "receita", "3500", "Renda Extra"),
        ("paguei 120 de luz no nubank", "despesa", "120", "Contas"),
    ],
)
def test_parse_extrai_kind_valor_categoria(text, kind, amount, category):
    intent = parse(text, phone="5511999999999", occurred_at=WHEN)
    assert intent.kind == kind
    assert intent.payload["amount"] == amount
    assert isinstance(intent.payload["amount"], str), "o domínio proíbe float (§3.4)"
    assert intent.payload["category"] == category


def test_parse_orcamento_usa_mes_do_occurred_at():
    intent = parse("orçamento de 600 pra alimentação", phone="55", occurred_at=WHEN)
    assert intent.kind == "orcamento"
    assert intent.payload["limit"] == "600"
    # `period` é o nome canônico no envelope (finance-api domain/commands.py);
    # `month` aqui seria um campo zero do outro lado.
    assert intent.payload["period"] == "2026-10"


def test_parse_desconhecido_nao_inventa_transacao():
    intent = parse("oi tudo bem?", phone="55", occurred_at=WHEN)
    assert intent.kind == "desconhecido"
    assert not intent.understood
    assert intent.action == ""


def test_parse_vazio_e_desconhecido():
    assert not parse("   ", phone="55", occurred_at=WHEN).understood


def test_render_written_confirma():
    intent = parse("Gastei 45 no almoço", phone="55", occurred_at=WHEN)
    out = render(intent, "written")
    assert "45,00" in out and "Alimentação" in out


def test_render_queued_nao_fala_em_falha():
    intent = parse("Gastei 45 no almoço", phone="55", occurred_at=WHEN)
    out = render(intent, "queued")
    assert "fila" in out.lower()


def test_render_failed_explica():
    intent = parse("Gastei 45 no almoço", phone="55", occurred_at=WHEN)
    out = render(intent, "failed", error="valor inválido")
    assert "valor inválido" in out


# --------------------------------------------------------------- leituras §4.2

@pytest.mark.parametrize(
    "text,action,kind",
    [
        ("Como estão meus gastos este mês?", ACTION_GET_MONTHLY_DASHBOARD, "resumo"),
        ("resumo do mês", ACTION_GET_MONTHLY_DASHBOARD, "resumo"),
        ("qual meu saldo?", ACTION_GET_MONTHLY_DASHBOARD, "resumo"),
        ("quanto gastei este mês", ACTION_GET_MONTHLY_DASHBOARD, "resumo"),
        ("me manda o extrato", ACTION_GET_CATEGORY_BREAKDOWN, "extrato"),
        ("extrato detalhado", ACTION_GET_CATEGORY_BREAKDOWN, "extrato"),
        ("gráfico dos meus gastos", ACTION_GET_CASH_FLOW_HISTORY, "grafico"),
        ("me manda um grafico", ACTION_GET_CASH_FLOW_HISTORY, "grafico"),
    ],
)
def test_parse_leituras(text, action, kind):
    intent = parse(text, phone="5521981962914", occurred_at=WHEN)
    assert intent.kind == kind, intent
    assert intent.action == action, intent
    assert intent.is_read
    assert intent.payload["user_id"] == "5521981962914"
    assert intent.payload["month"] == "2026-10"


def test_grafico_vence_dashboard_quando_o_texto_tem_os_dois():
    # "gráfico dos meus gastos" contém "gastos" (dashboard), mas a intenção
    # mais específica (gráfico) tem de vencer.
    intent = parse("gráfico dos meus gastos", phone="55", occurred_at=WHEN)
    assert intent.action == ACTION_GET_CASH_FLOW_HISTORY


def test_render_dashboard_golden():
    body = {
        "user_id": "55", "month": "2026-10", "income": "1000.00", "expense": "-80.00",
        "net": "920.00", "currency": "BRL", "transaction_count": 2,
        "top_categories": [
            {"category": "Alimentação", "amount": "-80.00", "currency": "BRL", "transaction_count": 1},
            {"category": "Transporte", "amount": "-20.00", "currency": "BRL", "transaction_count": 1},
        ],
        "budgets": [
            {"category": "Alimentação", "limit_amount": "100.00", "spent_amount": "-80.00",
             "currency": "BRL", "thresholds_reached": [50]},
        ],
    }
    out = render_dashboard(body)
    assert out == (
        "📊 *Resumo de 2026-10*\n"
        "💰 Receitas: R$ 1.000,00\n"
        "💸 Despesas: R$ -80,00\n"
        "⚖️ Saldo: R$ 920,00\n"
        "\n"
        "*Top categorias*\n"
        "Alimentação ██████████ R$ -80,00\n"
        "Transporte ███ R$ -20,00\n"
        "\n"
        "*Alertas de orçamento*\n"
        "⚠️ Alimentação: 50% do limite (R$ -80,00 de R$ 100,00)"
    )


def test_render_breakdown_golden():
    body = {"month": "2026-10", "categories": [
        {"category": "Alimentação", "amount": "-95.00", "currency": "BRL", "transaction_count": 2},
        {"category": "Transporte", "amount": "-10.00", "currency": "BRL", "transaction_count": 1},
    ]}
    out = render_breakdown(body)
    assert out == (
        "📄 *Extrato de 2026-10*\n"
        "• Alimentação: R$ -95,00\n"
        "• Transporte: R$ -10,00"
    )


def test_render_breakdown_sem_dados():
    assert render_breakdown({"month": "2026-10", "categories": []}) == "📄 Nenhuma despesa registrada em 2026-10."


def test_render_chart_caption_golden():
    assert render_chart_caption({"month": "2026-10", "net": "920.00"}) == "📈 Fluxo de caixa de 2026-10 — saldo R$ 920,00"
