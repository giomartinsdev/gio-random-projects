from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.infrastructure.db import create_db_and_tables
from app.infrastructure.discovery import discover_domain
from app.presentation.router_factory import build_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    discover_domain()  # imports every domain/<name>/{entity,events}.py
    create_db_and_tables()  # creates any table SQLModel doesn't know about yet
    app.include_router(build_router())  # one route per discovered event
    yield


def create_app() -> FastAPI:
    return FastAPI(title="Domain Event API", lifespan=lifespan)


app = create_app()
