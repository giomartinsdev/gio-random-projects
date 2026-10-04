"""The ACL's outbound edge: status translation and envelope fidelity.

These are the contract tests of §12.3 -- they assert the exact request the
ACL sends and the exact outcome it reports for each documented reply,
including the one that is easiest to get wrong: 504 means *queued*, not
failed.
"""

from __future__ import annotations

import httpx
import pytest

from conftest import DOMAIN_KEY
from finance_api.domain.errors import DomainApiError, DomainApiTimeout
from finance_api.infrastructure.domain_api import DomainApiClient, QUEUED_FALLBACK_DETAIL
from finance_contracts import (
    ACTION_REGISTER_TRANSACTION,
    CommandEnvelope,
    SYNC_STATUS_FAILED,
    SYNC_STATUS_QUEUED,
    SYNC_STATUS_WRITTEN,
)
from stubs import DomainApiStub

ENVELOPE = CommandEnvelope(ACTION_REGISTER_TRANSACTION, {"amount": "45.00"})


def client_for(stub: DomainApiStub, *, timeout_s: float = 12.0) -> DomainApiClient:
    return DomainApiClient(
        base_url="http://domain-api.test",
        api_key=DOMAIN_KEY,
        timeout_s=timeout_s,
        client=stub.client(),
    )


# ------------------------------------------------------------------- async 202

def test_async_accepted_returns_the_202_shape() -> None:
    stub = DomainApiStub.accepted("cmd-42")
    result = client_for(stub).send_async(ENVELOPE)
    assert (result.command_id, result.status) == ("cmd-42", "accepted")


def test_async_posts_the_bare_envelope_to_the_async_door() -> None:
    # Slice 3 added POST /commands: the async envelope door. The default async
    # relay goes there; /sync stays for the blocking path.
    stub = DomainApiStub.accepted()
    client_for(stub).send_async(ENVELOPE)
    sent = stub.requests[-1]
    assert sent.method == "POST"
    assert sent.path == "/commands"
    assert sent.body == {"action": ACTION_REGISTER_TRANSACTION, "payload": {"amount": "45.00"}}


def test_every_request_carries_the_api_key() -> None:
    stub = DomainApiStub.accepted()
    client_for(stub).send_async(ENVELOPE)
    # Header names are case-insensitive on the wire; httpx normalises them.
    headers = {k.lower(): v for k, v in stub.requests[-1].headers.items()}
    assert headers["x-api-key"] == DOMAIN_KEY


def test_async_non_202_is_an_error_not_an_outcome() -> None:
    stub = DomainApiStub(status_code=500, body={"error": "boom"})
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_async(ENVELOPE)
    assert "500" in str(excinfo.value)


def test_async_401_names_the_misconfigured_key_not_the_caller() -> None:
    stub = DomainApiStub(status_code=401, body={"error": "missing or invalid API key"})
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_async(ENVELOPE)
    message = str(excinfo.value)
    assert "DOMAIN_API_KEYS" in message
    # The key itself must never appear in an error message.
    assert DOMAIN_KEY not in message


def test_async_202_with_wrong_status_is_an_error() -> None:
    # A 202 whose body says anything but "accepted" is not the documented
    # shape; reporting it as accepted would be inventing a success.
    stub = DomainApiStub(status_code=202, body={"command_id": "c", "status": "maybe"})
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_async(ENVELOPE)
    assert "maybe" in str(excinfo.value)


def test_async_missing_command_id_is_an_error() -> None:
    stub = DomainApiStub(status_code=202, body={"status": "accepted"})
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_async(ENVELOPE)
    assert "command_id" in str(excinfo.value)


def test_async_non_json_body_is_an_error() -> None:
    stub = DomainApiStub(status_code=202, raw_text="<html>gateway</html>")
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_async(ENVELOPE)
    assert "not JSON" in str(excinfo.value)


# -------------------------------------------------------------------- /sync

def test_sync_200_is_written_with_entity_id() -> None:
    stub = DomainApiStub.written("cmd-7", "tx-99")
    result = client_for(stub).send_sync(ENVELOPE)
    assert result.status == SYNC_STATUS_WRITTEN
    assert result.entity_id == "tx-99"
    assert result.is_confirmed is True


def test_sync_422_is_failed_with_the_workers_reason() -> None:
    stub = DomainApiStub.failed("cmd-8", "amount must be positive")
    result = client_for(stub).send_sync(ENVELOPE)
    assert result.status == SYNC_STATUS_FAILED
    assert result.error == "amount must be positive"
    assert result.is_confirmed is False


def test_sync_504_is_queued_and_NOT_failed() -> None:
    """The rule of the whole contract: timeout != not written."""
    stub = DomainApiStub.queued("cmd-9")
    result = client_for(stub).send_sync(ENVELOPE)
    assert result.status == SYNC_STATUS_QUEUED
    assert result.status != SYNC_STATUS_FAILED
    assert result.is_confirmed is False  # not a confirmation either...
    # ...but the "still coming" explanation must survive to the caller.
    assert "still land" in (result.error or "")


def test_sync_504_without_a_body_still_explains_itself() -> None:
    # A proxy in front of domain-api could strip the 504 body; the caller
    # must still learn that the command may land.
    stub = DomainApiStub(status_code=504, body={"command_id": "cmd-9"})
    result = client_for(stub).send_sync(ENVELOPE)
    assert result.status == SYNC_STATUS_QUEUED
    assert result.error == QUEUED_FALLBACK_DETAIL
    assert "still land" in result.error


def test_sync_undocumented_status_is_an_error_not_an_outcome() -> None:
    for code in (400, 401, 403, 429, 500, 502):
        stub = DomainApiStub(status_code=code, body={"error": "x"})
        with pytest.raises(DomainApiError):
            client_for(stub).send_sync(ENVELOPE)


def test_sync_400_from_domain_api_does_not_become_failed() -> None:
    # domain-api answers 400 for a body it cannot decode. Folding that into
    # the 422 outcome would tell the caller "the worker rejected it", which
    # never happened.
    stub = DomainApiStub(status_code=400, body={"error": "invalid request body"})
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_sync(ENVELOPE)
    message = str(excinfo.value)
    assert "400" in message
    assert "failed" not in message


def test_sync_written_without_entity_id_is_allowed() -> None:
    # entity_id is omitempty in domain-api's syncBody: a written command can
    # legitimately carry none, and that is not an error.
    stub = DomainApiStub(status_code=200, body={"command_id": "c", "status": "written"})
    result = client_for(stub).send_sync(ENVELOPE)
    assert result.status == SYNC_STATUS_WRITTEN
    assert result.entity_id is None


# ------------------------------------------------------------- transport

def test_timeout_is_reported_as_unknown_outcome() -> None:
    stub = DomainApiStub(raise_error=httpx.ReadTimeout("too slow"))
    with pytest.raises(DomainApiTimeout) as excinfo:
        client_for(stub).send_sync(ENVELOPE)
    assert "unknown" in str(excinfo.value)


def test_connection_error_becomes_a_domain_api_error() -> None:
    stub = DomainApiStub(raise_error=httpx.ConnectError("refused"))
    with pytest.raises(DomainApiError) as excinfo:
        client_for(stub).send_sync(ENVELOPE)
    assert "could not reach domain-api" in str(excinfo.value)
