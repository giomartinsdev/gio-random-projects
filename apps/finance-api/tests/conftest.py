"""Test fixtures.

The whole suite runs with **no** domain-api, no Postgres and no broker: the
outbound edge is an ``httpx.Client`` bound to an ``httpx.MockTransport``, so
what is exercised is the real client code (status translation, body parsing)
against a scripted server.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

pytest_plugins = ["pytest_bdd"]


def pytest_bdd_apply_tag(tag, function):
    # Tags desconhecidas não impedem a coleta (mesma escolha do clubs-ingest).
    return None


def pytest_configure(config):
    # Os `.feature` de tests/features são o contrato; os steps em tests/steps
    # a implementação. Terminologia em português (Funcionalidade/Cenário).
    config.addinivalue_line("markers", "bdd: cenário Gherkin")

# The key the tests present to finance-api, and the key finance-api presents
# to domain-api. Kept obviously fake so a leak in a failure message is inert.
CALLER_KEY = "test-caller-key"
CALLER_LABEL = "worker"
DOMAIN_KEY = "test-domain-key"
BASE_URL = "http://domain-api.test"
