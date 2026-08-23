// Package user holds the concrete application.Command payloads for the
// User aggregate — domain-worker decodes the same shapes on the other
// end (its own copy of this package).
package user

type CreateInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type UpdateInput struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type DeleteInput struct {
	ID string `json:"id"`
}
