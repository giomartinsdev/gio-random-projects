"""As filas interativas do worker: sync de pessoa e fetch sob demanda.

Elas têm um contrato diferente do ciclo: o ciclo é caro e roda de tempos em
tempos; estas atendem um CLIQUE. A tela de resgate precisa do elenco agora, e
a pessoa que entrou espera a sincronização começar em segundos, não em até 15
min. Este módulo existe separado do loop justamente para que esse contrato
seja testável -- o loop é um `while True` que nenhum teste alcança.
"""

from __future__ import annotations

import logging
from typing import Any

from .normalize import club_identity, club_totals

log = logging.getLogger("clubs-ingest")


def drain_fetch_queue(domain: Any, ingest: Any) -> int:
    """Atende os pedidos de sync sob demanda da SPA.

    O target pode ser um clube ou um jogador -- a fila é uma só, e é o campo
    `target` que diz qual. Para jogador, o trabalho é atualizar as partidas dos
    clubs onde ele jogou (a fonte não tem endpoint de jogador).

    Devolve quantos alvos foram processados. Cada um tem seu próprio
    tratamento de error: um target ruim não impede os outros, e a linha da fila é
    SEMPRE fechada -- inclusive no error. Fechar é o que impede o pedido de
    voltar em todo tick e a tela ficar "buscando" para sempre.
    """
    try:
        pendentes = domain.list_pending_fetches()
    except Exception as err:  # noqa: BLE001 -- a fila indisponível não derruba o loop
        log.error("leitura da fila de sync falhou: %s", err)
        return 0

    feitos = 0
    for pedido in pendentes:
        target = str(pedido.get("target") or "clube")
        target_id = str(pedido.get("target_id") or "")
        if not target_id:
            continue
        log.info("sync sob demanda: %s %s", target, target_id)
        try:
            if target == "jogador":
                clubs, players, matches = ingest.run_fetch_jogador(target_id)
                domain.save_fetch_run(target, target_id, running=False, players=players,
                                      matches=matches, clubs=clubs, concluido=True)
            else:
                players, matches = ingest.run_fetch(target_id)
                domain.save_fetch_run(target, target_id, running=False, players=players,
                                      matches=matches, concluido=True)
            feitos += 1
        except Exception as err:  # noqa: BLE001 -- um alvo não derruba os outros
            log.error("sync de %s %s falhou: %s", target, target_id, err)
            try:
                domain.save_fetch_run(target, target_id, running=False, players=0,
                                      matches=0, error=str(err)[:300], concluido=True)
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
        email = pedido.get("user_email") or ""
        if not email:
            continue
        log.info("sincronizando clubs de %s", email)
        try:
            resultado = sync.run(email)
            log.info("sync de %s: %s", email, resultado.get("niveis", resultado))
            feitos += 1
        except Exception as err:  # noqa: BLE001 -- um pedido não derruba o loop
            log.error("sync de %s falhou: %s", email, err)
            try:
                domain.mark_sync_done(email, skill_rating=3, total=0, completed=0, new_items=[])
            except Exception:  # noqa: BLE001
                pass
    return feitos


def drain_search_queue(domain: Any, source: Any) -> int:
    """Busca um termo NA FONTE e grava os clubes encontrados na base.

    É a saída para um clube que o hub ainda não viu: a busca do diretório é
    local, então sem isto quem chega novo procuraria pelo próprio clube e não
    acharia -- sem ter como saber que ele simplesmente não está na base ainda.

    Grava cada clube encontrado com `acompanhado=false` (o resgate é que decide
    acompanhar), para o diretório passar a conhecê-lo. Devolve quantos termos
    foram processados. Como no fetch, a linha da fila é fechada SEMPRE --
    inclusive no erro, senão o pedido volta em todo tick e a SPA fica presa.
    """
    try:
        pendentes = domain.list_pending_searches()
    except Exception as err:  # noqa: BLE001 -- a fila indisponível não derruba o loop
        log.error("leitura da fila de busca falhou: %s", err)
        return 0

    feitos = 0
    for pedido in pendentes:
        termo = str(pedido.get("termo") or "")
        if not termo:
            continue
        log.info("busca ao alive: %r", termo)
        try:
            found = 0
            for row in source.search(termo):
                club_id = str(row.get("clubId") or "")
                if not club_id:
                    continue
                identity = club_identity(row)
                if not identity.get("club_id"):
                    continue
                # NÃO acompanhado: a busca só apresenta candidatos. Acompanhar
                # é decisão do resgate, não efeito colateral de digitar.
                identity["tracked"] = False
                domain.upsert_club(identity)
                domain.upsert_totals(club_id, club_totals(row))
                found += 1
            domain.save_search_run(termo, running=False, found=found, concluido=True)
            feitos += 1
        except Exception as err:  # noqa: BLE001 -- um termo não derruba os outros
            log.error("busca de %r falhou: %s", termo, err)
            try:
                domain.save_search_run(termo, running=False, found=0,
                                       error=str(err)[:300], concluido=True)
            except Exception:  # noqa: BLE001 -- registrar a falha não pode falhar
                pass
    return feitos
