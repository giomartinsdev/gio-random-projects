package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
)

// CommandQueue implements application.CommandConsumer by streaming the
// durable commandQueue — the side the broker fills from
// commandExchange. It holds the Client rather than a bare channel so a
// dropped connection can be redialed and the consumer re-established
// instead of the worker dying with the broker.
type CommandQueue struct {
	client *Client

	mu         sync.Mutex
	ch         *amqp.Channel
	deliveries <-chan amqp.Delivery
}

func NewCommandQueue(c *Client) (*CommandQueue, error) {
	q := &CommandQueue{client: c}
	if err := q.open(); err != nil {
		return nil, err
	}
	return q, nil
}

func (q *CommandQueue) open() error {
	ch, err := q.client.connection().Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	if err := declareCommandTopology(ch); err != nil {
		_ = ch.Close()
		return err
	}
	// autoAck mirrors the old BLPOP semantics: a command leaves the
	// queue the moment it is handed to the worker.
	deliveries, err := ch.Consume(commandQueue, "", true, false, false, false, nil)
	if err != nil {
		_ = ch.Close()
		return fmt.Errorf("consume %s: %w", commandQueue, err)
	}
	q.mu.Lock()
	if q.ch != nil {
		_ = q.ch.Close()
	}
	q.ch, q.deliveries = ch, deliveries
	q.mu.Unlock()
	return nil
}

// Next blocks for the next command. A dropped broker connection closes
// the delivery channel; Next redials (with a short backoff) and
// re-establishes the consumer rather than surfacing a hot error loop to
// the caller. Transient redial failures bubble up as an error so the
// caller's loop retries; shutdown surfaces context.Canceled.
func (q *CommandQueue) Next(ctx context.Context) (application.Command, error) {
	for {
		q.mu.Lock()
		deliveries := q.deliveries
		q.mu.Unlock()

		if deliveries == nil {
			if err := q.client.reconnect(ctx); err != nil {
				return application.Command{}, err
			}
			if err := q.open(); err != nil {
				return application.Command{}, err
			}
			continue
		}

		select {
		case <-ctx.Done():
			return application.Command{}, ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				q.mu.Lock()
				q.deliveries = nil
				q.mu.Unlock()
				continue
			}
			var cmd application.Command
			if err := json.Unmarshal(d.Body, &cmd); err != nil {
				return application.Command{}, fmt.Errorf("unmarshal command: %w", err)
			}
			return cmd, nil
		}
	}
}
