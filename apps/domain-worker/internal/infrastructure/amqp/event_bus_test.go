package amqp

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"github.com/testcontainers/testcontainers-go/modules/rabbitmq"
)

type testEvent struct{ Name string }

func (testEvent) EventName() string { return "test.happened" }

// runRabbit isola a chamada ao testcontainers: sem um Docker saudável, o
// rabbitmq.Run PANICA (MustExtractDockerHost) em vez de devolver erro, então
// convertê-lo em erro é o que permite pular o teste em máquinas sem Docker.
func runRabbit(ctx context.Context) (ctr *rabbitmq.RabbitMQContainer, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("testcontainers indisponível: %v", r)
		}
	}()
	return rabbitmq.Run(ctx, "rabbitmq:4-alpine")
}

// newTestBus sobe um RabbitMQ REAL via testcontainers (o teste é pulado quando
// não há Docker) e devolve o EventBus mais a URL AMQP para inspeção externa.
func newTestBus(t *testing.T, queueMax int) (*EventBus, string) {
	t.Helper()
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

	bus, err := NewEventBus(client, queueMax)
	if err != nil {
		t.Fatalf("new event bus: %v", err)
	}
	t.Cleanup(func() { _ = bus.Close() })
	return bus, url
}

func rawChannel(t *testing.T, url string) *amqp.Channel {
	t.Helper()
	conn, err := amqp.Dial(url)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	ch, err := conn.Channel()
	if err != nil {
		t.Fatalf("channel: %v", err)
	}
	t.Cleanup(func() { _ = ch.Close() })
	return ch
}

func waitQueueMessages(t *testing.T, ch *amqp.Channel, queue string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		q, err := ch.QueueDeclarePassive(queue, true, false, false, false, nil)
		if err != nil {
			t.Fatalf("passive declare %s: %v", queue, err)
		}
		if int(q.Messages) == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("queue %s messages = %d, want %d", queue, q.Messages, want)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestPublishQueuesForDurableConsumers(t *testing.T) {
	bus, url := newTestBus(t, 100)
	if err := bus.Publish(context.Background(), testEvent{Name: "a"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	ch := rawChannel(t, url)
	waitQueueMessages(t, ch, eventsQueue, 1)

	// The durable side must hold the full envelope — a consumer that was
	// down during the publish reads exactly what a live subscriber got.
	d, ok, err := ch.Get(eventsQueue, true)
	if err != nil || !ok {
		t.Fatalf("get: ok=%v err=%v", ok, err)
	}
	var env envelope
	if err := json.Unmarshal(d.Body, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if env.EventName != "test.happened" {
		t.Fatalf("envelope event_name = %q", env.EventName)
	}
	var payload testEvent
	if err := json.Unmarshal(env.Payload, &payload); err != nil || payload.Name != "a" {
		t.Fatalf("payload = %q, err = %v", env.Payload, err)
	}
}

func TestPublishCapsQueueLength(t *testing.T) {
	bus, url := newTestBus(t, 3)

	for i := 0; i < 5; i++ {
		if err := bus.Publish(context.Background(), testEvent{Name: "e"}); err != nil {
			t.Fatalf("Publish %d: %v", i, err)
		}
	}
	ch := rawChannel(t, url)
	waitQueueMessages(t, ch, eventsQueue, 3)
}

func TestPublishMarshalErrorRejectedBeforeAnyWrite(t *testing.T) {
	bus, url := newTestBus(t, 100)

	// json.Marshal cannot fail on testEvent; exercise the guard with a
	// payload field that cannot be marshaled.
	type bad struct {
		testEvent
		Ch chan int
	}
	if err := bus.Publish(context.Background(), bad{}); err == nil {
		t.Fatal("marshal failure must surface as an error")
	}

	ch := rawChannel(t, url)
	time.Sleep(200 * time.Millisecond)
	q, err := ch.QueueDeclarePassive(eventsQueue, true, false, false, false, nil)
	if err != nil {
		t.Fatalf("passive declare: %v", err)
	}
	if q.Messages != 0 {
		t.Fatalf("queue messages = %d, want 0 (nothing written)", q.Messages)
	}
}

func TestPublishFansOutToSubscribers(t *testing.T) {
	bus, url := newTestBus(t, 100)
	ch := rawChannel(t, url)

	if err := ch.ExchangeDeclare(eventsExchange, "fanout", true, false, false, false, nil); err != nil {
		t.Fatalf("declare exchange: %v", err)
	}
	q, err := ch.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		t.Fatalf("declare subscriber queue: %v", err)
	}
	if err := ch.QueueBind(q.Name, "", eventsExchange, false, nil); err != nil {
		t.Fatalf("bind subscriber queue: %v", err)
	}
	deliveries, err := ch.Consume(q.Name, "", true, true, false, false, nil)
	if err != nil {
		t.Fatalf("consume: %v", err)
	}

	if err := bus.Publish(context.Background(), testEvent{Name: "fan"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	select {
	case d := <-deliveries:
		var env envelope
		if err := json.Unmarshal(d.Body, &env); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if env.EventName != "test.happened" {
			t.Fatalf("event_name = %q", env.EventName)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("subscriber did not receive the event")
	}
}
