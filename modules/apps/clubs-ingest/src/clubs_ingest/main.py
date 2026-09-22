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
from .queues import drain_fetch_queue, drain_search_queue, drain_sync_queue
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
    # As filas interativas (sync e fetch sob demanda) têm seu próprio ritmo.
    # Esperar o ciclo inteiro (15 min) para atender um clique tornaria a tela
    # de resgate inútil -- ela precisa do elenco agora. Este tick curto é o
    # que faz "sob demanda" significar alguma coisa.
    queue_seconds = int(os.environ.get("CLUBS_INGEST_QUEUE_SECONDS", "20"))

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

    rodadas = 0
    bootstrap_feito = False

    # Próximo ciclo completo. As filas rodam a cada tick curto; o ciclo, no
    # intervalo longo (ele é caro: dezenas de consultas à fonte).
    proximo_ciclo = 0.0

    while not stop["now"]:
        # Atende os cliques primeiro, a cada tick curto: é o que faz o pedido
        # da tela de resgate virar trabalho em segundos, não em até 15 min.
        drain_sync_queue(domain, sync)
        drain_fetch_queue(domain, ingest)
        drain_search_queue(domain, source)

        if time.monotonic() >= proximo_ciclo:
            try:
                st = ingest.run_cycle()
                rodadas += 1
                if st.clubes_processados:
                    bootstrap_feito = True
                # Publica a saúde DEPOIS do ciclo: é o que o painel lê, e a única
                # janela para ver uma falha em produção sem SSH.
                domain.save_ingest_estado(
                    rodadas=rodadas,
                    clubes_ok=st.clubes_processados,
                    clubes_falhos=st.clubes_falhos,
                    partidas_novas=st.partidas_novas,
                    snapshots=st.snapshots,
                    bootstrap_feito=bootstrap_feito,
                    ultimo_erro="; ".join(st.falhas[:3]),
                )
            except Exception as err:  # noqa: BLE001 -- a whole-cycle failure must not kill the loop
                # The in-memory source client is deliberately kept alive across
                # failures: its CDN challenge token has to survive, which is why
                # this is a loop and not a one-shot job.
                log.error("ciclo falhou: %s", err)
                rodadas += 1
                try:
                    domain.save_ingest_estado(
                        rodadas=rodadas, clubes_ok=0, clubes_falhos=0,
                        partidas_novas=0, snapshots=0, bootstrap_feito=bootstrap_feito,
                        ultimo_erro=str(err)[:400],
                    )
                except Exception:  # noqa: BLE001 -- registrar a falha não pode falhar
                    pass
            proximo_ciclo = time.monotonic() + poll_seconds

        # Tick curto: o sinal é honrado em segundos e as filas são atendidas
        # sem esperar o ciclo.
        for _ in range(queue_seconds):
            if stop["now"]:
                break
            time.sleep(1)

    log.info("clubs-ingest encerrado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
