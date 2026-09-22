// Package anuncio holds the Command payload for the home feed — derived by
// the ingest from the facts it just wrote, and published on the async path.
package anuncio

// AppendInput is the anuncio.create payload.
type AppendInput struct {
	Tipo         string `json:"tipo"`
	Titulo       string `json:"titulo"`
	Texto        string `json:"texto,omitempty"`
	ReferenciaID string `json:"referencia_id,omitempty"`
	Icone        string `json:"icone,omitempty"`
	// ExpiraEmHoras is a relative TTL rather than an absolute timestamp, so
	// the ingest doesn't have to know the worker's clock.
	ExpiraEmHoras int `json:"expira_em_horas,omitempty"`
}
