"""Confirms ArchiveVehiclePositionHistory's prune-and-archive behavior
without a real MinIO — get_s3_client is monkeypatched to a fake
recording put_object calls, since this event's contract is "leaves the
10 most recent rows per vehicle and uploads exactly one Parquet object
for the rest", not any particular S3 library behavior. The real S3
upload + Parquet round-trip was confirmed manually against a real
local Postgres + MinIO before this was committed (not automated here
since CI has no MinIO to talk to).
"""

# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import io
import json
from typing import TYPE_CHECKING, Any

import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import app.domain.vehicle_position.archive_events as archive_events_module
from app.domain.vehicle_position.history_entity import VehiclePositionHistory
from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.presentation.app import create_app

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator

    from sqlalchemy import Engine


class _FakeS3Client:
    def __init__(self) -> None:
        self.uploads: list[dict[str, Any]] = []

    def put_object(self, *, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803 — matches boto3's own param casing
        self.uploads.append({"bucket": Bucket, "key": Key, "body": Body})


@pytest.fixture()
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3Client:
    fake = _FakeS3Client()
    monkeypatch.setattr(archive_events_module, "get_s3_client", lambda: fake)
    return fake


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


def test_archive_leaves_only_the_10_most_recent_rows_per_vehicle(
    client_and_engine: tuple[TestClient, Engine],
    fake_s3: _FakeS3Client,  # noqa: ARG001 — needed to activate the monkeypatch fixture, not read directly here
) -> None:
    client, engine = client_and_engine

    # Given 12 polls of the same vehicle (history has 12 rows, no pruning yet)
    for minute in range(12):
        client.post(
            "/events/record-vehicle-positions", json={"positions": [_position("B1", minute)]}
        )

    # When archiving with the default keep_per_vehicle=10
    response = client.post("/events/archive-vehicle-position-history", json={})

    # Then it reports 2 archived, and only the 10 newest rows remain
    assert response.status_code == 200
    assert response.json() == 2
    with Session(engine) as session:
        remaining = session.exec(select(VehiclePositionHistory)).all()
    assert len(remaining) == 10
    assert sorted(row.data["speed_kmh"] for row in remaining) == [float(i) for i in range(2, 12)]


def test_archive_uploads_exactly_one_parquet_object_with_the_archived_rows(
    client_and_engine: tuple[TestClient, Engine], fake_s3: _FakeS3Client
) -> None:
    client, _engine = client_and_engine

    # Given 12 polls of the same vehicle
    for minute in range(12):
        client.post(
            "/events/record-vehicle-positions", json={"positions": [_position("B1", minute)]}
        )

    # When archiving
    client.post("/events/archive-vehicle-position-history", json={})

    # Then exactly one Parquet object was uploaded, containing the 2 oldest rows
    assert len(fake_s3.uploads) == 1
    upload = fake_s3.uploads[0]
    assert upload["bucket"] == "vehicle-position-archive"
    assert upload["key"].startswith("vehicle-position-history/")
    assert upload["key"].endswith(".parquet")

    table = pq.read_table(io.BytesIO(upload["body"]))
    rows = table.to_pylist()
    assert len(rows) == 2
    speeds = sorted(json.loads(row["data"])["speed_kmh"] for row in rows)
    assert speeds == [0.0, 1.0]


def test_archive_is_a_no_op_when_no_vehicle_has_more_than_the_keep_count(
    client_and_engine: tuple[TestClient, Engine], fake_s3: _FakeS3Client
) -> None:
    client, engine = client_and_engine

    # Given only 3 polls of one vehicle (well under the default keep=10)
    for minute in range(3):
        client.post(
            "/events/record-vehicle-positions", json={"positions": [_position("B1", minute)]}
        )

    # When archiving
    response = client.post("/events/archive-vehicle-position-history", json={})

    # Then nothing was archived or uploaded, and all 3 rows remain
    assert response.json() == 0
    assert fake_s3.uploads == []
    with Session(engine) as session:
        remaining = session.exec(select(VehiclePositionHistory)).all()
    assert len(remaining) == 3
