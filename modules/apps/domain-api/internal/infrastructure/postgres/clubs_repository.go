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
	SELECT c.club_id, c.nome, c.sigla, c.estadio, c.regiao_id, c.time_id, c.escudo_asset_id,
	       c.cor_1, c.cor_2, c.cor_3, c.cor_4, c.acompanhado, c.atualizado_em,
	       COALESCE(t.jogos,0), COALESCE(t.vitorias,0), COALESCE(t.empates,0), COALESCE(t.derrotas,0),
	       COALESCE(t.gols,0), COALESCE(t.gols_sofridos,0), COALESCE(t.jogos_sem_sofrer,0),
	       COALESCE(t.pontos,0), COALESCE(t.divisao_atual,0), COALESCE(t.melhor_divisao,0),
	       COALESCE(t.nivel,0), COALESCE(t.promocoes,0), COALESCE(t.rebaixamentos,0)
	FROM clubs c
	LEFT JOIN clubs_totais t ON t.club_id = c.club_id`

func scanClub(row pgx.Row) (domainclubs.Club, error) {
	var c domainclubs.Club
	err := row.Scan(
		&c.ClubID, &c.Nome, &c.Sigla, &c.Estadio, &c.RegiaoID, &c.TimeID, &c.EscudoAssetID,
		&c.Cor1, &c.Cor2, &c.Cor3, &c.Cor4, &c.Acompanhado, &c.AtualizadoEm,
		&c.Jogos, &c.Vitorias, &c.Empates, &c.Derrotas,
		&c.Gols, &c.GolsSofridos, &c.JogosSemSofrer,
		&c.Pontos, &c.DivisaoAtual, &c.MelhorDivisao,
		&c.Nivel, &c.Promocoes, &c.Rebaixamentos,
	)
	return c, err
}

// withAproveitamento fills the derived win-rate the ranking and the profile
// header both use.
func withAproveitamento(c domainclubs.Club) domainclubs.Club {
	if c.Jogos > 0 {
		c.Aproveitamento = float64(c.Pontos) / float64(c.Jogos*3) * 100
	}
	return c
}

// withForm fills each club's recent form from its persisted matches. The list
// and search paths need it just as much as the profile does -- without this,
// the directory shows "sem jogos" for every row, which reads as missing data
// rather than as "no matches in this window".
func (r *ClubsRepository) withForm(ctx context.Context, clubs []domainclubs.Club) []domainclubs.Club {
	for i := range clubs {
		matches, err := r.ListMatches(ctx, clubs[i].ClubID, "", 10)
		if err != nil {
			continue
		}
		form := make([]string, 0, len(matches))
		for _, m := range matches {
			form = append(form, m.NossoResultado)
		}
		clubs[i].Forma = form
	}
	return clubs
}

func (r *ClubsRepository) ListClubs(ctx context.Context, onlyFollowed bool) ([]domainclubs.Club, error) {
	q := clubJoin
	if onlyFollowed {
		q += ` WHERE c.acompanhado = true`
	}
	q += ` ORDER BY COALESCE(t.nivel,0) DESC, c.nome`
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
	rows, err := r.pool.Query(ctx, clubJoin+` ORDER BY COALESCE(t.nivel,0) DESC, c.nome`)
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
		if needle == "" || strings.Contains(foldAccents(c.Nome), needle) {
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
	SELECT m.id, m.match_id, m.timestamp, m.tipo, m.rodada_playoff,
	       m.clube_casa_id, m.clube_fora_id, m.gols_casa, m.gols_fora,
	       m.houve_desistencia, m.vencedor_por_desistencia_id, m.resultado_casa, m.lances,
	       COALESCE(cc.nome,''), COALESCE(cc.sigla,''), COALESCE(cf.nome,''), COALESCE(cf.sigla,''),
	       COALESCE(ag.nota, 0)
	FROM clubs_matches m
	LEFT JOIN clubs cc ON cc.club_id = m.clube_casa_id
	LEFT JOIN clubs cf ON cf.club_id = m.clube_fora_id
	LEFT JOIN (
		SELECT partida_id, round(avg(nota)::numeric, 2) AS nota
		FROM clubs_match_players GROUP BY partida_id
	) ag ON ag.partida_id = m.id`

func scanMatch(row pgx.Row) (domainclubs.Match, error) {
	var m domainclubs.Match
	var lances []byte
	err := row.Scan(
		&m.ID, &m.MatchID, &m.Timestamp, &m.Tipo, &m.RodadaPlayoff,
		&m.ClubeCasaID, &m.ClubeForaID, &m.GolsCasa, &m.GolsFora,
		&m.HouveDesistencia, &m.VencedorPorDesistenciaID, &m.ResultadoCasa, &lances,
		&m.CasaNome, &m.CasaSigla, &m.ForaNome, &m.ForaSigla, &m.NotaAgregada,
	)
	if err != nil {
		return m, err
	}
	if len(lances) > 0 {
		_ = json.Unmarshal(lances, &m.Lances)
	}
	return m, nil
}

// orient fills in "which side was this club on" plus the mirrored result, so
// no caller has to work out whether the requested club was home.
func orient(m domainclubs.Match, clubID string) domainclubs.Match {
	if m.ClubeCasaID == clubID {
		m.NossoLado = "casa"
		m.NossoResultado = m.ResultadoCasa
		m.NossosGols, m.GolsDeles = m.GolsCasa, m.GolsFora
		m.AdversarioID, m.AdversarioNome, m.AdversarioSigla = m.ClubeForaID, m.ForaNome, m.ForaSigla
	} else {
		m.NossoLado = "fora"
		m.NossoResultado = mirror(m.ResultadoCasa)
		m.NossosGols, m.GolsDeles = m.GolsFora, m.GolsCasa
		m.AdversarioID, m.AdversarioNome, m.AdversarioSigla = m.ClubeCasaID, m.CasaNome, m.CasaSigla
	}
	return m
}

func mirror(r string) string {
	switch r {
	case "vitoria":
		return "derrota"
	case "derrota":
		return "vitoria"
	default:
		return "empate"
	}
}

func (r *ClubsRepository) ListMatches(ctx context.Context, clubID, tipo string, limit int) ([]domainclubs.Match, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if tipo == "" {
		rows, err = r.pool.Query(ctx, matchSelect+`
			WHERE m.clube_casa_id = $1 OR m.clube_fora_id = $1
			ORDER BY m.timestamp DESC LIMIT $2`, clubID, limit)
	} else {
		rows, err = r.pool.Query(ctx, matchSelect+`
			WHERE (m.clube_casa_id = $1 OR m.clube_fora_id = $1) AND m.tipo = $2
			ORDER BY m.timestamp DESC LIMIT $3`, clubID, tipo, limit)
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
	m.Jogadores = linhas
	// A match detail is shown without a "requested club", so orient from the
	// home side so the fields are always populated.
	return orient(m, m.ClubeCasaID), nil
}

func (r *ClubsRepository) matchLines(ctx context.Context, partidaID string) ([]domainclubs.PlayerLine, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT club_id, player_id, gamertag, posicao, nota, gols, assistencias, chutes,
		       passes_certos, passes_tentados, desarmes_certos, desarmes_tentados, defesas,
		       defesas_por_tipo, segundos_jogados, melhor_em_campo, cartao_vermelho, jogo_sem_sofrer_gol
		FROM clubs_match_players WHERE partida_id = $1 ORDER BY nota DESC`, partidaID)
	if err != nil {
		return nil, fmt.Errorf("match lines: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.PlayerLine
	for rows.Next() {
		var l domainclubs.PlayerLine
		var tipo []byte
		if err := rows.Scan(&l.ClubID, &l.PlayerID, &l.Gamertag, &l.Posicao, &l.Nota, &l.Gols,
			&l.Assistencias, &l.Chutes, &l.PassesCertos, &l.PassesTentados, &l.DesarmesCertos,
			&l.DesarmesTentados, &l.Defesas, &tipo, &l.SegundosJogados, &l.MelhorEmCampo,
			&l.CartaoVermelho, &l.JogoSemSofrerGol); err != nil {
			return nil, fmt.Errorf("scan line: %w", err)
		}
		if len(tipo) > 0 {
			_ = json.Unmarshal(tipo, &l.DefesasPorTipo)
		}
		list = append(list, l)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) RecentMatchCount(ctx context.Context, clubID string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM clubs_matches WHERE clube_casa_id = $1 OR clube_fora_id = $1`,
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
		ClubeA: ref(a), ClubeB: ref(b),
	}
	for _, m := range matches {
		if m.AdversarioID != bID {
			continue
		}
		h.Jogos++
		h.GolsA += m.NossosGols
		h.GolsB += m.GolsDeles
		switch m.NossoResultado {
		case "vitoria":
			h.V++
			h.FormaA = append(h.FormaA, "V")
		case "derrota":
			h.D++
			h.FormaA = append(h.FormaA, "D")
		default:
			h.E++
			h.FormaA = append(h.FormaA, "E")
		}
		if len(h.Partidas) < 10 {
			h.Partidas = append(h.Partidas, m)
		}
	}
	return h, nil
}

func ref(c domainclubs.Club) domainclubs.ClubRef {
	return domainclubs.ClubRef{
		ClubID: c.ClubID, Nome: c.Nome, Sigla: c.Sigla, Divisao: c.DivisaoAtual,
		Nivel: c.Nivel, Pontos: c.Pontos, Gols: c.Gols, GolsSofridos: c.GolsSofridos,
		JogosSemSofrer: c.JogosSemSofrer, Acompanhado: c.Acompanhado,
	}
}

// ----------------------------------------------------------------- elenco

// Squad aggregates every player line of a club's matches into a season
// summary per player. The source has no squad endpoint that survives a
// season, so this is built from what the ingest accumulated.
func (r *ClubsRepository) Squad(ctx context.Context, clubID string) ([]domainclubs.SquadMember, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT l.player_id, l.gamertag, l.posicao, l.nota, l.gols, l.assistencias, l.chutes,
		       l.passes_certos, l.passes_tentados, l.desarmes_certos, l.desarmes_tentados,
		       l.defesas, l.melhor_em_campo, l.segundos_jogados, l.jogo_sem_sofrer_gol,
		       l.cartao_vermelho, l.defesas_por_tipo, m.timestamp
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.partida_id
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
			playerID, gamertag, posicao                             string
			nota                                                    float64
			gols, assist, chutes, pc, pt, dc, dt, defesas, segundos int
			// melhor_em_campo is a real boolean column -- scanning it into an
			// int fails in binary format.
			melhor bool
			cs, cv bool
			tipo   []byte
			ts     time.Time
		)
		if err := rows.Scan(&playerID, &gamertag, &posicao, &nota, &gols, &assist, &chutes,
			&pc, &pt, &dc, &dt, &defesas, &melhor, &segundos, &cs, &cv, &tipo, &ts); err != nil {
			return nil, fmt.Errorf("scan squad row: %w", err)
		}
		a := byPlayer[playerID]
		if a == nil {
			a = &acc{member: domainclubs.SquadMember{PlayerID: playerID, Gamertag: gamertag, Posicao: posicao,
				Goleiro: posicao == "goleiro"}}
			byPlayer[playerID] = a
			order = append(order, playerID)
		}
		m := &a.member
		m.Jogos++
		m.Gols += gols
		m.Assistencias += assist
		m.Chutes += chutes
		m.PassesCertos += pc
		m.PassesTentados += pt
		m.DesarmesCertos += dc
		m.DesarmesTentados += dt
		m.Defesas += defesas
		m.SegundosJogados += segundos
		if melhor {
			m.MelhorEmCampo++
		}
		if cs {
			m.CleanSheets++
		}
		if cv {
			m.CartoesVermelhos++
		}
		m.Nota += nota
		a.notas = append(a.notas, nota)
		if len(tipo) > 0 {
			var d map[string]int
			if json.Unmarshal(tipo, &d) == nil {
				if m.DefesasPorTipo == nil {
					m.DefesasPorTipo = map[string]int{}
				}
				for k, v := range d {
					m.DefesasPorTipo[k] += v
				}
			}
		}
		if len(m.Forma) < 8 {
			m.Forma = append(m.Forma, nota)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]domainclubs.SquadMember, 0, len(order))
	for _, id := range order {
		m := byPlayer[id].member
		if m.Jogos > 0 {
			m.Nota = round2(m.Nota / float64(m.Jogos))
			m.GolsPorJogo = round2(float64(m.Gols) / float64(m.Jogos))
			m.AssistenciasPorJogo = round2(float64(m.Assistencias) / float64(m.Jogos))
			m.PassesPrecisao = pct(m.PassesCertos, m.PassesTentados)
			m.DesarmesPrecisao = pct(m.DesarmesCertos, m.DesarmesTentados)
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Nota > out[j].Nota })
	return out, nil
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

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
		SELECT l.club_id, l.player_id, l.gamertag, l.posicao, l.nota, l.gols, l.assistencias,
		       l.chutes, l.passes_certos, l.passes_tentados, l.desarmes_certos, l.desarmes_tentados,
		       l.defesas, l.defesas_por_tipo, l.segundos_jogados, l.melhor_em_campo,
		       l.cartao_vermelho, l.jogo_sem_sofrer_gol,
		       m.id, m.match_id, m.timestamp, m.tipo, m.clube_casa_id, m.clube_fora_id,
		       m.gols_casa, m.gols_fora, m.resultado_casa, COALESCE(cc.nome,''), COALESCE(cf.nome,'')
		FROM clubs_match_players l
		JOIN clubs_matches m ON m.id = l.partida_id
		LEFT JOIN clubs cc ON cc.club_id = m.clube_casa_id
		LEFT JOIN clubs cf ON cf.club_id = m.clube_fora_id ` + where + `
		ORDER BY m.timestamp ASC`
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("player rows: %w", err)
	}
	defer rows.Close()

	var out []playerRow
	for rows.Next() {
		var pr playerRow
		var tipo []byte
		if err := rows.Scan(
			&pr.line.ClubID, &pr.line.PlayerID, &pr.line.Gamertag, &pr.line.Posicao, &pr.line.Nota,
			&pr.line.Gols, &pr.line.Assistencias, &pr.line.Chutes, &pr.line.PassesCertos,
			&pr.line.PassesTentados, &pr.line.DesarmesCertos, &pr.line.DesarmesTentados,
			&pr.line.Defesas, &tipo, &pr.line.SegundosJogados, &pr.line.MelhorEmCampo,
			&pr.line.CartaoVermelho, &pr.line.JogoSemSofrerGol,
			&pr.match.ID, &pr.match.MatchID, &pr.match.Timestamp, &pr.match.Tipo,
			&pr.match.ClubeCasaID, &pr.match.ClubeForaID, &pr.match.GolsCasa, &pr.match.GolsFora,
			&pr.match.ResultadoCasa, &pr.match.CasaNome, &pr.match.ForaNome,
		); err != nil {
			return nil, fmt.Errorf("scan player row: %w", err)
		}
		if len(tipo) > 0 {
			_ = json.Unmarshal(tipo, &pr.line.DefesasPorTipo)
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

// buildProfile derives every aggregate number for one player from their rows.
func buildProfile(playerID string, rows []playerRow, clubNames map[string]string, verified bool) domainclubs.PlayerProfile {
	p := domainclubs.PlayerProfile{PlayerID: playerID, Verificado: verified, Forma: []float64{}}
	byClub := map[string]*domainclubs.PlayerClub{}
	var order []string
	var notaSum float64
	var pc, pt, dc, dt int

	for _, pr := range rows {
		if p.Gamertag == "" {
			p.Gamertag = pr.line.Gamertag
			p.Posicao = pr.line.Posicao
			p.Goleiro = pr.line.Posicao == "goleiro"
		}
		p.Jogos++
		p.Gols += pr.line.Gols
		p.Assistencias += pr.line.Assistencias
		p.SegundosJogados += pr.line.SegundosJogados
		if pr.line.MelhorEmCampo {
			p.MelhorEmCampo++
		}
		if pr.line.JogoSemSofrerGol {
			p.CleanSheets++
		}
		if pr.line.CartaoVermelho {
			p.CartoesVermelhos++
		}
		notaSum += pr.line.Nota
		pc += pr.line.PassesCertos
		pt += pr.line.PassesTentados
		dc += pr.line.DesarmesCertos
		dt += pr.line.DesarmesTentados
		if len(p.Forma) < 8 {
			p.Forma = append(p.Forma, pr.line.Nota)
		}
		if len(pr.line.DefesasPorTipo) > 0 {
			if p.DefesasPorTipo == nil {
				p.DefesasPorTipo = map[string]int{}
			}
			for k, v := range pr.line.DefesasPorTipo {
				p.DefesasPorTipo[k] += v
			}
		}
		// Per-club cluster.
		c, ok := byClub[pr.line.ClubID]
		if !ok {
			c = &domainclubs.PlayerClub{ClubID: pr.line.ClubID, Nome: clubNames[pr.line.ClubID]}
			byClub[pr.line.ClubID] = c
			order = append(order, pr.line.ClubID)
		}
		c.Jogos++
		c.Gols += pr.line.Gols
		c.Assistencias += pr.line.Assistencias
		c.Nota += pr.line.Nota

		// Recent performances, newest last in this ASC scan; keep the tail.
		pm := domainclubs.PlayerMatch{
			MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp,
			Nota: pr.line.Nota, Gols: pr.line.Gols, Assistencias: pr.line.Assistencias,
			Chutes: pr.line.Chutes, PassesCertos: pr.line.PassesCertos,
			PassesTentados: pr.line.PassesTentados, DesarmesCertos: pr.line.DesarmesCertos,
			DesarmesTentados: pr.line.DesarmesTentados, SegundosJogados: pr.line.SegundosJogados,
			GolsCasa: pr.match.GolsCasa, GolsFora: pr.match.GolsFora,
		}
		if pr.match.ClubeCasaID == pr.line.ClubID {
			pm.Resultado = pr.match.ResultadoCasa
			pm.AdversarioNome = pr.match.ForaNome
		} else {
			pm.Resultado = mirror(pr.match.ResultadoCasa)
			pm.AdversarioNome = pr.match.CasaNome
		}
		p.Partidas = append(p.Partidas, pm)
	}

	if p.Jogos > 0 {
		p.Nota = round2(notaSum / float64(p.Jogos))
		p.GolsPorJogo = round2(float64(p.Gols) / float64(p.Jogos))
		p.AssistenciasPorJogo = round2(float64(p.Assistencias) / float64(p.Jogos))
		p.PassesPrecisao = pct(pc, pt)
		p.DesarmesPrecisao = pct(dc, dt)
	}
	for _, id := range order {
		c := byClub[id]
		if c.Jogos > 0 {
			c.Nota = round2(c.Nota / float64(c.Jogos))
		}
		p.Clubes = append(p.Clubes, *c)
	}
	// Main club = the one with the most appearances.
	if len(p.Clubes) > 0 {
		best := p.Clubes[0]
		for _, c := range p.Clubes[1:] {
			if c.Jogos > best.Jogos {
				best = c
			}
		}
		p.ClubeID, p.ClubeNome = best.ClubID, best.Nome
	}
	// Most recent 12 performances, newest first.
	if len(p.Partidas) > 12 {
		p.Partidas = p.Partidas[len(p.Partidas)-12:]
	}
	for i, j := 0, len(p.Partidas)-1; i < j; i, j = i+1, j-1 {
		p.Partidas[i], p.Partidas[j] = p.Partidas[j], p.Partidas[i]
	}
	return p
}

func (r *ClubsRepository) clubNameMap(ctx context.Context) (map[string]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT club_id, nome FROM clubs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var id, nome string
		if err := rows.Scan(&id, &nome); err != nil {
			return nil, err
		}
		m[id] = nome
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
	return buildProfile(playerID, rows, names, verified), nil
}

func (r *ClubsRepository) AllPlayers(ctx context.Context) ([]domainclubs.PlayerProfile, error) {
	return r.playersGrouped(ctx, "", nil)
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
		out = append(out, buildProfile(id, grouped[id], names, verified[id]))
	}
	return out, nil
}

// ClaimedPlayerIDs is the set of player ids carrying a verified badge. It
// deliberately exposes nothing about WHO claimed them.
func (r *ClubsRepository) ClaimedPlayerIDs(ctx context.Context) (map[string]bool, error) {
	rows, err := r.pool.Query(ctx, `SELECT player_id FROM clubs_claimed_pros WHERE verificado = true`)
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
			SELECT lido_em, nivel, divisao, jogos, vitorias, empates, derrotas, gols, gols_sofridos, tamanho_elenco
			FROM clubs_snapshots WHERE club_id = $1 ORDER BY lido_em ASC`, clubID)
	} else {
		rows, err = r.pool.Query(ctx, `
			SELECT lido_em, nivel, divisao, jogos, vitorias, empates, derrotas, gols, gols_sofridos, tamanho_elenco
			FROM clubs_snapshots WHERE club_id = $1 AND lido_em >= $2 ORDER BY lido_em ASC`, clubID, since)
	}
	if err != nil {
		return nil, fmt.Errorf("snapshots: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Snapshot
	for rows.Next() {
		var s domainclubs.Snapshot
		if err := rows.Scan(&s.LidoEm, &s.Nivel, &s.Divisao, &s.Jogos, &s.Vitorias,
			&s.Empates, &s.Derrotas, &s.Gols, &s.GolsSofridos, &s.TamanhoElenco); err != nil {
			return nil, fmt.Errorf("scan snapshot: %w", err)
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) LatestSnapshot(ctx context.Context, clubID string) (*domainclubs.Snapshot, error) {
	var s domainclubs.Snapshot
	err := r.pool.QueryRow(ctx, `
		SELECT lido_em, nivel, divisao, jogos, vitorias, empates, derrotas, gols, gols_sofridos, tamanho_elenco
		FROM clubs_snapshots WHERE club_id = $1 ORDER BY lido_em DESC LIMIT 1`, clubID).
		Scan(&s.LidoEm, &s.Nivel, &s.Divisao, &s.Jogos, &s.Vitorias, &s.Empates,
			&s.Derrotas, &s.Gols, &s.GolsSofridos, &s.TamanhoElenco)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest snapshot: %w", err)
	}
	return &s, nil
}

func (r *ClubsRepository) DivisionChanges(ctx context.Context, clubID string) ([]domainclubs.DivisionChange, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT detectado_em, de, para, tipo FROM clubs_division_changes
		WHERE club_id = $1 ORDER BY detectado_em DESC`, clubID)
	if err != nil {
		return nil, fmt.Errorf("division changes: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.DivisionChange
	for rows.Next() {
		var c domainclubs.DivisionChange
		if err := rows.Scan(&c.DetectadoEm, &c.De, &c.Para, &c.Tipo); err != nil {
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
	matches, err := r.ListMatches(ctx, clubID, "liga", 1000)
	if err != nil {
		return domainclubs.Records{}, err
	}
	// Fall back to every type when the club has no league matches yet.
	if len(matches) == 0 {
		if matches, err = r.ListMatches(ctx, clubID, "", 1000); err != nil {
			return domainclubs.Records{}, err
		}
	}

	rec := domainclubs.Records{TotalPartidas: len(matches)}
	var bestWin, worstLoss, mostGoals *domainclubs.Match
	for i := range matches {
		m := &matches[i]
		diff := m.NossosGols - m.GolsDeles
		if bestWin == nil || diff > bestWin.NossosGols-bestWin.GolsDeles {
			bestWin = m
		}
		if worstLoss == nil || diff < worstLoss.NossosGols-worstLoss.GolsDeles {
			worstLoss = m
		}
		if mostGoals == nil || (m.NossosGols+m.GolsDeles) > (mostGoals.NossosGols+mostGoals.GolsDeles) {
			mostGoals = m
		}
		if m.GolsDeles == 0 {
			rec.JogosSemSofrer++
		}
	}
	toRecord := func(m *domainclubs.Match) *domainclubs.RecordMatch {
		if m == nil {
			return nil
		}
		return &domainclubs.RecordMatch{
			MatchID: m.MatchID, Timestamp: m.Timestamp, AdversarioNome: m.AdversarioNome,
			NossosGols: m.NossosGols, GolsDeles: m.GolsDeles,
			Total: m.NossosGols + m.GolsDeles,
		}
	}
	rec.MaiorGoleada = toRecord(bestWin)
	rec.PiorDerrota = toRecord(worstLoss)
	rec.MaisGols = toRecord(mostGoals)

	// Longest win streak, in chronological order.
	chrono := make([]domainclubs.Match, len(matches))
	copy(chrono, matches)
	sort.SliceStable(chrono, func(i, j int) bool { return chrono[i].Timestamp.Before(chrono[j].Timestamp) })
	cur, best := 0, 0
	for _, m := range chrono {
		if m.NossoResultado == "vitoria" {
			cur++
			if cur > best {
				best = cur
			}
		} else {
			cur = 0
		}
	}
	rec.MaiorSequencia = best

	// Best individual rating and most goals in one match.
	lines, err := r.allPlayerRows(ctx, `WHERE l.club_id = $1`, clubID)
	if err != nil {
		return domainclubs.Records{}, err
	}
	for _, pr := range lines {
		if rec.MelhorNota == nil || pr.line.Nota > rec.MelhorNota.Nota {
			rec.MelhorNota = &domainclubs.RecordLine{
				PlayerID: pr.line.PlayerID, Gamertag: pr.line.Gamertag,
				MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp,
				Nota: pr.line.Nota, Gols: pr.line.Gols,
				AdversarioNome: adversaryOf(pr.match, pr.line.ClubID),
			}
		}
		if rec.MaisGolsJogo == nil || pr.line.Gols > rec.MaisGolsJogo.Gols {
			rec.MaisGolsJogo = &domainclubs.RecordLine{
				PlayerID: pr.line.PlayerID, Gamertag: pr.line.Gamertag,
				MatchID: pr.match.MatchID, Timestamp: pr.match.Timestamp,
				Nota: pr.line.Nota, Gols: pr.line.Gols,
				AdversarioNome: adversaryOf(pr.match, pr.line.ClubID),
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

// ------------------------------------------------------------------- feed

func (r *ClubsRepository) RecentAnnouncements(ctx context.Context, limit int) ([]domainclubs.Announcement, error) {
	if limit <= 0 {
		limit = 12
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, tipo, titulo, texto, referencia_id, icone, gerado_em
		FROM clubs_announcements
		WHERE expira_em IS NULL OR expira_em > now()
		ORDER BY gerado_em DESC LIMIT $1`, limit)
	if err != nil {
		return nil, fmt.Errorf("announcements: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.Announcement
	for rows.Next() {
		var a domainclubs.Announcement
		if err := rows.Scan(&a.ID, &a.Tipo, &a.Titulo, &a.Texto, &a.ReferenciaID, &a.Icone,
			&a.GeradoEm); err != nil {
			return nil, fmt.Errorf("scan announcement: %w", err)
		}
		list = append(list, a)
	}
	return list, rows.Err()
}

// ------------------------------------------------------------------ rankings

func (r *ClubsRepository) RankingClubs(ctx context.Context, metrica string) ([]domainclubs.ClubRef, error) {
	clubs, err := r.ListClubs(ctx, false)
	if err != nil {
		return nil, err
	}
	refs := make([]domainclubs.ClubRef, 0, len(clubs))
	for _, c := range clubs {
		if c.Jogos == 0 && c.Nivel == 0 {
			continue // never fetched at all — nothing to rank on
		}
		refs = append(refs, ref(c))
	}
	// The unbeaten run is computed per club; only the ranking needs it, so
	// it is filled here rather than in every ListClubs caller.
	for i := range refs {
		if seq, err := r.clubSequence(ctx, refs[i].ClubID); err == nil {
			refs[i].Invicta = seq.Invicta
		}
	}
	sortRefs(refs, metrica)
	return refs, nil
}

func sortRefs(refs []domainclubs.ClubRef, metrica string) {
	less := func(i, j int) bool { return refs[i].Nivel > refs[j].Nivel }
	switch metrica {
	case "pontos":
		less = func(i, j int) bool { return refs[i].Pontos > refs[j].Pontos }
	case "gols":
		less = func(i, j int) bool { return refs[i].Gols > refs[j].Gols }
	case "jogos_sem_sofrer":
		less = func(i, j int) bool { return refs[i].JogosSemSofrer > refs[j].JogosSemSofrer }
	case "aproveitamento", "aproveitamento_pct", "winrate":
		less = func(i, j int) bool {
			return pct(refs[i].Pontos, refs[i].Pontos+refs[i].Gols) > pct(refs[j].Pontos, refs[j].Pontos+refs[j].Gols)
		}
	}
	sort.SliceStable(refs, less)
}

func (r *ClubsRepository) RankingPlayers(ctx context.Context, metrica, posicao string) ([]domainclubs.RankPlayer, error) {
	players, err := r.AllPlayers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]domainclubs.RankPlayer, 0, len(players))
	for _, p := range players {
		if posicao != "" && p.Posicao != posicao {
			continue
		}
		if p.Jogos == 0 {
			continue
		}
		out = append(out, domainclubs.RankPlayer{
			PlayerID: p.PlayerID, Gamertag: p.Gamertag, Posicao: p.Posicao,
			ClubID: p.ClubeID, ClubeNome: p.ClubeNome, ClubeSigla: p.ClubeSigla,
			Jogos: p.Jogos, Gols: p.Gols, Assistencias: p.Assistencias, Nota: p.Nota,
			GolsPorJogo: p.GolsPorJogo, Verificado: p.Verificado,
		})
	}
	sortPlayers(out, metrica)
	if len(out) > 100 {
		out = out[:100]
	}
	return out, nil
}

func sortPlayers(list []domainclubs.RankPlayer, metrica string) {
	less := func(i, j int) bool { return list[i].Nota > list[j].Nota }
	switch metrica {
	case "gols":
		less = func(i, j int) bool { return list[i].Gols > list[j].Gols }
	case "assistencias":
		less = func(i, j int) bool { return list[i].Assistencias > list[j].Assistencias }
	case "gols_por_jogo", "gols_por_partida":
		less = func(i, j int) bool { return list[i].GolsPorJogo > list[j].GolsPorJogo }
	case "jogos":
		less = func(i, j int) bool { return list[i].Jogos > list[j].Jogos }
	}
	sort.SliceStable(list, less)
}

// clubSequence computes the current win and unbeaten runs from persisted
// matches — the source only reports these for its own recent window.
func (r *ClubsRepository) clubSequence(ctx context.Context, clubID string) (domainclubs.Sequencia, error) {
	matches, err := r.ListMatches(ctx, clubID, "", 100)
	if err != nil {
		return domainclubs.Sequencia{}, err
	}
	var s domainclubs.Sequencia
	for _, m := range matches { // newest first
		if m.NossoResultado == "vitoria" {
			s.Vitorias++
			s.Invicta++
			continue
		}
		if m.NossoResultado == "empate" && s.Vitorias == 0 {
			s.Invicta++
			continue
		}
		break
	}
	return s, nil
}

// --------------------------------------------------------------- preferências

func (r *ClubsRepository) ListWatch(ctx context.Context, usuarioEmail string) ([]domainclubs.WatchEntry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT w.club_id, COALESCE(c.nome,''), COALESCE(c.sigla,''),
		       COALESCE(t.divisao_atual,0), COALESCE(t.nivel,0), w.seguindo_desde, w.origem
		FROM clubs_watchlist w
		LEFT JOIN clubs c ON c.club_id = w.club_id
		LEFT JOIN clubs_totais t ON t.club_id = w.club_id
		WHERE w.usuario_email = $1
		ORDER BY w.seguindo_desde DESC`, usuarioEmail)
	if err != nil {
		return nil, fmt.Errorf("list watch: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.WatchEntry
	for rows.Next() {
		var e domainclubs.WatchEntry
		if err := rows.Scan(&e.ClubID, &e.Nome, &e.Sigla, &e.Divisao, &e.Nivel,
			&e.SeguindoDesde, &e.Origem); err != nil {
			return nil, fmt.Errorf("scan watch: %w", err)
		}
		list = append(list, e)
	}
	return list, rows.Err()
}

func (r *ClubsRepository) GetNotificacoes(ctx context.Context, usuarioEmail string) (domainclubs.NotificationPrefs, error) {
	var p domainclubs.NotificationPrefs
	err := r.pool.QueryRow(ctx, `
		SELECT canal, resumo_periodico, recordes_e_divisoes, resultado_partidas
		FROM clubs_preferences WHERE usuario_email = $1`, usuarioEmail).
		Scan(&p.Canal, &p.ResumoPeriodico, &p.RecordesEDivisoes, &p.ResultadoPartidas)
	if errors.Is(err, pgx.ErrNoRows) {
		// Defaults with no channel — nothing is sent until one is set.
		return domainclubs.NotificationPrefs{ResumoPeriodico: true, RecordesEDivisoes: true, ResultadoPartidas: true}, nil
	}
	if err != nil {
		return domainclubs.NotificationPrefs{}, fmt.Errorf("get notificacoes: %w", err)
	}
	return p, nil
}

func (r *ClubsRepository) GetClaimed(ctx context.Context, usuarioEmail string) (*domainclubs.ClaimedPro, error) {
	var p domainclubs.ClaimedPro
	err := r.pool.QueryRow(ctx, `
		SELECT club_id, player_id, verificado FROM clubs_claimed_pros WHERE usuario_email = $1`,
		usuarioEmail).Scan(&p.ClubID, &p.PlayerID, &p.Verificado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get claimed: %w", err)
	}
	return &p, nil
}

func (r *ClubsRepository) GetSyncRun(ctx context.Context, usuarioEmail string) (domainclubs.SyncRun, error) {
	var run domainclubs.SyncRun
	var novos []byte
	err := r.pool.QueryRow(ctx, `
		SELECT rodando, nivel, total, concluidos, atual, novos,
		       COALESCE(iniciado_em, 'epoch'::timestamptz), COALESCE(concluido_em, 'epoch'::timestamptz)
		FROM clubs_sync_runs WHERE usuario_email = $1`, usuarioEmail).
		Scan(&run.Rodando, &run.Nivel, &run.Total, &run.Concluidos, &run.Atual, &novos,
			&run.IniciadoEm, &run.ConcluidoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		return domainclubs.SyncRun{Novos: []string{}}, nil
	}
	if err != nil {
		return domainclubs.SyncRun{}, fmt.Errorf("get sync run: %w", err)
	}
	if len(novos) > 0 {
		_ = json.Unmarshal(novos, &run.Novos)
	}
	return run, nil
}

// ListPendingSyncs: quem pediu sincronização e ainda não terminou.
func (r *ClubsRepository) ListPendingSyncs(ctx context.Context) ([]domainclubs.SyncRun, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT usuario_email, rodando, nivel, total, concluidos, atual, novos,
		       COALESCE(iniciado_em, 'epoch'::timestamptz), COALESCE(concluido_em, 'epoch'::timestamptz)
		FROM clubs_sync_runs
		WHERE rodando = true AND concluido_em IS NULL
		ORDER BY iniciado_em ASC`)
	if err != nil {
		return nil, fmt.Errorf("list pending syncs: %w", err)
	}
	defer rows.Close()

	var list []domainclubs.SyncRun
	for rows.Next() {
		var run domainclubs.SyncRun
		var novos []byte
		if err := rows.Scan(&run.UsuarioEmail, &run.Rodando, &run.Nivel, &run.Total,
			&run.Concluidos, &run.Atual, &novos, &run.IniciadoEm, &run.ConcluidoEm); err != nil {
			return nil, fmt.Errorf("scan pending sync: %w", err)
		}
		if len(novos) > 0 {
			_ = json.Unmarshal(novos, &run.Novos)
		}
		list = append(list, run)
	}
	return list, rows.Err()
}

// ------------------------------------------------------------- administração

func (r *ClubsRepository) AdminStatus(ctx context.Context) (domainclubs.AdminStatus, error) {
	var st domainclubs.AdminStatus
	st.PorDivisao = map[string]int{}

	if err := r.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM clubs),
			(SELECT count(*) FROM clubs WHERE acompanhado = true),
			(SELECT count(*) FROM clubs_matches),
			(SELECT count(DISTINCT player_id) FROM clubs_match_players),
			(SELECT count(*) FROM clubs_snapshots),
			(SELECT count(*) FROM clubs_division_changes),
			(SELECT count(*) FROM clubs_announcements)`).
		Scan(&st.ClubesTotal, &st.ClubesAcompanhados, &st.Partidas, &st.Jogadores,
			&st.Snapshots, &st.MudancasDivisao, &st.Anuncios); err != nil {
		return st, fmt.Errorf("admin counters: %w", err)
	}
	st.ClubesPendentes = st.ClubesTotal - st.ClubesAcompanhados

	if t, err := r.LastMatchAt(ctx); err == nil {
		st.UltimaPartida = t
	}

	rows, err := r.pool.Query(ctx, `
		SELECT divisao_atual, count(*) FROM clubs_totais
		WHERE divisao_atual > 0 GROUP BY divisao_atual ORDER BY divisao_atual`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var d, n int
			if err := rows.Scan(&d, &n); err == nil {
				st.PorDivisao[fmt.Sprintf("D%d", d)] = n
			}
		}
	}

	top, err := r.RankingClubs(ctx, "nivel")
	if err == nil && len(top) > 8 {
		top = top[:8]
	}
	st.TopClubes = top
	return st, nil
}

// IngestEstado lê a linha única de estado do worker.
func (r *ClubsRepository) IngestEstado(ctx context.Context) (domainclubs.IngestEstado, error) {
	var e domainclubs.IngestEstado
	err := r.pool.QueryRow(ctx, `
		SELECT ultimo_ciclo_em, rodadas, clubes_ok, clubes_falhos, partidas_novas,
		       snapshots, bootstrap_feito, ultimo_erro, ultimo_erro_em
		FROM clubs_ingest_estado WHERE id = 1`).
		Scan(&e.UltimoCicloEm, &e.Rodadas, &e.ClubesOK, &e.ClubesFalhos, &e.PartidasNovas,
			&e.Snapshots, &e.BootstrapFeito, &e.UltimoErro, &e.UltimoErroEm)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nunca rodou: não é erro, é o estado inicial.
		return domainclubs.IngestEstado{}, nil
	}
	if err != nil {
		return domainclubs.IngestEstado{}, fmt.Errorf("ingest estado: %w", err)
	}
	if e.UltimoCicloEm != nil {
		e.Vivo = time.Since(*e.UltimoCicloEm) < 3*time.Hour
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
