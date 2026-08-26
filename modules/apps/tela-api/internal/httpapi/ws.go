package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/sfu"
)

const (
	// Signalling messages are SDP offers/answers -- a few KB at most.
	maxMessageBytes = 256 * 1024
	writeTimeout    = 10 * time.Second
	pingInterval    = 30 * time.Second
)

type clientMessage struct {
	Type      string                     `json:"type"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
}

// The WebSocket carries signalling only; the media itself rides the
// SFU's own UDP connections (internal/sfu).
//
// Each person has up to two peer connections with the server: one
// publishing, created when they start sharing, and one subscribing,
// opened as soon as they join so anything already being shared reaches
// them immediately. That's a fixed cost per person no matter how many
// people are watching -- the mesh this replaced made whoever shared
// encode once per viewer.
//
// Everyone in a room is the same kind of participant: the password is
// the only credential, and any peer may start publishing at any time
// while receiving whatever the others publish.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := strings.ToLower(q.Get("room"))

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
		// tela-frontend is a separate origin now (its own container,
		// its own hostname) -- r.Host is THIS server's own host, which
		// would reject every real connection. OriginPatterns wants
		// host[:port] without a scheme, hence the TrimPrefix below.
		OriginPatterns: trimSchemes(s.AllowedOrigins),
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)

	// Resuming: a client that was here before presents the identity the
	// server gave it, plus the token proving the server gave it. Keeping
	// the same id across a reconnect is what lets peer connections (and
	// the video already flowing over them) survive, in two different
	// ways:
	//
	//   - the whole server restarting: everyone reconnects and rebuilds
	//     from `welcome`, and because the ids match what they already
	//     have, nothing is torn down and nothing is re-offered;
	//   - one client's network blipping: the others do see it leave and
	//     rejoin, but under the same id, so the grace period on the
	//     client side cancels the pending teardown instead of dropping
	//     the stream.
	//
	// An id alone would be enough to impersonate another member of the
	// room, which is why the token is required rather than trusted.
	peerID := q.Get("peerId")
	name := q.Get("name")
	if !room.VerifyResume(peerID, name, q.Get("resume")) {
		peerID, err = rooms.RandomID(16)
		if err != nil {
			_ = conn.Close(websocket.StatusInternalError, "erro interno")
			return
		}
		// A fresh join may bring its own display name (the "name" query
		// param doubles as both "the name a resume token was signed
		// with" above and "the name this new person typed" here) --
		// honour it if given, otherwise hand out a small random word
		// instead of leaving the tile unlabeled.
		if chosen := sanitizeName(name); chosen != "" {
			name = chosen
		} else {
			name, err = room.RandomName()
			if err != nil {
				_ = conn.Close(websocket.StatusInternalError, "erro interno")
				return
			}
		}
	} else {
		// A stale socket under this id would otherwise split the
		// signalling between two connections.
		room.TakeOver(peerID)
	}

	peer := rooms.NewPeer(peerID, name)
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
		// Kept by the client and presented on reconnect (see above).
		"resume": room.ResumeToken(peerID, peer.Name),
	})

	// Subscribing from the moment they join means whatever is already
	// being shared reaches them without waiting for the next change.
	var subscriber *sfu.Subscriber
	if s.sfu != nil {
		subscriber, err = s.sfu.Subscribe(room.ID, peerID,
			func(c webrtc.ICECandidateInit) {
				peer.Send(map[string]any{"type": "subscribe:ice", "candidate": c})
			},
			func(offer webrtc.SessionDescription) {
				peer.Send(map[string]any{"type": "subscribe:offer", "sdp": offer})
			},
		)
		if err != nil {
			log.Printf("subscribe failed for %s in %s: %v", peerID, room.ID, err)
		}
	}

	session := &wsSession{server: s, room: room, peer: peer, subscriber: subscriber}
	session.readLoop(ctx, conn)

	session.close()
	room.Leave(peer)
	peer.Close()
	_ = conn.Close(websocket.StatusNormalClosure, "")
}

// wsSession is one person's connection: the signalling socket plus the
// two media connections hanging off it.
type wsSession struct {
	server     *Server
	room       *rooms.Room
	peer       *rooms.Peer
	subscriber *sfu.Subscriber
	publisher  *sfu.Publisher
}

func (w *wsSession) close() {
	if w.publisher != nil {
		w.publisher.Close()
	}
	if w.subscriber != nil {
		w.subscriber.Close()
	}
}

// stopPublishing tears down the send side without touching the receive
// side -- someone who stops sharing keeps watching.
func (w *wsSession) stopPublishing() {
	if w.publisher != nil {
		w.publisher.Close()
		w.publisher = nil
	}
	w.room.SetPublishing(w.peer, false)
}

func (w *wsSession) readLoop(ctx context.Context, conn *websocket.Conn) {
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
		// Starting to share. The browser offers because it's the one
		// that knows what it's about to send.
		case "publish:offer":
			w.handlePublishOffer(msg)

		case "publish:ice":
			if msg.Candidate != nil && w.publisher != nil {
				_ = w.publisher.AddICECandidate(*msg.Candidate)
			}

		case "publish:stop":
			w.stopPublishing()

		// The reply to an offer the server made (see sfu.Subscriber:
		// the server offers on the receive side, because tracks come and
		// go as people start and stop sharing).
		case "subscribe:answer":
			if msg.SDP != nil && w.subscriber != nil {
				if err := w.subscriber.Answer(*msg.SDP); err != nil {
					log.Printf("subscribe answer from %s: %v", w.peer.ID, err)
				}
			}

		case "subscribe:ice":
			if msg.Candidate != nil && w.subscriber != nil {
				_ = w.subscriber.AddICECandidate(*msg.Candidate)
			}

		case "ping":
			w.peer.Send(map[string]any{"type": "pong"})
		}
	}
}

func (w *wsSession) handlePublishOffer(msg clientMessage) {
	if msg.SDP == nil {
		return
	}
	if w.server.sfu == nil {
		w.peer.Send(map[string]any{"type": "publish:error", "error": "servidor sem SFU configurado"})
		return
	}
	// Re-publishing (switching from screen to camera, say) replaces the
	// previous connection rather than stacking a second one.
	if w.publisher != nil {
		w.publisher.Close()
		w.publisher = nil
	}

	publisher, answer, err := w.server.sfu.Publish(w.room.ID, w.peer.ID, *msg.SDP,
		func(c webrtc.ICECandidateInit) {
			w.peer.Send(map[string]any{"type": "publish:ice", "candidate": c})
		},
	)
	if err != nil {
		log.Printf("publish failed for %s in %s: %v", w.peer.ID, w.room.ID, err)
		w.peer.Send(map[string]any{"type": "publish:error", "error": "não foi possível iniciar a transmissão"})
		return
	}

	w.publisher = publisher
	w.peer.Send(map[string]any{"type": "publish:answer", "sdp": answer})
	// Announced separately from the media so the grid can show someone
	// as sharing while their connection is still negotiating.
	w.room.SetPublishing(w.peer, true)
}

const maxNameLength = 30

// sanitizeName trims a client-supplied display name and bounds its
// length -- someone typing a paragraph into the name field shouldn't
// get to stretch every tile's label. An empty result (nothing typed,
// or nothing left after trimming whitespace) means "no preference";
// the caller falls back to a random word instead.
func sanitizeName(raw string) string {
	name := strings.TrimSpace(raw)
	if name == "" {
		return ""
	}
	// Runes, not bytes -- truncating must not land inside a multi-byte
	// character (an accented letter, an emoji).
	r := []rune(name)
	if len(r) > maxNameLength {
		r = r[:maxNameLength]
	}
	return string(r)
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
	log.SetPrefix("[tela-api] ")
}

// coder/websocket's OriginPatterns matches host[:port], no scheme --
// AllowedOrigins is configured as full origins (https://tela.giomartins.dev)
// since that's also what the CORS Access-Control-Allow-Origin header
// needs verbatim.
func trimSchemes(origins []string) []string {
	out := make([]string, len(origins))
	for i, o := range origins {
		out[i] = strings.TrimPrefix(strings.TrimPrefix(o, "https://"), "http://")
	}
	return out
}
