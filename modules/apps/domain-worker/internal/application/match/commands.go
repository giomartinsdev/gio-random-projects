// Package partida holds the application.Command payloads for the Partida
// aggregate (and the closely related ClubeTotais, which travels in the same
// ingest cycle and would be odd to split into its own package).
package partida

// LinhaInput is one player's line in the upsert payload.
type LinhaInput struct {
	ClubID           string   `json:"club_id"`
	PlayerID         string   `json:"player_id"`
	Gamertag         string   `json:"gamertag"`
	Position          string   `json:"position"`
	Rating             float64  `json:"rating"`
	Goals             int      `json:"goals"`
	Assists     int      `json:"assists"`
	Shots           int      `json:"shots"`
	PassesMade     int      `json:"passes_made"`
	PassesAttempted   int      `json:"passes_attempted"`
	TacklesMade   int      `json:"tackles_made"`
	TacklesAttempted int      `json:"tackles_attempted"`
	Saves          int      `json:"saves"`
	// DefesasPorTipo rides as an object; nil for anyone but a goalkeeper.
	SavesByType   map[string]int `json:"saves_by_type,omitempty"`
	SecondsPlayed  int      `json:"seconds_played"`
	ManOfTheMatch    bool     `json:"man_of_the_match"`
	RedCard   bool     `json:"red_card"`
	CleanSheet bool     `json:"clean_sheet"`
}

// UpsertInput is the partida.upsert payload: the match plus BOTH sides'
// player lines, because a match without its summary is not a valid match.
// resultado_casa is already normalized by the ingest — the source's five
// numeric codes never reach this layer.
type UpsertInput struct {
	MatchID                  string       `json:"match_id"`
	Timestamp                string       `json:"timestamp"`
	Kind                     string       `json:"kind"`
	PlayoffRound            string       `json:"playoff_round,omitempty"`
	ClubeCasaID              string       `json:"home_club_id"`
	ClubeForaID              string       `json:"away_club_id"`
	HomeGoals                 int          `json:"home_goals"`
	AwayGoals                 int          `json:"away_goals"`
	DecidedByForfeit         bool         `json:"decided_by_forfeit"`
	VencedorPorDesistenciaID string       `json:"forfeit_winner_id,omitempty"`
	HomeResult            string       `json:"home_result"`
	Events                   []any        `json:"events,omitempty"`
	Players                []LinhaInput `json:"players"`
}

// TotaisInput is the clubetotais.upsert payload.
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
