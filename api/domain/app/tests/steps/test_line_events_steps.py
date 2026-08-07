# See test_stop_events_steps.py's identical note on httpx TestClient's
# own Unknown/Any stubs.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pytest_bdd import given, parsers, scenarios, then, when
from sqlmodel import Session, select

from app.domain.line.entity import Line

if TYPE_CHECKING:
    from fastapi.testclient import TestClient
    from sqlalchemy import Engine

scenarios("../features/line_events.feature")


def _line(line_id: str, mode: str = "bus") -> dict[str, Any]:
    return {"id": line_id, "code": line_id, "name": f"Linha {line_id}", "mode": mode}


@given("a domain API backed by a real Postgres database")
def _given_domain_api(client: TestClient) -> TestClient:
    return client


@given(parsers.parse('line "{line_id}" was already upserted with mode "{mode}"'))
def _given_line_upserted(client: TestClient, line_id: str, mode: str) -> None:
    response = client.post("/events/upsert-lines", json={"lines": [_line(line_id, mode)]})
    assert response.status_code == 200


@when(parsers.parse('lines "{l1}" and "{l2}" are upserted'), target_fixture="response")
def _when_two_lines_upserted(client: TestClient, l1: str, l2: str) -> Any:
    return client.post("/events/upsert-lines", json={"lines": [_line(l1), _line(l2)]})


@when(parsers.parse('line "{line_id}" is upserted again with mode "{mode}"'))
def _when_line_upserted_again(client: TestClient, line_id: str, mode: str) -> None:
    response = client.post("/events/upsert-lines", json={"lines": [_line(line_id, mode)]})
    assert response.status_code == 200


@when("an empty list of lines is upserted", target_fixture="response")
def _when_empty_lines_upserted(client: TestClient) -> Any:
    return client.post("/events/upsert-lines", json={"lines": []})


@when("every line is listed", target_fixture="response")
def _when_every_line_listed(client: TestClient) -> Any:
    return client.get("/events/list-lines")


@then(parsers.parse("the response reports {count:d} lines upserted"))
def _then_response_reports_count(response: Any, count: int) -> None:
    assert response.status_code == 200
    assert response.json() == count


@then(parsers.parse('the line table has rows for "{l1}" and "{l2}"'))
def _then_line_table_has_rows(db_engine: Engine, l1: str, l2: str) -> None:
    with Session(db_engine) as session:
        lines = session.exec(select(Line)).all()
    assert {line.id for line in lines} == {l1, l2}


@then(parsers.parse("the line table has exactly {count:d} row"))
@then(parsers.parse("the line table has exactly {count:d} rows"))
def _then_line_table_exact_count(db_engine: Engine, count: int) -> None:
    with Session(db_engine) as session:
        lines = session.exec(select(Line)).all()
    assert len(lines) == count


@then(parsers.parse('line "{line_id}"\'s mode is "{mode}"'))
def _then_line_mode(db_engine: Engine, line_id: str, mode: str) -> None:
    with Session(db_engine) as session:
        line = session.get(Line, line_id)
    assert line is not None
    assert line.mode == mode


@then(parsers.parse('the listed lines are "{l1}" and "{l2}"'))
def _then_listed_lines(response: Any, l1: str, l2: str) -> None:
    assert response.status_code == 200
    assert {row["id"] for row in response.json()} == {l1, l2}
