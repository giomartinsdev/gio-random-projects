package httpapi

import (
	"time"

	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/post"
)

// PostResponse is the wire shape for a Post — kept separate from
// domain/post.Post on purpose, same reasoning as UserResponse.
type PostResponse struct {
	ID            string     `json:"id"`
	AuthorID      string     `json:"author_id"`
	Title         string     `json:"title"`
	Slug          string     `json:"slug"`
	BodyMarkdown  string     `json:"body_markdown"`
	Excerpt       string     `json:"excerpt"`
	CoverImageURL string     `json:"cover_image_url"`
	Type          string     `json:"type"`
	Status        string     `json:"status"`
	Source        string     `json:"source"`
	SourceURL     string     `json:"source_url"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	PublishedAt   *time.Time `json:"published_at,omitempty"`
}

func toPostResponse(p domainpost.Post) PostResponse {
	return PostResponse{
		ID: p.ID, AuthorID: p.AuthorID, Title: p.Title, Slug: p.Slug, BodyMarkdown: p.BodyMarkdown,
		Excerpt: p.Excerpt, CoverImageURL: p.CoverImageURL, Type: p.Type, Status: p.Status,
		Source: p.Source, SourceURL: p.SourceURL, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		PublishedAt: p.PublishedAt,
	}
}

func toPostResponses(posts []domainpost.Post) []PostResponse {
	out := make([]PostResponse, len(posts))
	for i, p := range posts {
		out[i] = toPostResponse(p)
	}
	return out
}
