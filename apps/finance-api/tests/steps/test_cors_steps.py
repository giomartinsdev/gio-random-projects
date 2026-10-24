"""Steps de cors.feature.

O app é o de verdade (create_app) com o domain-api scriptado; o que se
verifica é o middleware de CORS, não um dublê dele.
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
from stubs import DomainApiStub

scenarios("../features/cors.feature")

SPA_ORIGIN = "https://finance.giomartins.dev"
EVIL_ORIGIN = "https://evil.example"


@pytest.fixture
def contexto() -> dict:
    return {}


def _client(allowed_origins: list[str]) -> TestClient:
    stub = DomainApiStub.written()
    client = DomainApiClient(
        base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=stub.client()
    )
    app = create_app(
        build_container_with_router(CommandRouter(client), {CALLER_KEY: "worker"}),
        allowed_origins=allowed_origins,
    )
    return TestClient(app)


@given(parsers.parse('que a origem "{origin}" está na allowlist'))
def origem_na_allowlist(contexto: dict, origin: str) -> None:
    contexto["origin"] = origin
    contexto["client"] = _client([SPA_ORIGIN])


@given(parsers.parse('que a origem "{origin}" não está na allowlist'))
def origem_fora(contexto: dict, origin: str) -> None:
    contexto["origin"] = origin
    contexto["client"] = _client([SPA_ORIGIN])


@when(parsers.parse('eu faço um GET de "{path}" com essa origem'))
def get_com_origem(contexto: dict, path: str) -> None:
    contexto["response"] = contexto["client"].get(
        path, headers={"Origin": contexto["origin"]}
    )


@when(parsers.parse('eu faço um preflight de {method} em "{path}" com essa origem'))
def preflight(contexto: dict, path: str, method: str) -> None:
    contexto["response"] = contexto["client"].options(
        path,
        headers={
            "Origin": contexto["origin"],
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type,x-api-key,traceparent",
        },
    )


@then(parsers.parse("a resposta tem Access-Control-Allow-Origin igual à origem"))
def tem_allow_origin(contexto: dict) -> None:
    assert contexto["response"].headers.get("access-control-allow-origin") == contexto["origin"]


@then(parsers.parse("a resposta não tem Access-Control-Allow-Origin"))
def nao_tem_allow_origin(contexto: dict) -> None:
    assert "access-control-allow-origin" not in contexto["response"].headers


@then(parsers.parse('a resposta permite o cabeçalho "{header}"'))
def permite_header(contexto: dict, header: str) -> None:
    allowed = contexto["response"].headers.get("access-control-allow-headers", "").lower()
    assert header.lower() in [part.strip() for part in allowed.split(",")]


@then("o preflight não chega no handler")
def preflight_curto(contexto: dict) -> None:
    # Um preflight bem respondido é 204 e não tem corpo de rota.
    assert contexto["response"].status_code in (200, 204)
