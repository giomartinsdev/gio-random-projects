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
// touches this server -- it goes straight between browsers, so what
// scales with the number of streams is the browsers' upload, not
// anything here.
//
// Everyone in a room is the same kind of participant: the password is
// the only credential, and any peer may start publishing at any time
// while receiving whatever the others publish.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := strings.ToUpper(q.Get("room"))

	room, err := s.registry.Get(roomID)
	if err != nil {
		http.Error(w, rooms.ErrNotFound.Error(), http.StatusNotFound)
		return
	}

	// Authorised BEFORE the upgrade, so a failed attempt is a plain HTTP
	// status the browser can actually read.
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

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Same origin as the page itself -- this server serves the SPA
		// too, so there is no legitimate cross-origin client.
		OriginPatterns: []string{r.Host},
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)

	peerID, err := rooms.RandomID(16)
	if err != nil {
		_ = conn.Close(websocket.StatusInternalError, "erro interno")
		return
	}
	peer := rooms.NewPeer(peerID, room.NextName())
	existing := room.Join(peer)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go writeLoop(ctx, conn, peer)

	// Everyone already here, and which of them are publishing -- enough
	// for the newcomer to render the grid and know whose offer to expect.
	peer.Send(map[string]any{
		"type":   "welcome",
		"peerId": peerID,
		"name":   peer.Name,
		"roomId": room.ID,
		"peers":  existing,
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
			// are the browsers' business. It only checks the target is in
			// this room and stamps the real sender (see Room.Relay).
			room.Relay(peer, msg.To, msg.Payload)

		case "publish:start":
			room.SetPublishing(peer, true)

		case "publish:stop":
			room.SetPublishing(peer, false)

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
			// connection during a long, quiet share.
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

func init() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("[tela] ")
}
