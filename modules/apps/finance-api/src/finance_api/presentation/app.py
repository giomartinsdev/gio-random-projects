"""The FastAPI application factory.

Separated from ``main.py`` (which reads the environment and runs uvicorn) so
tests can build the exact same app around a stubbed ``DomainApiPort``
without touching real configuration.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from finance_api.domain.errors import UnauthorizedError
from finance_api.presentation.authroutes import auth_router
from finance_api.presentation.dependencies import Container
from finance_api.presentation.openfinanceroutes import openfinance_router
from finance_api.presentation.routes import router

# Headers the SPA's fetch instrumentation adds and the write routes need.
# traceparent/tracestate/baggage come from finance-frontend/src/telemetry.ts;
# a preflight that does not allow them kills every call before it starts.
_CORS_ALLOW_HEADERS = [
    "Content-Type",
    "X-API-Key",
    "traceparent",
    "tracestate",
    "baggage",
]


def create_app(
    container: Container,
    *,
    instrument: bool = False,
    allowed_origins: Sequence[str] = (),
) -> FastAPI:
    app = FastAPI(
        title="finance-api",
        version="0.1.0",
        description=(
            "ACL do bounded context financeiro: valida o comando do worker, "
            "traduz para o envelope {action, payload} da casa e repassa ao "
            "domain-api. Sem banco e sem broker (spec §1.1)."
        ),
    )
    app.state.container = container

    # The SPA is a separate origin (its own bucket host), so the browser
    # needs CORS on every response, not a subset. An empty allowlist skips
    # the middleware entirely: a machine-only deploy gets no CORS headers,
    # which is the correct answer for a non-browser caller.
    #
    # allow_credentials=True is what lets the browser send the session cookie
    # cross-origin (finance. -> finance-api.); without it the login "works"
    # and every following request is a 401.
    if allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(allowed_origins),
            allow_credentials=True,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=_CORS_ALLOW_HEADERS,
        )

    # Every domain error becomes the house error body. domain-api answers
    # ``{"error": ...}``, so a caller of either service parses one shape.
    @app.exception_handler(UnauthorizedError)
    async def _unauthorized(_: Request, exc: UnauthorizedError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})

    app.include_router(auth_router)
    app.include_router(openfinance_router)
    app.include_router(router)

    if instrument:
        from finance_api.infrastructure.telemetry import instrument_app

        instrument_app(app)

    return app
