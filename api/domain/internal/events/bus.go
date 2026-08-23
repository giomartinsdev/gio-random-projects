package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

type Bus struct {
	rdb *redis.Client
}

func NewBus(rdb *redis.Client) *Bus {
	return &Bus{rdb: rdb}
}

// PublishCommand fire-and-forgets a Command onto CommandChannel — no
// subscriber means no delivery, which is exactly why Relay exists to
// turn this into something durable.
func (b *Bus) PublishCommand(ctx context.Context, cmd Command) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("marshal command: %w", err)
	}
	if err := b.rdb.Publish(ctx, CommandChannel, data).Err(); err != nil {
		return fmt.Errorf("publish command: %w", err)
	}
	return nil
}

// PublishProcessed announces the outcome of a Command on
// ProcessedChannel.
func (b *Bus) PublishProcessed(ctx context.Context, evt Processed) error {
	data, err := json.Marshal(evt)
	if err != nil {
		return fmt.Errorf("marshal processed event: %w", err)
	}
	if err := b.rdb.Publish(ctx, ProcessedChannel, data).Err(); err != nil {
		return fmt.Errorf("publish processed event: %w", err)
	}
	return nil
}

// Relay subscribes to CommandChannel and pushes every message it
// receives onto CommandQueue, blocking until ctx is cancelled. This is
// the bridge that turns pub/sub's fire-and-forget delivery into
// something a worker can consume at its own pace (and that survives a
// restart, since the queue is a persisted list, not a subscription).
func (b *Bus) Relay(ctx context.Context) error {
	sub := b.rdb.Subscribe(ctx, CommandChannel)
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
			if err := b.rdb.RPush(ctx, CommandQueue, msg.Payload).Err(); err != nil {
				return fmt.Errorf("relay message onto queue: %w", err)
			}
		}
	}
}

// NextCommand blocks (up to Redis's BLPOP semantics) until a command is
// available on CommandQueue, or ctx is cancelled.
func (b *Bus) NextCommand(ctx context.Context) (Command, error) {
	res, err := b.rdb.BLPop(ctx, 0, CommandQueue).Result()
	if err != nil {
		return Command{}, err
	}
	// BLPop returns [key, value]; res[0] is CommandQueue itself.
	var cmd Command
	if err := json.Unmarshal([]byte(res[1]), &cmd); err != nil {
		return Command{}, fmt.Errorf("unmarshal command: %w", err)
	}
	return cmd, nil
}
