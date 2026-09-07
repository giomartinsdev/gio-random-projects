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
// kind of participant: anyone may start a game, play cards and judge.
// There is no host.
type Peer struct {
	ID   string
	Name string

	// Buffered so a slow reader can't block whoever is sending. Filling
	// it means that peer is too far behind to keep up, and its messages
	// get dropped rather than stalling the room -- see Send.
	send   chan []byte
	closed chan struct{}
}

// PeerInfo is the public view of a peer: what everyone else is told
// about it.
type PeerInfo struct {
	ID   string `json:"peerId"`
	Name string `json:"name"`
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
// Losing a state update is survivable -- the next action broadcasts a
// fresh one -- while blocking the room on one stuck client is not.
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
// its old identity slots back into the room (and its game score), and
// nobody else sees it leave and rejoin.
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
// live sockets sharing an id would each receive half the state.
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
// newcomer immediately sees who is here. The game learns about the
// player too -- mid-game joins simply wait for the next round's deal.
func (room *Room) Join(p *Peer) []PeerInfo {
	room.mu.Lock()
	existing := room.peerInfosLocked()
	room.peers[p.ID] = p
	room.emptyAt = time.Time{}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	room.game.Join(p.ID, p.Name)
	room.Broadcast(map[string]any{"type": "peer:join", "peerId": p.ID, "name": p.Name}, p.ID)
	return existing
}

// Leave removes a peer and tells the game, which repairs whatever the
// round was doing when they vanished. The room-wide state broadcast
// happens in the WebSocket handler either way.
func (room *Room) Leave(p *Peer) {
	room.mu.Lock()
	delete(room.peers, p.ID)
	if len(room.peers) == 0 {
		room.emptyAt = time.Now()
	}
	room.lastSeen = time.Now()
	room.mu.Unlock()

	room.game.Leave(p.ID)
	room.Broadcast(map[string]any{"type": "peer:leave", "peerId": p.ID}, p.ID)
}

// RenamePeer changes a peer's display name -- in the room's peer list,
// in the game's scoreboard, and in their own resume token, which signs
// the name and would stop verifying otherwise. So the fresh token goes
// to the renamer privately (their reconnect depends on it) while the
// rename itself is broadcast for everyone else's peer list; the state
// broadcast right after carries the new name in the scoreboard.
func (room *Room) RenamePeer(p *Peer, name string) {
	room.mu.Lock()
	if p.Name == name {
		room.mu.Unlock()
		return
	}
	p.Name = name
	room.mu.Unlock()

	room.game.RenamePlayer(p.ID, name)
	room.Broadcast(map[string]any{"type": "peer:rename", "peerId": p.ID, "name": name}, p.ID)
	p.Send(map[string]any{"type": "renamed", "peerId": p.ID, "name": name, "resume": room.ResumeToken(p.ID, name)})
	room.BroadcastGameState()
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

// BroadcastGameState sends every connected peer their own copy of the
// game state plus their own hand. The state is deliberately
// per-recipient: other players' hands and submission authorship while
// judging simply never leave the server for the wrong person.
func (room *Room) BroadcastGameState() {
	room.mu.Lock()
	targets := make([]*Peer, 0, len(room.peers))
	for _, p := range room.peers {
		targets = append(targets, p)
	}
	room.mu.Unlock()

	for _, p := range targets {
		p.Send(map[string]any{"type": "state", "state": room.game.Snapshot(p.ID)})
		p.Send(map[string]any{"type": "hand", "cards": room.game.Hand(p.ID)})
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

// NextName hands out "Pessoa 1", "Pessoa 2", … in join order. Nobody
// signs in, but a scoreboard is unreadable without some label to tell
// the entries apart. Numbers keep climbing rather than being reused,
// so two people who join and leave don't end up sharing a name.
func (room *Room) NextName() string {
	room.mu.Lock()
	defer room.mu.Unlock()
	room.nextLabel++
	return "Pessoa " + strconv.Itoa(room.nextLabel)
}

// randomNameAttempts is how many distinct random words get tried
// before giving up on uniqueness and falling back to NextName --
// enough that a normal-sized room essentially never exhausts it,
// small enough that a pathological room full of bots can't turn this
// into a long loop.
const randomNameAttempts = 20

// RandomName picks a small, non-person Portuguese word for whoever
// didn't type a display name of their own -- "Abacate", not "Pessoa
// 3". It avoids whatever anyone currently in the room is already
// called, so two people don't end up as visually-identical names; if
// every attempt collides it falls back to the numbered scheme instead
// of looping forever. Same wordlist and reasoning as tela's rooms.
func (room *Room) RandomName() (string, error) {
	room.mu.Lock()
	taken := make(map[string]bool, len(room.peers))
	for _, p := range room.peers {
		taken[p.Name] = true
	}
	room.mu.Unlock()

	for i := 0; i < randomNameAttempts; i++ {
		w, err := randomWord()
		if err != nil {
			return "", err
		}
		name := capitalize(w)
		if !taken[name] {
			return name, nil
		}
	}
	return room.NextName(), nil
}

// Caller must hold room.mu.
func (room *Room) peerInfosLocked() []PeerInfo {
	out := make([]PeerInfo, 0, len(room.peers))
	for _, p := range room.peers {
		out = append(out, PeerInfo{ID: p.ID, Name: p.Name})
	}
	return out
}