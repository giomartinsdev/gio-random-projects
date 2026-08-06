# This test asserts against a raw wire-level JSON body (json.loads
# returns Any) — genuinely dynamic, not a real typing gap. Same
# reasoning as flows/bus_gps_poller/tests/unit/test_load.py.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import base64
import json
from typing import TYPE_CHECKING

import httpx

from flows.vehicle_position_archiver.etl import load as load_module
from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader
from flows.vehicle_position_archiver.schemas import ArchivePlan

if TYPE_CHECKING:
    from collections.abc import Callable

    import pytest

API_KEY = "test-key"
BUCKET = "vehicle-position-archive"
# Mirrors etl/load.py's own _DELETE_CHUNK_SIZE — kept as a local constant
# rather than importing the private name across modules.
_DELETE_CHUNK_SIZE = 500


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_load_skips_the_gateway_entirely_when_there_is_nothing_to_archive() -> None:
    # Given a fake gateway that fails the test if it's ever called
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("gateway should not be called when object_key is None")

    loader = GatewayArchiveLoader(
        "https://gateway.example", API_KEY, BUCKET, _fake_gateway(handler)
    )
    empty_plan = ArchivePlan(object_key=None, parquet_bytes=b"", archived_ids=[])

    # When loading an empty plan
    loader.load(empty_plan)

    # Then no request was made (handler raising would have failed the test)


def test_load_creates_the_bucket_uploads_the_object_then_deletes_the_rows() -> None:
    # Given a fake gateway that records every request it receives
    calls: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body: object = (
            {"ids": request.url.params.get_list("ids")}
            if request.method == "DELETE"
            else json.loads(request.content)
        )
        calls.append((request.method, request.url.path, body))
        if request.url.path == "/events/delete-vehicle-position-history-batch":
            return httpx.Response(200, json=2)
        return httpx.Response(200, json=True)

    loader = GatewayArchiveLoader(
        "https://gateway.example", API_KEY, BUCKET, _fake_gateway(handler)
    )
    plan = ArchivePlan(
        object_key="vehicle-position-history/2026/08/06/000000-abcd1234.parquet",
        parquet_bytes=b"parquet-bytes",
        archived_ids=[10, 11],
    )

    # When loading the plan
    loader.load(plan)

    # Then the bucket was created, the object uploaded, and the rows deleted, in order
    assert [(method, path) for method, path, _ in calls] == [
        ("POST", "/events/create-bucket"),
        ("PUT", "/events/put-object"),
        ("DELETE", "/events/delete-vehicle-position-history-batch"),
    ]
    _, _, create_body = calls[0]
    assert create_body == {"bucket": BUCKET}
    _, _, put_body = calls[1]
    assert isinstance(put_body, dict)
    assert put_body["bucket"] == BUCKET
    assert put_body["key"] == plan.object_key
    assert base64.b64decode(str(put_body["data_base64"])) == b"parquet-bytes"
    _, _, delete_params = calls[2]
    assert delete_params == {"ids": ["10", "11"]}


def test_load_chunks_very_large_delete_batches() -> None:
    # Given an archive plan with more ids than one chunk holds
    ids = list(range(_DELETE_CHUNK_SIZE + 1))
    delete_calls: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/events/delete-vehicle-position-history-batch":
            delete_calls.append(dict(request.url.params))
            return httpx.Response(200, json=len(request.url.params.get_list("ids")))
        return httpx.Response(200, json=True)

    loader = GatewayArchiveLoader(
        "https://gateway.example", API_KEY, BUCKET, _fake_gateway(handler)
    )
    plan = ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=ids)

    # When loading
    loader.load(plan)

    # Then the delete happened in two requests, not one oversized one
    assert len(delete_calls) == 2


def test_load_retries_after_a_429_instead_of_crashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given a fake gateway that rate-limits the first attempt, then succeeds
    sleeps: list[float] = []
    monkeypatch.setattr(load_module.time, "sleep", sleeps.append)

    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request.url.path)
        if request.url.path == "/events/create-bucket" and len(attempts) == 1:
            return httpx.Response(429, headers={"Retry-After": "3"}, json={"error": "slow down"})
        if request.url.path == "/events/delete-vehicle-position-history-batch":
            return httpx.Response(200, json=1)
        return httpx.Response(200, json=True)

    loader = GatewayArchiveLoader(
        "https://gateway.example", API_KEY, BUCKET, _fake_gateway(handler)
    )
    plan = ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=[1])

    # When loading
    loader.load(plan)

    # Then it waited the Retry-After duration and succeeded on the retry,
    # without ever raising
    assert sleeps == [3.0]
    assert attempts.count("/events/create-bucket") == 2


def test_load_gives_up_after_repeated_429s() -> None:
    # Given a fake gateway that never stops rate-limiting
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": "slow down"})

    loader = GatewayArchiveLoader(
        "https://gateway.example", API_KEY, BUCKET, _fake_gateway(handler)
    )
    plan = ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=[1])

    # When loading
    # Then it eventually gives up rather than retrying forever
    try:
        loader.load(plan)
    except httpx.HTTPStatusError as exc:
        assert exc.response.status_code == 429
    else:
        raise AssertionError("expected an HTTPStatusError")
