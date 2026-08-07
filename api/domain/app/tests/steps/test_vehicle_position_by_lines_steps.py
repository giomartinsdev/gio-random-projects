# See test_stop_events_steps.py's identical note on httpx TestClient's
# own Unknown/Any stubs.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

scenarios("../features/vehicle_position_by_lines.feature")


def _position(vehicle_id: str, line_code: str, captured_at: str) -> dict[str, Any]:
    return {
        "mode": "sppo",
        "line_code": line_code,
        "vehicle_id": vehicle_id,
        "latitude": -22.9,
        "longitude": -43.2,
        "speed_kmh": 10.0,
        "captured_at": captured_at,
        "color_hex": None,
    }


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(
    parsers.parse('vehicle "{vehicle_id}" on line "{line_code}" was recorded at "{captured_at}"')
)
def _given_vehicle_recorded(
    client: TestClient, vehicle_id: str, line_code: str, captured_at: str
) -> None:
    response = client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position(vehicle_id, line_code, captured_at)]},
    )
    assert response.status_code == 200


@when(parsers.parse('positions are listed for line "{line_code}"'), target_fixture="response")
def _when_listed_one_line(client: TestClient, line_code: str) -> Any:
    return client.get("/events/list-vehicle-positions-by-lines", params={"line_codes": [line_code]})


@when(parsers.parse('positions are listed for lines "{l1}" and "{l2}"'), target_fixture="response")
def _when_listed_two_lines(client: TestClient, l1: str, l2: str) -> Any:
    return client.get("/events/list-vehicle-positions-by-lines", params={"line_codes": [l1, l2]})


@when("positions are listed for no lines", target_fixture="response")
def _when_listed_no_lines(client: TestClient) -> Any:
    return client.get("/events/list-vehicle-positions-by-lines", params={"line_codes": []})


@then(parsers.parse('the listed vehicle ids are "{v1}"'))
def _then_one_vehicle_id(response: Any, v1: str) -> None:
    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {v1}


@then(parsers.parse('the listed vehicle ids are "{v1}" and "{v2}"'))
def _then_two_vehicle_ids(response: Any, v1: str, v2: str) -> None:
    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {v1, v2}


@then(parsers.parse("{count:d} positions come back"))
def _then_position_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert len(response.json()) == count
