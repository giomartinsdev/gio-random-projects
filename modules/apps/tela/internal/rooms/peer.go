package rooms

import (
	"encoding/json"
	"time"
)

// Peer is one open WebSocket in a room. The server never looks inside
// the WebRTC payloads it moves between peers -- it only knows who is
// the host, who the viewers are, and how to hand a message from one to
// another.
type Peer struct {
	ID   string
	Role string // "host" or "viewer"

	// Buffered so a slow reader can't block the sender. Overflowing it
	// means that peer is too far behind to keep up, and it gets dropped
	// rather than stalling the room -- see Send.
	send   chan []byte
	closed chan struct{}
}

const sendBuffer = 32

func NewPeer(id, role string) *Peer {
	return &Peer{
		ID:     id,
		Role:   role,
		send:   make(chan []byte, sendBuffer),
		closed: make(chan struct{}),
	}
}

// Outgoing is what the WebSocket write loop ranges over.
func (p *Peer) Outgoing() <-chan []byte { return p.send }

// Send queues a message, dropping it if this peer's buffer is full.
// Losing a signalling message is survivable (the peer connection
// simply fails and the viewer can reload); blocking the whole room on
// one stuck client is not.
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

// Close is safe to call more than once -- both the read loop ending
// and an explicit room teardown can reach it.
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

// JoinAsHost claims the single host slot. A room has exactly one
// screen being shared, so a second host is refused rather than
// silently replacing the first.
func (room *Room) JoinAsHost(p *Peer) error {
	room.mu.Lock()
	if room.host != nil {
		room.mu.Unlock()
		return ErrHostTaken
	}
	room.host = p
	room.emptyAt = time.Time{}
	room.lastSeen = time.Now()
	viewers := room.viewerList()
	room.mu.Unlock()

	// The host needs to know who is already waiting so it can offer to
	// each of them immediately.
	for _, v := range viewers {
		p.Send(map[string]any{"type": "viewer:join", "peerId": v.ID})
	}
	room.broadcastToViewers(map[string]any{"type": "host:online"})
	return nil
}

func (room *Room) JoinAsViewer(p *Peer) {
	room.mu.Lock()
	room.viewers[p.ID] = p
	room.emptyAt = time.Time{}
	room.lastSeen = time.Now()
	host := room.host
	room.mu.Unlock()

	if host != nil {
		host.Send(map[string]any{"type": "viewer:join", "peerId": p.ID})
	}
}

// Leave removes a peer and tells whoever cares. When the host leaves,
// viewers are told explicitly instead of being left staring at a
// frozen last frame.
func (room *Room) Leave(p *Peer) {
	room.mu.Lock()
	var hostLeft bool
	if room.host == p {
		room.host = nil
		hostLeft = true
	} else {
		delete(room.viewers, p.ID)
	}
	host := room.host
	if room.host == nil && len(room.viewers) == 0 {
		room.emptyAt = time.Now()
	}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	if hostLeft {
		room.broadcastToViewers(map[string]any{"type": "host:offline"})
		return
	}
	if host != nil {
		host.Send(map[string]any{"type": "viewer:leave", "peerId": p.ID})
	}
}

// Relay hands one peer's signalling payload to exactly one other peer.
// Viewers may only ever talk to the host, and the host only to a
// viewer that's actually in this room -- so a viewer can't reach
// another viewer, and `from` is always the server's own idea of who
// sent it rather than anything the client claimed.
func (room *Room) Relay(from *Peer, to string, payload json.RawMessage) {
	room.mu.Lock()
	var target *Peer
	if from.Role == "host" {
		target = room.viewers[to]
	} else if room.host != nil && room.host.ID == to {
		target = room.host
	}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	if target == nil {
		return
	}
	target.Send(map[string]any{"type": "signal", "from": from.ID, "payload": payload})
}

func (room *Room) HasHost() bool {
	room.mu.Lock()
	defer room.mu.Unlock()
	return room.host != nil
}

func (room *Room) ViewerCount() int {
	room.mu.Lock()
	defer room.mu.Unlock()
	return len(room.viewers)
}

func (room *Room) broadcastToViewers(v any) {
	room.mu.Lock()
	viewers := room.viewerList()
	room.mu.Unlock()
	for _, p := range viewers {
		p.Send(v)
	}
}

// Caller must hold room.mu.
func (room *Room) viewerList() []*Peer {
	out := make([]*Peer, 0, len(room.viewers))
	for _, p := range room.viewers {
		out = append(out, p)
	}
	return out
}
