"""The sync chain: discovery has to actually reach the ingest loop, and a
claimed pro has to be the starting point.

Two production bugs are pinned here, both silent (the sync "succeeded" and
nothing appeared):

1. `_follow` wrote a club's totals but never its identity, so the club never
   became `acompanhado` and the cycle -- which lists only followed clubs --
   never fetched its squad or matches. The club sat at "totals only" forever.
2. A claimed pro never became a followed club, so `_own_clubs` (which reads
   the watchlist's "proprio" entries) started from an empty set and the whole
   three-level discovery was a no-op.

The fakes record what the sync asked domain-api to write, which is exactly the
contract the ingest loop depends on.
"""

from __future__ import annotations

from clubs_ingest.sync import Sync


class FakeSource:
    """Only the two calls the sync makes."""

    def __init__(self, matches_by_club=None, search_by_id=None):
        self.matches_by_club = matches_by_club or {}
        self.search_by_id_map = search_by_id or {}

    def club_matches(self, club_id, count=10):
        return self.matches_by_club.get(str(club_id), [])

    def search_by_id(self, club_id, name=""):
        # A assinatura carrega o nome porque a fonte só busca por nome; o fake
        # ignora o termo e devolve o mapa, como o teste já esperava.
        return self.search_by_id_map.get(str(club_id), [])

    def club_overall(self, club_id):
        # O sync funde overall + busca; o fake devolve vazio (a busca basta).
        return {}


class FakeDomain:
    """Records the writes, since the ingest loop's behaviour is driven by
    which rows exist afterwards."""

    def __init__(self, watch=None):
        self._watch = list(watch or [])
        self.clubs = []      # club.upsert payloads
        self.totals = []     # clubetotais.upsert payloads
        self.watches = []    # preferencia.setWatch payloads
        self.statuses = []   # /sync-status payloads

    def list_watch(self, email):
        return self._watch

    def sync(self, action, payload):
        if action == "preferencia.setWatch":
            self.watches.append(payload)
            self._watch.append({"club_id": payload["club_id"], "origem": payload["origem"]})
        elif action == "club.upsert":
            self.clubs.append(payload)
        elif action == "clubetotais.upsert":
            self.totals.append(payload)

    # The sync calls these convenience wrappers, mirroring DomainClient.
    def upsert_club(self, club):
        self.sync("club.upsert", club)

    def upsert_totals(self, club_id, totals):
        self.sync("clubetotais.upsert", totals)

    def post(self, path, payload):
        if path == "/sync-status":
            self.statuses.append(payload)


def search_hit(club_id: str):
    """Mirrors the real search shape: identity nested in clubInfo, totals on top."""
    return [{
        "clubId": club_id,
        "clubName": f"Club {club_id}",
        "wins": "10", "losses": "2", "ties": "1", "gamesPlayed": "13",
        "goals": "30", "goalsAgainst": "10", "cleanSheets": "5",
        "points": "31", "currentDivision": "2", "bestDivision": "1",
        "clubInfo": {
            "clubId": club_id, "name": f"Club {club_id}", "regionId": "1", "teamId": "9",
            "customKit": {"stadName": "Stadium", "crestAssetId": "77", "kitColor1": "1",
                          "kitColor2": "2", "kitColor3": "3", "kitColor4": "4"},
        },
    }]


def new_sync(source, domain):
    # The ingest argument is unused by the paths under test.
    return Sync(source, domain, ingest=None)


# ---------------------------------------------------- level 1 = claimed pro

def test_claimed_club_is_the_starting_point():
    """The person claimed a pro at club 1001; that club's watchlist entry has
    origem "proprio" (written by the claim itself, in domain-worker), so the
    sync must start there instead of falling back to an empty watchlist."""
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    source = FakeSource(
        matches_by_club={"1001": [{"clubs": {"1001": {}, "2001": {}}}]},
        search_by_id={"1001": search_hit("1001"), "2001": search_hit("2001")},
    )
    out = new_sync(source, domain).run("me@test")

    assert out["iniciado"] is True
    assert out["niveis"]["1"] == 1, "o clube do pro reivindicado é o nível 1"


def test_rival_of_the_claimed_club_is_discovered():
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    source = FakeSource(
        matches_by_club={"1001": [{"clubs": {"1001": {}, "2001": {}}}]},
        search_by_id={"1001": search_hit("1001"), "2001": search_hit("2001")},
    )
    new_sync(source, domain).run("me@test")

    # 1001 is already followed as "proprio" (the claim wrote it), so no
    # re-follow write; the rival 2001 is the new follow.
    followed = {w["club_id"]: w["origem"] for w in domain.watches}
    assert "1001" not in followed, "clube já seguido não é re-seguido"
    assert followed.get("2001") == "rival", "o adversário entra como rival direto"


# ------------------------------------------------- followed club is ingestable

def test_followed_club_gets_its_identity_written():
    """The crux: a club with totals but no `club.upsert` never becomes
    `acompanhado`, so the cycle -- which lists acompanhado == true -- skips it
    and the club never gets squad or matches."""
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    source = FakeSource(
        matches_by_club={},
        search_by_id={"1001": search_hit("1001")},
    )
    new_sync(source, domain).run("me@test")

    written = {c["club_id"]: c for c in domain.clubs}
    assert "1001" in written, "o clube seguido precisa de club.upsert"
    assert written["1001"]["acompanhado"] is True, "...e com acompanhado=true"
    # The identity must carry the nested clubInfo fields, not just an id.
    assert written["1001"]["nome"] == "Club 1001"
    assert written["1001"]["estadio"] == "Stadium"


def test_followed_club_also_gets_totals_written():
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    source = FakeSource(matches_by_club={}, search_by_id={"1001": search_hit("1001")})
    new_sync(source, domain).run("me@test")

    assert any(t["club_id"] == "1001" for t in domain.totals)


# ------------------------------------------------------------- empty inputs

def test_person_with_no_clubs_closes_the_run_cleanly():
    """No claimed pro and an empty watchlist: the run must close (not stay
    `rodando` forever), or the SPA's indicator spins and the queue keeps
    handing the same request back."""
    domain = FakeDomain(watch=[])
    out = new_sync(FakeSource(), domain).run("me@test")

    assert out["iniciado"] is False
    assert domain.statuses, "o pedido precisa ser fechado"
    assert domain.statuses[-1]["concluido"] is True
    assert domain.statuses[-1]["rodando"] is False


def test_a_club_already_followed_is_not_re_followed():
    """Idempotency: a second sync must not re-issue the follow write for a club
    already on the watchlist."""
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    source = FakeSource(matches_by_club={}, search_by_id={"1001": search_hit("1001")})
    sync = new_sync(source, domain)
    sync.run("me@test")
    first = len(domain.watches)
    sync.run("me@test")

    # The second run sees the cached/refreshed watchlist and skips the write.
    assert len(domain.watches) == first


# --------------------------------------------------- as regras 10/5 do crawl

class CountingSource(FakeSource):
    """Records how many matches each club was asked for, so the crawl's shape
    is assertable -- it is a product rule (10 then 5), not a detail."""

    def __init__(self, matches_by_club=None, search_by_id=None):
        super().__init__(matches_by_club, search_by_id)
        self.asked: list[tuple[str, int]] = []

    def club_matches(self, club_id, count=10):
        self.asked.append((str(club_id), count))
        return self.matches_by_club.get(str(club_id), [])


def test_own_club_is_asked_for_ten_matches():
    """Nível 1 -> nível 2 sai das últimas 10 partidas do clube da pessoa."""
    source = CountingSource(
        matches_by_club={"1001": [{"clubs": {"1001": {}, "2001": {}}}]},
        search_by_id={"1001": search_hit("1001"), "2001": search_hit("2001")},
    )
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    new_sync(source, domain).run("me@test")

    asked_of_own = [c for (cid, c) in source.asked if cid == "1001"]
    assert 10 in asked_of_own, f"o clube próprio deve ser consultado com 10, veio {asked_of_own}"


def test_rival_is_asked_for_five_matches_not_ten():
    """Nível 2 -> nível 3 usa 5 por rival: 10 rivais × 5 = 50 consultas, contra
    100 se fosse 10 em cada. É o freio que impede o crawl de explodir o CDN."""
    source = CountingSource(
        matches_by_club={
            "1001": [{"clubs": {"1001": {}, "2001": {}}}],
            "2001": [{"clubs": {"2001": {}, "3001": {}}}],
        },
        search_by_id={"1001": search_hit("1001"), "2001": search_hit("2001"), "3001": search_hit("3001")},
    )
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    new_sync(source, domain).run("me@test")

    asked_of_rival = [c for (cid, c) in source.asked if cid == "2001"]
    assert 5 in asked_of_rival, f"o rival deve ser consultado com 5, veio {asked_of_rival}"
    assert 10 not in asked_of_rival, "o rival NÃO deve ser consultado com 10"


def test_level3_never_re_asks_a_level1_or_level2_club():
    """O nível 3 visita rivais dos rivais, mas não repete quem já é próprio ou
    rival direto -- repetir só gastaria consulta e não traria clube novo."""
    source = CountingSource(
        matches_by_club={
            "1001": [{"clubs": {"1001": {}, "2001": {}}}],
            # 2001 joga contra 3001 E contra 1001 (o próprio): 1001 não pode
            # aparecer como "clube de clube".
            "2001": [{"clubs": {"2001": {}, "3001": {}, "1001": {}}}],
        },
        search_by_id={"1001": search_hit("1001"), "2001": search_hit("2001"), "3001": search_hit("3001")},
    )
    domain = FakeDomain(watch=[{"club_id": "1001", "origem": "proprio"}])
    out = new_sync(source, domain).run("me@test")

    followed = [w["club_id"] for w in domain.watches]
    assert "3001" in followed, "o rival do rival entra"
    assert followed.count("2001") == 1, "2001 entra UMA vez, como rival direto"
    # O clube próprio não é re-seguido: o claim já o gravou como "proprio".
    assert followed.count("1001") == 0
    # O nível 3 é terminal: 3001 entra na watchlist mas NÃO é crawleado de novo
    # (seria nível 4). Já o rival 2001, esse sim, foi consultado com 5.
    assert not [c for (cid, c) in source.asked if cid == "3001"], "nível 3 não é crawleado"
    assert 5 in [c for (cid, c) in source.asked if cid == "2001"]
