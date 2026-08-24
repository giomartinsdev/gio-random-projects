// Package post is the domain layer for the Post aggregate — plain Go
// types and business rules, no database, no HTTP, no Redis.
// domain-api has its own, smaller copy of this package (read-only: no
// New/Edit, since it never writes) — same split as domain/user.
package post

import (
	"errors"
	"time"
)

var (
	ErrTitleRequired  = errors.New("title is required")
	ErrBodyRequired   = errors.New("body_markdown is required")
	ErrSlugRequired   = errors.New("slug is required")
	ErrAuthorRequired = errors.New("author_id is required")
	ErrForbidden      = errors.New("only the author may modify this post")
	ErrInvalidType    = errors.New("type must be \"article\" or \"course\"")
	ErrInvalidStatus  = errors.New("status must be \"draft\" or \"published\"")
)

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

func validType(t string) bool   { return t == "article" || t == "course" }
func validStatus(s string) bool { return s == "draft" || s == "published" }

// New constructs a Post, enforcing the aggregate's invariants at the
// one place they can't be bypassed — every other path to a Post
// (repository loads included) assumes these already held. slug is
// computed by the caller (application/post.Service), not here: slug
// uniqueness needs a repository lookup, which is out of scope for a
// pure constructor.
func New(id, authorID, title, slug, bodyMarkdown string, postType, status string) (Post, error) {
	if authorID == "" {
		return Post{}, ErrAuthorRequired
	}
	if title == "" {
		return Post{}, ErrTitleRequired
	}
	if bodyMarkdown == "" {
		return Post{}, ErrBodyRequired
	}
	if slug == "" {
		return Post{}, ErrSlugRequired
	}
	if postType == "" {
		postType = "article"
	}
	if !validType(postType) {
		return Post{}, ErrInvalidType
	}
	if status == "" {
		status = "draft"
	}
	if !validStatus(status) {
		return Post{}, ErrInvalidStatus
	}

	now := time.Now().UTC()
	p := Post{
		ID:           id,
		AuthorID:     authorID,
		Title:        title,
		Slug:         slug,
		BodyMarkdown: bodyMarkdown,
		Type:         postType,
		Status:       status,
		Source:       "native",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if status == "published" {
		p.PublishedAt = &now
	}
	return p, nil
}

// Edit applies a partial update in place, enforcing the same ownership
// and validity rules New does. Empty string fields mean "leave
// unchanged" (the application layer only sets what the caller
// actually provided).
func (p *Post) Edit(requestingAuthorID string, title, bodyMarkdown, excerpt, coverImageURL, status string) error {
	if requestingAuthorID != p.AuthorID {
		return ErrForbidden
	}
	if title != "" {
		p.Title = title
	}
	if bodyMarkdown != "" {
		p.BodyMarkdown = bodyMarkdown
	}
	if excerpt != "" {
		p.Excerpt = excerpt
	}
	if coverImageURL != "" {
		p.CoverImageURL = coverImageURL
	}
	if status != "" {
		if !validStatus(status) {
			return ErrInvalidStatus
		}
		p.Status = status
		if status == "published" && p.PublishedAt == nil {
			now := time.Now().UTC()
			p.PublishedAt = &now
		}
	}
	p.UpdatedAt = time.Now().UTC()
	return nil
}
