"""The command envelope of this repo, as typed objects.

Every write in this house travels as ``{"action": ..., "payload": {...}}``
into ``domain-api``, which republishes it with a **fresh server-side id**
and answers either ``202 {command_id, status: "accepted"}`` (async) or the
``/sync`` outcomes below. This module is the single source of truth for
that shape for the finance bounded context -- it lives in ``packages/``
precisely so ``finance-api`` and ``finance-customersupport-worker`` import the
same bytes instead of each carrying a copy (spec §7, §12.6).

Two rules are worth stating where the code is, because they are the ones
that get violated by accident:

1. **The caller never supplies ``id``.** ``domain-api`` overwrites it
   (see ``sync.Sync``: "any client-supplied id is overwritten"). The
   envelope models it as server-owned so a client cannot build one that
   looks authoritative.
2. **``/sync``'s ``504`` is not a failure.** The command stays queued and
   may still land; only ``written`` is a confirmation. The response model
   below keeps ``status``/``error`` so callers can tell the three apart
   instead of collapsing them into a boolean.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Mapping

ENVELOPE_SCHEMA_VERSION: Final = "1"

# ``domain-api`` requires ``action`` non-empty and rejects the request
# otherwise; keeping the bound here means the ACL fails before a wasted
# round trip.
ACTION_MAX_LENGTH: Final = 128

# The write doors of domain-api, as verified in
# modules/apps/domain-api/internal/infrastructure/http/router.go.
#
# ``/commands`` is the **asynchronous envelope door** (added in slice 3): it
# decodes the bare {action, payload} and answers ``202`` immediately, which is
# the house default (spec §4.1). ``/sync`` is the documented blocking exception
# — the same envelope, but the caller waits for the worker's audit row.
ASYNC_COMMAND_PATH: Final = "/commands"
SYNC_COMMAND_PATH: Final = "/sync"


@dataclass(frozen=True, slots=True)
class CommandEnvelope:
    """A write request in the house's ``{action, payload}`` shape."""

    action: str
    payload: Mapping[str, Any]

    def to_wire(self) -> dict[str, Any]:
        """The exact JSON body to send. ``payload`` is always present.

        Always emitting ``payload`` (even empty) rather than omitting it
        keeps the serialized form byte-stable for the golden-file test in
        packages/finance-contracts/tests and for both apps.
        """
        return {"action": self.action, "payload": dict(self.payload)}


@dataclass(frozen=True, slots=True)
class AcceptedResult:
    """``202`` from an async write door: published, not yet applied."""

    command_id: str
    status: str = "accepted"


@dataclass(frozen=True, slots=True)
class SyncResult:
    """The three ``/sync`` outcomes, kept distinct on purpose.

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

# HTTP status -> envelope status, for the ACL's translation of a /sync
# reply. 200/422/504 are the documented ones; anything else is a real
# error and must NOT be silently mapped onto one of these.
SYNC_HTTP_TO_STATUS: Final[Mapping[int, str]] = {
    200: SYNC_STATUS_WRITTEN,
    422: SYNC_STATUS_FAILED,
    504: SYNC_STATUS_QUEUED,
}


# ------------------------------------------------------------------ actions
# The ``finance.*`` action family (spec §4.1). The names live here, in the
# shared contract, so the worker's NLU layer and the ACL's router cannot
# drift apart -- a rename has to break both at once, in one place.
#
# NOTE (slice 1): domain-worker has no ``finance.`` dispatch case yet, so
# today any of these reaches the worker and is answered as
# ``unknown action: "finance..."`` -> 422 on /sync. That is the honest
# current behaviour and is exactly what the ACL's tests assert; slice 2
# (worker dispatch, .github/workflows, stacks/) is what makes them apply.
FINANCE_ACTION_PREFIX: Final = "finance."

ACTION_REGISTER_TRANSACTION: Final = "finance.transaction.register"
ACTION_CATEGORIZE_TRANSACTION: Final = "finance.transaction.categorize"
ACTION_TRANSFER_BETWEEN_ACCOUNTS: Final = "finance.transfer.betweenAccounts"
ACTION_SET_CATEGORY_BUDGET: Final = "finance.budget.setCategory"
# Correção pelo próprio usuário (SPA): editar campos de um lançamento já
# registrado ou removê-lo do ledger. Ambos carregam user_id — o dono do
# registro — e o worker valida posse antes de aplicar (§3.4 nº3).
ACTION_UPDATE_TRANSACTION: Final = "finance.transaction.update"
ACTION_REMOVE_TRANSACTION: Final = "finance.transaction.remove"
# Flag de movimentação entre contas próprias (BTG → MP): ativa/inativa.
ACTION_SET_TRANSACTION_ACTIVE: Final = "finance.transaction.setActive"
ACTION_RECONCILE_OPEN_FINANCE_TRANSACTION: Final = (
    "finance.transaction.reconcileOpenFinance"  # Fase 2
)

# Open Finance (Polp/Celcoin). O ciclo do consentimento é síncrono e voltado ao
# usuário (fica na ACL), mas cada mutação vira um comando para o domain-worker
# persistir — a ACL não tem banco (§1.1). O conector de sync usa os mesmos para
# gravar contas importadas.
ACTION_OF_CONSENT_CREATED: Final = "finance.openfinance.consentCreated"
ACTION_OF_CONSENT_UPDATED: Final = "finance.openfinance.consentUpdated"
ACTION_OF_CONSENT_REMOVED: Final = "finance.openfinance.consentRemoved"
ACTION_OF_ACCOUNT_SYNCED: Final = "finance.openfinance.accountSynced"

# Open Finance — investimentos (o conector publica; worker aplica). O Polp/
# Celcoin entrega posições e transações de investimento (webhooks
# ``investments`` / ``investments.transactions``, portal §Webhooks).
ACTION_INVESTMENT_SYNCED: Final = "finance.investment.synced"
ACTION_INVESTMENT_TRANSACTION_SYNCED: Final = "finance.investment.transactionSynced"

# Notificações que a pessoa cadastra (regras).
ACTION_NOTIF_SET: Final = "finance.notification.set"
ACTION_NOTIF_DELETE: Final = "finance.notification.delete"

# Reads (spec §4.2) -- served by domain-api GETs, projections only.
ACTION_GET_DAILY_SUMMARY: Final = "finance.query.dailySummary"
ACTION_GET_MONTHLY_DASHBOARD: Final = "finance.query.monthlyDashboard"
ACTION_GET_CATEGORY_BREAKDOWN: Final = "finance.query.categoryBreakdown"
ACTION_GET_CASH_FLOW_HISTORY: Final = "finance.query.cashFlowHistory"
ACTION_GET_TRANSACTIONS: Final = "finance.query.transactions"
ACTION_GET_TRANSACTION: Final = "finance.query.transaction"
ACTION_GET_NOTIFICATIONS: Final = "finance.query.notifications"
ACTION_GET_OF_CONSENTS: Final = "finance.query.ofConsents"
ACTION_GET_OF_ACCOUNTS: Final = "finance.query.ofAccounts"
ACTION_GET_INVESTMENTS: Final = "finance.query.investments"
