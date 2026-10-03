"""Ports: what the application layer needs from the outside world.

Two methods, matching the two documented write paths of ``domain-api``.
Nothing here mentions a database or a broker -- if one ever did, §1.1
would have been broken at the interface level, which is the cheapest place
to catch it.
"""

from __future__ import annotations

from typing import Protocol

from finance_contracts import AcceptedResult, CommandEnvelope, SyncResult


class DomainApiPort(Protocol):
    """The write front door of the CQRS side (modules/apps/domain-api)."""

    def send_async(self, envelope: CommandEnvelope) -> AcceptedResult:
        """Publish the command and return the ``202`` accepted result.

        The default path for the finance context: the WhatsApp worker
        answers the user asynchronously and does not need the write to be
        durable before replying (spec §4.1).
        """
        ...

    def send_sync(self, envelope: CommandEnvelope) -> SyncResult:
        """Relay and wait for the worker's audit row.

        Returns one of the three documented outcomes. Callers must treat
        only ``written`` as a confirmation -- ``queued`` (504) means "still
        coming", not "not written".
        """
        ...
