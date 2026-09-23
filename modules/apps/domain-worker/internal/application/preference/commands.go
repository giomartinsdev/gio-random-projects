// Package preferencia holds the Command payloads for the per-person
// aggregates: watchlist, notification toggles, claimed pro and sync run.
// These are the only clubs actions carrying usuario_email — everything else
// in the schema is public data.
package preferencia

// SetWatchInput is the preferencia.setWatch payload.
type SetWatchInput struct {
	UserEmail string `json:"user_email"`
	ClubID       string `json:"club_id"`
	Source       string `json:"source,omitempty"`
	// Seguindo=false removes the follow — one action covers both directions
	// so the API surface stays small.
	Seguindo bool `json:"seguindo"`
}

// SaveNotificacoesInput is the preferencia.saveNotificacoes payload.
type SaveNotificacoesInput struct {
	UserEmail      string `json:"user_email"`
	Channel             string `json:"channel,omitempty"`
	WeeklyDigest   bool   `json:"weekly_digest"`
	RecordsAndDivisions bool   `json:"records_and_divisions"`
	MatchResults bool   `json:"match_results"`
}

// ClaimProInput is the preferencia.claimPro payload.
type ClaimProInput struct {
	UserEmail string `json:"user_email"`
	ClubID       string `json:"club_id"`
	PlayerID     string `json:"player_id"`
	Verified   bool   `json:"verified"`
}

// SaveSyncRunInput is the preferencia.saveSyncRun payload.
type SaveSyncRunInput struct {
	UserEmail string   `json:"user_email"`
	Running      bool     `json:"running"`
	SkillRating        int      `json:"skill_rating"`
	Total        int      `json:"total"`
	Completed   int      `json:"completed"`
	Current        string   `json:"current,omitempty"`
	NewItems        []string `json:"new_items,omitempty"`
	Concluido    bool     `json:"concluido,omitempty"`
}
