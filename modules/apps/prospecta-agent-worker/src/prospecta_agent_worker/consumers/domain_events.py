"""Consumidor AMQP do fanout ``domain.events`` (eventos de domínio).

O domain-worker publica TODA transação aplicada nesse exchange (fanout, §4.3).
Este worker é o **núcleo agêntico**: consome ``ProspectRequested`` (abre o run),
``LeadQualified`` (redige a abordagem) e ``MessageApproved`` (envia) e delega ao
``ProspectaWorker.handle_domain_event`` -- o consumidor só entrega, a lógica
mora no worker, testável sem broker.

A fila é própria deste serviço (fanout entrega a TODAS as filas vinculadas, não
a um round-robin); entrega at-least-once, o handler é idempotente por
``event_id``/``command_id``. Uma mensagem ruim é rejeitada sem requeue infinito.
"""

from __future__ import annotations

import json
import logging

import aio_pika

from prospecta_agent_worker.worker import ProspectaWorker

log = logging.getLogger("prospecta-agent-worker")

EXCHANGE = "domain.events"
QUEUE = "prospecta.agent.events"


class DomainEventsConsumer:
    def __init__(self, rabbit_url: str, worker: ProspectaWorker, *, queue: str = QUEUE) -> None:
        self._url = rabbit_url
        self._worker = worker
        self._queue = queue

    async def _declare(self, channel: aio_pika.abc.AbstractChannel):
        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True)
        queue = await channel.declare_queue(self._queue, durable=True)
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
