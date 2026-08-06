"""End-to-end proxy behavior against a fake in-process upstream (a tiny
FastAPI app reached via an ASGI transport, not a real second server) —
exercises the exact same code path a real deployment uses, just without
real network I/O.
"""

# Fake upstream's route handlers are only ever invoked via the
# @upstream.get/@upstream.post decorator, never referenced by name. And
# httpx's TestClient.get()/.post()/.json() surfaces Unknown/Any through
# its own stubs regardless of caller code (confirmed: a minimal
# reproduction hits the same "Unknown" on TestClient's own `auth`
# default sentinel) — these tests assert against raw wire-level JSON
# responses, exactly the case where that's unavoidable.
# pyright: reportUnusedFunction=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.config import settings
from app.main import create_app

if TYPE_CHECKING:
    from collections.abc import Generator

VALID_KEY = "test-key-123"
CLIENT_NAME = "test-client"


def _build_fake_upstream() -> FastAPI:
    upstream = FastAPI()

    @upstream.get("/events/get-user")
    async def get_user(request: Request) -> dict[str, str | None]:
        return {
            "seen_query_id": request.query_params.get("id"),
            "saw_api_key_header": request.headers.get("x-api-key"),
        }

    @upstream.post("/events/create-user")
    async def create_user(payload: dict[str, str]) -> dict[str, str]:
        return {"created": payload["name"]}

    return upstream


@pytest.fixture()
def gateway_client() -> Generator[TestClient]:
    settings.api_keys = f"{VALID_KEY}:{CLIENT_NAME}"
    transport = httpx.ASGITransport(app=_build_fake_upstream())
    app = create_app(transport=transport)
    with TestClient(app) as client:
        yield client


def test_request_without_api_key_is_rejected(gateway_client: TestClient) -> None:
    # Given a request with no X-API-Key header
    # When it hits any proxied route
    response = gateway_client.get("/events/get-user", params={"id": "1"})

    # Then the gateway rejects it before ever reaching upstream
    assert response.status_code == 401


def test_request_with_wrong_api_key_is_rejected(gateway_client: TestClient) -> None:
    # Given a request with a key that isn't configured
    # When it hits any proxied route
    response = gateway_client.get(
        "/events/get-user", params={"id": "1"}, headers={"X-API-Key": "not-a-real-key"}
    )

    # Then the gateway rejects it
    assert response.status_code == 401


def test_valid_request_is_forwarded_with_query_params_intact(gateway_client: TestClient) -> None:
    # Given a valid API key and a query param meant for upstream
    # When the request is proxied
    response = gateway_client.get(
        "/events/get-user", params={"id": "42"}, headers={"X-API-Key": VALID_KEY}
    )

    # Then upstream received the query param and the response passed through
    assert response.status_code == 200
    assert response.json()["seen_query_id"] == "42"


def test_api_key_header_is_not_forwarded_upstream(gateway_client: TestClient) -> None:
    # Given a valid API key
    # When the request is proxied
    response = gateway_client.get(
        "/events/get-user", params={"id": "1"}, headers={"X-API-Key": VALID_KEY}
    )

    # Then upstream never saw the gateway's own credential header
    assert response.json()["saw_api_key_header"] is None


def test_post_body_is_forwarded_to_upstream(gateway_client: TestClient) -> None:
    # Given a valid API key and a JSON body meant for upstream
    # When posting through the gateway
    response = gateway_client.post(
        "/events/create-user",
        json={"name": "gio", "email": "gio@example.com"},
        headers={"X-API-Key": VALID_KEY},
    )

    # Then upstream received and processed the body, and its response passed through
    assert response.status_code == 200
    assert response.json() == {"created": "gio"}


def test_health_endpoint_does_not_require_auth(gateway_client: TestClient) -> None:
    # Given no API key
    # When checking /health
    response = gateway_client.get("/health")

    # Then it's reachable without credentials (used for container healthchecks)
    assert response.status_code == 200


def test_oversized_body_is_rejected_before_reaching_upstream(
    gateway_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given a cap far smaller than the body about to be sent
    monkeypatch.setattr(settings, "max_body_bytes", 10)

    # When posting a body over that cap
    response = gateway_client.post(
        "/events/create-user",
        json={"name": "x" * 100, "email": "gio@example.com"},
        headers={"X-API-Key": VALID_KEY},
    )

    # Then the gateway rejects it itself — a leaked key or buggy client
    # can't force it (or the upstream it forwards to) to buffer an
    # unbounded body in memory
    assert response.status_code == 413


def test_body_within_the_cap_is_still_forwarded(
    gateway_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given a cap comfortably above the body about to be sent
    monkeypatch.setattr(settings, "max_body_bytes", 10_000)

    # When posting a small body
    response = gateway_client.post(
        "/events/create-user",
        json={"name": "gio", "email": "gio@example.com"},
        headers={"X-API-Key": VALID_KEY},
    )

    # Then it's forwarded normally
    assert response.status_code == 200
    assert response.json() == {"created": "gio"}


def test_requests_over_the_rate_limit_are_rejected(
    gateway_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Given a low limit and a key unique to this test (the limiter's
    # counters are keyed per API key and shared process-wide across
    # tests, so reusing VALID_KEY here would double-count against
    # whatever other tests already sent with it)
    monkeypatch.setattr(settings, "rate_limit", "2/minute")
    rate_limited_key = "rate-limit-test-key"
    settings.api_keys = f"{VALID_KEY}:{CLIENT_NAME},{rate_limited_key}:{CLIENT_NAME}"
    headers = {"X-API-Key": rate_limited_key}

    # When sending more requests than the limit allows within the window
    responses = [
        gateway_client.get("/events/get-user", params={"id": "1"}, headers=headers)
        for _ in range(3)
    ]

    # Then the requests within the limit succeed and the rest are throttled
    assert [r.status_code for r in responses] == [200, 200, 429]
