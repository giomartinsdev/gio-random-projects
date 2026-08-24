// Package post holds the concrete application.Command payloads for the
// Post aggregate — domain-api decodes the same shapes on the other
// end (its own copy of this package, used only to build outgoing
// commands, never to decode).
package post

type CreateInput struct {
	AuthorID      string `json:"author_id"`
	Title         string `json:"title"`
	BodyMarkdown  string `json:"body_markdown"`
	Excerpt       string `json:"excerpt,omitempty"`
	CoverImageURL string `json:"cover_image_url,omitempty"`
	Type          string `json:"type,omitempty"`
	Status        string `json:"status,omitempty"`
}

type UpdateInput struct {
	ID            string `json:"id"`
	AuthorID      string `json:"author_id"`
	Title         string `json:"title,omitempty"`
	BodyMarkdown  string `json:"body_markdown,omitempty"`
	Excerpt       string `json:"excerpt,omitempty"`
	CoverImageURL string `json:"cover_image_url,omitempty"`
	Status        string `json:"status,omitempty"`
}

type DeleteInput struct {
	ID       string `json:"id"`
	AuthorID string `json:"author_id"`
}
