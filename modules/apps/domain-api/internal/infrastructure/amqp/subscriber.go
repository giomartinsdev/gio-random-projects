package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
)

// EventSubscriber turns the domain.events fanout exchange into a
// push stream for one subscriber. Each Subscribe call declares its own
// exclusive, auto-delete queue bound to the exchange: RabbitMQ fans
// every published event out to all bound queues, and the queue dies
// with the connection, so a dropped SSE client leaves nothing behind.
// A broker restart is recovered by redialing and re-subscribing on the
// same output channel rather than ending the stream.
type EventSubscriber struct {
	client *Client
}

func NewEventSubscriber(c *Client) *EventSubscriber {
	return &EventSubscriber{client: c}
}

func (s *EventSubscriber) Subscribe(ctx context.Context) (<-chan application.DomainEvent, func(), error) {
	deliveries, closeCh, err := s.consume()
	if err != nil {
		return nil, nil, err
	}

	var (
		mu     sync.Mutex
		active = closeCh
	)
	stop := func() {
		mu.Lock()
		c := active
		active = nil
		mu.Unlock()
		if c != nil {
			c()
		}
	}

	out := make(chan application.DomainEvent)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				stop()
				return
			case d, ok := <-deliveries:
				if !ok {
					// The broker dropped the connection (or closed the
					// consumer): redial and re-open a fresh ephemeral
					// queue, keeping the same stream alive.
					stop()
					var oerr error
					deliveries, closeCh, oerr = s.resubscribe(ctx)
					if oerr != nil {
						return
					}
					mu.Lock()
					active = closeCh
					mu.Unlock()
					continue
				}
				var env struct {
					EventName string          `json:"event_name"`
					Payload   json.RawMessage `json:"payload"`
				}
				if err := json.Unmarshal(d.Body, &env); err != nil {
					continue
				}
				select {
				case out <- application.DomainEvent{Name: env.EventName, Payload: env.Payload}:
				case <-ctx.Done():
					stop()
					return
				}
			}
		}
	}()

	return out, stop, nil
}

func (s *EventSubscriber) consume() (<-chan amqp.Delivery, func(), error) {
	conn := s.client.connection()
	if conn == nil || conn.IsClosed() {
		return nil, nil, fmt.Errorf("declare %s: connection closed", eventsExchange)
	}
	ch, err := conn.Channel()
	if err != nil {
		return nil, nil, fmt.Errorf("open channel: %w", err)
	}
	if err := ch.ExchangeDeclare(eventsExchange, "fanout", true, false, false, false, nil); err != nil {
		_ = ch.Close()
		return nil, nil, fmt.Errorf("declare %s: %w", eventsExchange, err)
	}
	q, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		_ = ch.Close()
		return nil, nil, fmt.Errorf("declare subscriber queue: %w", err)
	}
	if err := ch.QueueBind(q.Name, "", eventsExchange, false, nil); err != nil {
		_ = ch.Close()
		return nil, nil, fmt.Errorf("bind subscriber queue: %w", err)
	}
	deliveries, err := ch.Consume(q.Name, "", true, true, false, false, nil)
	if err != nil {
		_ = ch.Close()
		return nil, nil, fmt.Errorf("consume subscriber queue: %w", err)
	}
	return deliveries, func() { _ = ch.Cancel("", false); _ = ch.Close() }, nil
}

// resubscribe redials if needed and re-opens the subscriber, retrying
// until it succeeds or ctx is done — a broker restart should not end a
// long-lived SSE stream.
func (s *EventSubscriber) resubscribe(ctx context.Context) (<-chan amqp.Delivery, func(), error) {
	for {
		if err := s.client.reconnect(ctx); err != nil {
			// The broker is still down: keep retrying instead of
			// ending the stream, unless the caller gave up.
			if ctx.Err() != nil {
				return nil, nil, ctx.Err()
			}
		} else if deliveries, closeCh, err := s.consume(); err == nil {
			return deliveries, closeCh, nil
		}
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-time.After(reconnectDelay):
		}
	}
}
