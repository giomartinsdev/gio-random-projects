package rooms

import (
	"crypto/subtle"
	"time"
)

// KnockStatus is where a request to enter without the password
// currently stands.
type KnockStatus string

const (
	KnockPending  KnockStatus = "pending"
	KnockApproved KnockStatus = "approved"
	KnockDenied   KnockStatus = "denied"
)

// Knock is one "let me in" request from someone who doesn't have the
// room's password. It's answered by whoever is already inside, over
// their own already-open WebSocket -- there's no separate auth for
// that, being in the room at all is the only credential a decision
// requires.
type Knock struct {
	ID     string      `json:"id"`
	Name   string      `json:"name"`
	Status KnockStatus `json:"status"`

	// Set once Status is KnockApproved. Unlike a resume token, this
	// isn't consumed on first use -- it works exactly like a personal,
	// temporary password for AdmitTokenTTL, so the approved person's
	// browser can reconnect (a network blip, a reload) without a
	// second knock. See CheckAdmitToken. Omitted whenever empty so a
	// pending request's broadcast never even has the field to notice.
	AdmitToken string    `json:"admitToken,omitempty"`
	ApprovedAt time.Time `json:"approvedAt,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

const (
	// How long an unanswered request stays visible before it's swept
	// away -- long enough that someone glancing at their phone still
	// catches it, short enough that a room's "who's waiting" list
	// doesn't fill up with requests everyone already forgot about.
	knockTTL = 2 * time.Minute

	// How long an approval keeps working as a stand-in password. Long
	// enough to outlast a reconnect or two during the same sitting,
	// short enough that it isn't a permanent backdoor.
	admitTokenTTL = 30 * time.Minute

	// Bounds the same kind of loop-until-unique abuse maxRooms guards
	// against, just for one room's own knock queue.
	maxKnocksPerRoom = 20
)

// Knock registers a request to enter without the password and tells
// everyone currently in the room about it (see Broadcast) -- any one
// of them approving or denying is enough, there's no quorum.
func (room *Room) Knock(name string) (*Knock, error) {
	room.mu.Lock()
	room.sweepKnocksLocked()
	if len(room.knocks) >= maxKnocksPerRoom {
		room.mu.Unlock()
		return nil, ErrTooManyKnocks
	}

	id, err := RandomID(12)
	if err != nil {
		room.mu.Unlock()
		return nil, err
	}
	k := &Knock{ID: id, Name: name, Status: KnockPending, CreatedAt: time.Now()}
	room.knocks[id] = k
	room.mu.Unlock()

	room.Broadcast(map[string]any{"type": "knock:request", "requestId": id, "name": name}, "")
	return k, nil
}

// KnockLookup reports where a request stands. The requester polls
// this instead of holding a connection open, so a slow -- or
// completely absent -- room full of people never blocks their own
// browser tab; see the frontend's Room.tsx knock lobby.
func (room *Room) KnockLookup(id string) (Knock, bool) {
	room.mu.Lock()
	defer room.mu.Unlock()
	room.sweepKnocksLocked()
	k, ok := room.knocks[id]
	if !ok {
		return Knock{}, false
	}
	return *k, true
}

// PendingKnocks lists every request still waiting on a decision --
// sent as part of `welcome` so someone joining mid-wait sees requests
// that were broadcast before they connected, not just new ones.
func (room *Room) PendingKnocks() []Knock {
	room.mu.Lock()
	defer room.mu.Unlock()
	room.sweepKnocksLocked()
	out := make([]Knock, 0, len(room.knocks))
	for _, k := range room.knocks {
		if k.Status == KnockPending {
			out = append(out, *k)
		}
	}
	return out
}

// ResolveKnock is how someone already in the room answers a request.
// Approving mints an admit token; denying just marks it so. Either
// way, everyone in the room (including whoever else was about to
// answer the same request) is told, so the banner disappears
// everywhere at once instead of staying stuck for anyone who didn't
// click first.
func (room *Room) ResolveKnock(id string, approve bool) bool {
	room.mu.Lock()
	k, ok := room.knocks[id]
	if !ok || k.Status != KnockPending {
		room.mu.Unlock()
		return false
	}
	if approve {
		k.Status = KnockApproved
		k.ApprovedAt = time.Now()
		if token, err := RandomID(24); err == nil {
			k.AdmitToken = token
		}
	} else {
		k.Status = KnockDenied
	}
	room.mu.Unlock()

	room.Broadcast(map[string]any{"type": "knock:resolved", "requestId": id, "approved": approve}, "")
	return true
}

// CheckAdmitToken is the WebSocket handshake's second way in, besides
// the password -- see httpapi's handleWS. Deliberately not one-time:
// unlike a resume token, an admit token stands in for "I don't know
// the password, someone let me in anyway" for its whole TTL, so the
// approved person's browser can reconnect on its own the same way a
// password holder's would.
func (room *Room) CheckAdmitToken(token string) (name string, ok bool) {
	if token == "" {
		return "", false
	}
	room.mu.Lock()
	defer room.mu.Unlock()
	for _, k := range room.knocks {
		if k.Status != KnockApproved || k.AdmitToken == "" {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(k.AdmitToken), []byte(token)) != 1 {
			continue
		}
		if time.Since(k.ApprovedAt) > admitTokenTTL {
			return "", false
		}
		return k.Name, true
	}
	return "", false
}

// sweepKnocksLocked drops requests nobody is going to act on anymore:
// a pending one that's simply too old, or an already-decided one past
// its admit token's own expiry. Caller must hold room.mu.
func (room *Room) sweepKnocksLocked() {
	now := time.Now()
	for id, k := range room.knocks {
		switch k.Status {
		case KnockPending:
			if now.Sub(k.CreatedAt) > knockTTL {
				delete(room.knocks, id)
			}
		default: // approved or denied
			if now.Sub(k.CreatedAt) > admitTokenTTL {
				delete(room.knocks, id)
			}
		}
	}
}
