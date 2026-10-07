"""Domain events of the prospecta bounded context.

Shape follows the house rule stated in the spec (§12.3 analogues): every
event carries ``event_id``/``command_id`` and a **versioned** schema, so a
consumer can be idempotent per ``command_id``/``event_id`` (delivery is
at-least-once -- the outbox belongs to ``domain-worker``, not to us).

Nothing here publishes: ``prospecta-api`` never touches the broker (§1.1).
These are the typed names and the wire shape the worker will consume.

Each payload class validates its own required fields in ``__post_init__``
(and, for ``LeadQualified``, the ``fit`` invariant ``0..100`` from
contracts/domain-api-extensions.md) so an invalid event cannot even be
constructed -- the same "fail before a wasted round trip" rule the envelope
applies to ``action``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Mapping, Sequence

EVENT_SCHEMA_VERSION: Final = "1"

EVENT_COMPANY_REGISTERED: Final = "CompanyRegistered"
EVENT_ICP_DEFINED: Final = "ICPDefined"
EVENT_CAMPAIGN_STARTED: Final = "CampaignStarted"
EVENT_PROSPECT_REQUESTED: Final = "ProspectRequested"
EVENT_LEAD_DISCOVERED: Final = "LeadDiscovered"
EVENT_LEAD_ENRICHED: Final = "LeadEnriched"
EVENT_LEAD_QUALIFIED: Final = "LeadQualified"
EVENT_MESSAGE_DRAFTED: Final = "MessageDrafted"
EVENT_MESSAGE_APPROVED: Final = "MessageApproved"
EVENT_MESSAGE_SENT: Final = "MessageSent"
EVENT_REPLY_RECEIVED: Final = "ReplyReceived"
EVENT_MEETING_BOOKED: Final = "MeetingBooked"

# ``fit`` is an int in 0..100 (data-model.md §4, CHECK constraint).
FIT_MIN: Final = 0
FIT_MAX: Final = 100


def _require_text(field: str, value: Any) -> None:
    """Reject missing/blank required text -- the field is the aggregate key."""
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} must be a non-empty string")


def _require_fit(value: Any) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("fit must be an int")
    if not FIT_MIN <= value <= FIT_MAX:
        raise ValueError(f"fit must be between {FIT_MIN} and {FIT_MAX}")


def _require_sequence(field: str, value: Any) -> None:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise ValueError(f"{field} must be a sequence")


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """One domain event.

    ``command_id`` is what makes the at-least-once delivery safe: a
    consumer that has already applied this command's effect must be a
    no-op the second time.
    """

    event_id: str
    command_id: str
    event_type: str
    occurred_at: str
    payload: Mapping[str, Any]
    schema_version: str = EVENT_SCHEMA_VERSION

    def to_wire(self) -> dict[str, Any]:
        return {
            "event_id": self.event_id,
            "command_id": self.command_id,
            "event_type": self.event_type,
            "occurred_at": self.occurred_at,
            "schema_version": self.schema_version,
            "payload": dict(self.payload),
        }


@dataclass(frozen=True, slots=True)
class CompanyRegistered:
    """Payload of EVENT_COMPANY_REGISTERED -- insert ``prospecta_company``."""

    company_id: str
    tenant_id: str
    name: str
    site: str | None = None
    description: str | None = None

    def __post_init__(self) -> None:
        _require_text("company_id", self.company_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("name", self.name)

    def to_payload(self) -> dict[str, Any]:
        return {
            "company_id": self.company_id,
            "tenant_id": self.tenant_id,
            "name": self.name,
            "site": self.site,
            "description": self.description,
        }


@dataclass(frozen=True, slots=True)
class ICPDefined:
    """Payload of EVENT_ICP_DEFINED -- upsert ``prospecta_icp`` (+embedding)."""

    icp_id: str
    tenant_id: str
    company_id: str
    definition: str
    signals: Sequence[str]

    def __post_init__(self) -> None:
        _require_text("icp_id", self.icp_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("company_id", self.company_id)
        _require_text("definition", self.definition)
        _require_sequence("signals", self.signals)

    def to_payload(self) -> dict[str, Any]:
        return {
            "icp_id": self.icp_id,
            "tenant_id": self.tenant_id,
            "company_id": self.company_id,
            "definition": self.definition,
            "signals": list(self.signals),
        }


@dataclass(frozen=True, slots=True)
class CampaignStarted:
    """Payload of EVENT_CAMPAIGN_STARTED -- update ``prospecta_campaign.status``."""

    campaign_id: str
    tenant_id: str
    company_id: str
    icp_id: str
    channels: Sequence[str]
    status: str = "running"

    def __post_init__(self) -> None:
        _require_text("campaign_id", self.campaign_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("company_id", self.company_id)
        _require_text("icp_id", self.icp_id)
        _require_sequence("channels", self.channels)

    def to_payload(self) -> dict[str, Any]:
        return {
            "campaign_id": self.campaign_id,
            "tenant_id": self.tenant_id,
            "company_id": self.company_id,
            "icp_id": self.icp_id,
            "channels": list(self.channels),
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class ProspectRequested:
    """Payload of EVENT_PROSPECT_REQUESTED -- opens a ``prospecta_agent_run``."""

    campaign_id: str
    tenant_id: str
    agent: str = "prospector"

    def __post_init__(self) -> None:
        _require_text("campaign_id", self.campaign_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("agent", self.agent)

    def to_payload(self) -> dict[str, Any]:
        return {
            "campaign_id": self.campaign_id,
            "tenant_id": self.tenant_id,
            "agent": self.agent,
        }


@dataclass(frozen=True, slots=True)
class LeadDiscovered:
    """Payload of EVENT_LEAD_DISCOVERED -- upsert ``prospecta_lead`` (dedup)."""

    lead_id: str
    tenant_id: str
    campaign_id: str
    company_name: str
    domain: str | None = None
    segment: str | None = None
    channel: str | None = None
    fit: int | None = None
    source_url: str | None = None
    status: str = "discovered"

    def __post_init__(self) -> None:
        _require_text("lead_id", self.lead_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("campaign_id", self.campaign_id)
        _require_text("company_name", self.company_name)
        if self.fit is not None:
            _require_fit(self.fit)

    def to_payload(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "campaign_id": self.campaign_id,
            "company_name": self.company_name,
            "domain": self.domain,
            "segment": self.segment,
            "channel": self.channel,
            "fit": self.fit,
            "source_url": self.source_url,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class LeadEnriched:
    """Payload of EVENT_LEAD_ENRICHED -- update ``prospecta_lead.enriched``."""

    lead_id: str
    tenant_id: str
    enriched: Mapping[str, Any]

    def __post_init__(self) -> None:
        _require_text("lead_id", self.lead_id)
        _require_text("tenant_id", self.tenant_id)
        if not isinstance(self.enriched, Mapping):
            raise ValueError("enriched must be a mapping")

    def to_payload(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "enriched": dict(self.enriched),
        }


@dataclass(frozen=True, slots=True)
class LeadQualified:
    """Payload of EVENT_LEAD_QUALIFIED -- update ``prospecta_lead.fit/status``.

    ``fit`` is the qualifying score, an int in ``0..100``; anything else is
    the contract's ``422`` invariant and is rejected here.
    """

    lead_id: str
    tenant_id: str
    fit: int
    status: str = "qualified"

    def __post_init__(self) -> None:
        _require_text("lead_id", self.lead_id)
        _require_text("tenant_id", self.tenant_id)
        _require_fit(self.fit)

    def to_payload(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "fit": self.fit,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class MessageDrafted:
    """Payload of EVENT_MESSAGE_DRAFTED -- insert ``prospecta_message`` (drafted)."""

    message_id: str
    tenant_id: str
    lead_id: str
    channel: str
    content: str
    direction: str = "out"
    status: str = "drafted"

    def __post_init__(self) -> None:
        _require_text("message_id", self.message_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("lead_id", self.lead_id)
        _require_text("channel", self.channel)
        _require_text("content", self.content)

    def to_payload(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "tenant_id": self.tenant_id,
            "lead_id": self.lead_id,
            "channel": self.channel,
            "content": self.content,
            "direction": self.direction,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class MessageApproved:
    """Payload of EVENT_MESSAGE_APPROVED -- update ``prospecta_message.status``.

    Only a ``drafted`` message may be approved (contract invariant, else
    ``409``); this payload keeps the prior status so the consumer can assert
    the transition instead of blindly overwriting.
    """

    message_id: str
    tenant_id: str
    previous_status: str = "drafted"
    status: str = "approved"

    def __post_init__(self) -> None:
        _require_text("message_id", self.message_id)
        _require_text("tenant_id", self.tenant_id)

    def to_payload(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "tenant_id": self.tenant_id,
            "previous_status": self.previous_status,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class MessageSent:
    """Payload of EVENT_MESSAGE_SENT -- update ``status=sent`` + ``external_id``."""

    message_id: str
    tenant_id: str
    external_id: str
    sent_at: str
    status: str = "sent"

    def __post_init__(self) -> None:
        _require_text("message_id", self.message_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("external_id", self.external_id)
        _require_text("sent_at", self.sent_at)

    def to_payload(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "tenant_id": self.tenant_id,
            "external_id": self.external_id,
            "sent_at": self.sent_at,
            "status": self.status,
        }


@dataclass(frozen=True, slots=True)
class ReplyReceived:
    """Payload of EVENT_REPLY_RECEIVED -- upsert conversation + insert inbound message.

    ``thread_key`` is the idempotency key: unique per ``tenant_id``
    (data-model.md §6), so a repeated delivery is the duplicate to swallow.
    """

    lead_id: str
    tenant_id: str
    thread_key: str
    content: str
    external_id: str
    direction: str = "in"

    def __post_init__(self) -> None:
        _require_text("lead_id", self.lead_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("thread_key", self.thread_key)
        _require_text("content", self.content)
        _require_text("external_id", self.external_id)

    def idempotency_key(self) -> str:
        return f"{self.tenant_id}:{self.thread_key}"

    def to_payload(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "thread_key": self.thread_key,
            "content": self.content,
            "external_id": self.external_id,
            "direction": self.direction,
        }


@dataclass(frozen=True, slots=True)
class MeetingBooked:
    """Payload of EVENT_MEETING_BOOKED -- update ``prospecta_lead.status=meeting``."""

    lead_id: str
    tenant_id: str
    when: str
    status: str = "meeting"

    def __post_init__(self) -> None:
        _require_text("lead_id", self.lead_id)
        _require_text("tenant_id", self.tenant_id)
        _require_text("when", self.when)

    def to_payload(self) -> dict[str, Any]:
        return {
            "lead_id": self.lead_id,
            "tenant_id": self.tenant_id,
            "when": self.when,
            "status": self.status,
        }
