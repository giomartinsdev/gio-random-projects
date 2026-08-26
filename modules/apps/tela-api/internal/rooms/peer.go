package rooms

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"
)

// Peer is one open WebSocket in a room. Everyone in a room is the same
// kind of participant: anyone may publish a stream at any time, and
// everyone receives whatever the others are publishing. There is no
// host.
type Peer struct {
	ID   string
	Name string

	// Buffered so a slow reader can't block whoever is sending. Filling
	// it means that peer is too far behind to keep up, and its messages
	// get dropped rather than stalling the room -- see Send.
	send   chan []byte
	closed chan struct{}

	// Guarded by the owning Room's mutex.
	publishing bool
}

// PeerInfo is the public view of a peer: what everyone else is told
// about it.
type PeerInfo struct {
	ID         string `json:"peerId"`
	Name       string `json:"name"`
	Publishing bool   `json:"publishing"`
}

const sendBuffer = 32

func NewPeer(id, name string) *Peer {
	return &Peer{
		ID:     id,
		Name:   name,
		send:   make(chan []byte, sendBuffer),
		closed: make(chan struct{}),
	}
}

// Outgoing is what the WebSocket write loop ranges over.
func (p *Peer) Outgoing() <-chan []byte { return p.send }

// Send queues a message, dropping it if this peer's buffer is full.
// Losing a signalling message is survivable -- that one peer connection
// fails and can be retried -- while blocking the room on one stuck
// client is not.
func (p *Peer) Send(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case p.send <- data:
	case <-p.closed:
	default:
	}
}

// Close is safe to call more than once -- both the read loop ending and
// an explicit teardown can reach it.
func (p *Peer) Close() {
	select {
	case <-p.closed:
		return
	default:
	}
	close(p.closed)
	close(p.send)
}

func (p *Peer) Done() <-chan struct{} { return p.closed }

// ResumeToken proves that whoever holds it was handed this exact peer
// identity by the server. It's an HMAC rather than stored state so it
// survives a restart without persisting anything per peer, and it
// covers the name as well as the id so a member can't come back
// wearing someone else's label.
//
// This is what makes a deploy invisible: a client that reconnects with
// its old identity slots back into the room, and nobody else sees it
// leave and rejoin -- so their peer connections, and the video already
// flowing over them, are left untouched.
func (room *Room) ResumeToken(peerID, name string) string {
	mac := hmac.New(sha256.New, room.resumeKey)
	mac.Write([]byte(peerID))
	mac.Write([]byte{0})
	mac.Write([]byte(name))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (room *Room) VerifyResume(peerID, name, token string) bool {
	if peerID == "" || token == "" {
		return false
	}
	expected := room.ResumeToken(peerID, name)
	return hmac.Equal([]byte(expected), []byte(token))
}

// TakeOver drops any connection still registered under this peer id.
// After a restart the old socket is already dead, but a flaky network
// can leave a stale one that the server hasn't noticed yet -- and two
// live sockets sharing an id would each receive half the signalling.
func (room *Room) TakeOver(peerID string) {
	room.mu.Lock()
	old := room.peers[peerID]
	if old != nil {
		delete(room.peers, peerID)
	}
	room.mu.Unlock()

	if old != nil {
		old.Close()
	}
}

// Join adds a peer and returns everyone already in the room, so the
// newcomer immediately knows who is here and who is currently
// publishing (and can therefore expect an offer from them).
func (room *Room) Join(p *Peer) []PeerInfo {
	room.mu.Lock()
	existing := room.peerInfosLocked()
	room.peers[p.ID] = p
	room.emptyAt = time.Time{}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	room.Broadcast(map[string]any{"type": "peer:join", "peerId": p.ID, "name": p.Name}, p.ID)
	return existing
}

func (room *Room) Leave(p *Peer) {
	room.mu.Lock()
	delete(room.peers, p.ID)
	if len(room.peers) == 0 {
		room.emptyAt = time.Now()
	}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	// Everyone else tears down both directions of their connection with
	// this peer -- see the client's useRoom.
	room.Broadcast(map[string]any{"type": "peer:leave", "peerId": p.ID}, p.ID)
}

// SetPublishing records that a peer started or stopped sharing and
// tells everyone else. Publishing is announced rather than inferred so
// a viewer knows to expect an offer (or to drop a tile) without
// waiting on WebRTC state.
func (room *Room) SetPublishing(p *Peer, publishing bool) {
	room.mu.Lock()
	if peer, ok := room.peers[p.ID]; ok {
		peer.publishing = publishing
	}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	event := "publish:stop"
	if publishing {
		event = "publish:start"
	}
	room.Broadcast(map[string]any{"type": event, "peerId": p.ID}, p.ID)
}

// Relay hands one peer's signalling payload to another peer in the same
// room. With everyone able to publish, any pair may legitimately need
// to talk -- so the check is simply "is the target in this room", and
// `from` is always the server's own idea of who sent it rather than
// anything the client claimed.
func (room *Room) Relay(from *Peer, to string, payload json.RawMessage) {
	room.mu.Lock()
	target := room.peers[to]
	room.lastSeen = time.Now()
	room.mu.Unlock()

	if target == nil || target.ID == from.ID {
		return
	}
	target.Send(map[string]any{"type": "signal", "from": from.ID, "payload": payload})
}

// Broadcast sends to everyone except excludeID (pass "" to include
// everyone).
func (room *Room) Broadcast(v any, excludeID string) {
	room.mu.Lock()
	targets := make([]*Peer, 0, len(room.peers))
	for id, p := range room.peers {
		if id == excludeID {
			continue
		}
		targets = append(targets, p)
	}
	room.mu.Unlock()

	for _, p := range targets {
		p.Send(v)
	}
}

func (room *Room) PeerInfos() []PeerInfo {
	room.mu.Lock()
	defer room.mu.Unlock()
	return room.peerInfosLocked()
}

func (room *Room) PeerCount() int {
	room.mu.Lock()
	defer room.mu.Unlock()
	return len(room.peers)
}

func (room *Room) PublisherCount() int {
	room.mu.Lock()
	defer room.mu.Unlock()
	n := 0
	for _, p := range room.peers {
		if p.publishing {
			n++
		}
	}
	return n
}

// NextName hands out "Pessoa 1", "Pessoa 2", … in join order. Nobody
// signs in, but a grid of streams is unreadable without some label to
// tell the tiles apart. Numbers keep climbing rather than being reused,
// so two people who join and leave don't end up sharing a name.
func (room *Room) NextName() string {
	room.mu.Lock()
	defer room.mu.Unlock()
	room.nextLabel++
	return "Pessoa " + strconv.Itoa(room.nextLabel)
}

// Caller must hold room.mu.
func (room *Room) peerInfosLocked() []PeerInfo {
	out := make([]PeerInfo, 0, len(room.peers))
	for _, p := range room.peers {
		out = append(out, PeerInfo{ID: p.ID, Name: p.Name, Publishing: p.publishing})
	}
	return out
}
