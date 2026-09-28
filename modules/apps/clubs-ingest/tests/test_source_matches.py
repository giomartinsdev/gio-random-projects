"""O clube tem três tipos de partida na origem; olhar só um perdia metade.

A fonte capa ``maxResultCount`` em 10 por consulta -- pedir 20 devolve 10, e
não há cursor para paginar. Mas ela separa as partidas em ``leagueMatch``,
``friendlyMatch`` e ``playoffMatch``, e os conjuntos NÃO se sobrepõem (medido
na fonte real: 10 de liga + 10 de amistoso = 20 partidas distintas). Olhar só
a liga -- como o cliente fazia -- era por que o clube parecia ter 10 partidas
e a série parava aí.

Estes testes fixam que o cliente une os três tipos, deduplica por ``matchId``
e que um tipo que falha não derruba os outros (a fonte bloqueia por IP às
vezes; perder um tipo não pode custar a consulta inteira).
"""

from __future__ import annotations

from clubs_ingest.fc27_api import FC27APIError
from clubs_ingest.source import SourceClient


class FakeAPI:
    """Devolve partidas por tipo, e registra os tipos pedidos."""

    def __init__(self, by_type=None, fail_types=()):
        self.by_type = by_type or {}
        self.fail_types = set(fail_types)
        self.asked: list[str] = []

    def get_json(self, endpoint, params):
        mt = params.get("matchType")
        self.asked.append(mt)
        if mt in self.fail_types:
            raise FC27APIError("bloqueado")
        return self.by_type.get(mt, [])


def make_client(api):
    c = SourceClient.__new__(SourceClient)
    c.api = api
    return c


def match(mid: str):
    return {"matchId": mid, "timestamp": "1767297600", "clubs": {}, "players": {}}


def test_club_matches_unions_every_match_type():
    api = FakeAPI({
        "leagueMatch": [match("a"), match("b")],
        "friendlyMatch": [match("c")],
        "playoffMatch": [match("d")],
    })
    got = make_client(api).club_matches("1001")
    assert {m["matchId"] for m in got} == {"a", "b", "c", "d"}
    # Os três tipos são consultados: olhar só a liga era o bug.
    assert set(api.asked) == {"leagueMatch", "friendlyMatch", "playoffMatch"}


def test_club_matches_dedupes_by_match_id():
    # Uma partida que aparecesse em dois tipos não pode contar duas vezes.
    api = FakeAPI({
        "leagueMatch": [match("a"), match("b")],
        "friendlyMatch": [match("b"), match("c")],
    })
    got = make_client(api).club_matches("1001")
    assert [m["matchId"] for m in got] == ["a", "b", "c"]


def test_one_failing_type_does_not_lose_the_others():
    # A fonte bloqueia por IP; um tipo bloqueado não pode custar os demais.
    api = FakeAPI(
        {"leagueMatch": [match("a")], "friendlyMatch": [match("c")]},
        fail_types={"playoffMatch"},
    )
    got = make_client(api).club_matches("1001")
    assert {m["matchId"] for m in got} == {"a", "c"}


def test_playoff_only_still_returned_when_league_is_empty():
    api = FakeAPI({"playoffMatch": [match("p1")]})
    got = make_client(api).club_matches("1001")
    assert [m["matchId"] for m in got] == ["p1"]


def test_non_dict_rows_are_dropped():
    # A fonte às vezes mete um `null` na lista; ele não é uma partida.
    api = FakeAPI({"leagueMatch": [match("a"), None, "lixo"]})
    got = make_client(api).club_matches("1001")
    assert [m["matchId"] for m in got] == ["a"]
