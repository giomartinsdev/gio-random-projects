"""End-to-end proxy behavior against a real upstream server running in
its own testcontainer (see conftest.py) — exercises the exact same code
path a real deployment uses: a real TCP hop, not an in-process ASGI
transport standing in for one.
"""

# httpx's TestClient.get()/.post()/.request()/.json() surfaces
# Unknown/Any through its own stubs regardless of caller code (confirmed:
# a minimal reproduction hits the same "Unknown" on TestClient's own
# `auth` default sentinel) — these steps assert against raw wire-level
# JSON responses, exactly the case where that's unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when

from app.config import settings
from app.tests.conftest import CLIENT_NAME, VALID_KEY

if TYPE_CHECKING:
    import pytest
    from fastapi.testclient import TestClient

scenarios("../features/proxy.feature")


@given("a gateway proxying to a real upstream server", target_fixture="client")
def _given_gateway(gateway_client: TestClient) -> TestClient:
    return gateway_client


@given(parsers.parse("the body size cap is set to {cap:d} bytes"))
def _given_body_cap(monkeypatch: pytest.MonkeyPatch, cap: int) -> None:
    monkeypatch.setattr(settings, "max_body_bytes", cap)


@given(parsers.parse("the rate limit is set to {limit:d} per minute"))
def _given_rate_limit(monkeypatch: pytest.MonkeyPatch, limit: int) -> None:
    monkeypatch.setattr(settings, "rate_limit", f"{limit}/minute")


@when("a request without an API key hits a proxied route", target_fixture="response")
def _when_no_api_key(client: TestClient) -> Any:
    return client.get("/events/get-user", params={"id": "1"})


@when("a request with an unconfigured API key hits a proxied route", target_fixture="response")
def _when_wrong_api_key(client: TestClient) -> Any:
    return client.get(
        "/events/get-user", params={"id": "1"}, headers={"X-API-Key": "not-a-real-key"}
    )


@when(
    parsers.parse("a valid request with query param id={value} is proxied"),
    target_fixture="response",
)
def _when_valid_request(client: TestClient, value: str) -> Any:
    return client.get("/events/get-user", params={"id": value}, headers={"X-API-Key": VALID_KEY})


@when(
    parsers.parse("a valid delete request with repeated ids {a}, {b} and {c} is proxied"),
    target_fixture="response",
)
def _when_repeated_ids(client: TestClient, a: str, b: str, c: str) -> Any:
    return client.request(
        "DELETE",
        "/events/delete-batch",
        params=[("ids", a), ("ids", b), ("ids", c)],
        headers={"X-API-Key": VALID_KEY},
    )


@when(
    parsers.parse('a valid create-user request with name "{name}" is proxied'),
    target_fixture="response",
)
def _when_create_user(client: TestClient, name: str) -> Any:
    return client.post(
        "/events/create-user",
        json={"name": name, "email": "gio@example.com"},
        headers={"X-API-Key": VALID_KEY},
    )


@when(
    parsers.parse(
        'a valid create-user request with name "{char}" repeated {times:d} times is proxied'
    ),
    target_fixture="response",
)
def _when_create_user_oversized(client: TestClient, char: str, times: int) -> Any:
    return client.post(
        "/events/create-user",
        json={"name": char * times, "email": "gio@example.com"},
        headers={"X-API-Key": VALID_KEY},
    )


@when("/health is requested without an API key", target_fixture="response")
def _when_health(client: TestClient) -> Any:
    return client.get("/health")


@when(
    "3 requests are sent in a row with a fresh API key under that limit",
    target_fixture="rate_limited_responses",
)
def _when_three_requests(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> list[Any]:
    # A key unique to this test — the limiter's counters are keyed per
    # API key and shared process-wide across tests, so reusing VALID_KEY
    # here would double-count against whatever other tests already sent.
    rate_limited_key = "rate-limit-test-key"
    monkeypatch.setattr(
        settings, "api_keys", f"{VALID_KEY}:{CLIENT_NAME},{rate_limited_key}:{CLIENT_NAME}"
    )
    headers = {"X-API-Key": rate_limited_key}
    return [client.get("/events/get-user", params={"id": "1"}, headers=headers) for _ in range(3)]


@then(parsers.parse("the gateway rejects it with status {status:d}"))
def _then_rejected(response: Any, status: int) -> None:
    assert response.status_code == status


@then(parsers.parse("the response status is {status:d}"))
def _then_status(response: Any, status: int) -> None:
    assert response.status_code == status


@then(parsers.parse('upstream saw query param id "{value}"'))
def _then_saw_query_param(response: Any, value: str) -> None:
    assert response.json()["seen_query_id"] == value


@then(parsers.parse('upstream saw ids "{a}", "{b}" and "{c}"'))
def _then_saw_ids(response: Any, a: str, b: str, c: str) -> None:
    assert response.json()["seen_ids"] == [a, b, c]


@then("upstream did not see an X-API-Key header")
def _then_no_api_key_header(response: Any) -> None:
    assert response.json()["saw_api_key_header"] is None


@then(parsers.parse('upstream reports it created "{name}"'))
def _then_created(response: Any, name: str) -> None:
    assert response.json() == {"created": name}


@then("the first 2 succeed and the 3rd is rejected with status 429")
def _then_first_two_succeed(rate_limited_responses: list[Any]) -> None:
    assert [r.status_code for r in rate_limited_responses] == [200, 200, 429]


@then("the 429 response carries a Retry-After header")
def _then_retry_after(rate_limited_responses: list[Any]) -> None:
    assert "retry-after" in rate_limited_responses[-1].headers
