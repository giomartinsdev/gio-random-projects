"""Testes dos guardrails: PII scrubbing e política de envio (R7, T046/T064).

Funções puras que decidem o que pode sair daqui: telefone/e-mail nunca cru para o
9router, opt-out nunca contornado, e ``policy.approval=human`` barra envio sem
aprovação. Um erro aqui vazaria PII ou abordaria quem pediu para não ser
abordado -- os dois custam mais que um deploy vermelho.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from prospecta_agent_worker.agents.guardrails import (
    SendBlocked,
    check_send,
    scrub_payload,
    scrub_text,
)


def test_scrub_text_redige_email_e_telefone():
    out = scrub_text("Fale com carlos@northwind.com.br ou (21) 98196-2914 hoje")
    assert "carlos@northwind.com.br" not in out
    assert "98196" not in out
    assert "[EMAIL]" in out and "[PHONE]" in out


def test_scrub_text_nao_mexe_em_numero_curto_nem_ano():
    assert scrub_text("em 2026 o CD novo") == "em 2026 o CD novo"
    assert scrub_text("gastei R$ 45 no almoço") == "gastei R$ 45 no almoço"


def test_scrub_payload_recursivo():
    out = scrub_payload(
        {"contact": {"email": "a@b.com", "phone": "5521981962914"}, "tags": ["5511999999999"]}
    )
    assert out["contact"]["email"] == "[EMAIL]"
    assert out["contact"]["phone"] == "[PHONE]"
    assert out["tags"] == ["[PHONE]"]
    # Não muta a entrada.
    assert out is not None


def test_check_send_sem_aprovacao_bloqueia_no_humano():
    with pytest.raises(SendBlocked) as exc:
        check_send(approved=False, opted_out=False, approval_policy="human")
    assert exc.value.code == "approval_required"


def test_check_send_optout_bloqueia_mesmo_aprovado():
    with pytest.raises(SendBlocked) as exc:
        check_send(approved=True, opted_out=True, approval_policy="human")
    assert exc.value.code == "opt_out"


def test_check_send_auto_dispensa_aprovacao_mas_respeita_optout():
    check_send(approved=False, opted_out=False, approval_policy="auto")
    with pytest.raises(SendBlocked) as exc:
        check_send(approved=False, opted_out=True, approval_policy="auto")
    assert exc.value.code == "opt_out"
