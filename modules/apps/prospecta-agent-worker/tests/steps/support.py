"""Helpers compartilhados pelos steps do prospecta-agent-worker.

O Evolution é um publicador AMQP real (o teste publica na fila
``evolution.messages.upsert`` como ele faria); a Evolution, o 9router e a
prospecta-api são stubs HTTP reais (um container). O worker é o de verdade: o
que se verifica é a travessia de rede inteira, não um dublê dela.

O worker PUBLICA os próprios eventos de domínio (``ReplyReceived``,
``MessageBlocked``, ...) no exchange fanout ``domain.events`` -- é o contrato
(worker.md §Saídas), diferente do worker financeiro, que só consome. O
``EventCollector`` declara uma fila efêmera nesse exchange ANTES de disparar o
worker, para ler o que ele publicou sem competir com o consumidor real.
"""

from __future__ import annotations

import asyncio
import json
import time
from uuid import uuid4

import aio_pika

from prospecta_agent_worker.bus import EventPublisher
from prospecta_agent_worker.clients.prospecta_api import ProspectaApiClient
from prospecta_agent_worker.consumers.evolution import EvolutionConsumer
from prospecta_agent_worker.gateway.evolution import EvolutionClient
from prospecta_agent_worker.gateway.ninerouter import NineRouterClient
from prospecta_agent_worker.worker import ProspectaWorker
from prospecta_agent_worker.consumers.domain_events import DomainEventsConsumer
INSTANCE = "web-businesses"
EVOLUTION_EXCHANGE = "evolution"
EVOLUTION_QUEUE = "evolution.messages.upsert"
EVOLUTION_ROUTING_KEY = "evolution.messages.upsert"
# A Evolution declara a fila como **quorum**; sem os mesmos arguments o declare
# colide (PRECONDITION_FAILED) contra a Evolution real.
QUEUE_ARGS = {"x-queue-type": "quorum"}
DOMAIN_EVENTS_EXCHANGE = "domain.events"
DOMAIN_QUEUE = "prospecta.agent.events"


def build_worker(
    base: str,
    rabbit_url: str,
    *,
    approval_policy: str = "human",
    smtp: str | None = None,
    search_api_key: str = "test-search-key",
    search_provider: str = "brave",
    enrich_provider: str = "http",
) -> ProspectaWorker:
    from prospecta_agent_worker.agents.tools import EnrichCompany, WebScrape, WebSearch
    from prospecta_agent_worker.gateway.email import SmtpEmailClient

    email = None
    if smtp:
        host, _, port = smtp.partition(":")
        email = SmtpEmailClient(host=host, port=int(port), sender="agente@prospecta.dev")
    return ProspectaWorker(
        evolution=EvolutionClient(base, "test-evolution-key", INSTANCE, timeout=5),
        ninerouter=NineRouterClient(base, "test-9router-key", timeout=3, max_attempts=3, backoff=0.01),
        api=ProspectaApiClient(base, "test-prospecta-key", timeout=5),
        events=EventPublisher(rabbit_url),
        approval_policy=approval_policy,
        search=WebSearch(
            base_url=base, provider=search_provider, api_key=search_api_key, timeout=3
        ),
        scrape=WebScrape(timeout=3),
        enrich=EnrichCompany(
            base_url=base,
            api_key="test-enrich-key",
            provider=enrich_provider,
            cnpj_url=base + "/cnpj",
            timeout=3,
        ),
        email=email,
    )


def upsert_event(
    text: str | None,
    phone: str,
    *,
    from_me: bool = False,
    extended: bool = False,
    message_id: str = "3AC082932BB9C4469FCB",
) -> dict:
    if text is None:
        message = {"audioMessage": {"seconds": 3}}
    elif extended:
        message = {"extendedTextMessage": {"text": text}}
    else:
        message = {"conversation": text}
    return {
        "event": "messages.upsert",
        "instance": INSTANCE,
        "data": {
            "key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": from_me, "id": message_id},
            "pushName": "Carlos Menezes",
            "message": message,
            "messageTimestamp": 1759800000,
        },
    }


def group_event(group_id: str, text: str = "oi grupo") -> dict:
    return {
        "event": "messages.upsert",
        "instance": INSTANCE,
        "data": {
            "key": {"remoteJid": f"{group_id}@g.us", "fromMe": False, "id": "grp-1"},
            "pushName": "Grupo",
            "message": {"conversation": text},
            "messageTimestamp": 1759800000,
        },
    }


def publish_evolution(rabbit_url: str, event: dict) -> None:
    async def _go() -> None:
        conn = await aio_pika.connect_robust(rabbit_url)
        try:
            ch = await conn.channel()
            exchange = await ch.declare_exchange(EVOLUTION_EXCHANGE, aio_pika.ExchangeType.TOPIC, durable=True)
            queue = await ch.declare_queue(EVOLUTION_QUEUE, durable=True, arguments=QUEUE_ARGS)
            await queue.bind(exchange, routing_key=EVOLUTION_ROUTING_KEY)
            await exchange.publish(
                aio_pika.Message(body=json.dumps(event).encode(), content_type="application/json"),
                routing_key=EVOLUTION_ROUTING_KEY,
            )
        finally:
            await conn.close()

    asyncio.run(_go())


def consume_evolution_one(rabbit_url: str, worker: ProspectaWorker) -> bool:
    async def _go() -> bool:
        return await EvolutionConsumer(rabbit_url, worker).consume_one(timeout=8)

    return asyncio.run(_go())


def publish_domain_event(rabbit_url: str, event: dict, *, queue: str = DOMAIN_QUEUE) -> None:
    """Publica um evento de domínio no fanout ``domain.events``.

    Declara e binda a fila do consumidor ANTES de publicar: fanout sem fila
    vinculada descarta a mensagem. O nome da fila é passado pelo cenário para
    NÃO compartilhar uma fila durável entre testes (o worker publica os próprios
    eventos NESTE fanout; uma fila fixa acumularia mensagens de um teste no
    próximo).
    """

    async def _go() -> None:
        conn = await aio_pika.connect_robust(rabbit_url)
        try:
            ch = await conn.channel()
            exchange = await ch.declare_exchange(
                DOMAIN_EVENTS_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True
            )
            q = await ch.declare_queue(queue, durable=True)
            await q.bind(exchange, routing_key="")
            await exchange.publish(
                aio_pika.Message(body=json.dumps(event).encode(), content_type="application/json"),
                routing_key="",
            )
        finally:
            await conn.close()

    asyncio.run(_go())


def consume_domain_one(rabbit_url: str, worker: ProspectaWorker, *, queue: str = DOMAIN_QUEUE) -> bool:
    async def _go() -> bool:
        return await DomainEventsConsumer(rabbit_url, worker, queue=queue).consume_one(timeout=8)

    return asyncio.run(_go())


def domain_envelope(
    event_type: str,
    payload: dict,
    *,
    event_id: str = "evt-1",
    command_id: str = "cmd-1",
) -> dict:
    return {
        "event_id": event_id,
        "command_id": command_id,
        "event_type": event_type,
        "occurred_at": "2026-10-07T12:00:00Z",
        "schema_version": "1",
        "payload": payload,
    }


def prospect_requested_envelope(
    campaign_id: str,
    *,
    run_id: str = "run-from-event",
    tenant_id: str = "tenant-1",
    agent: str = "prospector",
    event_id: str = "evt-req-1",
    command_id: str = "cmd-req-1",
) -> dict:
    """O `ProspectRequested` como o DOMÍNIO publica: já carrega o `run_id` criado.

    O worker NÃO abre run (`POST /agent/runs`) -- ele só atualiza o run que veio
    no evento (`POST /agent/runs/{id}`). O `run_id` é o ponto de amarração.
    """
    return domain_envelope(
        "ProspectRequested",
        {
            "campaign_id": campaign_id,
            "tenant_id": tenant_id,
            "agent": agent,
            "run_id": run_id,
        },
        event_id=event_id,
        command_id=command_id,
    )


def unique_domain_queue() -> str:
    """Uma fila de consumidor NOVA por cenário.

    A fila do agente é durável e o fanout entrega a TODAS as filas vinculadas --
    o worker publica os próprios eventos nesse mesmo exchange. Uma fila fixa
    acumularia o output de um teste no consumidor do próximo. Cada cenário usa a
    sua e a descarta ao fim.
    """
    return f"test.prospecta.domain.{uuid4()}"


def delete_domain_queue(rabbit_url: str, queue: str) -> None:
    async def _go() -> None:
        conn = await aio_pika.connect_robust(rabbit_url)
        try:
            ch = await conn.channel()
            await ch.queue_delete(queue)
        finally:
            await conn.close()

    try:
        asyncio.run(_go())
    except Exception:  # noqa: BLE001 -- limpeza best-effort
        pass


class EventCollector:
    """Fila nomeada no `domain.events` para ler os eventos que o worker publica.

    Abre e fecha a conexão em cada operação: um objeto aio-pika fica preso ao
    event loop que o criou, e cada step roda o seu próprio ``asyncio.run``. A
    fila é durável e nomeada, então sobrevive entre as chamadas -- ``open`` a
    declara antes do worker publicar, ``drain`` lê o que ficou.
    """

    def __init__(self, rabbit_url: str) -> None:
        self._url = rabbit_url
        self._name = f"test.prospecta.events.{uuid4()}"

    def open(self) -> None:
        async def _go() -> None:
            conn = await aio_pika.connect_robust(self._url)
            try:
                ch = await conn.channel()
                exchange = await ch.declare_exchange(
                    DOMAIN_EVENTS_EXCHANGE, aio_pika.ExchangeType.FANOUT, durable=True
                )
                queue = await ch.declare_queue(self._name, durable=True)
                await queue.bind(exchange, routing_key="")
            finally:
                await conn.close()

        asyncio.run(_go())

    def drain(self, *, timeout: float = 3.0) -> list[dict]:
        async def _go() -> list[dict]:
            conn = await aio_pika.connect_robust(self._url)
            try:
                ch = await conn.channel()
                queue = await ch.declare_queue(self._name, durable=True)
                events: list[dict] = []
                deadline = time.monotonic() + timeout
                silent = 0
                while time.monotonic() < deadline:
                    wait = 0.5 if not events else 0.2
                    msg = await queue.get(timeout=wait, fail=False)
                    if msg is None:
                        # Sem NADA ainda, segue até o deadline (um publish pode
                        # chegar depois da primeira janela). Com algo já lido,
                        # só encerra após uma janela de silêncio -- um publish
                        # (ex.: MessageDrafted) chega a um round-trip de
                        # distância do LeadQualified lido antes.
                        silent += 1
                        if events and silent >= 2:
                            break
                        continue
                    silent = 0
                    async with msg.process(requeue=False):
                        events.append(json.loads(msg.body))
                return events
            finally:
                await conn.close()

        return asyncio.run(_go())

    def close(self) -> None:
        async def _go() -> None:
            conn = await aio_pika.connect_robust(self._url)
            try:
                ch = await conn.channel()
                await ch.queue_delete(self._name)
            finally:
                await conn.close()

        try:
            asyncio.run(_go())
        except Exception:  # noqa: BLE001 -- limpeza best-effort
            pass


def collected_events(contexto: dict, *, timeout: float = 3.0) -> list[dict]:
    """Drena UMA vez e cacheia no contexto do cenário.

    ``EventCollector.drain`` é destrutivo; vários ``Então`` no mesmo cenário
    (ex.: espera ``LeadDiscovered`` E ``LeadEnriched``) leriam a fila esvaziada
    no segundo. O cache torna as asserções idempotentes dentro do cenário.
    """
    if "events" not in contexto:
        contexto["events"] = contexto["collector"].drain(timeout=timeout)
    return contexto["events"]
