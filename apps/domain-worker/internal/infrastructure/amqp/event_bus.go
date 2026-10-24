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

// envelope is the wire format every domain event is wrapped in.
//
// EventName exists because the bus carries opaque bytes, so a subscriber
// needs some way to tell one event type from another before unmarshaling
// Payload into the right Go type. EventID/CommandID are what make an
// at-least-once consumer idempotent (spec §12.3/§12.5): the same delivery
// twice carries the same EventID, so the consumer can swallow the duplicate.
type envelope struct {
	EventID    string          `json:"event_id"`
	CommandID  string          `json:"command_id"`
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
	// Sem id determinístico aqui (caminho legado): o EventBus.Publish direto
	// não é o caminho de produção — a produção passa pelo outbox, que monta o
	// envelope com EventID/CommandID. Este fica para consumidores diretos.
	data, err := b.EnvelopeBytes("", "", evt.EventName(), time.Now().UTC(), payload)
	if err != nil {
		return err
	}
	return b.PublishRaw(ctx, data)
}

// EnvelopeBytes wraps a payload in the wire envelope the bus (and the durable
// outbox) store: {event_id, command_id, event_name, occurred_at, payload}.
// Kept separate so the outbox can persist exactly the bytes the relay will
// later publish. eventID/commandID empty means "no stable id" and is only
// used on the legacy direct-publish path.
func (b *EventBus) EnvelopeBytes(eventID, commandID, eventName string, occurredAt time.Time, payload json.RawMessage) ([]byte, error) {
	env := envelope{EventID: eventID, CommandID: commandID, EventName: eventName, OccurredAt: occurredAt, Payload: payload}
	data, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("marshal event envelope: %w", err)
	}
	return data, nil
}

// PublishRaw publishes already-enveloped bytes (the outbox relay's path).
func (b *EventBus) PublishRaw(ctx context.Context, data []byte) error {
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
