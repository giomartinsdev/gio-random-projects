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
    opponent_club_id,
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
            log.info("nenhum clube acompanhado ainda; ciclo vazio")
            return stats

        now = datetime.now(tz=UTC).timestamp()
        for club in clubs:
            club_id = str(club.get("club_id") or "")
            if not club_id:
                continue
            try:
                self._process_club(club_id, now, stats)
            except Exception as err:  # noqa: BLE001 -- one club must not stop the cycle
                stats.clubes_falhos += 1
                stats.falhas.append(f"{club_id}: {err}")
                log.warning("falha ao processar clube %s: %s", club_id, err)
        log.info(
            "ciclo: %d clubes, %d falhas, %d partidas, %d snapshots",
            stats.clubes_processados, stats.clubes_falhos, stats.partidas_novas, stats.snapshots,
        )
        return stats

    def _process_club(self, club_id: str, now: float, stats: CycleStats) -> None:
        # Identity + totals: cheap, and needed before matches so the club row
        # exists. Structural, so it travels the sync path.
        info = self.source.club_info(club_id)
        if info:
            identity = club_identity(info)
            if identity["club_id"]:
                self.domain.upsert_club(identity)

        overall = self.source.club_overall(club_id)
        team_size = 0
        if overall:
            totals = club_totals(overall)
            self.domain.upsert_totals(club_id, totals)

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
        if overall:
            snap = snapshot(overall, team_size)
            try:
                self.domain.append_snapshot(club_id, snap)
                stats.snapshots += 1
            except Exception as err:  # noqa: BLE001 -- a snapshot is not worth failing a club
                log.debug("snapshot falhou para %s: %s", club_id, err)

        stats.clubes_processados += 1

    def _ingest_matches(self, club_id: str, stats: CycleStats) -> None:
        for match in self.source.club_matches(club_id, self.cfg.max_matches):
            payload = match_payload(match, club_id)
            if not payload or not payload["match_id"]:
                continue
            try:
                self.domain.upsert_match(club_id, payload)
            except DomainQueued:
                log.debug("partida %s ficou na fila", payload["match_id"])
                continue
            except DomainError as err:
                # The worker refused it -- permanent, so log and move on.
                log.warning("partida %s recusada: %s", payload["match_id"], err)
                continue

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
            opp = opponent_club_id(match, club_id)
            if opp:
                self._ensure_known(opp)

    def _ensure_known(self, club_id: str) -> None:
        """Register a club we have only seen as an opponent, with its totals.

        This is what makes the three-level sync possible: an opponent's club
        row has to exist before it can be followed, and its all-time totals are
        the only thing available until the cycle reaches it.
        """
        if club_id in self._known_clubs:
            return
        self._known_clubs.add(club_id)
        try:
            results = self.source.search_by_id(club_id)
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
