package application

import (
	"context"
)

// CommandConsumer pulls commands off the durable queue — see
// infrastructure/amqp's package doc for the topology.
type CommandConsumer interface {
	Next(ctx context.Context) (Command, error)
}
