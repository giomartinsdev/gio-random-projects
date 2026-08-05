"""GatewayClient tested against a fake in-process gateway (an
httpx.MockTransport handler, not a real server) — same "fake upstream,
not a real second server" philosophy as api/gateway/app/tests/test_proxy.py.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from flows.user_crud_test.client import GatewayClient
from flows.user_crud_test.schemas import UserPayload

API_KEY = "test-key"


class _FakeGateway:
    """In-memory User store mimicking api/domain's event routes closely
    enough to exercise GatewayClient's own request/response handling."""

    def __init__(self) -> None:
        self.users: dict[int, dict[str, Any]] = {}
        self._next_id = 1

    def handler(self, request: httpx.Request) -> httpx.Response:
        assert request.headers.get("x-api-key") == API_KEY
        body: dict[str, Any] = json.loads(request.content)
        path = request.url.path

        # httpx.Response's `json=` convenience param silently produces an
        # EMPTY body for a None value instead of the literal `null` a real
        # JSON API would send — confirmed by testing: response.json() then
        # fails to decode. Always encoding explicitly avoids that trap.
        def _json_response(value: object) -> httpx.Response:
            return httpx.Response(200, content=json.dumps(value).encode())

        if path == "/events/create-user":
            user = {"id": self._next_id, "name": body["name"], "email": body["email"]}
            self.users[self._next_id] = user
            self._next_id += 1
            return _json_response(user)

        if path == "/events/get-user":
            return _json_response(self.users.get(body["id"]))

        if path == "/events/update-user":
            existing_user = self.users.get(body["id"])
            if existing_user is None:
                return _json_response(None)
            existing_user.update({k: v for k, v in body.items() if k != "id"})
            return _json_response(existing_user)

        if path == "/events/delete-user":
            existed = body["id"] in self.users
            self.users.pop(body["id"], None)
            return _json_response(existed)

        return httpx.Response(404)


@pytest.fixture()
def gateway_client() -> GatewayClient:
    fake = _FakeGateway()
    http_client = httpx.Client(transport=httpx.MockTransport(fake.handler))
    return GatewayClient(base_url="http://fake-gateway", api_key=API_KEY, client=http_client)


def test_create_user_returns_the_created_row(gateway_client: GatewayClient) -> None:
    # Given a valid payload
    payload = UserPayload(name="gio", email="gio@example.com")

    # When creating the user
    result = gateway_client.create_user(payload)

    # Then it comes back with an assigned id and the given fields
    assert result.id is not None
    assert result.name == "gio"
    assert result.email == "gio@example.com"


def test_get_user_returns_the_created_row(gateway_client: GatewayClient) -> None:
    # Given a created user
    created = gateway_client.create_user(UserPayload(name="gio", email="gio@example.com"))

    # When fetching it by id
    result = gateway_client.get_user(created.id)

    # Then it matches what was created
    assert result == created


def test_get_user_returns_none_for_a_missing_id(gateway_client: GatewayClient) -> None:
    # Given no user with id 999 exists
    # When fetching it
    result = gateway_client.get_user(999)

    # Then it returns None, not an error
    assert result is None


def test_update_user_applies_only_the_fields_provided(gateway_client: GatewayClient) -> None:
    # Given a created user
    created = gateway_client.create_user(UserPayload(name="gio", email="gio@example.com"))

    # When updating only the name
    result = gateway_client.update_user(created.id, name="gio martins")

    # Then the name changed but the email did not
    assert result is not None
    assert result.name == "gio martins"
    assert result.email == "gio@example.com"


def test_delete_user_removes_the_row_and_get_confirms_it(gateway_client: GatewayClient) -> None:
    # Given a created user
    created = gateway_client.create_user(UserPayload(name="gio", email="gio@example.com"))

    # When deleting it
    deleted = gateway_client.delete_user(created.id)

    # Then delete reports success and a subsequent get returns nothing
    assert deleted is True
    assert gateway_client.get_user(created.id) is None


def test_delete_user_returns_false_for_a_missing_id(gateway_client: GatewayClient) -> None:
    # Given no user with id 999 exists
    # When deleting it
    result = gateway_client.delete_user(999)

    # Then it reports nothing was deleted
    assert result is False
