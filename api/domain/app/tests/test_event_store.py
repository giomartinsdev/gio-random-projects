"""Every dispatched event gets an audit row in domain_event_store —
tested against the dispatcher directly (not per-event), since this is a
property of dispatch() itself, not something any individual event opts
into. See app/service/dispatcher.py.
"""

from collections.abc import Generator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.infrastructure.event_store import DomainEventRecord
from app.presentation.app import create_app


@pytest.fixture()
def client_and_engine() -> Generator[tuple[TestClient, Engine], None, None]:
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


def test_dispatching_an_event_records_it_in_the_event_store(
    client_and_engine: tuple[TestClient, Engine],
) -> None:
    client, engine = client_and_engine

    # Given a CreateUser event dispatched through the API
    created = client.post("/events/create-user", json={"name": "gio", "email": "gio@example.com"}).json()

    # When reading the event store directly
    with Session(engine) as session:
        records = session.exec(select(DomainEventRecord)).all()

    # Then exactly one record exists, capturing the event, its entity, and its result
    assert len(records) == 1
    record = records[0]
    assert record.event_type == "CreateUser"
    assert record.entity_type == "User"
    assert '"name":"gio"' in record.payload.replace(" ", "")
    assert record.result is not None
    assert f'"id":{created["id"]}' in record.result.replace(" ", "")


def test_each_dispatched_event_gets_its_own_record(client_and_engine: tuple[TestClient, Engine]) -> None:
    client, engine = client_and_engine

    # Given a user created, then fetched, then updated
    created = client.post("/events/create-user", json={"name": "gio", "email": "gio@example.com"}).json()
    client.post("/events/get-user", json={"id": created["id"]})
    client.post("/events/update-user", json={"id": created["id"], "name": "gio martins"})

    # When reading the event store
    with Session(engine) as session:
        records = session.exec(select(DomainEventRecord)).all()

    # Then all three dispatches were recorded, in order
    event_types = [r.event_type for r in records]
    assert event_types == ["CreateUser", "GetUser", "UpdateUser"]
