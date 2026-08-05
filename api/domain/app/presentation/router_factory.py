"""Builds one POST /events/<kebab-event-name> route per registered event.

Call this AFTER infrastructure.discovery.discover_domain() has run, or
EVENT_REGISTRY will still be empty — see presentation/app.py's lifespan.
"""

# Deliberately NO `from __future__ import annotations` here: the
# `payload: event_cls` annotation below is a live closure variable, not
# a module-level name — with postponed evaluation on, that annotation
# becomes the *string* "event_cls" instead, which FastAPI's
# get_type_hints() can't resolve (it's not in the function's globals),
# silently breaking request body validation for every route (confirmed
# by testing: every route started 422ing once this was turned on).

import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlmodel import Session  # noqa: TC002 — see module docstring note on annotations above

from app.domain.base import EVENT_REGISTRY, DomainEvent
from app.infrastructure.db import get_session
from app.service.dispatcher import dispatch

_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def _kebab(name: str) -> str:
    return _CAMEL_BOUNDARY.sub("-", name).lower()


def _make_endpoint(event_cls: type[DomainEvent[Any]]) -> Any:  # noqa: ANN401 — one endpoint fn generated per event class, body/return genuinely vary per class
    def endpoint(payload: event_cls, session: Session = Depends(get_session)) -> Any:  # type: ignore[valid-type]  # noqa: ANN401
        return dispatch(payload, session)  # pyright: ignore[reportUnknownArgumentType] — payload's real type is event_cls, only known at route-registration time

    endpoint.__name__ = f"handle_{_kebab(event_cls.__name__).replace('-', '_')}"
    return endpoint  # pyright: ignore[reportUnknownVariableType] — same reason: endpoint's signature is genuinely dynamic per event_cls


def build_router() -> APIRouter:
    router = APIRouter(prefix="/events", tags=["events"])
    for event_cls in EVENT_REGISTRY:
        router.add_api_route(
            f"/{_kebab(event_cls.__name__)}",
            _make_endpoint(event_cls),
            methods=["POST"],
            name=event_cls.__name__,
            summary=event_cls.__doc__ or event_cls.__name__,
        )
    return router
