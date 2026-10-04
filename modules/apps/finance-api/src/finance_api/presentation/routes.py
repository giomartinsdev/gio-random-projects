"""The ACL's HTTP surface.

Three routes, and the split between them is the contract:

- ``GET /healthz`` -- public, no key, matching domain-api's liveness route.
  This is what §10.6 curls after a deploy.
- ``POST /commands`` -- the worker's default door. Validates, relays, and
  answers the async ``202 {status:"accepted"}`` from domain-api's
  ``/commands``: the command is published and the worker applies it (§4.1).
- ``POST /commands/sync`` -- the same envelope on the explicitly blocking
  path. A ``504`` from domain-api is reported as ``504`` **with** its "still
  queued, may still land" message: timeout is not failure.
- ``POST /queries`` -- the read door (spec §4.2). The same envelope, with
  ``payload`` carrying ``user_id``/``date``/``month``; relays to a domain-api
  GET and returns the projection. Reads are unambiguous: 200 or an error.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from finance_contracts import (
    SYNC_STATUS_FAILED,
    SYNC_STATUS_QUEUED,
    SYNC_STATUS_WRITTEN,
)
from finance_api.application.commands import (
    RELAY_MODE_ASYNC,
    RELAY_MODE_SYNC,
    AsyncRelayUnavailable,
    CommandRouter,
)
from finance_api.application.reads import QueryRouter
from finance_api.domain.errors import (
    DomainApiError,
    DomainApiTimeout,
    ValidationError,
)
from finance_api.presentation.dependencies import Container
from finance_api.presentation.schemas import (
    CommandRequest,
    ErrorResponse,
    HealthResponse,
    QueryRequest,
    RelayResponse,
)
from finance_api.presentation.security import authenticate

router = APIRouter()

# HTTP status for each /sync outcome. Only ``written`` is 200; the other two
# keep the status domain-api gave them, so a caller that already understands
# domain-api's contract needs no new table.
_STATUS_BY_OUTCOME = {
    SYNC_STATUS_WRITTEN: 200,
    SYNC_STATUS_FAILED: 422,
    SYNC_STATUS_QUEUED: 504,
}


def get_container(request: Request) -> Container:
    container = getattr(request.app.state, "container", None)
    if container is None:  # pragma: no cover - wiring bug, not a request case
        raise RuntimeError("application container is not configured")
    return container


def get_router(container: Container = Depends(get_container)) -> CommandRouter:
    return container.router


def get_query_router(container: Container = Depends(get_container)) -> QueryRouter:
    if container.queries is None:  # pragma: no cover - wiring bug, not a request case
        raise RuntimeError("read router is not configured")
    return container.queries


def get_caller_label(
    request: Request, container: Container = Depends(get_container)
) -> str:
    """Authenticate the request and return the caller's label.

    Raises ``UnauthorizedError``; the handler registered in main.py turns it
    into a 401 with the house ``{"error": ...}`` body -- the same shape
    domain-api answers with, so a caller has one error shape to parse.
    """
    return authenticate(request.headers, container.api_keys)


@router.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@router.post("/commands")
def submit_command(
    body: CommandRequest,
    caller: str = Depends(get_caller_label),
    commands: CommandRouter = Depends(get_router),
) -> JSONResponse:
    """Relay a command on the default (asynchronous) path.

    The house default is async (§4.1): the command is published and answered
    ``202 {status:"accepted"}``; the domain-worker applies it. A caller that
    must not proceed until the write is durable uses ``/commands/sync``. The
    ``relay`` field names the path actually used, so a log reader can tell
    the two apart.
    """
    try:
        outcome = commands.relay(body.action, body.payload, mode=RELAY_MODE_ASYNC)
    except AsyncRelayUnavailable as exc:  # pragma: no cover - door exists by default
        return _error(409, exc.message)
    except ValidationError as exc:
        return _error(422, exc.message)
    except DomainApiTimeout as exc:
        return _error(504, exc.message)
    except DomainApiError as exc:
        return _error(502, exc.message)

    # 202 accepted by domain-api; the async status IS the response status.
    payload = RelayResponse(
        command_id=outcome.command_id,
        status=outcome.status,
        error=outcome.error,
        relay=RELAY_MODE_ASYNC,
    )
    return JSONResponse(
        status_code=202, content=payload.model_dump(exclude_none=True)
    )


@router.post("/commands/sync")
def submit_command_sync(
    body: CommandRequest,
    caller: str = Depends(get_caller_label),
    commands: CommandRouter = Depends(get_router),
) -> JSONResponse:
    """Relay a command and report the worker's documented outcome."""
    try:
        outcome = commands.relay(body.action, body.payload, mode=RELAY_MODE_SYNC)
    except ValidationError as exc:
        return _error(422, exc.message)
    except DomainApiTimeout as exc:
        return _error(504, exc.message)
    except DomainApiError as exc:
        return _error(502, exc.message)

    # The relay mode is echoed back so an operator reading a log can tell
    # which path produced this result.
    status_code = _STATUS_BY_OUTCOME.get(outcome.status)
    if status_code is None:  # pragma: no cover - guarded by the port contract
        return _error(502, f"unexpected relay outcome {outcome.status!r}")

    payload = RelayResponse(
        command_id=outcome.command_id,
        status=outcome.status,
        entity_id=outcome.entity_id,
        error=outcome.error,
        relay=RELAY_MODE_SYNC,
    )
    # exclude_none keeps the body identical to domain-api's own: a written
    # reply carries entity_id and no error, a queued one the reverse.
    return JSONResponse(
        status_code=status_code, content=payload.model_dump(exclude_none=True)
    )


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content=ErrorResponse(error=message).model_dump()
    )


@router.post("/queries")
def run_query(
    body: QueryRequest,
    caller: str = Depends(get_caller_label),
    queries: QueryRouter = Depends(get_query_router),
) -> JSONResponse:
    """Relay a read query (spec §4.2) to a domain-api GET.

    Reads are synchronous on both sides: the ACL validates the action and its
    params, relays them as query string, parses the projection, and answers the
    projection JSON. Unlike the write door there is no 202/504 ambiguity — a
    read either happened or is an error. Errors keep domain-api's/ACL's shape:
    422 for a bad query, 502 for an upstream fault.
    """
    try:
        result = queries.relay(body.action, body.payload)
    except ValidationError as exc:
        return _error(422, exc.message)
    except DomainApiTimeout as exc:
        return _error(504, exc.message)
    except DomainApiError as exc:
        return _error(502, exc.message)

    return JSONResponse(status_code=200, content=result.to_wire())


