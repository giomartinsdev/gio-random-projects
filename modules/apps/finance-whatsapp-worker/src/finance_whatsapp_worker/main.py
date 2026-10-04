"""Entrypoint: ``python -m finance_whatsapp_worker.main``.

Lê a configuração uma vez e valida o obrigatório antes de subir: um worker que
sobe sem conseguir falar nem com a finance-api nem com a Evolution é pior que
um deploy vermelho — ele consome a fila e não entrega nada.
"""

from __future__ import annotations

import logging
import os
import sys

from finance_whatsapp_worker.clients.finance_api import FinanceApiClient
from finance_whatsapp_worker.consumers.evolution import consume_forever
from finance_whatsapp_worker.gateway.evolution import EvolutionClient
from finance_whatsapp_worker.worker import Worker

REQUIRED = (
    "FINANCE_API_BASE_URL",
    "FINANCE_API_KEY",
    "RABBITMQ_URL",
    "EVOLUTION_API_URL",
    "EVOLUTION_API_KEY",
)


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("FINANCE_WORKER_LOG_LEVEL", "INFO").upper(),
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


def main() -> int:
    _configure_logging()

    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing required env: {', '.join(missing)}")

    worker = Worker(
        finance=FinanceApiClient(
            os.environ["FINANCE_API_BASE_URL"],
            os.environ["FINANCE_API_KEY"],
            timeout=float(os.environ.get("FINANCE_API_TIMEOUT_S", "15")),
        ),
        evolution=EvolutionClient(
            os.environ["EVOLUTION_API_URL"],
            os.environ["EVOLUTION_API_KEY"],
            os.environ.get("EVOLUTION_INSTANCE", "web-businesses"),
            timeout=float(os.environ.get("EVOLUTION_TIMEOUT_S", "15")),
        ),
    )

    logging.getLogger("finance-whatsapp-worker").info(
        "worker iniciado; instância %s", os.environ.get("EVOLUTION_INSTANCE", "web-businesses")
    )
    consume_forever(os.environ["RABBITMQ_URL"], worker)
    return 0


if __name__ == "__main__":
    sys.exit(main())
