package redis

import (
	"context"
	"encoding/json"
	"fmt"

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/api/domain/src/application"
)

// CommandBus implements application.CommandPublisher and also runs the
// Relay bridge — both sides of commandChannel belong to the same Redis
// client, so they share this type instead of being split across two.
type CommandBus struct {
	rdb *goredis.Client
}

func NewCommandBus(rdb *goredis.Client) *CommandBus {
	return &CommandBus{rdb: rdb}
}

func (b *CommandBus) Publish(ctx context.Context, cmd application.Command) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("marshal command: %w", err)
	}
	if err := b.rdb.Publish(ctx, commandChannel, data).Err(); err != nil {
		return fmt.Errorf("publish command: %w", err)
	}
	return nil
}

// Relay subscribes to commandChannel and pushes every message it
// receives onto commandQueueKey, blocking until ctx is cancelled.
func (b *CommandBus) Relay(ctx context.Context) error {
	sub := b.rdb.Subscribe(ctx, commandChannel)
	defer sub.Close()

	ch := sub.Channel()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			if err := b.rdb.RPush(ctx, commandQueueKey, msg.Payload).Err(); err != nil {
				return fmt.Errorf("relay message onto queue: %w", err)
			}
		}
	}
}
