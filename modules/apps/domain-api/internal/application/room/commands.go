// Package room holds the concrete application.Command payloads for the
// Room aggregate -- domain-worker decodes the same shapes on the other
// end (its own copy of this package).
package room

type CreateInput struct {
	HostID     string `json:"host_id"`
	Title      string `json:"title"`
	DocumentID string `json:"document_id"`
}

type UpdateInput struct {
	ID          string `json:"id"`
	HostID      string `json:"host_id"`
	Title       string `json:"title,omitempty"`
	CurrentPage *int   `json:"current_page,omitempty"`
}

type DeleteInput struct {
	ID     string `json:"id"`
	HostID string `json:"host_id"`
}
