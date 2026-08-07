# httpx's TestClient.post()/.json() surfaces Unknown/Any through its own
# stubs regardless of caller code (see test_event_store_steps.py's
# identical note) — these steps assert against raw wire-level JSON
# responses, exactly the case where that's unavoidable.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when
from sqlmodel import Session, select

from app.domain.stop.entity import Stop

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

scenarios("../features/stop_events.feature")


def _stop(stop_id: str, name: str = "Rua A") -> dict[str, Any]:
    return {"id": stop_id, "name": name, "latitude": -22.9, "longitude": -43.2}


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(parsers.parse('stop "{stop_id}" was already upserted with name "{name}"'))
def _given_stop_upserted(client: TestClient, stop_id: str, name: str) -> None:
    response = client.post("/events/upsert-stops", json={"stops": [_stop(stop_id, name)]})
    assert response.status_code == 200


@when(parsers.parse('stops "{s1}" and "{s2}" are upserted'), target_fixture="response")
def _when_two_stops_upserted(client: TestClient, s1: str, s2: str) -> Any:
    return client.post("/events/upsert-stops", json={"stops": [_stop(s1), _stop(s2)]})


@when(parsers.parse('stop "{stop_id}" is upserted again with name "{name}"'))
def _when_stop_upserted_again(client: TestClient, stop_id: str, name: str) -> None:
    response = client.post("/events/upsert-stops", json={"stops": [_stop(stop_id, name)]})
    assert response.status_code == 200


@when("an empty list of stops is upserted", target_fixture="response")
def _when_empty_stops_upserted(client: TestClient) -> Any:
    return client.post("/events/upsert-stops", json={"stops": []})


@when("every stop is listed", target_fixture="response")
def _when_every_stop_listed(client: TestClient) -> Any:
    return client.get("/events/list-stops")


@then(parsers.parse("the response reports {count:d} stops upserted"))
def _then_response_reports_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert response.json() == count


@then(parsers.parse('the stop table has rows for "{s1}" and "{s2}"'))
def _then_stop_table_has_rows(db_engine: Engine, s1: str, s2: str) -> None:
    with Session(db_engine) as session:
        stops = session.exec(select(Stop)).all()
    assert {s.id for s in stops} == {s1, s2}


@then(parsers.parse("the stop table has exactly {count:d} row"))
@then(parsers.parse("the stop table has exactly {count:d} rows"))
def _then_stop_table_exact_count(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        stops = session.exec(select(Stop)).all()
    assert len(stops) == count


@then(parsers.parse('stop "{stop_id}"\'s name is "{name}"'))
def _then_stop_name(db_engine: Engine, stop_id: str, name: str) -> None:
    with Session(db_engine) as session:
        stop = session.get(Stop, stop_id)
    assert stop is not None
    assert stop.name == name


@then(parsers.parse('the listed stops are "{s1}" and "{s2}"'))
def _then_listed_stops(response: Any, s1: str, s2: str) -> None:
    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {s1, s2}
