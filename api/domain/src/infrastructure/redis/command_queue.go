package redis

import (
	"context"
	"encoding/json"
	"fmt"

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/api/domain/src/application"
)

// CommandQueue implements application.CommandConsumer by blocking-popping
// commandQueueKey — the durable side of the bus Relay writes onto.
type CommandQueue struct {
	rdb *goredis.Client
}

func NewCommandQueue(rdb *goredis.Client) *CommandQueue {
	return &CommandQueue{rdb: rdb}
}

func (q *CommandQueue) Next(ctx context.Context) (application.Command, error) {
	res, err := q.rdb.BLPop(ctx, 0, commandQueueKey).Result()
	if err != nil {
		return application.Command{}, err
	}
	// BLPop returns [key, value]; res[0] is commandQueueKey itself.
	var cmd application.Command
	if err := json.Unmarshal([]byte(res[1]), &cmd); err != nil {
		return application.Command{}, fmt.Errorf("unmarshal command: %w", err)
	}
	return cmd, nil
}
