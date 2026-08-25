package rooms_test

import (
	"path/filepath"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
)

// The point of persisting rooms is that a deploy doesn't end sessions
// in progress: after the restart the room is still there, the password
// still opens it, and resume tokens issued before the restart still
// verify.
func TestRoomsSurviveARestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rooms.json")

	before := rooms.NewRegistry(path)
	room, err := before.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	roomID := room.ID
	token := room.ResumeToken("peer-1", "Pessoa 1")

	// A brand new process reading the same file.
	after := rooms.NewRegistry(path)
	if err := after.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}

	restored, err := after.Get(roomID)
	if err != nil {
		t.Fatalf("room did not survive the restart: %v", err)
	}
	if !restored.CheckPassword("segredo123") {
		t.Fatal("password stopped working after the restart")
	}
	if restored.CheckPassword("errada") {
		t.Fatal("restored room accepted the wrong password")
	}
	// Without this, every client would come back as a stranger and every
	// peer connection in the room would be torn down and rebuilt.
	if !restored.VerifyResume("peer-1", "Pessoa 1", token) {
		t.Fatal("a resume token issued before the restart no longer verifies")
	}
}

// Nobody is connected to a restored room, so it must not be swept
// instantly -- people need the grace period to reconnect.
func TestRestoredRoomIsNotSweptImmediately(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rooms.json")

	before := rooms.NewRegistry(path)
	room, err := before.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	after := rooms.NewRegistry(path)
	if err := after.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}
	after.Sweep()

	if _, err := after.Get(room.ID); err != nil {
		t.Fatal("a room restored with nobody in it was swept before anyone could reconnect")
	}
}

// Resume tokens are per room: one room's key must not validate another
// room's peer.
func TestResumeTokensDoNotCrossRooms(t *testing.T) {
	registry := rooms.NewRegistry("")
	a, err := registry.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	b, err := registry.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	token := a.ResumeToken("peer-1", "Pessoa 1")
	if b.VerifyResume("peer-1", "Pessoa 1", token) {
		t.Fatal("a token from one room verified in another")
	}
}

// An empty path means memory only, which is what local dev and the
// tests use -- it must not try to touch the filesystem or fail.
func TestMemoryOnlyRegistry(t *testing.T) {
	registry := rooms.NewRegistry("")
	if _, err := registry.Create("segredo123"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := registry.Load(); err != nil {
		t.Fatalf("load with no path should be a no-op: %v", err)
	}
}
