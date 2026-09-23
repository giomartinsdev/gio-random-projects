// Package conta holds the concrete application.Command payloads for
// the Conta aggregate -- domain-api decodes the same shapes on the
// other end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package conta

type CreateInput struct {
	UserEmail string `json:"user_email"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
}

type UpdateInput struct {
	ID           string `json:"id"`
	UserEmail string `json:"user_email"`
	Name         string `json:"name,omitempty"`
	Status       string `json:"status,omitempty"`
}
