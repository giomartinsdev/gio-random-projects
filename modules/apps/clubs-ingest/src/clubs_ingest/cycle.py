"""The ingest cycle: read what we track, fetch only what has expired, write it
back through domain-api, and keep going when one club fails.

Every club is processed inside its own error boundary. A club whose payload
changed shape fails alone and is logged with its id; the cycle continues. A
whole-network failure ends the cycle but leaves the in-memory source client
alive (its CDN challenge token must survive between cycles -- that is exactly
why this is a loop in one process and not a cron job).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from .client import DomainClient, DomainError, DomainQueued
from .normalize import (
    club_identity,
    club_totals,
    match_payload,
    merge_club_sources,
    opponent_club,
    snapshot,
)
from .source import SourceClient

log = logging.getLogger("clubs-ingest")


@dataclass
class CycleStats:
    clubes_processados: int = 0
    clubes_falhos: int = 0
    partidas_novas: int = 0
    partidas_atualizadas: int = 0
    snapshots: int = 0
    anuncios: int = 0
    falhas: list[str] = field(default_factory=list)


@dataclass
class IngestConfig:
    ttl_matches: int = 300
    ttl_squad: int = 3600
    max_matches: int = 10


class Ingest:
    """Owns the per-club TTL bookkeeping across cycles."""

    def __init__(self, source: SourceClient, domain: DomainClient, cfg: IngestConfig) -> None:
        self.source = source
        self.domain = domain
        self.cfg = cfg
        self._last_match_fetch: dict[str, float] = {}
        self._last_squad_fetch: dict[str, float] = {}
        self._known_clubs: set[str] = set()

    def run_cycle(self) -> CycleStats:
        stats = CycleStats()
        clubs = self.domain.list_clubs(only_followed=True)
        if not clubs:
            # Base vazia: o hub se semeia sozinho. Sem isto o produto nunca sai
            # do zero, porque todo clube entra por um pedido de sincronização
            # que ainda não existe -- é um ovo e a galinha.
            #
            # A lista é fixa de propósito: a fonte não tem "liste todos os
            # clubes", só busca por nome. Ampliar depois é só crescer a lista.
            self._bootstrap(stats)
            clubs = self.domain.list_clubs(only_followed=True)
            if not clubs:
                log.warning("bootstrap não encontrou nenhum clube; a base segue vazia")
                return stats

        now = datetime.now(tz=UTC).timestamp()
        for club in clubs:
            club_id = str(club.get("club_id") or "")
            if not club_id:
                continue
            try:
                self._process_club(club_id, now, stats, str(club.get("nome") or ""))
            except Exception as err:  # noqa: BLE001 -- one club must not stop the cycle
                stats.clubes_falhos += 1
                stats.falhas.append(f"{club_id}: {err}")
                # Com traceback: sem ele, "falha ao processar clube X: 'NoneType'
                # object has no attribute 'get'" não diz ONDE -- e diagnosticar
                # vira adivinhação. O tipo sozinho não basta para um erro que
                # depende do formato que a fonte mandou naquela partida.
                log.warning("falha ao processar clube %s: %s", club_id, err, exc_info=True)
        log.info(
            "ciclo: %d clubes, %d falhas, %d partidas, %d snapshots",
            stats.clubes_processados, stats.clubes_falhos, stats.partidas_novas, stats.snapshots,
        )
        return stats

    def run_fetch(self, club_id: str) -> tuple[int, int]:
        """Busca o elenco e as partidas de UM clube, sob demanda.

        É o que a tela de resgate precisa: ela não pode esperar o ciclo (até
        15 min) para mostrar o elenco de onde escolher o pro. O clube é marcado
        como acompanhado, então o ciclo seguinte continua cuidando dele -- o
        fetch sob demanda não substitui o poller, só o antecipa.

        Devolve (jogadores, partidas). Erros da fonte sobem como exceção: quem
        chamou (o loop) registra a falha na linha da fila, onde a tela a lê.
        """
        info = self.source.club_info(club_id)
        if info:
            identity = club_identity(info)
            if identity["club_id"]:
                identity["acompanhado"] = True
                self.domain.upsert_club(identity)

        overall = self.source.club_overall(club_id)
        # Mesma fusão do ciclo: o overall sozinho não traz divisão. O nome sai
        # do próprio club_info, que acabou de ser buscado -- é o que a busca
        # exige.
        nome = str((info or {}).get("name") or "")
        totals_row = merge_club_sources(overall, self._search_row(club_id, nome))
        if totals_row:
            self.domain.upsert_totals(club_id, club_totals(totals_row))

        stats = CycleStats()
        players, matches = self._ingest_matches(club_id, stats)
        # `matches` é o total PROCESSADO (novas + atualizadas), não só as novas:
        # a tela mostra "trouxe N partidas" e um clube já conhecido retornaria
        # 0 se contássemos apenas as novas -- dizendo "nada" depois de buscar 10.
        return players, matches

    # Quantos clubes o bootstrap acompanha. O leaderboard traz 100; acompanhar
    # todos de uma vez significaria 100 consultas de partidas no primeiro ciclo,
    # o que é a via mais rápida para o CDN da fonte bloquear o worker. Vinte dá
    # um hub com conteúdo de verdade e mantém a carga por ciclo civilizada --
    # os rivais de cada um entram sozinhos depois, pelo crawl de adversários.
    BOOTSTRAP_LIMIT = 20

    def _bootstrap(self, stats: CycleStats) -> None:
        """Semeia a base com clubes reais, para o hub ter por onde começar.

        Usa ``allTimeLeaderboard``, o único endpoint que devolve uma lista de
        clubes sem exigir um nome -- a busca só responde a partir de 1 caractere
        e mistura clubes de qualquer relevância. Cada clube entra já
        acompanhado, então o ciclo seguinte traz elenco, partidas e nível.
        """
        log.info("base vazia: semeando clubes iniciais pelo leaderboard")
        rows = self.source.leaderboard()
        if not rows:
            return
        # O leaderboard já vem ordenado por rank, então os primeiros são os
        # clubes mais ativos -- exatamente o que dá conteúdo a um hub novo.
        for row in rows[: self.BOOTSTRAP_LIMIT]:
            club_id = str(row.get("clubId") or "")
            if not club_id or club_id in self._known_clubs:
                continue
            self._known_clubs.add(club_id)
            try:
                identity = club_identity({**row, "clubId": club_id})
                identity["acompanhado"] = True
                self.domain.upsert_club(identity)
                self.domain.upsert_totals(club_id, club_totals(row))
                stats.clubes_processados += 1
            except Exception as err:  # noqa: BLE001 -- um clube não impede os outros
                log.debug("bootstrap de %s falhou: %s", club_id, err)

    def _process_club(self, club_id: str, now: float, stats: CycleStats, nome: str = "") -> None:
        # Identity + totals: cheap, and needed before matches so the club row
        # exists. Structural, so it travels the sync path.
        info = self.source.club_info(club_id)
        if info:
            identity = club_identity(info)
            if identity["club_id"]:
                self.domain.upsert_club(identity)

        overall = self.source.club_overall(club_id)
        # A divisão (e os clean sheets) NÃO vêm do overallStats -- vêm da
        # busca/leaderboard. Usar só o overall fazia todo clube virar "D0" e
        # nenhuma mudança de divisão ser detectada.
        busca = self._search_row(club_id, nome)
        totals_row = merge_club_sources(overall, busca)
        team_size = 0
        if totals_row:
            self.domain.upsert_totals(club_id, club_totals(totals_row))

        # Squad size, derived from the members endpoint (used only for the
        # snapshot's squad-change signal).
        if self._expired(self._last_squad_fetch, club_id, now, self.cfg.ttl_squad):
            members = self.source.club_members(club_id)
            team_size = len(members)
            self._last_squad_fetch[club_id] = now

        # Matches: the expensive one, on its own shorter TTL.
        if self._expired(self._last_match_fetch, club_id, now, self.cfg.ttl_matches):
            self._ingest_matches(club_id, stats)
            self._last_match_fetch[club_id] = now

        # Snapshot last, so it reflects the totals we just wrote.
        if totals_row:
            snap = snapshot(totals_row, team_size)
            try:
                self.domain.append_snapshot(club_id, snap)
                stats.snapshots += 1
            except Exception as err:  # noqa: BLE001 -- a snapshot is not worth failing a club
                log.debug("snapshot falhou para %s: %s", club_id, err)

        stats.clubes_processados += 1

    def _search_row(self, club_id: str, name: str = "") -> dict:
        """A linha da busca/leaderboard para este clube, ou {}.

        É a única fonte que traz divisão. A busca exige um NOME -- passar o id
        devolvia vazio em silêncio, que foi o bug que manteve todo clube em D0
        mesmo depois de corrigir a fusão das fontes.
        """
        try:
            for row in self.source.search_by_id(club_id, name):
                if str(row.get("clubId")) == str(club_id):
                    return row
        except Exception as err:  # noqa: BLE001 -- best-effort; o overall ainda vai
            log.debug("busca de %s falhou: %s", club_id, err)
        return {}

    def _ingest_matches(self, club_id: str, stats: CycleStats) -> tuple[int, int]:
        """Grava as partidas do clube e devolve (jogadores, partidas).

        `jogadores` é quantos jogadores DISTINTOS do clube apareceram nas
        partidas -- é o tamanho do elenco que a API vai montar, derivado das
        linhas de partida porque a fonte não tem um endpoint de elenco que
        sobreviva à temporada. `partidas` é o total processado (novas e
        atualizadas), que é o número que a tela mostra.
        """
        players: set[str] = set()
        processadas = 0
        for match in self.source.club_matches(club_id, self.cfg.max_matches):
            payload = match_payload(match, club_id)
            if not payload or not payload["match_id"]:
                continue
            # Só o nosso lado: o payload traz os jogadores dos DOIS clubes, e o
            # elenco que a tela mostra é o deste clube.
            for line in payload.get("jogadores") or []:
                if str(line.get("club_id")) != str(club_id):
                    continue
                pid = str(line.get("player_id") or "")
                if pid:
                    players.add(pid)
            try:
                self.domain.upsert_match(club_id, payload)
            except DomainQueued:
                log.debug("partida %s ficou na fila", payload["match_id"])
                continue
            except DomainError as err:
                # The worker refused it -- permanent, so log and move on.
                log.warning("partida %s recusada: %s", payload["match_id"], err)
                continue

            processadas += 1
            fresh = payload["match_id"] not in self._known_clubs
            if fresh:
                self._known_clubs.add(payload["match_id"])
                stats.partidas_novas += 1
                self._announce_result(club_id, payload, stats)
            else:
                stats.partidas_atualizadas += 1

            # Discovery: every opponent we have never seen is a candidate for
            # the "clubes de clubes" crawl. Registered as a known-but-not-yet
            # followed club so the sync can pick it up.
            opp = opponent_club(match, club_id)
            if opp:
                self._ensure_known(opp[0], opp[1])
        return len(players), processadas

    def _ensure_known(self, club_id: str, name: str = "") -> None:
        """Register a club we have only seen as an opponent, with its totals.

        This is what makes the three-level sync possible: an opponent's club
        row has to exist before it can be followed, and its all-time totals are
        the only thing available until the cycle reaches it.

        O nome vem do payload da partida e é obrigatório na prática: a busca da
        fonte só aceita nome, e sem ele a descoberta voltava vazia em silêncio.
        """
        if club_id in self._known_clubs:
            return
        self._known_clubs.add(club_id)
        try:
            results = self.source.search_by_id(club_id, name)
            for row in results:
                if str(row.get("clubId")) == club_id:
                    self.domain.upsert_totals(club_id, club_totals(row))
                    break
        except Exception as err:  # noqa: BLE001 -- discovery is best-effort
            log.debug("descoberta de %s falhou: %s", club_id, err)

    def _announce_result(self, club_id: str, payload: dict, stats: CycleStats) -> None:
        """Derive an announcement from a result we just wrote."""
        try:
            our = payload["gols_casa"]
            theirs = payload["gols_fora"]
            result = payload["resultado_casa"]
            if result == "vitoria":
                titulo = f"Vitória por {our}–{theirs}"
            elif result == "derrota":
                titulo = f"Derrota por {our}–{theirs}"
            else:
                titulo = f"Empate em {our}–{theirs}"
            self.domain.create_announcement({
                "tipo": "resultado",
                "titulo": titulo,
                "texto": f"Partida de {payload['tipo']} registrada pelo hub.",
                "referencia_id": payload["match_id"],
                "icone": "🏟️",
                # Result announcements are the most perishable item in the
                # feed -- a week is plenty.
                "expira_em_horas": 24 * 7,
            })
            stats.anuncios += 1
        except Exception as err:  # noqa: BLE001
            log.debug("anúncio falhou para %s: %s", club_id, err)

    @staticmethod
    def _expired(store: dict[str, float], club_id: str, now: float, ttl: int) -> bool:
        last = store.get(club_id, 0.0)
        return (now - last) >= ttl
