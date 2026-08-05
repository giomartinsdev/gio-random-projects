from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx

from flows.bus_gps_poller.etl.extract import SppoExtractor

if TYPE_CHECKING:
    from collections.abc import Callable


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_extract_requests_the_sppo_endpoint_with_a_hand_built_date_window() -> None:
    # Given a fake SPPO endpoint that echoes back the request URL it saw
    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, content=b"[]")

    extractor = SppoExtractor(window_seconds=300, client=_fake_client(handler))

    # When extracting
    extractor.extract()

    # Then the request hit dados.mobilidade.rio/gps/sppo with hand-built
    # dataInicial/dataFinal params, "+" as the date/time separator (not
    # URL-encoded), five minutes apart
    assert len(seen_urls) == 1
    url = seen_urls[0]
    assert url.startswith("https://dados.mobilidade.rio/gps/sppo?&dataInicial=")
    assert "&dataFinal=" in url
    assert "+" in url  # not url-encoded as %2B or a literal space


def test_extract_returns_the_parsed_json_rows() -> None:
    # Given a fake endpoint returning two raw rows
    rows = [{"ordem": "B1", "linha": "606"}, {"ordem": "B2", "linha": "22"}]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps(rows).encode())

    extractor = SppoExtractor(window_seconds=300, client=_fake_client(handler))

    # When extracting
    result = extractor.extract()

    # Then both rows come back untouched
    assert result == rows


def test_extract_returns_empty_list_when_response_is_not_a_list() -> None:
    # Given a malformed/empty upstream response (an object instead of an array)
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"{}")

    extractor = SppoExtractor(window_seconds=300, client=_fake_client(handler))

    # When extracting
    result = extractor.extract()

    # Then it degrades to an empty list rather than raising
    assert result == []
