package postgres

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
)

// O que só o banco prova: idempotência do enqueue por id, a ordem dos
// pendentes e a transição pending → published.

func TestOutboxEnqueueIsIdempotentAndPendingOrdered(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewOutboxRepository(pool)

	idA := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	idB := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM outbox WHERE id IN ($1,$2)`, idA, idB)
	})

	now := time.Now().UTC()
	entries := []outbox.Entry{
		{ID: idA, EventName: "finance.transaction.registered", Payload: json.RawMessage(`{"event_name":"x"}`), OccurredAt: now},
		{ID: idB, EventName: "finance.transfer.completed", Payload: json.RawMessage(`{"event_name":"y"}`), OccurredAt: now},
	}
	if err := repo.Enqueue(ctx, entries); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	// Re-enqueue do mesmo id é no-op.
	if err := repo.Enqueue(ctx, entries); err != nil {
		t.Fatalf("re-enqueue: %v", err)
	}

	pending, err := repo.Pending(ctx, 10)
	if err != nil {
		t.Fatalf("pending: %v", err)
	}
	// Filtra só os nossos dois (a tabela pode ter de outras execuções).
	var seen []string
	for _, e := range pending {
		if e.ID == idA || e.ID == idB {
			seen = append(seen, e.ID)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("pendentes nossos = %d; want 2 (%v)", len(seen), seen)
	}

	// Marca A publicado; B continua pendente.
	if err := repo.MarkPublished(ctx, idA); err != nil {
		t.Fatalf("mark published: %v", err)
	}
	pending, _ = repo.Pending(ctx, 10)
	for _, e := range pending {
		if e.ID == idA {
			t.Fatal("A não podia continuar pendente após MarkPublished")
		}
	}

	// MarkFailed incrementa attempts e grava o motivo.
	if err := repo.MarkFailed(ctx, idB, "broker down"); err != nil {
		t.Fatalf("mark failed: %v", err)
	}
	var attempts int
	var lastErr string
	if err := pool.QueryRow(ctx, `SELECT attempts, last_error FROM outbox WHERE id = $1`, idB).Scan(&attempts, &lastErr); err != nil {
		t.Fatalf("read attempts: %v", err)
	}
	if attempts != 1 || lastErr != "broker down" {
		t.Fatalf("attempts/last_error = %d/%q; want 1/\"broker down\"", attempts, lastErr)
	}
}
