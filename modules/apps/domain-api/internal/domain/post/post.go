// Package post is the domain layer for the Post aggregate as seen
// from domain-api: just enough to read, since this binary never
// writes — see internal/infrastructure/http's package doc.
package post

import "time"

type Post struct {
	ID            string
	AuthorID      string
	Title         string
	Slug          string
	BodyMarkdown  string
	Excerpt       string
	CoverImageURL string
	Type          string
	Status        string
	Source        string
	SourceURL     string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	PublishedAt   *time.Time
}
