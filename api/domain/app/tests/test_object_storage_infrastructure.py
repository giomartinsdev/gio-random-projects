"""Confirms get_s3_client() attaches Cloudflare Access Service Token
headers to every request — the actual fix for CreateBucket/etc. crashing
against real MinIO (see object_storage.py's module docstring). Tested
directly against the registered botocore event handler, not through a
live request, since there's no real MinIO in CI.
"""

# Importing the module's own private helper directly, rather than only
# through get_s3_client()'s registered botocore event — there's no real
# S3 endpoint in CI to trigger that event through, and this is the unit
# actually worth pinning down (the env var names, the header names).
# pyright: reportPrivateUsage=false

from __future__ import annotations

from typing import TYPE_CHECKING

from app.infrastructure.object_storage import _inject_cf_access_headers

if TYPE_CHECKING:
    import pytest


class _FakeRequest:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}


def test_injects_headers_when_cf_access_env_vars_are_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CF_ACCESS_CLIENT_ID", "test-id")
    monkeypatch.setenv("CF_ACCESS_CLIENT_SECRET", "test-secret")
    request = _FakeRequest()

    _inject_cf_access_headers(request)

    assert request.headers["CF-Access-Client-Id"] == "test-id"
    assert request.headers["CF-Access-Client-Secret"] == "test-secret"


def test_adds_no_headers_when_cf_access_env_vars_are_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CF_ACCESS_CLIENT_ID", raising=False)
    monkeypatch.delenv("CF_ACCESS_CLIENT_SECRET", raising=False)
    request = _FakeRequest()

    _inject_cf_access_headers(request)

    assert request.headers == {}
