package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// namedEvent is deliberately not domainuser.Event or domainpost.Event
// specifically — every aggregate's Event interface has the same
// EventName() string shape, so this bus stays aggregate-agnostic
// rather than importing every domain package that ever publishes
// through it.
type namedEvent interface {
	EventName() string
}

// envelope is the wire format every domain event is wrapped in —
// EventName exists because Redis carries opaque bytes, so a subscriber
// needs some way to tell a user.Created from a user.Deleted before
// unmarshaling Payload into the right Go type. The queue (the durable
// side) stores this same envelope, so its consumers read events with
// the exact same shape pub/sub subscribers get.
type envelope struct {
	EventName  string          `json:"event_name"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload"`
}

// EventBus implements application.EventPublisher for both event
// consumers: the durable queue (workers that must not miss an event
// while offline — the deal announcer today, anything else tomorrow)
// and the pub/sub channel (push-style subscribers like domain-api's
// SSE).
//
// The durable write comes FIRST and the pub/sub publish LAST: pub/sub
// is at-most-once, so a blip there must never cost a worker an event
// it could still have read off the list — the opposite ordering would
// silently drop events exactly when things are already going wrong.
//
// The list is capped at queueMax from the tail: a consumer dying with
// the announcer's volume is routine, capped growth is bounded, and
// keeping the TAIL (not the head) is what makes events survive even
// when the cap is hit.
type EventBus struct {
	rdb      *goredis.Client
	queueMax int64
}

func NewEventBus(rdb *goredis.Client, queueMax int64) *EventBus {
	return &EventBus{rdb: rdb, queueMax: queueMax}
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
	if err := b.rdb.RPush(ctx, eventQueueKey, data).Err(); err != nil {
		return fmt.Errorf("queue event: %w", err)
	}
	// Keep the newest queueMax envelopes. -start semantics: LTRIM key
	// -N -1 keeps exactly the last N entries.
	if err := b.rdb.LTrim(ctx, eventQueueKey, -b.queueMax, -1).Err(); err != nil {
		return fmt.Errorf("trim event queue: %w", err)
	}
	if err := b.rdb.Publish(ctx, processedChannel, data).Err(); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	return nil
}
