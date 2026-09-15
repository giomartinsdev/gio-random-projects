package clips_test

import (
	"bytes"
	"context"
	"io"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/clips"
)

// The store contract every implementation has to honor: save, list
// newest-first, open whole, expire (both swept and on read), and
// refuse to outgrow the budget. Run against the memory store here;
// the S3 store speaks to a real server and lives behind the same
// interface.
func TestMemoryStoreContract(t *testing.T) {
	ctx := context.Background()
	store := clips.NewMemoryStore()
	now := time.Now()

	newClip := func(id, name string, createdAt, expires time.Time) clips.Clip {
		return clips.Clip{ID: id, RoomID: "sala1", Name: name, CreatedAt: createdAt, ExpiresAt: expires}
	}
	ttl := func(d time.Duration) time.Time { return now.Add(d) }

	// Two live clips (different creation times, so newest-first is
	// observable), one already expired.
	for _, c := range []struct {
		meta clips.Clip
		data string
	}{
		{newClip("antigo", "Antigo", ttl(-2*time.Hour), ttl(time.Hour)), "primeiro"},
		{newClip("novo", "Novo", ttl(-1*time.Hour), ttl(time.Hour)), "segundo"},
		{newClip("morto", "Morto", ttl(-3*time.Hour), ttl(-time.Minute)), "expirado"},
	} {
		if err := store.Save(ctx, c.meta, bytes.NewReader([]byte(c.data))); err != nil {
			t.Fatalf("save %s: %v", c.meta.ID, err)
		}
	}

	list, err := store.List(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %d clips, want 2 (the expired one is not listed)", len(list))
	}
	if list[0].ID != "novo" || list[1].ID != "antigo" {
		t.Errorf("list order = [%s, %s], want [novo, antigo] (newest first)", list[0].ID, list[1].ID)
	}

	// Open streams the exact bytes back.
	clip, rc, err := store.Open(ctx, "antigo")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	body, err := io.ReadAll(rc)
	rc.Close()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if string(body) != "primeiro" {
		t.Errorf("open returned %q, want %q", body, "primeiro")
	}
	if clip.Name != "Antigo" || clip.RoomID != "sala1" {
		t.Errorf("metadata = %v", clip)
	}

	// An expired clip reads as not-found even before the sweeper runs,
	// and the read itself removes it (lazy expiry).
	if _, _, err := store.Open(ctx, "morto"); err != clips.ErrNotFound {
		t.Errorf("open expired = %v, want ErrNotFound", err)
	}

	// The sweeper removes what expired on its own -- a fresh expired
	// clip, since "morto" was already deleted by the read above.
	if err := store.Save(ctx, newClip("morto2", "Morto2", ttl(-2*time.Hour), ttl(-time.Minute)),
		bytes.NewReader([]byte("expirado"))); err != nil {
		t.Fatalf("save morto2: %v", err)
	}
	removed, err := store.SweepExpired(ctx, now.Add(time.Hour))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if removed != 1 {
		t.Errorf("sweep removed %d, want 1", removed)
	}
	if _, _, err := store.Open(ctx, "morto2"); err != clips.ErrNotFound {
		t.Errorf("open after sweep = %v, want ErrNotFound", err)
	}
}

func TestMemoryStoreRefusesToOutgrowItsBudget(t *testing.T) {
	ctx := context.Background()
	store := clips.NewMemoryStore()
	now := time.Now()

	big := bytes.NewReader(make([]byte, 400<<20)) // fits 512 MB alone...
	if err := store.Save(ctx, clips.Clip{ID: "a", ExpiresAt: now.Add(time.Hour)}, big); err != nil {
		t.Fatalf("first save: %v", err)
	}
	// ...but the second one tips the budget and is refused whole.
	err := store.Save(ctx, clips.Clip{ID: "b", ExpiresAt: now.Add(time.Hour)}, bytes.NewReader(make([]byte, 200<<20)))
	if err != clips.ErrTooBig {
		t.Fatalf("second save = %v, want ErrTooBig", err)
	}
	if _, _, err := store.Open(ctx, "b"); err != clips.ErrNotFound {
		t.Errorf("refused clip is readable: %v", err)
	}
}
