package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// Analytics: leituras derivadas do acervo acumulado, sem schema novo.
//
// Cada função aqui responde a uma pergunta que a FONTE não responde -- porque
// ela só enxerga a janela recente de um clube. O que sustenta todas é o
// histórico que o worker acumula em clubs_matches / clubs_match_players.

// SeasonOf agrupa as partidas de um clube por temporada, com os artilheiros de
// cada uma. A temporada é derivada da DATA (a fonte manda season_id="0").
func (r *ClubsRepository) ClubSeasons(ctx context.Context, clubID string) (domainclubs.SeasonList, error) {
	matches, err := r.ListMatches(ctx, clubID, "", 1000)
	if err != nil {
		return domainclubs.SeasonList{}, err
	}
	// As linhas de jogador de todas as partidas do clube, para os artilheiros.
	rows, err := r.allPlayerRows(ctx, "WHERE l.club_id = $1", clubID)
	if err != nil {
		return domainclubs.SeasonList{}, err
	}

	// Acumula por (temporada) e, dentro dela, por jogador.
	type scorerAcc struct {
		played, goals, assists int
		ratingSum              float64
	}
	type seasonAcc struct {
		played, wins, draws, losses, goals, against int
		scorers                                     map[string]*scorerAcc
	}
	bySeason := map[string]*seasonAcc{}
	season := func(s string) *seasonAcc {
		a, ok := bySeason[s]
		if !ok {
			a = &seasonAcc{scorers: map[string]*scorerAcc{}}
			bySeason[s] = a
		}
		return a
	}

	for _, m := range matches {
		a := season(seasonLabel(m.Timestamp))
		a.played++
		a.goals += m.OurGoals
		a.against += m.TheirGoals
		switch m.OurResult {
		case "win":
			a.wins++
		case "loss":
			a.losses++
		default:
			a.draws++
		}
	}

	for _, pr := range rows {
		s := seasonLabel(pr.match.Timestamp)
		a := season(s)
		sc, ok := a.scorers[pr.line.PlayerID]
		if !ok {
			sc = &scorerAcc{}
			a.scorers[pr.line.PlayerID] = sc
		}
		sc.played++
		sc.goals += pr.line.Goals
		sc.assists += pr.line.Assists
		sc.ratingSum += pr.line.Rating
	}

	labels := make([]string, 0, len(bySeason))
	for s := range bySeason {
		labels = append(labels, s)
	}
	// "AAAA/AA" ordena lexicograficamente igual a cronologicamente.
	sort.Strings(labels)

	out := domainclubs.SeasonList{Seasons: make([]domainclubs.SeasonSummary, 0, len(labels))}
	for _, s := range labels {
		a := bySeason[s]
		sum := domainclubs.SeasonSummary{
			Season: s, Played: a.played, Wins: a.wins, Draws: a.draws, Losses: a.losses,
			Goals: a.goals, Against: a.against,
		}
		for pid, sc := range a.scorers {
			name := ""
			for _, pr := range rows {
				if pr.line.PlayerID == pid {
					name = pr.line.Gamertag
					break
				}
			}
			rating := 0.0
			if sc.played > 0 {
				rating = round2(sc.ratingSum / float64(sc.played))
			}
			sum.Scorers = append(sum.Scorers, domainclubs.SeasonScorer{
				PlayerID: pid, Gamertag: name, Played: sc.played,
				Goals: sc.goals, Assists: sc.assists, Rating: rating,
			})
		}
		// Artilheiro primeiro; empate pela nota.
		sort.Slice(sum.Scorers, func(i, j int) bool {
			if sum.Scorers[i].Goals != sum.Scorers[j].Goals {
				return sum.Scorers[i].Goals > sum.Scorers[j].Goals
			}
			return sum.Scorers[i].Rating > sum.Scorers[j].Rating
		})
		out.Seasons = append(out.Seasons, sum)
	}
	if len(labels) > 0 {
		out.Current = labels[len(labels)-1]
	}
	return out, nil
}

// PositionHeatmap conta jogadores DISTINTOS por posição. O time joga em
// posições; o heatmap mostra como o elenco se distribui por elas.
func (r *ClubsRepository) PositionHeatmap(ctx context.Context, clubID string) (domainclubs.PositionHeatmap, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.position, count(DISTINCT l.player_id)
		FROM clubs_match_players l
		WHERE l.club_id = $1
		GROUP BY l.position`, clubID)
	if err != nil {
		return domainclubs.PositionHeatmap{}, fmt.Errorf("heatmap de posição: %w", err)
	}
	defer rows.Close()

	h := domainclubs.PositionHeatmap{Buckets: make([]domainclubs.PositionCount, 0, 4)}
	for rows.Next() {
		var p domainclubs.PositionCount
		if err := rows.Scan(&p.Position, &p.Players); err != nil {
			return h, fmt.Errorf("scan heatmap: %w", err)
		}
		h.Buckets = append(h.Buckets, p)
		h.Total += p.Players
	}
	// Ordem fixa (goleiro -> ataque), não alfabética: é a leitura do campo.
	ordem := map[string]int{"goalkeeper": 0, "defender": 1, "midfielder": 2, "forward": 3}
	sort.Slice(h.Buckets, func(i, j int) bool {
		return ordem[h.Buckets[i].Position] < ordem[h.Buckets[j].Position]
	})
	return h, rows.Err()
}

// SquadComparison compara o elenco da temporada corrente com o da anterior.
// "Saiu" = apareceu na anterior e não na corrente; "entrou" = o inverso.
func (r *ClubsRepository) SquadComparison(ctx context.Context, clubID string) (domainclubs.SquadComparison, error) {
	rows, err := r.allPlayerRows(ctx, "WHERE l.club_id = $1", clubID)
	if err != nil {
		return domainclubs.SquadComparison{}, err
	}
	if len(rows) == 0 {
		return domainclubs.SquadComparison{}, nil
	}

	// A temporada corrente e a anterior, das datas presentes.
	seasonsSet := map[string]bool{}
	for _, pr := range rows {
		seasonsSet[seasonLabel(pr.match.Timestamp)] = true
	}
	labels := make([]string, 0, len(seasonsSet))
	for s := range seasonsSet {
		labels = append(labels, s)
	}
	sort.Strings(labels)
	current := labels[len(labels)-1]
	previous := ""
	if len(labels) >= 2 {
		previous = labels[len(labels)-2]
	}
	out := domainclubs.SquadComparison{From: previous, To: current}
	if previous == "" {
		// Só uma temporada: não há o que comparar ainda.
		return out, nil
	}

	type info struct {
		gamertag, position string
		goals              int
	}
	curr := map[string]info{}
	prev := map[string]info{}
	for _, pr := range rows {
		s := seasonLabel(pr.match.Timestamp)
		switch s {
		case current:
			i := curr[pr.line.PlayerID]
			i.gamertag, i.position = pr.line.Gamertag, pr.line.Position
			i.goals += pr.line.Goals
			curr[pr.line.PlayerID] = i
		case previous:
			i := prev[pr.line.PlayerID]
			i.gamertag, i.position = pr.line.Gamertag, pr.line.Position
			i.goals += pr.line.Goals
			prev[pr.line.PlayerID] = i
		}
	}
	for pid, i := range curr {
		if _, ficou := prev[pid]; ficou {
			out.Stayed++
			continue
		}
		out.Entries = append(out.Entries, domainclubs.SquadChange{
			PlayerID: pid, Gamertag: i.gamertag, Position: i.position, Goals: i.goals, Kind: "entrou",
		})
	}
	for pid, i := range prev {
		if _, ficou := curr[pid]; ficou {
			continue
		}
		out.Exits = append(out.Exits, domainclubs.SquadChange{
			PlayerID: pid, Gamertag: i.gamertag, Position: i.position, Goals: i.goals, Kind: "saiu",
		})
	}
	sort.Slice(out.Entries, func(i, j int) bool { return out.Entries[i].Goals > out.Entries[j].Goals })
	sort.Slice(out.Exits, func(i, j int) bool { return out.Exits[i].Goals > out.Exits[j].Goals })
	return out, nil
}

// TeamOfWeek monta o melhor XI da SEMANA: para cada posição, o jogador de maior
// nota média nas partidas dos últimos 7 dias.
//
// Por que "semana": é a janela que dá um recorte fresco -- o clube joga algumas
// vezes por semana, e uma janela maior viraria "melhores da temporada", que já
// existe na aba Números. Se a semana não tiver jogos, devolve vazio (a tela
// explica), em vez de cair para uma janela maior silenciosamente.
func (r *ClubsRepository) TeamOfWeek(ctx context.Context, clubID string, since time.Time) (domainclubs.TeamOfWeek, error) {
	rows, err := r.allPlayerRows(ctx,
		`WHERE l.club_id = $1 AND m.timestamp >= $2`, clubID, since)
	if err != nil {
		return domainclubs.TeamOfWeek{}, err
	}
	out := domainclubs.TeamOfWeek{Since: since}
	if len(rows) == 0 {
		return out, nil
	}

	// Acumula por (posição, jogador) dentro da janela.
	type acc struct {
		member    domainclubs.SquadMember
		ratingSum float64
	}
	byPos := map[string]map[string]*acc{}
	for _, pr := range rows {
		pos := pr.line.Position
		if byPos[pos] == nil {
			byPos[pos] = map[string]*acc{}
		}
		a := byPos[pos][pr.line.PlayerID]
		if a == nil {
			a = &acc{member: domainclubs.SquadMember{
				PlayerID: pr.line.PlayerID, Gamertag: pr.line.Gamertag, Position: pos,
				Goalkeeper: pos == "goalkeeper",
			}}
			byPos[pos][pr.line.PlayerID] = a
		}
		m := &a.member
		m.Played++
		m.Goals += pr.line.Goals
		m.Assists += pr.line.Assists
		m.Rating += pr.line.Rating // soma; divide no fim
		a.ratingSum += pr.line.Rating
		if pr.line.ManOfTheMatch {
			m.ManOfTheMatch++
		}
	}

	// O melhor de cada posição, por nota média.
	ordem := []string{"goalkeeper", "defender", "midfielder", "forward"}
	for _, pos := range ordem {
		players := byPos[pos]
		if len(players) == 0 {
			continue
		}
		var best *acc
		for _, a := range players {
			if best == nil || (a.ratingSum/float64(a.member.Played)) > (best.ratingSum/float64(best.member.Played)) {
				best = a
			}
		}
		best.member.Rating = round2(best.ratingSum / float64(best.member.Played))
		out.Players = append(out.Players, best.member)
	}
	return out, nil
}

// RegionBreakdown conta os clubes por região -- "clubes perto de mim" por
// região da fonte (não há geolocalização na EA, só o region_id).
func (r *ClubsRepository) RegionBreakdown(ctx context.Context) ([]domainclubs.RegionCount, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT region_id,
		       count(*) AS clubs,
		       count(*) FILTER (WHERE tracked) AS tracked,
		       (array_agg(name ORDER BY COALESCE(skill_rating_of, 0) DESC))[1] AS top_name
		FROM (
			SELECT c.region_id, c.tracked, c.name, t.skill_rating AS skill_rating_of
			FROM clubs c LEFT JOIN clubs_totais t ON t.club_id = c.club_id
			WHERE c.region_id <> ''
		) x
		GROUP BY region_id
		ORDER BY clubs DESC`)
	if err != nil {
		return nil, fmt.Errorf("regiões: %w", err)
	}
	defer rows.Close()
	var out []domainclubs.RegionCount
	for rows.Next() {
		var rc domainclubs.RegionCount
		var top *string
		if err := rows.Scan(&rc.RegionID, &rc.Clubs, &rc.Tracked, &top); err != nil {
			return nil, fmt.Errorf("scan região: %w", err)
		}
		if top != nil {
			rc.TopName = *top
		}
		out = append(out, rc)
	}
	return out, rows.Err()
}

// RollingGoals devolve gols pró e contra por partida, na ordem cronológica --
// a série do gráfico de "gols pró vs contra".
func (r *ClubsRepository) RollingGoals(ctx context.Context, clubID string, limit int) (domainclubs.RollingGoals, error) {
	if limit <= 0 {
		limit = 20
	}
	matches, err := r.ListMatches(ctx, clubID, "", limit)
	if err != nil {
		return domainclubs.RollingGoals{}, err
	}
	// ListMatches devolve do mais recente para o mais antigo; o gráfico lê da
	// esquerda para a direita, então invertemos.
	out := domainclubs.RollingGoals{Matches: make([]domainclubs.RollingGoalsPoint, 0, len(matches))}
	for i := len(matches) - 1; i >= 0; i-- {
		m := matches[i]
		out.Matches = append(out.Matches, domainclubs.RollingGoalsPoint{
			MatchID: m.MatchID, Timestamp: m.Timestamp, Opponent: m.OpponentName,
			Our: m.OurGoals, Their: m.TheirGoals, Result: m.OurResult,
		})
	}
	return out, nil
}

// MainRival devolve o adversário mais frequente com o retrospecto -- a
// "rivalidade principal", derivada do acervo (não de uma escolha manual).
func (r *ClubsRepository) MainRival(ctx context.Context, clubID string) (*domainclubs.MainRival, error) {
	matches, err := r.ListMatches(ctx, clubID, "", 1000)
	if err != nil {
		return nil, err
	}
	type acc struct {
		name      string
		tag       string
		v, e, d   int
		goals, ag int
		last      time.Time
	}
	byOpp := map[string]*acc{}
	for _, m := range matches {
		if m.AdversarioID == "" {
			continue
		}
		a := byOpp[m.AdversarioID]
		if a == nil {
			a = &acc{}
			byOpp[m.AdversarioID] = a
		}
		a.name, a.tag = m.OpponentName, m.OpponentTag
		a.goals += m.OurGoals
		a.ag += m.TheirGoals
		switch m.OurResult {
		case "win":
			a.v++
		case "loss":
			a.d++
		default:
			a.e++
		}
		if m.Timestamp.After(a.last) {
			a.last = m.Timestamp
		}
	}
	var best *domainclubs.MainRival
	for id, a := range byOpp {
		total := a.v + a.e + a.d
		if best == nil || total > best.Matches {
			best = &domainclubs.MainRival{
				Adversario: domainclubs.Adversario{
					ClubID: id, Name: a.name, Tag: a.tag, Played: total,
					V: a.v, E: a.e, D: a.d, Goals: a.goals, GoalsAgainst: a.ag, LastMatch: a.last,
				},
				Matches: total,
			}
		}
	}
	return best, nil
}

// IdleSince devolve há quanto tempo o clube não joga -- derivado da última
// partida no acervo.
func (r *ClubsRepository) IdleSince(ctx context.Context, clubID string) (domainclubs.ClubIdle, error) {
	var last *time.Time
	if err := r.pool.QueryRow(ctx, `
		SELECT max(timestamp) FROM clubs_matches
		WHERE home_club_id = $1 OR away_club_id = $1`, clubID).Scan(&last); err != nil {
		return domainclubs.ClubIdle{}, fmt.Errorf("inatividade: %w", err)
	}
	out := domainclubs.ClubIdle{LastMatch: last}
	if last != nil {
		out.Days = int(time.Since(*last).Hours() / 24)
		// Acima de 7 dias sem jogar, o clube está "parado" -- um clube ativo
		// joga várias vezes por semana.
		out.Idle = out.Days >= 7
	}
	return out, nil
}

// RatingEvolution devolve as notas de um jogador por partida, cronológico.
func (r *ClubsRepository) RatingEvolution(ctx context.Context, playerID string) (domainclubs.PlayerRatingEvolution, error) {
	rows, err := r.allPlayerRows(ctx, "WHERE l.player_id = $1", playerID)
	if err != nil {
		return domainclubs.PlayerRatingEvolution{}, err
	}
	out := domainclubs.PlayerRatingEvolution{Points: make([]domainclubs.RatingPoint, 0, len(rows))}
	for _, pr := range rows {
		opp := pr.match.CasaNome
		if pr.match.ClubeCasaID == pr.line.ClubID {
			opp = pr.match.ForaNome
		}
		// O resultado do JOGADOR é o do lado dele: o `home_result` é do mandante,
		// então invertemos quando ele era visitante.
		res := pr.match.HomeResult
		if pr.match.ClubeForaID == pr.line.ClubID {
			res = inverteResultado(res)
		}
		out.Points = append(out.Points, domainclubs.RatingPoint{
			MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp, Opponent: opp,
			Rating: pr.line.Rating, Goals: pr.line.Goals, Assists: pr.line.Assists,
			Result: res,
		})
	}
	return out, nil
}

// inverteResultado troca vitória por derrota (o empate não muda) -- usado quando
// o clube era o visitante e o resultado guardado é o do mandante.
func inverteResultado(r string) string {
	switch r {
	case "win":
		return "loss"
	case "loss":
		return "win"
	default:
		return r
	}
}

// Consistency calcula média, desvio e volatilidade das notas de um jogador.
func (r *ClubsRepository) Consistency(ctx context.Context, playerID string) (domainclubs.PlayerConsistency, error) {
	rows, err := r.allPlayerRows(ctx, "WHERE l.player_id = $1", playerID)
	if err != nil {
		return domainclubs.PlayerConsistency{}, err
	}
	c := domainclubs.PlayerConsistency{Played: len(rows)}
	if len(rows) == 0 {
		return c, nil
	}
	var sum float64
	c.Best, c.Worst = rows[0].line.Rating, rows[0].line.Rating
	for _, pr := range rows {
		sum += pr.line.Rating
		if pr.line.Rating > c.Best {
			c.Best = pr.line.Rating
		}
		if pr.line.Rating < c.Worst {
			c.Worst = pr.line.Rating
		}
	}
	c.Mean = round2(sum / float64(len(rows)))
	var sq float64
	for _, pr := range rows {
		d := pr.line.Rating - c.Mean
		sq += d * d
	}
	c.StdDev = round2(math.Sqrt(sq / float64(len(rows))))
	// Volatilidade normalizada: desvio sobre a média. Comparável entre jogadores
	// com médias diferentes.
	if c.Mean > 0 {
		c.Volatility = round2(c.StdDev / c.Mean * 100)
	}
	return c, nil
}

// Discipline agrega cartões e clean sheets de um jogador.
func (r *ClubsRepository) Discipline(ctx context.Context, playerID string) (domainclubs.PlayerDiscipline, error) {
	var d domainclubs.PlayerDiscipline
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE red_card), count(*), count(*) FILTER (WHERE clean_sheet)
		FROM clubs_match_players WHERE player_id = $1`, playerID).
		Scan(&d.RedCards, &d.Matches, &d.CleanSheet)
	if err != nil {
		return d, fmt.Errorf("disciplina: %w", err)
	}
	return d, nil
}

// Tenures devolve por quanto tempo o jogador ficou em cada clube, da primeira
// à última aparição.
func (r *ClubsRepository) Tenures(ctx context.Context, playerID string) ([]domainclubs.PlayerClubTenure, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.club_id, COALESCE(c.name, ''), min(m.timestamp), max(m.timestamp), count(*)
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.match_id_uuid
		LEFT JOIN clubs c ON c.club_id = l.club_id
		WHERE l.player_id = $1
		GROUP BY l.club_id, c.name
		ORDER BY min(m.timestamp) DESC`, playerID)
	if err != nil {
		return nil, fmt.Errorf("tenures: %w", err)
	}
	defer rows.Close()
	var out []domainclubs.PlayerClubTenure
	for rows.Next() {
		var t domainclubs.PlayerClubTenure
		if err := rows.Scan(&t.ClubID, &t.ClubName, &t.FirstSeen, &t.LastSeen, &t.Matches); err != nil {
			return nil, fmt.Errorf("scan tenure: %w", err)
		}
		t.Days = int(t.LastSeen.Sub(t.FirstSeen).Hours() / 24)
		out = append(out, t)
	}
	return out, rows.Err()
}

// EventsByPlayer agrega os tipos de evento de um jogador de todas as partidas.
// A fonte não dá o MINUTO do evento, só o tipo e a contagem -- por isso é um
// heatmap de TIPO, não de tempo.
func (r *ClubsRepository) EventsByPlayer(ctx context.Context, playerID string) (domainclubs.PlayerEventBreakdown, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT m.events FROM clubs_matches m
		JOIN clubs_match_players l ON l.match_id_uuid = m.id
		WHERE l.player_id = $1`, playerID)
	if err != nil {
		return domainclubs.PlayerEventBreakdown{}, fmt.Errorf("eventos: %w", err)
	}
	defer rows.Close()

	totals := map[string]int{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return domainclubs.PlayerEventBreakdown{}, err
		}
		// events é uma lista de {player_id, gamertag, eventos:[{label,quantidade}]}.
		var entries []struct {
			PlayerID string `json:"player_id"`
			Eventos  []struct {
				Label      string `json:"label"`
				Quantidade int    `json:"quantidade"`
			} `json:"eventos"`
		}
		if err := json.Unmarshal(raw, &entries); err != nil {
			continue
		}
		for _, e := range entries {
			if e.PlayerID != playerID {
				continue
			}
			for _, ev := range e.Eventos {
				totals[ev.Label] += ev.Quantidade
			}
		}
	}
	out := domainclubs.PlayerEventBreakdown{PlayerID: playerID}
	for label, count := range totals {
		out.Events = append(out.Events, domainclubs.EventSummary{Label: label, Count: count})
	}
	sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].Count > out.Events[j].Count })
	return out, rows.Err()
}

// BestByPosition devolve o melhor jogador (por nota média) de cada posição do
// clube.
func (r *ClubsRepository) BestByPosition(ctx context.Context, clubID string) ([]domainclubs.BestByPosition, error) {
	squad, err := r.Squad(ctx, clubID)
	if err != nil {
		return nil, err
	}
	best := map[string]domainclubs.SquadMember{}
	for _, s := range squad {
		cur, ok := best[s.Position]
		if !ok || s.Rating > cur.Rating {
			best[s.Position] = s
		}
	}
	ordem := map[string]int{"goalkeeper": 0, "defender": 1, "midfielder": 2, "forward": 3}
	out := make([]domainclubs.BestByPosition, 0, len(best))
	for pos, m := range best {
		out = append(out, domainclubs.BestByPosition{Position: pos, Player: m})
	}
	sort.Slice(out, func(i, j int) bool { return ordem[out[i].Position] < ordem[out[j].Position] })
	return out, nil
}

// HubReport monta o relatório público do acervo -- sem nada sensível.
func (r *ClubsRepository) HubReport(ctx context.Context) (domainclubs.HubReport, error) {
	var rep domainclubs.HubReport
	err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM clubs),
			(SELECT count(*) FROM clubs WHERE tracked = true),
			(SELECT count(*) FROM clubs_matches),
			(SELECT count(DISTINCT player_id) FROM clubs_match_players),
			(SELECT count(*) FROM clubs_snapshots),
			(SELECT min(timestamp) FROM clubs_matches),
			(SELECT max(timestamp) FROM clubs_matches)`).
		Scan(&rep.Clubs, &rep.TrackedClubs, &rep.Matches, &rep.Players,
			&rep.Snapshots, &rep.FirstMatch, &rep.LastMatch)
	if err != nil {
		return rep, fmt.Errorf("relatório do hub: %w", err)
	}
	if rep.FirstMatch != nil && rep.LastMatch != nil {
		rep.CoverageDays = int(rep.LastMatch.Sub(*rep.FirstMatch).Hours() / 24)
	}
	return rep, nil
}
