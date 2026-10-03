// Package amqp is domain-worker's half of the message bus: the
// consumer of the durable command queue and the publisher of domain
// events. domain-api's own copy of this topology (in its module) only
// has the publish and subscribe sides. Both sides must agree on these
// names; they're duplicated here deliberately rather than shared, per
// this module's independence from domain-api's.
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
	eventsExchange    = "domain.events"
	eventsQueue       = "domain.events.queue"
)

// reconnectDelay is the pause before a redial after the broker drops
// the connection. Short enough to ride out a broker restart quickly,
// long enough not to hammer a broker that is still coming up.
const reconnectDelay = time.Second

// Client owns the AMQP connection shared by the command consumer and
// the event publisher, and — unlike the raw amqp.Connection — can
// redial it. A RabbitMQ restart closes the TCP connection for good, so
// without redialing every channel built from it is dead and both the
// consumer and the publisher would stay broken until the process
// restarted. The components call reconnect() when a channel or
// delivery dies, so recovery is lazy but automatic.
type Client struct {
	url string

	mu   sync.Mutex
	conn *amqp.Connection

	// reconnectMu serializes redials so two components noticing the
	// same outage don't race to replace each other's fresh connection.
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
// no-op when the connection is still healthy (another component may
// have already recovered it).
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

// declareCommandTopology is the durable replacement for the old
// pub/sub channel plus list: a direct exchange fans the single routing
// key into one durable queue, so a command published while the worker
// is down waits there instead of being dropped.
func declareCommandTopology(ch *amqp.Channel) error {
	if err := ch.ExchangeDeclare(commandExchange, "direct", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare %s: %w", commandExchange, err)
	}
	if _, err := ch.QueueDeclare(commandQueue, true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare %s: %w", commandQueue, err)
	}
	if err := ch.QueueBind(commandQueue, commandRoutingKey, commandExchange, false, nil); err != nil {
		return fmt.Errorf("bind %s: %w", commandQueue, err)
	}
	return nil
}

// declareEventsTopology replaces the old RPUSH/LTRIM list + PUBLISH
// pair with a single fanout publish: the durable events queue and every
// live SSE subscriber queue are bound to the exchange, so one publish
// reaches both. x-max-length caps the durable queue from the tail
// (drop-head), the same "keep the newest N" the LTRIM did.
func declareEventsTopology(ch *amqp.Channel, queueMax int) error {
	if err := ch.ExchangeDeclare(eventsExchange, "fanout", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare %s: %w", eventsExchange, err)
	}
	args := amqp.Table{}
	if queueMax > 0 {
		args[amqp.QueueMaxLenArg] = int32(queueMax)
		args[amqp.QueueOverflowArg] = "drop-head"
	}
	if _, err := ch.QueueDeclare(eventsQueue, true, false, false, false, args); err != nil {
		return fmt.Errorf("declare %s: %w", eventsQueue, err)
	}
	if err := ch.QueueBind(eventsQueue, "", eventsExchange, false, nil); err != nil {
		return fmt.Errorf("bind %s: %w", eventsQueue, err)
	}
	return nil
}
