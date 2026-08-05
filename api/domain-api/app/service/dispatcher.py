"""Application-layer boundary between presentation and domain.

Deliberately thin today — presentation never calls event.handle()
directly, it goes through here, so cross-cutting concerns (auth checks,
logging, unit-of-work/transaction wrapping, retries) have exactly one
place to land without presentation or domain needing to know about them.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.domain.base import DomainEvent


def dispatch(event: DomainEvent[Any], session: Session) -> Any:
    return event.handle(session)
