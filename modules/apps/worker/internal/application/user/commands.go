// Package user is the application layer for the User aggregate: the
// concrete command payloads, the Service that applies them against
// domain/user, and the CommandHandler that dispatches a generic
// application.Command into a Service call. Copy this package's shape
// (commands.go / service.go / handler.go) for the next aggregate rather
// than generalizing this one — there's only one real usage of the
// pattern so far.
package user

// CreateInput is application.Command's Payload for ActionCreateUser.
type CreateInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// UpdateInput is application.Command's Payload for ActionUpdateUser.
type UpdateInput struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// DeleteInput is application.Command's Payload for ActionDeleteUser.
type DeleteInput struct {
	ID string `json:"id"`
}
