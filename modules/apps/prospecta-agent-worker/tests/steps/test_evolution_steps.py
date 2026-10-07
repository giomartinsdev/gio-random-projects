"""Steps de evolution.feature.

O Evolution é um RabbitMQ real (o teste publica na fila como ele faria) e a
prospecta-api é um stub HTTP real (container). O worker -- consumidor, clientes
e publicador de eventos -- é o de verdade: o que se verifica é a travessia de
rede inteira.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from steps.support import (
    EventCollector,
    build_worker,
    consume_evolution_one,
    group_event,
    publish_evolution,
    upsert_event,
)

scenarios("../features/evolution.feature")


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


@when(parsers.parse('o Evolution publica a mensagem "{text}" do telefone "{phone}"'))
def publica_conversation(contexto: dict, stubs, rabbit_url, collector, text: str, phone: str) -> None:
    contexto["stubs"] = stubs
    contexto["collector"] = collector
    publish_evolution(rabbit_url, upsert_event(text, phone))
    contexto["worker"] = build_worker(stubs["base"], rabbit_url)
    consume_evolution_one(rabbit_url, contexto["worker"])


@when(parsers.parse('o Evolution publica a mensagem estendida "{text}" do telefone "{phone}"'))
def publica_extended(contexto: dict, stubs, rabbit_url, collector, text: str, phone: str) -> None:
    contexto["stubs"] = stubs
    contexto["collector"] = collector
    publish_evolution(rabbit_url, upsert_event(text, phone, extended=True))
    contexto["worker"] = build_worker(stubs["base"], rabbit_url)
    consume_evolution_one(rabbit_url, contexto["worker"])


@when(parsers.parse('o Evolution publica uma mensagem fromMe do telefone "{phone}"'))
def publica_fromme(contexto: dict, stubs, rabbit_url, collector, phone: str) -> None:
    contexto["stubs"] = stubs
    contexto["collector"] = collector
    publish_evolution(rabbit_url, upsert_event("Mensagem do bot", phone, from_me=True))
    contexto["worker"] = build_worker(stubs["base"], rabbit_url)
    consume_evolution_one(rabbit_url, contexto["worker"])


@when(parsers.parse('o Evolution publica uma mensagem do grupo "{group_id}"'))
def publica_grupo(contexto: dict, stubs, rabbit_url, collector, group_id: str) -> None:
    contexto["stubs"] = stubs
    contexto["collector"] = collector
    publish_evolution(rabbit_url, group_event(group_id))
    contexto["worker"] = build_worker(stubs["base"], rabbit_url)
    consume_evolution_one(rabbit_url, contexto["worker"])


@then(parsers.parse('o worker publicou o evento "{event_type}" para o telefone "{phone}"'))
def publicou_para_telefone(contexto: dict, event_type: str, phone: str) -> None:
    events = contexto["collector"].drain()
    matched = [e for e in events if e.get("event_type") == event_type]
    assert matched, f"esperava {event_type} entre {[e.get('event_type') for e in events]}"
    payload = matched[-1].get("payload", {})
    assert payload.get("thread_key") == f"wa:{phone}", payload
    assert payload.get("direction") == "in", payload


@then("o worker não publicou nenhum evento")
def nenhum_evento(contexto: dict) -> None:
    events = contexto["collector"].drain(timeout=1.5)
    assert events == [], f"esperava silêncio, veio {[e.get('event_type') for e in events]}"
