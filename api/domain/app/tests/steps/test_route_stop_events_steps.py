# See test_stop_events_steps.py's identical note on httpx TestClient's
# own Unknown/Any stubs.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

scenarios("../features/route_stop_events.feature")


def _replace(client: TestClient, line_id: str, stop_ids: list[str]) -> Any:
    return client.post(
        "/events/replace-route-stops",
        json={
            "line_ids": [line_id],
            "stops": [
                {"line_id": line_id, "stop_id": stop_id, "direction_id": 0, "sequence": i}
                for i, stop_id in enumerate(stop_ids)
            ],
        },
    )


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(parsers.parse('stops "{s1}", "{s2}", and "{s3}" exist'))
def _given_stops_exist(client: TestClient, s1: str, s2: str, s3: str) -> None:
    stops = [
        {"id": stop_id, "name": stop_id, "latitude": -22.9, "longitude": -43.2}
        for stop_id in (s1, s2, s3)
    ]
    response = client.post("/events/upsert-stops", json={"stops": stops})
    assert response.status_code == 200


@given(parsers.parse('lines "{l1}" and "{l2}" exist'))
def _given_lines_exist(client: TestClient, l1: str, l2: str) -> None:
    lines = [
        {"id": line_id, "code": line_id, "name": f"Linha {line_id}", "mode": "bus"}
        for line_id in (l1, l2)
    ]
    response = client.post("/events/upsert-lines", json={"lines": lines})
    assert response.status_code == 200


@given(parsers.parse('line "{line_id}"\'s stops were already replaced with "{s1}" then "{s2}"'))
def _given_stops_replaced_two(client: TestClient, line_id: str, s1: str, s2: str) -> None:
    response = _replace(client, line_id, [s1, s2])
    assert response.status_code == 200


@when(
    parsers.parse('line "{line_id}"\'s stops are replaced with "{s1}" then "{s2}"'),
    target_fixture="response",
)
def _when_stops_replaced_two(client: TestClient, line_id: str, s1: str, s2: str) -> Any:
    return _replace(client, line_id, [s1, s2])


@when(
    parsers.parse('line "{line_id}"\'s stops are replaced with "{s1}"'), target_fixture="response"
)
def _when_stops_replaced_one(client: TestClient, line_id: str, s1: str) -> Any:
    return _replace(client, line_id, [s1])


@when(
    parsers.parse('line "{line_id}"\'s stops are replaced with nothing'), target_fixture="response"
)
def _when_stops_replaced_empty(client: TestClient, line_id: str) -> Any:
    return _replace(client, line_id, [])


@when("every route-stop is listed", target_fixture="response")
def _when_every_route_stop_listed(client: TestClient) -> Any:
    return client.get("/events/list-route-stops")


@then(parsers.parse("the response reports {count:d} route-stops replaced"))
def _then_response_reports_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert response.json() == count


@then(parsers.parse('line "{line_id}"\'s stop sequence is "{s1}" then "{s2}"'))
def _then_sequence_two(client: TestClient, line_id: str, s1: str, s2: str) -> None:
    response = client.get("/events/list-route-stops-by-line", params={"line_ids": [line_id]})
    assert response.status_code == 200
    stop_ids = [row["stop_id"] for row in response.json()]
    assert stop_ids == [s1, s2]


@then(parsers.parse('line "{line_id}"\'s stop sequence is "{s1}"'))
def _then_sequence_one(client: TestClient, line_id: str, s1: str) -> None:
    response = client.get("/events/list-route-stops-by-line", params={"line_ids": [line_id]})
    assert response.status_code == 200
    stop_ids = [row["stop_id"] for row in response.json()]
    assert stop_ids == [s1]


@then(parsers.parse('line "{line_id}"\'s stop sequence is empty'))
def _then_sequence_empty(client: TestClient, line_id: str) -> None:
    response = client.get("/events/list-route-stops-by-line", params={"line_ids": [line_id]})
    assert response.status_code == 200
    assert response.json() == []


@then(parsers.parse("{count:d} route-stop rows come back"))
def _then_route_stop_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert len(response.json()) == count
