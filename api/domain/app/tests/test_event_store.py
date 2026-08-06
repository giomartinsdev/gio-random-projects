"""Every dispatched event gets an audit row in domain_event_store —
tested against the dispatcher directly (not per-event), since this is a
property of dispatch() itself, not something any individual event opts
into. See app/service/dispatcher.py.
"""

# httpx's TestClient.post()/.json() surfaces Unknown/Any through its own
# stubs regardless of caller code (confirmed: a minimal reproduction hits
# the same "Unknown" on TestClient's own `auth` default sentinel) — these
# tests assert against raw wire-level JSON responses, exactly the case
# where that's unavoidable rather than a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

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
        # expire_on_commit=False — matches infrastructure/db.py's real
        # get_session(); dispatcher.py's own commit (event-store audit
        # row) would otherwise expire whatever handle() just returned.
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    with TestClient(app) as test_client:
        yield test_client, engine


def _position(vehicle_id: str) -> dict[str, object]:
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


def test_dispatching_an_event_records_it_in_the_event_store(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given a RecordVehiclePositions event dispatched through the API
    client.post("/events/record-vehicle-positions", json={"positions": [_position("B1")]})

    # When reading the event store directly
    with Session(engine) as session:
        records = session.exec(select(DomainEventRecord)).all()

    # Then exactly one record exists, capturing the event, its entity, and its result
    assert len(records) == 1
    record = records[0]
    assert record.event_type == "RecordVehiclePositions"
    assert record.entity_type == "VehiclePosition"
    assert '"vehicle_id":"B1"' in record.payload.replace(" ", "")
    assert record.result == "1"


def test_each_dispatched_event_gets_its_own_record(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given a position recorded, then an archive pass run over it
    client.post("/events/record-vehicle-positions", json={"positions": [_position("B1")]})
    client.post("/events/archive-vehicle-position-history", json={})

    # When reading the event store
    with Session(engine) as session:
        records = session.exec(select(DomainEventRecord)).all()

    # Then both dispatches were recorded, in order
    event_types = [r.event_type for r in records]
    assert event_types == ["RecordVehiclePositions", "ArchiveVehiclePositionHistory"]
