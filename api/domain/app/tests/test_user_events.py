"""End-to-end test of the framework via the User domain: if this fails,
either the User domain or the framework itself (discovery, table
creation, route generation) broke — there's no separate unit-test layer
for the framework because it has no behavior independent of a real
domain exercising it.
"""

# httpx's TestClient.post()/.json() surfaces Unknown/Any through its own
# stubs regardless of caller code (confirmed: a minimal reproduction hits
# the same "Unknown" on TestClient's own `auth` default sentinel) — these
# tests assert against raw wire-level JSON responses, exactly the case
# where that's unavoidable rather than a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from collections.abc import Generator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.presentation.app import create_app


@pytest.fixture()
def client() -> Generator[TestClient, None, None]:
    # discover_domain() first: SQLModel.metadata only has a table for User
    # (or any entity) once its module has actually been imported — on a
    # test process's very first run, nothing has imported it yet, so
    # create_all() below would create zero tables without this.
    discover_domain()

    # A fresh in-memory engine per test, injected via dependency override —
    # NOT the module-level engine in infrastructure/db.py, which is created
    # once at import time and would otherwise be shared (and therefore
    # leak state) across every test in the session.
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
        yield test_client


def test_create_user_returns_the_created_row(client: TestClient) -> None:
    # Given a valid CreateUser payload
    payload = {"name": "gio", "email": "gio@example.com"}

    # When calling the auto-generated create-user event route
    response = client.post("/events/create-user", json=payload)

    # Then the created row comes back with an assigned id
    assert response.status_code == 200
    body = response.json()
    assert body["id"] is not None
    assert body["name"] == "gio"
    assert body["email"] == "gio@example.com"


def test_get_user_returns_the_same_row_that_was_created(client: TestClient) -> None:
    # Given a created user
    created = client.post(
        "/events/create-user", json={"name": "gio", "email": "gio@example.com"}
    ).json()

    # When fetching it by id via GetUser
    response = client.post("/events/get-user", json={"id": created["id"]})

    # Then it matches what was created
    assert response.status_code == 200
    assert response.json() == created


def test_get_user_returns_none_for_a_missing_id(client: TestClient) -> None:
    # Given no user with id 999 exists
    # When fetching it via GetUser
    response = client.post("/events/get-user", json={"id": 999})

    # Then the response is null, not an error
    assert response.status_code == 200
    assert response.json() is None


def test_list_users_includes_every_created_user(client: TestClient) -> None:
    # Given two created users
    client.post("/events/create-user", json={"name": "gio", "email": "gio@example.com"})
    client.post("/events/create-user", json={"name": "ana", "email": "ana@example.com"})

    # When listing all users
    response = client.post("/events/list-users", json={})

    # Then both are present
    assert response.status_code == 200
    names = {row["name"] for row in response.json()}
    assert names == {"gio", "ana"}


def test_update_user_applies_only_the_fields_provided(client: TestClient) -> None:
    # Given a created user
    created = client.post(
        "/events/create-user", json={"name": "gio", "email": "gio@example.com"}
    ).json()

    # When updating only the name
    response = client.post("/events/update-user", json={"id": created["id"], "name": "gio martins"})

    # Then the name changed but the email did not
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "gio martins"
    assert body["email"] == "gio@example.com"


def test_update_user_returns_none_for_a_missing_id(client: TestClient) -> None:
    # Given no user with id 999 exists
    # When updating it via UpdateUser
    response = client.post("/events/update-user", json={"id": 999, "name": "nobody"})

    # Then the response is null, not an error
    assert response.status_code == 200
    assert response.json() is None


def test_delete_user_removes_the_row_and_get_confirms_it(client: TestClient) -> None:
    # Given a created user
    created = client.post(
        "/events/create-user", json={"name": "gio", "email": "gio@example.com"}
    ).json()

    # When deleting it
    delete_response = client.post("/events/delete-user", json={"id": created["id"]})

    # Then delete reports success and a subsequent get returns nothing
    assert delete_response.json() is True
    assert client.post("/events/get-user", json={"id": created["id"]}).json() is None


def test_delete_user_returns_false_for_a_missing_id(client: TestClient) -> None:
    # Given no user with id 999 exists
    # When deleting it via DeleteUser
    response = client.post("/events/delete-user", json={"id": 999})

    # Then the response reports nothing was deleted
    assert response.status_code == 200
    assert response.json() is False
