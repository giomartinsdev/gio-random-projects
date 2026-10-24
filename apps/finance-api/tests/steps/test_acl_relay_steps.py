"""Steps de acl_relay.feature.

O "domain-api" aqui é scriptado, mas o `DomainApiClient` e as rotas da
finance-api são os de verdade: o que se verifica é a tradução de status e a
validação, que são justamente o que um dublê do cliente esconderia.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when

from conftest import CALLER_KEY, DOMAIN_KEY
from finance_api.application.commands import CommandRouter
from finance_api.infrastructure.domain_api import DomainApiClient
from finance_api.presentation.app import create_app
from finance_api.presentation.dependencies import build_container_with_router
from finance_contracts import ACTION_REGISTER_TRANSACTION
from stubs import DomainApiStub

scenarios("../features/acl_relay.feature")


VALID = {
    "user_id": "user-1",
    "account_id": "acct-1",
    "transaction_type": "EXPENSE",
    "amount": "45.00",
    "currency": "BRL",
    "category": "Alimentacao",
    "occurred_at": "2026-10-03T09:00:00-03:00",
}


@pytest.fixture
def contexto() -> dict:
    return {}


@given(parsers.parse('que o domain-api vai responder "{modo}"'))
def domain_api_vai_responder(contexto: dict, modo: str) -> None:
    stub = {
        "written": DomainApiStub.written("cmd-1", "tx-9"),
        "queued": DomainApiStub.queued("cmd-1"),
        "failed": DomainApiStub.failed("cmd-1", "unknown action"),
    }[modo]
    contexto["stub"] = stub
    client = DomainApiClient(
        base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=stub.client()
    )
    app = create_app(
        build_container_with_router(CommandRouter(client), {CALLER_KEY: "worker"})
    )
    contexto["client"] = TestClient(app)


def _send(contexto: dict, payload: dict, *, key: str | None = CALLER_KEY) -> None:
    headers = {"Content-Type": "application/json"}
    if key is not None:
        headers["X-API-Key"] = key
    contexto["response"] = contexto["client"].post(
        "/commands/sync",
        json={"action": ACTION_REGISTER_TRANSACTION, "payload": payload},
        headers=headers,
    )


@when("eu mando um comando de despesa válido")
def mando_valido(contexto: dict) -> None:
    _send(contexto, dict(VALID))


@when("eu mando um comando de despesa com valor em ponto flutuante")
def mando_float(contexto: dict) -> None:
    _send(contexto, dict(VALID, amount=45.0))


@when("eu mando um comando de despesa com horário sem fuso")
def mando_sem_fuso(contexto: dict) -> None:
    _send(contexto, dict(VALID, occurred_at="2026-10-03T09:00:00"))


@when("eu mando um comando sem a chave de API")
def mando_sem_chave(contexto: dict) -> None:
    _send(contexto, dict(VALID), key=None)


@then(parsers.parse('a resposta é "{status}" com o entity_id'))
def resposta_status_entity(contexto: dict, status: str) -> None:
    body = contexto["response"].json()
    assert body["status"] == status
    assert body["entity_id"] == "tx-9"


@then(parsers.parse('a resposta é "{status}" com status HTTP {code:d}'))
def resposta_status_code(contexto: dict, status: str, code: int) -> None:
    assert contexto["response"].status_code == code
    assert contexto["response"].json()["status"] == status


@then(parsers.parse("a resposta tem status HTTP {code:d}"))
def resposta_code(contexto: dict, code: int) -> None:
    assert contexto["response"].status_code == code


@then("a resposta avisa que o comando ainda pode ser aplicado")
def avisa_ainda_pode(contexto: dict) -> None:
    erro = contexto["response"].json()["error"]
    assert "still land" in erro or "ainda pode" in erro


@then(parsers.parse("a resposta é recusada com status HTTP {code:d}"))
def recusada(contexto: dict, code: int) -> None:
    assert contexto["response"].status_code == code
    assert "error" in contexto["response"].json()


@then(parsers.parse("a resposta é não autorizada com status HTTP {code:d}"))
def nao_autorizada(contexto: dict, code: int) -> None:
    assert contexto["response"].status_code == code
    assert contexto["response"].json()["error"] == "missing or invalid API key"


@then("nenhum request foi feito ao domain-api")
def nenhum_request(contexto: dict) -> None:
    assert contexto["stub"].requests == []
