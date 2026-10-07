"""Steps de ninerouter.feature.

O 9router é um stub HTTP real (container): o path, o header ``Authorization`` e
o corpo vão pela rede de verdade, e a política de retry é exercitada contra um
5xx real, não um mock do ``httpx``.
"""

from __future__ import annotations

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from prospecta_agent_worker.gateway.ninerouter import NineRouterClient

from steps.support import build_worker

scenarios("../features/ninerouter.feature")


@pytest.fixture
def contexto() -> dict:
    return {}


def _client(stubs) -> NineRouterClient:
    return NineRouterClient(
        stubs["base"],
        "test-9router-key",
        timeout=3,
        max_attempts=3,
        backoff=0.01,
    )


@given("que o 9router responde com sucesso")
def responde_sucesso(contexto: dict, stubs) -> None:
    stubs["set"](ninerouter={"status": 200, "fail_times": 0, "calls": []})
    contexto["stubs"] = stubs


@given("que o 9router falha 2 vezes e depois responde com sucesso")
def responde_apos_2(contexto: dict, stubs) -> None:
    stubs["set"](ninerouter={"status": 200, "fail_times": 2, "calls": []})
    contexto["stubs"] = stubs


@given("que o 9router responde 500 permanentemente")
def responde_500(contexto: dict, stubs) -> None:
    stubs["set"](ninerouter={"status": 500, "fail_times": 0, "calls": []})
    contexto["stubs"] = stubs


@when(parsers.parse('o cliente pede um completion com o modelo "{model}"'))
def pede_completion(contexto: dict, model: str) -> None:
    client = _client(contexto["stubs"])
    contexto["error"] = None
    try:
        contexto["result"] = _run(client.complete(model, [{"role": "user", "content": "Olá"}]))
    except Exception as exc:  # noqa: BLE001 -- o cenário negativo espera o erro
        contexto["error"] = exc
        contexto["result"] = None


@then(parsers.parse('o completion tem o conteúdo "{content}"'))
def completion_conteudo(contexto: dict, content: str) -> None:
    assert contexto["error"] is None, contexto["error"]
    assert contexto["result"]["choices"][0]["message"]["content"] == content


@then(parsers.parse('o 9router recebeu a chamada em "{path}" com o modelo "{model}"'))
def recebeu_chamada(contexto: dict, path: str, model: str) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert calls, "nenhuma chamada chegou ao 9router"
    assert calls[-1]["path"].endswith(path), calls[-1]
    assert calls[-1]["model"] == model, calls[-1]


@then("a chamada não usou streaming")
def sem_streaming(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert calls[-1]["stream"] is False, calls[-1]


@then("o 9router recebeu 3 chamadas")
def recebeu_3(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert len(calls) == 3, f"esperava 3 chamadas (1 + 2 retries), veio {len(calls)}"


@then("o cliente levanta erro de 9router")
def levanta_erro(contexto: dict) -> None:
    assert contexto["error"] is not None, "esperava erro após esgotar os retries"


@then("o 9router recebeu menos de 10 chamadas")
def menos_de_10(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    assert len(calls) < 10, f"retry infinito suspeito: {len(calls)} chamadas"


@when(parsers.parse('o worker redige com PII no contexto e no telefone "{phone}"'))
def redige_com_pii(contexto: dict, phone: str) -> None:
    worker = build_worker(contexto["stubs"]["base"], "amqp://guest:guest@localhost/")
    worker.draft_sync(
        model="gpt-4o-mini",
        context={
            "empresa": "Northwind",
            "decisor_email": "carlos@northwind.com.br",
            "whatsapp": phone,
        },
        instruction="Redija uma abordagem curta.",
    )


@then(parsers.parse('a chamada ao 9router não contém "{a}" nem "{b}"'))
def chamada_sem_pii(contexto: dict, a: str, b: str) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    import json as _json

    raw = _json.dumps(calls[-1]["messages"])
    assert a not in raw, raw
    assert b not in raw, raw


@then("a chamada ao 9router contém os marcadores de PII")
def chamada_com_marcadores(contexto: dict) -> None:
    calls = contexto["stubs"]["get"]()["ninerouter"]["calls"]
    import json as _json

    raw = _json.dumps(calls[-1]["messages"])
    assert "[EMAIL]" in raw and "[PHONE]" in raw, raw


def _run(coro):
    import asyncio

    return asyncio.run(coro)
