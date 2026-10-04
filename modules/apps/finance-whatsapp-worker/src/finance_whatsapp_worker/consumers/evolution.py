"""Consumidor AMQP da fila ``evolution.messages.upsert``.

A Evolution publica todo evento no exchange topic ``evolution`` (routing key
``evolution.<evento>``) e mantém uma fila global por evento. O worker declara a
fila idempotentemente (``--ignore-existing`` equivalente) e a binda — assim um
worker que sobe antes da Evolution não perde a fila.

Só consome: nunca publica comando (§1.1). Uma mensagem que falha é rejeitada
sem requeue infinito (``nack(requeue=False)``) — o efeito é registrado no log,
e a entrega at-least-once da Evolution reentrega a próxima.
"""

from __future__ import annotations

import asyncio
import json
import logging

import aio_pika

from finance_whatsapp_worker.worker import EVENT_MESSAGES_UPSERT, Worker

log = logging.getLogger("finance-whatsapp-worker")

EXCHANGE = "evolution"
QUEUE = "evolution.messages.upsert"
ROUTING_KEY = "evolution.messages.upsert"
# A Evolution declara a fila como **quorum** (RABBITMQ_GLOBAL_ENABLED), não
# classic. Declarar como classic aqui explode com PRECONDITION_FAILED 406 no
# primeiro boot (a fila já existe, com outra arg) — então o worker declara com
# a MESMA arg, exatamente. Trocar este valor quebra o consumo contra a Evolution
# real (os testes declaram igual, para o verde local valer em produção).
QUEUE_ARGS = {"x-queue-type": "quorum"}


class EvolutionConsumer:
    def __init__(self, rabbit_url: str, worker: Worker) -> None:
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


def consume_forever(rabbit_url: str, worker: Worker) -> None:
    """Wrapper sincrono do loop, para o ``main``."""
    asyncio.run(EvolutionConsumer(rabbit_url, worker).run_forever())
