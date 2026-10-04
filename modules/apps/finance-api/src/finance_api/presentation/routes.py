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
from finance_api.presentation.dependencies import (
    Container,
    caller_label,
    get_container,
    session_from,
)
from finance_api.presentation.schemas import (
    CommandRequest,
    ErrorResponse,
    HealthResponse,
    QueryRequest,
    RelayResponse,
)

router = APIRouter()

# HTTP status for each /sync outcome. Only ``written`` is 200; the other two
# keep the status domain-api gave them, so a caller that already understands
# domain-api's contract needs no new table.
_STATUS_BY_OUTCOME = {
    SYNC_STATUS_WRITTEN: 200,
    SYNC_STATUS_FAILED: 422,
    SYNC_STATUS_QUEUED: 504,
}


def get_router(container: Container = Depends(get_container)) -> CommandRouter:
    return container.router


def get_query_router(container: Container = Depends(get_container)) -> QueryRouter:
    if container.queries is None:  # pragma: no cover - wiring bug, not a request case
        raise RuntimeError("read router is not configured")
    return container.queries


def get_caller_label(
    request: Request, container: Container = Depends(get_container)
) -> str:
    """Autentica o chamador (worker por ``X-API-Key`` ou SPA por sessão).

    Devolve um rótulo para a auditoria. Os dois caminhos convivem na mesma
    rota: o worker manda a key, o SPA manda o cookie de sessão.
    """
    return caller_label(request, container)


@router.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(status="ok")


@router.post("/commands")
def submit_command(
    body: CommandRequest,
    request: Request,
    caller: str = Depends(get_caller_label),
    commands: CommandRouter = Depends(get_router),
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Relay a command on the default (asynchronous) path.

    The house default is async (§4.1): the command is published and answered
    ``202 {status:"accepted"}``; the domain-worker applies it. A caller that
    must not proceed until the write is durable uses ``/commands/sync``. The
    ``relay`` field names the path actually used, so a log reader can tell
    the two apart.
    """
    payload = _scoped_payload(request, container, body.payload)
    if isinstance(payload, JSONResponse):
        return payload
    try:
        outcome = commands.relay(body.action, payload, mode=RELAY_MODE_ASYNC)
    except AsyncRelayUnavailable as exc:  # pragma: no cover - door exists by default
        return _error(409, exc.message)
    except ValidationError as exc:
        return _error(422, exc.message)
    except DomainApiTimeout as exc:
        return _error(504, exc.message)
    except DomainApiError as exc:
        return _error(502, exc.message)

    # 202 accepted by domain-api; the async status IS the response status.
    outgoing = RelayResponse(
        command_id=outcome.command_id,
        status=outcome.status,
        error=outcome.error,
        relay=RELAY_MODE_ASYNC,
    )
    return JSONResponse(
        status_code=202, content=outgoing.model_dump(exclude_none=True)
    )


@router.post("/commands/sync")
def submit_command_sync(
    body: CommandRequest,
    request: Request,
    caller: str = Depends(get_caller_label),
    commands: CommandRouter = Depends(get_router),
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Relay a command and report the worker's documented outcome."""
    payload = _scoped_payload(request, container, body.payload)
    if isinstance(payload, JSONResponse):
        return payload
    try:
        outcome = commands.relay(body.action, payload, mode=RELAY_MODE_SYNC)
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

    outgoing = RelayResponse(
        command_id=outcome.command_id,
        status=outcome.status,
        entity_id=outcome.entity_id,
        error=outcome.error,
        relay=RELAY_MODE_SYNC,
    )
    # exclude_none keeps the body identical to domain-api's own: a written
    # reply carries entity_id and no error, a queued one the reverse.
    return JSONResponse(
        status_code=status_code, content=outgoing.model_dump(exclude_none=True)
    )


def _scoped_payload(
    request: Request, container: Container, payload: dict
) -> dict | JSONResponse:
    """Amarra o ``user_id`` de um comando do SPA ao telefone da sessão.

    O worker (``X-API-Key``) manda o ``user_id`` no payload, porque o NLU
    resolve o telefone a partir do remetente do WhatsApp. O SPA não tem esse
    contexto, então quando a chamada vem por SESSÃO e não traz ``user_id``, o
    telefone da sessão entra — a pessoa só opera no próprio ledger. Um payload
    do SPA que já traga ``user_id`` diferente do seu é recusado: não se escreve
    na conta de outro. Devolve um ``JSONResponse`` (422) quando recusa.
    """
    if _request_has_api_key(request, container):
        return payload  # worker: o payload é dele
    session = session_from(request, container)
    if session is None:
        return payload  # sem sessão, o Depends já barrou; defensivo
    phone = session.phone
    provided = payload.get("user_id")
    if provided and phone and str(provided) != phone:
        return _error(422, "user_id não pertence à sessão")
    if not phone:
        return _error(422, "vincule seu número do WhatsApp antes de registrar")
    return {**payload, "user_id": phone}


def _request_has_api_key(request: Request, container: Container) -> bool:
    from finance_api.presentation.security import API_KEY_HEADER

    return bool(request.headers.get(API_KEY_HEADER) or request.headers.get(API_KEY_HEADER.lower()))


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content=ErrorResponse(error=message).model_dump()
    )


@router.post("/queries")
def run_query(
    body: QueryRequest,
    request: Request,
    caller: str = Depends(get_caller_label),
    queries: QueryRouter = Depends(get_query_router),
    container: Container = Depends(get_container),
) -> JSONResponse:
    """Relay a read query (spec §4.2) to a domain-api GET.

    Reads are synchronous on both sides: the ACL validates the action and its
    params, relays them as query string, parses the projection, and answers the
    projection JSON. Unlike the write door there is no 202/504 ambiguity — a
    read either happened or is an error. Errors keep domain-api's/ACL's shape:
    422 for a bad query, 502 for an upstream fault.
    """
    params = _scoped_payload(request, container, body.payload)
    if isinstance(params, JSONResponse):
        return params
    try:
        result = queries.relay(body.action, params)
    except ValidationError as exc:
        return _error(422, exc.message)
    except DomainApiTimeout as exc:
        return _error(504, exc.message)
    except DomainApiError as exc:
        return _error(502, exc.message)

    return JSONResponse(status_code=200, content=result.to_wire())


