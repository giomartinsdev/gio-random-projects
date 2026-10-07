"""The command envelope of this repo, as typed objects.

Every write in this house travels as ``{"action": ..., "payload": {...}}``
into ``domain-api``, which republishes it with a **fresh server-side id**
and answers either ``202 {command_id, status: "accepted"}`` (async) or the
``/commands/sync`` outcomes below. This module is the single source of truth
for that shape for the prospecta bounded context -- it lives in ``packages/``
precisely so ``prospecta-api`` and ``prospecta-agent-worker`` import the
same bytes instead of each carrying a copy (spec §7, §12.6).

Two rules are worth stating where the code is, because they are the ones
that get violated by accident:

1. **The caller never supplies ``id``.** ``domain-api`` overwrites it.
   The envelope models it as server-owned so a client cannot build one
   that looks authoritative.
2. **``/commands/sync``'s ``504`` is not a failure.** The command stays
   queued and may still land; only ``written`` is a confirmation. The
   response model below keeps ``status``/``error`` so callers can tell the
   three apart instead of collapsing them into a boolean.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Mapping

ENVELOPE_SCHEMA_VERSION: Final = "1"

# ``domain-api`` requires ``action`` non-empty and rejects the request
# otherwise; keeping the bound here means the ACL fails before a wasted
# round trip.
ACTION_MAX_LENGTH: Final = 128

# The write doors of domain-api. ``/commands`` is the **asynchronous envelope
# door**: it decodes the bare {action, payload} and answers ``202``
# immediately, which is the house default (spec §4.1). ``/commands/sync`` is
# the documented blocking exception -- the same envelope, but the caller waits
# for the worker's audit row (contracts/domain-api-extensions.md).
ASYNC_COMMAND_PATH: Final = "/commands"
SYNC_COMMAND_PATH: Final = "/commands/sync"


@dataclass(frozen=True, slots=True)
class CommandEnvelope:
    """A write request in the house's ``{action, payload}`` shape."""

    action: str
    payload: Mapping[str, Any]

    def to_wire(self) -> dict[str, Any]:
        """The exact JSON body to send. ``payload`` is always present.

        Always emitting ``payload`` (even empty) rather than omitting it
        keeps the serialized form byte-stable for the golden-file test in
        packages/prospecta-contracts/tests and for both apps.
        """
        return {"action": self.action, "payload": dict(self.payload)}


@dataclass(frozen=True, slots=True)
class AcceptedResult:
    """``202`` from an async write door: published, not yet applied."""

    command_id: str
    status: str = "accepted"


@dataclass(frozen=True, slots=True)
class SyncResult:
    """The three ``/commands/sync`` outcomes, kept distinct on purpose.

    - ``written``  (HTTP 200) -- applied; ``entity_id`` is the affected row.
    - ``failed``   (HTTP 422) -- the worker rejected it; retrying unchanged
      fails the same way.
    - ``queued``   (HTTP 504) -- gave up waiting. **The command stays queued
      and may still land.** Callers must not treat this as "not written".
    """

    command_id: str
    status: str
    entity_id: str | None = None
    error: str | None = None

    @property
    def is_confirmed(self) -> bool:
        """Only ``written`` is a confirmation -- not ``queued``."""
        return self.status == "written"


SYNC_STATUS_WRITTEN: Final = "written"
SYNC_STATUS_FAILED: Final = "failed"
SYNC_STATUS_QUEUED: Final = "queued"

STATUS_ACCEPTED: Final = "accepted"

# HTTP status -> envelope status, for the ACL's translation of a sync
# reply. 200/422/504 are the documented ones; anything else is a real
# error and must NOT be silently mapped onto one of these.
SYNC_HTTP_TO_STATUS: Final[Mapping[int, str]] = {
    200: SYNC_STATUS_WRITTEN,
    422: SYNC_STATUS_FAILED,
    504: SYNC_STATUS_QUEUED,
}


# ------------------------------------------------------------------ actions
# The prospecta command family (spec §7.2). The names live here, in the
# shared contract, so the worker's NLU layer and the ACL's router cannot
# drift apart -- a rename has to break both at once, in one place.
#
# The action names are the bare identifiers from the contract
# (contracts/domain-api-extensions.md): the domain worker dispatches them
# verbatim, so adding a namespace prefix would break every one of them.
ACTION_CREATE_COMPANY: Final = "CreateCompany"
ACTION_DEFINE_ICP: Final = "DefineICP"
ACTION_CREATE_CAMPAIGN: Final = "CreateCampaign"
ACTION_START_CAMPAIGN: Final = "StartCampaign"
ACTION_REQUEST_PROSPECT: Final = "RequestProspect"
ACTION_UPSERT_LEAD: Final = "UpsertLead"
ACTION_QUALIFY_LEAD: Final = "QualifyLead"
ACTION_DRAFT_MESSAGE: Final = "DraftMessage"
ACTION_APPROVE_MESSAGE: Final = "ApproveMessage"
ACTION_SEND_MESSAGE: Final = "SendMessage"
ACTION_RECEIVE_REPLY: Final = "ReceiveReply"
ACTION_BOOK_MEETING: Final = "BookMeeting"
