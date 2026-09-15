package rooms

import (
	"encoding/json"
	"testing"
	"time"
)

// The idle lifecycle runs on an injectable clock: SweepIdle reads
// r.now, the room's own stamping (publish start/stop, keepalive)
// reads room.now -- both point at the same fake in these tests, so a
// full warn -> expire run takes microseconds instead of minutes.
type fakeClock struct{ at time.Time }

func (c *fakeClock) Now() time.Time { return c.at }
func (c *fakeClock) advance(d time.Duration) {
	c.at = c.at.Add(d)
}

// drain reads everything currently queued for a peer, tolerating the
// channel staying empty.
func drainPeer(t *testing.T, p *Peer, wait time.Duration) []map[string]any {
	t.Helper()
	var out []map[string]any
	deadline := time.After(wait)
	for {
		select {
		case data := <-p.Outgoing():
			var m map[string]any
			if err := json.Unmarshal(data, &m); err == nil {
				out = append(out, m)
			}
		case <-deadline:
			return out
		}
	}
}

func firstOfType(msgs []map[string]any, typ string) map[string]any {
	for _, m := range msgs {
		if m["type"] == typ {
			return m
		}
	}
	return nil
}

func TestIdleRoomIsWarnedThenClosed(t *testing.T) {
	clk := &fakeClock{at: time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)}
	reg := &Registry{rooms: make(map[string]*Room), now: clk.Now}
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// A watcher (nobody publishing) parked in the room since creation.
	watcher := NewPeer("w1", "Assistente")
	room.Join(watcher)
	// Join stamps lastSeen but nothing else; the idle clock runs from
	// room creation either way.

	// 14 minutes of nothing: still inside the idle window.
	clk.advance(14 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if msgs := drainPeer(t, watcher, 30*time.Millisecond); len(msgs) != 0 {
		t.Fatalf("room was warned before the idle timeout: %v", msgs)
	}

	// 16 minutes: one pass warns, with the deadline a full grace out.
	clk.advance(2 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	warn := firstOfType(drainPeer(t, watcher, 30*time.Millisecond), "room:closing")
	if warn == nil {
		t.Fatal("an idle room was never warned that it would close")
	}
	if ms, _ := warn["closingAt"].(float64); int64(ms) != clk.Now().Add(time.Minute).UnixMilli() {
		t.Fatalf("closingAt = %v, want now+grace", warn["closingAt"])
	}

	// Re-sweeping before the deadline neither re-warns nor closes.
	reg.SweepIdle(15*time.Minute, time.Minute)
	if msgs := drainPeer(t, watcher, 30*time.Millisecond); len(msgs) != 0 {
		t.Fatalf("warning re-issued or room closed before the deadline: %v", msgs)
	}

	// Past the deadline: room:closed, and the room is gone.
	clk.advance(2 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	closed := firstOfType(drainPeer(t, watcher, 30*time.Millisecond), "room:closed")
	if closed == nil {
		t.Fatal("room was never closed after the warning expired")
	}
	if _, err := reg.Get(room.ID); err == nil {
		t.Fatal("closed room still exists in the registry")
	}
}

func TestPublishingRoomIsNeverIdle(t *testing.T) {
	clk := &fakeClock{at: time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)}
	reg := &Registry{rooms: make(map[string]*Room), now: clk.Now}
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	sharer := NewPeer("p1", "Quem compartilha")
	room.Join(sharer)
	room.SetPublishing(sharer, true)

	// Three hours of a live share: nobody may warn or close it.
	clk.advance(3 * time.Hour)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if msgs := drainPeer(t, sharer, 30*time.Millisecond); len(msgs) != 0 {
		t.Fatalf("a publishing room was told it was closing: %v", msgs)
	}
	if _, err := reg.Get(room.ID); err != nil {
		t.Fatal("a publishing room was deleted")
	}
}

// Stopping a share starts the countdown from THAT moment, not from
// when the share began -- a two-hour stream must not close one minute
// after it ends.
func TestIdleClockStartsWhenTheShareStops(t *testing.T) {
	clk := &fakeClock{at: time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)}
	reg := &Registry{rooms: make(map[string]*Room), now: clk.Now}
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	sharer := NewPeer("p1", "Quem compartilha")
	room.Join(sharer)
	room.SetPublishing(sharer, true)

	clk.advance(2 * time.Hour) // the share ran this long
	room.SetPublishing(sharer, false)

	// 14 minutes after the stop: still inside the window.
	clk.advance(14 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if msgs := drainPeer(t, sharer, 30*time.Millisecond); len(msgs) != 0 {
		t.Fatalf("idle was measured from the share's START, not its stop: %v", msgs)
	}

	// 16 minutes after the stop: warned.
	clk.advance(2 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if warn := firstOfType(drainPeer(t, sharer, 30*time.Millisecond), "room:closing"); warn == nil {
		t.Fatal("a room idle since its share stopped was never warned")
	}
}

// The warning is a promise the room can take back: one keepalive and
// the countdown is withdrawn for everyone and the room survives.
func TestKeepAliveWithdrawsTheClosing(t *testing.T) {
	clk := &fakeClock{at: time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)}
	reg := &Registry{rooms: make(map[string]*Room), now: clk.Now}
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	watcher := NewPeer("w1", "Assistente")
	room.Join(watcher)

	clk.advance(20 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if warn := firstOfType(drainPeer(t, watcher, 30*time.Millisecond), "room:closing"); warn == nil {
		t.Fatal("expected the warning first")
	}

	room.KeepAlive()
	cancelled := firstOfType(drainPeer(t, watcher, 30*time.Millisecond), "room:closing")
	if cancelled == nil || cancelled["closingAt"] != float64(0) {
		t.Fatalf("keepalive did not broadcast the withdrawal: %v", cancelled)
	}

	// The keepalive reset the WHOLE clock, not just postponed the
	// deadline: a full idle window after it, still nothing.
	clk.advance(14 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	if msgs := drainPeer(t, watcher, 30*time.Millisecond); len(msgs) != 0 {
		t.Fatalf("a kept-alive room was still warned or closed: %v", msgs)
	}
	if _, err := reg.Get(room.ID); err != nil {
		t.Fatal("a kept-alive room was deleted")
	}
}

// Someone publishing again during the warning window stands the
// warning down on the next sweep -- no keepalive required.
func TestPublishingAgainWithdrawsTheClosing(t *testing.T) {
	clk := &fakeClock{at: time.Date(2026, 9, 15, 14, 0, 0, 0, time.UTC)}
	reg := &Registry{rooms: make(map[string]*Room), now: clk.Now}
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	sharer := NewPeer("p1", "Quem compartilha")
	room.Join(sharer)

	clk.advance(20 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	drainPeer(t, sharer, 30*time.Millisecond) // the warning lands

	// They start sharing before the grace runs out.
	room.SetPublishing(sharer, true)
	clk.advance(2 * time.Minute)
	reg.SweepIdle(15*time.Minute, time.Minute)
	cancelled := firstOfType(drainPeer(t, sharer, 30*time.Millisecond), "room:closing")
	if cancelled == nil || cancelled["closingAt"] != float64(0) {
		t.Fatalf("publishing again did not withdraw the closing: %v", cancelled)
	}

	clk.advance(time.Hour)
	reg.SweepIdle(15*time.Minute, time.Minute)
	drainPeer(t, sharer, 30*time.Millisecond)
	if _, err := reg.Get(room.ID); err != nil {
		t.Fatal("a room that resumed publishing was closed anyway")
	}
}