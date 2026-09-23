package partida

import "context"

// LinhaPartida is one player's performance in a match. It belongs to the
// Partida aggregate — a match without its squad lines is not a valid
// match, so they are written in the same transaction.
type LinhaPartida struct {
	ClubID    string
	PlayerID  string
	Gamertag  string
	Position   string
	Rating      float64
	Goals      int
	Assists      int
	Shots            int
	PassesMade      int
	PassesAttempted    int
	TacklesMade    int
	TacklesAttempted  int
	Saves           int
	// DefesasPorTipo only exists for a goalkeeper — the source sends
	// fields that only make sense per position, so it is kept as raw JSON
	// rather than six mostly-empty columns.
	SavesByType   []byte
	SecondsPlayed  int
	ManOfTheMatch    bool
	RedCard   bool
	CleanSheet bool
}

// Repository is a port. UpsertByMatchID is the method that makes a match
// seen from both sides land exactly once: it inserts on first sight and
// updates afterwards, replacing the squad lines atomically.
type Repository interface {
	UpsertByMatchID(ctx context.Context, p Partida, linhas []LinhaPartida) (inserted bool, err error)
	FindByMatchID(ctx context.Context, matchID string) (Partida, []LinhaPartida, error)
	FindByID(ctx context.Context, id string) (Partida, []LinhaPartida, error)
	ListByClub(ctx context.Context, clubID, kind string, limit int) ([]Partida, error)
	ListByClubComLinhas(ctx context.Context, clubID string, limit int) ([]PartidaComLinhas, error)
	// AllLinesByClub returns every player line of a club's matches — the
	// raw material for squad aggregation, records and the cross-club index.
	AllLinesByClub(ctx context.Context, clubID string) ([]LinhaComPartida, error)
}

// PartidaComLinhas pairs a match with both sides' player lines.
type PartidaComLinhas struct {
	Partida Partida
	Linhas  []LinhaPartida
}

// LinhaComPartida is a player line plus the match it belongs to — the join
// every aggregate query (squad, records, player profile) needs.
type LinhaComPartida struct {
	Linha   LinhaPartida
	Partida Partida
}

var ErrNotFound = notFoundError{}

type notFoundError struct{}

func (notFoundError) Error() string { return "partida not found" }
