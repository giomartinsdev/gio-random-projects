"""Confirms the Document/CreateMany generalization actually works end
to end: a bulk create through the API lands every row's payload
verbatim in its JSONB `data` column, and the whole batch gets exactly
one domain_event_store audit record (not one per row) — the entire
point of CreateMany over dispatching Create per row.
"""

# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.domain.bus_position.entity import BusPosition
from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.infrastructure.event_store import DomainEventRecord
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


def test_create_bus_positions_inserts_every_row_with_its_payload_in_data(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given a batch of two GPS pings
    payload = {
        "positions": [
            {
                "mode": "sppo",
                "line_code": "606",
                "vehicle_id": "B25611",
                "latitude": -22.90434,
                "longitude": -43.2863,
                "speed_kmh": 0.0,
                "captured_at": "2026-07-27T22:06:32Z",
                "color_hex": "#FF0000",
            },
            {
                "mode": "brt",
                "line_code": "22",
                "vehicle_id": "901008",
                "latitude": -23.001127,
                "longitude": -43.329477,
                "speed_kmh": 11.0,
                "captured_at": "2026-07-27T22:07:43Z",
                "color_hex": None,
            },
        ]
    }

    # When dispatched through the auto-generated create-bus-positions route
    response = client.post("/events/create-bus-positions", json=payload)

    # Then it reports the count inserted
    assert response.status_code == 200
    assert response.json() == 2

    # And both rows exist with their payload verbatim in the JSONB column
    with Session(engine) as session:
        rows = session.exec(select(BusPosition)).all()
    assert len(rows) == 2
    vehicle_ids = {row.data["vehicle_id"] for row in rows}
    assert vehicle_ids == {"B25611", "901008"}
    brt_row = next(row for row in rows if row.data["vehicle_id"] == "901008")
    assert brt_row.data["mode"] == "brt"
    assert brt_row.data["color_hex"] is None


def test_create_bus_positions_records_exactly_one_audit_row_for_the_whole_batch(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given a batch of three GPS pings
    positions = [
        {
            "mode": "sppo",
            "line_code": "606",
            "vehicle_id": f"B{i}",
            "latitude": -22.9,
            "longitude": -43.2,
            "speed_kmh": 10.0,
            "captured_at": "2026-07-27T22:06:32Z",
            "color_hex": None,
        }
        for i in range(3)
    ]

    # When dispatched in one call
    client.post("/events/create-bus-positions", json={"positions": positions})

    # Then exactly one domain_event_store record exists for the whole batch
    with Session(engine) as session:
        records = session.exec(select(DomainEventRecord)).all()
    assert len(records) == 1
    assert records[0].event_type == "CreateBusPositions"
    assert records[0].entity_type == "BusPosition"
    assert records[0].result == "3"
