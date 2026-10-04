"""Consumidor AMQP do tópico ``domain.events`` (eventos de domínio).

O domain-worker publica TODA transação aplicada nesse exchange (fanout,
§4.3/§12.5). Este worker é o **encarregado do atendimento**: ele consome a fila
e manda a mensagem proativa ao cliente (confirmação, alerta de orçamento). A
entrega é at-least-once; o handler é idempotente por ``command_id``/``event_id``.

Só consome: nunca publica (§1.1).
"""

from __future__ import annotations

import asyncio
import json
import logging

import aio_pika

from finance_customersupport_worker.worker import Worker

log = logging.getLogger("finance-customersupport-worker")

# Os mesmos nomes do domain-worker (internal/infrastructure/amqp/amqp.go). O
# fanout não casa routing key; a fila é própria deste consumidor (cada serviço
# que assina tem a sua, senão competem pela mesma mensagem — fanout entrega a
# TODAS as filas vinculadas, não a um round-robin).
EXCHANGE = "domain.events"
QUEUE = "finance.customersupport.events"
CONSUMER_TAG = "finance-customersupport-worker"


class DomainEventsConsumer:
    def __init__(self, rabbit_url: str, worker: Worker) -> None:
        self._url = rabbit_url
        self._worker = worker

    async def _declare(self, channel: aio_pika.abc.AbstractChannel):
        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True)
        queue = await channel.declare_queue(QUEUE, durable=True)
        await queue.bind(exchange, routing_key="")
        return queue

    async def consume_one(self, *, timeout: float = 8.0) -> bool:
        """Consome e processa UM evento (usado pelos testes)."""
        connection = await aio_pika.connect_robust(self._url)
        try:
            channel = await connection.channel()
            await channel.set_qos(prefetch_count=1)
            queue = await self._declare(channel)
            msg = await queue.get(timeout=timeout, fail=False)
            if msg is None:
                return False
            async with msg.process(requeue=False):
                await self._worker.handle_domain_event(json.loads(msg.body))
            return True
        finally:
            await connection.close()

    async def run_forever(self) -> None:
        connection = await aio_pika.connect_robust(self._url)
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=4)
        queue = await self._declare(channel)
        log.info("consumindo %s (exchange %s)", QUEUE, EXCHANGE)
        async with queue.iterator() as it:
            async for msg in it:
                async with msg.process(requeue=False):
                    try:
                        await self._worker.handle_domain_event(json.loads(msg.body))
                    except Exception as exc:  # noqa: BLE001 -- um evento ruim não para o loop
                        log.error("evento de domínio inválido descartado: %s", exc)


def consume_domain_events_forever(rabbit_url: str, worker: Worker) -> None:
    asyncio.run(DomainEventsConsumer(rabbit_url, worker).run_forever())
