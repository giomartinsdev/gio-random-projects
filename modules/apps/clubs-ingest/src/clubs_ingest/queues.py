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
from .source import SourceUnavailable

log = logging.getLogger("clubs-ingest")


def drain_fetch_queue(domain: Any, ingest: Any) -> int:
    """Atende os pedidos de sync sob demanda da SPA.

    O target pode ser um clube ou um jogador -- a fila é uma só, e é o campo
    `target` que diz qual. Para jogador, o trabalho é atualizar as partidas dos
    clubs onde ele jogou (a fonte não tem endpoint de jogador).

    Devolve quantos alvos foram processados. Cada um tem seu próprio
    tratamento de error: um target ruim não impede os outros.

    Duas classes de falha, e a diferença importa:

    - **fonte fora** (`SourceUnavailable`: 403, CDN, rede): a linha FICA
      PENDENTE. Fechar perderia o pedido -- a pessoa teria que clicar de novo
      depois, e a tela diria "0 players", que lê como "este clube não tem
      dados". Aberta, este mesmo loop a pega sozinho quando a fonte voltar, e
      o dado sincroniza sem ninguém pedir.
    - **permanente** (clube que não existe, payload inválido): a linha FECHA
      com erro. Se ficasse aberta, voltaria em todo tick e a SPA ficaria presa.
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
        except SourceUnavailable as err:
            # A fonte está fora, não este alvo. NÃO fechar: a linha continua
            # pendente e o próximo tick a pega sozinha quando a fonte voltar.
            # É isto que faz o dado sincronizar sem a pessoa clicar de novo.
            log.warning("fonte fora, %s %s fica pendente: %s", target, target_id, err)
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
    hub nunca sai do vazio.

    Como no fetch, a classe da falha decide o destino da linha: a fonte fora
    (`SourceUnavailable`) deixa o pedido PENDENTE -- é uma promessa de que ele
    será atendido quando ela voltar, e a sincronização sai sem novo clique. Um
    erro permanente fecha a linha, porque um pedido quebrado para sempre
    bloquearia os próximos da fila.
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
        except SourceUnavailable as err:
            log.warning("fonte fora, sync de %s fica pendente: %s", email, err)
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
    foram processados. Como no fetch, um erro permanente fecha a linha; a fonte
    fora (`SourceUnavailable`) deixa o termo PENDENTE, para a busca ser
    respondida sozinha quando ela voltar.
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
        except SourceUnavailable as err:
            log.warning("fonte fora, busca de %r fica pendente: %s", termo, err)
        except Exception as err:  # noqa: BLE001 -- um termo não derruba os outros
            log.error("busca de %r falhou: %s", termo, err)
            try:
                domain.save_search_run(termo, running=False, found=0,
                                       error=str(err)[:300], concluido=True)
            except Exception:  # noqa: BLE001 -- registrar a falha não pode falhar
                pass
    return feitos
