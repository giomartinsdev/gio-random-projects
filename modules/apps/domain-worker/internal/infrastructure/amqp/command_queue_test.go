package amqp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
)

// TestCommandQueueRecoversAfterConnectionLoss is why Client can redial
// at all: a broker restart (or any dropped TCP connection) closes the
// delivery channel for good, so without recovery the worker's consumer
// would stay dead and the durable queue would grow forever.
//
// The connection is dropped out-of-band rather than by stopping the
// broker container: under Colima the published host port changes on
// container restart, which would make this flaky for reasons that have
// nothing to do with the recovery code under test.
func TestCommandQueueRecoversAfterConnectionLoss(t *testing.T) {
	ctx := context.Background()
	ctr, err := runRabbit(ctx)
	if err != nil {
		t.Skipf("Docker indisponível; pulando teste de integração: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(context.Background()) })

	url, err := ctr.AmqpURL(ctx)
	if err != nil {
		t.Fatalf("amqp url: %v", err)
	}
	client, err := Dial(url)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	q, err := NewCommandQueue(client)
	if err != nil {
		t.Fatalf("new command queue: %v", err)
	}

	// Baseline: consume one command over the healthy connection.
	rawPublishCommand(t, url, "c1", application.ActionCreateUser)
	if got := nextCommand(t, q, ctx, "c1"); got.ID != "c1" {
		t.Fatalf("first command id = %q, want c1", got.ID)
	}

	// Simulate the broker going away: kill the connection under the
	// consumer, exactly as a RabbitMQ restart would.
	dropClientConnection(t, client)

	// A command published after the drop must still be consumed once
	// Next redials and re-establishes the consumer.
	rawPublishCommand(t, url, "c2", application.ActionCreateUser)
	if got := nextCommand(t, q, ctx, "c2"); got.ID != "c2" {
		t.Fatalf("command after connection loss id = %q, want c2", got.ID)
	}
}

// dropClientConnection force-closes the Client's live connection so the
// recovery path runs. It is test-only: production code never closes the
// connection to trigger a redial.
func dropClientConnection(t *testing.T, c *Client) {
	t.Helper()
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		t.Fatal("client has no open connection to drop")
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("drop connection: %v", err)
	}
}

// rawPublishCommand publishes a command with a throwaway connection,
// standing in for domain-api: it declares the full durable topology
// exactly the way the API's Client does.
func rawPublishCommand(t *testing.T, url, id string, action application.Action) {
	t.Helper()
	conn, err := amqp.Dial(url)
	if err != nil {
		t.Fatalf("dial publish: %v", err)
	}
	defer func() { _ = conn.Close() }()
	ch, err := conn.Channel()
	if err != nil {
		t.Fatalf("publish channel: %v", err)
	}
	defer func() { _ = ch.Close() }()
	if err := declareCommandTopology(ch); err != nil {
		t.Fatalf("declare topology: %v", err)
	}
	body, err := json.Marshal(application.Command{ID: id, Action: action})
	if err != nil {
		t.Fatalf("marshal command: %v", err)
	}
	if err := ch.PublishWithContext(context.Background(), commandExchange, commandRoutingKey, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	}); err != nil {
		t.Fatalf("publish command: %v", err)
	}
}

// nextCommand drives Next the way main's loop does: transient errors
// during recovery are retried, and only the expected id counts as
// success. Fails the test after a deadline.
func nextCommand(t *testing.T, q *CommandQueue, ctx context.Context, wantID string) application.Command {
	t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		cmd, err := q.Next(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				t.Fatalf("Next canceled while waiting for %q", wantID)
			}
			time.Sleep(200 * time.Millisecond)
			continue
		}
		if cmd.ID == wantID {
			return cmd
		}
	}
	t.Fatalf("command %q not received before the deadline", wantID)
	return application.Command{}
}
