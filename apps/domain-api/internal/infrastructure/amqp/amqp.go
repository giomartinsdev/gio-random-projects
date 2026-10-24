// Package amqp is domain-api's half of the message bus: it publishes
// commands and subscribes to domain events over RabbitMQ. domain-worker
// owns the other half (the command consumer and the durable event
// queue) in its own module — the topology names below are duplicated
// there deliberately, same "each module owns its copy" convention the
// old redis packages followed.
package amqp

import (
	"context"
	"fmt"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	commandExchange   = "domain.commands"
	commandQueue      = "domain.commands.queue"
	commandRoutingKey = "domain.commands"
)

// reconnectDelay is the pause before a redial after the broker drops
// the connection. Short enough to ride out a broker restart quickly,
// long enough not to hammer a broker that is still coming up.
const reconnectDelay = time.Second

// Client owns the AMQP connection used by the command publisher and —
// unlike the raw amqp.Connection — can redial it. A RabbitMQ restart
// closes the TCP connection for good, so without redialing the publisher
// would fail every write until the process restarted; the publisher
// calls reconnect() when a channel dies, making recovery lazy but
// automatic.
type Client struct {
	url string

	mu   sync.Mutex
	conn *amqp.Connection

	// reconnectMu serializes redials so two callers noticing the same
	// outage don't race to replace each other's fresh connection.
	reconnectMu sync.Mutex
}

func Dial(url string) (*Client, error) {
	c := &Client{url: url}
	if err := c.dial(); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *Client) dial() error {
	conn, err := amqp.Dial(c.url)
	if err != nil {
		return fmt.Errorf("dial rabbitmq: %w", err)
	}
	c.mu.Lock()
	old := c.conn
	c.conn = conn
	c.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

// connection returns the current connection.
func (c *Client) connection() *amqp.Connection {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn
}

// reconnect redials when the current connection is closed, waiting
// reconnectDelay first to let a restarting broker come back. It is a
// no-op when the connection is still healthy (another caller may have
// already recovered it).
func (c *Client) reconnect(ctx context.Context) error {
	c.reconnectMu.Lock()
	defer c.reconnectMu.Unlock()

	if conn := c.connection(); conn != nil && !conn.IsClosed() {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(reconnectDelay):
	}
	return c.dial()
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

// newChannel opens a channel with the command topology declared. The
// queue/binding are declared here too, not only by the worker: a
// command published against a fresh broker before the worker's first
// boot would otherwise hit a direct exchange with no bound queue and
// vanish. Declaring the same durable topology on both sides is
// idempotent and closes that window.
func (c *Client) newChannel() (*amqp.Channel, error) {
	conn := c.connection()
	if conn == nil || conn.IsClosed() {
		return nil, fmt.Errorf("declare %s: connection closed", commandExchange)
	}
	ch, err := conn.Channel()
	if err != nil {
		return nil, fmt.Errorf("open channel: %w", err)
	}
	if err := ch.ExchangeDeclare(commandExchange, "direct", true, false, false, false, nil); err != nil {
		_ = ch.Close()
		return nil, fmt.Errorf("declare %s: %w", commandExchange, err)
	}
	if _, err := ch.QueueDeclare(commandQueue, true, false, false, false, nil); err != nil {
		_ = ch.Close()
		return nil, fmt.Errorf("declare %s: %w", commandQueue, err)
	}
	if err := ch.QueueBind(commandQueue, commandRoutingKey, commandExchange, false, nil); err != nil {
		_ = ch.Close()
		return nil, fmt.Errorf("bind %s: %w", commandQueue, err)
	}
	return ch, nil
}
