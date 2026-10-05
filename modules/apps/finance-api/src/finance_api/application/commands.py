"""The ACL's use case: translate a worker command into a house envelope.

This layer owns exactly three things and nothing else:

1. **Routing** an incoming action to its payload model. An action with no
   model is refused -- we never relay a payload we have not validated,
   and we never fall back to passing the caller's body through.
2. **Validation** of that payload against the §3.4 invariants.
3. **Relay mode**: async (``202``, the finance default) or sync, chosen
   explicitly by the route, never inferred from the body.

If this module ever needs a database session or a broker channel to do its
job, the design has drifted out of §1.1.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Final, Mapping

from finance_contracts import (
    ACTION_CATEGORIZE_TRANSACTION,
    ACTION_OF_ACCOUNT_SYNCED,
    ACTION_NOTIF_DELETE,
    ACTION_NOTIF_SET,
    ACTION_OF_CONSENT_CREATED,
    ACTION_OF_CONSENT_REMOVED,
    ACTION_OF_CONSENT_UPDATED,
    ACTION_REGISTER_TRANSACTION,
    ACTION_REMOVE_TRANSACTION,
    ACTION_SET_CATEGORY_BUDGET,
    ACTION_TRANSFER_BETWEEN_ACCOUNTS,
    ACTION_UPDATE_TRANSACTION,
    AcceptedResult,
    CommandEnvelope,
    SyncResult,
)
from finance_api.application.ports import DomainApiPort
from finance_api.domain.commands import (
    CategorizeTransactionCommand,
    RegisterTransactionCommand,
    RemoveTransactionCommand,
    SetCategoryBudgetCommand,
    TransferBetweenAccountsCommand,
    UpdateTransactionCommand,
)
from finance_api.domain.errors import ValidationError


class _Prebuilt:
    """Payload montado pela própria ACL (Open Finance).

    As ações ``finance.openfinance.*`` não vêm do worker: quem as monta é o
    ``OpenFinanceService`` (com os dados que o provedor devolveu). Não há modelo
    de domínio a validar aqui além do que a ACL já validou ao montar — então a
    "factory" apenas devolve o payload como está. As ações de escrita do worker
    continuam com os modelos estritos abaixo.
    """

    def __init__(self, payload: Mapping[str, Any]) -> None:
        self._payload = dict(payload)

    def to_payload(self) -> dict[str, Any]:
        return self._payload


# action -> payload model. An action missing from here is a 422, not a
# passthrough: unknown is unknown, and relaying it would push an
# unvalidated body across the boundary.
_WRITE_COMMANDS: Final[Mapping[str, Callable[[Mapping[str, Any]], Any]]] = {
    ACTION_REGISTER_TRANSACTION: RegisterTransactionCommand.from_payload,
    ACTION_CATEGORIZE_TRANSACTION: CategorizeTransactionCommand.from_payload,
    # Correção pelo próprio usuário (SPA): editar/remover lançamento. O user_id
    # é amarrado à sessão pelo _scoped_payload (§3.4 nº3) antes do relay.
    ACTION_UPDATE_TRANSACTION: UpdateTransactionCommand.from_payload,
    ACTION_REMOVE_TRANSACTION: RemoveTransactionCommand.from_payload,
    ACTION_TRANSFER_BETWEEN_ACCOUNTS: TransferBetweenAccountsCommand.from_payload,
    ACTION_SET_CATEGORY_BUDGET: SetCategoryBudgetCommand.from_payload,
    # Open Finance: payload já montado pela ACL (ver _Prebuilt).
    ACTION_OF_CONSENT_CREATED: _Prebuilt,
    ACTION_OF_CONSENT_UPDATED: _Prebuilt,
    ACTION_OF_CONSENT_REMOVED: _Prebuilt,
    # Notificações: payload montado pela ACL.
    ACTION_NOTIF_SET: _Prebuilt,
    ACTION_NOTIF_DELETE: _Prebuilt,
    ACTION_OF_ACCOUNT_SYNCED: _Prebuilt,
}

RELAY_MODE_ASYNC: Final = "async"
RELAY_MODE_SYNC: Final = "sync"
RELAY_MODES: Final = frozenset({RELAY_MODE_ASYNC, RELAY_MODE_SYNC})


@dataclass(frozen=True, slots=True)
class RelayOutcome:
    """What the ACL reports to its own caller, whichever path was taken."""

    command_id: str
    status: str
    relay: str
    entity_id: str | None = None
    error: str | None = None

    def to_wire(self) -> dict[str, Any]:
        body: dict[str, Any] = {"command_id": self.command_id, "status": self.status}
        if self.entity_id is not None:
            body["entity_id"] = self.entity_id
        if self.error is not None:
            body["error"] = self.error
        return body


class AsyncRelayUnavailable(ValidationError):
    """No ``202`` door exists for this action on ``domain-api`` today.

    Kept as a distinct error for the case where the capability is explicitly
    disabled (``supports_async=False``): the reason is then unmistakable in a
    log — a **missing capability upstream**, not a bad request. Since slice 3
    added ``POST /commands`` the capability exists and the default is on; the
    flag stays so a test can still pin the disabled behaviour.
    """


def known_write_actions() -> tuple[str, ...]:
    return tuple(sorted(_WRITE_COMMANDS))


class CommandRouter:
    """Validates a command and relays it to ``domain-api``.

    The relay-mode flag is a fact about the upstream surface, not a client
    choice. ``domain-api`` publishes an arbitrary action through two doors now:
    ``POST /commands`` (async, 202) and ``POST /sync`` (blocking). The house
    default is async (§4.1), so ``supports_async`` defaults to ``True``;
    ``/commands/sync`` passes ``mode="sync"`` explicitly.
    """

    def __init__(self, domain_api: DomainApiPort, *, supports_async: bool = True) -> None:
        self._domain_api = domain_api
        self._supports_async = supports_async

    def build_envelope(self, action: str, payload: Mapping[str, Any]) -> CommandEnvelope:
        """Validate ``payload`` for ``action`` and build the envelope.

        Pure: no I/O, so the contract tests can assert the exact body
        without stubbing the transport.
        """
        if not isinstance(action, str) or not action.strip():
            raise ValidationError("action is required")
        action = action.strip()

        model_factory = _WRITE_COMMANDS.get(action)
        if model_factory is None:
            raise ValidationError(
                f"unknown action {action!r}; this ACL relays only "
                f"{list(known_write_actions())}"
            )
        if payload is None:
            raise ValidationError("payload is required")
        if not isinstance(payload, Mapping):
            raise ValidationError("payload must be an object")

        command = model_factory(payload)
        return CommandEnvelope(action=action, payload=command.to_payload())

    def relay(
        self,
        action: str,
        payload: Mapping[str, Any],
        *,
        mode: str = RELAY_MODE_SYNC,
    ) -> RelayOutcome:
        if mode not in RELAY_MODES:
            raise ValidationError(f"relay mode must be one of {sorted(RELAY_MODES)}")
        if mode == RELAY_MODE_ASYNC and not self._supports_async:
            raise AsyncRelayUnavailable(
                "domain-api has no asynchronous envelope door for arbitrary "
                "actions: every 202 route takes a route-specific payload and "
                "only POST /sync decodes {action, payload}. Use the sync relay "
                "until that door exists."
            )

        envelope = self.build_envelope(action, payload)

        if mode == RELAY_MODE_ASYNC:
            accepted: AcceptedResult = self._domain_api.send_async(envelope)
            return RelayOutcome(
                command_id=accepted.command_id,
                status=accepted.status,
                relay=RELAY_MODE_ASYNC,
            )

        result: SyncResult = self._domain_api.send_sync(envelope)
        return RelayOutcome(
            command_id=result.command_id,
            status=result.status,
            relay=RELAY_MODE_SYNC,
            entity_id=result.entity_id,
            # Carried through verbatim for BOTH failed and queued: the
            # queued 504's message ("it stays queued and may still land")
            # is the one detail a caller must not have stripped from it.
            error=result.error,
        )
