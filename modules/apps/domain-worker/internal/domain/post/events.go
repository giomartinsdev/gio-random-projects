package post

import "time"

// Event is implemented by every domain event this aggregate raises.
type Event interface {
	EventName() string
}

type Created struct {
	PostID     string    `json:"post_id"`
	AuthorID   string    `json:"author_id"`
	Slug       string    `json:"slug"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Created) EventName() string { return "post.created" }

type Updated struct {
	PostID     string    `json:"post_id"`
	AuthorID   string    `json:"author_id"`
	Slug       string    `json:"slug"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Updated) EventName() string { return "post.updated" }

type Deleted struct {
	PostID     string    `json:"post_id"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "post.deleted" }
