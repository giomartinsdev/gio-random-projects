"""Cliente do Polp: headers, mapeamento de erro e o prefixo do sandbox.

O provedor é scriptado por um ``httpx.MockTransport``; o que se prova é o NOSSO
cliente (headers, caminho, tradução de erro), não o Polp em si.
"""

from __future__ import annotations

import httpx
import pytest

from finance_api.domain.errors import DomainApiError
from finance_api.infrastructure.polp import (
    CLIENT_HEADER,
    DEFAULT_BASE_URL,
    SECRET_HEADER,
    PolpClient,
    PolpNotConfigured,
)

CID = "client_abc"
CSECRET = "secret_xyz"


def client_for(handler, **kw) -> PolpClient:
    transport = httpx.MockTransport(handler)
    return PolpClient(CID, CSECRET, client=httpx.Client(base_url=DEFAULT_BASE_URL, transport=transport), **kw)


def test_institutions_is_public_but_sends_headers():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["method"] = req.method
        seen["path"] = req.url.path
        seen["client"] = req.headers.get(CLIENT_HEADER)
        seen["secret"] = req.headers.get(SECRET_HEADER)
        return httpx.Response(200, json={"data": [{"id": "i1", "name": "Itaú"}]})

    items = client_for(handler).institutions()
    assert items == [{"id": "i1", "name": "Itaú"}]
    assert seen["method"] == "GET"
    assert seen["path"].endswith("/institutions")
    assert seen["client"] == CID and seen["secret"] == CSECRET


def test_consent_uses_the_right_path_and_body():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["path"] = req.url.path
        seen["body"] = req.read().decode()
        return httpx.Response(201, json={"id": "consent-1", "status": "AWAITING_AUTHORIZATION", "url_to_authenticate": "https://bank/x"})

    out = client_for(handler).create_consent(institution_id="i1", cpf="12345678900", user_id="5521")
    assert out["id"] == "consent-1"
    assert seen["path"].endswith("/consents")
    assert '"institution_id":"i1"' in seen["body"].replace(" ", "")
    assert '"avoidDuplicates":true' in seen["body"].replace(" ", "")


def test_sandbox_prefixes_the_base_url():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["path"] = req.url.path
        return httpx.Response(200, json={"data": []})

    PolpClient(CID, CSECRET, sandbox=True, client=httpx.Client(base_url=DEFAULT_BASE_URL, transport=httpx.MockTransport(handler))).institutions()
    assert "/sandbox/institutions" in seen["path"]


def test_401_is_reported_as_a_provider_error_without_the_secret():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"message": "Invalid API credentials."})

    with pytest.raises(DomainApiError) as exc:
        client_for(handler).consents()
    assert "Invalid API credentials" in str(exc.value)
    assert CSECRET not in str(exc.value)


def test_402_surfaces_the_provider_message():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(402, json={"message": "É necessário possuir um plano ativo."})

    with pytest.raises(DomainApiError) as exc:
        client_for(handler).institutions()
    assert "plano ativo" in str(exc.value)


def test_unconfigured_client_refuses_before_any_request():
    called = {"n": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        called["n"] += 1
        return httpx.Response(200, json={})

    c = PolpClient("", "", client=httpx.Client(base_url=DEFAULT_BASE_URL, transport=httpx.MockTransport(handler)))
    with pytest.raises(PolpNotConfigured):
        c.institutions()
    assert called["n"] == 0
