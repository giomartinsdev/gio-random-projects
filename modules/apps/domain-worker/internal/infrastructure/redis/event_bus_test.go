package redis

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/alicebob/miniredis/v2"
	goredis "github.com/redis/go-redis/v9"
)

type testEvent struct{ Name string }

func (testEvent) EventName() string { return "test.happened" }

func newTestBus(t *testing.T, queueMax int64) (*EventBus, *goredis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return NewEventBus(rdb, queueMax), rdb
}

func TestPublishQueuesBeforeItBroadcasts(t *testing.T) {
	bus, rdb := newTestBus(t, 100)

	if err := bus.Publish(context.Background(), testEvent{Name: "a"}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	// The durable side must hold the full envelope — a queue consumer
	// that was down during the publish reads exactly what a pub/sub
	// subscriber would have been pushed.
	lLen, err := rdb.LLen(context.Background(), eventQueueKey).Result()
	if err != nil || lLen != 1 {
		t.Fatalf("queue length = %d, err = %v; want 1", lLen, err)
	}
	raw, err := rdb.LIndex(context.Background(), eventQueueKey, -1).Result()
	if err != nil {
		t.Fatalf("LIndex: %v", err)
	}
	var env envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
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

func TestPublishKeepsOnlyTheTailBeyondQueueMax(t *testing.T) {
	bus, rdb := newTestBus(t, 3)

	for i := 0; i < 5; i++ {
		if err := bus.Publish(context.Background(), testEvent{Name: "e"}); err != nil {
			t.Fatalf("Publish %d: %v", i, err)
		}
	}
	lLen, err := rdb.LLen(context.Background(), eventQueueKey).Result()
	if err != nil || lLen != 3 {
		t.Fatalf("queue length = %d, err = %v; want 3 (capped)", lLen, err)
	}
}

func TestPublishAgainstDeadServerFailsCleanly(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := goredis.NewClient(&goredis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	mr.Close()

	bus := NewEventBus(rdb, 100)
	if err := bus.Publish(context.Background(), testEvent{}); err == nil {
		t.Fatal("publish to a dead server must error")
	}
}

func TestPublishMarshalErrorRejectedBeforeAnyWrite(t *testing.T) {
	bus, rdb := newTestBus(t, 100)

	// json.Marshal cannot fail on this struct; instead exercise the
	// guard with an event whose payload field is unmarshalable via
	// a channel-typed field.
	type bad struct {
		testEvent
		Ch chan int
	}
	if err := bus.Publish(context.Background(), bad{}); err == nil {
		t.Fatal("marshal failure must surface as an error")
	}
	if lLen, _ := rdb.LLen(context.Background(), eventQueueKey).Result(); lLen != 0 {
		t.Fatalf("queue length = %d, want 0 (nothing written)", lLen)
	}
}
