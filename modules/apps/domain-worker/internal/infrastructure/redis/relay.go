package redis

import (
	"context"
	"fmt"

	goredis "github.com/redis/go-redis/v9"
)

// Relay subscribes to commandChannel and pushes every message it
// receives onto commandQueueKey, blocking until ctx is cancelled — the
// bridge that turns pub/sub's fire-and-forget delivery into something
// the consumer loop (command_queue.go) can drain at its own pace.
type Relay struct {
	rdb *goredis.Client
}

func NewRelay(rdb *goredis.Client) *Relay {
	return &Relay{rdb: rdb}
}

func (r *Relay) Run(ctx context.Context) error {
	sub := r.rdb.Subscribe(ctx, commandChannel)
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
			if err := r.rdb.RPush(ctx, commandQueueKey, msg.Payload).Err(); err != nil {
				return fmt.Errorf("relay message onto queue: %w", err)
			}
		}
	}
}
