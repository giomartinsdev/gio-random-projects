# httpx's TestClient.post()/.get()/.json() surfaces Unknown/Any through
# its own stubs regardless of caller code (confirmed: a minimal
# reproduction hits the same "Unknown" on TestClient's own `auth`
# default sentinel) — these steps assert against raw wire-level JSON
# responses, exactly the case where that's unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when
from sqlmodel import Session, select

from app.infrastructure.event_store import DomainEventRecord

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

scenarios("../features/event_store.feature")


def _position(vehicle_id: str) -> dict[str, Any]:
    return {
        "mode": "sppo",
        "line_code": "606",
        "vehicle_id": vehicle_id,
        "latitude": -22.9,
        "longitude": -43.2,
        "speed_kmh": 20.0,
        "captured_at": "2026-08-06T00:00:00Z",
        "color_hex": None,
    }


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@when(parsers.parse('a RecordVehiclePositions event is dispatched for vehicle "{vehicle_id}"'))
def _when_record_vehicle_positions(client: TestClient, vehicle_id: str) -> None:
    response = client.post(
        "/events/record-vehicle-positions", json={"positions": [_position(vehicle_id)]}
    )
    assert response.status_code == 200


@when("the vehicle position history is listed")
def _when_history_listed(client: TestClient) -> None:
    response = client.get("/events/list-vehicle-position-history")
    assert response.status_code == 200


@when("an invalid record-vehicle-positions request is sent", target_fixture="response")
def _when_invalid_request(client: TestClient) -> Any:
    return client.post("/events/record-vehicle-positions", json={"positions": [{"mode": "sppo"}]})


@then(parsers.parse("the response status is {status:d}"))
def _then_response_status(response: Any, status: int) -> None:
    assert response.status_code == status


@then(parsers.parse("exactly {count:d} event store record exists"))
def _then_exact_record_count(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        records = session.exec(select(DomainEventRecord)).all()
    assert len(records) == count


@then("no event store record exists")
def _then_no_records(db_engine: Engine) -> None:
    with Session(db_engine) as session:
        records = session.exec(select(DomainEventRecord)).all()
    assert records == []


@then(parsers.parse('the record\'s event type is "{event_type}"'))
def _then_record_event_type(db_engine: Engine, event_type: str) -> None:
    with Session(db_engine) as session:
        record = session.exec(select(DomainEventRecord)).one()
    assert record.event_type == event_type


@then(parsers.parse('the record\'s entity type is "{entity_type}"'))
def _then_record_entity_type(db_engine: Engine, entity_type: str) -> None:
    with Session(db_engine) as session:
        record = session.exec(select(DomainEventRecord)).one()
    assert record.entity_type == entity_type


@then(parsers.parse('the record\'s result is "{result}"'))
def _then_record_result(db_engine: Engine, result: str) -> None:
    with Session(db_engine) as session:
        record = session.exec(select(DomainEventRecord)).one()
    assert record.result == result


@then("the event store records these event types in order:")
def _then_event_types_in_order(db_engine: Engine, datatable: list[list[str]]) -> None:
    expected = [row[0] for row in datatable]
    with Session(db_engine) as session:
        records = session.exec(select(DomainEventRecord)).all()
    assert [r.event_type for r in records] == expected
