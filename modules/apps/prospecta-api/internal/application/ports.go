package application

import (
	"context"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
)

// CommandPublisher is the write port: it hands a command to the domain pair
// (the async envelope door) and returns the command id the pair stamped, which
// the API echoes back as the 202 body's "id". This is the ONLY write path --
// prospecta-api never touches Postgres and never publishes to the broker
// itself (§1.1).
type CommandPublisher interface {
	Publish(ctx context.Context, action string, payload any) (commandID string, err error)
}

// CompanyReader is the read port over the domain pair's company projections.
type CompanyReader interface {
	Company(ctx context.Context, id string) (domain.Company, error)
}

// CampaignReader is the read port over the domain pair's campaign projections.
type CampaignReader interface {
	Campaign(ctx context.Context, id string) (domain.Campaign, error)
	ListCampaigns(ctx context.Context, limit int, cursor string) (domain.Page[domain.Campaign], error)
}

// LeadReader is the read port over the domain pair's lead projections. The
// filter is passed through to the pair; this side does not re-implement query
// semantics it does not own.
type LeadReader interface {
	Lead(ctx context.Context, id string) (domain.Lead, error)
	ListLeads(ctx context.Context, f LeadFilter) (domain.Page[domain.Lead], error)
}

// LeadFilter is the GET /leads querystring. Zero values mean "no filter".
type LeadFilter struct {
	CampaignID string
	Status     string
	FitMin     int
	Limit      int
	Cursor     string
}

// ConversationReader is the read port over the domain pair's inbox projections.
type ConversationReader interface {
	Conversation(ctx context.Context, id string) (domain.Conversation, error)
	ListConversations(ctx context.Context, limit int, cursor string) (domain.Page[domain.Conversation], error)
}

// MessageReader is the read port used to enforce the approve invariant: a
// message may only be approved from "drafted".
type MessageReader interface {
	Message(ctx context.Context, id string) (domain.Message, error)
}

// ActivityReader is the read port for the live agent_run feed. It returns a
// channel the caller ranges over; the producer stops when ctx is cancelled, so
// a client that disconnects ends the stream without leaking a goroutine.
type ActivityReader interface {
	StreamActivity(ctx context.Context) (<-chan domain.AgentRunEvent, error)
}
