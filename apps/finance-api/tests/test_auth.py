"""SSO no nível da rota: login, telefone, me, logout e o escopo do user_id.

O verificador do Google é trocado por um duble (o Google real é a lib
``google-auth``, testada à parte), então o que se prova é a NOSSA superfície:
o cookie é emitido, a sessão é exigida onde precisa, e o ``user_id`` de um
comando vindo do SPA é amarrado ao telefone da sessão.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import DOMAIN_KEY
from finance_api.application.commands import CommandRouter
from finance_api.application.reads import QueryRouter
from finance_api.infrastructure.domain_api import DomainApiClient
from finance_api.infrastructure.google import GoogleAuthError, GoogleIdentity
from finance_api.presentation.app import create_app
from finance_api.presentation.dependencies import build_container_with_router
from finance_contracts import ACTION_REGISTER_TRANSACTION
from stubs import DomainApiStub

CALLER_KEY = "test-caller-key"
SESSION_SECRET = "a" * 40  # >=32 bytes, sem aviso do PyJWT
GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com"


class FakeGoogle:
    """Verificador falso: credencial "ok" -> identidade; resto -> erro."""

    def __init__(self) -> None:
        self.verified: list[str] = []

    def verify(self, credential: str) -> GoogleIdentity:
        self.verified.append(credential)
        if credential == "bad":
            raise GoogleAuthError("token do Google inválido ou expirado")
        return GoogleIdentity(email="ana@corp.com", name="Ana")


def make_client(stub: DomainApiStub, *, google: FakeGoogle | None = None) -> TestClient:
    client = DomainApiClient(base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=stub.client())
    container = build_container_with_router(
        CommandRouter(client),
        {CALLER_KEY: "worker"},
        queries=QueryRouter(client),
        google=google or FakeGoogle(),
        google_client_id=GOOGLE_CLIENT_ID,
        session_secret=SESSION_SECRET,
    )
    # https para o TestClient guardar o cookie: ele é Secure (SameSite=None),
    # e um jar de cookie não guarda Secure sobre http.
    return TestClient(create_app(container), base_url="https://testserver")


VALID = {
    "action": ACTION_REGISTER_TRANSACTION,
    "payload": {
        "account_id": "acct-1",
        "transaction_type": "EXPENSE",
        "amount": "45.00",
        "currency": "BRL",
        "category": "Alimentacao",
        "occurred_at": "2026-10-03T09:00:00-03:00",
    },
}


def login(client: TestClient, credential: str = "ok") -> None:
    res = client.post("/auth/google", json={"credential": credential}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 200


# --------------------------------------------------------------------- login

def test_login_sets_cookie_and_reports_session():
    stub = DomainApiStub.accepted()
    client = make_client(stub)
    res = client.post("/auth/google", json={"credential": "ok"}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 200
    assert res.json() == {"email": "ana@corp.com", "name": "Ana", "phone": ""}
    assert "finance_session=" in res.headers["set-cookie"]


def test_login_rejects_a_bad_google_token():
    client = make_client(DomainApiStub.accepted())
    res = client.post("/auth/google", json={"credential": "bad"}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 401


def test_login_without_google_configured_is_500():
    client = DomainApiClient(base_url="http://domain-api.test", api_key=DOMAIN_KEY, client=DomainApiStub.accepted().client())
    container = build_container_with_router(
        CommandRouter(client), {CALLER_KEY: "worker"}, session_secret=SESSION_SECRET
    )
    res = TestClient(create_app(container)).post(
        "/auth/google", json={"credential": "ok"}, headers={"X-API-Key": CALLER_KEY}
    )
    assert res.status_code == 500


# ----------------------------------------------------------------------- me

def test_me_is_anonymous_without_a_cookie():
    client = make_client(DomainApiStub.accepted())
    res = client.get("/auth/me")
    assert res.status_code == 200
    assert res.json() == {"authenticated": False}


def test_me_reports_the_session_after_login():
    client = make_client(DomainApiStub.accepted())
    login(client)
    res = client.get("/auth/me")
    assert res.json()["authenticated"] is True
    assert res.json()["email"] == "ana@corp.com"


# ------------------------------------------------------------------- phone

def test_phone_requires_login():
    client = make_client(DomainApiStub.accepted())
    res = client.post("/auth/phone", json={"phone": "5521981962914"}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 401


def test_phone_is_normalized_and_stored_in_the_session():
    client = make_client(DomainApiStub.accepted())
    login(client)
    res = client.post("/auth/phone", json={"phone": "+55 (21) 98196-2914"}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 200
    assert res.json()["phone"] == "5521981962914"
    assert client.get("/auth/me").json()["phone"] == "5521981962914"


def test_phone_rejects_a_non_number():
    client = make_client(DomainApiStub.accepted())
    login(client)
    res = client.post("/auth/phone", json={"phone": "abc"}, headers={"X-API-Key": CALLER_KEY})
    assert res.status_code == 422


# ------------------------------------------------------- user_id scoping

def test_spa_command_without_user_id_uses_the_session_phone():
    stub = DomainApiStub.accepted("cmd-1")
    client = make_client(stub)
    login(client)
    client.post("/auth/phone", json={"phone": "5521981962914"}, headers={"X-API-Key": CALLER_KEY})

    res = client.post("/commands", json=VALID)  # sem X-API-Key: vem pela sessão
    assert res.status_code == 202
    sent = stub.requests[-1]
    assert sent.body["payload"]["user_id"] == "5521981962914"


def test_spa_command_for_another_user_id_is_refused():
    stub = DomainApiStub.accepted("cmd-1")
    client = make_client(stub)
    login(client)
    client.post("/auth/phone", json={"phone": "5521981962914"}, headers={"X-API-Key": CALLER_KEY})

    payload = {**VALID["payload"], "user_id": "5599999999999"}
    res = client.post("/commands", json={"action": ACTION_REGISTER_TRANSACTION, "payload": payload})
    assert res.status_code == 422
    assert stub.requests == []


def test_spa_command_before_linking_a_phone_is_refused():
    stub = DomainApiStub.accepted("cmd-1")
    client = make_client(stub)
    login(client)  # sem /auth/phone
    res = client.post("/commands", json=VALID)
    assert res.status_code == 422
    assert stub.requests == []


def test_worker_command_bypasses_the_session_scoping():
    # O worker manda X-API-Key + user_id no payload; não há sessão envolvida.
    stub = DomainApiStub.accepted("cmd-1")
    client = make_client(stub)
    payload = {**VALID["payload"], "user_id": "5521981962914"}
    res = client.post(
        "/commands",
        json={"action": ACTION_REGISTER_TRANSACTION, "payload": payload},
        headers={"X-API-Key": CALLER_KEY},
    )
    assert res.status_code == 202
    assert stub.requests[-1].body["payload"]["user_id"] == "5521981962914"


# ------------------------------------------------------------------ logout

def test_logout_clears_the_session():
    client = make_client(DomainApiStub.accepted())
    login(client)
    res = client.post("/auth/logout")
    assert res.status_code == 200
    assert client.get("/auth/me").json() == {"authenticated": False}
