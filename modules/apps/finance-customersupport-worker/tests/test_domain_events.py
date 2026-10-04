"""Integração do atendimento proativo: tópico ``domain.events`` → WhatsApp.

O RabbitMQ é real (fixture do conftest) e o gateway/finance-api são o stub HTTP
real. O que se prova é a travessia: um evento de domínio publicado no exchange
``domain.events`` faz o worker mandar a mensagem ao cliente pelo Evolution.
"""

from __future__ import annotations

import asyncio
import json

import aio_pika
import pytest

from finance_customersupport_worker.clients.finance_api import FinanceApiClient
from finance_customersupport_worker.consumers.domain_events import DomainEventsConsumer
from finance_customersupport_worker.gateway.evolution import EvolutionClient
from finance_customersupport_worker.worker import Worker

INSTANCE = "web-businesses"


def _build_worker(stubs) -> Worker:
    return Worker(
        finance=FinanceApiClient(stubs["base"], "test-key", timeout=5),
        evolution=EvolutionClient(stubs["base"], "test-key", INSTANCE, timeout=5),
    )


def _publish_event(rabbit_url: str, event: dict) -> None:
    async def _go():
        conn = await aio_pika.connect_robust(rabbit_url)
        try:
            ch = await conn.channel()
            exchange = await ch.declare_exchange("domain.events", aio_pika.ExchangeType.FANOUT, durable=True)
            # Fanout sem fila vinculada DESCARTA a mensagem; declara e binda a
            # fila do consumidor ANTES de publicar (o worker faz o mesmo no
            # _declare, e em produção ele sobe antes dos eventos).
            queue = await ch.declare_queue("finance.customersupport.events", durable=True)
            await queue.bind(exchange, routing_key="")
            await exchange.publish(aio_pika.Message(body=json.dumps(event).encode()), routing_key="")
        finally:
            await conn.close()

    asyncio.run(_go())


def _consume_one(rabbit_url: str, worker: Worker) -> bool:
    async def _go():
        return await DomainEventsConsumer(rabbit_url, worker).consume_one(timeout=8)

    return asyncio.run(_go())


def _envelope(event_name: str, payload: dict, *, command_id: str = "cmd-evt-1", event_id: str = "evt-1") -> dict:
    return {
        "event_id": event_id,
        "command_id": command_id,
        "event_name": event_name,
        "occurred_at": "2026-10-04T12:00:00Z",
        "payload": payload,
    }


def test_domain_event_confirms_transaction_to_the_customer(rabbit_url, stubs):
    stubs["set"](commands=[], queries_seen=[], sends=[], medias=[], queries={})
    event = _envelope(
        "finance.transaction.registered",
        {"user_id": "5521981962914", "transaction_type": "EXPENSE", "amount": "-45.00", "category": "Alimentação"},
    )
    _publish_event(rabbit_url, event)
    worker = _build_worker(stubs)
    assert _consume_one(rabbit_url, worker) is True

    sends = stubs["get"]()["sends"]
    assert sends, "o worker devia ter avisado o cliente"
    assert sends[-1]["number"] == "5521981962914"
    assert "Despesa" in sends[-1]["text"]


def test_budget_threshold_event_warns_the_customer(rabbit_url, stubs):
    stubs["set"](commands=[], queries_seen=[], sends=[], medias=[], queries={})
    event = _envelope(
        "finance.budget.thresholdReached",
        {"user_id": "5521981962914", "category": "Alimentação", "threshold": 100,
         "spent_amount": "-110.00", "limit_amount": "100.00", "currency": "BRL"},
        command_id="cmd-evt-2",
    )
    _publish_event(rabbit_url, event)
    worker = _build_worker(stubs)
    assert _consume_one(rabbit_url, worker) is True
    sends = stubs["get"]()["sends"]
    assert sends and "100%" in sends[-1]["text"]


def test_replayed_event_has_no_second_effect(rabbit_url, stubs):
    stubs["set"](commands=[], queries_seen=[], sends=[], medias=[], queries={})
    event = _envelope(
        "finance.transaction.registered",
        {"user_id": "5521981962914", "transaction_type": "INCOME", "amount": "3500.00", "category": "Renda Extra"},
        command_id="cmd-evt-dup",
    )
    worker = _build_worker(stubs)
    # Duas entregas com o MESMO worker ⇒ efeito único (idempotente por command_id).
    _publish_event(rabbit_url, event)
    _publish_event(rabbit_url, event)
    _consume_one(rabbit_url, worker)
    _consume_one(rabbit_url, worker)
    assert len(stubs["get"]()["sends"]) == 1


def test_event_without_user_id_is_ignored(rabbit_url, stubs):
    stubs["set"](commands=[], queries_seen=[], sends=[], medias=[], queries={})
    _publish_event(rabbit_url, _envelope("finance.transaction.registered", {"transaction_type": "EXPENSE", "amount": "-1.00"}))
    worker = _build_worker(stubs)
    _consume_one(rabbit_url, worker)
    assert stubs["get"]()["sends"] == []


def test_unrelated_event_is_ignored(rabbit_url, stubs):
    stubs["set"](commands=[], queries_seen=[], sends=[], medias=[], queries={})
    _publish_event(rabbit_url, _envelope("clubs.something.happened", {"user_id": "5521981962914"}))
    worker = _build_worker(stubs)
    assert _consume_one(rabbit_url, worker) is True
    assert stubs["get"]()["sends"] == []
