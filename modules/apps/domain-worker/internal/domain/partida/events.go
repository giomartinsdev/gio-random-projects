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
	PartidaID string    `json:"partida_id"`
	MatchID   string    `json:"match_id"`
	CasaID    string    `json:"clube_casa_id"`
	ForaID    string    `json:"clube_fora_id"`
	GolsCasa  int       `json:"gols_casa"`
	GolsFora  int       `json:"gols_fora"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Upserted) EventName() string { return "partida.upserted" }
