"""Domain/ACL errors, and the HTTP status each one maps to.

Kept as data (``status``) rather than raised-and-translated in the route,
so the mapping is one readable table instead of a chain of ``except``
clauses that drifts as cases are added.
"""

from __future__ import annotations


class FinanceError(Exception):
    """Base class for errors the ACL reports to its own caller."""

    status = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class ValidationError(FinanceError):
    """The caller's command violates a contract or a §3.4 invariant."""

    status = 422


class UnauthorizedError(FinanceError):
    """Missing or unknown ``X-API-Key``."""

    status = 401


class DomainApiError(FinanceError):
    """domain-api was unreachable, or answered something undocumented.

    Deliberately *not* any of the ``/sync`` outcomes: a transport failure
    or a 500 is a real error and must never be collapsed into
    ``queued``/``failed``, which would make an outage look like a slow
    worker.
    """

    status = 502


class DomainApiTimeout(FinanceError):
    """The request to domain-api outlived our client timeout.

    Distinct from the domain-api's own documented ``504`` (which carries a
    body and means "still queued"). Here we do not know the outcome, so the
    caller is told exactly that -- ``504`` and never a fabricated success.
    """

    status = 504
