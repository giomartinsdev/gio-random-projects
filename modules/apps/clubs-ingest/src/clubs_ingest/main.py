"""Entry point: env wire-up + the loop.

Writes go through domain-api (see client.py). Polls every
CLUBS_INGEST_POLL_SECONDS, with per-kind TTLs inside the cycle so a match
refresh (5–15 min) does not drag the hourly squad/overall fetches along.

Boots to a hard failure on a missing required env: a worker that cannot reach
domain-api is worse than a red deploy, because it would silently accumulate
nothing.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time

from .client import DomainClient
from .cycle import Ingest, IngestConfig
from .source import from_env as source_from_env
from .sync import Sync

REQUIRED = ("CLUBS_INGEST_DOMAIN_API_URL", "CLUBS_INGEST_DOMAIN_API_KEY")

log = logging.getLogger("clubs-ingest")


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("CLUBS_INGEST_LOG_LEVEL", "INFO").upper(),
        format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
        stream=sys.stdout,
    )


def main() -> int:
    _configure_logging()

    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        # Refuse to boot: a worker with no persistence accumulates nothing.
        raise SystemExit(f"missing required env: {', '.join(missing)}")

    domain = DomainClient(
        os.environ["CLUBS_INGEST_DOMAIN_API_URL"],
        os.environ["CLUBS_INGEST_DOMAIN_API_KEY"],
        timeout=int(os.environ.get("CLUBS_INGEST_TIMEOUT", "20")),
    )
    source = source_from_env()

    cfg = IngestConfig(
        ttl_matches=int(os.environ.get("CLUBS_INGEST_TTL_MATCHES", "300")),
        ttl_squad=int(os.environ.get("CLUBS_INGEST_TTL_SQUAD", "3600")),
        max_matches=int(os.environ.get("CLUBS_INGEST_MAX_MATCHES", "10")),
    )
    poll_seconds = int(os.environ.get("CLUBS_INGEST_POLL_SECONDS", "900"))

    ingest = Ingest(source, domain, cfg)
    sync = Sync(source, domain, ingest)

    stop = {"now": False}

    def _handle(signum, _frame):  # noqa: ANN001
        log.info("recebido sinal %s; encerrando após o ciclo", signum)
        stop["now"] = True

    signal.signal(signal.SIGINT, _handle)
    signal.signal(signal.SIGTERM, _handle)

    log.info("clubs-ingest iniciado (poll=%ss, ttl_matches=%ss, ttl_squad=%ss)",
             poll_seconds, cfg.ttl_matches, cfg.ttl_squad)

    while not stop["now"]:
        try:
            ingest.run_cycle()
        except Exception as err:  # noqa: BLE001 -- a whole-cycle failure must not kill the loop
            # The in-memory source client is deliberately kept alive across
            # failures: its CDN challenge token has to survive, which is why
            # this is a loop and not a one-shot job.
            log.error("ciclo falhou: %s", err)
        # Sleep in short slices so a signal is honored promptly.
        for _ in range(poll_seconds):
            if stop["now"]:
                break
            time.sleep(1)

    log.info("clubs-ingest encerrado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
