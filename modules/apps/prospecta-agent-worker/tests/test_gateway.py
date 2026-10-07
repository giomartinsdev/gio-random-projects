"""Testes do gateway de saída (mapping de número) e do extrator de texto.

Funções puras que decidem o formato certo do contrato do Evolution v2.3.7: o
``number`` sem ``@s.whatsapp.net``, o caminho inverso do JID, e as duas formas
de texto (``conversation`` e ``extendedTextMessage.text``). Um erro aqui mandaria
a abordagem para um JID inválido e o lead nunca veria a mensagem.
"""

from __future__ import annotations

import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from prospecta_agent_worker.gateway.evolution import jid_to_number, phone_to_jid
from prospecta_agent_worker.worker import extract_text


def test_jid_to_number_tira_dominio():
    assert jid_to_number("5521981962914@s.whatsapp.net") == "5521981962914"


def test_jid_to_number_aceita_numero_puro():
    assert jid_to_number("5521981962914") == "5521981962914"


def test_phone_to_jid_monta_e_nao_remonta():
    assert phone_to_jid("5521981962914") == "5521981962914@s.whatsapp.net"
    assert phone_to_jid("5521981962914@s.whatsapp.net") == "5521981962914@s.whatsapp.net"


def test_extract_text_conversation():
    assert extract_text({"message": {"conversation": "oi"}}) == "oi"


def test_extract_text_extended():
    assert extract_text({"message": {"extendedTextMessage": {"text": "com contexto"}}}) == "com contexto"


def test_extract_text_audio_e_none():
    assert extract_text({"message": {"audioMessage": {"seconds": 3}}}) is None
    assert extract_text({"message": {}}) is None
    assert extract_text({}) is None
