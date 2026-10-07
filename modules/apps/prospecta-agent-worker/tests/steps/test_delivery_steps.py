"""Steps de delivery.feature.

O domínio é um RabbitMQ real (o teste publica no fanout ``domain.events``); a
Evolution e a prospecta-api são stubs HTTP reais; o e-mail sai por um SMTP real
(o servidor do container). O worker é o de verdade: o que se verifica é a
travessia de rede e os guardrails, não um dublê.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from steps.support import (
    EventCollector,
    build_worker,
    collected_events,
    consume_domain_one,
    delete_domain_queue,
    domain_envelope,
    publish_domain_event,
    unique_domain_queue,
)

scenarios("../features/delivery.feature")


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


@pytest.fixture
def domain_queue(rabbit_url):
    name = unique_domain_queue()
    try:
        yield name
    finally:
        delete_domain_queue(rabbit_url, name)


@given(parsers.parse('uma mensagem "{message_id}" aprovada no canal "{channel}" para "{to}"'))
def mensagem_aprovada(contexto: dict, stubs, stub_smtp, message_id: str, channel: str, to: str) -> None:
    lead_id = "lead-1"
    stubs["set"](
        sends=[],
        medias=[],
        optouts=[],
        leads={to: {"tenant_id": "tenant-1", "lead_id": lead_id, "thread_key": f"{channel}:{to}"}},
        messages={
            message_id: {
                "id": message_id,
                "tenant_id": "tenant-1",
                "lead_id": lead_id,
                "channel": channel,
                "content": "Olá, Carlos!",
                "status": "approved",
                "to": to,
            }
        },
        emails=[],
        runs=[],
        run_updates=[],
    )
    contexto["stubs"] = stubs
    contexto["smtp"] = stub_smtp
    contexto["message_id"] = message_id
    contexto["to"] = to
    contexto["channel"] = channel


@given(parsers.parse('um lead conhecido para o telefone "{phone}"'))
def lead_conhecido(contexto: dict, stubs, phone: str) -> None:
    stubs["set"](
        leads={phone: {"tenant_id": "tenant-1", "lead_id": "lead-1", "thread_key": f"wa:{phone}"}}
    )
    contexto["stubs"] = stubs


@given(parsers.parse('que o lead "{lead_id}" está em opt-out'))
def lead_optout(contexto: dict, lead_id: str) -> None:
    contexto["stubs"]["set"](optouts=[lead_id])


def _publish_approved(contexto: dict, rabbit_url, collector, domain_queue, message_id: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(
        contexto["stubs"]["base"], rabbit_url, smtp=contexto.get("smtp")
    )
    contexto["worker"] = worker
    publish_domain_event(
        rabbit_url,
        domain_envelope(
            "MessageApproved",
            {"message_id": message_id, "tenant_id": "tenant-1", "previous_status": "drafted", "status": "approved"},
            event_id=f"evt-m-{message_id}",
            command_id=f"cmd-m-{message_id}",
        ),
        queue=domain_queue,
    )
    consume_domain_one(rabbit_url, worker, queue=domain_queue)


@when(parsers.parse('o domínio publica o evento "MessageApproved" para a mensagem "{message_id}"'))
def publica_approved(contexto: dict, rabbit_url, collector, domain_queue, message_id: str) -> None:
    _publish_approved(contexto, rabbit_url, collector, domain_queue, message_id)


@when(parsers.parse('o domínio publica o evento "MessageApproved" duas vezes para a mensagem "{message_id}"'))
def publica_approved_duas(contexto: dict, rabbit_url, collector, domain_queue, message_id: str) -> None:
    contexto["collector"] = collector
    worker = build_worker(contexto["stubs"]["base"], rabbit_url, smtp=contexto.get("smtp"))
    contexto["worker"] = worker
    envelope = domain_envelope(
        "MessageApproved",
        {"message_id": message_id, "tenant_id": "tenant-1", "previous_status": "drafted", "status": "approved"},
        event_id=f"evt-m-{message_id}",
        command_id=f"cmd-m-{message_id}",
    )
    publish_domain_event(rabbit_url, envelope, queue=domain_queue)
    publish_domain_event(rabbit_url, envelope, queue=domain_queue)
    consume_domain_one(rabbit_url, worker, queue=domain_queue)
    consume_domain_one(rabbit_url, worker, queue=domain_queue)


@then(parsers.parse('a Evolution recebeu o texto "{text}" para o número "{number}"'))
def evolution_recebeu(contexto: dict, text: str, number: str) -> None:
    sends = contexto["stubs"]["get"]()["sends"]
    assert sends, "nenhum envio chegou à Evolution"
    assert sends[-1]["text"] == text, sends[-1]
    assert sends[-1]["number"] == number, sends[-1]


@then(parsers.parse('a Evolution recebeu o texto "{text}" uma vez'))
def evolution_recebeu_uma_vez(contexto: dict, text: str) -> None:
    sends = contexto["stubs"]["get"]()["sends"]
    matched = [s for s in sends if s["text"] == text]
    assert len(matched) == 1, f"esperava 1 envio, veio {len(matched)}: {sends}"


@then(parsers.parse('o SMTP recebeu um e-mail para "{to}"'))
def smtp_recebeu(contexto: dict, to: str) -> None:
    emails = contexto["stubs"]["get"]()["emails"]
    assert emails, "nenhum e-mail chegou ao SMTP"
    assert to in emails[-1]["to"], emails[-1]


@then(parsers.parse('o worker publicou o evento "MessageSent" para a mensagem "{message_id}"'))
def publicou_message_sent(contexto: dict, message_id: str) -> None:
    events = collected_events(contexto)
    matched = [e for e in events if e.get("event_type") == "MessageSent"]
    assert matched, f"esperava MessageSent entre {[e.get('event_type') for e in events]}"
    assert matched[-1].get("payload", {}).get("message_id") == message_id, matched[-1]
    assert matched[-1].get("payload", {}).get("external_id"), matched[-1]


@then("nenhum envio chegou à Evolution")
def nenhum_envio(contexto: dict) -> None:
    assert contexto["stubs"]["get"]()["sends"] == []


@then(parsers.parse('o worker publicou o evento "MessageBlocked" para o lead "{lead_id}"'))
def publicou_blocked(contexto: dict, lead_id: str) -> None:
    events = collected_events(contexto)
    matched = [e for e in events if e.get("event_type") == "MessageBlocked"]
    assert matched, f"esperava MessageBlocked entre {[e.get('event_type') for e in events]}"
    assert matched[-1].get("payload", {}).get("lead_id") == lead_id, matched[-1]
