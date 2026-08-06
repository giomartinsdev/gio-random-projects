"""Confirms the upsert-by-natural-key pattern actually bounds table
size: dispatching the same vehicle_id twice updates one row in place
(both vehicle and vehicle_position), it never grows a second row —
the entire point of RecordVehiclePositions over an append-only insert.
"""

# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.domain.vehicle.entity import Vehicle
from app.domain.vehicle_position.entity import VehiclePosition
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


def test_record_positions_creates_one_row_per_vehicle_in_each_table(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given two distinct vehicles
    payload = {
        "positions": [
            _position("B1", "2026-08-05T13:00:00Z"),
            _position("B2", "2026-08-05T13:00:00Z"),
        ]
    }

    # When dispatched
    response = client.post("/events/record-vehicle-positions", json=payload)

    # Then it reports the count and both tables have exactly one row per vehicle
    assert response.status_code == 200
    assert response.json() == 2
    with Session(engine) as session:
        vehicles = session.exec(select(Vehicle)).all()
        positions = session.exec(select(VehiclePosition)).all()
    assert {v.id for v in vehicles} == {"B1", "B2"}
    assert {p.id for p in positions} == {"B1", "B2"}


def test_polling_the_same_vehicle_again_overwrites_its_row_instead_of_adding_one(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given one vehicle's position already recorded
    client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position("B1", "2026-08-05T13:00:00Z", latitude=-22.9)]},
    )

    # When the same vehicle is polled again later, at a different position
    client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position("B1", "2026-08-05T13:05:00Z", latitude=-23.1)]},
    )

    # Then there is still exactly one row for it, updated in place
    with Session(engine) as session:
        vehicles = session.exec(select(Vehicle)).all()
        positions = session.exec(select(VehiclePosition)).all()
    assert len(vehicles) == 1
    assert len(positions) == 1
    assert positions[0].data["latitude"] == -23.1
    assert str(positions[0].captured_at).startswith("2026-08-05 13:05:00")


def test_polling_the_same_vehicle_again_keeps_its_original_first_seen_at(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given one vehicle's position already recorded
    client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position("B1", "2026-08-05T13:00:00Z")]},
    )
    with Session(engine) as session:
        vehicle = session.get(Vehicle, "B1")
        assert vehicle is not None
        first_seen = vehicle.first_seen_at

    # When the same vehicle is polled again
    client.post(
        "/events/record-vehicle-positions",
        json={"positions": [_position("B1", "2026-08-05T13:05:00Z")]},
    )

    # Then first_seen_at is unchanged but last_seen_at moved forward
    with Session(engine) as session:
        vehicle = session.get(Vehicle, "B1")
    assert vehicle is not None
    assert vehicle.first_seen_at == first_seen
    assert vehicle.last_seen_at > first_seen


def test_polling_the_same_vehicle_repeatedly_appends_to_history_instead_of_overwriting(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given the same vehicle polled three times at different positions
    for i in range(3):
        client.post(
            "/events/record-vehicle-positions",
            json={"positions": [_position("B1", f"2026-08-05T13:0{i}:00Z", latitude=-22.0 - i)]},
        )

    # Then history has one row per poll (unlike vehicleposition, which stays at one row)
    with Session(engine) as session:
        history = session.exec(select(VehiclePositionHistory)).all()
        positions = session.exec(select(VehiclePosition)).all()
    assert len(history) == 3
    assert len(positions) == 1
    assert {row.vehicle_id for row in history} == {"B1"}
    assert sorted(row.data["latitude"] for row in history) == [-24.0, -23.0, -22.0]
