package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
)

const (
	// Signalling messages are SDP offers/answers -- a few KB at most.
	maxMessageBytes = 256 * 1024
	writeTimeout    = 10 * time.Second
	pingInterval    = 30 * time.Second
)

type clientMessage struct {
	Type    string          `json:"type"`
	To      string          `json:"to"`
	Payload json.RawMessage `json:"payload"`
}

// The WebSocket carries nothing but WebRTC signalling. Video never
// touches this server -- it goes straight between browsers, so the
// only thing here that scales with people watching is one small
// message queue each.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := strings.ToUpper(q.Get("room"))
	role := q.Get("role")

	room, err := s.registry.Get(roomID)
	if err != nil {
		http.Error(w, rooms.ErrNotFound.Error(), http.StatusNotFound)
		return
	}

	// Authorised BEFORE the upgrade, so a failed attempt is a plain
	// HTTP status the browser can actually read.
	switch role {
	case "host":
		if !room.CheckHostToken(q.Get("token")) {
			http.Error(w, "token de host inválido", http.StatusUnauthorized)
			return
		}
	case "viewer":
		ip := clientIP(r)
		if !s.limiter.allow(ip) {
			http.Error(w, "muitas tentativas", http.StatusTooManyRequests)
			return
		}
		if !room.CheckPassword(q.Get("password")) {
			s.limiter.fail(ip)
			http.Error(w, rooms.ErrWrongSecret.Error(), http.StatusUnauthorized)
			return
		}
		s.limiter.reset(ip)
	default:
		http.Error(w, "role inválido", http.StatusBadRequest)
		return
	}

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Same origin as the page itself -- this server serves the SPA
		// too, so there is no legitimate cross-origin client.
		OriginPatterns: []string{r.Host},
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)

	peerID, err := newPeerID()
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "erro interno")
		return
	}
	peer := rooms.NewPeer(peerID, role)

	if role == "host" {
		if err := room.JoinAsHost(peer); err != nil {
			// Someone is already sharing. Closed with a specific code so
			// the UI can say so instead of showing a generic drop.
			_ = conn.Close(websocket.StatusPolicyViolation, rooms.ErrHostTaken.Error())
			return
		}
	} else {
		room.JoinAsViewer(peer)
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go writeLoop(ctx, conn, peer)

	peer.Send(map[string]any{
		"type":       "welcome",
		"peerId":     peerID,
		"role":       role,
		"roomId":     room.ID,
		"hostOnline": room.HasHost(),
	})

	readLoop(ctx, conn, room, peer)

	room.Leave(peer)
	peer.Close()
	_ = conn.Close(websocket.StatusNormalClosure, "")
}

func readLoop(ctx context.Context, conn *websocket.Conn, room *rooms.Room, peer *rooms.Peer) {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}

		var msg clientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue // ignore junk rather than dropping the connection
		}

		switch msg.Type {
		case "signal":
			if msg.To == "" || len(msg.Payload) == 0 {
				continue
			}
			// The server has no idea what's inside Payload -- SDP and ICE
			// are the browsers' business. It only decides who is allowed
			// to receive it (see Room.Relay).
			room.Relay(peer, msg.To, msg.Payload)
		case "ping":
			peer.Send(map[string]any{"type": "pong"})
		}
	}
}

func writeLoop(ctx context.Context, conn *websocket.Conn, peer *rooms.Peer) {
	ticker := time.NewTicker(pingInterval)
	defer ticker.Stop()

	for {
		select {
		case data, ok := <-peer.Outgoing():
			if !ok {
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Write(writeCtx, websocket.MessageText, data)
			cancel()
			if err != nil {
				return
			}
		case <-ticker.C:
			// Keeps the tunnel and any intermediary from reaping an idle
			// connection during a long, quiet screen share.
			pingCtx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		case <-ctx.Done():
			return
		case <-peer.Done():
			return
		}
	}
}

func newPeerID() (string, error) {
	return rooms.RandomID(16)
}

func init() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[tela] ")
}
