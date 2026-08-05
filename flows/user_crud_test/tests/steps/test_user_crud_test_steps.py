from __future__ import annotations

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.user_crud_test.client import GatewayClient
from flows.user_crud_test.schemas import UserPayload, UserResult
from flows.user_crud_test.tests.unit.test_client import API_KEY, FakeGateway

scenarios("../features/user_crud_test.feature")


@pytest.fixture()
def gateway_client() -> GatewayClient:
    """Test setup, not a Gherkin-visible action — a plain pytest fixture
    rather than a @given step, since no scenario says "Given a gateway
    client" in the feature file itself."""
    fake = FakeGateway()
    http_client = httpx.Client(transport=httpx.MockTransport(fake.handler))
    return GatewayClient(base_url="http://fake-gateway", api_key=API_KEY, client=http_client)


@given(
    parsers.parse('a user payload with name "{name}" and email "{email}"'),
    target_fixture="payload",
)
def _given_user_payload(name: str, email: str) -> UserPayload:
    return UserPayload(name=name, email=email)


@when("the user is created", target_fixture="created")
def _when_created(payload: UserPayload, gateway_client: GatewayClient) -> UserResult:
    return gateway_client.create_user(payload)


@when("the user is fetched by id", target_fixture="fetched")
def _when_fetched(created: UserResult, gateway_client: GatewayClient) -> UserResult | None:
    return gateway_client.get_user(created.id)


@when(parsers.parse('the user\'s name is updated to "{name}"'), target_fixture="updated")
def _when_updated(
    created: UserResult, gateway_client: GatewayClient, name: str
) -> UserResult | None:
    return gateway_client.update_user(created.id, name=name)


@when("the user is deleted", target_fixture="delete_result")
def _when_deleted(created: UserResult, gateway_client: GatewayClient) -> bool:
    return gateway_client.delete_user(created.id)


@then("the created user has an id")
def _then_has_id(created: UserResult) -> None:
    assert created.id is not None


@then(parsers.parse('the created user\'s name is "{expected}"'))
def _then_created_name_is(created: UserResult, expected: str) -> None:
    assert created.name == expected


@then("the fetched user matches the created user")
def _then_fetched_matches_created(fetched: UserResult | None, created: UserResult) -> None:
    assert fetched == created


@then(parsers.parse('the updated user\'s name is "{expected}"'))
def _then_updated_name_is(updated: UserResult | None, expected: str) -> None:
    assert updated is not None
    assert updated.name == expected


@then(parsers.parse('the updated user\'s email is "{expected}"'))
def _then_updated_email_is(updated: UserResult | None, expected: str) -> None:
    assert updated is not None
    assert updated.email == expected


@then("the delete reports success")
def _then_delete_succeeded(delete_result: bool) -> None:
    assert delete_result is True


@then("fetching the user by id returns nothing")
def _then_get_returns_nothing(created: UserResult, gateway_client: GatewayClient) -> None:
    assert gateway_client.get_user(created.id) is None
