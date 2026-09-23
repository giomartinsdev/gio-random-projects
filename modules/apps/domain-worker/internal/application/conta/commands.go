// Package conta holds the concrete application.Command payloads for
// the Conta aggregate -- domain-api decodes the same shapes on the
// other end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package conta

type CreateInput struct {
	UsuarioEmail string `json:"usuario_email"`
	Nome         string `json:"nome"`
	Tipo         string `json:"tipo"`
}

type UpdateInput struct {
	ID           string `json:"id"`
	UsuarioEmail string `json:"usuario_email"`
	Nome         string `json:"nome,omitempty"`
	Status       string `json:"status,omitempty"`
}
