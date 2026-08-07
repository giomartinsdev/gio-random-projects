# httpx's TestClient.post()/.get()/.request()/.json() surfaces Unknown/Any
# through its own stubs regardless of caller code (see
# test_event_store_steps.py's identical note) — these steps assert
# against raw wire-level JSON responses, exactly the case where that's
# unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when
from sqlmodel import Session, select

from app.domain.vehicle_position.history_entity import VehiclePositionHistory

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

scenarios("../features/vehicle_position_history_events.feature")


def _position(vehicle_id: str, minute: int) -> dict[str, Any]:
    return {
        "mode": "sppo",
        "line_code": "606",
        "vehicle_id": vehicle_id,
        "latitude": -22.9,
        "longitude": -43.2,
        "speed_kmh": float(minute),
        "captured_at": f"2026-08-06T00:{minute:02d}:00Z",
        "color_hex": None,
    }


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(
    parsers.re(r'vehicle "(?P<vehicle_id>\w+)" was polled (?P<times>\d+) times?'),
    converters={"times": int},
)
def _given_vehicle_polled(client: TestClient, vehicle_id: str, times: int) -> None:
    for minute in range(times):
        response = client.post(
            "/events/record-vehicle-positions",
            json={"positions": [_position(vehicle_id, minute)]},
        )
        assert response.status_code == 200


@when("the vehicle position history is listed", target_fixture="response")
def _when_history_listed(client: TestClient) -> Any:
    return client.get("/events/list-vehicle-position-history")


@when("the first 2 history ids are deleted as a batch", target_fixture="response")
def _when_first_two_deleted(client: TestClient, db_engine: Engine) -> Any:
    with Session(db_engine) as session:
        ids = [row.id for row in session.exec(select(VehiclePositionHistory)).all()]
    return client.request(
        "DELETE",
        "/events/delete-vehicle-position-history-batch",
        params={"ids": ids[:2]},
    )


@when("an empty batch of history ids is deleted", target_fixture="response")
def _when_empty_batch_deleted(client: TestClient) -> Any:
    return client.request("DELETE", "/events/delete-vehicle-position-history-batch", params={})


@when("a batch of nonexistent history ids is deleted", target_fixture="response")
def _when_nonexistent_batch_deleted(client: TestClient) -> Any:
    return client.request(
        "DELETE",
        "/events/delete-vehicle-position-history-batch",
        params={"ids": [999_999, 999_998]},
    )


@then(parsers.parse("{count:d} rows come back"))
def _then_rows_come_back(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert len(response.json()) == count


@then(parsers.parse("the response reports {count:d} rows deleted"))
def _then_rows_deleted(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert response.json() == count


@then(parsers.parse("exactly {count:d} history row remains"))
def _then_history_rows_remain(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        remaining = session.exec(select(VehiclePositionHistory)).all()
    assert len(remaining) == count
