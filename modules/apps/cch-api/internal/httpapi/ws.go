package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/game"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/rooms"
)

const (
	// A play carries card ids plus optional write-your-own text -- a few
	// KB at most.
	maxMessageBytes = 256 * 1024
	writeTimeout    = 10 * time.Second
	pingInterval    = 30 * time.Second
)

type clientMessage struct {
	Type string `json:"type"`

	// game:start
	Decks        []string `json:"decks,omitempty"`
	WinningScore int      `json:"winningScore,omitempty"`

	// card:submit
	Plays []struct {
		CardID string `json:"cardId"`
		Text   string `json:"text,omitempty"`
	} `json:"plays,omitempty"`

	// card:discard / card:pick / knock:approve / knock:deny
	CardID       string `json:"cardId,omitempty"`
	SubmissionID string `json:"submissionId,omitempty"`
	RequestID    string `json:"requestId,omitempty"`

	// name:set
	Name string `json:"name,omitempty"`
}

// The WebSocket carries the game itself: state snapshots per recipient,
// hands, and the small set of actions a player can take. There is no
// media here -- the state machine lives in internal/game and every
// successful action ends with a fresh broadcast to the whole room.
//
// Everyone in a room is the same kind of participant: the password (or
// an approved knock) is the only credential, and any peer may start a
// game, play and judge.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := strings.ToLower(q.Get("room"))

	room, err := s.registry.Get(roomID)
	if err != nil {
		http.Error(w, rooms.ErrNotFound.Error(), http.StatusNotFound)
		return
	}

	// Authorised BEFORE the upgrade, so a failed attempt is a plain HTTP
	// status the browser can actually read. Two independent ways in: the
	// password, or an admit token from an approved knock (see
	// rooms/knock.go) -- either is sufficient, neither is required.
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		http.Error(w, "muitas tentativas", http.StatusTooManyRequests)
		return
	}
	knockName, admitted := room.CheckAdmitToken(q.Get("admitToken"))
	if !admitted && !room.CheckPassword(q.Get("password")) {
		s.limiter.fail(ip)
		http.Error(w, rooms.ErrWrongSecret.Error(), http.StatusUnauthorized)
		return
	}
	s.limiter.reset(ip)

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// cch-frontend is a separate origin (own hostname, served from
		// MinIO) -- r.Host is THIS server's own host, which would reject
		// every real connection. OriginPatterns wants host[:port] without
		// a scheme, hence the TrimPrefix below.
		OriginPatterns: trimSchemes(s.AllowedOrigins),
	})
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)

	// Resuming: a client that was here before presents the identity the
	// server gave it, plus the token proving the server gave it. Keeping
	// the same id across a reconnect is what keeps a player's identity
	// (name, score, slot in the czar rotation) intact in two different
	// ways:
	//
	//   - the whole server restarting: everyone reconnects and rebuilds
	//     from `welcome`, and because the ids match what they already
	//     have, nobody drops off the scoreboard;
	//   - one client's network blipping: the others do see it leave and
	//     rejoin, but under the same id, so a resumed player keeps their
	//     hand and their place in the round.
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
		// instead of leaving the scoreboard unlabeled. Someone admitted
		// via a knock already gave a name when they asked to enter,
		// which takes priority over a same-request "name" query param.
		switch {
		case knockName != "":
			name = knockName
		case sanitizeName(name) != "":
			name = sanitizeName(name)
		default:
			name, err = room.RandomName()
			if err != nil {
				_ = conn.Close(websocket.StatusInternalError, "erro interno")
				return
			}
		}
	} else {
		// A stale socket under this id would otherwise split the game
		// between two connections.
		room.TakeOver(peerID)
	}

	peer := rooms.NewPeer(peerID, name)
	existing := room.Join(peer)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go writeLoop(ctx, conn, peer)

	// Everyone already here, plus this player's own copy of the state
	// and their hand -- enough to render the room on arrival without a
	// round trip.
	peer.Send(map[string]any{
		"type":   "welcome",
		"peerId": peerID,
		"name":   peer.Name,
		"roomId": room.ID,
		"peers":  existing,
		// Kept by the client and presented on reconnect (see above).
		"resume": room.ResumeToken(peerID, peer.Name),
		// Requests broadcast before this connection existed would
		// otherwise never reach it -- someone joining mid-wait still
		// needs to see (and be able to answer) a knock already in
		// flight.
		"pendingKnocks": room.PendingKnocks(),
		"state":         room.Game().Snapshot(peerID),
	})
	peer.Send(map[string]any{"type": "hand", "cards": room.Game().Hand(peerID)})

	session := &wsSession{server: s, room: room, peer: peer}
	session.readLoop(ctx, conn)

	room.Leave(peer)
	peer.Close()
	_ = conn.Close(websocket.StatusNormalClosure, "")
}

// wsSession is one person's connection.
type wsSession struct {
	server *Server
	room   *rooms.Room
	peer   *rooms.Peer
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

		// Every game action runs the same shape: mutate the game, then
		// broadcast fresh state to everyone. A rejected action gets a
		// per-connection error message and no broadcast at all -- the
		// room never churns because one client sent something stale.
		switch msg.Type {
		case "game:start":
			if err := w.room.Game().Start(w.peer.ID, msg.Decks, msg.WinningScore); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "card:submit":
			plays := make([]game.Play, len(msg.Plays))
			for i, p := range msg.Plays {
				plays[i] = game.Play{CardID: p.CardID, Text: p.Text}
			}
			if err := w.room.Game().Submit(w.peer.ID, plays); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "card:discard":
			if err := w.room.Game().Discard(w.peer.ID, msg.CardID); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "card:pick":
			if err := w.room.Game().Pick(w.peer.ID, msg.SubmissionID); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "round:next":
			if err := w.room.Game().Next(w.peer.ID); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "round:skip":
			if err := w.room.Game().Skip(w.peer.ID); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "game:reset":
			if err := w.room.Game().Reset(w.peer.ID); err != nil {
				w.fail(err)
				continue
			}
			w.room.BroadcastGameState()

		case "name:set":
			// A rename is broadcast even outside a game -- the lobby list
			// and the knocks' name badges show it too. An empty result
			// means nothing usable was sent; that's a rejected action,
			// not a reset to a random name.
			name := sanitizeName(msg.Name)
			if name == "" {
				w.fail(ErrEmptyName)
				continue
			}
			w.room.RenamePeer(w.peer, name)

		case "ping":
			w.peer.Send(map[string]any{"type": "pong"})

		// Anyone currently in the room may answer a knock -- there's no
		// host, so this is deliberately not restricted to whoever
		// happens to click first.
		case "knock:approve":
			w.room.ResolveKnock(msg.RequestID, true)

		case "knock:deny":
			w.room.ResolveKnock(msg.RequestID, false)
		}
	}
}

// fail reports a rejected action back to the one client that sent it.
// The message is the game's own error text -- already written to be
// shown to a player verbatim.
func (w *wsSession) fail(err error) {
	w.peer.Send(map[string]any{"type": "error", "message": err.Error()})
}

const maxNameLength = 30

// ErrEmptyName is what a rename with nothing left after trimming gets
// back. Renaming is always optional, so an empty field never means
// "give me a random name" -- that reading would silently change
// someone's label in a room where everyone already knows them.
var ErrEmptyName = errors.New("digite um nome para salvar")

// sanitizeName trims a client-supplied display name and bounds its
// length -- someone typing a paragraph into the name field shouldn't
// get to stretch every scoreboard entry. An empty result (nothing
// typed, or nothing left after trimming whitespace) means "no
// preference"; the caller falls back to a random word instead.
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
			// connection during a long, quiet lobby.
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

// coder/websocket's OriginPatterns matches host[:port], no scheme --
// AllowedOrigins is configured as full origins (https://cch.giomartins.dev)
// since that's also what the CORS Access-Control-Allow-Origin header
// needs verbatim.
func trimSchemes(origins []string) []string {
	out := make([]string, len(origins))
	for i, o := range origins {
		out[i] = strings.TrimPrefix(strings.TrimPrefix(o, "https://"), "http://")
	}
	return out
}