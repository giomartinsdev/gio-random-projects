"""Fixtures dos testes de integração (BDD) do clubs-ingest.

Sobe um container real com o domínio-api de mentira e aponta o `DomainClient` do
worker para ele. Sem Docker, os cenários que precisam de container se pulam --
o resto da suíte unitária segue rodando.

Também pluga o pytest-bdd: os `.feature` de tests/features são o contrato, e os
steps em tests/steps a implementação. `gherkin_terminology` fica no português do
produto (Funcionalidade/Cenário/Dado/Quando/Então).
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

pytest_plugins = ["pytest_bdd"]


def pytest_bdd_apply_tag(tag, function):
    # Tags desconhecidas não impedem a coleta.
    return None


def _docker_available() -> bool:
    try:
        import docker  # noqa: F401
    except Exception:
        return False
    try:
        import docker

        docker.from_env().ping()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def domain_stub():
    """Container com o domain-api de mentira; devolve a base_url dele."""
    if not _docker_available():
        pytest.skip("Docker indisponível; pulando teste de integração com container")

    from testcontainers.core.container import DockerContainer

    container = (
        DockerContainer("python:3.12-alpine")
        .with_command("python /app/domain_stub.py")
        .with_volume_mapping(str(FIXTURES), "/app", mode="ro")
        .with_exposed_ports(8080)
    )
    container.start()
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(8080)
        base = f"http://{host}:{port}"
        # Espera o servidor aceitar conexão (não há log de boot para aguardar).
        import time

        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/__state", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        yield base
    finally:
        container.stop()


@pytest.fixture
def stub_state(domain_stub):
    """Reseta e devolve um controlador do estado do stub."""

    def _set(**kwargs):
        req = urllib.request.Request(
            domain_stub + "/__state",
            data=json.dumps(kwargs).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req)

    def _get() -> dict:
        with urllib.request.urlopen(domain_stub + "/__state") as r:
            return json.loads(r.read())

    _set(pendentes=[], saved=[], ingest=[], syncs=[])
    return {"set": _set, "get": _get}


@pytest.fixture
def domain_client(domain_stub):
    """Um DomainClient REAL apontando para o container."""
    from clubs_ingest.client import DomainClient

    return DomainClient(domain_stub, "chave-de-teste", timeout=5)


def pytest_configure(config):
    # Registra o plugin do BDD e o diretório de features.
    config.addinivalue_line("markers", "bdd: cenário Gherkin")
