from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.bus_gps_poller.etl.extract import SppoExtractor

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


@given("a fake SPPO endpoint", target_fixture="seen_urls")
def _given_fake_endpoint() -> list[str]:
    return []


@given(parsers.parse("the endpoint returns {count:d} raw vehicle rows"), target_fixture="rows")
def _given_returns_rows(count: int) -> list[dict[str, object]]:
    return [{"ordem": f"B{i}", "linha": "606"} for i in range(count)]


@given("the endpoint returns an empty JSON object", target_fixture="response_body")
def _given_empty_object() -> bytes:
    return b"{}"


@when(
    parsers.parse("SPPO positions are extracted with a {window:d} second window"),
    target_fixture="result",
)
def _when_extracted(
    seen_urls: list[str],
    rows: list[dict[str, object]] | None,
    response_body: bytes | None,
    window: int,
) -> list[dict[str, object]]:
    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        if response_body is not None:
            return httpx.Response(200, content=response_body)
        return httpx.Response(200, content=json.dumps(rows or []).encode())

    extractor = SppoExtractor(window_seconds=window, client=_fake_client(handler))
    return extractor.extract()


@then(parsers.parse("exactly {count:d} request was made"))
def _then_request_count(seen_urls: list[str], count: int) -> None:
    assert len(seen_urls) == count


@then('the request URL has a dataInicial and dataFinal window with unencoded "+" separators')
def _then_url_has_window(seen_urls: list[str]) -> None:
    url = seen_urls[0]
    assert url.startswith("https://dados.mobilidade.rio/gps/sppo?&dataInicial=")
    assert "&dataFinal=" in url
    assert "+" in url


@then("both raw rows come back untouched")
def _then_rows_untouched(result: list[dict[str, object]], rows: list[dict[str, object]]) -> None:
    assert result == rows


@then("an empty list comes back")
def _then_empty_list(result: list[dict[str, object]]) -> None:
    assert result == []
