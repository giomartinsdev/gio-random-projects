from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.responses import Response

from app.auth import require_api_key
from app.config import settings
from app.proxy import forward


def _make_lifespan(transport: httpx.AsyncBaseTransport | None) -> Any:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds, transport=transport) as client:
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
