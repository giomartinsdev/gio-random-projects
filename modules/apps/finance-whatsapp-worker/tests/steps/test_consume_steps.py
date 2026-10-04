"""Steps de consume.feature.

O Evolution é um RabbitMQ real (o teste publica na fila `evolution.messages.
upsert` como ela faria) e a finance-api/gateway são um stub HTTP real (container).
O worker — clientes, NLU e consumidor — é o de verdade: o que se verifica é a
travessia de rede inteira, não um dublê dela.
"""

from __future__ import annotations

import asyncio
import json

import aio_pika
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from finance_whatsapp_worker.clients.finance_api import FinanceApiClient
from finance_whatsapp_worker.consumers.evolution import EvolutionConsumer
from finance_whatsapp_worker.gateway.evolution import EvolutionClient
from finance_whatsapp_worker.worker import Worker

scenarios("../features/consume.feature")

INSTANCE = "web-businesses"


@pytest.fixture
def contexto() -> dict:
    return {}


def _build_worker(stubs) -> Worker:
    return Worker(
        finance=FinanceApiClient(stubs["base"], "test-key", timeout=5),
        evolution=EvolutionClient(stubs["base"], "test-key", INSTANCE, timeout=5),
    )


def _publish(rabbit_url: str, event: dict) -> None:
    async def _go():
        conn = await aio_pika.connect_robust(rabbit_url)
        try:
            ch = await conn.channel()
            exchange = await ch.declare_exchange("evolution", aio_pika.ExchangeType.TOPIC, durable=True)
            # A Evolution declara a fila global por evento como **quorum**
            # (RABBITMQ_GLOBAL_ENABLED); sem os mesmos arguments um publish
            # antes do consumidor cairia no vazio, e o declare do worker
            # colidiria (quorum vs classic).
            queue = await ch.declare_queue(
                "evolution.messages.upsert", durable=True, arguments={"x-queue-type": "quorum"}
            )
            await queue.bind(exchange, routing_key="evolution.messages.upsert")
            await exchange.publish(
                aio_pika.Message(body=json.dumps(event).encode()),
                routing_key="evolution.messages.upsert",
            )
        finally:
            await conn.close()

    asyncio.run(_go())


def _consume_one(rabbit_url: str, worker: Worker) -> bool:
    async def _go():
        consumer = EvolutionConsumer(rabbit_url, worker)
        return await consumer.consume_one(timeout=8)

    return asyncio.run(_go())


def _upsert(text: str | None, phone: str, *, from_me: bool = False, event_id: str = "3AC082932BB9C4469FCB") -> dict:
    message = {"conversation": text} if text is not None else {"audioMessage": {"seconds": 3}}
    return {
        "event": "messages.upsert",
        "instance": INSTANCE,
        "data": {
            "key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": from_me, "id": event_id},
            "pushName": "Giovanni",
            "message": message,
            "messageTimestamp": 1791049374,
        },
    }


@given(parsers.parse('que a finance-api vai responder "{outcome}" com entity_id "{entity_id}"'))
def finance_outcome(contexto: dict, stubs, outcome: str, entity_id: str) -> None:
    stubs["set"](finance_outcome=outcome, entity_id=entity_id, gateway_fail=False, commands=[], sends=[])
    contexto["stubs"] = stubs


@given("que o gateway do WhatsApp vai falhar no envio")
def gateway_fail(contexto: dict) -> None:
    contexto["stubs"]["set"](gateway_fail=True)


DASHBOARD_BODY = {
    "user_id": "5521981962914", "month": "2026-10", "income": "1000.00", "expense": "-80.00",
    "net": "920.00", "currency": "BRL", "transaction_count": 2,
    "top_categories": [{"category": "Alimentação", "amount": "-80.00", "currency": "BRL", "transaction_count": 1}],
    "budgets": [],
}

CASHFLOW_BODY = {
    "user_id": "5521981962914", "month": "2026-10", "currency": "BRL",
    "days": [{"date": "2026-10-02", "income": "100.00", "expense": "-10.00", "net": "90.00"}],
}


@given(parsers.parse('que a leitura "{action}" devolve o resumo do mês'))
def leitura_resumo(contexto: dict, action: str) -> None:
    contexto["stubs"]["set"](queries={action: DASHBOARD_BODY})


@given(parsers.parse('que a leitura "{action}" devolve o fluxo de caixa'))
def leitura_cashflow(contexto: dict, action: str) -> None:
    contexto["stubs"]["set"](queries={action: CASHFLOW_BODY})


def _run(contexto: dict, rabbit_url, event: dict) -> None:
    _publish(rabbit_url, event)
    worker = _build_worker(contexto["stubs"])
    contexto["worker"] = worker
    _consume_one(rabbit_url, worker)


@when(parsers.parse('chega a mensagem "{text}" do telefone "{phone}"'))
def chega_mensagem(contexto: dict, rabbit_url, text: str, phone: str) -> None:
    _run(contexto, rabbit_url, _upsert(text, phone))


@when(parsers.parse('chega uma mensagem fromMe "{text}"'))
def chega_fromme(contexto: dict, rabbit_url, text: str) -> None:
    _run(contexto, rabbit_url, _upsert(text, "5521982397951", from_me=True))


@when(parsers.parse('chega um evento "{event}"'))
def chega_evento(contexto: dict, rabbit_url, event: str) -> None:
    _run(contexto, rabbit_url, {"event": event, "instance": INSTANCE, "data": {}})


@when(parsers.parse('chega a mensagem sem texto do telefone "{phone}"'))
def chega_sem_texto(contexto: dict, rabbit_url, phone: str) -> None:
    _run(contexto, rabbit_url, _upsert(None, phone))


@when(parsers.parse('chega a mesma mensagem "{text}" do telefone "{phone}" duas vezes'))
def chega_duas_vezes(contexto: dict, rabbit_url, text: str, phone: str) -> None:
    event = _upsert(text, phone, event_id="dup-1")
    worker = _build_worker(contexto["stubs"])
    contexto["worker"] = worker
    _publish(rabbit_url, event)
    _publish(rabbit_url, event)
    # Consome as DUAS entregas com o MESMO worker (o `seen` é do worker).
    _consume_one(rabbit_url, worker)
    _consume_one(rabbit_url, worker)


@then(parsers.parse('a finance-api recebeu o comando "{action}"'))
def recebeu_comando(contexto: dict, action: str) -> None:
    cmds = contexto["stubs"]["get"]()["commands"]
    assert cmds, "nenhum comando chegou à finance-api"
    assert cmds[-1]["action"] == action, cmds[-1]


@then(parsers.parse('a finance-api recebeu o comando "{action}" uma vez'))
def recebeu_uma_vez(contexto: dict, action: str) -> None:
    cmds = [c for c in contexto["stubs"]["get"]()["commands"] if c["action"] == action]
    assert len(cmds) == 1, f"esperava 1 comando {action}, veio {len(cmds)}: {cmds}"


@then(parsers.parse('o worker enviou a resposta para "{phone}"'))
def enviou_resposta(contexto: dict, phone: str) -> None:
    sends = contexto["stubs"]["get"]()["sends"]
    assert sends, "nenhuma resposta foi enviada ao gateway"
    assert sends[-1]["number"] == phone, sends[-1]
    assert sends[-1]["instance"] == INSTANCE


@then(parsers.parse('a resposta menciona "{needle}"'))
def resposta_menciona(contexto: dict, needle: str) -> None:
    sends = contexto["stubs"]["get"]()["sends"]
    assert needle in sends[-1]["text"], sends[-1]["text"]


@then("nenhum comando foi enviado à finance-api")
def nenhum_comando(contexto: dict) -> None:
    assert contexto["stubs"]["get"]()["commands"] == []


@then(parsers.parse('a finance-api recebeu a leitura "{action}"'))
def recebeu_leitura(contexto: dict, action: str) -> None:
    seen = contexto["stubs"]["get"]()["queries_seen"]
    assert seen, "nenhuma leitura chegou à finance-api"
    assert seen[-1]["action"] == action, seen[-1]


@then(parsers.parse('o worker enviou uma mídia para "{phone}"'))
def enviou_midia(contexto: dict, phone: str) -> None:
    medias = contexto["stubs"]["get"]()["medias"]
    assert medias, "nenhuma mídia foi enviada ao gateway"
    assert medias[-1]["number"] == phone, medias[-1]
    assert medias[-1]["instance"] == INSTANCE


@then("a mídia é um PNG")
def midia_png(contexto: dict) -> None:
    import base64

    media = contexto["stubs"]["get"]()["medias"][-1]
    assert media["mimetype"] == "image/png", media
    raw = base64.b64decode(media["media"])
    assert raw.startswith(b"\x89PNG\r\n\x1a\n"), "a mídia não é um PNG"
