"""The envelope is the contract -- these tests pin its wire shape.

If these fail, both apps are broken at once, which is the point of the
package living in packages/.
"""

from __future__ import annotations

from finance_contracts import (
    ACTION_MAX_LENGTH,
    ENVELOPE_SCHEMA_VERSION,
    FINANCE_ACTION_PREFIX,
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
    env = CommandEnvelope("finance.transaction.register", {"amount": "45.00"})
    # Golden shape: no extra keys, no nesting surprises. Anything added
    # here reaches domain-api and the worker at the same time.
    assert env.to_wire() == {
        "action": "finance.transaction.register",
        "payload": {"amount": "45.00"},
    }


def test_envelope_always_emits_payload_even_when_empty() -> None:
    # An omitted payload would make the serialized body depend on the
    # command, and the golden test in the app could not stay byte-stable.
    assert CommandEnvelope("finance.x.y", {}).to_wire() == {
        "action": "finance.x.y",
        "payload": {},
    }


def test_envelope_is_frozen() -> None:
    env = CommandEnvelope("finance.a.b", {"k": 1})
    try:
        env.action = "finance.c.d"  # type: ignore[misc]
    except Exception:
        pass
    else:  # pragma: no cover
        raise AssertionError("envelope must be immutable")


def test_envelope_does_not_carry_a_client_side_command_id() -> None:
    # domain-api overwrites any client-supplied id ("the id must be the
    # one this process can poll for"), so the contract must not offer one.
    assert set(CommandEnvelope("finance.a.b", {}).to_wire()) == {"action", "payload"}


def test_actions_are_namespaced_and_bounded() -> None:
    for action in (
        "finance.transaction.register",
        "finance.transfer.betweenAccounts",
        "finance.budget.setCategory",
    ):
        assert action.startswith(FINANCE_ACTION_PREFIX)
        assert len(action) <= ACTION_MAX_LENGTH


def test_accepted_result_is_the_202_shape() -> None:
    res = AcceptedResult(command_id="c-1")
    assert res.status == STATUS_ACCEPTED
    assert (res.command_id, res.status) == ("c-1", "accepted")


def test_sync_written_is_the_only_confirmation() -> None:
    written = SyncResult("c-1", SYNC_STATUS_WRITTEN, entity_id="tx-9")
    queued = SyncResult("c-1", SYNC_STATUS_QUEUED, error="still coming")
    failed = SyncResult("c-1", SYNC_STATUS_FAILED, error="unknown action")
    assert written.is_confirmed is True
    # The whole point of the 504 row in the README: timeout != not written.
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


def test_the_only_envelope_door_is_the_sync_one() -> None:
    # router.go wires POST /sync as the only route that decodes a bare
    # {action, payload} envelope; every 202 route takes a route-specific
    # payload. If slice 2 adds an async envelope door, this test is the
    # tripwire that says so.
    import finance_contracts

    assert SYNC_COMMAND_PATH == "/sync"
    assert not hasattr(finance_contracts, "ASYNC_COMMAND_PATH"), (
        "an async envelope door is now assumed to exist: wire it in "
        "CommandRouter (supports_async) and document the path before "
        "exporting a constant for it"
    )
