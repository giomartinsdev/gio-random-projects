"""Entrypoint: ``python -m finance_api.main`` (the Dockerfile's ENTRYPOINT).

Reads configuration once, assembles the container, and serves. A missing
required setting exits non-zero with a message naming it -- a container that
boots unconfigured and answers 502 to every request is strictly worse than
one that refuses to start.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

import uvicorn

from finance_api.infrastructure.config import ConfigError, Settings, load_settings
from finance_api.infrastructure.domain_api import DomainApiClient
from finance_api.infrastructure.google import GoogleVerifier
from finance_api.infrastructure.polp import DEFAULT_BASE_URL, PolpClient
from finance_api.infrastructure.telemetry import configure_telemetry
from finance_api.application.commands import CommandRouter
from finance_api.application.openfinance import OpenFinanceService
from finance_api.application.reads import QueryRouter
from finance_api.presentation.app import create_app
from finance_api.presentation.dependencies import Container

logger = logging.getLogger("finance_api")


def build_app(settings: Settings) -> object:
    """Assemble the app from already-validated settings."""
    client = DomainApiClient(
        base_url=settings.domain_api_base_url,
        api_key=settings.domain_api_key,
        timeout_s=settings.domain_timeout_s,
    )
    router = CommandRouter(client)
    polp = PolpClient(
        settings.polp_client_id,
        settings.polp_client_secret,
        base_url=settings.polp_base_url or DEFAULT_BASE_URL,
        sandbox=settings.polp_sandbox,
    )
    container = Container(
        router=router,
        api_keys=settings.finance_api_keys,
        queries=QueryRouter(client),
        google=GoogleVerifier(settings.google_client_id) if settings.google_client_id else None,
        google_client_id=settings.google_client_id,
        session_secret=settings.session_secret,
        session_ttl_s=settings.session_ttl_s,
        openfinance=OpenFinanceService(polp, router),
    )
    return create_app(
        container,
        instrument=bool(settings.otlp_endpoint),
        allowed_origins=settings.cors_origins,
    )


def main() -> int:
    logging.basicConfig(level=logging.INFO)
    try:
        settings = load_settings()
    except ConfigError as exc:
        # Named setting, not a stack trace: this is the failure an operator
        # will actually hit while wiring the stack.
        logger.error("configuration error: %s", exc)
        return 1

    provider = configure_telemetry(settings.otlp_endpoint, settings.service_name)

    app = build_app(settings)
    try:
        uvicorn.run(
            app,  # type: ignore[arg-type]
            host=settings.http_host,
            port=settings.http_port,
            log_level="info",
        )
    finally:
        if provider is not None:  # pragma: no cover - exercised only with OTLP
            provider.shutdown()  # type: ignore[attr-defined]
    return 0


if __name__ == "__main__":
    sys.exit(main())
