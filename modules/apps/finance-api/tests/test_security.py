"""X-API-Key authentication (§12.3)."""

from __future__ import annotations

import pytest

from finance_api.domain.errors import UnauthorizedError
from finance_api.presentation.security import API_KEY_HEADER, authenticate

KEYS = {"key-a": "worker", "key-b": "openfinance"}


def test_a_valid_key_returns_its_label() -> None:
    assert authenticate({API_KEY_HEADER: "key-a"}, KEYS) == "worker"
    assert authenticate({API_KEY_HEADER: "key-b"}, KEYS) == "openfinance"


def test_header_lookup_is_case_insensitive() -> None:
    assert authenticate({"x-api-key": "key-a"}, KEYS) == "worker"


def test_missing_header_is_unauthorized() -> None:
    with pytest.raises(UnauthorizedError):
        authenticate({}, KEYS)


def test_unknown_key_is_unauthorized() -> None:
    with pytest.raises(UnauthorizedError):
        authenticate({API_KEY_HEADER: "nope"}, KEYS)


def test_empty_key_is_unauthorized() -> None:
    with pytest.raises(UnauthorizedError):
        authenticate({API_KEY_HEADER: ""}, KEYS)


def test_a_key_prefix_does_not_authenticate() -> None:
    with pytest.raises(UnauthorizedError):
        authenticate({API_KEY_HEADER: "key-"}, KEYS)


def test_the_error_message_never_echoes_the_presented_key() -> None:
    with pytest.raises(UnauthorizedError) as excinfo:
        authenticate({API_KEY_HEADER: "hunter2"}, KEYS)
    assert "hunter2" not in str(excinfo.value)


def test_missing_and_invalid_are_indistinguishable() -> None:
    # Telling a prober which of the two it was is free information.
    with pytest.raises(UnauthorizedError) as missing:
        authenticate({}, KEYS)
    with pytest.raises(UnauthorizedError) as invalid:
        authenticate({API_KEY_HEADER: "nope"}, KEYS)
    assert str(missing.value) == str(invalid.value)
