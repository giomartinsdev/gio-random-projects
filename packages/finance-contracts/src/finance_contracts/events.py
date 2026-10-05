"""Domain events of the finance bounded context.

Shape follows the house rule stated in the spec (§12.3): every event
carries ``event_id``/``command_id`` and a **versioned** schema, so a
consumer can be idempotent per ``command_id``/``event_id`` (delivery is
at-least-once -- the outbox belongs to ``domain-worker``, not to us).

Nothing here publishes: ``finance-api`` never touches the broker (§1.1).
These are the typed names and the wire shape the worker will consume.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Mapping

EVENT_SCHEMA_VERSION: Final = "1"

EVENT_TRANSACTION_REGISTERED: Final = "finance.transaction.registered"
EVENT_TRANSACTION_CATEGORIZED: Final = "finance.transaction.categorized"
EVENT_TRANSACTION_UPDATED: Final = "finance.transaction.updated"
EVENT_TRANSACTION_REMOVED: Final = "finance.transaction.removed"
EVENT_TRANSACTION_ACTIVITY_CHANGED: Final = "finance.transaction.activityChanged"
EVENT_INVESTMENT_SYNCED: Final = "finance.investment.synced"
EVENT_INVESTMENT_TRANSACTION_SYNCED: Final = "finance.investment.transactionSynced"
EVENT_TRANSFER_COMPLETED: Final = "finance.transfer.completed"
EVENT_BUDGET_THRESHOLD_REACHED: Final = "finance.budget.thresholdReached"
EVENT_OF_CONSENT_UPDATED: Final = "finance.openfinance.consentUpdated"


@dataclass(frozen=True, slots=True)
class DomainEvent:
    """One domain event.

    ``command_id`` is what makes the at-least-once delivery safe: a
    consumer that has already applied this command's effect must be a
    no-op the second time (spec §12.5).
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
class BudgetThresholdReached:
    """Payload of EVENT_BUDGET_THRESHOLD_REACHED.

    ``threshold`` is 50/80/100 (spec §3.3) and ``period`` is what keeps
    the rule "fires once per threshold per period" testable: the key is
    ``(budget_id, threshold, period)``, so a repeated delivery for the
    same key is the duplicate the consumer must swallow.
    """

    budget_id: str
    category: str
    threshold: int
    period: str
    spent_amount: str
    limit_amount: str
    currency: str

    def idempotency_key(self) -> str:
        return f"{self.budget_id}:{self.threshold}:{self.period}"

    def to_payload(self) -> dict[str, Any]:
        return {
            "budget_id": self.budget_id,
            "category": self.category,
            "threshold": self.threshold,
            "period": self.period,
            "spent_amount": self.spent_amount,
            "limit_amount": self.limit_amount,
            "currency": self.currency,
        }
