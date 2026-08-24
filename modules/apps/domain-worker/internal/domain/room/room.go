// Package room is the domain layer for the Room aggregate ("Clube do
// Livro") — plain Go types and business rules, no database, no HTTP,
// no Redis, and deliberately no idea what a "book club" or a "PDF" is:
// DocumentID is an opaque string bookclub-api gave us, same as
// author_id is an opaque string on Post. Page-turn permissions, chat,
// and every other bookclub-specific rule live in bookclub-api, not
// here — this aggregate only knows "a room has a host, a current
// page, and an open/paused status", the same generic ownership shape
// Post already has (status here mirrors Post's own draft/published).
package room

import (
	"errors"
	"time"
)

const (
	StatusOpen   = "open"
	StatusPaused = "paused"
)

var (
	ErrHostRequired     = errors.New("host_id is required")
	ErrTitleRequired    = errors.New("title is required")
	ErrDocumentRequired = errors.New("document_id is required")
	ErrInvalidPage      = errors.New("current_page must be at least 1")
	ErrInvalidStatus    = errors.New("status must be \"open\" or \"paused\"")
	ErrForbidden        = errors.New("only the host may modify this room")
)

type Room struct {
	ID          string
	HostID      string
	Title       string
	DocumentID  string
	CurrentPage int
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func validStatus(s string) bool { return s == StatusOpen || s == StatusPaused }

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
		Status:      StatusOpen,
		CreatedAt:   now,
		UpdatedAt:   now,
	}, nil
}

// Edit applies a partial update in place, enforcing the same ownership
// rule Post.Edit does. title == "", currentPage == nil, and status == ""
// all mean "leave unchanged" — the application layer only sets what
// the caller actually provided. Reopening a paused room resumes at
// whatever CurrentPage already is -- there's no separate "resume"
// operation, just flipping Status back to open.
func (r *Room) Edit(requestingHostID, title string, currentPage *int, status string) error {
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
	if status != "" {
		if !validStatus(status) {
			return ErrInvalidStatus
		}
		r.Status = status
	}
	r.UpdatedAt = time.Now().UTC()
	return nil
}
