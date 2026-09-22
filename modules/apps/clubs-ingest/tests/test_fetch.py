"""O fetch sob demanda de um clube: a tela de resgate não pode esperar o ciclo.

O ciclo roda a cada 15 min, e a tela de resgate precisa do elenco AGORA -- é
dali que a pessoa escolhe o pro dela. Estes testes fixam o contrato que faz a
tela ser útil:

- `run_fetch` busca identidade, totais e partidas de UM clube e marca o clube
  como acompanhado (o ciclo seguinte continua cuidando dele);
- devolve a contagem de jogadores, que é o número que a tela mostra;
- o loop fecha a linha da fila — inclusive quando a fonte falha, senão a tela
  ficaria "buscando" para sempre.
"""

from __future__ import annotations

from clubs_ingest.cycle import Ingest, IngestConfig


class FakeSource:
    def __init__(self, info=None, overall=None, matches=None, search=None):
        self._info = info or {}
        self._overall = overall or {}
        self._matches = matches or []
        self.search_by_id_map = search or {}

    def club_info(self, club_id):
        return self._info

    def club_overall(self, club_id):
        return self._overall

    def club_matches(self, club_id, count=10):
        return self._matches

    def search_by_id(self, club_id, name=""):
        return self.search_by_id_map.get(str(club_id), [])


class FakeDomain:
    def __init__(self):
        self.clubs = []
        self.totals = []
        self.matches = []

    def upsert_club(self, club):
        self.clubs.append(club)

    def upsert_totals(self, club_id, totals):
        self.totals.append(totals)

    def upsert_match(self, club_id, payload):
        self.matches.append(payload)


def match_with_players(club_id: str, opponent: str, player_ids: list[str]):
    """Uma partida no formato da fonte, com os dois lados."""
    players = {
        club_id: {pid: {"name": f"P{pid}", "ratingAve": "7.0", "goals": "1"} for pid in player_ids},
        opponent: {"99": {"name": "Rival", "ratingAve": "6.0", "goals": "0"}},
    }
    return {
        "matchId": f"m-{club_id}-{opponent}",
        "timestamp": "1767297600",
        "clubs": {
            club_id: {"goals": "2", "goalsAgainst": "0", "result": "1", "details": {"name": "Nosso FC", "clubId": club_id, "customKit": {}}},
            opponent: {"goals": "0", "goalsAgainst": "2", "result": "2", "details": {"name": "Rival FC", "clubId": opponent, "customKit": {}}},
        },
        "players": players,
    }


def new_ingest(source, domain):
    return Ingest(source, domain, IngestConfig())


def test_run_fetch_writes_identity_totals_and_matches():
    source = FakeSource(
        info={"clubId": "141881", "name": "ACG ZW", "customKit": {"stadName": "Stadium"}},
        overall={"clubId": "141881", "gamesPlayed": "51", "wins": "43", "skillRating": "2144"},
        matches=[match_with_players("141881", "234", ["p1", "p2", "p3"])],
    )
    domain = FakeDomain()

    jogadores, partidas = new_ingest(source, domain).run_fetch("141881")

    assert jogadores == 3, "três jogadores distintos na partida"
    assert partidas == 1
    assert domain.clubs and domain.clubs[0]["acompanhado"] is True, "o clube entra como acompanhado"
    assert domain.clubs[0]["club_id"] == "141881"
    assert domain.totals, "os totais são gravados"
    assert domain.matches, "as partidas são gravadas"


def test_run_fetch_counts_distinct_players_across_matches():
    """O número mostrado é o de jogadores distintos, não a soma das linhas --
    o mesmo pro aparece em várias partidas e não pode contar várias vezes."""
    source = FakeSource(
        info={"clubId": "1", "name": "X", "customKit": {}},
        overall={"clubId": "1", "gamesPlayed": "2"},
        matches=[
            match_with_players("1", "2", ["p1", "p2"]),
            match_with_players("1", "3", ["p2", "p3"]),
        ],
    )
    domain = FakeDomain()
    jogadores, partidas = new_ingest(source, domain).run_fetch("1")

    assert jogadores == 3, "p1, p2, p3 -- p2 não conta duas vezes"
    assert partidas == 2


def test_run_fetch_without_a_source_hit_still_returns():
    """Clube que a fonte não conhece: não deve explodir, só voltar vazio."""
    source = FakeSource(info={}, overall={}, matches=[])
    domain = FakeDomain()
    jogadores, partidas = new_ingest(source, domain).run_fetch("sem-clube")

    assert jogadores == 0 and partidas == 0
    assert domain.clubs == []


def test_known_matches_still_count_as_processed():
    """Um clube que o hub já acompanha tem as mesmas partidas de novo. A tela
    diz "trouxe N partidas" -- se contássemos só as NOVAS, ela diria 0 depois
    de buscar 10, que parece falha mas é sucesso."""
    source = FakeSource(
        info={"clubId": "1", "name": "X", "customKit": {}},
        overall={"clubId": "1", "gamesPlayed": "2"},
        matches=[match_with_players("1", "2", ["p1"])],
    )
    domain = FakeDomain()
    ingest = new_ingest(source, domain)

    # Primeira busca: tudo novo.
    _, primeira = ingest.run_fetch("1")
    assert primeira == 1

    # Segunda busca: a mesma partida, agora já conhecida.
    _, segunda = ingest.run_fetch("1")
    assert segunda == 1, "a partida conhecida ainda foi processada, e a tela deve ver 1"


def test_run_fetch_writes_the_division_from_the_search_side():
    """O overallStats NÃO traz divisão; a busca traz. Sem fundir as duas, todo
    clube entra como D0 e nenhuma mudança de divisão é detectada -- foi
    exatamente o que aconteceu em produção (20 clubes, todos divisao_atual=0)."""
    source = FakeSource(
        info={"clubId": "1", "name": "X", "customKit": {}},
        overall={"clubId": "1", "gamesPlayed": "51", "wins": "43", "skillRating": "2144"},
        matches=[],
    )
    # A busca devolve a divisão (e o overall não).
    source.search_by_id_map = {"1": [{"clubId": "1", "currentDivision": "1", "bestDivision": "1"}]}
    domain = FakeDomain()

    new_ingest(source, domain).run_fetch("1")

    assert domain.totals, "os totais precisam ser gravados"
    t = domain.totals[0]
    assert t["divisao_atual"] == 1, "a divisão vem da busca"
    assert t["melhor_divisao"] == 1
    assert t["nivel"] == 2144, "e o nível continua vindo do overall"
