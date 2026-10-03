package application

import (
	"context"
	"encoding/json"
)

// CommandPublisher is the only write port domain-api needs — it hands
// off every write without touching storage itself.
type CommandPublisher interface {
	Publish(ctx context.Context, cmd Command) error
}

// DomainEvent is one event off the domain.events bus, already stripped
// of its transport envelope.
type DomainEvent struct {
	Name    string
	Payload json.RawMessage
}

// EventSubscriber is the read side of the bus: a push stream of domain
// events, one per subscriber, cancelled by the returned func.
type EventSubscriber interface {
	Subscribe(ctx context.Context) (<-chan DomainEvent, func(), error)
}
