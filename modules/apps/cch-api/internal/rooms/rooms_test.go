package rooms

import (
	"path/filepath"
	"testing"
	"time"
)

// Delete has to release the registry lock before persisting: persist()
// takes the same mutex, and the first production Delete wedged every
// registry endpoint behind it. A registry with a path is used so the
// persist call actually runs.
func TestDeleteDoesNotDeadlock(t *testing.T) {
	r := NewRegistry(filepath.Join(t.TempDir(), "rooms.json"))
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