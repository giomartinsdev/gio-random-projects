"""Confirms the object-storage events' contract against a fake S3 client
(same approach as test_archive_vehicle_position_history.py) — no real
MinIO in CI, but the same get_s3_client() seam every real caller goes
through.
"""

# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import base64
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.domain.object_storage.events as object_storage_events_module
from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.presentation.app import create_app

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator


class _FakeS3Client:
    def __init__(self) -> None:
        self.buckets: set[str] = set()
        self.objects: dict[tuple[str, str], dict[str, Any]] = {}

    def create_bucket(
        self,
        *,
        Bucket: str,  # noqa: N803 — matches boto3's own param casing
        CreateBucketConfiguration: dict[str, str] | None = None,  # noqa: N803, ARG002 — real boto3 signature; this fake doesn't need its contents
    ) -> None:
        if Bucket in self.buckets:
            raise ClientError(
                {"Error": {"Code": "BucketAlreadyOwnedByYou", "Message": "exists"}},
                "CreateBucket",
            )
        self.buckets.add(Bucket)

    def put_object(
        self,
        *,
        Bucket: str,  # noqa: N803 — matches boto3's own param casing
        Key: str,  # noqa: N803
        Body: bytes,  # noqa: N803
        ContentType: str | None = None,  # noqa: N803
    ) -> None:
        self.objects[(Bucket, Key)] = {"body": Body, "content_type": ContentType}

    def get_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 — matches boto3's own param casing
        stored = self.objects.get((Bucket, Key))
        if stored is None:
            raise ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject")

        class _Body:
            def read(self) -> bytes:
                return stored["body"]

        return {"Body": _Body(), "ContentType": stored["content_type"]}

    def list_objects_v2(
        self,
        *,
        Bucket: str,  # noqa: N803 — matches boto3's own param casing
        Prefix: str = "",  # noqa: N803
        MaxKeys: int = 1000,  # noqa: N803
    ) -> dict[str, Any]:
        contents = [
            {
                "Key": key,
                "Size": len(value["body"]),
                "LastModified": datetime(2026, 1, 1, tzinfo=UTC),
            }
            for (bucket, key), value in self.objects.items()
            if bucket == Bucket and key.startswith(Prefix)
        ][:MaxKeys]
        return {"Contents": contents}

    def delete_object(self, *, Bucket: str, Key: str) -> None:  # noqa: N803
        self.objects.pop((Bucket, Key), None)


@pytest.fixture()
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3Client:
    fake = _FakeS3Client()
    monkeypatch.setattr(object_storage_events_module, "get_s3_client", lambda: fake)
    return fake


@pytest.fixture()
def client(fake_s3: _FakeS3Client) -> Generator[TestClient]:  # noqa: ARG001 — activates the monkeypatch fixture
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
        yield test_client


def test_create_bucket_creates_it(client: TestClient) -> None:
    response = client.post("/events/create-bucket", json={"bucket": "reports"})

    assert response.status_code == 200
    assert response.json() is True


def test_create_bucket_is_idempotent(client: TestClient) -> None:
    client.post("/events/create-bucket", json={"bucket": "reports"})

    response = client.post("/events/create-bucket", json={"bucket": "reports"})

    assert response.status_code == 200
    assert response.json() is False


def test_put_then_get_object_round_trips_binary_data(client: TestClient) -> None:
    client.post("/events/create-bucket", json={"bucket": "reports"})
    payload = base64.b64encode(b"\x00\x01binary-data").decode("ascii")

    put_response = client.put(
        "/events/put-object",
        json={
            "bucket": "reports",
            "key": "2026/report.bin",
            "data_base64": payload,
            "content_type": "application/octet-stream",
        },
    )
    get_response = client.get(
        "/events/get-object", params={"bucket": "reports", "key": "2026/report.bin"}
    )

    assert put_response.status_code == 200
    body = get_response.json()
    assert body["key"] == "2026/report.bin"
    assert body["content_type"] == "application/octet-stream"
    assert base64.b64decode(body["data_base64"]) == b"\x00\x01binary-data"


def test_get_object_returns_none_for_missing_key(client: TestClient) -> None:
    response = client.get(
        "/events/get-object", params={"bucket": "reports", "key": "does-not-exist"}
    )

    assert response.status_code == 200
    assert response.json() is None


def test_list_objects_returns_keys_under_prefix(client: TestClient) -> None:
    client.post("/events/create-bucket", json={"bucket": "reports"})
    for key in ["2026/a.bin", "2026/b.bin", "2025/c.bin"]:
        client.put(
            "/events/put-object",
            json={"bucket": "reports", "key": key, "data_base64": base64.b64encode(b"x").decode()},
        )

    response = client.get("/events/list-objects", params={"bucket": "reports", "prefix": "2026/"})

    keys = sorted(item["key"] for item in response.json())
    assert keys == ["2026/a.bin", "2026/b.bin"]


def test_delete_object_removes_it(client: TestClient) -> None:
    client.post("/events/create-bucket", json={"bucket": "reports"})
    client.put(
        "/events/put-object",
        json={
            "bucket": "reports",
            "key": "gone.bin",
            "data_base64": base64.b64encode(b"x").decode(),
        },
    )

    delete_response = client.delete(
        "/events/delete-object", params={"bucket": "reports", "key": "gone.bin"}
    )
    get_response = client.get("/events/get-object", params={"bucket": "reports", "key": "gone.bin"})

    assert delete_response.json() is True
    assert get_response.json() is None
