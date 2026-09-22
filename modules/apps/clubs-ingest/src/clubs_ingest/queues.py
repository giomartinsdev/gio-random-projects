"""As filas interativas do worker: sync de pessoa e fetch sob demanda.

Elas têm um contrato diferente do ciclo: o ciclo é caro e roda de tempos em
tempos; estas atendem um CLIQUE. A tela de resgate precisa do elenco agora, e
a pessoa que entrou espera a sincronização começar em segundos, não em até 15
min. Este módulo existe separado do loop justamente para que esse contrato
seja testável -- o loop é um `while True` que nenhum teste alcança.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

log = logging.getLogger("clubs-ingest")


def drain_fetch_queue(domain: Any, ingest: Any) -> int:
    """Busca o elenco de cada clube que a tela de resgate pediu.

    Devolve quantos clubes foram processados. Cada clube tem seu próprio
    tratamento de erro: um clube ruim não pode impedir os outros, e a linha da
    fila é SEMPRE fechada -- inclusive no erro. Fechar é o que impede o pedido
    de voltar em todo tick e a tela ficar "buscando" para sempre.
    """
    try:
        pendentes = domain.list_pending_fetches()
    except Exception as err:  # noqa: BLE001 -- a fila indisponível não derruba o loop
        log.error("leitura da fila de fetch falhou: %s", err)
        return 0

    feitos = 0
    for pedido in pendentes:
        club_id = str(pedido.get("club_id") or "")
        if not club_id:
            continue
        log.info("fetch sob demanda: clube %s", club_id)
        try:
            jogadores, partidas = ingest.run_fetch(club_id)
            domain.save_fetch_run(club_id, rodando=False, jogadores=jogadores,
                                  partidas=partidas, concluido=True)
            feitos += 1
        except Exception as err:  # noqa: BLE001 -- um clube não derruba os outros
            log.error("fetch de %s falhou: %s", club_id, err)
            try:
                domain.save_fetch_run(club_id, rodando=False, jogadores=0,
                                      partidas=0, erro=str(err)[:300], concluido=True)
            except Exception:  # noqa: BLE001 -- registrar a falha não pode falhar
                pass
    return feitos


def drain_sync_queue(domain: Any, sync: Any) -> int:
    """Roda a sincronização de três níveis de quem pediu.

    O pedido é gravado pelo SPA em clubs_sync_runs; sem consumir esta fila o
    hub nunca sai do vazio. Como no fetch, o pedido é fechado mesmo no erro:
    um pedido permanentemente quebrado bloquearia os próximos da fila.
    """
    try:
        pendentes = domain.list_pending_syncs()
    except Exception as err:  # noqa: BLE001
        log.error("leitura da fila de sync falhou: %s", err)
        return 0

    feitos = 0
    for pedido in pendentes:
        email = pedido.get("usuario_email") or ""
        if not email:
            continue
        log.info("sincronizando clubes de %s", email)
        try:
            resultado = sync.run(email)
            log.info("sync de %s: %s", email, resultado.get("niveis", resultado))
            feitos += 1
        except Exception as err:  # noqa: BLE001 -- um pedido não derruba o loop
            log.error("sync de %s falhou: %s", email, err)
            try:
                domain.mark_sync_done(email, nivel=3, total=0, concluidos=0, novos=[])
            except Exception:  # noqa: BLE001
                pass
    return feitos
