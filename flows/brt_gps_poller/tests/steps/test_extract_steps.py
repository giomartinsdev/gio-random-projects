from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.brt_gps_poller.etl.extract import BrtExtractor

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/extract.feature")


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def rows() -> list[dict[str, object]] | None:
    return None


@pytest.fixture()
def response_body() -> bytes | None:
    return None


@given("a fake BRT endpoint", target_fixture="seen_urls")
def _given_fake_endpoint() -> list[str]:
    return []


@given(parsers.parse("the endpoint returns {count:d} raw vehicle rows"), target_fixture="rows")
def _given_returns_rows(count: int) -> list[dict[str, object]]:
    return [{"codigo": f"90100{i}", "linha": "35"} for i in range(count)]


@given("the endpoint returns an empty JSON object", target_fixture="response_body")
def _given_empty_object() -> bytes:
    return b"{}"


@given("the endpoint returns a JSON array instead of an object", target_fixture="response_body")
def _given_array_response() -> bytes:
    return b"[]"


@when("BRT positions are extracted", target_fixture="result")
def _when_extracted(
    seen_urls: list[str],
    rows: list[dict[str, object]] | None,
    response_body: bytes | None,
) -> list[dict[str, object]]:
    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        if response_body is not None:
            return httpx.Response(200, content=response_body)
        return httpx.Response(200, content=json.dumps({"veiculos": rows or []}).encode())

    extractor = BrtExtractor(client=_fake_client(handler))
    return extractor.extract()


@then(parsers.parse('the request hit "{url}" with no query string'))
def _then_request_hit(seen_urls: list[str], url: str) -> None:
    assert seen_urls == [url]


@then("both raw rows come back untouched")
def _then_rows_untouched(result: list[dict[str, object]], rows: list[dict[str, object]]) -> None:
    assert result == rows


@then("an empty list comes back")
def _then_empty_list(result: list[dict[str, object]]) -> None:
    assert result == []
