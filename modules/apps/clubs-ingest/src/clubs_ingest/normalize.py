"""The single translation layer between the source's payloads and the shape
domain-api accepts.

Every irregularity of the EA Pro Clubs API is resolved HERE and nowhere else:

- Numbers arrive as **text** ("25", "7.4").
- The parameter name alternates between singular (``clubId``) and plural
  (``clubIds``) depending on endpoint -- handled in client.py.
- There are **five** numeric result codes for **three** outcomes:
  ``1`` win, ``2`` loss, ``4`` draw, ``16385`` win-by-opponent-DNF,
  ``10`` loss-by-DNF. Friendlies send ``0`` for all of them.
- Friendlies carry **no result marker at all**, so the result is derived from
  goals for vs goals against.
- The same match appears under both clubs' payloads.
- Identifiers have **no published lookup table**: position, style, nationality,
  crest asset and the event ids inside ``match_event_aggregate_*``.

Anything this module cannot classify is surfaced as a value the API and the UI
can show as "unknown" -- never invented, never dropped silently.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

# ----------------------------------------------------------------- result codes

# The source's result column. 16385 and 10 are the DNF variants; the API
# documents them but they read as opaque numbers, so they get names here.
RESULT_WIN = "vitoria"
RESULT_DRAW = "empate"
RESULT_LOSS = "derrota"

# Match types, as the source spells them in the `matchType` param and in
# each club's own `matchType` field (`1` league, `5` friendly).
TYPE_LEAGUE = "liga"
TYPE_FRIENDLY = "amistoso"
TYPE_PLAYOFF = "playoff"

_MATCH_TYPE_PARAM = {
    "leagueMatch": TYPE_LEAGUE,
    "friendlyMatch": TYPE_FRIENDLY,
    "playoffMatch": TYPE_PLAYOFF,
    # The same information, numeric, from inside a match payload.
    "1": TYPE_LEAGUE,
    "5": TYPE_FRIENDLY,
    "3": TYPE_PLAYOFF,
}

_RESULT_CODE = {
    "1": RESULT_WIN,
    "2": RESULT_LOSS,
    "4": RESULT_DRAW,
    "16385": RESULT_WIN,   # win awarded because the opponent quit
    "10": RESULT_LOSS,     # loss because this club quit
}

# ------------------------------------------------------------------ positions

# proPos / pos are numeric EA ids with no published table. Only the four
# broad buckets are confidently inferable from the source's own strings
# ("goalkeeper", "defender", "midfielder", "forward" appear in match
# payloads), so those are mapped; anything else falls back to the string
# when it is already one of ours, else to "meio" as the least-wrong bucket
# and is reported by describe_unknown_position().
POS_GOLEIRO = "goleiro"
POS_DEFENSOR = "defensor"
POS_MEIO = "meio"
POS_ATACANTE = "atacante"

_POSITION_ALIASES = {
    "goalkeeper": POS_GOLEIRO,
    "gk": POS_GOLEIRO,
    "keeper": POS_GOLEIRO,
    "defender": POS_DEFENSOR,
    "defence": POS_DEFENSOR,
    "defense": POS_DEFENSOR,
    "def": POS_DEFENSOR,
    "midfielder": POS_MEIO,
    "midfield": POS_MEIO,
    "mid": POS_MEIO,
    "forward": POS_ATACANTE,
    "striker": POS_ATACANTE,
    "attacker": POS_ATACANTE,
    "ata": POS_ATACANTE,
}

# The numeric ids observed paired with their string form on the same player.
# This is a de-para table we own (ADR #3): the source publishes none, so it is
# extended by observation and only ever grows.
_PRO_POS_TO_BUCKET = {
    0: POS_GOLEIRO,
    1: POS_GOLEIRO,
    5: POS_DEFENSOR,
    8: POS_DEFENSOR,
    11: POS_DEFENSOR,
    15: POS_MEIO,
    17: POS_MEIO,
    21: POS_MEIO,
    25: POS_ATACANTE,
    27: POS_ATACANTE,
}


def to_int(value: Any) -> int:
    """Coerce a source value to int, tolerating text and floats-as-text."""
    if value is None or value == "":
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return 0
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def to_float(value: Any) -> float:
    """Coerce a source value to float; unparseable becomes 0.0, never NaN."""
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def to_bool(value: Any) -> bool:
    """The source sends flags as "1"/"0", sometimes as real booleans."""
    if isinstance(value, bool):
        return value
    return to_int(value) == 1


def obj(parent: Any, key: str) -> dict[str, Any]:
    """Lê ``parent[key]`` como objeto, tolerando ausência E null explícito.

    ``parent.get(key, {})`` parece proteger, mas não: o default só vale quando
    a chave FALTA. A fonte manda ``"details": null`` e ``"customKit": null``
    com frequência, e o ``.get`` seguinte estourava no None -- derrubando o
    clube inteiro no ciclo, logado apenas como "'NoneType' object has no
    attribute 'get'", sem dizer onde.

    Este helper é o único lugar que trata isso, para o padrão não voltar
    espalhado em cada leitura aninhada.
    """
    if not isinstance(parent, dict):
        return {}
    value = parent.get(key)
    return value if isinstance(value, dict) else {}


def position(raw: Any) -> str:
    """Map a position to one of the four buckets.

    Accepts either the source's own string ("goalkeeper") or its numeric
    ``proPos`` id. An unknown numeric id lands in ``meio`` -- the least-wrong
    bucket -- because dropping the player entirely would be worse than a
    coarse label.
    """
    if raw is None or raw == "":
        return POS_MEIO
    if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.isdigit()):
        return _PRO_POS_TO_BUCKET.get(to_int(raw), POS_MEIO)
    return _POSITION_ALIASES.get(str(raw).strip().lower(), POS_MEIO)


def describe_unknown_position(raw: Any) -> str | None:
    """Return the raw value when it is NOT in our de-para table, so the worker
    can log it and the table can grow. ``None`` when we recognized it."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, (int, float)) or (isinstance(raw, str) and str(raw).isdigit()):
        return None if to_int(raw) in _PRO_POS_TO_BUCKET else str(raw)
    return None if str(raw).strip().lower() in _POSITION_ALIASES else str(raw)


# -------------------------------------------------------------------- results

def match_type(raw: Any) -> str:
    """Normalize the match type from either its param spelling or its numeric
    form. Unknown values default to league -- the type only affects filtering,
    never the result."""
    if raw is None:
        return TYPE_LEAGUE
    return _MATCH_TYPE_PARAM.get(str(raw).strip(), TYPE_LEAGUE)


def result_from_club(club: dict[str, Any], our_goals: int, their_goals: int) -> str:
    """The result of a match from one club's point of view.

    The source fills ``result`` with one of five codes for league matches and
    leaves it at ``"0"`` for friendlies, where the only signal is the score.
    Both paths land on the same three-valued outcome.
    """
    code = str(club.get("result", "")).strip()
    if code in _RESULT_CODE:
        return _RESULT_CODE[code]
    # No code (a friendly, or a payload that omitted it): derive from goals.
    if our_goals > their_goals:
        return RESULT_WIN
    if our_goals < their_goals:
        return RESULT_LOSS
    return RESULT_DRAW


def mirror(result: str) -> str:
    """The other club's result -- derived so the two can never disagree."""
    if result == RESULT_WIN:
        return RESULT_LOSS
    if result == RESULT_LOSS:
        return RESULT_WIN
    return RESULT_DRAW


def is_dnf(club: dict[str, Any], opponent: dict[str, Any]) -> tuple[bool, str]:
    """Whether the match ended by a quit, and who was awarded the win.

    Returns ``(houve_desistencia, vencedor_club_id)``. The winner is read from
    ``winnerByDnf`` on whichever side carries it.
    """
    if to_bool(club.get("winnerByDnf")):
        return True, str(club.get("clubId") or obj(club, "details").get("clubId") or "")
    if to_bool(opponent.get("winnerByDnf")):
        return True, str(opponent.get("clubId") or obj(opponent, "details").get("clubId") or "")
    # A DNF result code with no flag is still a DNF -- the code is the more
    # reliable signal of the two.
    code = str(club.get("result", "")).strip()
    if code in ("16385", "10"):
        winner = "" if code == "10" else str(club.get("clubId") or "")
        return True, winner
    return False, ""


# ------------------------------------------------------------------- timestamp

_TS_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})")


def timestamp(raw: Any) -> str:
    """Normalize the source's timestamp to RFC3339 UTC.

    The source sends Unix **seconds** (an int) in match payloads and an
    ISO-ish string elsewhere. Both are accepted; an unparseable value falls
    back to "now" rather than rejecting the whole match over a date.
    """
    if raw is None or raw == "":
        return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    # Unix seconds (int, float, or a numeric string).
    if isinstance(raw, (int, float)) or (isinstance(raw, str) and raw.strip().isdigit()):
        try:
            return datetime.fromtimestamp(to_int(raw), tz=UTC).isoformat().replace("+00:00", "Z")
        except (OverflowError, OSError, ValueError):
            return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    text = str(raw).strip()
    m = _TS_RE.match(text)
    if m:
        try:
            dt = datetime(*(int(g) for g in m.groups()), tzinfo=UTC)
            return dt.isoformat().replace("+00:00", "Z")
        except ValueError:
            pass
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


# --------------------------------------------------------------------- kits

def kit_color(club_info: dict[str, Any], key: str) -> int:
    """A kit colour, decimal RGB as the source sends it (16777215 = white).

    Hex conversion belongs to the presentation layer, so the raw decimal is
    what travels on. A missing kit block yields 0 ("no colour recorded").
    """
    kit = club_info.get("customKit") or {}
    return to_int(kit.get(key))


# ------------------------------------------------------- player match lines

# The six goalkeeper save kinds. They only ever carry a value for a keeper,
# which is why the API stores them as one jsonb object instead of six mostly
# empty columns.
SAVE_KINDS = (
    "ballDiveSaves",
    "crossSaves",
    "goodDirectionSaves",
    "parrySaves",
    "punchSaves",
    "reflexSaves",
)


def saves_breakdown(stats: dict[str, Any]) -> dict[str, int] | None:
    """The goalkeeper save breakdown, or None for anyone but a keeper."""
    if position(stats.get("pos")) != POS_GOLEIRO:
        return None
    out = {kind: to_int(stats.get(kind)) for kind in SAVE_KINDS}
    return out if any(out.values()) else None


def player_line(stats: dict[str, Any], club_id: str, player_id: str) -> dict[str, Any]:
    """One player's line in a match, in domain-api's ``LinhaInput`` shape."""
    return {
        "club_id": club_id,
        "player_id": player_id,
        "gamertag": str(stats.get("playername") or ""),
        "posicao": position(stats.get("pos")),
        "nota": to_float(stats.get("rating")),
        "gols": to_int(stats.get("goals")),
        "assistencias": to_int(stats.get("assists")),
        "chutes": to_int(stats.get("shots")),
        "passes_certos": to_int(stats.get("passesmade")),
        "passes_tentados": to_int(stats.get("passattempts")),
        "desarmes_certos": to_int(stats.get("tacklesmade")),
        "desarmes_tentados": to_int(stats.get("tackleattempts")),
        "defesas": to_int(stats.get("saves")),
        "defesas_por_tipo": saves_breakdown(stats),
        "segundos_jogados": to_int(stats.get("secondsPlayed")) or to_int(stats.get("gameTime")),
        "melhor_em_campo": to_bool(stats.get("mom")),
        "cartao_vermelho": to_int(stats.get("redcards")) > 0,
        "jogo_sem_sofrer_gol": to_bool(stats.get("cleansheetsany")),
    }


# ------------------------------------------------- event aggregates (timeline)

# The source's ``match_event_aggregate_N`` fields are ``eventId:count`` lists
# with NO published table. Correlating counts against goals, shots, passes and
# cards names the few that are unambiguous; the rest stay unnamed and are not
# invented. Anything not in this table is simply not rendered as a timeline
# entry -- a wrong label is worse than a shorter timeline.
EVENT_LABELS = {
    1: "inicio_periodo",
    24: "toque",
    26: "passe",
    30: "passe_certo",
    97: "toque",
    100: "desarme",
    106: "chute",
    108: "chute_no_gol",
    111: "passe_tentado",
    112: "passe",
    152: "acao_goleiro",
    163: "acao_goleiro",
    164: "acao_goleiro",
    174: "passe",
    182: "desarme",
    215: "movimentacao",
}


def parse_event_aggregates(stats: dict[str, Any]) -> dict[int, int]:
    """Parse every ``match_event_aggregate_N`` field into ``{event_id: count}``.

    The source splits the list across four fields for no documented reason, so
    all four are read and summed.
    """
    totals: dict[int, int] = {}
    for idx in range(4):
        raw = stats.get(f"match_event_aggregate_{idx}") or ""
        for chunk in str(raw).split(","):
            chunk = chunk.strip()
            if not chunk or ":" not in chunk:
                continue
            event_id_text, count_text = chunk.split(":", 1)
            event_id = to_int(event_id_text)
            if event_id <= 0:
                continue
            totals[event_id] = totals.get(event_id, 0) + to_int(count_text)
    return totals


def timeline_from_lines(raw_lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Correlate the event aggregates into a coarse per-player timeline.

    Takes the RAW player stat dicts, because ``match_event_aggregate_*`` is
    one of the fields ``player_line`` deliberately drops -- building this from
    normalized lines would always produce an empty timeline.

    The output is deliberately marked ``"inferido": True`` -- these labels come
    from correlation, not from a published table, and the UI must be able to
    say so.
    """
    out: list[dict[str, Any]] = []
    for line in raw_lines:
        events = parse_event_aggregates(line)
        summary = []
        for event_id, count in sorted(events.items()):
            label = EVENT_LABELS.get(event_id)
            if label and count:
                summary.append({"event_id": event_id, "rotulo": label, "quantidade": count})
        if summary:
            out.append({
                "player_id": line.get("player_id"),
                "gamertag": line.get("gamertag"),
                "eventos": summary,
                "inferido": True,
            })
    return out


# ------------------------------------------------------------ club / squad

def club_identity(details: dict[str, Any]) -> dict[str, Any]:
    """The club's identity block, in domain-api's ``UpsertClubInput`` shape.

    Aceita os DOIS formatos que a fonte usa: ``clubs/info`` devolve a identidade
    no topo, e ``search`` a aninha em ``clubInfo`` (com os totais no topo). Sem
    desaninhar aqui, um clube vindo da busca ficava sem estádio e sem cores.
    """
    details = details.get("clubInfo") or details
    if not isinstance(details, dict):
        details = {}
    kit = obj(details, "customKit")
    return {
        "club_id": str(details.get("clubId") or details.get("club_id") or ""),
        "nome": str(details.get("name") or details.get("clubName") or ""),
        "sigla": _initials(details.get("name") or details.get("clubName") or ""),
        "estadio": str(kit.get("stadName") or ""),
        "regiao_id": str(details.get("regionId") or ""),
        "time_id": str(details.get("teamId") or ""),
        "escudo_asset_id": str(kit.get("crestAssetId") or ""),
        "cor_1": to_int(kit.get("kitColor1")),
        "cor_2": to_int(kit.get("kitColor2")),
        "cor_3": to_int(kit.get("kitColor3")),
        "cor_4": to_int(kit.get("kitColor4")),
        "acompanhado": True,
    }


def merge_club_sources(*fontes: dict[str, Any] | None) -> dict[str, Any]:
    """Funde as leituras de um clube numa só, sem deixar o vazio vencer.

    Nenhuma fonte sozinha tem o conjunto completo, e é isso que fazia todo
    clube aparecer como D0: o ``overallStats`` traz nível, vitórias e a streaks,
    mas NÃO traz divisão nem clean sheets; a busca/leaderboard trazem divisão e
    clean sheets, mas não trazem nível. O ciclo usava só o overall -- então
    ``currentDivision`` vinha sempre vazio e virava 0.

    A fusão ignora valores ausentes em vez de sobrescrever com eles: a fonte
    manda campos presentes e vazios (``None``, ``""``) com frequência, e deixar
    o vazio vencer apagaria justamente o dado que a outra fonte trouxe.

    A ordem importa para os campos presentes nas duas: a última fonte vence.
    """
    merged: dict[str, Any] = {}
    for fonte in fontes:
        for chave, valor in (fonte or {}).items():
            if valor is None or valor == "":
                continue
            merged[chave] = valor
    return merged


def career_line(row: dict[str, Any], club_id: str) -> dict[str, Any] | None:
    """Uma linha de totais de CARREIRA, no shape de ``CareerInput``.

    O endpoint ``members/career/stats`` não traz ``playerId`` -- a única chave
    é o gamertag. Sem nome, não há como casar com o perfil, então a linha é
    descartada: gravar por gamertag vazio criaria um jogador fantasma.
    """
    nome = str(row.get("name") or "").strip()
    if not nome:
        return None
    return {
        "club_id": str(club_id),
        "gamertag": nome,
        "jogos": to_int(row.get("gamesPlayed")),
        "gols": to_int(row.get("goals")),
        "assistencias": to_int(row.get("assists")),
        "melhor_em_campo": to_int(row.get("manOfTheMatch")),
        "nota": to_float(row.get("ratingAve")),
        "posicao": position(row.get("proPos")),
    }


def club_totals(row: dict[str, Any]) -> dict[str, Any]:
    """An all-time totals row, in domain-api's ``TotaisInput`` shape.

    Accepts either a search result (flat) or an overallStats item -- the two
    agree on every field name that matters, and both send numbers as text.
    """
    wins = to_int(row.get("wins"))
    draws = to_int(row.get("ties"))
    return {
        "club_id": str(row.get("clubId") or row.get("club_id") or ""),
        "jogos": to_int(row.get("gamesPlayed")),
        "vitorias": wins,
        "empates": draws,
        "derrotas": to_int(row.get("losses")),
        "gols": to_int(row.get("goals")),
        "gols_sofridos": to_int(row.get("goalsAgainst")),
        "jogos_sem_sofrer": to_int(row.get("cleanSheets")),
        # Points are not always sent; three-for-a-win is the league rule, so
        # deriving is safe and keeps the ranking consistent across sources.
        "pontos": to_int(row.get("points")) or (wins * 3 + draws),
        "divisao_atual": to_int(row.get("currentDivision")),
        "melhor_divisao": to_int(row.get("bestDivision")),
        # O search não traz skillRating (só o overallStats traz), então um
        # clube semeado pela busca entra com nível 0 e é corrigido no primeiro
        # ciclo, quando club_overall roda. Zero aqui é "ainda não lido", não um
        # nível real.
        "nivel": to_int(row.get("skillRating")),
        "promocoes": to_int(row.get("promotions")),
        "rebaixamentos": to_int(row.get("relegations")),
    }


def snapshot(row: dict[str, Any], team_size: int = 0) -> dict[str, Any]:
    """A level/division reading, in domain-api's ``SnapshotInput`` shape.

    ``tamanho_elenco`` lets a squad change be detected by diffing two
    snapshots without storing the roster twice.
    """
    base = club_totals(row)
    base["tamanho_elenco"] = team_size
    return {
        "club_id": base["club_id"],
        "nivel": base["nivel"],
        "divisao": base["divisao_atual"],
        "jogos": base["jogos"],
        "vitorias": base["vitorias"],
        "empates": base["empates"],
        "derrotas": base["derrotas"],
        "gols": base["gols"],
        "gols_sofridos": base["gols_sofridos"],
        "tamanho_elenco": team_size,
    }


def _initials(name: str) -> str:
    """A three-letter short name for the dense tables and the crests."""
    cleaned = re.sub(r"[^A-Za-zÀ-ÿ]", "", name or "")
    return cleaned[:3].upper() if cleaned else ""


def match_payload(match: dict[str, Any], club_id: str) -> dict[str, Any] | None:
    """One match normalized for domain-api, from ONE club's point of view.

    The source returns both clubs and both squads in the same match object, so
    this produces the whole payload at once -- domain-api's ``partida.upsert``
    takes the match plus BOTH sides' player lines, because a match without its
    summary is not a valid match. Idempotent by ``match_id``, so the second
    club's view updates rather than duplicating.
    """
    clubs = match.get("clubs") or {}
    us = clubs.get(club_id)
    if not us:
        return None

    them_id = ""
    them: dict[str, Any] = {}
    for other_id, block in clubs.items():
        if str(other_id) != str(club_id):
            them_id, them = str(other_id), block or {}
            break
    if not them_id:
        return None

    our_goals = to_int(us.get("goals"))
    their_goals = to_int(us.get("goalsAgainst"))
    result = result_from_club(us, our_goals, their_goals)
    dnf, winner = is_dnf(us, them)

    players = match.get("players") or {}
    lines: list[dict[str, Any]] = []
    raw_lines: list[dict[str, Any]] = []
    for side_club, squad in players.items():
        for player_id, stats in (squad or {}).items():
            # Estatística nula: jogador pulado, partida preservada. Ver
            # player_line_opt -- deixar estourar custava o clube inteiro.
            line = player_line_opt(stats, str(side_club), str(player_id))
            if line is None:
                continue
            lines.append(line)
            # Keep the raw dict too: the timeline is built from the event
            # aggregates, which player_line intentionally drops.
            raw_lines.append({**stats, "player_id": str(player_id)})

    home_id = str(club_id)
    # The source does not label home/away reliably across match types, so the
    # requested club is treated as "casa" and the result field is oriented
    # accordingly -- the API's ``resultado_casa`` is always from the requester.
    return {
        "match_id": str(match.get("matchId") or ""),
        "timestamp": timestamp(match.get("timestamp")),
        "tipo": match_type(us.get("matchType")),
        "rodada_playoff": str(match.get("playoffRound") or ""),
        "clube_casa_id": home_id,
        "clube_fora_id": them_id,
        "gols_casa": our_goals,
        "gols_fora": their_goals,
        "houve_desistencia": dnf,
        "vencedor_por_desistencia_id": winner,
        "resultado_casa": result,
        "lances": timeline_from_lines(raw_lines),
        "jogadores": lines,
    }


def player_line_opt(stats: dict[str, Any] | None, club_id: str, player_id: str) -> dict[str, Any] | None:
    """``player_line`` tolerante a estatística ausente.

    A fonte manda ``null`` no lugar das estatísticas de um jogador em algumas
    partidas -- provavelmente alguém que saiu antes do apito. Deixar isso
    estourar derrubava o clube INTEIRO no ciclo (sem identidade, totais,
    partidas nem snapshot), e o erro só aparecia como um AttributeError seco no
    log. Um jogador sem dados é um jogador pulado, não uma partida perdida.
    """
    if not isinstance(stats, dict):
        return None
    return player_line(stats, club_id, player_id)


def opponent_club_id(match: dict[str, Any], club_id: str) -> str | None:
    """The other club in a match payload -- needed to enqueue discovery of
    clubs the person never played against directly."""
    opp = opponent_club(match, club_id)
    return opp[0] if opp else None


def opponent_club(match: dict[str, Any], club_id: str) -> tuple[str, str] | None:
    """O adversário como (id, nome).

    O nome não é enfeite: a busca da fonte -- a única que traz divisão e os
    totais -- só aceita NOME. Descobrir o adversário sem ele deixava a
    descoberta vazia em silêncio. O nome vive no ``details.name`` do próprio
    payload da partida, então vem de graça junto do id.

    Devolve None quando o clube pedido não está na partida: dizer "o outro" de
    um clube ausente escolheria um lado arbitrário, e a descoberta gravaria o
    clube errado.
    """
    clubs = match.get("clubs") or {}
    if str(club_id) not in {str(k) for k in clubs}:
        return None
    for other_id, bloco in clubs.items():
        if str(other_id) == str(club_id):
            continue
        nome = str(obj(bloco, "details").get("name") or "")
        return str(other_id), nome
    return None
