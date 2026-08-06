from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx

from flows.brt_gps_poller.etl.extract import BrtExtractor

if TYPE_CHECKING:
    from collections.abc import Callable


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_extract_requests_the_brt_endpoint_with_no_query_params() -> None:
    # Given a fake BRT endpoint that echoes back the request it saw
    seen_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_urls.append(str(request.url))
        return httpx.Response(200, content=b'{"veiculos": []}')

    extractor = BrtExtractor(client=_fake_client(handler))

    # When extracting
    extractor.extract()

    # Then the request hit dados.mobilidade.rio/gps/brt with no query string
    assert seen_urls == ["https://dados.mobilidade.rio/gps/brt"]


def test_extract_returns_the_veiculos_array() -> None:
    # Given a fake endpoint returning two raw rows inside the envelope
    rows = [{"codigo": "901008", "linha": "35"}, {"codigo": "901011", "linha": "22"}]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=json.dumps({"veiculos": rows}).encode())

    extractor = BrtExtractor(client=_fake_client(handler))

    # When extracting
    result = extractor.extract()

    # Then both rows come back untouched
    assert result == rows


def test_extract_returns_empty_list_when_envelope_has_no_veiculos_key() -> None:
    # Given a malformed/unexpected upstream response
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"{}")

    extractor = BrtExtractor(client=_fake_client(handler))

    # When extracting
    result = extractor.extract()

    # Then it degrades to an empty list rather than raising
    assert result == []


def test_extract_returns_empty_list_when_response_is_not_an_object() -> None:
    # Given a response that isn't even a JSON object
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"[]")

    extractor = BrtExtractor(client=_fake_client(handler))

    # When extracting
    result = extractor.extract()

    # Then it degrades to an empty list rather than raising
    assert result == []
