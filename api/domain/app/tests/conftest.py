"""Shared testcontainers-backed fixtures for every .feature scenario.

Every domain event round-trips through a real Postgres container (the
same postgres:17-alpine image compose.yaml runs in production) instead
of sqlite — dispatcher.py's event-store audit row, upsert-by-natural-key
behavior, and (for object storage) SQL types all need Postgres's actual
semantics to be trustworthy, not sqlite's more permissive ones. Object
storage scenarios additionally get a real MinIO container, so
get_s3_client() is exercised as written rather than swapped for a fake.

One Postgres/MinIO container per test session (starting a container per
test would dominate suite runtime); tables are dropped and recreated
per-test for isolation instead of restarting the container.
"""

# testcontainers ships no type stubs (same category of gap as pyarrow in
# flows/vehicle_position_archiver's etl/transform.py) — every symbol
# imported from it is intrinsically Unknown to pyright, not a real
# typing gap on our side.
# boto3-stubs marks Name/Key as NotRequired on these TypedDicts in
# general (some other S3 responses reuse them without those fields) —
# ListBuckets/ListObjectsV2 always populate them, same reasoning as
# object_storage/events.py's own ListObjects handler.
# pyright: reportMissingTypeStubs=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportTypedDictNotRequiredAccess=false

from __future__ import annotations

from typing import TYPE_CHECKING

import boto3
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from testcontainers.core.container import DockerContainer
from testcontainers.core.waiting_utils import wait_for_logs
from testcontainers.postgres import PostgresContainer

from app.infrastructure.db import get_session
from app.infrastructure.discovery import discover_domain
from app.infrastructure.object_storage import MINIO_REGION
from app.presentation.app import create_app

if TYPE_CHECKING:
    from collections.abc import Generator, Iterator

    from sqlalchemy import Engine

MINIO_ACCESS_KEY = "domain-test"
MINIO_SECRET_KEY = "domain-test-secret"  # noqa: S105 — throwaway credential for an ephemeral local container


@pytest.fixture(scope="session")
def postgres_container() -> Iterator[PostgresContainer]:
    # driver="psycopg" — matches app/infrastructure/db.py's own
    # DATABASE_URL scheme (postgresql+psycopg://...), not the library's
    # psycopg2 default, since only psycopg[binary] (v3) is a real
    # dependency of this service (requirements.txt).
    with PostgresContainer("postgres:17-alpine", driver="psycopg") as container:
        yield container


@pytest.fixture(scope="session")
def minio_container() -> Iterator[DockerContainer]:
    container = (
        DockerContainer("minio/minio:latest")
        .with_exposed_ports(9000)
        .with_env("MINIO_ROOT_USER", MINIO_ACCESS_KEY)
        .with_env("MINIO_ROOT_PASSWORD", MINIO_SECRET_KEY)
        .with_command("server /data")
    )
    with container:
        wait_for_logs(container, "API:")
        yield container


@pytest.fixture()
def db_engine(postgres_container: PostgresContainer) -> Iterator[Engine]:
    discover_domain()  # registers every SQLModel table= entity before create_all
    engine = create_engine(postgres_container.get_connection_url())
    SQLModel.metadata.create_all(engine)
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine)


@pytest.fixture()
def client(db_engine: Engine) -> Generator[TestClient]:
    def override_get_session() -> Iterator[Session]:
        # expire_on_commit=False — matches infrastructure/db.py's real
        # get_session(); dispatcher.py's own commit (event-store audit
        # row) would otherwise expire whatever handle() just returned.
        with Session(db_engine, expire_on_commit=False) as session:
            yield session

    app = create_app()
    app.dependency_overrides[get_session] = override_get_session

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def minio_env(minio_container: DockerContainer, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Points get_s3_client() (app/infrastructure/object_storage.py) at
    the real MinIO container instead of production's minio-api.giomartins.dev
    — same env vars a real deployment reads, just pointed locally.
    """
    host = minio_container.get_container_host_ip()
    port = minio_container.get_exposed_port(9000)
    monkeypatch.setenv("MINIO_ENDPOINT_URL", f"http://{host}:{port}")
    monkeypatch.setenv("MINIO_ACCESS_KEY", MINIO_ACCESS_KEY)
    monkeypatch.setenv("MINIO_SECRET_KEY", MINIO_SECRET_KEY)
    # No real Cloudflare Access in front of a local test container — a
    # real MinIO doesn't expect (or need) these headers.
    monkeypatch.delenv("CF_ACCESS_CLIENT_ID", raising=False)
    monkeypatch.delenv("CF_ACCESS_CLIENT_SECRET", raising=False)

    yield

    # The MinIO container is session-scoped (starting one per test would
    # dominate suite runtime) — wipe every bucket/object it accumulated
    # so the next scenario starts from a clean server, same isolation
    # db_engine gets from drop_all/create_all per test.
    client = boto3.client(
        "s3",
        endpoint_url=f"http://{host}:{port}",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
        region_name=MINIO_REGION,
    )
    for bucket in client.list_buckets().get("Buckets", []):
        name = bucket["Name"]
        for obj in client.list_objects_v2(Bucket=name).get("Contents", []):
            client.delete_object(Bucket=name, Key=obj["Key"])
        client.delete_bucket(Bucket=name)
