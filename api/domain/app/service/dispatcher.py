"""Application-layer boundary between presentation and domain.

Deliberately thin — presentation never calls event.handle() directly, it
goes through here, so cross-cutting concerns (auth checks, logging,
unit-of-work/transaction wrapping, retries) have exactly one place to
land without presentation or domain needing to know about them.

Currently does one such thing: every event dispatched gets an audit row
in domain_event_store (see infrastructure/event_store.py) — no domain
event has to opt into this, it's a property of being dispatched at all.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel
from sqlmodel import Session

from app.domain.base import DomainEvent
from app.infrastructure.event_store import DomainEventRecord


def _serialize_result(result: Any) -> str | None:
    if result is None:
        return None
    if isinstance(result, BaseModel):
        return result.model_dump_json()
    if isinstance(result, list):
        return json.dumps(
            [item.model_dump(mode="json") if isinstance(item, BaseModel) else item for item in result]
        )
    return json.dumps(result)


def dispatch(event: DomainEvent[Any], session: Session) -> Any:
    result = event.handle(session)

    session.add(
        DomainEventRecord(
            event_type=type(event).__name__,
            entity_type=event.__entity__.__name__,
            payload=event.model_dump_json(),
            result=_serialize_result(result),
        )
    )
    session.commit()

    return result
