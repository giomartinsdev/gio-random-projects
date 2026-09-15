package rooms

import (
	"time"
)

// A room where nobody has been publishing for a while is usually an
// oversight: the share ended, every tab is still open, and the room
// would otherwise linger until the twelve-hour ceiling collects it.
// The idle reaper gives such rooms a visible ending instead -- a
// warning with a countdown, one chance for whoever is still watching
// to keep the room open, and then closure for everyone.
//
// "Idle" is deliberately about publishing only. Any publish starting
// or stopping resets the clock (a fresh stop STARTS it -- that's the
// moment the room actually went quiet), and a watcher pressing the
// keep-alive button on the warning does too.
const (
	// How often the reaper looks. The closing deadline is honored
	// within one tick of this, so it must stay well under a realistic
	// grace period.
	idleReaperInterval = 10 * time.Second
)

// SweepIdle is one reaper pass over every room. Rooms currently
// publishing are untouched. A room idle for longer than `idle` gets
// one warning: a room:closing broadcast whose closingAt sits `grace`
// ahead. Once that deadline passes, the room is deleted and everyone
// gets a room:closed broadcast -- after which reconnects fail with a
// 404, which is how a client learns the room is really gone.
//
// Called on a ticker by StartIdleReaper, and directly by the tests
// with a fake clock and tiny durations.
func (r *Registry) SweepIdle(idle, grace time.Duration) {
	now := r.now()

	type action struct {
		room    *Room
		warnAt  time.Time
		cancel  bool
		expired bool
	}
	var actions []action
	removed := false

	r.mu.Lock()
	for id, room := range r.rooms {
		warnAt, cancel, expired := room.idleTick(now, idle, grace)
		if cancel || !warnAt.IsZero() || expired {
			actions = append(actions, action{room: room, warnAt: warnAt, cancel: cancel, expired: expired})
		}
		if expired {
			delete(r.rooms, id)
			removed = true
		}
	}
	r.mu.Unlock()

	// Broadcasts after r.mu is released: Broadcast re-locks room.mu,
	// and holding the registry-wide lock across every room's fan-out
	// would stall unrelated rooms for no gain (SetPublishing has the
	// same no-broadcast-under-lock rule).
	for _, a := range actions {
		if a.cancel {
			a.room.Broadcast(map[string]any{"type": "room:closing", "closingAt": 0}, "")
		}
		if !a.warnAt.IsZero() {
			a.room.Broadcast(map[string]any{"type": "room:closing", "closingAt": a.warnAt.UnixMilli()}, "")
		}
		if a.expired {
			a.room.Broadcast(map[string]any{"type": "room:closed", "reason": "idle"}, "")
		}
	}
	if removed {
		r.persist()
	}
}

// StartIdleReaper runs SweepIdle on a ticker until stop is closed.
// The idle and grace durations come from configuration (main.go) so a
// test can run this whole lifecycle in milliseconds.
func (r *Registry) StartIdleReaper(stop <-chan struct{}, idle, grace time.Duration) {
	go func() {
		ticker := time.NewTicker(idleReaperInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.SweepIdle(idle, grace)
			case <-stop:
				return
			}
		}
	}()
}

// idleTick advances one room's idle lifecycle. Caller holds r.mu; the
// room's own mutex is taken here. Returns:
//
//	warnAt  -- non-zero when this pass ISSUES a closing warning
//	cancel  -- when a pending warning was withdrawn (publishers came
//	           back, or the clock was reset underneath it)
//	expired -- when the warned deadline has passed: delete the room
func (room *Room) idleTick(now time.Time, idle, grace time.Duration) (warnAt time.Time, cancel, expired bool) {
	room.mu.Lock()
	defer room.mu.Unlock()

	if room.publisherCountLocked() > 0 {
		// Someone is publishing -- by definition not idle. Any warning
		// still standing is withdrawn.
		if room.closingAt.IsZero() {
			return time.Time{}, false, false
		}
		room.closingAt = time.Time{}
		return time.Time{}, true, false
	}

	since := room.lastPublishChange
	if since.IsZero() {
		// A room restored from disk has no recorded change; its idle
		// clock started when it was created.
		since = room.CreatedAt
	}
	if now.Sub(since) <= idle {
		// Not idle (yet). A keepalive between sweeps lands here too,
		// clearing a warning without a fan-out -- the warning's own
		// broadcast already told the clients, but the cleared state has
		// to survive until the deadline would have passed.
		if room.closingAt.IsZero() {
			return time.Time{}, false, false
		}
		room.closingAt = time.Time{}
		return time.Time{}, true, false
	}

	if room.closingAt.IsZero() {
		room.closingAt = now.Add(grace)
		return room.closingAt, false, false
	}
	if now.Before(room.closingAt) {
		return time.Time{}, false, false // warning still on the clock
	}
	return time.Time{}, false, true // the warned deadline has passed
}

// KeepAlive records that someone still in the room wants it open --
// the button on the closing warning. Resets the idle clock and
// withdraws any pending closing broadcast (closingAt 0, which the
// client reads as "stand down").
func (room *Room) KeepAlive() {
	room.mu.Lock()
	room.lastPublishChange = room.clock()
	cancel := !room.closingAt.IsZero()
	room.closingAt = time.Time{}
	room.mu.Unlock()

	if cancel {
		room.Broadcast(map[string]any{"type": "room:closing", "closingAt": 0}, "")
	}
}

// ClosingAtMillis is the pending closing deadline in unix millis, or 0
// when none. The welcome message carries it so a client that
// reconnects while a warning is up still sees the countdown instead of
// being surprised by the closure.
func (room *Room) ClosingAtMillis() int64 {
	room.mu.Lock()
	defer room.mu.Unlock()
	if room.closingAt.IsZero() {
		return 0
	}
	return room.closingAt.UnixMilli()
}

// Caller holds room.mu.
func (room *Room) publisherCountLocked() int {
	n := 0
	for _, p := range room.peers {
		if p.publishing {
			n++
		}
	}
	return n
}

func (room *Room) clock() time.Time {
	if room.now != nil {
		return room.now()
	}
	return time.Now()
}