"""The ACL's own HTTP surface, through FastAPI's TestClient.

Covers what §12.3 asks of the contract: ``202`` on the default write path,
``/sync`` returning 200/422/504, and ``401`` for a missing or invalid key.
The outbound side is stubbed, so a failure here is a failure of the ACL --
not of a network or a database.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from conftest import CALLER_KEY, DOMAIN_KEY
from finance_api.application.commands import AsyncRelayUnavailable, CommandRouter
from finance_api.infrastructure.domain_api import DomainApiClient, QUEUED_FALLBACK_DETAIL
from finance_api.presentation.app import create_app
from finance_api.presentation.dependencies import build_container_with_router
from finance_contracts import ACTION_REGISTER_TRANSACTION, AcceptedResult, SyncResult
from stubs import DomainApiStub

VALID_PAYLOAD = {
    "user_id": "user-1",
    "account_id": "acct-1",
    "transaction_type": "EXPENSE",
    "amount": "45.00",
    "currency": "BRL",
    "category": "Alimentacao",
    "occurred_at": "2026-10-03T09:00:00-03:00",
}


def make_client(stub: DomainApiStub) -> TestClient:
    """A TestClient whose ACL relays to the scripted stub."""
    client = DomainApiClient(
        base_url="http://domain-api.test",
        api_key=DOMAIN_KEY,
        client=stub.client(),
    )
    container = build_container_with_router(
        CommandRouter(client), {CALLER_KEY: "worker"}
    )
    app = create_app(container)
    return TestClient(app)


def envelope(action: str = ACTION_REGISTER_TRANSACTION, payload: dict | None = None) -> dict:
    return {"action": action, "payload": VALID_PAYLOAD if payload is None else payload}


def auth() -> dict[str, str]:
    return {"X-API-Key": CALLER_KEY}


# ------------------------------------------------------------------- healthz

def test_healthz_is_public_and_ok() -> None:
    client = make_client(DomainApiStub.accepted())
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ------------------------------------------------------------------------ 202

def test_post_commands_relays_async_and_answers_202() -> None:
    """The default door is async (§4.1): the ACL relays to /commands and
    answers 202 accepted; the worker applies it."""
    stub = DomainApiStub.accepted("cmd-1")
    response = make_client(stub).post("/commands", json=envelope(), headers=auth())
    assert response.status_code == 202
    assert response.json() == {
        "command_id": "cmd-1",
        "status": "accepted",
        "relay": "async",
    }
    assert stub.requests[-1].path == "/commands"


def test_async_relay_is_the_declared_default() -> None:
    # The capability exists upstream now (slice 3 added POST /commands);
    # the default is on, and the guard still pins the disabled behaviour.
    router = CommandRouter(_RecordingPort())
    outcome = router.relay(ACTION_REGISTER_TRANSACTION, VALID_PAYLOAD, mode="async")
    assert outcome.status == "accepted"
    assert outcome.relay == "async"


def test_disabled_async_capability_still_refuses() -> None:
    router = CommandRouter(_RecordingPort(), supports_async=False)
    with pytest.raises(AsyncRelayUnavailable):
        router.relay(ACTION_REGISTER_TRANSACTION, VALID_PAYLOAD, mode="async")


class _RecordingPort:
    """A port that records the envelope and returns the documented shapes."""

    def __init__(self) -> None:
        self.sent: list[object] = []

    def send_async(self, envelope: object) -> object:
        self.sent.append(envelope)
        return AcceptedResult(command_id="cmd-async")

    def send_sync(self, envelope: object) -> object:
        self.sent.append(envelope)
        return SyncResult(command_id="cmd-sync", status="written", entity_id="tx-1")


def test_post_commands_relays_the_translated_envelope() -> None:
    stub = DomainApiStub.accepted()
    make_client(stub).post("/commands", json=envelope(), headers=auth())
    sent = stub.requests[-1]
    assert sent.path == "/commands"
    # The ACL's translation, not the caller's body: the tz-aware input is
    # normalised to UTC and money crosses as an exact string.
    assert sent.body["action"] == ACTION_REGISTER_TRANSACTION
    payload = sent.body["payload"]
    assert payload["occurred_at"] == "2026-10-03T12:00:00+00:00"
    assert payload["amount"] == "45.00"
    assert isinstance(payload["amount"], str)
    assert "source_type" in payload


def test_post_commands_unknown_action_is_422_and_never_relayed() -> None:
    stub = DomainApiStub.written()
    response = make_client(stub).post(
        "/commands", json=envelope("finance.not.a.thing", {}), headers=auth()
    )
    assert response.status_code == 422
    assert "unknown action" in response.json()["error"]
    # Nothing left the process: an unvalidated body is never relayed.
    assert stub.requests == []


def test_post_commands_rejects_a_float_amount_locally() -> None:
    stub = DomainApiStub.written()
    payload = dict(VALID_PAYLOAD, amount=45.0)
    response = make_client(stub).post("/commands", json=envelope(payload=payload), headers=auth())
    assert response.status_code == 422
    assert "float" in response.json()["error"]
    assert stub.requests == []


def test_post_commands_rejects_a_naive_timestamp_locally() -> None:
    stub = DomainApiStub.written()
    payload = dict(VALID_PAYLOAD, occurred_at="2026-10-03T09:00:00")
    response = make_client(stub).post("/commands", json=envelope(payload=payload), headers=auth())
    assert response.status_code == 422
    assert "timezone-aware" in response.json()["error"]
    assert stub.requests == []


def test_post_commands_domain_api_5xx_is_502_not_a_fabricated_202() -> None:
    # A 500 from the async door must never be reported as accepted.
    stub = DomainApiStub(status_code=500, body={"error": "boom"})
    response = make_client(stub).post("/commands", json=envelope(), headers=auth())
    assert response.status_code == 502


def test_post_commands_401_from_domain_api_is_502_here_not_401() -> None:
    stub = DomainApiStub(status_code=401, body={"error": "missing or invalid API key"})
    response = make_client(stub).post("/commands", json=envelope(), headers=auth())
    assert response.status_code == 502
    assert "DOMAIN_API_KEYS" in response.json()["error"]


# ------------------------------------------------------------ /sync outcomes

def test_sync_written_returns_200_with_entity_id() -> None:
    stub = DomainApiStub.written("cmd-1", "tx-9")
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 200
    assert response.json()["status"] == "written"
    assert response.json()["entity_id"] == "tx-9"


def test_sync_failed_returns_422_with_the_reason() -> None:
    stub = DomainApiStub.failed("cmd-1", "amount must be positive")
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 422
    body = response.json()
    assert body["status"] == "failed"
    assert body["error"] == "amount must be positive"


def test_sync_queued_returns_504_and_says_it_may_still_land() -> None:
    stub = DomainApiStub.queued("cmd-1")
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 504
    body = response.json()
    assert body["status"] == "queued"
    # The message a caller must not lose: timeout is not failure.
    assert "still land" in body["error"]


def test_sync_queued_message_survives_a_bodyless_504() -> None:
    stub = DomainApiStub(status_code=504, body={"command_id": "cmd-1"})
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 504
    assert response.json()["error"] == QUEUED_FALLBACK_DETAIL


def test_sync_401_from_domain_api_is_502_here_not_401() -> None:
    # domain-api rejecting OUR key is our fault, not the finance caller's:
    # answering 401 would tell the worker its own credentials are wrong.
    stub = DomainApiStub(status_code=401, body={"error": "missing or invalid API key"})
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 502
    assert "DOMAIN_API_KEYS" in response.json()["error"]


def test_sync_timeout_from_domain_api_is_504() -> None:
    stub = DomainApiStub(raise_error=httpx.ReadTimeout("slow"))
    response = make_client(stub).post("/commands/sync", json=envelope(), headers=auth())
    assert response.status_code == 504
    assert "unknown" in response.json()["error"]


# ------------------------------------------------------------------------ 401

def test_missing_api_key_is_401() -> None:
    response = make_client(DomainApiStub.written()).post("/commands", json=envelope())
    assert response.status_code == 401
    assert response.json() == {"error": "missing or invalid API key"}


def test_invalid_api_key_is_401() -> None:
    response = make_client(DomainApiStub.written()).post(
        "/commands", json=envelope(), headers={"X-API-Key": "not-a-key"}
    )
    assert response.status_code == 401


def test_401_never_relays_to_domain_api() -> None:
    stub = DomainApiStub.written()
    make_client(stub).post("/commands", json=envelope(), headers={"X-API-Key": "nope"})
    assert stub.requests == []


def test_sync_also_requires_the_api_key() -> None:
    response = make_client(DomainApiStub.written()).post("/commands/sync", json=envelope())
    assert response.status_code == 401
