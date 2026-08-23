package application

import (
	"context"

	"github.com/giomartinsdev/gio-random-projects/api/domain/src/domain/user"
)

// CommandPublisher is used by domain-api to hand off a write without
// touching storage itself.
type CommandPublisher interface {
	Publish(ctx context.Context, cmd Command) error
}

// CommandConsumer is used by domain-worker to pull commands off the
// durable side of the bus (the queue, not the pub/sub channel directly
// — see infrastructure/redis's package doc for why those are separate).
type CommandConsumer interface {
	Next(ctx context.Context) (Command, error)
}

// EventPublisher is used by domain-worker to announce what actually
// happened, after a command was applied.
type EventPublisher interface {
	Publish(ctx context.Context, evt user.Event) error
}
