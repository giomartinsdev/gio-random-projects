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

    def institutions(self) -> list[dict]:
        return [{"id": "i1", "name": "Itaú"}, {"id": "i2", "name": "Nubank"}]

    def create_consent(self, **kw: Any) -> dict:
        self.created.append(kw)
        return {"id": "consent-1", "status": "AWAITING_AUTHORIZATION", "url_to_authenticate": "https://bank/x"}

    def consent(self, consent_id: str) -> dict:
        return {"id": consent_id, "status": "AUTHORISED", "execution_status": "SUCCESS"}

    def revoke_consent(self, consent_id: str) -> None:
        self.revoked.append(consent_id)


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
    assert payload["products"] == ["ACCOUNT"]
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
