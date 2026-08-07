# See test_proxy_steps.py's identical note on httpx TestClient's own
# Unknown/Any stubs.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

scenarios("../features/public_routes.feature")


@given("a gateway proxying to a real upstream server", target_fixture="client")
def _given_gateway(gateway_client: TestClient) -> TestClient:
    return gateway_client


@when(parsers.parse('"{path}" is requested without an API key'), target_fixture="response")
def _when_requested_without_key(client: TestClient, path: str) -> Any:
    return client.get(path)


@when(parsers.parse('"{path}" is requested from origin "{origin}"'), target_fixture="response")
def _when_requested_from_origin(client: TestClient, path: str, origin: str) -> Any:
    return client.get(path, headers={"Origin": origin})


@then(parsers.parse("the response status is {status:d}"))
def _then_status(response: Any, status: int) -> None:
    assert response.status_code == status


@then("upstream did not see an X-API-Key header")
def _then_no_api_key_header(response: Any) -> None:
    assert response.json()["saw_api_key_header"] is None


@then(parsers.parse('upstream received the request at "{path}"'))
def _then_upstream_saw_path(response: Any, path: str) -> None:
    assert response.json()["path"] == path


@then(parsers.parse('the response allows the origin "{origin}"'))
def _then_response_allows_origin(response: Any, origin: str) -> None:
    assert response.headers.get("access-control-allow-origin") == origin


@then("the response has no CORS allow-origin header")
def _then_response_has_no_cors_header(response: Any) -> None:
    assert "access-control-allow-origin" not in response.headers
