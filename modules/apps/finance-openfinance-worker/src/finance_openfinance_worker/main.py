"""Entrypoint do conector de Open Finance (``python -m finance_openfinance_worker.main``).

Lê a config uma vez, valida o obrigatório e roda o loop de sync. Sem credenciais
do Polp ele **não** sobe (SystemExit): um conector que sobe sem conseguir falar
com o provedor é pior que um deploy vermelho — ele fica ocioso e parece vivo.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time

from finance_openfinance_worker.api import FinanceApiClient
from finance_openfinance_worker.polp.client import PolpClient
from finance_openfinance_worker.sync.runner import Syncer

REQUIRED = (
    "FINANCE_API_BASE_URL",
    "FINANCE_API_KEY",
    "POLP_OF_CLIENT_ID",
    "POLP_OF_CLIENT_SECRET",
)


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


def build_syncer() -> tuple[Syncer, float]:
    polp = PolpClient(
        os.environ["POLP_OF_CLIENT_ID"],
        os.environ["POLP_OF_CLIENT_SECRET"],
        base_url=os.environ.get("POLP_API_BASE_URL", "").strip() or "https://api.polp.com.br/api/v2",
        sandbox=os.environ.get("POLP_OF_SANDBOX", "").strip().lower() in ("1", "true", "yes"),
    )
    finance = FinanceApiClient(
        os.environ["FINANCE_API_BASE_URL"],
        os.environ["FINANCE_API_KEY"],
        timeout_s=float(os.environ.get("FINANCE_API_TIMEOUT_S", "15")),
    )
    poll = float(os.environ.get("OF_POLL_SECONDS", "600"))
    backfill = int(os.environ.get("OF_BACKFILL_DAYS", "30"))
    return Syncer(polp=polp, finance=finance, backfill_days=backfill), poll


def main() -> int:
    _configure_logging()
    log = logging.getLogger("finance-openfinance-worker")
    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        # Sem as credenciais o conector fica fora — mas com exit 0, para o
        # `restart: unless-stopped` NÃO entrar em loop (um exit não-zero o
        # reiniciaria para sempre). A ausência é declarada, não um crash.
        log.warning("Open Finance desligado: faltam %s; saindo sem erro", ", ".join(missing))
        return 0

    syncer, poll = build_syncer()
    log.info("conector iniciado; poll a cada %.0fs", poll)

    running = True

    def _stop(*_: object) -> None:
        nonlocal running
        running = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    while running:
        try:
            counts = syncer.run_once()
            log.info("sync ok: %s", counts)
        except Exception as exc:  # noqa: BLE001 -- o loop nunca morre por uma passada
            log.error("sync falhou: %s", exc)
        # Dorme em fatias curtas para reagir ao shutdown.
        for _ in range(int(poll)):
            if not running:
                break
            time.sleep(1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
