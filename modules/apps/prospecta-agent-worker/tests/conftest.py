"""Fixtures dos testes do prospecta-agent-worker.

Sobe UM container com os três stubs HTTP (Evolution + 9router + prospecta-api)
e aponta o worker para ele. O broker é um RabbitMQ real (`rabbitmq:3-alpine`) —
o worker consome uma fila de verdade, e o teste publica nela como a Evolution
faria.

Sem Docker, os cenários de integração se pulam (o resto da suíte segue rodando).
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
TESTS = Path(__file__).resolve().parent
for _p in (str(SRC), str(TESTS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

pytest_plugins = ["pytest_bdd"]


def pytest_bdd_apply_tag(tag, function):
    return None


def pytest_configure(config):
    config.addinivalue_line("markers", "bdd: cenário Gherkin")


def _docker_available() -> bool:
    try:
        import docker

        docker.from_env().ping()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def stub_container():
    """Container com os stubs (Evolution + 9router + prospecta-api + tools + SMTP)."""
    if not _docker_available():
        pytest.skip("Docker indisponível; pulando teste de integração com container")

    from testcontainers.core.container import DockerContainer

    container = (
        DockerContainer("python:3.12-alpine")
        .with_command("python /app/stubs.py")
        .with_volume_mapping(str(FIXTURES), "/app", mode="ro")
        .with_exposed_ports(8080, 2525)
    )
    container.start()
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(8080)
        base = f"http://{host}:{port}"
        for _ in range(50):
            try:
                urllib.request.urlopen(base + "/__state", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        yield container, base
    finally:
        container.stop()


@pytest.fixture(scope="session")
def stub_base(stub_container):
    """A base_url do container de stubs HTTP. Devolve, ex.: ``http://host:port``."""
    return stub_container[1]


@pytest.fixture(scope="session")
def stub_smtp(stub_container):
    """O endereço ``host:port`` do SMTP real do container de stubs."""
    container, _ = stub_container
    host = container.get_container_host_ip()
    port = container.get_exposed_port(2525)
    return f"{host}:{port}"


@pytest.fixture
def stubs(stub_base):
    """Controla o roteiro e lê o que chegou nos stubs."""

    def _set(**kwargs):
        req = urllib.request.Request(
            stub_base + "/__state",
            data=json.dumps(kwargs).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req)

    def _get() -> dict:
        with urllib.request.urlopen(stub_base + "/__state") as r:
            return json.loads(r.read())

    _set(
        gateway_fail=False,
        sends=[],
        medias=[],
        optouts=[],
        leads={},
        ninerouter={"status": 200, "fail_times": 0, "calls": [], "contents": []},
        emails=[],
        search={"status": 200, "results": [], "calls": []},
        scrape={"html": "<html><head><title>Página</title></head><body>texto</body></html>", "robots": "", "company_html": "<html><head><title>Empresa</title></head><body>sem dados</body></html>", "company_status": 200, "calls": []},
        enrich={"status": 200, "company": {}, "calls": []},
        cnpj={"status": 200, "company": {}, "calls": []},
        runs=[],
        run_updates=[],
        campaigns={},
        lead_details={},
        messages={},
        lead_upserts=[],
        qualify_calls=[],
        message_upserts=[],
        campaign_reads=[],
        lead_reads=[],
        message_reads=[],
        optout_reads=[],
        lead_lookups=[],
    )
    return {"set": _set, "get": _get, "base": stub_base}


@pytest.fixture(scope="session")
def rabbit_url():
    """Um RabbitMQ real para o worker consumir. Devolve a URL amqp://."""
    if not _docker_available():
        pytest.skip("Docker indisponível; pulando teste de integração com container")

    from testcontainers.core.container import DockerContainer
    from testcontainers.core.waiting_utils import wait_for_logs

    container = (
        DockerContainer("rabbitmq:3-alpine")
        .with_exposed_ports(5672)
        .with_env("RABBITMQ_DEFAULT_USER", "domain")
        .with_env("RABBITMQ_DEFAULT_PASS", "domain")
    )
    container.start()
    try:
        wait_for_logs(container, "Server startup complete", timeout=60)
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5672)
        yield f"amqp://domain:domain@{host}:{port}/"
    finally:
        container.stop()
