# httpx's TestClient.post()/.json() surfaces Unknown/Any through its own
# stubs regardless of caller code (see test_event_store_steps.py's
# identical note) — these steps assert against raw wire-level JSON
# responses, exactly the case where that's unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when
from sqlmodel import Session, select

from app.domain.vehicle.entity import Vehicle
from app.domain.vehicle_position.entity import VehiclePosition
from app.domain.vehicle_position.history_entity import VehiclePositionHistory

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

scenarios("../features/vehicle_position_events.feature")


def _position(vehicle_id: str, captured_at: str, latitude: float = -22.9) -> dict[str, Any]:
    return {
        "mode": "sppo",
        "line_code": "606",
        "vehicle_id": vehicle_id,
        "latitude": latitude,
        "longitude": -43.2,
        "speed_kmh": 10.0,
        "captured_at": captured_at,
        "color_hex": None,
    }


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(
    parsers.parse(
        'vehicle "{vehicle_id}" was already recorded at "{captured_at}" with latitude {latitude:g}'
    )
)
def _given_vehicle_recorded(
    client: TestClient, vehicle_id: str, captured_at: str, latitude: float
) -> None:
    response = client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position(vehicle_id, captured_at, latitude)]},
    )
    assert response.status_code == 200


@when(
    parsers.parse('positions are recorded for vehicles "{v1}" and "{v2}" at "{captured_at}"'),
    target_fixture="response",
)
def _when_two_vehicles_recorded(client: TestClient, v1: str, v2: str, captured_at: str) -> Any:
    return client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position(v1, captured_at), _position(v2, captured_at)]},
    )


@when(
    parsers.parse(
        'vehicle "{vehicle_id}" is recorded again at "{captured_at}" with latitude {latitude:g}'
    )
)
def _when_vehicle_recorded_again(
    client: TestClient, vehicle_id: str, captured_at: str, latitude: float
) -> None:
    response = client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position(vehicle_id, captured_at, latitude)]},
    )
    assert response.status_code == 200


@when(parsers.parse('vehicle "{vehicle_id}" is recorded {times:d} times at increasing latitudes'))
def _when_vehicle_recorded_repeatedly(client: TestClient, vehicle_id: str, times: int) -> None:
    for i in range(times):
        response = client.post(
            "/events/record-vehicle-positions",
            json={
                "positions": [_position(vehicle_id, f"2026-08-05T13:0{i}:00Z", latitude=-22.0 - i)]
            },
        )
        assert response.status_code == 200


@when("an empty list of positions is recorded", target_fixture="response")
def _when_empty_positions_recorded(client: TestClient) -> Any:
    return client.post("/events/record-vehicle-positions", json={"positions": []})


@when(parsers.parse('a position missing "{field}" is recorded'), target_fixture="response")
def _when_position_missing_field(client: TestClient, field: str) -> Any:
    position = _position("B1", "2026-08-05T13:00:00Z")
    del position[field]
    return client.post("/events/record-vehicle-positions", json={"positions": [position]})


@then(parsers.parse("the response reports {count:d} positions recorded"))
def _then_response_reports_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert response.json() == count


@then(parsers.parse("the response status is {status:d}"))
def _then_response_status(response: Any, status: int) -> None:
    assert response.status_code == status


@then(parsers.parse('the vehicle table has rows for "{v1}" and "{v2}"'))
def _then_vehicle_table_has_rows(db_engine: Engine, v1: str, v2: str) -> None:
    with Session(db_engine) as session:
        vehicles = session.exec(select(Vehicle)).all()
    assert {v.id for v in vehicles} == {v1, v2}


@then(parsers.parse('the vehicle position table has rows for "{v1}" and "{v2}"'))
def _then_position_table_has_rows(db_engine: Engine, v1: str, v2: str) -> None:
    with Session(db_engine) as session:
        positions = session.exec(select(VehiclePosition)).all()
    assert {p.id for p in positions} == {v1, v2}


@then(parsers.parse("the vehicle table has exactly {count:d} row"))
@then(parsers.parse("the vehicle table has exactly {count:d} rows"))
def _then_vehicle_table_exact_count(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        vehicles = session.exec(select(Vehicle)).all()
    assert len(vehicles) == count


@then(parsers.parse("the vehicle position table has exactly {count:d} row"))
@then(parsers.parse("the vehicle position table still has exactly {count:d} row"))
def _then_position_table_exact_count(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        positions = session.exec(select(VehiclePosition)).all()
    assert len(positions) == count


@then(parsers.parse('vehicle "{vehicle_id}"\'s position latitude is {latitude:g}'))
def _then_position_latitude(db_engine: Engine, vehicle_id: str, latitude: float) -> None:
    with Session(db_engine) as session:
        position = session.get(VehiclePosition, vehicle_id)
    assert position is not None
    assert position.data["latitude"] == latitude


@then(parsers.parse('vehicle "{vehicle_id}"\'s position was captured at "{captured_at}"'))
def _then_position_captured_at(db_engine: Engine, vehicle_id: str, captured_at: str) -> None:
    with Session(db_engine) as session:
        position = session.get(VehiclePosition, vehicle_id)
    assert position is not None
    assert str(position.captured_at).startswith(captured_at)


@then(parsers.parse('vehicle "{vehicle_id}"\'s first_seen_at is unchanged'))
def _then_first_seen_at_unchanged(db_engine: Engine, vehicle_id: str) -> None:
    with Session(db_engine) as session:
        vehicle = session.get(Vehicle, vehicle_id)
    assert vehicle is not None
    assert vehicle.first_seen_at is not None


@then(parsers.parse('vehicle "{vehicle_id}"\'s last_seen_at moved forward'))
def _then_last_seen_at_moved_forward(db_engine: Engine, vehicle_id: str) -> None:
    with Session(db_engine) as session:
        vehicle = session.get(Vehicle, vehicle_id)
    assert vehicle is not None
    assert vehicle.last_seen_at > vehicle.first_seen_at


@then(parsers.parse('the vehicle position history table has {count:d} rows for "{vehicle_id}"'))
def _then_history_row_count(db_engine: Engine, count: int, vehicle_id: str) -> None:
    with Session(db_engine) as session:
        history = session.exec(select(VehiclePositionHistory)).all()
    matching = [row for row in history if row.vehicle_id == vehicle_id]
    assert len(matching) == count
