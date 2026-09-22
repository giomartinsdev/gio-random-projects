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

    rodadas = 0
    bootstrap_feito = False

    while not stop["now"]:
        # Sincronização primeiro: um pedido gravado pelo SPA (clubs_sync_runs
        # com rodando=true) é a única forma de um clube entrar na lista de
        # acompanhados. Sem consumir esta fila, o hub nunca sai do vazio -- e o
        # `sync` era instanciado aqui em cima e nunca usado.
        try:
            pendentes = domain.list_pending_syncs()
            for pedido in pendentes:
                email = pedido.get("usuario_email") or ""
                if not email:
                    continue
                log.info("sincronizando clubes de %s", email)
                try:
                    resultado = sync.run(email)
                    log.info("sync de %s: %s", email, resultado.get("niveis", resultado))
                except Exception as err:  # noqa: BLE001 -- um pedido não derruba o loop
                    log.error("sync de %s falhou: %s", email, err)
                    # Fecha o pedido mesmo assim: um erro permanente repetiria
                    # em todo ciclo e bloquearia os próximos da fila.
                    try:
                        domain.mark_sync_done(email, nivel=3, total=0, concluidos=0, novos=[])
                    except Exception:  # noqa: BLE001
                        pass
        except Exception as err:  # noqa: BLE001
            log.error("leitura da fila de sync falhou: %s", err)

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
        # Sleep in short slices so a signal is honored promptly.
        for _ in range(poll_seconds):
            if stop["now"]:
                break
            time.sleep(1)

    log.info("clubs-ingest encerrado")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
