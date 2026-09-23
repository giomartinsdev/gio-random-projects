// Package club holds the concrete application.Command payloads for the Club
// aggregate — domain-api decodes the same shapes on the other end (its own
// copy of this package, used only to build outgoing commands).
package club

// UpsertInput is the club.upsert payload. Every optional field carries
// omitempty because the ingest sends the identity block only when the
// source returned it.
type UpsertInput struct {
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
