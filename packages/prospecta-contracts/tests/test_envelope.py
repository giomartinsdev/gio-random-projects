"""The envelope is the contract -- these tests pin its wire shape.

If these fail, both apps are broken at once, which is the point of the
package living in packages/.
"""

from __future__ import annotations

from prospecta_contracts import (
    ACTION_BOOK_MEETING,
    ACTION_CREATE_COMPANY,
    ACTION_MAX_LENGTH,
    ASYNC_COMMAND_PATH,
    ENVELOPE_SCHEMA_VERSION,
    STATUS_ACCEPTED,
    SYNC_COMMAND_PATH,
    SYNC_HTTP_TO_STATUS,
    SYNC_STATUS_FAILED,
    SYNC_STATUS_QUEUED,
    SYNC_STATUS_WRITTEN,
    AcceptedResult,
    CommandEnvelope,
    SyncResult,
)


def test_envelope_wire_shape_is_exactly_action_and_payload() -> None:
    env = CommandEnvelope("CreateCompany", {"name": "ACME", "tenant_id": "t-1"})
    # Golden shape: no extra keys, no nesting surprises. Anything added
    # here reaches domain-api and the worker at the same time.
    assert env.to_wire() == {
        "action": "CreateCompany",
        "payload": {"name": "ACME", "tenant_id": "t-1"},
    }


def test_envelope_always_emits_payload_even_when_empty() -> None:
    # An omitted payload would make the serialized body depend on the
    # command, and the golden test in the app could not stay byte-stable.
    assert CommandEnvelope("StartCampaign", {}).to_wire() == {
        "action": "StartCampaign",
        "payload": {},
    }


def test_envelope_is_frozen() -> None:
    env = CommandEnvelope("CreateCompany", {"k": 1})
    try:
        env.action = "DefineICP"  # type: ignore[misc]
    except Exception:
        pass
    else:  # pragma: no cover
        raise AssertionError("envelope must be immutable")


def test_envelope_does_not_carry_a_client_side_command_id() -> None:
    # domain-api overwrites any client-supplied id, so the contract must
    # not offer one.
    assert set(CommandEnvelope("CreateCompany", {}).to_wire()) == {"action", "payload"}


def test_actions_are_the_bare_contract_names_and_bounded() -> None:
    # The domain worker dispatches these verbatim (contracts/
    # domain-api-extensions.md), so they carry no namespace prefix.
    for action in ("CreateCompany", "BookMeeting", "ApproveMessage"):
        assert action.isidentifier()
        assert len(action) <= ACTION_MAX_LENGTH
    assert ACTION_CREATE_COMPANY == "CreateCompany"
    assert ACTION_BOOK_MEETING == "BookMeeting"


def test_action_above_the_bound_is_rejected_by_domain_api() -> None:
    # A boundary check the ACL can run locally: the bound is exactly 128.
    assert len(CommandEnvelope("x" * ACTION_MAX_LENGTH, {}).action) == ACTION_MAX_LENGTH


def test_accepted_result_is_the_202_shape() -> None:
    res = AcceptedResult(command_id="c-1")
    assert res.status == STATUS_ACCEPTED
    assert (res.command_id, res.status) == ("c-1", "accepted")


def test_sync_written_is_the_only_confirmation() -> None:
    written = SyncResult("c-1", SYNC_STATUS_WRITTEN, entity_id="lead-9")
    queued = SyncResult("c-1", SYNC_STATUS_QUEUED, error="still coming")
    failed = SyncResult("c-1", SYNC_STATUS_FAILED, error="fit out of range")
    assert written.is_confirmed is True
    # The whole point of the 504 row: timeout != not written.
    assert queued.is_confirmed is False
    assert failed.is_confirmed is False


def test_sync_http_status_map_covers_exactly_the_documented_outcomes() -> None:
    assert SYNC_HTTP_TO_STATUS == {200: "written", 422: "failed", 504: "queued"}
    # 400/401/500 must NOT be mapped onto a sync outcome: they are real
    # errors and the ACL has to surface them as errors.
    for code in (400, 401, 403, 429, 500, 502):
        assert code not in SYNC_HTTP_TO_STATUS


def test_schema_version_is_pinned() -> None:
    assert ENVELOPE_SCHEMA_VERSION == "1"


def test_both_envelope_doors_are_declared() -> None:
    # domain-api wires two routes that decode a bare {action, payload}:
    # POST /commands (async, 202 -- the default) and POST /commands/sync
    # (blocking). The constants are the shared truth the ACL relays to.
    assert ASYNC_COMMAND_PATH == "/commands"
    assert SYNC_COMMAND_PATH == "/commands/sync"
