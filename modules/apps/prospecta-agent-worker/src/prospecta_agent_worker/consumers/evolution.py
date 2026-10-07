"""Consumidor AMQP da fila ``evolution.messages.upsert``.

A Evolution publica todo evento no exchange topic ``evolution`` (routing key
``evolution.<evento>``) e mantém uma fila global por evento. O worker declara a
fila idempotentemente (``--ignore-existing`` equivalente) e a binda -- assim um
worker que sobe antes da Evolution não perde a fila.

A fila é declarada como **quorum** (a Evolution a cria com
``RABBITMQ_GLOBAL_ENABLED``): declarar como classic explode com
``PRECONDITION_FAILED 406`` no primeiro boot. Trocar este valor quebra o consumo
contra a Evolution real (os testes declaram igual, para o verde local valer em
produção).

O parse é do payload v2.3.7 e a tradução para o evento de domínio vive no
``ProspectaWorker`` -- o consumidor só entrega. Uma mensagem que falha é
rejeitada sem requeue infinito (``nack(requeue=False)``).
"""

from __future__ import annotations

import asyncio
import json
import logging

import aio_pika

from prospecta_agent_worker.worker import ProspectaWorker

log = logging.getLogger("prospecta-agent-worker")

EXCHANGE = "evolution"
QUEUE = "evolution.messages.upsert"
ROUTING_KEY = "evolution.messages.upsert"
QUEUE_ARGS = {"x-queue-type": "quorum"}


class EvolutionConsumer:
    def __init__(self, rabbit_url: str, worker: ProspectaWorker) -> None:
        self._url = rabbit_url
        self._worker = worker

    async def _declare(self, channel: aio_pika.abc.AbstractChannel):
        exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
        queue = await channel.declare_queue(QUEUE, durable=True, arguments=QUEUE_ARGS)
        await queue.bind(exchange, routing_key=ROUTING_KEY)
        return queue

    async def consume_one(self, *, timeout: float = 8.0) -> bool:
        """Consome e processa UMA mensagem (usado pelos testes).

        Devolve ``True`` se uma mensagem foi processada, ``False`` no timeout.
        """
        connection = await aio_pika.connect_robust(self._url)
        try:
            channel = await connection.channel()
            await channel.set_qos(prefetch_count=1)
            queue = await self._declare(channel)
            msg = await queue.get(timeout=timeout, fail=False)
            if msg is None:
                return False
            async with msg.process(requeue=False):
                await self._worker.handle(json.loads(msg.body))
            return True
        finally:
            await connection.close()

    async def run_forever(self) -> None:
        """Loop de produção: consume a fila continuamente."""
        connection = await aio_pika.connect_robust(self._url)
        channel = await connection.channel()
        await channel.set_qos(prefetch_count=4)
        queue = await self._declare(channel)
        log.info("consumindo %s (exchange %s)", QUEUE, EXCHANGE)
        async with queue.iterator() as it:
            async for msg in it:
                async with msg.process(requeue=False):
                    try:
                        await self._worker.handle(json.loads(msg.body))
                    except Exception as exc:  # noqa: BLE001 -- uma mensagem ruim não para o loop
                        log.error("evento inválido descartado: %s", exc)
