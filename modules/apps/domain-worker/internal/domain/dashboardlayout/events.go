package dashboardlayout

import "time"

type Event interface{ EventName() string }

type Saved struct {
	UserEmail string    `json:"user_email"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Saved) EventName() string { return "dashboardlayout.saved" }

type Deleted struct {
	UserEmail string    `json:"user_email"`
	OccurredAt   time.Time `json:"occurred_at"`
}

func (Deleted) EventName() string { return "dashboardlayout.deleted" }
