"""Serviço de Open Finance na ACL: orquestra o provedor e publica o comando."""

from __future__ import annotations

from typing import Any

import pytest

from finance_api.application.openfinance import OpenFinanceService
from finance_api.domain.errors import ValidationError
from finance_api.infrastructure.polp import PolpError


class FakePolp:
    def __init__(self, *, configured: bool = True) -> None:
        self.configured = configured
        self.created: list[dict] = []
        self.revoked: list[str] = []
        self.recreated: list[tuple[str, list[str] | None]] = []

    def institutions(self) -> list[dict]:
        return [{"id": "i1", "name": "Itaú"}, {"id": "i2", "name": "Nubank"}]

    def create_consent(self, **kw: Any) -> dict:
        self.created.append(kw)
        return {"id": "consent-1", "status": "AWAITING_AUTHORIZATION", "url_to_authenticate": "https://bank/x"}

    def consent(self, consent_id: str) -> dict:
        return {"id": consent_id, "status": "AUTHORISED", "execution_status": "SUCCESS"}

    def revoke_consent(self, consent_id: str) -> None:
        self.revoked.append(consent_id)

    def recreate_consent(self, consent_id: str, *, products: list[str] | None = None) -> dict:
        self.recreated.append((consent_id, products))
        return {
            "id": consent_id,
            "status": "AWAITING_AUTHORIZATION",
            "institution_id": "i1",
            "cliente_user_id": "5521",
            "products": products or ["ACCOUNT", "CREDIT_CARD_ACCOUNT", "CREDIT_OPERATIONS", "INVESTMENTS", "EXCHANGE"],
            "url_to_authenticate": "https://bank/renew",
        }


class FakeCommands:
    def __init__(self) -> None:
        self.relayed: list[tuple[str, dict]] = []

    def relay(self, action: str, payload: dict, *, mode: str = "sync"):
        self.relayed.append((action, payload))

        class _Out:
            status = "accepted"
            command_id = "c1"

        return _Out()


def test_connect_publishes_consent_created_with_the_contract_action():
    polp = FakePolp()
    cmds = FakeCommands()
    result = OpenFinanceService(polp, cmds).connect(user_id="5521", institution_id="i1", cpf="12345678900", institution_name="Itaú")
    assert result.consent_id == "consent-1"
    action, payload = cmds.relayed[-1]
    assert action == "finance.openfinance.consentCreated"
    assert payload["polp_consent_id"] == "consent-1"
    assert payload["user_id"] == "5521"
    assert payload["products"] == ["ACCOUNT", "CREDIT_CARD_ACCOUNT", "CREDIT_OPERATIONS", "INVESTMENTS", "EXCHANGE"]
    assert payload["institution_name"] == "Itaú"


def test_connect_requires_cpf_and_institution():
    of = OpenFinanceService(FakePolp(), FakeCommands())
    with pytest.raises(ValidationError):
        of.connect(user_id="5521", institution_id="", cpf="123")
    with pytest.raises(ValidationError):
        of.connect(user_id="5521", institution_id="i1", cpf="")


def test_institutions_filters_by_name():
    of = OpenFinanceService(FakePolp(), FakeCommands())
    assert [i["id"] for i in of.institutions(query="nub")] == ["i2"]
    assert len(of.institutions()) == 2


def test_refresh_publishes_consent_updated():
    cmds = FakeCommands()
    OpenFinanceService(FakePolp(), cmds).refresh(polp_consent_id="consent-1")
    action, payload = cmds.relayed[-1]
    assert action == "finance.openfinance.consentUpdated"
    assert payload["status"] == "AUTHORISED"


def test_revoke_calls_provider_and_publishes_removed():
    polp = FakePolp()
    cmds = FakeCommands()
    OpenFinanceService(polp, cmds).revoke(polp_consent_id="consent-1")
    assert polp.revoked == ["consent-1"]
    action, payload = cmds.relayed[-1]
    # Revogar REMOVE a conexão (o usuário pediu para tirar da lista), não a
    # deixa como EXPIRED.
    assert action == "finance.openfinance.consentRemoved"
    assert payload["polp_consent_id"] == "consent-1"


def test_configured_reflects_the_provider():
    assert OpenFinanceService(FakePolp(configured=True), FakeCommands()).configured() is True
    assert OpenFinanceService(FakePolp(configured=False), FakeCommands()).configured() is False


def test_revoke_still_removes_locally_when_provider_refuses():
    # Consentimento já EXPIRED no provedor: o DELETE responde erro, mas a
    # remoção local (limpar a lista) ainda deve sair.
    class RefusingPolp(FakePolp):
        def revoke_consent(self, consent_id: str) -> None:
            raise PolpError("consentimento já expirado")

    cmds = FakeCommands()
    OpenFinanceService(RefusingPolp(), cmds).revoke(polp_consent_id="consent-1")
    assert cmds.relayed[-1][0] == "finance.openfinance.consentRemoved"


def test_acl_relays_investment_synced_from_the_connector():
    # Regressão: sem esta ação em _WRITE_COMMANDS o conector tomava 422 e as
    # posições nunca chegavam ao ledger (investimentos vazios no app).
    from finance_api.application.commands import CommandRouter, known_write_actions

    assert "finance.investment.synced" in known_write_actions()

    class _Transport:
        def send_async(self, envelope):
            self.envelope = envelope

            class _In:
                command_id = "c1"
                status = "accepted"

            return _In()

        def send_sync(self, envelope):  # pragma: no cover - async é o caminho
            raise AssertionError("o conector usa /commands (async)")

    transport = _Transport()
    CommandRouter(transport).relay(
        "finance.investment.synced",
        {
            "user_id": "5521",
            "polp_consent_id": "consent-1",
            "polp_invest_id": "inv-1",
            "family": "variable-incomes",
            "institution_name": "B3",
            "type": "ACAO",
            "name": "PETR4",
            "currency": "BRL",
            "invested_amount": "",
            "gross_amount": "100.00",
        },
        mode="async",
    )
    assert transport.envelope.action == "finance.investment.synced"
    assert transport.envelope.payload["polp_invest_id"] == "inv-1"


def test_recreate_publishes_consent_created_with_the_new_url_and_products():
    polp = FakePolp()
    cmds = FakeCommands()
    result = OpenFinanceService(polp, cmds).recreate(polp_consent_id="consent-1")

    # Amplia os produtos: o consentimento antigo (só-ACCOUNT) passa a pedir
    # INVESTMENTS e o provedor devolve nova URL de autorização.
    assert polp.recreated == [("consent-1", ["ACCOUNT", "CREDIT_CARD_ACCOUNT", "CREDIT_OPERATIONS", "INVESTMENTS", "EXCHANGE"])]
    action, payload = cmds.relayed[-1]
    assert action == "finance.openfinance.consentCreated"
    assert payload["polp_consent_id"] == "consent-1"
    assert payload["products"] == ["ACCOUNT", "CREDIT_CARD_ACCOUNT", "CREDIT_OPERATIONS", "INVESTMENTS", "EXCHANGE"]
    assert payload["url_to_authenticate"] == "https://bank/renew"
    assert result.status == "AWAITING_AUTHORIZATION"


def test_recreate_route_returns_the_new_authorization_url():
    from fastapi.testclient import TestClient

    from finance_api.presentation.app import create_app
    from finance_api.presentation.dependencies import Container

    class _Router:
        def build_envelope(self, *a, **k): ...

    class _Google:
        def verify(self, credential: str):
            from finance_api.infrastructure.google import GoogleIdentity

            return GoogleIdentity(email="ana@corp.com", name="Ana")

    secret = "a" * 40
    polp = FakePolp()
    container = Container(
        router=_Router(),
        api_keys={"k": "worker"},
        google=_Google(),
        google_client_id="cid",
        session_secret=secret,
        openfinance=OpenFinanceService(polp, FakeCommands()),
    )
    client = TestClient(create_app(container), base_url="https://testserver")
    client.post("/auth/google", json={"credential": "ok"}, headers={"X-API-Key": "k"})
    client.post("/auth/phone", json={"phone": "5521981962914"}, headers={"X-API-Key": "k"})

    res = client.post(
        "/openfinance/consents/consent-1/recreate",
        json={"institution_name": "Itaú"},
        headers={"X-API-Key": "k"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["consent_id"] == "consent-1"
    assert body["url_to_authenticate"] == "https://bank/renew"
    assert polp.recreated == [("consent-1", ["ACCOUNT", "CREDIT_CARD_ACCOUNT", "CREDIT_OPERATIONS", "INVESTMENTS", "EXCHANGE"])]


def test_acl_relays_every_new_of_resource_command() -> None:
    """Regressão do "pegar tudo": todos os recursos novos têm ação registrada."""
    from finance_api.application.commands import CommandRouter, known_write_actions

    actions = known_write_actions()
    for action in (
        "finance.openfinance.creditCardSynced",
        "finance.openfinance.billSynced",
        "finance.openfinance.loanSynced",
        "finance.openfinance.financingSynced",
        "finance.openfinance.exchangeSynced",
        "finance.openfinance.rawSynced",
        "finance.investment.transactionSynced",
    ):
        assert action in actions, action

    class _Transport:
        def send_async(self, envelope):
            self.envelope = envelope

            class _In:
                command_id = "c1"
                status = "accepted"

            return _In()

        def send_sync(self, envelope):  # pragma: no cover
            raise AssertionError("o conector usa /commands (async)")

    transport = _Transport()
    CommandRouter(transport).relay(
        "finance.openfinance.rawSynced",
        {"user_id": "5521", "resource": "credit_cards", "external_id": "cc-1", "payload": "{}"},
        mode="async",
    )
    assert transport.envelope.payload["external_id"] == "cc-1"
