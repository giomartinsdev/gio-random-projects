"""Mapping tests, in the same spirit as pld-scraper's test_pld_mapping.py:
they exercise the translation layer against the real fixture shapes, offline.

These are the assertions that prove the normalized vocabulary is right — the
five result codes, the friendly fallback, the position de-para, and the
per-club match orientation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from clubs_ingest import normalize as nz

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / f"{name}.json").read_text())


# --------------------------------------------------------- result codes

@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("1", nz.RESULT_WIN),
        ("2", nz.RESULT_LOSS),
        ("4", nz.RESULT_DRAW),
        ("16385", nz.RESULT_WIN),   # win awarded because the opponent quit
        ("10", nz.RESULT_LOSS),     # loss because this club quit
    ],
)
def test_every_result_code_normalizes(code: str, expected: str):
    assert nz.result_from_club({"result": code}, 3, 1) == expected


def test_friendly_without_marker_derives_from_goals():
    """Friendlies send "0" for wins/ties/losses/result — the score is the only
    signal, and the three-valued outcome must still come out right."""
    friendly = {"result": "0"}
    assert nz.result_from_club(friendly, 4, 0) == nz.RESULT_WIN
    assert nz.result_from_club(friendly, 0, 0) == nz.RESULT_DRAW
    assert nz.result_from_club(friendly, 1, 3) == nz.RESULT_LOSS


def test_mirror_never_disagrees_with_itself():
    assert nz.mirror(nz.RESULT_WIN) == nz.RESULT_LOSS
    assert nz.mirror(nz.RESULT_LOSS) == nz.RESULT_WIN
    assert nz.mirror(nz.RESULT_DRAW) == nz.RESULT_DRAW


# ----------------------------------------------------------------- positions

def test_position_maps_both_strings_and_numeric_ids():
    assert nz.position("goalkeeper") == nz.POS_GOLEIRO
    assert nz.position("defender") == nz.POS_DEFENSOR
    assert nz.position("midfielder") == nz.POS_MEIO
    assert nz.position("forward") == nz.POS_ATACANTE
    assert nz.position(0) == nz.POS_GOLEIRO
    assert nz.position(25) == nz.POS_ATACANTE


def test_unknown_position_does_not_break_mapping():
    """An id outside the de-para table lands in the least-wrong bucket instead
    of raising — and is reported so the table can grow."""
    assert nz.position(999) == nz.POS_MEIO
    assert nz.describe_unknown_position(999) == "999"
    assert nz.describe_unknown_position(25) is None


# ------------------------------------------------------------------ coercion

def test_numbers_arriving_as_text_become_numbers():
    assert nz.to_int("25") == 25
    assert nz.to_int("7.4") == 7
    assert nz.to_float("7.4") == pytest.approx(7.4)
    assert nz.to_int(None) == 0
    assert nz.to_float("") == 0.0
    # A non-numeric value must never become NaN, which would poison sums.
    assert nz.to_float("abc") == 0.0


# ------------------------------------------------------------------- match

def test_match_payload_is_oriented_to_the_requesting_club():
    """The same match object carries both clubs; the payload must read from the
    requester's side, including the mirrored result for the opponent."""
    matches = fixture("matches")
    match = matches[0]

    ours = nz.match_payload(match, "1001")
    assert ours is not None
    assert ours["clube_casa_id"] == "1001"
    assert ours["clube_fora_id"] == "2001"
    assert ours["resultado_casa"] in {nz.RESULT_WIN, nz.RESULT_LOSS, nz.RESULT_DRAW}

    # Both sides' players ride in the same payload — that is what makes the
    # cross-club index possible, and what keeps a match's summary atomic.
    clubs_in_lines = {line["club_id"] for line in ours["jogadores"]}
    assert clubs_in_lines == {"1001", "2001"}

    theirs = nz.match_payload(match, "2001")
    assert theirs["resultado_casa"] == nz.mirror(ours["resultado_casa"])
    assert theirs["gols_casa"] == ours["gols_fora"]


def test_match_payload_carries_one_match_id_for_both_views():
    """Idempotency relies on this: both sides must produce the SAME match_id,
    so the second write updates instead of duplicating."""
    match = fixture("matches")[0]
    assert nz.match_payload(match, "1001")["match_id"] == nz.match_payload(match, "2001")["match_id"]


def test_dnf_is_detected_and_names_the_winner():
    """A match decided by a quit must be visibly a DNF, not a normal score."""
    match = fixture("matches")[0]  # fixture 1 has winnerByDnf=1 on the 1001 side
    payload = nz.match_payload(match, "1001")
    assert payload["houve_desistencia"] is True
    assert payload["vencedor_por_desistencia_id"] == "1001"


def test_match_payload_rejects_a_club_not_in_the_match():
    match = fixture("matches")[0]
    assert nz.match_payload(match, "9999") is None


def test_timestamp_from_unix_seconds_and_iso_string():
    assert nz.timestamp(1767297600).startswith("2026-01-01T20:00:00")
    assert nz.timestamp("1767297600").startswith("2026-01-01T20:00:00")
    assert nz.timestamp("2026-01-01T20:00:00Z").startswith("2026-01-01T20:00:00")
    # An unparseable value falls back to now rather than dropping the match.
    assert nz.timestamp("not a date").endswith("Z")


# ---------------------------------------------------------------- club / squad

def test_club_identity_from_the_real_info_shape():
    info = next(iter(fixture("info").values()))
    identity = nz.club_identity(info)
    assert identity["club_id"] == "1001"
    assert identity["nome"] == "Example FC"
    assert identity["estadio"] == "Example Stadium"
    assert identity["cor_1"] == 16777215  # decimal RGB stays raw
    assert identity["acompanhado"] is True


def test_club_totals_derives_points_when_absent():
    """The search endpoint sends points; overallStats may not. Deriving
    three-for-a-win keeps the ranking consistent between the two sources."""
    totals = nz.club_totals({"clubId": "1001", "gamesPlayed": "25", "wins": "20", "ties": "2", "losses": "3"})
    assert totals["pontos"] == 62
    assert totals["jogos"] == 25


def test_snapshot_shape_matches_the_append_input():
    overall = fixture("overall")[0]
    snap = nz.snapshot(overall, team_size=14)
    assert snap["club_id"] == "1001"
    assert snap["nivel"] == 1500
    assert snap["tamanho_elenco"] == 14
    # The snapshot must carry every field the append input declares.
    for key in ("nivel", "divisao", "jogos", "vitorias", "empates", "derrotas",
                "gols", "gols_sofridos", "tamanho_elenco"):
        assert key in snap


# ------------------------------------------------------------------ player line

def test_player_line_from_the_real_match_shape():
    match = fixture("matches")[0]
    stats = match["players"]["1001"]["9000004"]  # Player2, a midfielder with a goal
    line = nz.player_line(stats, "1001", "9000004")
    assert line["club_id"] == "1001"
    assert line["player_id"] == "9000004"
    assert line["posicao"] == nz.POS_MEIO
    assert line["gols"] == 1
    assert line["nota"] == pytest.approx(8.1)
    assert line["passes_certos"] == 3
    assert line["segundos_jogados"] == 656


def test_goalkeeper_save_breakdown_only_for_keepers():
    match = fixture("matches")[0]
    keeper = match["players"]["2001"]["9000002"]  # Player4, a goalkeeper
    assert nz.position(keeper["pos"]) == nz.POS_GOLEIRO
    # The fixture's keeper has zero saves, so the breakdown is None rather
    # than a dict of zeroes.
    assert nz.saves_breakdown(keeper) is None

    outfielder = match["players"]["1001"]["9000003"]
    assert nz.saves_breakdown(outfielder) is None


# ------------------------------------------------------------------- events

def test_event_aggregates_parse_across_all_four_fields():
    """The source splits one list across four fields for no documented reason,
    so all four must be read and summed."""
    stats = {
        "match_event_aggregate_0": "111:3,174:2",
        "match_event_aggregate_1": "6:1,95:1",
        "match_event_aggregate_2": "",
        "match_event_aggregate_3": "174:1",
    }
    events = nz.parse_event_aggregates(stats)
    assert events[111] == 3
    assert events[174] == 3  # 2 + 1, summed across fields
    assert events[6] == 1


def test_timeline_is_marked_as_inferred():
    """These labels come from correlation, not a published table — the payload
    must say so, so the UI never presents a guess as fact.

    It takes RAW stat dicts: ``match_event_aggregate_*`` is one of the fields
    ``player_line`` deliberately drops, so building the timeline from
    normalized lines would always be empty (which is the bug this asserts
    against).
    """
    match = fixture("matches")[1]
    raw = [{**stats, "player_id": pid} for pid, stats in match["players"]["1001"].items()]
    timeline = nz.timeline_from_lines(raw)
    assert timeline, "the fixture has event aggregates, so a timeline is expected"
    assert all(entry["inferido"] is True for entry in timeline)
    # Every emitted label must come from the named table — nothing invented.
    for entry in timeline:
        for event in entry["eventos"]:
            assert event["rotulo"] in set(nz.EVENT_LABELS.values())


def test_match_payload_timeline_is_populated_from_raw_stats():
    """Regression: the payload's timeline must come from the raw dicts, not
    from the normalized lines (which no longer carry the event fields)."""
    payload = nz.match_payload(fixture("matches")[1], "1001")
    assert payload["lances"], "a match with event aggregates must carry a timeline"


# ---------------------------------------------------------------- discovery

def test_opponent_club_id_finds_the_other_side():
    match = fixture("matches")[0]
    assert nz.opponent_club_id(match, "1001") == "2001"
    assert nz.opponent_club_id(match, "2001") == "1001"


# ------------------------------------------- fusão das fontes (bug do D0)

def test_merge_lifts_division_from_the_search_side():
    """O overallStats NÃO traz divisão; a busca traz. Fundir as duas é o que
    impede todo clube de aparecer como D0 -- nenhuma das duas sozinha tem o
    conjunto completo."""
    overall = {"clubId": "1", "skillRating": "2144", "wins": "43"}
    busca = {"clubId": "1", "currentDivision": "1", "bestDivision": "1", "cleanSheets": "20"}
    totals = nz.club_totals(nz.merge_club_sources(overall, busca))

    assert totals["divisao_atual"] == 1, "a divisão vem da busca"
    assert totals["melhor_divisao"] == 1
    assert totals["jogos_sem_sofrer"] == 20, "cleanSheets também só existe na busca"
    assert totals["nivel"] == 2144, "o nível vem do overall"
    assert totals["vitorias"] == 43


def test_merge_ignores_absent_values_so_they_do_not_blank_the_result():
    """A fonte manda o campo presente e vazio (ou null) em vez de omitir. Se o
    vazio vencesse, o merge apagaria justamente o que a outra fonte trouxe."""
    overall = {"clubId": "1", "skillRating": "2144", "currentDivision": None}
    busca = {"clubId": "1", "currentDivision": "1", "skillRating": ""}
    merged = nz.merge_club_sources(overall, busca)

    assert merged["currentDivision"] == "1", "o vazio do overall não apaga a busca"
    assert merged["skillRating"] == "2144", "o vazio da busca não apaga o overall"


def test_merge_tolerates_missing_sources():
    """Descobrir um clube pode falhar num dos lados; o merge não pode explodir."""
    assert nz.merge_club_sources(None, {"clubId": "1"}) == {"clubId": "1"}
    assert nz.merge_club_sources(None, None) == {}


# ------------------------------- busca por id (o outro bug silencioso)

def test_opponent_club_carries_the_name():
    """O nome do adversário vem no próprio payload da partida -- e é o que a
    busca da fonte exige. Sem ele a descoberta voltava vazia, em silêncio."""
    match = {
        "clubs": {
            "1001": {"details": {"name": "Example FC"}},
            "2001": {"details": {"name": "Opponent A"}},
        }
    }
    assert nz.opponent_club(match, "1001") == ("2001", "Opponent A")
    assert nz.opponent_club(match, "2001") == ("1001", "Example FC")
    assert nz.opponent_club(match, "9999") is None


# ------------------------- estatística de jogador ausente (bug do crash)

def test_match_payload_survives_a_null_player_line():
    """A fonte manda `null` no lugar das estatísticas de um jogador em algumas
    partidas -- provavelmente um jogador que saiu antes do apito. O normalizador
    explodia com "'NoneType' object has no attribute 'get'", e o clube INTEIRO
    era perdido no ciclo (sem identidade, totais, partidas nem snapshot)."""
    match = {
        "matchId": "m1",
        "timestamp": "1767297600",
        "clubs": {
            "1001": {"goals": "2", "goalsAgainst": "0", "result": "1",
                     "details": {"name": "Example FC", "clubId": 1001}},
            "2001": {"goals": "0", "goalsAgainst": "2", "result": "2",
                     "details": {"name": "Opponent A", "clubId": 2001}},
        },
        # O caso real: um jogador sem estatística nenhuma.
        "players": {"1001": {"p1": None, "p2": {"playername": "Válido", "rating": "7.0"}}},
    }
    payload = nz.match_payload(match, "1001")

    assert payload is not None, "a partida não pode ser descartada por um jogador sem dados"
    ids = [j["player_id"] for j in payload["jogadores"]]
    assert "p2" in ids, "o jogador com dados continua entrando"
    assert "p1" not in ids, "o jogador sem estatística é pulado, não vira linha vazia"


def test_player_line_of_a_null_is_skipped_not_crashed():
    """Contrato direto do normalizador: um stats nulo devolve None (pular),
    em vez de estourar."""
    assert nz.player_line_opt(None, "1001", "p1") is None
    assert nz.player_line_opt({"playername": "ok"}, "1001", "p2") is not None


# ------------------- null explícito onde se esperava um objeto (bug real)

def test_is_dnf_tolerates_a_null_details():
    """`club.get("details", {})` NÃO protege contra `"details": null`: o default
    só vale quando a chave falta. A fonte manda null explícito, e o `.get` do
    None estourava -- derrubando o clube inteiro no ciclo (visto em produção
    como "'NoneType' object has no attribute 'get'", sem dizer onde)."""
    club = {"clubId": "1", "details": None, "winnerByDnf": "1"}
    dnf, winner = nz.is_dnf(club, {"clubId": "2", "details": None})
    assert dnf is True
    assert winner == "1"


def test_opponent_club_tolerates_a_null_details():
    match = {
        "clubs": {
            "1001": {"details": None},
            "2001": {"details": {"name": "Opponent A"}},
        }
    }
    assert nz.opponent_club(match, "1001") == ("2001", "Opponent A")
    # E o lado sem nome não pode estourar tampouco.
    assert nz.opponent_club(match, "2001") == ("1001", "")


def test_match_payload_survives_null_details_on_both_sides():
    """O caso de produção: um clube da partida vem com `details: null`. A
    partida continua sendo gravada; só o nome do adversário sai vazio."""
    match = {
        "matchId": "m1",
        "timestamp": "1767297600",
        "clubs": {
            "1001": {"goals": "2", "goalsAgainst": "0", "result": "1", "details": None},
            "2001": {"goals": "0", "goalsAgainst": "2", "result": "2",
                     "details": {"name": "Opponent A", "clubId": 2001}},
        },
        "players": {},
    }
    payload = nz.match_payload(match, "1001")
    assert payload is not None, "a partida não pode ser perdida por um details nulo"
    assert payload["match_id"] == "m1"
    assert payload["gols_casa"] == 2


def test_is_dnf_reads_the_winner_id_from_a_null_safe_details():
    """O clube sem details ainda pode ser o vencedor por desistência -- o id
    está no topo do bloco, não só no details."""
    club = {"clubId": "1001", "details": None, "winnerByDnf": "1"}
    _, winner = nz.is_dnf(club, {})
    assert winner == "1001"
