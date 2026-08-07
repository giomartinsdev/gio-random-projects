# Importing the module's own private helper directly, rather than only
# through get_s3_client()'s registered botocore event — see
# object_storage_events_steps.py's fixtures for why the request-signing
# path itself is covered against a real S3 endpoint instead; this one
# pins down the header-injection unit in isolation (env var names,
# header names).
# pyright: reportPrivateUsage=false

from __future__ import annotations

from typing import TYPE_CHECKING

from pytest_bdd import given, parsers, scenarios, then, when

from app.infrastructure.object_storage import _inject_cf_access_headers

if TYPE_CHECKING:
    import pytest

scenarios("../features/object_storage_infrastructure.feature")


class _FakeRequest:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


@given(parsers.parse('CF_ACCESS_CLIENT_ID is set to "{value}"'))
def _given_client_id_set(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", value)


@given(parsers.parse('CF_ACCESS_CLIENT_SECRET is set to "{value}"'))
def _given_client_secret_set(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", value)


@given("CF_ACCESS_CLIENT_ID is not set")
def _given_client_id_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CF_ACCESS_CLIENT_ID", raising=False)


@given("CF_ACCESS_CLIENT_SECRET is not set")
def _given_client_secret_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CF_ACCESS_CLIENT_SECRET", raising=False)


@when("the before-send hook runs against an outgoing request", target_fixture="request_")
def _when_hook_runs() -> _FakeRequest:
    request = _FakeRequest()
    _inject_cf_access_headers(request)
    return request


@then(parsers.parse('the request carries CF-Access-Client-Id "{value}"'))
def _then_carries_client_id(request_: _FakeRequest, value: str) -> None:
    assert request_.headers["CF-Access-Client-Id"] == value


@then(parsers.parse('the request carries CF-Access-Client-Secret "{value}"'))
def _then_carries_client_secret(request_: _FakeRequest, value: str) -> None:
    assert request_.headers["CF-Access-Client-Secret"] == value


@then("the request carries no extra headers")
def _then_carries_no_headers(request_: _FakeRequest) -> None:
    assert request_.headers == {}
