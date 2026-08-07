from __future__ import annotations

from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from app.domain_client import DomainClient

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/domain_client.feature")


def _fake_client(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def requests_seen() -> list[httpx.Request]:
    return []


@pytest.fixture()
def response_body() -> list[dict[str, Any]]:
    return []


@pytest.fixture()
def domain_client(
    requests_seen: list[httpx.Request], response_body: list[dict[str, Any]]
) -> DomainClient:
    def handler(request: httpx.Request) -> httpx.Response:
        requests_seen.append(request)
        return httpx.Response(200, json=response_body)

    return DomainClient("http://fake-gateway", "test-key", client=_fake_client(handler))


@given("a fake gateway")
def _given_fake_gateway() -> None:
    pass


@given(parsers.parse("the gateway returns {count:d} stops"))
def _given_returns_stops(response_body: list[dict[str, Any]], count: int) -> None:
    response_body.extend(
        {"id": f"S{i}", "name": f"Stop {i}", "latitude": -22.9, "longitude": -43.2}
        for i in range(count)
    )


@given(parsers.parse("the gateway returns {count:d} line"))
def _given_returns_lines(response_body: list[dict[str, Any]], count: int) -> None:
    response_body.extend(
        {"id": f"L{i}", "code": f"L{i}", "name": f"Line {i}", "mode": "bus"} for i in range(count)
    )


@given(parsers.parse("the gateway returns {count:d} route-stops"))
def _given_returns_route_stops(response_body: list[dict[str, Any]], count: int) -> None:
    response_body.extend(
        {"line_id": "L0", "stop_id": f"S{i}", "direction_id": 0, "sequence": i}
        for i in range(count)
    )


@given(parsers.parse("the gateway returns {count:d} vehicle position"))
def _given_returns_positions(response_body: list[dict[str, Any]], count: int) -> None:
    response_body.extend(
        {
            "id": f"B{i}",
            "data": {
                "mode": "sppo",
                "line_code": "178",
                "vehicle_id": f"B{i}",
                "latitude": -22.9,
                "longitude": -43.2,
                "speed_kmh": 20.0,
                "captured_at": "2026-08-06T13:00:00Z",
                "color_hex": None,
            },
            "captured_at": "2026-08-06T13:00:00Z",
        }
        for i in range(count)
    )


@when("stops are listed", target_fixture="result")
def _when_stops_listed(domain_client: DomainClient) -> Any:
    return domain_client.list_stops()


@when("lines are listed", target_fixture="result")
def _when_lines_listed(domain_client: DomainClient) -> Any:
    return domain_client.list_lines()


@when("route-stops are listed", target_fixture="result")
def _when_route_stops_listed(domain_client: DomainClient) -> Any:
    return domain_client.list_route_stops()


@when(parsers.parse('positions are listed for lines "{l1}" and "{l2}"'), target_fixture="result")
def _when_positions_listed_two(domain_client: DomainClient, l1: str, l2: str) -> Any:
    return domain_client.list_vehicle_positions_by_lines([l1, l2])


@when("positions are listed for no lines", target_fixture="result")
def _when_positions_listed_none(domain_client: DomainClient) -> Any:
    return domain_client.list_vehicle_positions_by_lines([])


@then(parsers.parse('the request hit "{event_path}"'))
def _then_request_hit(requests_seen: list[httpx.Request], event_path: str) -> None:
    assert len(requests_seen) == 1
    assert str(requests_seen[0].url).startswith(f"http://fake-gateway/events/{event_path}")


@then("no request was made")
def _then_no_request(requests_seen: list[httpx.Request]) -> None:
    assert requests_seen == []


@then(parsers.parse("{count:d} stop records come back"))
@then(parsers.parse("{count:d} stop record comes back"))
def _then_stop_count(result: Any, count: int) -> None:
    assert len(result) == count


@then(parsers.parse("{count:d} line records come back"))
@then(parsers.parse("{count:d} line record comes back"))
def _then_line_count(result: Any, count: int) -> None:
    assert len(result) == count


@then(parsers.parse("{count:d} route-stop records come back"))
@then(parsers.parse("{count:d} route-stop record comes back"))
def _then_route_stop_count(result: Any, count: int) -> None:
    assert len(result) == count


@then(parsers.parse("{count:d} position records come back"))
@then(parsers.parse("{count:d} position record comes back"))
def _then_position_count(result: Any, count: int) -> None:
    assert len(result) == count


@then(parsers.parse('the request\'s line_codes query param is "{l1}" and "{l2}"'))
def _then_line_codes_param(requests_seen: list[httpx.Request], l1: str, l2: str) -> None:
    query = httpx.QueryParams(requests_seen[0].url.query.decode())
    assert query.get_list("line_codes") == [l1, l2]


@then(parsers.parse('the request\'s X-API-Key header is "{expected}"'))
def _then_api_key_header(requests_seen: list[httpx.Request], expected: str) -> None:
    assert requests_seen[0].headers["x-api-key"] == expected
