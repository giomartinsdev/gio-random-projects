// Package clubs holds domain-api's copies of the clubs command payloads —
// the shapes domain-worker decodes on the other end. domain-api only ever
// BUILDS these, never applies them, so there is no Service/Handler here.
// Field names and json tags must not drift from
// domain-worker/internal/application/{club,partida,clubesnapshot,preferencia,anuncio}.
package clubs

type UpsertClubInput struct {
	ClubID        string `json:"club_id"`
	Name          string `json:"name"`
	Tag         string `json:"tag,omitempty"`
	Stadium       string `json:"stadium,omitempty"`
	RegiaoID      string `json:"region_id,omitempty"`
	TimeID        string `json:"team_id,omitempty"`
	EscudoAssetID string `json:"crest_asset_id,omitempty"`
	Color1          int    `json:"color_1,omitempty"`
	Color2          int    `json:"color_2,omitempty"`
	Color3          int    `json:"color_3,omitempty"`
	Color4          int    `json:"color_4,omitempty"`
	Tracked   bool   `json:"tracked,omitempty"`
}

type TotaisInput struct {
	ClubID         string `json:"club_id"`
	Played          int    `json:"played"`
	Wins       int    `json:"wins"`
	Draws        int    `json:"draws"`
	Losses       int    `json:"losses"`
	Goals           int    `json:"goals"`
	GoalsConceded   int    `json:"goals_conceded"`
	CleanSheets int    `json:"clean_sheets"`
	Points         int    `json:"points"`
	Division   int    `json:"division"`
	BestDivision  int    `json:"best_division"`
	SkillRating          int    `json:"skill_rating"`
	Promotions      int    `json:"promotions"`
	Relegations  int    `json:"relegations"`
}

type PlayerLineInput struct {
	ClubID           string         `json:"club_id"`
	PlayerID         string         `json:"player_id"`
	Gamertag         string         `json:"gamertag"`
	Position          string         `json:"position"`
	Rating             float64        `json:"rating"`
	Goals             int            `json:"goals"`
	Assists     int            `json:"assists"`
	Shots           int            `json:"shots"`
	PassesMade     int            `json:"passes_made"`
	PassesAttempted   int            `json:"passes_attempted"`
	TacklesMade   int            `json:"tackles_made"`
	TacklesAttempted int            `json:"tackles_attempted"`
	Saves          int            `json:"saves"`
	SavesByType   map[string]int `json:"saves_by_type,omitempty"`
	SecondsPlayed  int            `json:"seconds_played"`
	ManOfTheMatch    bool           `json:"man_of_the_match"`
	RedCard   bool           `json:"red_card"`
	CleanSheet bool           `json:"clean_sheet"`
}

type PartidaInput struct {
	MatchID                  string            `json:"match_id"`
	Timestamp                string            `json:"timestamp"`
	Kind                     string            `json:"kind"`
	PlayoffRound            string            `json:"playoff_round,omitempty"`
	ClubeCasaID              string            `json:"home_club_id"`
	ClubeForaID              string            `json:"away_club_id"`
	HomeGoals                 int               `json:"home_goals"`
	AwayGoals                 int               `json:"away_goals"`
	DecidedByForfeit         bool              `json:"decided_by_forfeit"`
	VencedorPorDesistenciaID string            `json:"forfeit_winner_id,omitempty"`
	HomeResult            string            `json:"home_result"`
	Events                   []any             `json:"events,omitempty"`
	Players                []PlayerLineInput `json:"players"`
}

type SnapshotInput struct {
	ClubID        string `json:"club_id"`
	SkillRating         int    `json:"skill_rating"`
	DivisionAtRead       int    `json:"division_at_read"`
	Played         int    `json:"played"`
	Wins      int    `json:"wins"`
	Draws       int    `json:"draws"`
	Losses      int    `json:"losses"`
	Goals          int    `json:"goals"`
	GoalsConceded  int    `json:"goals_conceded"`
	SquadSize int    `json:"squad_size"`
}

type AnuncioInput struct {
	Kind          string `json:"kind"`
	Title        string `json:"title"`
	Body         string `json:"body,omitempty"`
	ReferenciaID  string `json:"reference_id,omitempty"`
	Icon         string `json:"icon,omitempty"`
	// Data são os fatos do aviso (resultado, gols, tipo de partida), para a
	// interface montar a frase no idioma escolhido.
	Data          map[string]any `json:"data,omitempty"`
	ExpiraEmHoras int    `json:"expira_em_horas,omitempty"`
}

// CareerInput são os totais de carreira de um jogador num clube, do
// members/career/stats da fonte.
type CareerInput struct {
	ClubID        string  `json:"club_id"`
	Gamertag      string  `json:"gamertag"`
	Played         int     `json:"played"`
	Goals          int     `json:"goals"`
	Assists  int     `json:"assists"`
	ManOfTheMatch int     `json:"man_of_the_match"`
	Rating          float64 `json:"rating"`
	Position       string  `json:"position"`
}

type WatchInput struct {
	UserEmail string `json:"user_email"`
	ClubID       string `json:"club_id"`
	Source       string `json:"source,omitempty"`
	Seguindo     bool   `json:"seguindo"`
}

type NotifyInput struct {
	UserEmail      string `json:"user_email"`
	Channel             string `json:"channel,omitempty"`
	WeeklyDigest   bool   `json:"weekly_digest"`
	RecordsAndDivisions bool   `json:"records_and_divisions"`
	MatchResults bool   `json:"match_results"`
}

type ClaimInput struct {
	UserEmail string `json:"user_email"`
	ClubID       string `json:"club_id"`
	PlayerID     string `json:"player_id"`
	Verified   bool   `json:"verified"`
}

type SyncRunInput struct {
	UserEmail string   `json:"user_email"`
	Running      bool     `json:"running"`
	SkillRating        int      `json:"skill_rating"`
	Total        int      `json:"total"`
	Completed   int      `json:"completed"`
	Current        string   `json:"current,omitempty"`
	NewItems        []string `json:"new_items,omitempty"`
	Concluido    bool     `json:"concluido,omitempty"`
}

// IngestEstadoInput é o que o worker de ingestão publica a cada ciclo. Ele não
// tem host nem porta, então este é o canal para a saúde dele chegar até a API.
type IngestEstadoInput struct {
	Cycles        int    `json:"cycles"`
	ClubesOK       int    `json:"clubs_ok"`
	ClubsFailed   int    `json:"clubs_failed"`
	NewMatches  int    `json:"new_matches"`
	Snapshots      int    `json:"snapshots"`
	Bootstrapped bool   `json:"bootstrapped"`
	LastError     string `json:"last_error,omitempty"`
}

// FetchRunInput é o pedido de sync sob demanda (a SPA grava) e o resultado que
// o worker de ingestão publica de volta. `alvo` diz se é clube ou jogador --
// a fila é uma só, e para jogador o worker resolve os clubes dele.
type FetchRunInput struct {
	Target      string `json:"target"`
	TargetID    string `json:"target_id"`
	Label    string `json:"label,omitempty"`
	Running   bool   `json:"running"`
	Players int    `json:"players,omitempty"`
	Matches  int    `json:"matches,omitempty"`
	Clubs    int    `json:"clubs,omitempty"`
	Error      string `json:"error,omitempty"`
	Concluido bool   `json:"concluido,omitempty"`
}

// SearchRunInput é o pedido de busca ao vivo na fonte e o resultado que o
// worker publica de volta. A busca do diretório é local; esta é a saída para
// um clube que o hub ainda não viu.
type SearchRunInput struct {
	Termo       string `json:"termo"`
	Running     bool   `json:"running"`
	Found int    `json:"found,omitempty"`
	Error        string `json:"error,omitempty"`
	Concluido   bool   `json:"concluido,omitempty"`
}
