// Package room holds the concrete application.Command payloads for the
// Room aggregate -- domain-api decodes the same shapes on the other
// end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package room

type CreateInput struct {
	HostID     string `json:"host_id"`
	Title      string `json:"title"`
	DocumentID string `json:"document_id"`
	// Empty defaults to domainroom.KindBook -- every caller predating
	// this field (bookclub-api) never sent it and shouldn't have to.
	Kind string `json:"kind,omitempty"`
}

type UpdateInput struct {
	ID          string `json:"id"`
	HostID      string `json:"host_id"`
	Title       string `json:"title,omitempty"`
	CurrentPage *int   `json:"current_page,omitempty"`
	Status      string `json:"status,omitempty"`
}

type DeleteInput struct {
	ID     string `json:"id"`
	HostID string `json:"host_id"`
}
