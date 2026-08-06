from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx

from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader

if TYPE_CHECKING:
    from collections.abc import Callable

API_KEY = "test-key"


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_load_posts_to_the_right_path_with_the_api_key_header_and_an_empty_body() -> None:
    # Given a fake gateway that records what it received
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["api_key"] = request.headers.get("x-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, content=b"7")

    loader = GatewayArchiveLoader("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When loading (there's no data to pass — this is a trigger, not a payload)
    loader.load(None)

    # Then it hit the right event with the api key and an empty body
    assert seen["path"] == "/events/archive-vehicle-position-history"
    assert seen["api_key"] == API_KEY
    assert seen["body"] == {}


def test_load_raises_on_a_server_error() -> None:
    # Given a gateway that fails
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"boom")

    loader = GatewayArchiveLoader("https://gateway.example", API_KEY, _fake_gateway(handler))

    # When loading
    # Then the error propagates rather than being swallowed
    try:
        loader.load(None)
    except httpx.HTTPStatusError as exc:
        assert exc.response.status_code == 500
    else:
        raise AssertionError("expected an HTTPStatusError")
