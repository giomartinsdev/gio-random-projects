from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from app.geocoding import NominatimGeocoder

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/geocoding.feature")


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(
        transport=httpx.MockTransport(handler), headers={"User-Agent": "test-agent"}
    )


@pytest.fixture()
def requests_seen() -> list[httpx.Request]:
    return []


@pytest.fixture()
def response_body() -> list[dict[str, Any]]:
    return []


@pytest.fixture()
def geocoder(
    requests_seen: list[httpx.Request], response_body: list[dict[str, Any]]
) -> NominatimGeocoder:
    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return httpx.Response(200, json=response_body)

    return NominatimGeocoder(client=_fake_client(handler))


@given("a fake Nominatim endpoint")
def _given_fake_endpoint() -> None:
    pass


@given(parsers.parse("Nominatim returns {count:d} results"))
def _given_returns_results(response_body: list[dict[str, Any]], count: int) -> None:
    response_body.extend(
        {"display_name": f"Place {i}, Rio de Janeiro", "lat": "-22.9", "lon": "-43.2"}
        for i in range(count)
    )


@when(parsers.parse('"{query}" is searched with limit {limit:d}'), target_fixture="result")
def _when_searched(geocoder: NominatimGeocoder, query: str, limit: int) -> Any:
    return geocoder.search(query, limit)


@then(parsers.parse("{count:d} geocode results come back"))
def _then_result_count(result: Any, count: int) -> None:
    assert len(result) == count


@then("the request's viewbox is bounded to Rio de Janeiro")
def _then_viewbox_bounded(requests_seen: list[httpx.Request]) -> None:
    query = httpx.QueryParams(requests_seen[0].url.query.decode())
    assert query.get("bounded") == "1"
    assert query.get("viewbox")


@then("the request has a non-empty User-Agent header")
def _then_user_agent_present(requests_seen: list[httpx.Request]) -> None:
    assert requests_seen[0].headers.get("user-agent")
