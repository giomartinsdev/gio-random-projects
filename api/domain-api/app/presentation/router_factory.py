"""Builds one POST /events/<kebab-event-name> route per registered event.

Call this AFTER infrastructure.discovery.discover_domain() has run, or
EVENT_REGISTRY will still be empty — see presentation/app.py's lifespan.
"""

import re
from typing import Any

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.domain.base import DomainEvent, EVENT_REGISTRY
from app.infrastructure.db import get_session
from app.service.dispatcher import dispatch

_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")


def _kebab(name: str) -> str:
    return _CAMEL_BOUNDARY.sub("-", name).lower()


def _make_endpoint(event_cls: type[DomainEvent[Any]]) -> Any:
    def endpoint(payload: event_cls, session: Session = Depends(get_session)) -> Any:  # type: ignore[valid-type]
        return dispatch(payload, session)

    endpoint.__name__ = f"handle_{_kebab(event_cls.__name__).replace('-', '_')}"
    return endpoint


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
