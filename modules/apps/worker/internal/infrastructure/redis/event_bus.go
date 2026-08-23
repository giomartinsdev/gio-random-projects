package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	domainuser "github.com/giomartinsdev/gio-random-projects/modules/apps/worker/internal/domain/user"
)

// envelope is the wire format every domain event is wrapped in —
// EventName exists because Redis carries opaque bytes, so a subscriber
// needs some way to tell a user.Created from a user.Deleted before
// unmarshaling Payload into the right Go type.
type envelope struct {
	EventName  string          `json:"event_name"`
	OccurredAt time.Time       `json:"occurred_at"`
	Payload    json.RawMessage `json:"payload"`
}

// EventBus implements application.EventPublisher.
type EventBus struct {
	rdb *goredis.Client
}

func NewEventBus(rdb *goredis.Client) *EventBus {
	return &EventBus{rdb: rdb}
}

func (b *EventBus) Publish(ctx context.Context, evt domainuser.Event) error {
	payload, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal event payload: %w", err)
	}
	env := envelope{EventName: evt.EventName(), OccurredAt: time.Now().UTC(), Payload: payload}
	data, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("marshal event envelope: %w", err)
	}
	if err := b.rdb.Publish(ctx, processedChannel, data).Err(); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	return nil
}
