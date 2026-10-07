"""Bootstrap do worker: o gate de env obrigatórias (§contrato).

Um worker que sobe sem broker/9router/Evolution/prospecta-api é pior que um
deploy vermelho -- ele consome a fila e não entrega nada. O ``main`` falha
(``SystemExit``) listando o que falta; com o ambiente completo, monta o núcleo.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from prospecta_agent_worker import main as main_mod


def test_main_falha_sem_env_obrigatoria(monkeypatch):
    for key in main_mod.REQUIRED:
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(SystemExit) as exc:
        main_mod.main()
    assert "missing required env" in str(exc.value)


def test_main_lista_o_que_falta(monkeypatch):
    for key in main_mod.REQUIRED:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("RABBITMQ_URL", "amqp://x")
    with pytest.raises(SystemExit) as exc:
        main_mod.main()
    msg = str(exc.value)
    assert "EVOLUTION_API_URL" in msg and "NINEROUTER_BASE_URL" in msg


def test_build_worker_monta_o_nucleo(monkeypatch):
    for key in main_mod.REQUIRED:
        monkeypatch.setenv(key, "http://example")
    monkeypatch.setenv("RABBITMQ_URL", "amqp://guest:guest@localhost/")
    worker = main_mod.build_worker()
    assert worker is not None
