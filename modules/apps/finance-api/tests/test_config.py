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


# ------------------------------------------------------------------- SSO §5

def test_session_secret_is_derived_when_not_provided() -> None:
    # Sem FINANCE_SESSION_SECRET, o segredo é derivado do DOMAIN_API_KEY — o
    # login funciona sem cadastrar mais nenhuma variável, e o cookie nunca é
    # assinado com uma chave pública.
    settings = load_settings(dict(MINIMAL))
    assert len(settings.session_secret) >= 32
    assert settings.session_secret != MINIMAL["DOMAIN_API_KEY"]


def test_explicit_session_secret_wins() -> None:
    settings = load_settings(dict(MINIMAL, FINANCE_SESSION_SECRET="a" * 40))
    assert settings.session_secret == "a" * 40


def test_derived_secret_is_stable_and_domain_separated() -> None:
    from finance_api.infrastructure.config import derive_session_secret

    a = derive_session_secret("domain-key")
    assert a == derive_session_secret("domain-key")  # determinístico
    assert a != derive_session_secret("other-key")
    assert len(a) == 64  # hex sha256


def test_empty_seed_means_no_session_secret() -> None:
    from finance_api.infrastructure.config import derive_session_secret

    assert derive_session_secret("") == ""


def test_google_client_id_is_optional() -> None:
    # Sem client ID o login fica desabilitado, mas o boot não quebra.
    settings = load_settings(dict(MINIMAL))
    assert settings.google_client_id == ""
