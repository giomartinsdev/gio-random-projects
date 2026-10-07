"""Publicação de eventos próprios do worker no exchange fanout ``domain.events``.

O worker é consumidor do Evolution, mas também é **produtor** dos eventos do
Prospecta (`ReplyReceived`, `MessageBlocked`, ...) -- é o contrato
(contracts/prospecta-agent-worker.md §Saídas): o agente observa e traduz. O
envelope segue ``DomainEvent.to_wire`` de ``prospecta-contracts`` (event_id,
command_id, event_type, occurred_at, schema_version, payload), para o
``domain-worker`` casar o mesmo shape e ser idempotente por ``command_id``.

Nenhum outro exchange é usado: nada de broker próprio (§1.1).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import uuid4

import aio_pika

from prospecta_contracts import EVENT_SCHEMA_VERSION

EXCHANGE = "domain.events"


class EventPublisher:
    def __init__(self, rabbit_url: str) -> None:
        self._url = rabbit_url

    async def publish(self, event_type: str, payload: dict, *, command_id: str = "") -> str:
        """Publica um evento e devolve o ``event_id`` gerado.

        O exchange é o fanout durável ``domain.events`` (o mesmo do
        domain-worker); a fila é de cada consumidor -- o worker não declara uma
        fila de leitura aqui, só publica.
        """
        event_id = str(uuid4())
        body = {
            "event_id": event_id,
            "command_id": command_id or event_id,
            "event_type": event_type,
            "occurred_at": datetime.now(UTC).isoformat(),
            "schema_version": EVENT_SCHEMA_VERSION,
            "payload": dict(payload),
        }
        connection = await aio_pika.connect_robust(self._url)
        try:
            channel = await connection.channel()
            exchange = await channel.declare_exchange(EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True)
            await exchange.publish(
                aio_pika.Message(
                    body=json.dumps(body).encode(),
                    content_type="application/json",
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                ),
                routing_key="",
            )
        finally:
            await connection.close()
        return event_id
