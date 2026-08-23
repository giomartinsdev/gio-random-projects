// Package redis is domain-api's half of the event bus: publish-only.
// domain-worker's own copy of this package (in its module) has the
// other half — Relay, the queue consumer, and the outbound event
// publisher — since it's the side that actually processes commands.
// Both sides must agree on commandChannel; it's duplicated here
// deliberately rather than shared, per this module's independence from
// domain-worker's.
package redis

import (
	"context"
	"encoding/json"
	"fmt"

	goredis "github.com/redis/go-redis/v9"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/api/internal/application"
)

const commandChannel = "domain.commands"

type CommandPublisher struct {
	rdb *goredis.Client
}

func NewCommandPublisher(rdb *goredis.Client) *CommandPublisher {
	return &CommandPublisher{rdb: rdb}
}

func (b *CommandPublisher) Publish(ctx context.Context, cmd application.Command) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("marshal command: %w", err)
	}
	if err := b.rdb.Publish(ctx, commandChannel, data).Err(); err != nil {
		return fmt.Errorf("publish command: %w", err)
	}
	return nil
}
