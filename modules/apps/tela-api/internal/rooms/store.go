package rooms

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// Rooms survive a restart of this process, so a deploy doesn't throw
// everyone out of a session that's in progress. Only the room itself is
// persisted -- code, password hash and resume key. Who is connected is
// deliberately NOT persisted: those are live WebSockets that die with
// the process anyway, and every client reconnects and re-announces
// itself (see the client's useRoom).
//
// A restored room comes back empty, which starts its normal
// empty-room grace period -- long enough for everyone to reconnect,
// short enough that a room nobody returns to still gets collected.
type persistedRoom struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	Salt      []byte    `json:"salt"`
	Hash      []byte    `json:"hash"`
	ResumeKey []byte    `json:"resumeKey"`
}

// Load reads the room file, if there is one. A missing file is not an
// error: that's simply the first boot, or a fresh volume.
func (r *Registry) Load() error {
	if r.path == "" {
		return nil
	}
	data, err := os.ReadFile(r.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var stored []persistedRoom
	if err := json.Unmarshal(data, &stored); err != nil {
		// A corrupt file shouldn't stop the service from starting --
		// losing rooms is bad, refusing to boot is worse.
		return err
	}

	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, p := range stored {
		if now.Sub(p.CreatedAt) > maxRoomAge {
			continue // would be swept immediately anyway
		}
		r.rooms[p.ID] = &Room{
			ID:        p.ID,
			CreatedAt: p.CreatedAt,
			salt:      p.Salt,
			hash:      p.Hash,
			resumeKey: p.ResumeKey,
			peers:     make(map[string]*Peer),
			knocks:    make(map[string]*Knock),
			emptyAt:   now,
			lastSeen:  now,
		}
	}
	return nil
}

// persist writes the whole set of rooms. It's called on create and
// after a sweep -- both rare -- and the file is tiny (a few hundred
// bytes per room, capped at maxRooms), so rewriting all of it is
// simpler than tracking deltas and is not worth optimising.
//
// Caller must NOT hold r.mu.
func (r *Registry) persist() {
	if r.path == "" {
		return
	}

	r.mu.Lock()
	stored := make([]persistedRoom, 0, len(r.rooms))
	for _, room := range r.rooms {
		stored = append(stored, persistedRoom{
			ID:        room.ID,
			CreatedAt: room.CreatedAt,
			Salt:      room.salt,
			Hash:      room.hash,
			ResumeKey: room.resumeKey,
		})
	}
	r.mu.Unlock()

	data, err := json.Marshal(stored)
	if err != nil {
		return
	}

	// Write-then-rename: a crash mid-write leaves the previous file
	// intact rather than a truncated one that fails to parse on boot.
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, r.path)
}
