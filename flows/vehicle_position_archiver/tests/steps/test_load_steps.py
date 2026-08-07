# This test asserts against a raw wire-level JSON body (json.loads
# returns Any) — genuinely dynamic, not a real typing gap.
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false, reportUnknownArgumentType=false

from __future__ import annotations

import base64
import json
from typing import TYPE_CHECKING, Any

import httpx
import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from flows.vehicle_position_archiver.etl import load as load_module
from flows.vehicle_position_archiver.etl.load import GatewayArchiveLoader
from flows.vehicle_position_archiver.schemas import ArchivePlan

if TYPE_CHECKING:
    from collections.abc import Callable

scenarios("../features/load.feature")

API_KEY = "test-key"
BUCKET = "vehicle-position-archive"
# Mirrors etl/load.py's own _DELETE_CHUNK_SIZE — kept as a local constant
# rather than importing the private name across modules.
_DELETE_CHUNK_SIZE = 500


def _fake_gateway(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


@pytest.fixture()
def plan() -> ArchivePlan:
    return ArchivePlan(object_key=None, parquet_bytes=b"", archived_ids=[])


@pytest.fixture()
def handler_mode() -> dict[str, Any]:
    return {"mode": "normal"}


@pytest.fixture()
def calls() -> list[tuple[str, str, object]]:
    return []


@given("an empty archive plan")
def _given_empty_plan() -> None:
    return


@given(
    parsers.parse('an archive plan with {count:d} archived ids and object key "{key}"'),
    target_fixture="plan",
)
def _given_real_plan(count: int, key: str) -> ArchivePlan:
    assert count == 2
    return ArchivePlan(object_key=key, parquet_bytes=b"parquet-bytes", archived_ids=[10, 11])


@given(parsers.parse("an archive plan with {count:d} archived ids"), target_fixture="plan")
def _given_plan_with_n_ids(count: int) -> ArchivePlan:
    return ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=list(range(count)))


@given(
    parsers.parse(
        "a gateway that rate-limits the first create-bucket attempt for {seconds:d} seconds"
    ),
    target_fixture="plan",
)
def _given_rate_limited_once(handler_mode: dict[str, Any], seconds: int) -> ArchivePlan:
    handler_mode["mode"] = "rate-limit-once"
    handler_mode["retry_after"] = seconds
    return ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=[1])


@given("a gateway that always rate-limits every request", target_fixture="plan")
def _given_always_rate_limited(handler_mode: dict[str, Any]) -> ArchivePlan:
    handler_mode["mode"] = "always-rate-limit"
    return ArchivePlan(object_key="k.parquet", parquet_bytes=b"x", archived_ids=[1])


def _build_handler(
    calls: list[tuple[str, str, object]], handler_mode: dict[str, Any]
) -> Callable[[httpx.Request], httpx.Response]:
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        mode = handler_mode["mode"]
        if mode == "always-rate-limit":
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"error": "slow down"})
        if mode == "rate-limit-once":
            attempts.append(request.url.path)
            if (
                request.url.path == "/events/create-bucket"
                and attempts.count("/events/create-bucket") == 1
            ):
                retry_after = handler_mode["retry_after"]
                return httpx.Response(
                    429, headers={"Retry-After": str(retry_after)}, json={"error": "slow down"}
                )
            if request.url.path == "/events/delete-vehicle-position-history-batch":
                return httpx.Response(200, json=1)
            return httpx.Response(200, json=True)

        body: object = (
            {"ids": request.url.params.get_list("ids")}
            if request.method == "DELETE"
            else json.loads(request.content)
        )
        calls.append((request.method, request.url.path, body))
        if request.url.path == "/events/delete-vehicle-position-history-batch":
            return httpx.Response(200, json=len(request.url.params.get_list("ids")))
        return httpx.Response(200, json=True)

    handler_mode["attempts"] = attempts
    return handler


@when("the plan is loaded", target_fixture="outcome")
def _when_loaded(
    plan: ArchivePlan,
    calls: list[tuple[str, str, object]],
    handler_mode: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, Any]:
    sleeps: list[float] = []
    monkeypatch.setattr(load_module.time, "sleep", sleeps.append)

    loader = GatewayArchiveLoader(
        "https://gateway.example",
        API_KEY,
        BUCKET,
        _fake_gateway(_build_handler(calls, handler_mode)),
    )
    try:
        loader.load(plan)
    except httpx.HTTPStatusError as exc:
        return {"error": exc, "sleeps": sleeps}
    return {"sleeps": sleeps}


@then("no request was made")
def _then_no_request(calls: list[tuple[str, str, object]]) -> None:
    assert calls == []


@then(parsers.parse("the requests happened in order: {a}, {b}, {c}"))
def _then_requests_in_order(calls: list[tuple[str, str, object]], a: str, b: str, c: str) -> None:
    assert [path for _, path, _ in calls] == [f"/events/{a}", f"/events/{b}", f"/events/{c}"]


@then("the create-bucket request named the archive bucket")
def _then_create_bucket_named(calls: list[tuple[str, str, object]]) -> None:
    _, _, body = calls[0]
    assert body == {"bucket": BUCKET}


@then("the put-object request carried the object key and the parquet bytes")
def _then_put_object_body(calls: list[tuple[str, str, object]], plan: ArchivePlan) -> None:
    _, _, put_body = calls[1]
    assert isinstance(put_body, dict)
    assert put_body["bucket"] == BUCKET
    assert put_body["key"] == plan.object_key
    assert base64.b64decode(str(put_body["data_base64"])) == b"parquet-bytes"


@then(parsers.parse('the delete request named exactly ids "{a}" and "{b}"'))
def _then_delete_named_ids(calls: list[tuple[str, str, object]], a: str, b: str) -> None:
    _, _, delete_params = calls[2]
    assert delete_params == {"ids": [a, b]}


@then(parsers.parse("the delete happened in {count:d} requests, not one oversized one"))
def _then_delete_chunked(calls: list[tuple[str, str, object]], count: int) -> None:
    delete_calls = [c for c in calls if c[1] == "/events/delete-vehicle-position-history-batch"]
    assert len(delete_calls) == count


@then(parsers.parse("it slept for {seconds:g} seconds"))
def _then_slept(outcome: dict[str, Any], seconds: float) -> None:
    assert outcome["sleeps"] == [seconds]


@then(parsers.parse("create-bucket was attempted {count:d} times"))
def _then_create_bucket_attempts(handler_mode: dict[str, Any], count: int) -> None:
    assert handler_mode["attempts"].count("/events/create-bucket") == count


@then(parsers.parse("the error propagates as an HTTPStatusError with status {status:d}"))
def _then_error_propagates(outcome: dict[str, Any], status: int) -> None:
    error = outcome["error"]
    assert isinstance(error, httpx.HTTPStatusError)
    assert error.response.status_code == status
