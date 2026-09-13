// Package aposta holds the concrete application.Command payloads for
// the Aposta aggregate -- domain-api decodes the same shapes on the
// other end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package aposta

import "time"

type RegistrarInput struct {
	UsuarioEmail  string    `json:"usuario_email"`
	ContaID       string    `json:"conta_id"`
	Descricao     string    `json:"descricao"`
	ValorApostado float64   `json:"valor_apostado"`
	Odd           float64   `json:"odd,omitempty"`
	Data          time.Time `json:"data"`
}

type ResolverInput struct {
	ApostaID      string    `json:"aposta_id"`
	Status        string    `json:"status"`
	RetornoObtido float64   `json:"retorno_obtido,omitempty"`
	Data          time.Time `json:"data,omitempty"`
}
