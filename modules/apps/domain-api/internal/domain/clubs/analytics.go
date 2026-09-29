package clubs

import "time"

// Stats analíticos derivados do acervo acumulado.
//
// Tudo aqui é LEITURA sobre o que o worker já gravou -- nenhum campo novo de
// banco. É o que a fonte não dá: ela só conhece a janela recente de um clube, e
// estas visões cruzam o histórico (posição, temporada, consistência, duração em
// cada clube).

// SeasonScorer é um artilheiro dentro de uma temporada do clube.
type SeasonScorer struct {
	PlayerID string  `json:"player_id"`
	Gamertag string  `json:"gamertag"`
	Played   int     `json:"played"`
	Goals    int     `json:"goals"`
	Assists  int     `json:"assists"`
	Rating   float64 `json:"rating"`
}

// SeasonSummary é a leitura de uma temporada do clube. A fonte NÃO tem
// temporada (manda season_id="0"), então ela é derivada da data das partidas --
// mesma convenção do perfil do jogador (julho a junho).
type SeasonSummary struct {
	Season  string         `json:"season"`
	Played  int            `json:"played"`
	Wins    int            `json:"wins"`
	Draws   int            `json:"draws"`
	Losses  int            `json:"losses"`
	Goals   int            `json:"goals"`
	Against int            `json:"against"`
	Scorers []SeasonScorer `json:"scorers"`
}

// SeasonList é a lista de temporadas que o clube tem no acervo, mais recente
// primeiro, com a marcação de qual é a corrente.
type SeasonList struct {
	Seasons []SeasonSummary `json:"seasons"`
	Current string          `json:"current"`
}

// PositionCount é quantos jogadores apareceram numa posição.
type PositionCount struct {
	Position string `json:"position"`
	Players  int    `json:"players"`
}

// PositionHeatmap é a distribuição do elenco por posição no acervo -- o
// "heatmap de posição". É POR JOGADOR DISTINTO, não por aparição: a mesma
// pessoa jogando 20 vezes em defesa conta como um defensor.
type PositionHeatmap struct {
	Buckets []PositionCount `json:"buckets"`
	Total   int             `json:"total"`
}

// SquadChange é um jogador que entrou ou saiu do elenco entre temporadas.
type SquadChange struct {
	PlayerID string `json:"player_id"`
	Gamertag string `json:"gamertag"`
	Position string `json:"position"`
	Goals    int    `json:"goals"`
	// Kind: "saiu" (estava na temporada anterior e não na corrente) ou "entrou".
	Kind string `json:"kind"`
}

// SquadComparison compara o elenco da temporada corrente com o da anterior.
type SquadComparison struct {
	From    string        `json:"from"`
	To      string        `json:"to"`
	Stayed  int           `json:"stayed"`
	Entries []SquadChange `json:"entraram"`
	Exits   []SquadChange `json:"sairam"`
}

// RegionCount é quantos clubes (acompanhados ou não) o hub conhece numa região.
type RegionCount struct {
	RegionID string `json:"region_id"`
	Clubs    int    `json:"clubs"`
	Tracked  int    `json:"tracked"`
	TopName  string `json:"top_name"`
}

// TeamOfWeek é o melhor XI (por posição) das últimas partidas do clube, por
// nota média no período.
type TeamOfWeek struct {
	Since   time.Time     `json:"since"`
	Players []SquadMember `json:"players"`
}

// RollingGoals é a série de gols pró e contra por partida (janela rolante), na
// ordem cronológica -- o que o gráfico de gols pró vs contra desenha.
type RollingGoals struct {
	Matches []RollingGoalsPoint `json:"matches"`
}

// RollingGoalsPoint é um ponto da série: uma partida com os gols dos dois lados.
type RollingGoalsPoint struct {
	MatchID   string    `json:"match_id"`
	Timestamp time.Time `json:"timestamp"`
	Opponent  string    `json:"opponent"`
	Our       int       `json:"our"`
	Their     int       `json:"their"`
	Result    string    `json:"result"`
}

// MainRival é o adversário que mais apareceu no acervo do clube, com o
// retrospecto -- a "rivalidade principal".
type MainRival struct {
	Adversario
	Matches int `json:"matches"`
}

// ClubIdle é quanto tempo o clube está sem jogar, a partir da última partida.
type ClubIdle struct {
	LastMatch *time.Time `json:"last_match"`
	Days      int        `json:"days"`
	Idle      bool       `json:"idle"`
}

// PlayerRatingEvolution é a série de notas de um jogador por partida, na ordem
// cronológica -- o sparkline do perfil.
type PlayerRatingEvolution struct {
	Points []RatingPoint `json:"points"`
}

// RatingPoint é uma atuação: nota e contexto da partida.
type RatingPoint struct {
	MatchID   string    `json:"match_id"`
	Timestamp time.Time `json:"timestamp"`
	Opponent  string    `json:"opponent"`
	Rating    float64   `json:"rating"`
	Goals     int       `json:"goals"`
	Assists   int       `json:"assists"`
	Result    string    `json:"result"`
}

// PlayerConsistency mede quão estável é o jogador: média, desvio e o rótulo
// derivado. Um 8,0 de média com desvio baixo é mais confiável que um 8,0 que
// alterna 4 e 10.
type PlayerConsistency struct {
	Played     int     `json:"played"`
	Mean       float64 `json:"mean"`
	StdDev     float64 `json:"std_dev"`
	Best       float64 `json:"best"`
	Worst      float64 `json:"worst"`
	Volatility float64 `json:"volatility"`
}

// PlayerDiscipline é o agregado de cartões de um jogador no acervo.
type PlayerDiscipline struct {
	RedCards   int `json:"red_cards"`
	Matches    int `json:"matches"`
	CleanSheet int `json:"clean_sheets"`
}

// PlayerClubTenure é quanto tempo um jogador ficou num clube, derivado da
// primeira e da última aparição.
type PlayerClubTenure struct {
	ClubID    string    `json:"club_id"`
	ClubName  string    `json:"club_name"`
	FirstSeen time.Time `json:"first_seen"`
	LastSeen  time.Time `json:"last_seen"`
	Matches   int       `json:"matches"`
	Days      int       `json:"days"`
}

// EventSummary é a contagem de um tipo de evento para um jogador. A fonte não
// dá o MINUTO do evento (só o tipo e a contagem), então isto é o heatmap de
// tipo -- não de tempo.
type EventSummary struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

// PlayerEventBreakdown é a distribuição de eventos de um jogador, agregada de
// todas as partidas.
type PlayerEventBreakdown struct {
	PlayerID string         `json:"player_id"`
	Events   []EventSummary `json:"events"`
}

// BestByPosition é o melhor jogador de cada posição do clube, por nota média.
type BestByPosition struct {
	Position string      `json:"position"`
	Player   SquadMember `json:"player"`
}

// MatchHighlight é um destaque automático de uma partida (melhor em campo,
// hat-trick, goleada).
type MatchHighlight struct {
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	PlayerID string `json:"player_id,omitempty"`
	Gamertag string `json:"gamertag,omitempty"`
	Value    string `json:"value,omitempty"`
}

// HubReport é o relatório público do acervo -- o que o hub tem, sem login.
// Reusa os mesmos contadores do painel de admin, mas sem nada sensível.
type HubReport struct {
	Clubs        int        `json:"clubs"`
	TrackedClubs int        `json:"tracked_clubs"`
	Matches      int        `json:"matches"`
	Players      int        `json:"players"`
	Snapshots    int        `json:"snapshots"`
	FirstMatch   *time.Time `json:"first_match"`
	LastMatch    *time.Time `json:"last_match"`
	// Coverage: por quantos dias o hub cobre, da primeira à última partida.
	CoverageDays int `json:"coverage_days"`
}
