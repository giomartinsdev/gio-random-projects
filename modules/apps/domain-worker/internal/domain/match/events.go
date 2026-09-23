package partida

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

// Upserted is raised on every write, whether the match was inserted or
// updated — the ingest derives announcements from it and needs to know a
// result landed either way.
type Upserted struct {
	PartidaID string    `json:"match_id_uuid"`
	MatchID   string    `json:"match_id"`
	CasaID    string    `json:"home_club_id"`
	ForaID    string    `json:"away_club_id"`
	HomeGoals  int       `json:"home_goals"`
	AwayGoals  int       `json:"away_goals"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Upserted) EventName() string { return "partida.upserted" }
