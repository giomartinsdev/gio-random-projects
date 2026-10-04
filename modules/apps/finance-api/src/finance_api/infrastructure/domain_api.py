"""HTTP client for ``domain-api`` -- the only way out of this app.

This is the ACL's outbound edge (§1.1): the finance context writes by
relaying a command here, and never by holding a connection of its own.

Two contract facts drive the whole module, both read from the source
rather than assumed:

1. **The three ``/sync`` outcomes are distinct and only one is a
   confirmation** (``modules/apps/domain-api/README.md``): ``200 written``
   / ``422 failed`` / ``504 queued``. A ``504`` is explicitly *not* a
   failure -- the command stays queued and may still land -- so it must
   never be mapped onto ``failed`` or onto a transport error. Collapsing
   those is how a user gets told their money entry did not happen when it
   did.
2. **``401`` from ``domain-api`` is our misconfiguration**, not the
   caller's: it means ``FINANCE_DOMAIN_API_KEY`` is not in the
   ``DOMAIN_API_KEYS`` list of the ``domain`` stack (§10.3). Reported as a
   server-side fault with a message naming the setting, and never echoing
   the key.

Anything undocumented (``400``, ``500``, a body that is not JSON, a
missing ``command_id``) is raised as an error instead of being squeezed
into one of the three outcomes.
"""

from __future__ import annotations

from typing import Any, Final, Mapping

import httpx

from finance_contracts import (
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
from finance_api.domain.errors import DomainApiError, DomainApiTimeout

API_KEY_HEADER: Final = "X-API-Key"

# Body of a 504, verbatim from domain-api's own response -- kept as our
# fallback so the "still coming" semantics survive even if a proxy strips
# the body on the way back.
QUEUED_FALLBACK_DETAIL: Final = (
    "worker did not finish the command within 10s — it stays queued and may "
    "still land"
)

_STATUS_TO_OUTCOME: Final[Mapping[int, str]] = SYNC_HTTP_TO_STATUS


class DomainApiClient:
    """Relays envelopes to ``domain-api`` over HTTP with ``X-API-Key``."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        timeout_s: float = 12.0,
        client: httpx.Client | None = None,
        # Both paths resolve to /sync today: it is the only door that decodes
        # the {action, payload} envelope (see the contract's SYNC_COMMAND_PATH
        # note). They stay separate parameters so the async door, when it
        # exists, is a one-line change rather than a rewrite.
        async_command_path: str = SYNC_COMMAND_PATH,
        sync_command_path: str = SYNC_COMMAND_PATH,
    ) -> None:
        self._async_path = async_command_path
        self._sync_path = sync_command_path
        self._api_key = api_key
        # ``client`` is injected by the tests as an httpx.Client bound to an
        # httpx.MockTransport, so the contract is exercised without a socket.
        self._client = client or httpx.Client(base_url=base_url, timeout=timeout_s)

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ async
    def send_async(self, envelope: CommandEnvelope) -> AcceptedResult:
        """POST the envelope and expect the ``202`` accepted shape."""
        response = self._post(self._async_path, envelope)
        if response.status_code != 202:
            raise self._unexpected(response, expected="202 accepted")

        body = self._json_object(response, context="accepted")
        command_id = self._required_str(body, "command_id", response=response)
        status = body.get("status")
        if status != STATUS_ACCEPTED:
            raise DomainApiError(
                f"domain-api answered 202 with status {status!r}; "
                f"expected {STATUS_ACCEPTED!r}"
            )
        return AcceptedResult(command_id=command_id, status=STATUS_ACCEPTED)

    # ------------------------------------------------------------------- sync
    def send_sync(self, envelope: CommandEnvelope) -> SyncResult:
        """POST the envelope and translate the documented ``/sync`` outcomes.

        ``200`` -> written, ``422`` -> failed, ``504`` -> queued. Nothing
        else is an outcome.
        """
        response = self._post(self._sync_path, envelope)
        outcome = _STATUS_TO_OUTCOME.get(response.status_code)
        if outcome is None:
            raise self._unexpected(response, expected="200/422/504")

        body = self._json_object(response, context="sync")
        command_id = self._required_str(body, "command_id", response=response)

        if outcome == SYNC_STATUS_WRITTEN:
            return SyncResult(
                command_id=command_id,
                status=SYNC_STATUS_WRITTEN,
                # entity_id may legitimately be absent on a successful
                # write; that is not an error, so it stays None.
                entity_id=self._optional_str(body, "entity_id"),
            )
        if outcome == SYNC_STATUS_FAILED:
            return SyncResult(
                command_id=command_id,
                status=SYNC_STATUS_FAILED,
                error=self._optional_str(body, "error") or "the worker rejected the command",
            )
        return SyncResult(
            command_id=command_id,
            status=SYNC_STATUS_QUEUED,
            error=self._optional_str(body, "error") or QUEUED_FALLBACK_DETAIL,
        )

    # ---------------------------------------------------------------- helpers
    def get(self, path: str, params: Mapping[str, str]) -> Mapping[str, Any]:
        """GET a read projection (§4.2) and return the JSON object.

        Reads are synchronous and unremarkable: a non-200 is an error, never
        a "queued" outcome (that distinction belongs to writes only). A
        transport failure maps to ``DomainApiError``/``DomainApiTimeout`` just
        like a write, so the caller has one set of failure semantics.
        """
        try:
            response = self._client.get(
                path,
                params=dict(params),
                headers={API_KEY_HEADER: self._api_key},
            )
        except httpx.TimeoutException as exc:
            raise DomainApiTimeout(
                "domain-api did not answer the read within the client timeout"
            ) from exc
        except httpx.HTTPError as exc:
            raise DomainApiError(f"could not reach domain-api: {type(exc).__name__}") from exc

        if response.status_code != 200:
            raise self._unexpected(response, expected="200 read")
        return self._json_object(response, context="read")

    def _post(self, path: str, envelope: CommandEnvelope) -> httpx.Response:
        try:
            # The key rides on every request rather than on the client's
            # default headers: a client supplied from outside (the tests, and
            # any future pooled client) must not be able to omit auth, because
            # a silently unauthenticated relay is a 401 in production that
            # looks like a worker problem.
            return self._client.post(
                path,
                json=envelope.to_wire(),
                headers={API_KEY_HEADER: self._api_key},
            )
        except httpx.TimeoutException as exc:
            # Our own timeout, distinct from domain-api's documented 504:
            # here the outcome is genuinely unknown, and we say so.
            raise DomainApiTimeout(
                "domain-api did not answer within the client timeout; the "
                "outcome is unknown — the command may still have been accepted"
            ) from exc
        except httpx.HTTPError as exc:
            raise DomainApiError(f"could not reach domain-api: {type(exc).__name__}") from exc

    def _unexpected(self, response: httpx.Response, *, expected: str) -> DomainApiError:
        if response.status_code == 401:
            # Our fault, not the caller's: the key this ACL presents to
            # domain-api is not in the domain stack's DOMAIN_API_KEYS.
            return DomainApiError(
                "domain-api answered 401: FINANCE_DOMAIN_API_KEY is missing from "
                "the domain stack's DOMAIN_API_KEYS (spec §10.3)"
            )
        return DomainApiError(
            f"domain-api answered {response.status_code} where {expected} was "
            f"expected; treating it as an error rather than a write outcome"
        )

    def _json_object(self, response: httpx.Response, *, context: str) -> Mapping[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise DomainApiError(
                f"domain-api's {context} response was not JSON"
            ) from exc
        if not isinstance(body, Mapping):
            raise DomainApiError(
                f"domain-api's {context} response was not a JSON object"
            )
        return body

    def _required_str(
        self, body: Mapping[str, Any], field: str, *, response: httpx.Response
    ) -> str:
        value = body.get(field)
        if not isinstance(value, str) or not value.strip():
            # Without command_id the caller cannot correlate the audit row,
            # so a success we cannot attribute is not a success we report.
            raise DomainApiError(
                f"domain-api's {response.status_code} response has no usable "
                f"{field!r}: the command cannot be correlated"
            )
        return value

    def _optional_str(self, body: Mapping[str, Any], field: str) -> str | None:
        value = body.get(field)
        if value is None:
            return None
        return value if isinstance(value, str) else str(value)
