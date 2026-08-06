"""Builds one route per registered event — path, HTTP verb, and
Swagger-UI tag all derived from the event class itself, not declared
per event.

Call this AFTER infrastructure.discovery.discover_domain() has run, or
EVENT_REGISTRY will still be empty — see presentation/app.py's lifespan.
"""

# Deliberately NO `from __future__ import annotations` here: the
# `payload` parameter's annotation below is assigned post-hoc via
# `endpoint.__annotations__[...] = ...`, a live object either way, but
# FastAPI's get_type_hints() call at route-registration time still needs
# every OTHER live annotation in this module (`Session` on the `session`
# parameter) to resolve normally — postponed evaluation turns those into
# strings it can't look up, exactly as this bit us before turning this
# on (confirmed by testing: every route started 422ing).

import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session  # noqa: TC002 — see module docstring note on annotations above

from app.domain.base import EVENT_REGISTRY, DomainEvent
from app.infrastructure.db import get_session
from app.service.dispatcher import dispatch

_CAMEL_BOUNDARY = re.compile(r"(?<!^)(?=[A-Z])")
# GET and DELETE requests carry their payload as query parameters, not a
# JSON body — matching HTTP convention (a body on these methods is
# unreliable across real infrastructure: plenty of proxies/caches
# strip or ignore it) and, just as importantly, matching what httpx's
# own Client.delete()/.get() shorthand actually supports (params=, not
# json=) — every caller here (the gateway, flows/vehicle_position_archiver)
# uses that shorthand. A payload with a list field that could get large
# (DeleteVehiclePositionHistoryBatch's `ids`) is the caller's own job to
# chunk before calling — see that flow's loader, same reasoning as
# RecordVehiclePositions' _CHUNK_SIZE. POST/PUT/PATCH keep the existing
# request-body binding.
_QUERY_BOUND_METHODS = {"GET", "DELETE"}
# "app", "domain", "<name>", "events" (or "history_events", ...) — the
# minimum module-path depth for `_tag` to trust parts[2] as a domain name.
_DOMAIN_MODULE_DEPTH = 2


def _kebab(name: str) -> str:
    return _CAMEL_BOUNDARY.sub("-", name).lower()


def _tag(event_cls: type[DomainEvent[Any]]) -> str:
    # "app.domain.vehicle_position.events" -> "vehicle_position" ->
    # "Vehicle Position" — groups Swagger UI's route list by domain
    # folder instead of one flat list, with zero per-event declaration.
    parts = event_cls.__module__.split(".")
    if len(parts) > _DOMAIN_MODULE_DEPTH and parts[0] == "app" and parts[1] == "domain":
        return parts[2].replace("_", " ").title()
    return "Events"


def _make_endpoint(event_cls: type[DomainEvent[Any]]) -> Any:  # noqa: ANN401 — one endpoint fn generated per event class, body/return genuinely vary per class
    def endpoint(payload: Any, session: Session = Depends(get_session)) -> Any:  # noqa: ANN401
        return dispatch(payload, session)  # pyright: ignore[reportUnknownArgumentType] — payload's real type is event_cls, only known at route-registration time

    is_query_bound = event_cls.__http_method__ in _QUERY_BOUND_METHODS
    endpoint.__annotations__["payload"] = (
        Annotated[event_cls, Query()] if is_query_bound else event_cls
    )
    endpoint.__name__ = f"handle_{_kebab(event_cls.__name__).replace('-', '_')}"
    return endpoint  # pyright: ignore[reportUnknownVariableType] — same reason: endpoint's signature is genuinely dynamic per event_cls


def build_router() -> APIRouter:
    router = APIRouter(prefix="/events")
    for event_cls in EVENT_REGISTRY:
        router.add_api_route(
            f"/{_kebab(event_cls.__name__)}",
            _make_endpoint(event_cls),
            methods=[event_cls.__http_method__],
            name=event_cls.__name__,
            summary=event_cls.__doc__ or event_cls.__name__,
            tags=[_tag(event_cls)],
        )
    return router
