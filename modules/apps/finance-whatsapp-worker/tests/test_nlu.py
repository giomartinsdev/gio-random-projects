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

from finance_whatsapp_worker.nlu.parser import parse
from finance_whatsapp_worker.rendering.text import render

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
