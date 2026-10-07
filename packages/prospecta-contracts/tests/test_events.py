"""Event shape: required fields, the fit invariant, and idempotency keys.

Positive, negative, and edge cases for each of the 12 domain events. The
payload classes validate themselves (no infra): an invalid event cannot be
constructed, so a bad command never reaches the wire.
"""

from __future__ import annotations

import pytest

from prospecta_contracts import (
    EVENT_COMPANY_REGISTERED,
    EVENT_MEETING_BOOKED,
    EVENT_REPLY_RECEIVED,
    EVENT_SCHEMA_VERSION,
    CampaignStarted,
    CompanyRegistered,
    DomainEvent,
    ICPDefined,
    LeadDiscovered,
    LeadEnriched,
    LeadQualified,
    MeetingBooked,
    MessageApproved,
    MessageDrafted,
    MessageSent,
    ProspectRequested,
    ReplyReceived,
)


def test_event_wire_shape_is_versioned_and_commands_attributed() -> None:
    ev = DomainEvent(
        event_id="e-1",
        command_id="c-1",
        event_type="CompanyRegistered",
        occurred_at="2026-10-03T12:00:00+00:00",
        payload={"entity_id": "co-9"},
    )
    assert ev.to_wire() == {
        "event_id": "e-1",
        "command_id": "c-1",
        "event_type": "CompanyRegistered",
        "occurred_at": "2026-10-03T12:00:00+00:00",
        "schema_version": "1",
        "payload": {"entity_id": "co-9"},
    }


def test_event_carries_both_ids_for_at_least_once_delivery() -> None:
    ev = DomainEvent("e-1", "c-1", "CompanyRegistered", "2026-10-03T12:00:00+00:00", {})
    wire = ev.to_wire()
    assert wire["event_id"] and wire["command_id"]
    assert wire["schema_version"] == EVENT_SCHEMA_VERSION == "1"


def test_all_twelve_event_types_are_named() -> None:
    from prospecta_contracts import (
        EVENT_CAMPAIGN_STARTED,
        EVENT_ICP_DEFINED,
        EVENT_LEAD_DISCOVERED,
        EVENT_LEAD_ENRICHED,
        EVENT_LEAD_QUALIFIED,
        EVENT_MESSAGE_APPROVED,
        EVENT_MESSAGE_DRAFTED,
        EVENT_MESSAGE_SENT,
        EVENT_PROSPECT_REQUESTED,
    )

    assert {
        EVENT_COMPANY_REGISTERED,
        EVENT_ICP_DEFINED,
        EVENT_CAMPAIGN_STARTED,
        EVENT_PROSPECT_REQUESTED,
        EVENT_LEAD_DISCOVERED,
        EVENT_LEAD_ENRICHED,
        EVENT_LEAD_QUALIFIED,
        EVENT_MESSAGE_DRAFTED,
        EVENT_MESSAGE_APPROVED,
        EVENT_MESSAGE_SENT,
        EVENT_REPLY_RECEIVED,
        EVENT_MEETING_BOOKED,
    } == {
        "CompanyRegistered",
        "ICPDefined",
        "CampaignStarted",
        "ProspectRequested",
        "LeadDiscovered",
        "LeadEnriched",
        "LeadQualified",
        "MessageDrafted",
        "MessageApproved",
        "MessageSent",
        "ReplyReceived",
        "MeetingBooked",
    }


# ------------------------------------------------------------- round-trips
@pytest.mark.parametrize(
    "payload",
    [
        CompanyRegistered("co-1", "t-1", "ACME", site="acme.com", description="logs"),
        CompanyRegistered("co-1", "t-1", "ACME"),
        ICPDefined("icp-1", "t-1", "co-1", "frotas > 50 veiculos", ["expansão de frota"]),
        ICPDefined("icp-1", "t-1", "co-1", "generico", []),
        CampaignStarted("camp-1", "t-1", "co-1", "icp-1", ["email", "whatsapp"]),
        ProspectRequested("camp-1", "t-1"),
        LeadDiscovered("lead-1", "t-1", "camp-1", "FrotaX", domain="frotax.com"),
        LeadDiscovered("lead-1", "t-1", "camp-1", "FrotaX", fit=0),
        LeadEnriched("lead-1", "t-1", {"decisor": "Ana", "email": "ana@frotax.com"}),
        LeadEnriched("lead-1", "t-1", {}),
        LeadQualified("lead-1", "t-1", 100),
        LeadQualified("lead-1", "t-1", 0),
        MessageDrafted("m-1", "t-1", "lead-1", "email", "Ola!"),
        MessageApproved("m-1", "t-1"),
        MessageSent("m-1", "t-1", "evo-123", "2026-10-03T12:00:00+00:00"),
        ReplyReceived("lead-1", "t-1", "thread-1", "Oi, podemos marcar", "evo-124"),
        MeetingBooked("lead-1", "t-1", "2026-10-10T15:00:00-03:00"),
    ],
)
def test_payload_round_trips_through_a_domain_event(payload: object) -> None:
    wire = DomainEvent(
        event_id="e-1",
        command_id="c-1",
        event_type=type(payload).__name__,
        occurred_at="2026-10-03T12:00:00+00:00",
        payload=payload.to_payload(),  # type: ignore[attr-defined]
    ).to_wire()
    assert wire["payload"] == payload.to_payload()  # type: ignore[attr-defined]
    assert wire["event_type"] == type(payload).__name__


# --------------------------------------------------- required-field negatives
@pytest.mark.parametrize(
    "build",
    [
        lambda: CompanyRegistered("", "t-1", "ACME"),
        lambda: CompanyRegistered("co-1", "", "ACME"),
        lambda: CompanyRegistered("co-1", "t-1", ""),
        lambda: ICPDefined("icp-1", "t-1", "", "x", []),
        lambda: ICPDefined("icp-1", "t-1", "co-1", "", []),
        lambda: ICPDefined("icp-1", "t-1", "co-1", "x", "not-a-list"),
        lambda: CampaignStarted("camp-1", "t-1", "co-1", "icp-1", "email"),
        lambda: ProspectRequested("", "t-1"),
        lambda: LeadDiscovered("lead-1", "t-1", "camp-1", ""),
        lambda: LeadEnriched("lead-1", "t-1", "not-a-map"),
        lambda: MessageDrafted("m-1", "t-1", "lead-1", "email", ""),
        lambda: MessageSent("m-1", "t-1", "", "2026-10-03T12:00:00+00:00"),
        lambda: ReplyReceived("lead-1", "t-1", "", "oi", "evo-1"),
        lambda: MeetingBooked("lead-1", "t-1", ""),
    ],
)
def test_missing_required_field_is_rejected(build: object) -> None:
    with pytest.raises(ValueError):
        build()  # type: ignore[operator]


# -------------------------------------------------------------- fit invariant
@pytest.mark.parametrize("bad_fit", [-1, 101, 1000])
def test_lead_qualified_rejects_fit_out_of_range(bad_fit: int) -> None:
    # contracts/domain-api-extensions.md: fit in 0..100 else 422.
    with pytest.raises(ValueError):
        LeadQualified("lead-1", "t-1", bad_fit)


@pytest.mark.parametrize("bad_fit", [1.0, "50", True, None])
def test_lead_qualified_rejects_non_int_fit(bad_fit: object) -> None:
    with pytest.raises(ValueError):
        LeadQualified("lead-1", "t-1", bad_fit)  # type: ignore[arg-type]


@pytest.mark.parametrize("edge_fit", [0, 100])
def test_lead_qualified_accepts_the_range_boundaries(edge_fit: int) -> None:
    assert LeadQualified("lead-1", "t-1", edge_fit).to_payload()["fit"] == edge_fit


def test_lead_discovered_enforces_fit_when_present() -> None:
    with pytest.raises(ValueError):
        LeadDiscovered("lead-1", "t-1", "camp-1", "FrotaX", fit=150)
    # Absent fit is allowed -- a discovered lead may be unqualified.
    assert LeadDiscovered("lead-1", "t-1", "camp-1", "FrotaX").to_payload()["fit"] is None


# ------------------------------------------------------------- idempotency
def test_reply_thread_key_is_idempotent_per_tenant() -> None:
    reply = ReplyReceived("lead-1", "t-1", "thread-1", "oi", "evo-1")
    assert reply.idempotency_key() == "t-1:thread-1"
    # Same thread in another tenant is a different conversation.
    other_tenant = ReplyReceived("lead-1", "t-2", "thread-1", "oi", "evo-1")
    assert other_tenant.idempotency_key() != reply.idempotency_key()
    # A different thread is a different key.
    other_thread = ReplyReceived("lead-1", "t-1", "thread-2", "oi", "evo-1")
    assert other_thread.idempotency_key() != reply.idempotency_key()


def test_payloads_are_frozen_and_serialize_lists_as_lists() -> None:
    started = CampaignStarted("camp-1", "t-1", "co-1", "icp-1", ("email",))
    assert started.to_payload()["channels"] == ["email"]
    try:
        started.status = "paused"  # type: ignore[misc]
    except Exception:
        pass
    else:  # pragma: no cover
        raise AssertionError("payload must be immutable")


def test_message_approved_keeps_the_prior_status_for_the_transition() -> None:
    # The contract allows approving only from ``drafted`` (else 409); the
    # payload keeps what it was so the consumer can assert the transition.
    payload = MessageApproved("m-1", "t-1").to_payload()
    assert payload["previous_status"] == "drafted"
    assert payload["status"] == "approved"


def test_company_registered_payload_keeps_optional_fields_none() -> None:
    payload = CompanyRegistered("co-1", "t-1", "ACME").to_payload()
    assert payload["site"] is None
    assert payload["description"] is None
