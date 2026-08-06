"""Confirms ListVehiclePositionHistory/DeleteVehiclePositionHistoryBatch
do exactly what they say on the tin and nothing more — no pruning
policy is exercised here on purpose, since that decision now lives in
flows/vehicle_position_archiver (see history_events.py's module
docstring).
"""

# httpx's TestClient.get()/.post()/.request()/.json() surfaces
# Unknown/Any through its own stubs regardless of caller code (see
# test_event_store.py's identical note) — these tests assert against
# raw wire-level JSON responses, exactly the case where that's
# unavoidable rather than a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.domain.vehicle_position.history_entity import VehiclePositionHistory
from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.presentation.app import create_app

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator

    from sqlalchemy import Engine


@pytest.fixture()
def client_and_engine() -> Generator[tuple[TestClient, Engine]]:
    discover_domain()
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)

    def override_get_session() -> Iterator[Session]:
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    with TestClient(app) as test_client:
        yield test_client, engine


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


def test_list_vehicle_position_history_returns_every_row_unfiltered(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_and_engine

    # Given 12 polls of the same vehicle — well past any "keep 10" policy
    for minute in range(12):
        client.post(
            "/events/record-vehicle-positions", json={"positions": [_position("B1", minute)]}
        )

    # When listing history
    response = client.get("/events/list-vehicle-position-history")

    # Then all 12 rows come back — the domain applies no pruning of its own
    assert response.status_code == 200
    assert len(response.json()) == 12


def test_delete_vehicle_position_history_batch_deletes_exactly_the_given_ids(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine
    for minute in range(3):
        client.post(
            "/events/record-vehicle-positions", json={"positions": [_position("B1", minute)]}
        )
    with Session(engine) as session:
        ids = [row.id for row in session.exec(select(VehiclePositionHistory)).all()]
    to_delete = ids[:2]

    # When deleting a batch of two ids
    response = client.request(
        "DELETE", "/events/delete-vehicle-position-history-batch", params={"ids": to_delete}
    )

    # Then exactly those two rows are gone, the third remains
    assert response.status_code == 200
    assert response.json() == 2
    with Session(engine) as session:
        remaining = [row.id for row in session.exec(select(VehiclePositionHistory)).all()]
    assert remaining == [ids[2]]


def test_delete_vehicle_position_history_batch_is_a_no_op_for_an_empty_list(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, _engine = client_and_engine
    client.post("/events/record-vehicle-positions", json={"positions": [_position("B1", 0)]})

    # When deleting an empty batch
    response = client.request("DELETE", "/events/delete-vehicle-position-history-batch", params={})

    # Then nothing was deleted
    assert response.json() == 0
    assert len(client.get("/events/list-vehicle-position-history").json()) == 1
