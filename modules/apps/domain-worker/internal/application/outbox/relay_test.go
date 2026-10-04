package outbox

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

type fakeEvent struct {
	name    string
	payload any
}

func (e fakeEvent) EventName() string { return e.name }

func (e fakeEvent) MarshalJSON() ([]byte, error) { return json.Marshal(e.payload) }

// fakeRepo is an in-memory outbox: enough to prove the relay's contract
// (enqueue-before-publish, retry, idempotent id) without Postgres.
type fakeRepo struct {
	mu      sync.Mutex
	rows    map[string]*fakeRow
	enqueue error
}

type fakeRow struct {
	entry       Entry
	published   bool
	attempts    int
	lastError   string
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[string]*fakeRow{}} }

func (r *fakeRepo) Enqueue(_ context.Context, entries []Entry) error {
	if r.enqueue != nil {
		return r.enqueue
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range entries {
		if _, ok := r.rows[e.ID]; ok {
			continue
		}
		r.rows[e.ID] = &fakeRow{entry: e}
	}
	return nil
}

func (r *fakeRepo) Pending(_ context.Context, limit int) ([]Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Entry{}
	for _, row := range r.rows {
		if !row.published {
			out = append(out, row.entry)
			if len(out) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (r *fakeRepo) MarkPublished(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if row, ok := r.rows[id]; ok {
		row.published = true
	}
	return nil
}

func (r *fakeRepo) MarkFailed(_ context.Context, id, reason string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if row, ok := r.rows[id]; ok {
		row.attempts++
		row.lastError = reason
	}
	return nil
}

// fakeBus records published bytes and can be made to fail until told otherwise
// (the "broker fora do ar" of §12.5).
type fakeBus struct {
	mu        sync.Mutex
	down      bool
	published [][]byte
	failCount int
}

func (b *fakeBus) EnvelopeBytes(name string, at time.Time, payload json.RawMessage) ([]byte, error) {
	env := map[string]any{"event_name": name, "occurred_at": at, "payload": payload}
	return json.Marshal(env)
}

func (b *fakeBus) PublishRaw(_ context.Context, data []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.down {
		b.failCount++
		return errors.New("broker down")
	}
	b.published = append(b.published, data)
	return nil
}

func (b *fakeBus) setDown(down bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.down = down
}

func (b *fakeBus) count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.published)
}

func testRelay(repo *fakeRepo, bus *fakeBus) *Relay {
	return NewRelay(repo, bus, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

// §12.5: broker fora do ar na hora do publish ⇒ o evento fica pendente e é
// publicado depois, sem perder a escrita.
func TestRelayKeepsEventWhenBrokerIsDownThenPublishesItLater(t *testing.T) {
	repo := newFakeRepo()
	bus := &fakeBus{down: true}
	relay := testRelay(repo, bus)
	ctx := context.Background()

	// Enqueue + tentativa imediata: o publish falha, mas Publish devolve nil
	// (a escrita está durável) e a linha fica pendente.
	if err := relay.Publish(ctx, "cmd-1", []Event{fakeEvent{name: "finance.transaction.registered", payload: map[string]any{"x": "1"}}}); err != nil {
		t.Fatalf("Publish devia registrar mesmo com broker fora: %v", err)
	}
	if bus.count() != 0 {
		t.Fatal("nada devia ter sido publicado com o broker fora")
	}
	pending, _ := repo.Pending(ctx, 10)
	if len(pending) != 1 {
		t.Fatalf("evento devia estar pendente; veio %d", len(pending))
	}

	// Broker volta: o relay drena e publica.
	bus.setDown(false)
	relay.drain(ctx)
	if bus.count() != 1 {
		t.Fatalf("evento devia ter sido publicado após o broker voltar; veio %d", bus.count())
	}
	pending, _ = repo.Pending(ctx, 10)
	if len(pending) != 0 {
		t.Fatalf("nada devia continuar pendente; veio %d", len(pending))
	}
}

// Re-enqueue do MESMO comando não duplica: o id é determinístico.
func TestRelayEnqueueIsIdempotentPerCommand(t *testing.T) {
	repo := newFakeRepo()
	bus := &fakeBus{}
	relay := testRelay(repo, bus)
	ctx := context.Background()

	evt := []Event{fakeEvent{name: "finance.transaction.registered", payload: map[string]any{"x": "1"}}}
	if err := relay.Publish(ctx, "cmd-1", evt); err != nil {
		t.Fatal(err)
	}
	if err := relay.Publish(ctx, "cmd-1", evt); err != nil {
		t.Fatal(err)
	}
	// Uma linha só (o segundo enqueue é no-op), publicada uma vez.
	repo.mu.Lock()
	n := len(repo.rows)
	repo.mu.Unlock()
	if n != 1 {
		t.Fatalf("replay do mesmo comando criou %d linhas; want 1", n)
	}
}

// Um comando pode cruzar várias réguas: cada uma é um evento próprio, com id
// determinístico distinto (o índice entra na chave).
func TestRelayPersistsMultipleEventsPerCommandDistinctly(t *testing.T) {
	repo := newFakeRepo()
	relay := testRelay(repo, &fakeBus{})
	ctx := context.Background()
	err := relay.Publish(ctx, "cmd-bud", []Event{
		fakeEvent{name: "finance.budget.thresholdReached", payload: map[string]any{"threshold": 50}},
		fakeEvent{name: "finance.budget.thresholdReached", payload: map[string]any{"threshold": 80}},
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.mu.Lock()
	n := len(repo.rows)
	repo.mu.Unlock()
	if n != 2 {
		t.Fatalf("dois limiares deviam virar 2 linhas; veio %d", n)
	}
}

func TestRelayEnqueueErrorIsReported(t *testing.T) {
	repo := newFakeRepo()
	repo.enqueue = errors.New("db down")
	relay := testRelay(repo, &fakeBus{})
	err := relay.Publish(context.Background(), "cmd-1", []Event{fakeEvent{name: "x", payload: 1}})
	if err == nil {
		t.Fatal("falha de enqueue devia ser reportada (não dá para registrar a escrita)")
	}
}
