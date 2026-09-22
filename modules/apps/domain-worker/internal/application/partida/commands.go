// Package partida holds the application.Command payloads for the Partida
// aggregate (and the closely related ClubeTotais, which travels in the same
// ingest cycle and would be odd to split into its own package).
package partida

// LinhaInput is one player's line in the upsert payload.
type LinhaInput struct {
	ClubID           string   `json:"club_id"`
	PlayerID         string   `json:"player_id"`
	Gamertag         string   `json:"gamertag"`
	Posicao          string   `json:"posicao"`
	Nota             float64  `json:"nota"`
	Gols             int      `json:"gols"`
	Assistencias     int      `json:"assistencias"`
	Chutes           int      `json:"chutes"`
	PassesCertos     int      `json:"passes_certos"`
	PassesTentados   int      `json:"passes_tentados"`
	DesarmesCertos   int      `json:"desarmes_certos"`
	DesarmesTentados int      `json:"desarmes_tentados"`
	Defesas          int      `json:"defesas"`
	// DefesasPorTipo rides as an object; nil for anyone but a goalkeeper.
	DefesasPorTipo   map[string]int `json:"defesas_por_tipo,omitempty"`
	SegundosJogados  int      `json:"segundos_jogados"`
	MelhorEmCampo    bool     `json:"melhor_em_campo"`
	CartaoVermelho   bool     `json:"cartao_vermelho"`
	JogoSemSofrerGol bool     `json:"jogo_sem_sofrer_gol"`
}

// UpsertInput is the partida.upsert payload: the match plus BOTH sides'
// player lines, because a match without its summary is not a valid match.
// resultado_casa is already normalized by the ingest — the source's five
// numeric codes never reach this layer.
type UpsertInput struct {
	MatchID                  string       `json:"match_id"`
	Timestamp                string       `json:"timestamp"`
	Tipo                     string       `json:"tipo"`
	RodadaPlayoff            string       `json:"rodada_playoff,omitempty"`
	ClubeCasaID              string       `json:"clube_casa_id"`
	ClubeForaID              string       `json:"clube_fora_id"`
	GolsCasa                 int          `json:"gols_casa"`
	GolsFora                 int          `json:"gols_fora"`
	HouveDesistencia         bool         `json:"houve_desistencia"`
	VencedorPorDesistenciaID string       `json:"vencedor_por_desistencia_id,omitempty"`
	ResultadoCasa            string       `json:"resultado_casa"`
	Lances                   []any        `json:"lances,omitempty"`
	Jogadores                []LinhaInput `json:"jogadores"`
}

// TotaisInput is the clubetotais.upsert payload.
type TotaisInput struct {
	ClubID         string `json:"club_id"`
	Jogos          int    `json:"jogos"`
	Vitorias       int    `json:"vitorias"`
	Empates        int    `json:"empates"`
	Derrotas       int    `json:"derrotas"`
	Gols           int    `json:"gols"`
	GolsSofridos   int    `json:"gols_sofridos"`
	JogosSemSofrer int    `json:"jogos_sem_sofrer"`
	Pontos         int    `json:"pontos"`
	DivisaoAtual   int    `json:"divisao_atual"`
	MelhorDivisao  int    `json:"melhor_divisao"`
	Nivel          int    `json:"nivel"`
	Promocoes      int    `json:"promocoes"`
	Rebaixamentos  int    `json:"rebaixamentos"`
}
