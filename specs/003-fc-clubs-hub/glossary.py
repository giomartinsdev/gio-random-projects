#!/usr/bin/env python3
"""Glossário pt→en do domínio clubs.

É a FONTE DE VERDADE da renomeação: todas as camadas (SQL, Go, Python, TS)
aplicam este mesmo mapa, senão cada uma traduz diferente e o contrato quebra.
Um termo só pode ter UMA tradução -- se aparecer ambíguo, ele é decidido aqui.

Uso: `python3 glossary.py` valida que não há colisão (dois termos pt virando o
mesmo en, ou um en colidindo com um identificador que já existe).
"""

# --- domínio do clube ------------------------------------------------------
CLUB = {
    "nome": "name",
    "sigla": "tag",
    "estadio": "stadium",
    "escudo_asset_id": "crest_asset_id",
    "cor_1": "color_1",
    "cor_2": "color_2",
    "cor_3": "color_3",
    "cor_4": "color_4",
    "acompanhado": "tracked",
    "atualizado_em": "updated_at",
    "regiao_id": "region_id",
    "time_id": "team_id",
}

# --- totais ----------------------------------------------------------------
TOTALS = {
    "jogos": "played",
    "vitorias": "wins",
    "empates": "draws",
    "derrotas": "losses",
    "gols": "goals",
    "gols_sofridos": "goals_conceded",
    "jogos_sem_sofrer": "clean_sheets",
    "pontos": "points",
    "divisao_atual": "division",
    "melhor_divisao": "best_division",
    "nivel": "skill_rating",
    "promocoes": "promotions",
    "rebaixamentos": "relegations",
    "lido_em": "read_at",
    "aproveitamento": "win_rate",
}

# --- partida ---------------------------------------------------------------
MATCH = {
    "tipo": "kind",
    "rodada_playoff": "playoff_round",
    "clube_casa_id": "home_club_id",
    "clube_fora_id": "away_club_id",
    "gols_casa": "home_goals",
    "gols_fora": "away_goals",
    "houve_desistencia": "decided_by_forfeit",
    "vencedor_por_desistencia_id": "forfeit_winner_id",
    "resultado_casa": "home_result",
    "lances": "events",
    "criado_em": "created_at",
    "nosso_lado": "our_side",
    "nosso_resultado": "our_result",
    "nossos_gols": "our_goals",
    "gols_deles": "their_goals",
    "adversario_id": "opponent_id",
    "adversario_nome": "opponent_name",
    "adversario_sigla": "opponent_tag",
    "nota_agregada": "avg_rating",
    "clube_casa_nome": "home_club_name",
    "clube_casa_sigla": "home_club_tag",
    "clube_fora_nome": "away_club_name",
    "clube_fora_sigla": "away_club_tag",
    "partida_id": "match_id_uuid",
}

# --- jogador ---------------------------------------------------------------
PLAYER = {
    "posicao": "position",
    "nota": "rating",
    "assistencias": "assists",
    "chutes": "shots",
    "passes_certos": "passes_made",
    "passes_tentados": "passes_attempted",
    "desarmes_certos": "tackles_made",
    "desarmes_tentados": "tackles_attempted",
    "defesas": "saves",
    "defesas_por_tipo": "saves_by_type",
    "segundos_jogados": "seconds_played",
    "melhor_em_campo": "man_of_the_match",
    "cartao_vermelho": "red_card",
    "jogo_sem_sofrer_gol": "clean_sheet",
    "goleiro": "goalkeeper",
    "forma": "form",
    "gols_por_jogo": "goals_per_game",
    "assistencias_por_jogo": "assists_per_game",
    "passes_precisao": "pass_accuracy",
    "desarmes_precisao": "tackle_accuracy",
    "cartoes_vermelhos": "red_cards",
    "clube_nome": "club_name",
    "club_sigla": "club_tag",
    "clube_id": "club_id",
    "gamertag": "gamertag",
}

# --- histórico / recordes --------------------------------------------------
HISTORY = {
    # `divisao` (snapshot) e `divisao_atual` (totais) são conceitos distintos:
    # o snapshot é uma LEITURA datada, os totais são o estado corrente. Por isso
    # não podem virar o mesmo nome -- o validador pegou essa colisão.
    "divisao": "division_at_read",
    "tamanho_elenco": "squad_size",
    "detectado_em": "detected_at",
    "de": "from_division",
    "para": "to_division",
    "recordes": "records",
    "maior_goleada": "biggest_win",
    "pior_derrota": "worst_loss",
    "jogo_com_mais_gols": "highest_scoring_match",
    "melhor_nota": "best_rating",
    "mais_gols_em_um_jogo": "most_goals_in_match",
    "total_partidas": "total_matches",
    "total_gols": "total_goals",
    "maior_sequencia_vitorias": "longest_win_streak",
    "ultimo_jogo": "last_match",
    "sequencia": "streak",
    "invicta": "unbeaten",
    "clube_a": "club_a",
    "clube_b": "club_b",
    "vitorias_a": "wins_a",
    "gols_a": "goals_a",
    "gols_b": "goals_b",
    "derrotas_a": "losses_a",
    "forma_a": "form_a",
    "gols_contra": "goals_against",
    "mudancas_divisao": "division_changes",
    "por_divisao": "by_division",
}

# --- anúncios / ranking ----------------------------------------------------
FEED = {
    "titulo": "title",
    "texto": "body",
    "icone": "icon",
    # `gerado_em` (anúncio) e `criado_em` (partida) são fatos diferentes: um
    # anúncio é GERADO a partir de um resultado, uma partida é CRIADA quando
    # entra na base. O validador pegou a colisão.
    "gerado_em": "generated_at",
    "expira_em": "expires_at",
    "referencia_id": "reference_id",
    "metrica": "metric",
    "clubes": "clubs",
    "anuncios": "announcements",
    "jogadores": "players",
    "total": "total",
    "nossos": "our",
}

# --- preferências / sync ---------------------------------------------------
PREFS = {
    "usuario_email": "user_email",
    "canal": "channel",
    "resumo_periodico": "weekly_digest",
    "recordes_e_divisoes": "records_and_divisions",
    "resultado_partidas": "match_results",
    "seguindo_desde": "tracked_since",
    "origem": "source",
    "verificado": "verified",
    "reivindicado_em": "claimed_at",
    "rodando": "running",
    "nivel_atual": "current_level",
    "concluidos": "completed",
    "atual": "current",
    "novos": "new_items",
    "iniciado_em": "started_at",
    "concluido_em": "finished_at",
    "proprio": "own",
    "rival": "rival",
    "rival_de_rival": "rival_of_rival",
    "manual": "manual",
}

# --- admin / ingestão ------------------------------------------------------
ADMIN = {
    "rodadas": "cycles",
    "clubes_ok": "clubs_ok",
    "clubes_falhos": "clubs_failed",
    "partidas_novas": "new_matches",
    "snapshots": "snapshots",
    "bootstrap_feito": "bootstrapped",
    "ultimo_erro": "last_error",
    "ultimo_erro_em": "last_error_at",
    "ultimo_ciclo_em": "last_cycle_at",
    "vivo": "alive",
    "clubes_total": "clubs_total",
    "clubes_acompanhados": "clubs_tracked",
    "clubes_pendentes": "clubs_pending",
    "partidas": "matches",
    "top_clubes": "top_clubs",
    "ultima_partida": "last_match_at",
    "clubes_acompanhados_total": "clubs_tracked_total",
    "clubes_liberados": "clubs_unlocked",
}

# --- filas (sync/fetch/search) --------------------------------------------
QUEUE = {
    "alvo": "target",
    "alvo_id": "target_id",
    "rotulo": "label",
    "erro": "error",
    "solicitado_em": "requested_at",
    "encontrados": "found",
    "squad": "squad",
}

# --- agregados ------------------------------------------------------------
# Vocabulário de VALOR (não de nome): aparece no CHECK do banco e nos payloads,
# e a origem usa códigos numéricos que já são normalizados para isto. Sem
# traduzir, o CHECK continuaria aceitando 'vitoria' e o contrato ficaria misto.
VALUES = {
    "vitoria": "win",
    "empate": "draw",
    "derrota": "loss",
    "liga": "league",
    "amistoso": "friendly",
    "playoff": "playoff",
    "promocao": "promotion",
    "rebaixamento": "relegation",
    "defensor": "defender",
    "meio": "midfielder",
    "atacante": "forward",
    "casa": "home",
    "fora": "away",
}

ALL = {}
for _m in (CLUB, TOTALS, MATCH, PLAYER, HISTORY, FEED, PREFS, ADMIN, QUEUE, VALUES):
    for _k, _v in _m.items():
        assert _k not in ALL, f"termo pt duplicado no glossário: {_k}"
        ALL[_k] = _v


def validate():
    """Colisões silenciosas viram bug de contrato: dois termos pt virando o
    mesmo en (perde-se um), ou um en igual a um pt que também é renomeado."""
    inv = {}
    for pt, en in ALL.items():
        if en in inv:
            raise SystemExit(f"COLISÃO: '{pt}' e '{inv[en]}' viram '{en}'")
        inv[en] = pt
    return ALL


if __name__ == "__main__":
    g = validate()
    print(f"glossário OK: {len(g)} termos, sem colisão")
