package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// ClubsRepository implements domain/clubs.Repository — read-only, matching
// what domain-api actually does with these tables. All aggregation (rankings,
// squad totals, records, h2h) happens here in SQL and Go rather than being
// materialized: at this scale a query beats an invalidation policy.
type ClubsRepository struct {
	pool *pgxpool.Pool
}

func NewClubsRepository(pool *pgxpool.Pool) *ClubsRepository {
	return &ClubsRepository{pool: pool}
}

// ---------------------------------------------------------------- clubes

const clubJoin = `
	SELECT c.club_id, c.name, c.tag, c.stadium, c.region_id, c.team_id, c.crest_asset_id,
	       c.color_1, c.color_2, c.color_3, c.color_4, c.tracked, c.updated_at,
	       COALESCE(t.played,0), COALESCE(t.wins,0), COALESCE(t.draws,0), COALESCE(t.losses,0),
	       COALESCE(t.goals,0), COALESCE(t.goals_conceded,0), COALESCE(t.clean_sheets,0),
	       COALESCE(t.points,0), COALESCE(t.division,0), COALESCE(t.best_division,0),
	       COALESCE(t.skill_rating,0), COALESCE(t.promotions,0), COALESCE(t.relegations,0)
	FROM clubs c
	LEFT JOIN clubs_totais t ON t.club_id = c.club_id`

func scanClub(row pgx.Row) (domainclubs.Club, error) {
	var c domainclubs.Club
	err := row.Scan(
		&c.ClubID, &c.Name, &c.Tag, &c.Stadium, &c.RegiaoID, &c.TimeID, &c.EscudoAssetID,
		&c.Color1, &c.Color2, &c.Color3, &c.Color4, &c.Tracked, &c.UpdatedAt,
		&c.Played, &c.Wins, &c.Draws, &c.Losses,
		&c.Goals, &c.GoalsConceded, &c.CleanSheets,
		&c.Points, &c.Division, &c.BestDivision,
		&c.SkillRating, &c.Promotions, &c.Relegations,
	)
	return c, err
}

// withAproveitamento fills the derived win-rate the ranking and the profile
// header both use.
func withAproveitamento(c domainclubs.Club) domainclubs.Club {
	if c.Played > 0 {
		c.WinRate = float64(c.Points) / float64(c.Played*3) * 100
	}
	return c
}

// withForm fills each club's recent form from its persisted matches. The list
// and search paths need it just as much as the profile does -- without this,
// the directory shows "sem jogos" for every row, which reads as missing data
// rather than as "no matches in this window".
func (r *ClubsRepository) withForm(ctx context.Context, clubs []domainclubs.Club) []domainclubs.Club {
	for i := range clubs {
		matches, err := r.ListMatches(ctx, clubs[i].ClubID, "", domainclubs.RecentMatchWindow)
		if err != nil {
			continue
		}
		form := make([]string, 0, len(matches))
		for _, m := range matches {
			form = append(form, m.OurResult)
		}
		clubs[i].Form = form
	}
	return clubs
}

func (r *ClubsRepository) ListClubs(ctx context.Context, onlyFollowed bool) ([]domainclubs.Club, error) {
	q := clubJoin
	if onlyFollowed {
		q += ` WHERE c.tracked = true`
	}
	q += ` ORDER BY COALESCE(t.skill_rating,0) DESC, c.name`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list clubs: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Club
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, fmt.Errorf("scan club: %w", err)
		}
		list = append(list, withAproveitamento(c))
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	// Close before withForm: it issues its own queries, and an open pgx.Rows
	// holds a pooled connection — leaving it open here deadlocks the pool.
	rows.Close()
	return r.withForm(ctx, list), nil
}

func (r *ClubsRepository) GetClub(ctx context.Context, clubID string) (domainclubs.Club, error) {
	row := r.pool.QueryRow(ctx, clubJoin+` WHERE c.club_id = $1`, clubID)
	c, err := scanClub(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclubs.Club{}, domainclubs.ErrNotFound
	}
	if err != nil {
		return domainclubs.Club{}, fmt.Errorf("get club: %w", err)
	}
	return withAproveitamento(c), nil
}

// SearchClubs is accent- and case-insensitive (unaccent-style folding done
// in Go, since the dataset is small enough to filter after the SQL LIKE).
func (r *ClubsRepository) SearchClubs(ctx context.Context, query string) ([]domainclubs.Club, error) {
	rows, err := r.pool.Query(ctx, clubJoin+` ORDER BY COALESCE(t.skill_rating,0) DESC, c.name`)
	if err != nil {
		return nil, fmt.Errorf("search clubs: %w", err)
	}
	defer rows.Close()

	needle := foldAccents(query)
	var list []domainclubs.Club
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, fmt.Errorf("scan club: %w", err)
		}
		if needle == "" || strings.Contains(foldAccents(c.Name), needle) {
			list = append(list, withAproveitamento(c))
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // see ListClubs: withForm needs the connection back
	return r.withForm(ctx, list), nil
}

func (r *ClubsRepository) SearchClubsLite(ctx context.Context, query string, limit int) ([]domainclubs.Club, error) {
	list, err := r.SearchClubs(ctx, query)
	if err != nil {
		return nil, err
	}
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list, nil
}

// --------------------------------------------------------------- partidas

const matchSelect = `
	SELECT m.id, m.match_id, m.timestamp, m.kind, m.playoff_round,
	       m.home_club_id, m.away_club_id, m.home_goals, m.away_goals,
	       m.decided_by_forfeit, m.forfeit_winner_id, m.home_result, m.events,
	       COALESCE(cc.name,''), COALESCE(cc.tag,''), COALESCE(cf.name,''), COALESCE(cf.tag,''),
	       COALESCE(ag.rating, 0)
	FROM clubs_matches m
	LEFT JOIN clubs cc ON cc.club_id = m.home_club_id
	LEFT JOIN clubs cf ON cf.club_id = m.away_club_id
	LEFT JOIN (
		SELECT match_id_uuid, round(avg(rating)::numeric, 2) AS rating
		FROM clubs_match_players GROUP BY match_id_uuid
	) ag ON ag.match_id_uuid = m.id`

func scanMatch(row pgx.Row) (domainclubs.Match, error) {
	var m domainclubs.Match
	var events []byte
	err := row.Scan(
		&m.ID, &m.MatchID, &m.Timestamp, &m.Kind, &m.PlayoffRound,
		&m.ClubeCasaID, &m.ClubeForaID, &m.HomeGoals, &m.AwayGoals,
		&m.DecidedByForfeit, &m.VencedorPorDesistenciaID, &m.HomeResult, &events,
		&m.CasaNome, &m.CasaSigla, &m.ForaNome, &m.ForaSigla, &m.AvgRating,
	)
	if err != nil {
		return m, err
	}
	if len(events) > 0 {
		_ = json.Unmarshal(events, &m.Events)
	}
	return m, nil
}

// orient fills in "which side was this club on" plus the mirrored result, so
// no caller has to work out whether the requested club was home.
func orient(m domainclubs.Match, clubID string) domainclubs.Match {
	if m.ClubeCasaID == clubID {
		m.OurSide = "home"
		m.OurResult = m.HomeResult
		m.OurGoals, m.TheirGoals = m.HomeGoals, m.AwayGoals
		m.AdversarioID, m.OpponentName, m.OpponentTag = m.ClubeForaID, m.ForaNome, m.ForaSigla
	} else {
		m.OurSide = "away"
		m.OurResult = mirror(m.HomeResult)
		m.OurGoals, m.TheirGoals = m.AwayGoals, m.HomeGoals
		m.AdversarioID, m.OpponentName, m.OpponentTag = m.ClubeCasaID, m.CasaNome, m.CasaSigla
	}
	return m
}

func mirror(r string) string {
	switch r {
	case "win":
		return "loss"
	case "loss":
		return "win"
	default:
		return "draw"
	}
}

func (r *ClubsRepository) ListMatches(ctx context.Context, clubID, kind string, limit int) ([]domainclubs.Match, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if kind == "" {
		rows, err = r.pool.Query(ctx, matchSelect+`
			WHERE m.home_club_id = $1 OR m.away_club_id = $1
			ORDER BY m.timestamp DESC LIMIT $2`, clubID, limit)
	} else {
		rows, err = r.pool.Query(ctx, matchSelect+`
			WHERE (m.home_club_id = $1 OR m.away_club_id = $1) AND m.kind = $2
			ORDER BY m.timestamp DESC LIMIT $3`, clubID, kind, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("list matches: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Match
	for rows.Next() {
		m, err := scanMatch(rows)
		if err != nil {
			return nil, fmt.Errorf("scan match: %w", err)
		}
		list = append(list, orient(m, clubID))
	}
	return list, rows.Err()
}

func (r *ClubsRepository) GetMatch(ctx context.Context, matchID string) (domainclubs.Match, error) {
	row := r.pool.QueryRow(ctx, matchSelect+` WHERE m.match_id = $1`, matchID)
	m, err := scanMatch(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclubs.Match{}, domainclubs.ErrNotFound
	}
	if err != nil {
		return domainclubs.Match{}, fmt.Errorf("get match: %w", err)
	}
	linhas, err := r.matchLines(ctx, m.ID)
	if err != nil {
		return domainclubs.Match{}, err
	}
	m.Players = linhas
	// A match detail is shown without a "requested club", so orient from the
	// home side so the fields are always populated.
	return orient(m, m.ClubeCasaID), nil
}

func (r *ClubsRepository) matchLines(ctx context.Context, partidaID string) ([]domainclubs.PlayerLine, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT club_id, player_id, gamertag, position, rating, goals, assists, shots,
		       passes_made, passes_attempted, tackles_made, tackles_attempted, saves,
		       saves_by_type, seconds_played, man_of_the_match, red_card, clean_sheet
		FROM clubs_match_players WHERE match_id_uuid = $1 ORDER BY rating DESC`, partidaID)
	if err != nil {
		return nil, fmt.Errorf("match lines: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.PlayerLine
	for rows.Next() {
		var l domainclubs.PlayerLine
		var kind []byte
		if err := rows.Scan(&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Position, &l.Rating, &l.Goals,
			&l.Assists, &l.Shots, &l.PassesMade, &l.PassesAttempted, &l.TacklesMade,
			&l.TacklesAttempted, &l.Saves, &kind, &l.SecondsPlayed, &l.ManOfTheMatch,
			&l.RedCard, &l.CleanSheet); err != nil {
			return nil, fmt.Errorf("scan line: %w", err)
		}
		if len(kind) > 0 {
			_ = json.Unmarshal(kind, &l.SavesByType)
		}
		list = append(list, l)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) RecentMatchCount(ctx context.Context, clubID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM clubs_matches WHERE home_club_id = $1 OR away_club_id = $1`,
		clubID).Scan(&n)
	return n, err
}

func (r *ClubsRepository) LastMatchAt(ctx context.Context) (*time.Time, error) {
	var t *time.Time
	if err := r.pool.QueryRow(ctx, `SELECT max(timestamp) FROM clubs_matches`).Scan(&t); err != nil {
		return nil, err
	}
	return t, nil
}

// HeadToHead aggregates every match the two clubs played against each other.
func (r *ClubsRepository) HeadToHead(ctx context.Context, aID, bID string) (domainclubs.HeadToHead, error) {
	a, err := r.GetClub(ctx, aID)
	if err != nil {
		return domainclubs.HeadToHead{}, err
	}
	b := domainclubs.Club{}
	if bb, err := r.GetClub(ctx, bID); err == nil {
		b = bb
	}

	matches, err := r.ListMatches(ctx, aID, "", 500)
	if err != nil {
		return domainclubs.HeadToHead{}, err
	}

	h := domainclubs.HeadToHead{
		ClubA: ref(a), ClubB: ref(b),
	}
	for _, m := range matches {
		if m.AdversarioID != bID {
			continue
		}
		h.Played++
		h.GoalsA += m.OurGoals
		h.GoalsB += m.TheirGoals
		switch m.OurResult {
		case "win":
			h.V++
			h.FormA = append(h.FormA, "V")
		case "loss":
			h.D++
			h.FormA = append(h.FormA, "D")
		default:
			h.E++
			h.FormA = append(h.FormA, "E")
		}
		if len(h.Matches) < domainclubs.RecentMatchWindow {
			h.Matches = append(h.Matches, m)
		}
	}
	return h, nil
}

func ref(c domainclubs.Club) domainclubs.ClubRef {
	return domainclubs.ClubRef{
		ClubID: c.ClubID, Name: c.Name, Tag: c.Tag, DivisionAtRead: c.Division,
		CrestAssetID: c.EscudoAssetID, Color1: c.Color1, Color2: c.Color2, Color3: c.Color3, Color4: c.Color4,
		SkillRating: c.SkillRating, Points: c.Points, Goals: c.Goals, GoalsConceded: c.GoalsConceded,
		CleanSheets: c.CleanSheets, Tracked: c.Tracked,
	}
}

// ----------------------------------------------------------------- elenco

// Squad aggregates every player line of a club's matches into a season
// summary per player. The source has no squad endpoint that survives a
// season, so this is built from what the ingest accumulated.
func (r *ClubsRepository) Squad(ctx context.Context, clubID string) ([]domainclubs.SquadMember, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.player_id, l.gamertag, l.position, l.rating, l.goals, l.assists, l.shots,
		       l.passes_made, l.passes_attempted, l.tackles_made, l.tackles_attempted,
		       l.saves, l.man_of_the_match, l.seconds_played, l.clean_sheet,
		       l.red_card, l.saves_by_type, m.timestamp
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.match_id_uuid
		WHERE l.club_id = $1
		ORDER BY m.timestamp ASC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("squad: %w", err)
	}
	defer rows.Close()

	type acc struct {
		member domainclubs.SquadMember
		notas  []float64
	}
	byPlayer := map[string]*acc{}
	var order []string

	for rows.Next() {
		var (
			playerID, gamertag, position                             string
			rating                                                    float64
			goals, assist, shots, pc, pt, dc, dt, saves, segundos int
			// melhor_em_campo is a real boolean column -- scanning it into an
			// int fails in binary format.
			melhor bool
			cs, cv bool
			kind   []byte
			ts     time.Time
		)
		if err := rows.Scan(&playerID, &gamertag, &position, &rating, &goals, &assist, &shots,
			&pc, &pt, &dc, &dt, &saves, &melhor, &segundos, &cs, &cv, &kind, &ts); err != nil {
			return nil, fmt.Errorf("scan squad row: %w", err)
		}
		a := byPlayer[playerID]
		if a == nil {
			a = &acc{member: domainclubs.SquadMember{PlayerID: playerID, Gamertag: gamertag, Position: position,
				Goalkeeper: position == "goalkeeper"}}
			byPlayer[playerID] = a
			order = append(order, playerID)
		}
		m := &a.member
		m.Played++
		m.Goals += goals
		m.Assists += assist
		m.Shots += shots
		m.PassesMade += pc
		m.PassesAttempted += pt
		m.TacklesMade += dc
		m.TacklesAttempted += dt
		m.Saves += saves
		m.SecondsPlayed += segundos
		if melhor {
			m.ManOfTheMatch++
		}
		if cs {
			m.CleanSheets++
		}
		if cv {
			m.RedCards++
		}
		m.Rating += rating
		a.notas = append(a.notas, rating)
		if len(kind) > 0 {
			var d map[string]int
			if json.Unmarshal(kind, &d) == nil {
				if m.SavesByType == nil {
					m.SavesByType = map[string]int{}
				}
				for k, v := range d {
					m.SavesByType[k] += v
				}
			}
		}
		if len(m.Form) < 8 {
			m.Form = append(m.Form, rating)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]domainclubs.SquadMember, 0, len(order))
	for _, id := range order {
		m := byPlayer[id].member
		if m.Played > 0 {
			m.Rating = round2(m.Rating / float64(m.Played))
			m.GoalsPerGame = round2(float64(m.Goals) / float64(m.Played))
			m.AssistsPerGame = round2(float64(m.Assists) / float64(m.Played))
			m.PassAccuracy = pct(m.PassesMade, m.PassesAttempted)
			m.TackleAccuracy = pct(m.TacklesMade, m.TacklesAttempted)
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Rating > out[j].Rating })
	// Which of these pros already have an owner. The claim is global (a person
	// claims across all clubs), so this is a set lookup, not a per-club query.
	if claimed, err := r.ClaimedPlayerIDs(ctx); err == nil {
		for i := range out {
			out[i].Resgatado = claimed[out[i].PlayerID]
		}
	}
	return out, nil
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

// seasonLabel rotula a temporada de uma data no formato "AAAA/AA".
//
// A fonte não tem temporada: o `season_id` que ela manda nas partidas é sempre
// "0". Então a temporada é derivada da data, com a convenção do futebol
// europeu — começa em julho e vira o ano no meio, "2026/27". É por isso que a
// virada do ano civil (1º de janeiro) NÃO troca a temporada: o que separa duas
// temporadas é o mês de julho, não o réveillon.
func seasonLabel(t time.Time) string {
	y := t.Year()
	if t.Month() < time.July {
		// Janeiro a junho pertencem à temporada que começou no ano anterior.
		y--
	}
	return fmt.Sprintf("%d/%02d", y, (y+1)%100)
}

// seasonsOf agrega as partidas de um jogador por temporada, em ordem
// cronológica (mais antiga primeiro) para o gráfico ler da esquerda para a
// direita. Só as partidas contam — a fonte não dá temporada, então esta é a
// única série temporal de jogador que existe.
func seasonsOf(rows []playerRow) []domainclubs.PlayerSeason {
	type acc struct {
		played, goals, assists int
		ratingSum              float64
	}
	bySeason := map[string]*acc{}
	for _, pr := range rows {
		s := seasonLabel(pr.match.Timestamp)
		a, ok := bySeason[s]
		if !ok {
			a = &acc{}
			bySeason[s] = a
		}
		a.played++
		a.goals += pr.line.Goals
		a.assists += pr.line.Assists
		a.ratingSum += pr.line.Rating
	}
	labels := make([]string, 0, len(bySeason))
	for s := range bySeason {
		labels = append(labels, s)
	}
	// Rótulo "AAAA/AA" ordena lexicograficamente igual a cronologicamente.
	sort.Strings(labels)
	out := make([]domainclubs.PlayerSeason, 0, len(labels))
	for _, s := range labels {
		a := bySeason[s]
		ps := domainclubs.PlayerSeason{Season: s, Played: a.played, Goals: a.goals, Assists: a.assists}
		if a.played > 0 {
			ps.Rating = round2(a.ratingSum / float64(a.played))
		}
		out = append(out, ps)
	}
	return out
}

func pct(part, total int) float64 {
	if total == 0 {
		return 0
	}
	return round2(float64(part) / float64(total) * 100)
}

// -------------------------------------------------------------- jogadores

// playerRows is the shared scan of the player aggregate; the caller decides
// how to group it.
type playerRow struct {
	line  domainclubs.PlayerLine
	match domainclubs.Match
}

func (r *ClubsRepository) allPlayerRows(ctx context.Context, where string, args ...any) ([]playerRow, error) {
	q := `
		SELECT l.club_id, l.player_id, l.gamertag, l.position, l.rating, l.goals, l.assists,
		       l.shots, l.passes_made, l.passes_attempted, l.tackles_made, l.tackles_attempted,
		       l.saves, l.saves_by_type, l.seconds_played, l.man_of_the_match,
		       l.red_card, l.clean_sheet,
		       m.id, m.match_id, m.timestamp, m.kind, m.home_club_id, m.away_club_id,
		       m.home_goals, m.away_goals, m.home_result, COALESCE(cc.name,''), COALESCE(cf.name,'')
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.match_id_uuid
		LEFT JOIN clubs cc ON cc.club_id = m.home_club_id
		LEFT JOIN clubs cf ON cf.club_id = m.away_club_id ` + where + `
		ORDER BY m.timestamp ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("player rows: %w", err)
	}
	defer rows.Close()

	var out []playerRow
	for rows.Next() {
		var pr playerRow
		var kind []byte
		if err := rows.Scan(
			&pr.line.ClubID, &pr.line.PlayerID, &pr.line.Gamertag, &pr.line.Position, &pr.line.Rating,
			&pr.line.Goals, &pr.line.Assists, &pr.line.Shots, &pr.line.PassesMade,
			&pr.line.PassesAttempted, &pr.line.TacklesMade, &pr.line.TacklesAttempted,
			&pr.line.Saves, &kind, &pr.line.SecondsPlayed, &pr.line.ManOfTheMatch,
			&pr.line.RedCard, &pr.line.CleanSheet,
			&pr.match.ID, &pr.match.MatchID, &pr.match.Timestamp, &pr.match.Kind,
			&pr.match.ClubeCasaID, &pr.match.ClubeForaID, &pr.match.HomeGoals, &pr.match.AwayGoals,
			&pr.match.HomeResult, &pr.match.CasaNome, &pr.match.ForaNome,
		); err != nil {
			return nil, fmt.Errorf("scan player row: %w", err)
		}
		if len(kind) > 0 {
			_ = json.Unmarshal(kind, &pr.line.SavesByType)
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

// buildProfile derives every aggregate number for one player from their rows.
func buildProfile(playerID string, rows []playerRow, clubNames map[string]string, verified bool) domainclubs.PlayerProfile {
	p := domainclubs.PlayerProfile{PlayerID: playerID, Verified: verified, Form: []float64{}}
	byClub := map[string]*domainclubs.PlayerClub{}
	var order []string
	var notaSum float64
	var pc, pt, dc, dt int

	for _, pr := range rows {
		if p.Gamertag == "" {
			p.Gamertag = pr.line.Gamertag
			p.Position = pr.line.Position
			p.Goalkeeper = pr.line.Position == "goalkeeper"
		}
		p.Played++
		p.Goals += pr.line.Goals
		p.Assists += pr.line.Assists
		p.SecondsPlayed += pr.line.SecondsPlayed
		if pr.line.ManOfTheMatch {
			p.ManOfTheMatch++
		}
		if pr.line.CleanSheet {
			p.CleanSheets++
		}
		if pr.line.RedCard {
			p.RedCards++
		}
		notaSum += pr.line.Rating
		pc += pr.line.PassesMade
		pt += pr.line.PassesAttempted
		dc += pr.line.TacklesMade
		dt += pr.line.TacklesAttempted
		if len(p.Form) < 8 {
			p.Form = append(p.Form, pr.line.Rating)
		}
		if len(pr.line.SavesByType) > 0 {
			if p.SavesByType == nil {
				p.SavesByType = map[string]int{}
			}
			for k, v := range pr.line.SavesByType {
				p.SavesByType[k] += v
			}
		}
		// Per-club cluster.
		c, ok := byClub[pr.line.ClubID]
		if !ok {
			c = &domainclubs.PlayerClub{ClubID: pr.line.ClubID, Name: clubNames[pr.line.ClubID]}
			byClub[pr.line.ClubID] = c
			order = append(order, pr.line.ClubID)
		}
		c.Played++
		c.Goals += pr.line.Goals
		c.Assists += pr.line.Assists
		c.Rating += pr.line.Rating

		// Recent performances, newest last in this ASC scan; keep the tail.
		pm := domainclubs.PlayerMatch{
			MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp, Kind: pr.match.Kind,
			Rating: pr.line.Rating, Goals: pr.line.Goals, Assists: pr.line.Assists,
			Shots: pr.line.Shots, PassesMade: pr.line.PassesMade,
			PassesAttempted: pr.line.PassesAttempted, TacklesMade: pr.line.TacklesMade,
			TacklesAttempted: pr.line.TacklesAttempted, SecondsPlayed: pr.line.SecondsPlayed,
			HomeGoals: pr.match.HomeGoals, AwayGoals: pr.match.AwayGoals,
		}
		if pr.match.ClubeCasaID == pr.line.ClubID {
			pm.Resultado = pr.match.HomeResult
			pm.OpponentName = pr.match.ForaNome
		} else {
			pm.Resultado = mirror(pr.match.HomeResult)
			pm.OpponentName = pr.match.CasaNome
		}
		p.Matches = append(p.Matches, pm)
	}

	if p.Played > 0 {
		p.Rating = round2(notaSum / float64(p.Played))
		p.GoalsPerGame = round2(float64(p.Goals) / float64(p.Played))
		p.AssistsPerGame = round2(float64(p.Assists) / float64(p.Played))
		p.PassAccuracy = pct(pc, pt)
		p.TackleAccuracy = pct(dc, dt)
	}
	for _, id := range order {
		c := byClub[id]
		if c.Played > 0 {
			c.Rating = round2(c.Rating / float64(c.Played))
		}
		p.Clubs = append(p.Clubs, *c)
	}
	// Main club = the one with the most appearances.
	if len(p.Clubs) > 0 {
		best := p.Clubs[0]
		for _, c := range p.Clubs[1:] {
			if c.Played > best.Played {
				best = c
			}
		}
		p.ClubeID, p.ClubName = best.ClubID, best.Name
	}
	// Most recent performances, newest first -- a mesma janela da forma do
	// clube, senão o perfil do jogador mostra menos que a lista.
	if len(p.Matches) > domainclubs.RecentMatchWindow {
		p.Matches = p.Matches[len(p.Matches)-domainclubs.RecentMatchWindow:]
	}
	for i, j := 0, len(p.Matches)-1; i < j; i, j = i+1, j-1 {
		p.Matches[i], p.Matches[j] = p.Matches[j], p.Matches[i]
	}
	// A evolução por temporada (FR-013) usa TODAS as partidas, não só as 12
	// recentes: a janela curta serve à forma, não à série histórica.
	p.Seasons = seasonsOf(rows)
	return p
}

func (r *ClubsRepository) clubNameMap(ctx context.Context) (map[string]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT club_id, name FROM clubs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		m[id] = name
	}
	return m, rows.Err()
}

func (r *ClubsRepository) GetPlayer(ctx context.Context, playerID string) (domainclubs.PlayerProfile, error) {
	rows, err := r.allPlayerRows(ctx, `WHERE l.player_id = $1`, playerID)
	if err != nil {
		return domainclubs.PlayerProfile{}, err
	}
	if len(rows) == 0 {
		return domainclubs.PlayerProfile{}, domainclubs.ErrNotFound
	}
	names, err := r.clubNameMap(ctx)
	if err != nil {
		return domainclubs.PlayerProfile{}, err
	}
	verified := false
	if ids, err := r.ClaimedPlayerIDs(ctx); err == nil {
		verified = ids[playerID]
	}
	return r.comCareer(ctx, buildProfile(playerID, rows, names, verified)), nil
}

// comCareer anexa os totais de carreira aos clubes de um perfil. Existe como
// passo separado porque DOIS caminhos montam perfil (a ficha e o índice) e o
// career tem que chegar nos dois -- foi o que faltou: o perfil vinha sem
// carreira mesmo com os dados gravados.
//
// O elo é o gamertag: o endpoint da fonte não traz playerId.
func (r *ClubsRepository) comCareer(ctx context.Context, p domainclubs.PlayerProfile) domainclubs.PlayerProfile {
	carreira := r.careerByClubAndTag(ctx)
	for i := range p.Clubs {
		if c, ok := carreira[p.Clubs[i].ClubID+"\x00"+p.Gamertag]; ok {
			p.Clubs[i].Career = &domainclubs.CareerTotais{
				Played: c.Played, Goals: c.Goals, Assists: c.Assists,
				ManOfTheMatch: c.ManOfTheMatch, Rating: c.Rating,
			}
		}
	}
	return p
}

func (r *ClubsRepository) AllPlayers(ctx context.Context) ([]domainclubs.PlayerProfile, error) {
	return r.playersGrouped(ctx, "", nil)
}

// PlayerCount is the size of the cross-club index. It counts distinct player
// ids in the match lines directly, so it is cheap and never capped by a page
// size -- the home header asks for the whole index, not a slice of it.
func (r *ClubsRepository) PlayerCount(ctx context.Context) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx, `SELECT count(DISTINCT player_id) FROM clubs_match_players`).Scan(&n); err != nil {
		return 0, fmt.Errorf("player count: %w", err)
	}
	return n, nil
}

func (r *ClubsRepository) SearchPlayers(ctx context.Context, query string, limit int) ([]domainclubs.PlayerProfile, error) {
	all, err := r.playersGrouped(ctx, "", nil)
	if err != nil {
		return nil, err
	}
	needle := foldAccents(query)
	var out []domainclubs.PlayerProfile
	for _, p := range all {
		if needle == "" || strings.Contains(foldAccents(p.Gamertag), needle) {
			out = append(out, p)
		}
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (r *ClubsRepository) playersGrouped(ctx context.Context, where string, args []any) ([]domainclubs.PlayerProfile, error) {
	rows, err := r.allPlayerRows(ctx, where, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	names, err := r.clubNameMap(ctx)
	if err != nil {
		return nil, err
	}
	verified, _ := r.ClaimedPlayerIDs(ctx)

	grouped := map[string][]playerRow{}
	var order []string
	for _, pr := range rows {
		if _, ok := grouped[pr.line.PlayerID]; !ok {
			order = append(order, pr.line.PlayerID)
		}
		grouped[pr.line.PlayerID] = append(grouped[pr.line.PlayerID], pr)
	}
	out := make([]domainclubs.PlayerProfile, 0, len(order))
	for _, id := range order {
		out = append(out, r.comCareer(ctx, buildProfile(id, grouped[id], names, verified[id])))
	}
	return out, nil
}

// careerByClubAndTag lê os totais de carreira num mapa (clube\x00gamertag).
// Best-effort: se a tabela ainda não existe (deploy sem o schema novo), o
// perfil sai sem carreira em vez de falhar a leitura inteira.
func (r *ClubsRepository) careerByClubAndTag(ctx context.Context) map[string]domainclubs.CareerTotais {
	rows, err := r.pool.Query(ctx, `
		SELECT club_id, gamertag, played, goals, assists, man_of_the_match, rating
		FROM clubs_player_career`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := map[string]domainclubs.CareerTotais{}
	for rows.Next() {
		var clubID, gamertag string
		var c domainclubs.CareerTotais
		if err := rows.Scan(&clubID, &gamertag, &c.Played, &c.Goals, &c.Assists,
			&c.ManOfTheMatch, &c.Rating); err != nil {
			return out
		}
		out[clubID+"\x00"+gamertag] = c
	}
	return out
}

// ClaimedPlayerIDs is the set of player ids carrying a verified badge. It
// deliberately exposes nothing about WHO claimed them.
func (r *ClubsRepository) ClaimedPlayerIDs(ctx context.Context) (map[string]bool, error) {
	rows, err := r.pool.Query(ctx, `SELECT player_id FROM clubs_claimed_pros WHERE verified = true`)
	if err != nil {
		return nil, fmt.Errorf("claimed ids: %w", err)
	}
	defer rows.Close()
	m := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		m[id] = true
	}
	return m, rows.Err()
}

// --------------------------------------------------------------- histórico

func (r *ClubsRepository) Snapshots(ctx context.Context, clubID string, since time.Time) ([]domainclubs.Snapshot, error) {
	var rows pgx.Rows
	var err error
	if since.IsZero() {
		rows, err = r.pool.Query(ctx, `
			SELECT read_at, skill_rating, division_at_read, played, wins, draws, losses, goals, goals_conceded, squad_size
			FROM clubs_snapshots WHERE club_id = $1 ORDER BY read_at ASC`, clubID)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT read_at, skill_rating, division_at_read, played, wins, draws, losses, goals, goals_conceded, squad_size
			FROM clubs_snapshots WHERE club_id = $1 AND read_at >= $2 ORDER BY read_at ASC`, clubID, since)
	}
	if err != nil {
		return nil, fmt.Errorf("snapshots: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Snapshot
	for rows.Next() {
		var s domainclubs.Snapshot
		if err := rows.Scan(&s.ReadAt, &s.SkillRating, &s.DivisionAtRead, &s.Played, &s.Wins,
			&s.Draws, &s.Losses, &s.Goals, &s.GoalsConceded, &s.SquadSize); err != nil {
			return nil, fmt.Errorf("scan snapshot: %w", err)
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) LatestSnapshot(ctx context.Context, clubID string) (*domainclubs.Snapshot, error) {
	var s domainclubs.Snapshot
	err := r.pool.QueryRow(ctx, `
		SELECT read_at, skill_rating, division_at_read, played, wins, draws, losses, goals, goals_conceded, squad_size
		FROM clubs_snapshots WHERE club_id = $1 ORDER BY read_at DESC LIMIT 1`, clubID).
		Scan(&s.ReadAt, &s.SkillRating, &s.DivisionAtRead, &s.Played, &s.Wins, &s.Draws,
			&s.Losses, &s.Goals, &s.GoalsConceded, &s.SquadSize)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest snapshot: %w", err)
	}
	return &s, nil
}

// Timeline cruza o acervo do hub num fio datado. Não há uma tabela de eventos:
// os eventos SÃO as linhas que já existem (snapshots, mudanças de divisão,
// partidas), remontadas em ordem. É o que a fonte não dá -- a EA só conhece o
// agora, e a série dessas leituras é o produto ao longo do tempo.
//
// Tudo é derivado de leitura; nada é gravado aqui. Um tipo de evento novo entra
// como mais uma fonte e um sort, não como mais uma tabela.
func (r *ClubsRepository) Timeline(ctx context.Context, clubID string) ([]domainclubs.TimelineEntry, error) {
	var out []domainclubs.TimelineEntry

	// 1. Mudanças de divisão -- o evento mais significativo da história.
	changes, err := r.DivisionChanges(ctx, clubID)
	if err != nil {
		return nil, err
	}
	for _, c := range changes {
		out = append(out, domainclubs.TimelineEntry{
			At:    c.DetectedAt,
			Kind:  "divisao",
			Title: divisionTitle(c),
			Data: map[string]any{
				"previous_division": c.PreviousDivision,
				"new_division":      c.NewDivision,
				"change_kind":       c.Kind,
			},
		})
	}

	// 2. Entrada no hub: a primeira leitura guardada é, na prática, quando o
	// hub passou a seguir o clube.
	var primeira *time.Time
	if err := r.pool.QueryRow(ctx,
		`SELECT min(read_at) FROM clubs_snapshots WHERE club_id = $1`, clubID).Scan(&primeira); err != nil {
		return nil, fmt.Errorf("timeline primeira leitura: %w", err)
	}
	if primeira != nil {
		out = append(out, domainclubs.TimelineEntry{
			At:    *primeira,
			Kind:  "seguido",
			Title: "Clube entrou no hub",
			Data:  map[string]any{},
		})
	}

	// 3. Recordes: marcos que a janela recente não guarda, derivados das
	// partidas acumuladas.
	rec, err := r.Records(ctx, clubID)
	if err != nil {
		return nil, err
	}
	if rec.BiggestWin != nil {
		out = append(out, domainclubs.TimelineEntry{
			At:     rec.BiggestWin.Timestamp,
			Kind:   "recorde",
			Title:  "Maior goleada",
			Detail: rec.BiggestWin.OpponentName,
			Data: map[string]any{
				"record":      "biggest_win",
				"our_goals":   rec.BiggestWin.OurGoals,
				"their_goals": rec.BiggestWin.TheirGoals,
			},
		})
	}
	if rec.MaisGols != nil {
		out = append(out, domainclubs.TimelineEntry{
			At:     rec.MaisGols.Timestamp,
			Kind:   "recorde",
			Title:  "Jogo com mais gols",
			Detail: rec.MaisGols.OpponentName,
			Data: map[string]any{
				"record":      "highest_scoring",
				"total_goals": rec.MaisGols.Total,
			},
		})
	}

	// Ordena do mais recente para o mais antigo -- a linha do tempo se lê de
	// cima para baixo, como um feed.
	sort.Slice(out, func(i, j int) bool { return out[i].At.After(out[j].At) })
	return out, nil
}

// ClubDeltas compara a primeira leitura guardada com a última: "o que mudou
// desde que você acompanha". Só existe porque o hub acumula leituras -- é a
// diferença que a fonte não tem como responder.
func (r *ClubsRepository) ClubDeltas(ctx context.Context, clubID string) (domainclubs.ClubDeltas, error) {
	var d domainclubs.ClubDeltas
	rows, err := r.pool.Query(ctx, `
		SELECT read_at, skill_rating, division_at_read, played, wins, draws, losses, goals
		FROM clubs_snapshots WHERE club_id = $1
		ORDER BY read_at ASC`, clubID)
	if err != nil {
		return d, fmt.Errorf("club deltas: %w", err)
	}
	defer rows.Close()

	var snaps []domainclubs.Snapshot
	for rows.Next() {
		var s domainclubs.Snapshot
		if err := rows.Scan(&s.ReadAt, &s.SkillRating, &s.DivisionAtRead, &s.Played,
			&s.Wins, &s.Draws, &s.Losses, &s.Goals); err != nil {
			return d, fmt.Errorf("scan delta snapshot: %w", err)
		}
		snaps = append(snaps, s)
	}
	if err := rows.Err(); err != nil {
		return d, err
	}
	if len(snaps) == 0 {
		// Sem histórico: delta zerado é "ainda não acompanhamos o suficiente",
		// não erro.
		return d, nil
	}
	first, last := snaps[0], snaps[len(snaps)-1]
	d.Since = first.ReadAt
	d.Matches = last.Played - first.Played
	d.Wins = last.Wins - first.Wins
	d.Draws = last.Draws - first.Draws
	d.Losses = last.Losses - first.Losses
	d.Goals = last.Goals - first.Goals
	d.SkillDelta = last.SkillRating - first.SkillRating
	d.DivisionFrom = first.DivisionAtRead
	d.DivisionTo = last.DivisionAtRead
	return d, nil
}

// divisionTitle é o texto de fallback do evento de divisão; a UI prefere `Data`.
func divisionTitle(c domainclubs.DivisionChange) string {
	switch c.Kind {
	case "promotion":
		return "Promovido"
	case "relegation":
		return "Rebaixado"
	default:
		return "Mudança de divisão"
	}
}

func (r *ClubsRepository) DivisionChanges(ctx context.Context, clubID string) ([]domainclubs.DivisionChange, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT detected_at, previous_division, new_division, kind FROM clubs_division_changes
		WHERE club_id = $1 ORDER BY detected_at DESC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("division changes: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.DivisionChange
	for rows.Next() {
		var c domainclubs.DivisionChange
		if err := rows.Scan(&c.DetectedAt, &c.PreviousDivision, &c.NewDivision, &c.Kind); err != nil {
			return nil, fmt.Errorf("scan change: %w", err)
		}
		list = append(list, c)
	}
	return list, rows.Err()
}

// Records computes the record book from the persisted history — explicitly
// NOT from the source's recent window, which is what makes these records
// meaningful over time.
func (r *ClubsRepository) Records(ctx context.Context, clubID string) (domainclubs.Records, error) {
	matches, err := r.ListMatches(ctx, clubID, "league", 1000)
	if err != nil {
		return domainclubs.Records{}, err
	}
	// Fall back to every type when the club has no league matches yet.
	if len(matches) == 0 {
		if matches, err = r.ListMatches(ctx, clubID, "", 1000); err != nil {
			return domainclubs.Records{}, err
		}
	}

	rec := domainclubs.Records{TotalMatches: len(matches)}
	var bestWin, worstLoss, mostGoals *domainclubs.Match
	for i := range matches {
		m := &matches[i]
		diff := m.OurGoals - m.TheirGoals
		if bestWin == nil || diff > bestWin.OurGoals-bestWin.TheirGoals {
			bestWin = m
		}
		if worstLoss == nil || diff < worstLoss.OurGoals-worstLoss.TheirGoals {
			worstLoss = m
		}
		if mostGoals == nil || (m.OurGoals+m.TheirGoals) > (mostGoals.OurGoals+mostGoals.TheirGoals) {
			mostGoals = m
		}
		if m.TheirGoals == 0 {
			rec.CleanSheets++
		}
	}
	toRecord := func(m *domainclubs.Match) *domainclubs.RecordMatch {
		if m == nil {
			return nil
		}
		return &domainclubs.RecordMatch{
			MatchID: m.MatchID, Timestamp: m.Timestamp, OpponentName: m.OpponentName,
			OurGoals: m.OurGoals, TheirGoals: m.TheirGoals,
			Total: m.OurGoals + m.TheirGoals,
		}
	}
	rec.BiggestWin = toRecord(bestWin)
	rec.WorstLoss = toRecord(worstLoss)
	rec.MaisGols = toRecord(mostGoals)

	// Longest win streak, in chronological order.
	chrono := make([]domainclubs.Match, len(matches))
	copy(chrono, matches)
	sort.SliceStable(chrono, func(i, j int) bool { return chrono[i].Timestamp.Before(chrono[j].Timestamp) })
	cur, best := 0, 0
	for _, m := range chrono {
		if m.OurResult == "win" {
			cur++
			if cur > best {
				best = cur
			}
		} else {
			cur = 0
		}
	}
	rec.MaiorSequencia = best

	// Maior invencibilidade: a maior sequência sem derrota (vitória ou empate).
	// Conta diferente da de vitórias -- um clube que empata muito também é
	// difícil de bater, e essa é a leitura que "invencibilidade" promete.
	cur, best = 0, 0
	for _, m := range chrono {
		if m.OurResult != "loss" {
			cur++
			if cur > best {
				best = cur
			}
		} else {
			cur = 0
		}
	}
	rec.MaiorInvencibilidade = best

	// Best individual rating and most goals in one match.
	lines, err := r.allPlayerRows(ctx, `WHERE l.club_id = $1`, clubID)
	if err != nil {
		return domainclubs.Records{}, err
	}
	for _, pr := range lines {
		if rec.BestRating == nil || pr.line.Rating > rec.BestRating.Rating {
			rec.BestRating = &domainclubs.RecordLine{
				PlayerID: pr.line.PlayerID, Gamertag: pr.line.Gamertag,
				MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp,
				Rating: pr.line.Rating, Goals: pr.line.Goals,
				OpponentName: adversaryOf(pr.match, pr.line.ClubID),
			}
		}
		if rec.MaisGolsJogo == nil || pr.line.Goals > rec.MaisGolsJogo.Goals {
			rec.MaisGolsJogo = &domainclubs.RecordLine{
				PlayerID: pr.line.PlayerID, Gamertag: pr.line.Gamertag,
				MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp,
				Rating: pr.line.Rating, Goals: pr.line.Goals,
				OpponentName: adversaryOf(pr.match, pr.line.ClubID),
			}
		}
	}
	return rec, nil
}

func adversaryOf(m domainclubs.Match, clubID string) string {
	if m.ClubeCasaID == clubID {
		return m.ForaNome
	}
	return m.CasaNome
}

// GlobalRecords agrega os recordes do hub inteiro. Ao contrário de Records
// (que olha um clube), cruza todas as partidas acompanhadas -- é o que a fonte
// não faz, porque ela só conhece a janela recente de cada clube isolado.
//
// A orientação importa: a maior goleada tem um vencedor, e a linha "do clube"
// é a do vencedor, não a do mandante. Sem normalizar isso, uma vitória de 7x0
// fora de casa viraria "0x7" e nunca seria a maior goleada.
func (r *ClubsRepository) GlobalRecords(ctx context.Context) (domainclubs.GlobalRecords, error) {
	var out domainclubs.GlobalRecords

	if err := r.pool.QueryRow(ctx, `
		SELECT (SELECT count(*) FROM clubs_matches),
		       (SELECT count(*) FROM clubs WHERE tracked)`).Scan(&out.TotalMatches, &out.TotalClubs); err != nil {
		return out, fmt.Errorf("global records counts: %w", err)
	}

	// Maior goleada: o vencedor por margem. A linha "do clube" é a do
	// vencedor, então uma vitória fora de casa não vira "0xN".
	{
		var r1 domainclubs.GlobalRecordMatch
		err := r.pool.QueryRow(ctx, `
			SELECT m.match_id, m.timestamp,
			       wc.club_id, wc.name, COALESCE(wc.tag,''),
			       oc.club_id, oc.name, COALESCE(oc.tag,''),
			       CASE WHEN m.home_goals >= m.away_goals THEN m.home_goals ELSE m.away_goals END,
			       CASE WHEN m.home_goals >= m.away_goals THEN m.away_goals ELSE m.home_goals END
			FROM clubs_matches m
			JOIN clubs wc ON wc.club_id = CASE WHEN m.home_goals >= m.away_goals THEN m.home_club_id ELSE m.away_club_id END
			JOIN clubs oc ON oc.club_id = CASE WHEN m.home_goals >= m.away_goals THEN m.away_club_id ELSE m.home_club_id END
			WHERE m.home_goals <> m.away_goals
			ORDER BY abs(m.home_goals - m.away_goals) DESC, (m.home_goals + m.away_goals) DESC
			LIMIT 1`).Scan(
			&r1.MatchID, &r1.Timestamp,
			&r1.Club.ClubID, &r1.Club.Name, &r1.Club.Tag,
			&r1.Opponent.ClubID, &r1.Opponent.Name, &r1.Opponent.Tag,
			&r1.ClubGoals, &r1.OppGoals)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, fmt.Errorf("global biggest win: %w", err)
		}
		if err == nil {
			r1.TotalGoals = r1.ClubGoals + r1.OppGoals
			out.BiggestWin = &r1
		}
	}

	// Jogo com mais gols, independente de quem venceu.
	{
		var r2 domainclubs.GlobalRecordMatch
		err := r.pool.QueryRow(ctx, `
			SELECT m.match_id, m.timestamp,
			       hc.club_id, hc.name, COALESCE(hc.tag,''),
			       ac.club_id, ac.name, COALESCE(ac.tag,''),
			       m.home_goals, m.away_goals
			FROM clubs_matches m
			JOIN clubs hc ON hc.club_id = m.home_club_id
			JOIN clubs ac ON ac.club_id = m.away_club_id
			ORDER BY (m.home_goals + m.away_goals) DESC, m.timestamp DESC
			LIMIT 1`).Scan(
			&r2.MatchID, &r2.Timestamp,
			&r2.Club.ClubID, &r2.Club.Name, &r2.Club.Tag,
			&r2.Opponent.ClubID, &r2.Opponent.Name, &r2.Opponent.Tag,
			&r2.ClubGoals, &r2.OppGoals)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, fmt.Errorf("global highest scoring: %w", err)
		}
		if err == nil {
			r2.TotalGoals = r2.ClubGoals + r2.OppGoals
			out.HighestScoringMatch = &r2
		}
	}

	// Melhor atuação individual.
	{
		var r3 domainclubs.GlobalRecordLine
		err := r.pool.QueryRow(ctx, `
			SELECT l.player_id, l.gamertag, c.club_id, c.name, COALESCE(c.tag,''),
			       COALESCE(CASE WHEN m.home_club_id = l.club_id THEN ac.name ELSE hc.name END, ''),
			       m.match_id, m.timestamp, l.rating
			FROM clubs_match_players l
			JOIN clubs c ON c.club_id = l.club_id
			JOIN clubs_matches m ON m.id = l.match_id_uuid
			LEFT JOIN clubs hc ON hc.club_id = m.home_club_id
			LEFT JOIN clubs ac ON ac.club_id = m.away_club_id
			ORDER BY l.rating DESC, m.timestamp DESC
			LIMIT 1`).Scan(
			&r3.PlayerID, &r3.Gamertag,
			&r3.Club.ClubID, &r3.Club.Name, &r3.Club.Tag,
			&r3.Opponent, &r3.MatchID, &r3.Timestamp, &r3.Rating)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, fmt.Errorf("global best rating: %w", err)
		}
		if err == nil {
			out.BestRating = &r3
		}
	}

	// Artilheiro geral: soma de toda a base acumulada, não a janela de um clube.
	{
		var r4 domainclubs.GlobalRecordPlayer
		err := r.pool.QueryRow(ctx, `
			SELECT l.player_id, l.gamertag, c.club_id, c.name, COALESCE(c.tag,''),
			       sum(l.goals)::int, sum(l.assists)::int, count(*)::int
			FROM clubs_match_players l
			JOIN clubs c ON c.club_id = l.club_id
			GROUP BY l.player_id, l.gamertag, c.club_id, c.name, c.tag
			HAVING sum(l.goals) > 0
			ORDER BY sum(l.goals) DESC, count(*) DESC
			LIMIT 1`).Scan(
			&r4.PlayerID, &r4.Gamertag,
			&r4.Club.ClubID, &r4.Club.Name, &r4.Club.Tag,
			&r4.Goals, &r4.Assists, &r4.Played)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return out, fmt.Errorf("global top scorer: %w", err)
		}
		if err == nil {
			out.TopScorer = &r4
		}
	}
	return out, nil
}

// ------------------------------------------------------------------- feed

func (r *ClubsRepository) RecentAnnouncements(ctx context.Context, limit int) ([]domainclubs.Announcement, error) {
	if limit <= 0 {
		limit = 12
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, kind, title, body, reference_id, icon, data, generated_at
		FROM clubs_announcements
		WHERE expires_at IS NULL OR expires_at > now()
		ORDER BY generated_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("announcements: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Announcement
	for rows.Next() {
		var a domainclubs.Announcement
		var data []byte
		if err := rows.Scan(&a.ID, &a.Kind, &a.Title, &a.Body, &a.ReferenciaID, &a.Icon,
			&data, &a.GeneratedAt); err != nil {
			return nil, fmt.Errorf("scan announcement: %w", err)
		}
		if len(data) > 0 {
			_ = json.Unmarshal(data, &a.Data)
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// AnnouncementCount counts what the feed could show, not what it does show:
// the home caps the feed at a few items, and the header must not shrink with it.
func (r *ClubsRepository) AnnouncementCount(ctx context.Context) (int, error) {
	var n int
	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM clubs_announcements
		WHERE expires_at IS NULL OR expires_at > now()`).Scan(&n); err != nil {
		return 0, fmt.Errorf("announcement count: %w", err)
	}
	return n, nil
}

// ------------------------------------------------------------------ rankings

func (r *ClubsRepository) RankingClubs(ctx context.Context, metric string) ([]domainclubs.ClubRef, error) {
	clubs, err := r.ListClubs(ctx, false)
	if err != nil {
		return nil, err
	}
	refs := make([]domainclubs.ClubRef, 0, len(clubs))
	for _, c := range clubs {
		if c.Played == 0 && c.SkillRating == 0 {
			continue // never fetched at all — nothing to rank on
		}
		refs = append(refs, ref(c))
	}
	// The unbeaten run is computed per club; only the ranking needs it, so
	// it is filled here rather than in every ListClubs caller.
	for i := range refs {
		if seq, err := r.clubSequence(ctx, refs[i].ClubID); err == nil {
			refs[i].Unbeaten = seq.Unbeaten
		}
	}
	sortRefs(refs, metric)
	return refs, nil
}

func sortRefs(refs []domainclubs.ClubRef, metric string) {
	less := func(i, j int) bool { return refs[i].SkillRating > refs[j].SkillRating }
	switch metric {
	case "points":
		less = func(i, j int) bool { return refs[i].Points > refs[j].Points }
	case "goals":
		less = func(i, j int) bool { return refs[i].Goals > refs[j].Goals }
	case "clean_sheets":
		less = func(i, j int) bool { return refs[i].CleanSheets > refs[j].CleanSheets }
	case "win_rate", "aproveitamento_pct", "winrate":
		less = func(i, j int) bool {
			return pct(refs[i].Points, refs[i].Points+refs[i].Goals) > pct(refs[j].Points, refs[j].Points+refs[j].Goals)
		}
	}
	sort.SliceStable(refs, less)
}

func (r *ClubsRepository) RankingPlayers(ctx context.Context, metric, position string) ([]domainclubs.RankPlayer, error) {
	players, err := r.AllPlayers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]domainclubs.RankPlayer, 0, len(players))
	for _, p := range players {
		if position != "" && p.Position != position {
			continue
		}
		if p.Played == 0 {
			continue
		}
		out = append(out, domainclubs.RankPlayer{
			PlayerID: p.PlayerID, Gamertag: p.Gamertag, Position: p.Position,
			ClubID: p.ClubeID, ClubName: p.ClubName, ClubeSigla: p.ClubeSigla,
			Played: p.Played, Goals: p.Goals, Assists: p.Assists, Rating: p.Rating,
			GoalsPerGame: p.GoalsPerGame, Verified: p.Verified,
		})
	}
	sortPlayers(out, metric)
	// Deliberately NOT capped here: the handler paginates, so the last page
	// has to be reachable. Capping at 100 made "até o último" impossible --
	// a ranking 1,288 players deep stopped at 100 with no way past it.
	return out, nil
}

func sortPlayers(list []domainclubs.RankPlayer, metric string) {
	less := func(i, j int) bool { return list[i].Rating > list[j].Rating }
	switch metric {
	case "goals":
		less = func(i, j int) bool { return list[i].Goals > list[j].Goals }
	case "assists":
		less = func(i, j int) bool { return list[i].Assists > list[j].Assists }
	case "goals_per_game", "gols_por_partida":
		less = func(i, j int) bool { return list[i].GoalsPerGame > list[j].GoalsPerGame }
	case "played":
		less = func(i, j int) bool { return list[i].Played > list[j].Played }
	}
	sort.SliceStable(list, less)
}

// clubSequence computes the current win and unbeaten runs from persisted
// matches — the source only reports these for its own recent window.
func (r *ClubsRepository) clubSequence(ctx context.Context, clubID string) (domainclubs.Streak, error) {
	matches, err := r.ListMatches(ctx, clubID, "", 100)
	if err != nil {
		return domainclubs.Streak{}, err
	}
	var s domainclubs.Streak
	for _, m := range matches { // newest first
		if m.OurResult == "win" {
			s.Wins++
			s.Unbeaten++
			continue
		}
		if m.OurResult == "draw" && s.Wins == 0 {
			s.Unbeaten++
			continue
		}
		break
	}
	return s, nil
}

// --------------------------------------------------------------- preferências

func (r *ClubsRepository) ListWatch(ctx context.Context, userEmail string) ([]domainclubs.WatchEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.club_id, COALESCE(c.name,''), COALESCE(c.tag,''),
		       COALESCE(t.division,0), COALESCE(t.skill_rating,0), w.tracked_since, w.source
		FROM clubs_watchlist w
		LEFT JOIN clubs c ON c.club_id = w.club_id
		LEFT JOIN clubs_totais t ON t.club_id = w.club_id
		WHERE w.user_email = $1
		ORDER BY w.tracked_since DESC`, userEmail)
	if err != nil {
		return nil, fmt.Errorf("list watch: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.WatchEntry
	for rows.Next() {
		var e domainclubs.WatchEntry
		if err := rows.Scan(&e.ClubID, &e.Name, &e.Tag, &e.DivisionAtRead, &e.SkillRating,
			&e.TrackedSince, &e.Source); err != nil {
			return nil, fmt.Errorf("scan watch: %w", err)
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) GetNotificacoes(ctx context.Context, userEmail string) (domainclubs.NotificationPrefs, error) {
	var p domainclubs.NotificationPrefs
	err := r.pool.QueryRow(ctx, `
		SELECT channel, weekly_digest, records_and_divisions, match_results
		FROM clubs_preferences WHERE user_email = $1`, userEmail).
		Scan(&p.Channel, &p.WeeklyDigest, &p.RecordsAndDivisions, &p.MatchResults)
	if errors.Is(err, pgx.ErrNoRows) {
		// Defaults with no channel — nothing is sent until one is set.
		return domainclubs.NotificationPrefs{WeeklyDigest: true, RecordsAndDivisions: true, MatchResults: true}, nil
	}
	if err != nil {
		return domainclubs.NotificationPrefs{}, fmt.Errorf("get notificacoes: %w", err)
	}
	return p, nil
}

func (r *ClubsRepository) GetClaimed(ctx context.Context, userEmail string) (*domainclubs.ClaimedPro, error) {
	var p domainclubs.ClaimedPro
	err := r.pool.QueryRow(ctx, `
		SELECT club_id, player_id, verified FROM clubs_claimed_pros WHERE user_email = $1`,
		userEmail).Scan(&p.ClubID, &p.PlayerID, &p.Verified)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get claimed: %w", err)
	}
	return &p, nil
}

func (r *ClubsRepository) GetSyncRun(ctx context.Context, userEmail string) (domainclubs.SyncRun, error) {
	var run domainclubs.SyncRun
	var new_items []byte
	err := r.pool.QueryRow(ctx, `
		SELECT running, skill_rating, total, completed, current, new_items,
		       COALESCE(started_at, 'epoch'::timestamptz), COALESCE(finished_at, 'epoch'::timestamptz)
		FROM clubs_sync_runs WHERE user_email = $1`, userEmail).
		Scan(&run.Running, &run.SkillRating, &run.Total, &run.Completed, &run.Current, &new_items,
			&run.StartedAt, &run.FinishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclubs.SyncRun{NewItems: []string{}}, nil
	}
	if err != nil {
		return domainclubs.SyncRun{}, fmt.Errorf("get sync run: %w", err)
	}
	if len(new_items) > 0 {
		_ = json.Unmarshal(new_items, &run.NewItems)
	}
	return run, nil
}

// ListPendingSyncs: quem pediu sincronização e ainda não terminou.
func (r *ClubsRepository) ListPendingSyncs(ctx context.Context) ([]domainclubs.SyncRun, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT user_email, running, skill_rating, total, completed, current, new_items,
		       COALESCE(started_at, 'epoch'::timestamptz), COALESCE(finished_at, 'epoch'::timestamptz)
		FROM clubs_sync_runs
		WHERE running = true AND finished_at IS NULL
		ORDER BY started_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list pending syncs: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.SyncRun
	for rows.Next() {
		var run domainclubs.SyncRun
		var new_items []byte
		if err := rows.Scan(&run.UserEmail, &run.Running, &run.SkillRating, &run.Total,
			&run.Completed, &run.Current, &new_items, &run.StartedAt, &run.FinishedAt); err != nil {
			return nil, fmt.Errorf("scan pending sync: %w", err)
		}
		if len(new_items) > 0 {
			_ = json.Unmarshal(new_items, &run.NewItems)
		}
		list = append(list, run)
	}
	return list, rows.Err()
}

// ---------------------------------------------------------------- fetch runs

// GetFetchRun é o estado do sync sob demanda de um alvo (clube ou jogador).
// Devolve um run zerado quando nunca foi pedido -- a SPA trata isso como
// "ainda não busquei", não como erro.
func (r *ClubsRepository) GetFetchRun(ctx context.Context, target, alvoID string) (domainclubs.FetchRun, error) {
	run := domainclubs.FetchRun{Target: target, TargetID: alvoID}
	var concluido *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT label, running, players, matches, clubs, error, finished_at
		FROM clubs_fetch_runs WHERE target = $1 AND target_id = $2`, target, alvoID).
		Scan(&run.Label, &run.Running, &run.Players, &run.Matches, &run.Clubs, &run.Error, &concluido)
	if errors.Is(err, pgx.ErrNoRows) {
		return run, nil
	}
	if err != nil {
		return domainclubs.FetchRun{}, fmt.Errorf("get fetch run: %w", err)
	}
	run.FinishedAt = concluido
	return run, nil
}

// ListPendingFetches: os alvos que a SPA pediu e o worker ainda não buscou.
// É a ponte entre o clique na tela e o poller Python -- nenhum dos dois
// conhece o outro.
func (r *ClubsRepository) ListPendingFetches(ctx context.Context) ([]domainclubs.FetchRun, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT target, target_id, label, running, players, matches, clubs, error, finished_at
		FROM clubs_fetch_runs
		WHERE running = true AND finished_at IS NULL
		ORDER BY requested_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list pending fetches: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.FetchRun
	for rows.Next() {
		var run domainclubs.FetchRun
		var concluido *time.Time
		if err := rows.Scan(&run.Target, &run.TargetID, &run.Label, &run.Running, &run.Players,
			&run.Matches, &run.Clubs, &run.Error, &concluido); err != nil {
			return nil, fmt.Errorf("scan fetch run: %w", err)
		}
		run.FinishedAt = concluido
		list = append(list, run)
	}
	return list, rows.Err()
}

// ClubsDoJogador: os clubes onde um jogador apareceu, das partidas já
// gravadas. É o que traduz "syncar jogador" em trabalho real -- a fonte não
// tem endpoint de jogador, então o dado dele vem das partidas dos clubes dele.
func (r *ClubsRepository) ClubsDoJogador(ctx context.Context, playerID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT club_id FROM clubs_match_players WHERE player_id = $1`, playerID)
	if err != nil {
		return nil, fmt.Errorf("clubs do jogador: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan clube do jogador: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ---------------------------------------------------------------- busca viva

// GetSearchRun é o estado da busca ao vivo de um termo. Termo nunca buscado
// devolve um run zerado -- é "ainda não busquei", não erro.
func (r *ClubsRepository) GetSearchRun(ctx context.Context, termo string) (domainclubs.SearchRun, error) {
	run := domainclubs.SearchRun{Termo: termo}
	var concluido *time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT running, found, error, finished_at
		FROM clubs_search_runs WHERE termo = $1`, termo).
		Scan(&run.Running, &run.Found, &run.Error, &concluido)
	if errors.Is(err, pgx.ErrNoRows) {
		return run, nil
	}
	if err != nil {
		return domainclubs.SearchRun{}, fmt.Errorf("get search run: %w", err)
	}
	run.FinishedAt = concluido
	return run, nil
}

// ListPendingSearches: os termos que a SPA pediu e o worker ainda não buscou.
func (r *ClubsRepository) ListPendingSearches(ctx context.Context) ([]domainclubs.SearchRun, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT termo, running, found, error, finished_at
		FROM clubs_search_runs
		WHERE running = true AND finished_at IS NULL
		ORDER BY requested_at ASC`)
	if err != nil {
		return nil, fmt.Errorf("list pending searches: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.SearchRun
	for rows.Next() {
		var run domainclubs.SearchRun
		var concluido *time.Time
		if err := rows.Scan(&run.Termo, &run.Running, &run.Found, &run.Error, &concluido); err != nil {
			return nil, fmt.Errorf("scan search run: %w", err)
		}
		run.FinishedAt = concluido
		list = append(list, run)
	}
	return list, rows.Err()
}

// ------------------------------------------------------------- administração

func (r *ClubsRepository) AdminStatus(ctx context.Context) (domainclubs.AdminStatus, error) {
	var st domainclubs.AdminStatus
	st.ByDivision = map[string]int{}

	if err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM clubs),
			(SELECT count(*) FROM clubs WHERE tracked = true),
			(SELECT count(*) FROM clubs_matches),
			(SELECT count(DISTINCT player_id) FROM clubs_match_players),
			(SELECT count(*) FROM clubs_snapshots),
			(SELECT count(*) FROM clubs_division_changes),
			(SELECT count(*) FROM clubs_announcements)`).
		Scan(&st.ClubsTotal, &st.ClubsTracked, &st.Matches, &st.Players,
			&st.Snapshots, &st.DivisionChanges, &st.Announcements); err != nil {
		return st, fmt.Errorf("admin counters: %w", err)
	}
	st.ClubsPending = st.ClubsTotal - st.ClubsTracked

	if t, err := r.LastMatchAt(ctx); err == nil {
		st.LastMatchAt = t
	}

	rows, err := r.pool.Query(ctx, `
		SELECT division, count(*) FROM clubs_totais
		WHERE division > 0 GROUP BY division ORDER BY division`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var d, n int
			if err := rows.Scan(&d, &n); err == nil {
				st.ByDivision[fmt.Sprintf("D%d", d)] = n
			}
		}
	}

	top, err := r.RankingClubs(ctx, "skill_rating")
	if err == nil && len(top) > 8 {
		top = top[:8]
	}
	st.TopClubs = top
	return st, nil
}

// IngestEstado lê a linha única de estado do worker.
func (r *ClubsRepository) IngestEstado(ctx context.Context) (domainclubs.IngestEstado, error) {
	var e domainclubs.IngestEstado
	err := r.pool.QueryRow(ctx, `
		SELECT last_cycle_at, cycles, clubs_ok, clubs_failed, new_matches,
		       snapshots, bootstrapped, last_error, last_error_at,
		       source_available, source_error
		FROM clubs_ingest_estado WHERE id = 1`).
		Scan(&e.LastCycleAt, &e.Cycles, &e.ClubesOK, &e.ClubsFailed, &e.NewMatches,
			&e.Snapshots, &e.Bootstrapped, &e.LastError, &e.LastErrorAt,
			&e.SourceAvailable, &e.SourceError)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nunca rodou: não é erro, é o estado inicial.
		return domainclubs.IngestEstado{}, nil
	}
	if err != nil {
		return domainclubs.IngestEstado{}, fmt.Errorf("ingest estado: %w", err)
	}
	if e.LastCycleAt != nil {
		e.Alive = time.Since(*e.LastCycleAt) < 3*time.Hour
	}
	return e, nil
}

// --------------------------------------------------------------- helpers

// foldAccents lowercases and strips diacritics so "uniao" finds "União" —
// the search is public and nobody types accents.
func foldAccents(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch r {
		case 'á', 'à', 'â', 'ã', 'ä', 'å':
			b.WriteRune('a')
		case 'é', 'è', 'ê', 'ë':
			b.WriteRune('e')
		case 'í', 'ì', 'î', 'ï':
			b.WriteRune('i')
		case 'ó', 'ò', 'ô', 'õ', 'ö':
			b.WriteRune('o')
		case 'ú', 'ù', 'û', 'ü':
			b.WriteRune('u')
		case 'ç':
			b.WriteRune('c')
		case 'ñ':
			b.WriteRune('n')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}
