package rooms

import (
	"context"
	"errors"
	"testing"
	"time"
)

// slowPersister takes its time — standing in for the /sync round-trip
// the real one makes, so tests can observe what happens while a persist
// is in flight.
type slowPersister struct {
	delay time.Duration
}

func (p *slowPersister) Load(context.Context) ([]StoredRoom, error) { return nil, nil }

func (p *slowPersister) Save(_ context.Context, room StoredRoom) error {
	time.Sleep(p.delay)
	return nil
}

func (p *slowPersister) Delete(context.Context, string) error { return nil }

// blockingPersister's Delete waits on a channel, so the test controls
// exactly how long the persist takes.
type blockingPersister struct {
	release chan struct{}
}

func (p *blockingPersister) Load(context.Context) ([]StoredRoom, error) { return nil, nil }

func (p *blockingPersister) Save(context.Context, StoredRoom) error { return nil }

func (p *blockingPersister) Delete(context.Context, string) error {
	<-p.release
	return nil
}

// Delete has to release the registry lock before persisting: the
// persister is slow (a synchronous HTTP round-trip in production), and
// the first production Delete wedged every registry endpoint behind it.
func TestDeleteDoesNotDeadlock(t *testing.T) {
	r := NewRegistry(&slowPersister{delay: 50 * time.Millisecond})
	room, err := r.Create("senha-teste")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- r.Delete(room.ID, "senha-teste") }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Delete: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Delete não retornou: deadlock do registry")
	}

	if got := r.Count(); got != 0 {
		t.Fatalf("Count após Delete = %d, want 0", got)
	}
	if _, err := r.Get(room.ID); err != ErrNotFound {
		t.Fatalf("Get após Delete: got %v, want ErrNotFound", err)
	}
}

// While one Delete is inside its persist (blocked on the persister),
// the rest of the registry must keep answering — Get is the canary: if
// the lock leaked into the persist, this times out instead of passing.
func TestDeleteKeepsRegistryResponsiveDuringPersist(t *testing.T) {
	block := make(chan struct{})
	r := NewRegistry(&blockingPersister{release: block})
	room, err := r.Create("senha")
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- r.Delete(room.ID, "senha") }()

	// Give Delete time to reach the blocked persist, then ask for a room.
	time.Sleep(20 * time.Millisecond)
	got := make(chan error, 1)
	go func() {
		_, err := r.Get(room.ID)
		got <- err
	}()
	select {
	case err := <-got:
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("Get durante persist: got %v, want ErrNotFound", err)
		}
	case <-time.After(1 * time.Second):
		close(block)
		t.Fatal("lock do registry segurado durante o persist — Get passou fome")
	}
	close(block)
	if err := <-done; err != nil {
		t.Fatalf("Delete: %v", err)
	}
}