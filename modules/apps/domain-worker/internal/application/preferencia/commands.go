// Package preferencia holds the Command payloads for the per-person
// aggregates: watchlist, notification toggles, claimed pro and sync run.
// These are the only clubs actions carrying usuario_email — everything else
// in the schema is public data.
package preferencia

// SetWatchInput is the preferencia.setWatch payload.
type SetWatchInput struct {
	UsuarioEmail string `json:"usuario_email"`
	ClubID       string `json:"club_id"`
	Origem       string `json:"origem,omitempty"`
	// Seguindo=false removes the follow — one action covers both directions
	// so the API surface stays small.
	Seguindo bool `json:"seguindo"`
}

// SaveNotificacoesInput is the preferencia.saveNotificacoes payload.
type SaveNotificacoesInput struct {
	UsuarioEmail      string `json:"usuario_email"`
	Canal             string `json:"canal,omitempty"`
	ResumoPeriodico   bool   `json:"resumo_periodico"`
	RecordesEDivisoes bool   `json:"recordes_e_divisoes"`
	ResultadoPartidas bool   `json:"resultado_partidas"`
}

// ClaimProInput is the preferencia.claimPro payload.
type ClaimProInput struct {
	UsuarioEmail string `json:"usuario_email"`
	ClubID       string `json:"club_id"`
	PlayerID     string `json:"player_id"`
	Verificado   bool   `json:"verificado"`
}

// SaveSyncRunInput is the preferencia.saveSyncRun payload.
type SaveSyncRunInput struct {
	UsuarioEmail string   `json:"usuario_email"`
	Rodando      bool     `json:"rodando"`
	Nivel        int      `json:"nivel"`
	Total        int      `json:"total"`
	Concluidos   int      `json:"concluidos"`
	Atual        string   `json:"atual,omitempty"`
	Novos        []string `json:"novos,omitempty"`
	Concluido    bool     `json:"concluido,omitempty"`
}
