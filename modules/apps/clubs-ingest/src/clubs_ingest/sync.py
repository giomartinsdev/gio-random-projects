"""Background sync: discover and ingest a person's clubs, their rivals, and
their rivals' rivals.

This is what makes logging in worth it. The three levels are enqueued in order
and each discovered club is followed with the ``origem`` that found it, so the
Minha Área screen can show what the login unlocked.

Like everything else here, it goes through domain-api and never touches a
database directly.
"""

from __future__ import annotations

import logging
from typing import Any

from .client import DomainClient
from .normalize import club_totals

log = logging.getLogger("clubs-ingest")

ORIGEM_PROPRIO = "proprio"
ORIGEM_RIVAL = "rival"
ORIGEM_RIVAL_DE_RIVAL = "rival_de_rival"


class Sync:
    """Runs the three-level discovery for one person."""

    def __init__(self, source, domain: DomainClient, ingest) -> None:
        self.source = source
        self.domain = domain
        self.ingest = ingest

    def run(self, usuario_email: str) -> dict[str, Any]:
        """Discover and follow everything reachable from this person's clubs.

        Returns the sync run payload, which is also persisted so the SPA's
        polling indicator can render progress without blocking navigation.
        """
        own = self._own_clubs(usuario_email)
        if not own:
            log.info("sync: %s não tem clubes próprios conhecidos", usuario_email)
            self._save(usuario_email, rodando=False, nivel=3, total=0, concluidos=0,
                       atual="", novos=[], concluido=True)
            return {"iniciado": False, "motivo": "sem clubes próprios"}

        # Level 1: the person's own clubs.
        self._save(usuario_email, rodando=True, nivel=1, total=len(own), concluidos=0,
                   atual=own[0] if own else "", novos=[])
        novos: list[str] = []
        lvl1 = self._follow(usuario_email, own, ORIGEM_PROPRIO, novos)

        # Level 2: their direct rivals.
        lvl2 = self._rivals_of(lvl1)
        self._save(usuario_email, rodando=True, nivel=2, total=len(lvl2),
                   concluidos=len(lvl1), atual=lvl2[0] if lvl2 else "", novos=novos)
        lvl2 = [c for c in lvl2 if c not in lvl1]
        self._follow(usuario_email, lvl2, ORIGEM_RIVAL, novos)

        # Level 3: the rivals of the rivals — the "clubes de clubes".
        lvl3 = self._rivals_of(lvl2)
        self._save(usuario_email, rodando=True, nivel=3, total=len(lvl3),
                   concluidos=len(lvl1) + len(lvl2), atual=lvl3[0] if lvl3 else "", novos=novos)
        lvl3 = [c for c in lvl3 if c not in lvl1 and c not in lvl2]
        self._follow(usuario_email, lvl3, ORIGEM_RIVAL_DE_RIVAL, novos)

        total = len(lvl1) + len(lvl2) + len(lvl3)
        self._save(usuario_email, rodando=False, nivel=3, total=total, concluidos=total,
                   atual="", novos=novos, concluido=True)
        log.info("sync %s: %d próprios, %d rivais, %d clubes de clubes",
                 usuario_email, len(lvl1), len(lvl2), len(lvl3))
        return {"iniciado": True, "niveis": {"1": len(lvl1), "2": len(lvl2), "3": len(lvl3)},
                "novos": novos}

    # --- levels -----------------------------------------------------------

    def _own_clubs(self, usuario_email: str) -> list[str]:
        """The clubs the person plays at. The person's watchlist carries them
        with origem == "proprio"; anything else was discovered."""
        watched = self.domain.list_watch(usuario_email)
        own = [str(w.get("club_id")) for w in watched if w.get("origem") == ORIGEM_PROPRIO]
        # A person who never marked one still gets the whole watchlist walked,
        # which is the honest fallback: we cannot know which is "their" club.
        if not own:
            own = [str(w.get("club_id")) for w in watched]
        return [c for c in own if c]

    def _rivals_of(self, club_ids: list[str]) -> list[str]:
        seen: list[str] = []
        for club_id in club_ids:
            for match in self.source.club_matches(club_id, 10):
                for other in (match.get("clubs") or {}):
                    if str(other) != str(club_id) and str(other) not in seen:
                        seen.append(str(other))
        return seen

    def _follow(self, usuario_email: str, club_ids: list[str], origem: str,
                novos: list[str]) -> list[str]:
        followed: list[str] = []
        for club_id in club_ids:
            if not club_id:
                continue
            followed.append(club_id)
            if club_id in self._known_followed(usuario_email):
                continue
            try:
                # Structural write through the sync path: the person must be
                # able to reload and still see the club followed.
                self.domain.sync("preferencia.setWatch", {
                    "usuario_email": usuario_email,
                    "club_id": club_id,
                    "origem": origem,
                    "seguindo": True,
                })
                novos.append(club_id)
            except Exception as err:  # noqa: BLE001 -- one club must not stop the sync
                log.debug("seguir %s falhou: %s", club_id, err)
            # Give the club its totals and make sure the ingest loop will see
            # it on the next cycle.
            try:
                for row in self.source.search_by_id(club_id):
                    if str(row.get("clubId")) == club_id:
                        self.domain.upsert_totals(club_id, club_totals(row))
                        break
            except Exception as err:  # noqa: BLE001
                log.debug("totais de %s falharam: %s", club_id, err)
        return followed

    _watched_cache: dict[str, set[str]] = {}

    def _known_followed(self, usuario_email: str) -> set[str]:
        cached = Sync._watched_cache.get(usuario_email)
        if cached is not None:
            return cached
        watched = {str(w.get("club_id")) for w in self.domain.list_watch(usuario_email)}
        Sync._watched_cache[usuario_email] = watched
        return watched

    def _save(self, usuario_email: str, **kwargs: Any) -> None:
        payload = {"usuario_email": usuario_email}
        payload.update(kwargs)
        try:
            # The progress row is cosmetic -- losing an update only makes the
            # indicator lag, so it rides the async path.
            self.domain.post("/sync-status", payload)
        except Exception as err:  # noqa: BLE001
            log.debug("sync-status falhou: %s", err)
