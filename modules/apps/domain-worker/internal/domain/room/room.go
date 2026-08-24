// Package room is the domain layer for the Room aggregate ("Clube do
// Livro") — plain Go types and business rules, no database, no HTTP,
// no Redis, and deliberately no idea what a "book club" or a "PDF" is:
// DocumentID is an opaque string bookclub-api gave us, same as
// author_id is an opaque string on Post. Page-turn permissions, chat,
// and every other bookclub-specific rule live in bookclub-api, not
// here — this aggregate only knows "a room has a host and a current
// page", the same generic ownership shape Post already has.
package room

import (
	"errors"
	"time"
)

var (
	ErrHostRequired     = errors.New("host_id is required")
	ErrTitleRequired    = errors.New("title is required")
	ErrDocumentRequired = errors.New("document_id is required")
	ErrInvalidPage      = errors.New("current_page must be at least 1")
	ErrForbidden        = errors.New("only the host may modify this room")
)

type Room struct {
	ID          string
	HostID      string
	Title       string
	DocumentID  string
	CurrentPage int
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// New constructs a Room, enforcing the aggregate's invariants at the
// one place they can't be bypassed — same shape as domain/post.New.
func New(id, hostID, title, documentID string) (Room, error) {
	if hostID == "" {
		return Room{}, ErrHostRequired
	}
	if title == "" {
		return Room{}, ErrTitleRequired
	}
	if documentID == "" {
		return Room{}, ErrDocumentRequired
	}

	now := time.Now().UTC()
	return Room{
		ID:          id,
		HostID:      hostID,
		Title:       title,
		DocumentID:  documentID,
		CurrentPage: 1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

// Edit applies a partial update in place, enforcing the same ownership
// rule Post.Edit does. title == "" and currentPage == nil both mean
// "leave unchanged" — the application layer only sets what the caller
// actually provided.
func (r *Room) Edit(requestingHostID, title string, currentPage *int) error {
	if requestingHostID != r.HostID {
		return ErrForbidden
	}
	if title != "" {
		r.Title = title
	}
	if currentPage != nil {
		if *currentPage < 1 {
			return ErrInvalidPage
		}
		r.CurrentPage = *currentPage
	}
	r.UpdatedAt = time.Now().UTC()
	return nil
}
