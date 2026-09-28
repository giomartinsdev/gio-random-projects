// Package anuncio holds the Command payload for the home feed — derived by
// the ingest from the facts it just wrote, and published on the async path.
package anuncio

// AppendInput is the anuncio.create payload.
type AppendInput struct {
	Kind         string `json:"kind"`
	Title       string `json:"title"`
	Body        string `json:"body,omitempty"`
	ReferenciaID string `json:"reference_id,omitempty"`
	Icon        string `json:"icon,omitempty"`
	// Data são os fatos do aviso (resultado, gols, tipo de partida), para a
	// interface montar a frase no idioma escolhido. O Title é o fallback.
	Data map[string]any `json:"data,omitempty"`
	// ExpiraEmHoras is a relative TTL rather than an absolute timestamp, so
	// the ingest doesn't have to know the worker's clock.
	ExpiraEmHoras int `json:"expira_em_horas,omitempty"`
}
