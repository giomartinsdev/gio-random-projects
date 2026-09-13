package lead

import "time"

type Event interface {
	EventName() string
}

type Captured struct {
	LeadID     string    `json:"lead_id"`
	Email      string    `json:"email"`
	OccurredAt time.Time `json:"occurred_at"`
}

func (Captured) EventName() string { return "lead.captured" }
