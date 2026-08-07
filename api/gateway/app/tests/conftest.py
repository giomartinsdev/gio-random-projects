"""Shared testcontainers-backed fixtures for every .feature scenario.

Every proxy scenario runs against a real upstream server (fixtures/
upstream_server.py) inside its own python:3.12-alpine container,
reached over a real TCP socket — not the in-process ASGITransport the
old unit tests swapped in. That's the actual thing worth testing here:
proxy.py's header stripping, query-param forwarding (the exact bug this
suite caught, see its own comment below), and body streaming all behave
differently across a real hop than through an in-memory ASGI call.

One upstream container per test session (starting one per test would
dominate suite runtime); app-level state (API keys, rate limit, body
cap) is reset per test via monkeypatch instead.
"""

# testcontainers ships no type stubs (same category of gap as pyarrow in
# flows/vehicle_position_archiver's etl/transform.py) — every symbol
# imported from it is intrinsically Unknown to pyright, not a real
# typing gap on our side.
# pyright: reportMissingTypeStubs=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi.testclient import TestClient
from testcontainers.core.container import DockerContainer

from app.config import settings
from app.main import create_app

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator

_FIXTURES_DIR = Path(__file__).parent / "fixtures"

VALID_KEY = "test-key-123"
CLIENT_NAME = "test-client"


@pytest.fixture(scope="session")
def upstream_container() -> Iterator[DockerContainer]:
    container = (
        DockerContainer("python:3.12-alpine")
        .with_volume_mapping(str(_FIXTURES_DIR), "/fixtures", mode="ro")
        .with_exposed_ports(8000)
        .with_command("python /fixtures/upstream_server.py")
    )
    with container:
        # http.server has nothing useful to log on startup — poll the
        # actual socket instead of wait_for_logs, which would otherwise
        # never see a matching line.
        host = container.get_container_host_ip()
        port = container.get_exposed_port(8000)
        for _ in range(50):
            try:
                httpx.get(f"http://{host}:{port}/events/get-user", timeout=0.5)
            except httpx.TransportError:
                time.sleep(0.1)
                continue
            else:
                break
        else:
            pytest.fail("upstream test container never became reachable")
        yield container


@pytest.fixture()
def gateway_client(
    upstream_container: DockerContainer, monkeypatch: pytest.MonkeyPatch
) -> Generator[TestClient]:
    host = upstream_container.get_container_host_ip()
    port = upstream_container.get_exposed_port(8000)
    monkeypatch.setattr(settings, "upstream_url", f"http://{host}:{port}")
    # Same fake server plays both roles here (see
    # fixtures/upstream_server.py's own comment) — a real deployment
    # points these at two different services.
    monkeypatch.setattr(settings, "bora_api_upstream_url", f"http://{host}:{port}")
    monkeypatch.setattr(settings, "api_keys", f"{VALID_KEY}:{CLIENT_NAME}")
    monkeypatch.setattr(settings, "max_body_bytes", 50_000_000)
    monkeypatch.setattr(settings, "rate_limit", "120/minute")
    monkeypatch.setattr(settings, "cors_origins", "http://localhost:5173")

    # No `transport=` override — real network I/O across the container
    # boundary, unlike the old unit tests' ASGITransport-backed fake.
    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
