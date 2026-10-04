"""A ponte Vaultwarden → env (SECRETS_BRIDGE_URL/API_KEY) no lado Python.

O provedor é scriptado: o que se prova é a nossa lógica (usa o cofre quando
configurado, cai no ambiente em 404/erro, nunca derruba o boot), não o
vaultwarden-api em si.
"""

from __future__ import annotations

import httpx
import pytest

from finance_api.infrastructure import secrets_bridge


@pytest.fixture
def bridge(monkeypatch):
    """Aponta a ponte para um MockTransport que serve ``items``."""
    items: dict[str, str] = {}
    status = {"code": 200}

    def handler(req: httpx.Request) -> httpx.Response:
        name = req.url.path.rsplit("/", 1)[-1]
        assert req.headers["Authorization"] == "Bearer bridge-key"
        if status["code"] != 200:
            return httpx.Response(status["code"], json={"message": "boom"})
        if name not in items:
            return httpx.Response(404, json={"message": "not found"})
        return httpx.Response(200, json={"value": items[name]})

    transport = httpx.MockTransport(handler)
    real_get = httpx.get

    def fake_get(url, **kw):
        return httpx.Client(transport=transport).get(url, **kw)

    monkeypatch.setattr(secrets_bridge.httpx, "get", fake_get)
    return items, status


def test_reads_from_the_vault_when_configured(bridge):
    items, _ = bridge
    items["POLP_OF_CLIENT_ID"] = "client_from_vault"
    resolve = secrets_bridge.resolver({
        "SECRETS_BRIDGE_URL": "http://vaultwarden-api:8080",
        "SECRETS_BRIDGE_API_KEY": "bridge-key",
    })
    assert resolve("POLP_OF_CLIENT_ID") == "client_from_vault"


def test_falls_back_to_env_when_item_missing_in_vault(bridge):
    # Cofre sem o item (404) → cai no ambiente (soft cutover).
    resolve = secrets_bridge.resolver({
        "SECRETS_BRIDGE_URL": "http://vaultwarden-api:8080",
        "SECRETS_BRIDGE_API_KEY": "bridge-key",
        "POLP_OF_CLIENT_ID": "from_env",
    })
    assert resolve("POLP_OF_CLIENT_ID") == "from_env"


def test_falls_back_to_env_when_bridge_is_down(bridge):
    _, status = bridge
    status["code"] = 500
    resolve = secrets_bridge.resolver({
        "SECRETS_BRIDGE_URL": "http://vaultwarden-api:8080",
        "SECRETS_BRIDGE_API_KEY": "bridge-key",
        "POLP_OF_CLIENT_SECRET": "from_env",
    })
    assert resolve("POLP_OF_CLIENT_SECRET") == "from_env"


def test_without_bridge_uses_env_directly():
    resolve = secrets_bridge.resolver({"POLP_OF_CLIENT_ID": "only_env"})
    assert resolve("POLP_OF_CLIENT_ID") == "only_env"
    assert resolve("MISSING") == ""


def test_config_resolves_polp_from_the_bridge(bridge):
    from finance_api.infrastructure.config import load_settings

    items, _ = bridge
    items["POLP_OF_CLIENT_ID"] = "vault-client"
    items["POLP_OF_CLIENT_SECRET"] = "vault-secret"
    settings = load_settings({
        "DOMAIN_API_BASE_URL": "http://domain-api:8000",
        "DOMAIN_API_KEY": "k",
        "FINANCE_API_KEYS": "w:worker",
        "SECRETS_BRIDGE_URL": "http://vaultwarden-api:8080",
        "SECRETS_BRIDGE_API_KEY": "bridge-key",
    })
    assert settings.polp_client_id == "vault-client"
    assert settings.polp_client_secret == "vault-secret"
