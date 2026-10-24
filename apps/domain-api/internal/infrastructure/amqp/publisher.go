package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
)

// CommandPublisher hands every write to the durable domain.commands
// queue through the direct exchange. Messages are persistent, so they
// survive a broker restart while domain-worker is down. Holds the
// Client rather than a bare channel so the channel (topology and all)
// is rebuilt on the first publish after a broker restart.
type CommandPublisher struct {
	client *Client

	mu sync.Mutex
	ch *amqp.Channel
}

func NewCommandPublisher(c *Client) (*CommandPublisher, error) {
	p := &CommandPublisher{client: c}
	if err := p.open(); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *CommandPublisher) open() error {
	ch, err := p.client.newChannel()
	if err != nil {
		return err
	}
	p.mu.Lock()
	if p.ch != nil {
		_ = p.ch.Close()
	}
	p.ch = ch
	p.mu.Unlock()
	return nil
}

func (p *CommandPublisher) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ch == nil {
		return nil
	}
	return p.ch.Close()
}

func (p *CommandPublisher) Publish(ctx context.Context, cmd application.Command) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("marshal command: %w", err)
	}

	p.mu.Lock()
	ch := p.ch
	p.mu.Unlock()

	if err := publishCommand(ctx, ch, data); err != nil {
		// The channel or the connection under it is gone; redial if
		// needed, rebuild the channel and topology, retry once.
		if rerr := p.client.reconnect(ctx); rerr != nil {
			return fmt.Errorf("publish command: %w", err)
		}
		if oerr := p.open(); oerr != nil {
			return fmt.Errorf("publish command: %w", err)
		}
		p.mu.Lock()
		ch = p.ch
		p.mu.Unlock()
		return publishCommand(ctx, ch, data)
	}
	return nil
}

func publishCommand(ctx context.Context, ch *amqp.Channel, data []byte) error {
	if err := ch.PublishWithContext(ctx, commandExchange, commandRoutingKey, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         data,
	}); err != nil {
		return fmt.Errorf("publish command: %w", err)
	}
	return nil
}
