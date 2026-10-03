"""Configuration is validated at startup, not discovered in production."""

from __future__ import annotations

import pytest

from finance_api.infrastructure.config import (
    ConfigError,
    load_settings,
    parse_api_keys,
    parse_http_addr,
)

MINIMAL = {
    "DOMAIN_API_BASE_URL": "http://domain-api:8000",
    "DOMAIN_API_KEY": "domain-key",
    "FINANCE_API_KEYS": "worker-key:worker",
}


def test_minimal_config_loads() -> None:
    settings = load_settings(dict(MINIMAL))
    assert settings.domain_api_base_url == "http://domain-api:8000"
    assert settings.finance_api_keys == {"worker-key": "worker"}
    assert settings.http_port == 8000


def test_trailing_slash_on_the_base_url_is_removed() -> None:
    # Otherwise every path becomes "//sync" and domain-api 404s.
    settings = load_settings(dict(MINIMAL, DOMAIN_API_BASE_URL="http://domain-api:8000/"))
    assert settings.domain_api_base_url == "http://domain-api:8000"


def test_missing_base_url_is_a_config_error() -> None:
    env = dict(MINIMAL)
    del env["DOMAIN_API_BASE_URL"]
    with pytest.raises(ConfigError) as excinfo:
        load_settings(env)
    assert "DOMAIN_API_BASE_URL" in str(excinfo.value)


def test_missing_domain_key_is_a_config_error() -> None:
    # Named explicitly: an unauthenticated finance-api gets 401 from
    # domain-api on every request (§10.3).
    env = dict(MINIMAL)
    del env["DOMAIN_API_KEY"]
    with pytest.raises(ConfigError) as excinfo:
        load_settings(env)
    assert "DOMAIN_API_KEY" in str(excinfo.value)


def test_empty_key_list_is_a_config_error() -> None:
    with pytest.raises(ConfigError):
        load_settings(dict(MINIMAL, FINANCE_API_KEYS=""))


def test_key_list_parses_multiple_callers() -> None:
    keys = parse_api_keys("k1:worker, k2:openfinance")
    assert keys == {"k1": "worker", "k2": "openfinance"}


def test_key_without_a_label_is_refused() -> None:
    # A silently dropped key is a production 401 nobody can explain.
    with pytest.raises(ConfigError) as excinfo:
        parse_api_keys("k1")
    assert "label" in str(excinfo.value)


def test_duplicate_key_is_refused() -> None:
    with pytest.raises(ConfigError):
        parse_api_keys("k1:worker,k1:other")


def test_label_containing_a_colon_is_preserved() -> None:
    assert parse_api_keys("k1:worker:prod") == {"k1": "worker:prod"}


def test_http_addr_forms() -> None:
    assert parse_http_addr(":8000") == ("0.0.0.0", 8000)
    assert parse_http_addr("0.0.0.0:8000") == ("0.0.0.0", 8000)
    assert parse_http_addr("127.0.0.1:8018") == ("127.0.0.1", 8018)


def test_bad_http_addr_is_refused() -> None:
    for bad in ("8000", ":abc", ":0", ":99999", ""):
        with pytest.raises(ConfigError):
            parse_http_addr(bad)


def test_timeout_outlasts_domain_apis_ten_second_sync() -> None:
    # A shorter client timeout would turn domain-api's documented 504 into a
    # transport error with no body, losing the "still queued" explanation.
    settings = load_settings(dict(MINIMAL))
    assert settings.domain_timeout_s > 10.0


def test_defaults_match_the_documented_stack_values() -> None:
    settings = load_settings(dict(MINIMAL))
    assert (settings.rate_limit_rps, settings.rate_limit_burst) == (5, 20)
    assert settings.service_name == "finance-api"
    assert settings.otlp_endpoint == ""  # empty = telemetry off
