"""Ponte Vaultwarden → env para os apps Python.

Espelha o ``secretsbridge`` dos apps Go: quando ``SECRETS_BRIDGE_URL`` e
``SECRETS_BRIDGE_API_KEY`` estão definidos, busca o segredo no serviço
``vaultwarden-api`` (``GET /secret/:name`` com ``Authorization: Bearer``) em vez
de lê-lo cru do ambiente. Sem a ponte configurada, cai no ``os.environ`` — o
mesmo "soft cutover" do Go, para nada quebrar antes de o cofre existir.

Um segredo que não está no cofre (404) **não** é fatal aqui: devolve vazio e
quem chama decide (ex.: o Open Finance fica desligado, o app segue). Isso é
diferente do Go, que tratava o 404 como erro — foi exatamente o que derrubou o
domain-worker na migração (ver commit 2a9c252).
"""

from __future__ import annotations

import os
from typing import Callable, Mapping

import httpx


def _fetch_from_bridge(base_url: str, api_key: str, name: str, *, timeout_s: float = 10.0) -> str:
    resp = httpx.get(
        f"{base_url.rstrip('/')}/secret/{name}",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=timeout_s,
    )
    if resp.status_code == 404:
        return ""  # não está no cofre: não é erro, é ausência
    if resp.status_code != 200:
        raise RuntimeError(f"secrets bridge respondeu {resp.status_code} para {name}")
    body = resp.json()
    value = body.get("value", "") if isinstance(body, Mapping) else ""
    return str(value)


def resolver(env: Mapping[str, str] | None = None) -> Callable[[str], str]:
    """Devolve ``resolve(name) -> valor``.

    Com a ponte configurada, tenta o cofre; se o cofre não tem o item, cai no
    ambiente. Sem a ponte, lê direto do ambiente. Nunca levanta por um item
    ausente — ausência é vazio.
    """
    source = os.environ if env is None else env
    base_url = (source.get("SECRETS_BRIDGE_URL") or "").strip()
    api_key = (source.get("SECRETS_BRIDGE_API_KEY") or "").strip()
    use_bridge = bool(base_url and api_key)

    def resolve(name: str) -> str:
        if use_bridge:
            try:
                from_bridge = _fetch_from_bridge(base_url, api_key, name)
                if from_bridge:
                    return from_bridge
            except Exception:  # noqa: BLE001 -- ponte fora do ar não derruba o boot
                # Cai no ambiente: um cofre indisponível não pode impedir o
                # serviço de subir com o que já tem no env.
                pass
        return (source.get(name) or "").strip()

    return resolve
