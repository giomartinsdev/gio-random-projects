"""Steps de messaging.feature.

A Evolution e a prospecta-api são stubs HTTP reais (container) e o worker
publica seus eventos num RabbitMQ real. O cenário caminha pela PORTA PÚBLICA do
worker (``worker.send_message``) -- opt-out e aprovação são guardrails do
caminho de envio, não de um objeto separado -- para que o teste exercite a
mesma travessia que a produção.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from steps.support import EventCollector, build_worker

scenarios("../features/messaging.feature")


@pytest.fixture
def contexto() -> dict:
    return {}


@pytest.fixture
def collector(rabbit_url):
    c = EventCollector(rabbit_url)
    c.open()
    try:
        yield c
    finally:
        c.close()


@given(parsers.parse('um lead conhecido para o telefone "{phone}"'))
def lead_conhecido(contexto: dict, stubs, phone: str) -> None:
    stubs["set"](
        leads={
            phone: {
                "tenant_id": "tenant-1",
                "lead_id": "lead-1",
                "thread_key": f"wa:{phone}",
            }
        }
    )
    contexto["stubs"] = stubs


@given(parsers.parse('que o lead "{lead_id}" está em opt-out'))
def lead_optout(contexto: dict, lead_id: str) -> None:
    contexto["stubs"]["set"](optouts=[lead_id])


@when(parsers.parse('o worker envia a mensagem aprovada "{text}" para o telefone "{phone}"'))
def envia_aprovada(contexto: dict, rabbit_url, collector, text: str, phone: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(contexto["stubs"]["base"], rabbit_url)
    contexto["worker"] = worker
    worker.send_message(
        tenant_id="tenant-1",
        lead_id="lead-1",
        remote_jid=f"{phone}@s.whatsapp.net",
        content=text,
        approved=True,
    )


@when(parsers.parse('o worker envia a mensagem não aprovada "{text}" para o telefone "{phone}"'))
def envia_nao_aprovada(contexto: dict, rabbit_url, collector, text: str, phone: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(contexto["stubs"]["base"], rabbit_url, approval_policy="human")
    contexto["worker"] = worker
    worker.send_message(
        tenant_id="tenant-1",
        lead_id="lead-1",
        remote_jid=f"{phone}@s.whatsapp.net",
        content=text,
        approved=False,
    )


@then(parsers.parse('a Evolution recebeu o texto "{text}" para o número "{number}"'))
def evolution_recebeu(contexto: dict, text: str, number: str) -> None:
    sends = contexto["stubs"]["get"]()["sends"]
    assert sends, "nenhum envio chegou à Evolution"
    assert sends[-1]["text"] == text, sends[-1]
    assert sends[-1]["number"] == number, sends[-1]
    assert sends[-1]["instance"] == "web-businesses", sends[-1]


@then("o envio usou o header apikey e o Content-Type application/json")
def envio_usou_headers(contexto: dict) -> None:
    send = contexto["stubs"]["get"]()["sends"][-1]
    assert send["apikey"] == "test-evolution-key", send
    assert send["content_type"] == "application/json", send


@then("nenhum envio chegou à Evolution")
def nenhum_envio(contexto: dict) -> None:
    assert contexto["stubs"]["get"]()["sends"] == []


@then(parsers.parse('o worker publicou o evento "MessageBlocked" para o lead "{lead_id}"'))
def publicou_bloqueio(contexto: dict, lead_id: str) -> None:
    events = contexto["collector"].drain()
    matched = [e for e in events if e.get("event_type") == "MessageBlocked"]
    assert matched, f"esperava MessageBlocked entre {[e.get('event_type') for e in events]}"
    assert matched[-1].get("payload", {}).get("lead_id") == lead_id, matched[-1]
