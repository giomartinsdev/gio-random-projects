# FastAPI route handlers nested inside create_app() below are only ever
# invoked via the @app.get/@app.api_route decorator, never referenced by
# name — invisible to reportUnusedFunction's static analysis.
# pyright: reportUnusedFunction=false

from __future__ import annotations

from contextlib import AbstractAsyncContextManager, asynccontextmanager
from typing import TYPE_CHECKING

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.responses import (
    Response,  # noqa: TC002 — FastAPI resolves route return-type annotations at runtime (get_type_hints), so this can't be TYPE_CHECKING-only
)

from app.auth import require_api_key
from app.config import settings
from app.proxy import forward

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable


def _make_lifespan(
    transport: httpx.AsyncBaseTransport | None,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        async with httpx.AsyncClient(
            timeout=settings.request_timeout_seconds, transport=transport
        ) as client:
            app.state.http_client = client
            yield

    return lifespan


def create_app(transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    """transport is only ever set by tests — it swaps the real network
    transport for an in-process ASGI one pointed at a fake upstream, so
    proxy behavior can be tested without a real second server running."""
    app = FastAPI(title="Gateway", lifespan=_make_lifespan(transport))

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.api_route(
        "/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        dependencies=[Depends(require_api_key)],
    )
    async def proxy_all(request: Request, path: str) -> Response:
        return await forward(request, request.app.state.http_client, settings.upstream_url, path)

    return app


app = create_app()
