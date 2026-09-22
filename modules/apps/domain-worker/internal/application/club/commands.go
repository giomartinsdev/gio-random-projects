// Package club holds the concrete application.Command payloads for the Club
// aggregate — domain-api decodes the same shapes on the other end (its own
// copy of this package, used only to build outgoing commands).
package club

// UpsertInput is the club.upsert payload. Every optional field carries
// omitempty because the ingest sends the identity block only when the
// source returned it.
type UpsertInput struct {
	ClubID        string `json:"club_id"`
	Nome          string `json:"nome"`
	Sigla         string `json:"sigla,omitempty"`
	Estadio       string `json:"estadio,omitempty"`
	RegiaoID      string `json:"regiao_id,omitempty"`
	TimeID        string `json:"time_id,omitempty"`
	EscudoAssetID string `json:"escudo_asset_id,omitempty"`
	Cor1          int    `json:"cor_1,omitempty"`
	Cor2          int    `json:"cor_2,omitempty"`
	Cor3          int    `json:"cor_3,omitempty"`
	Cor4          int    `json:"cor_4,omitempty"`
	Acompanhado   bool   `json:"acompanhado,omitempty"`
}
