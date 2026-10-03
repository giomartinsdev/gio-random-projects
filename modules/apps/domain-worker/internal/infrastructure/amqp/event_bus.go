package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// namedEvent is deliberately decoupled from any one aggregate's Event
// type — every aggregate's Event interface has the same
// EventName() string shape, so this bus stays aggregate-agnostic
// rather than importing every domain package that ever publishes
// through it.
type namedEvent interface {
	EventName() string
}

// envelope is the wire format every domain event is wrapped in —
// EventName exists because the bus carries opaque bytes, so a
// subscriber needs some way to tell one event type from another
// before unmarshaling Payload into the right Go type. The durable
// queue receives this same envelope.
type envelope struct {
	EventName  string          `json:"event_name"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload"`
}

// EventBus publishes domain events to the domain.events fanout
// exchange. One durable publish reaches the durable queue (consumers
// that must not miss an event while offline). Holds the Client rather
// than a bare channel so a broker restart can be recovered: the channel
// is rebuilt (topology and all) on the first publish after it dies.
type EventBus struct {
	client   *Client
	queueMax int

	mu sync.Mutex
	ch *amqp.Channel
}

func NewEventBus(c *Client, queueMax int) (*EventBus, error) {
	b := &EventBus{client: c, queueMax: queueMax}
	if err := b.open(); err != nil {
		return nil, err
	}
	return b, nil
}

func (b *EventBus) open() error {
	ch, err := b.client.connection().Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	if err := declareEventsTopology(ch, b.queueMax); err != nil {
		_ = ch.Close()
		return err
	}
	b.mu.Lock()
	if b.ch != nil {
		_ = b.ch.Close()
	}
	b.ch = ch
	b.mu.Unlock()
	return nil
}

func (b *EventBus) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.ch == nil {
		return nil
	}
	return b.ch.Close()
}

func (b *EventBus) Publish(ctx context.Context, evt namedEvent) error {
	payload, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}
	env := envelope{EventName: evt.EventName(), OccurredAt: time.Now().UTC(), Payload: payload}
	data, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal event envelope: %w", err)
	}

	b.mu.Lock()
	ch := b.ch
	b.mu.Unlock()

	if err := publishEvent(ctx, ch, data); err != nil {
		// The channel or the connection under it is gone (broker
		// restart, idle timeout). Redial if needed, rebuild the
		// channel and topology, then retry once.
		if rerr := b.client.reconnect(ctx); rerr != nil {
			return fmt.Errorf("publish event: %w", err)
		}
		if oerr := b.open(); oerr != nil {
			return fmt.Errorf("publish event: %w", err)
		}
		b.mu.Lock()
		ch = b.ch
		b.mu.Unlock()
		return publishEvent(ctx, ch, data)
	}
	return nil
}

func publishEvent(ctx context.Context, ch *amqp.Channel, data []byte) error {
	if err := ch.PublishWithContext(ctx, eventsExchange, "", false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         data,
	}); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	return nil
}
