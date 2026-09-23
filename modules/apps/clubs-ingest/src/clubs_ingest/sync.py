"""Background sync: discover and ingest a person's clubs, their rivals, and
their rivals' rivals.

This is what makes logging in worth it. The three levels are enqueued in order
and each discovered club is followed with the ``source`` that found it, so the
Minha Área screen can show what the login unlocked.

Like everything else here, it goes through domain-api and never touches a
database directly.
"""

from __future__ import annotations

import logging
from typing import Any

from .client import DomainClient
from .normalize import club_identity, club_totals, merge_club_sources

log = logging.getLogger("clubs-ingest")

ORIGEM_PROPRIO = "own"
ORIGEM_RIVAL = "rival"
ORIGEM_RIVAL_DE_RIVAL = "rival_of_rival"


class Sync:
    """Runs the three-level discovery for one person."""

    def __init__(self, source, domain: DomainClient, ingest) -> None:
        self.source = source
        self.domain = domain
        self.ingest = ingest

    def run(self, user_email: str) -> dict[str, Any]:
        """Discover and follow everything reachable from this person's clubs.

        Returns the sync run payload, which is also persisted so the SPA's
        polling indicator can render progress without blocking navigation.
        """
        own = self._own_clubs(user_email)
        if not own:
            log.info("sync: %s não tem clubs próprios conhecidos", user_email)
            self._save(user_email, running=False, skill_rating=3, total=0, completed=0,
                       current="", new_items=[], concluido=True)
            return {"iniciado": False, "motivo": "sem clubs próprios"}

        # Fresh per run: the worker is a long-lived process, so a cache that
        # survived between runs would keep a club "already followed" (or a
        # claimed pro unseen) long after the watchlist changed.
        self._known: set[str] | None = None
        # id -> nome, do payload das partidas. A busca da fonte (que traz
        # divisão e totais) só aceita nome; sem este mapa a descoberta de cada
        # rival voltava vazia em silêncio.
        self._nomes: dict[str, str] = {}

        # Level 1: the person's own clubs.
        self._save(user_email, running=True, skill_rating=1, total=len(own), completed=0,
                   current=own[0] if own else "", new_items=[])
        new_items: list[str] = []
        lvl1 = self._follow(user_email, own, ORIGEM_PROPRIO, new_items)

        # Level 2: their direct rivals — as últimas 10 partidas do clube da
        # pessoa é que revelam quem são.
        rivais1 = self._rivals_named(lvl1, self.RIVAL_MATCHES_OWN)
        self._nomes.update({cid: name for cid, name in rivais1 if name})
        lvl2 = [cid for cid, _ in rivais1]
        self._save(user_email, running=True, skill_rating=2, total=len(lvl2),
                   completed=len(lvl1), current=lvl2[0] if lvl2 else "", new_items=new_items)
        lvl2 = [c for c in lvl2 if c not in lvl1]
        self._follow(user_email, lvl2, ORIGEM_RIVAL, new_items)

        # Level 3: the rivals of the rivals — 5 partidas de cada rival, para o
        # crawl não multiplicar: 10 rivais × 5 = 50 consultas, contra 100.
        rivais2 = self._rivals_named(lvl2, self.RIVAL_MATCHES_RIVAL)
        self._nomes.update({cid: name for cid, name in rivais2 if name})
        lvl3 = [cid for cid, _ in rivais2]
        self._save(user_email, running=True, skill_rating=3, total=len(lvl3),
                   completed=len(lvl1) + len(lvl2), current=lvl3[0] if lvl3 else "", new_items=new_items)
        lvl3 = [c for c in lvl3 if c not in lvl1 and c not in lvl2]
        self._follow(user_email, lvl3, ORIGEM_RIVAL_DE_RIVAL, new_items)

        total = len(lvl1) + len(lvl2) + len(lvl3)
        self._save(user_email, running=False, skill_rating=3, total=total, completed=total,
                   current="", new_items=new_items, concluido=True)
        log.info("sync %s: %d próprios, %d rivais, %d clubs from_division clubs",
                 user_email, len(lvl1), len(lvl2), len(lvl3))
        return {"iniciado": True, "niveis": {"1": len(lvl1), "2": len(lvl2), "3": len(lvl3)},
                "new_items": new_items}

    # --- levels -----------------------------------------------------------

    def _own_clubs(self, user_email: str) -> list[str]:
        """The clubs the person plays at. The person's watchlist carries them
        with source == "own"; anything else was discovered."""
        watched = self.domain.list_watch(user_email)
        own = [str(w.get("club_id")) for w in watched if w.get("source") == ORIGEM_PROPRIO]
        # A person who never marked one still gets the whole watchlist walked,
        # which is the honest fallback: we cannot know which is "their" club.
        if not own:
            own = [str(w.get("club_id")) for w in watched]
        return [c for c in own if c]

    # Quantas partidas de cada clube olhamos para descobrir rivais. O nível 1
    # usa 10 (as últimas do clube da pessoa); o nível 2 usa 5 por rival, para
    # o crawl não explodir: 10 rivais × 5 = 50 consultas, contra 100 se fosse
    # 10 em cada. São números de produto, não de infraestrutura -- por isso
    # vivem aqui, nomeados, e não espalhados nas chamadas.
    RIVAL_MATCHES_OWN = 10
    RIVAL_MATCHES_RIVAL = 5

    def _rivals_named(self, club_ids: list[str], matches_per_club: int) -> list[tuple[str, str]]:
        """Os adversários vistos nas matches, como (id, name).

        O name sai do próprio payload da partida e não é enfeite: a busca da
        fonte -- a única que traz divisão e totais -- só aceita NOME, e sem ele
        a descoberta from_division cada rival voltava vazia em silêncio.
        """
        seen: list[tuple[str, str]] = []
        vistos: set[str] = set()
        for club_id in club_ids:
            for match in self.source.club_matches(club_id, matches_per_club):
                for other in (match.get("clubs") or {}):
                    oid = str(other)
                    if oid == str(club_id) or oid in vistos:
                        continue
                    vistos.add(oid)
                    bloco = (match.get("clubs") or {}).get(other) or {}
                    name = str((bloco.get("details") or {}).get("name") or "")
                    seen.append((oid, name))
        return seen

    def _follow(self, user_email: str, club_ids: list[str], source: str,
                new_items: list[str]) -> list[str]:
        known = self._known_followed(user_email)
        followed: list[str] = []
        for club_id in club_ids:
            if not club_id:
                continue
            followed.append(club_id)
            if club_id not in known:
                try:
                    # Structural write through the sync path: the person must be
                    # able to reload and still see the club followed.
                    self.domain.sync("preferencia.setWatch", {
                        "user_email": user_email,
                        "club_id": club_id,
                        "source": source,
                        "seguindo": True,
                    })
                    known.add(club_id)
                    new_items.append(club_id)
                except Exception as err:  # noqa: BLE001 -- one club must not stop the sync
                    log.debug("seguir %s falhou: %s", club_id, err)
            # Ensure the club is ingestable, ALWAYS -- not only when the follow
            # write just ran. A club with totals but no `club.upsert` never
            # becomes `acompanhado`, and the cycle lists only followed clubs,
            # so it would sit at "totals only" forever: no squad, no matches.
            # This is also what repairs a club followed by an older sync that
            # wrote the watchlist row but never the identity.
            self._ensure_ingestable(club_id)
        return followed

    def _ensure_ingestable(self, club_id: str) -> None:
        """Write the club's identity + totals so the cycle will pick it up."""
        try:
            for row in self.source.search_by_id(club_id, self._nomes.get(club_id, "")):
                if str(row.get("clubId")) == club_id:
                    identity = club_identity(row)
                    identity["tracked"] = True
                    self.domain.upsert_club(identity)
                    # O overall completa o que a busca não traz (nível), e a
                    # busca completa o que o overall não traz (divisão). Só um
                    # dos dois deixaria o clube com metade dos números.
                    overall = self.source.club_overall(club_id)
                    self.domain.upsert_totals(club_id, club_totals(merge_club_sources(overall, row)))
                    return
        except Exception as err:  # noqa: BLE001 -- best-effort; the cycle retries
            log.debug("identidade/totais from_division %s falharam: %s", club_id, err)

    def _known_followed(self, user_email: str) -> set[str]:
        """The watchlist as of the START of this run, read once.

        Scoped to the run (self._known), not the class: a cache on the class
        lived for the whole worker process, so a club followed (or a pro
        claimed) after the first sync of the day stayed invisible to every
        later run -- the sync silently stopped discovering.
        """
        if self._known is None:
            self._known = {str(w.get("club_id")) for w in self.domain.list_watch(user_email)}
        return self._known

    def _save(self, user_email: str, **kwargs: Any) -> None:
        payload = {"user_email": user_email}
        payload.update(kwargs)
        try:
            # The progress row is cosmetic -- losing an update only makes the
            # indicator lag, so it rides the async path.
            self.domain.post("/sync-status", payload)
        except Exception as err:  # noqa: BLE001
            log.debug("sync-status falhou: %s", err)
