package application

import (
	"context"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/user"
)

// CommandConsumer pulls commands off the durable queue — see
// infrastructure/amqp's package doc for the topology.
type CommandConsumer interface {
	Next(ctx context.Context) (Command, error)
}

// EventPublisher announces what actually happened, after a command was
// applied.
type EventPublisher interface {
	Publish(ctx context.Context, evt user.Event) error
}
