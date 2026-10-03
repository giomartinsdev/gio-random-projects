"""The FastAPI application factory.

Separated from ``main.py`` (which reads the environment and runs uvicorn) so
tests can build the exact same app around a stubbed ``DomainApiPort``
without touching real configuration.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from finance_api.domain.errors import UnauthorizedError
from finance_api.presentation.dependencies import Container
from finance_api.presentation.routes import router


def create_app(container: Container, *, instrument: bool = False) -> FastAPI:
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

    # Every domain error becomes the house error body. domain-api answers
    # ``{"error": ...}``, so a caller of either service parses one shape.
    @app.exception_handler(UnauthorizedError)
    async def _unauthorized(_: Request, exc: UnauthorizedError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content={"error": exc.message})

    app.include_router(router)

    if instrument:
        from finance_api.infrastructure.telemetry import instrument_app

        instrument_app(app)

    return app
