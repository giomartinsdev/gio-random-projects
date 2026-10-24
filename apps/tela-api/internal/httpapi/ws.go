package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/mediamtx"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

const (
	// Signalling messages are SDP offers/answers -- a few KB at most.
	maxMessageBytes = 256 * 1024
	// An SDP larger than this is not a real offer; refusing early keeps a
	// hostile client from forwarding megabytes to MediaMTX.
	maxSDPBytes  = 200 * 1024
	writeTimeout = 10 * time.Second
	pingInterval = 30 * time.Second
)

type clientMessage struct {
	Type string `json:"type"`
	// Raw SDP for a publish or subscribe handshake. Sent raw to MediaMTX
	// by the server -- never inspected or munged.
	SDP string `json:"sdp,omitempty"`
	// Which publisher a subscribe:offer wants to pull.
	PublisherID string `json:"publisherId,omitempty"`
	// For knock:approve / knock:deny, which request is being answered.
	RequestID string `json:"requestId,omitempty"`
	// Which publish/subscribe offer this message is about. The client
	// numbers its offers and matches replies by number -- an answer that
	// belongs to a discarded connection (a fast re-share) must not be
	// applied to the replacement's description. Echoed verbatim.
	Seq int `json:"seq,omitempty"`
	// For peer:rename, the requested new display name.
	Name string `json:"name,omitempty"`
}

// The WebSocket carries signalling only; the media itself is exchanged
// directly between the browser and MediaMTX (WHIP to publish, WHEP to
// read). This process proxies the SDP handshake and never touches media
// packets -- see internal/mediamtx.
//
// Every person in a room is the same kind of participant: the password is
// the only credential, and any peer may start publishing at any time
// while receiving whatever the others publish. Each publisher gets its
// own MediaMTX path, so a room can carry several simultaneous shares.
func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	roomID := strings.ToLower(q.Get("room"))

	room, err := s.registry.Get(roomID)
	if err != nil {
		// Under a cluster the room may live on a peer -- forward the
		// handshake there verbatim (the query string carries the
		// credentials, so the origin node still authenticates it).
		if s.cluster != nil {
			if target, ok := s.cluster.Locate(r.Context(), roomID); ok {
				s.cluster.Proxy(w, r, target)
				return
			}
		}
		http.Error(w, rooms.ErrNotFound.Error(), http.StatusNotFound)
		return
	}

	// Authorised BEFORE the upgrade, so a failed attempt is a plain HTTP
	// status the browser can actually read. Two independent ways in:
	// the password, or an admit token from an approved knock (see
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
		// instead of leaving the tile unlabeled. Someone admitted via a
		// knock already gave a name when they asked to enter, which
		// takes priority over a same-request "name" query param.
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
	// for the newcomer to render the grid and know whose path to expect.
	peer.Send(map[string]any{
		"type":   "welcome",
		"peerId": peerID,
		"name":   peer.Name,
		"roomId": room.ID,
		"peers":  existing,
		// Kept by the client and presented on reconnect (see above).
		"resume": room.ResumeToken(peerID, peer.Name),
		// A closing warning already standing when this connection
		// arrives -- reconnecting mid-warning must not hide the
		// countdown (0 means nothing pending).
		"closingAt": room.ClosingAtMillis(),
		// The room's stage choice, so a newcomer lands watching what
		// everyone else is watching ("" = none).
		"spotlight": room.SpotlightPeerID(),
		// Requests broadcast before this connection existed would
		// otherwise never reach it -- someone joining mid-wait still
		// needs to see (and be able to answer) a knock already in
		// flight.
		"pendingKnocks": room.PendingKnocks(),
	})

	session := &wsSession{server: s, room: room, peer: peer, ctx: ctx}
	session.readLoop(ctx, conn)

	session.close()
	room.Leave(peer)
	peer.Close()
	_ = conn.Close(websocket.StatusNormalClosure, "")
}

// wsSession is one person's connection: the signalling socket, plus the
// MediaMTX target of their own share (if any) so it can be torn down.
type wsSession struct {
	server *Server
	room   *rooms.Room
	peer   *rooms.Peer
	// The connection's lifetime context (see the constructor) -- what
	// makes log lines from handlers that predate the read loop carry
	// trace_id too.
	ctx context.Context
}

// close tears down this peer's own MediaMTX session (if it was
// publishing) so a disconnect doesn't leave a path publishing off-roster.
func (w *wsSession) close() {
	if location := w.room.ClearPublishTarget(w.peer); location != "" {
		if err := w.server.media.Close(location); err != nil {
			w.server.log.WarnContext(w.ctx, "mediamtx teardown failed", "peer_id", w.peer.ID, "error", err)
		}
	}
}

// stopPublishing tears down the send side without touching the receive
// side -- someone who stops sharing keeps watching.
func (w *wsSession) stopPublishing() {
	if location := w.room.ClearPublishTarget(w.peer); location != "" {
		if err := w.server.media.Close(location); err != nil {
			w.server.log.WarnContext(w.ctx, "mediamtx teardown failed", "peer_id", w.peer.ID, "error", err)
		}
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
		// that knows what it's about to send; the server forwards that
		// raw offer to MediaMTX's WHIP endpoint and relays the answer.
		case "publish:offer":
			w.handlePublishOffer(msg)

		case "publish:stop":
			w.stopPublishing()

		// A viewer pulling one publisher's share. The viewer builds a
		// recvonly offer and the server forwards it to MediaMTX's WHEP
		// endpoint for that publisher's path -- the viewer never learns
		// the path.
		case "subscribe:offer":
			w.handleSubscribeOffer(msg)

		// Changing your own label. The room hands back a fresh resume
		// token in the direct reply (see rooms.Room.Rename) -- the old
		// one signed the previous name.
		case "peer:rename":
			// Empty means nothing left after trimming -- ignore rather
			// than letting someone erase their label.
			if name := sanitizeName(msg.Name); name != "" {
				w.room.Rename(w.peer, name)
			}

		// The room's red "reset" button: something is wedged and every
		// media connection in the room should be rebuilt from zero. The
		// server's part is only relaying the instruction to everyone, the
		// sender included -- each client then drops its own WebSocket,
		// and the reconnect (same resume identity) rebuilds every WHEP
		// publisher and re-offers the capture that never stopped. Nobody
		// re-picks their window; see useRoom's room:reset case.
		case "room:reset":
			w.room.Broadcast(map[string]any{"type": "room:reset"}, "")

		// Someone (usually whoever is looking at the idle warning)
		// telling the reaper this room is still wanted. Resets the idle
		// clock and, when a closing was already announced, withdraws it
		// for everyone.
		case "room:keepalive":
			w.room.KeepAlive()

		// Pinning one publisher as the room's stage. Anyone may set or
		// clear it -- there is no host -- and the echo reaches the
		// sender too, like room:reset. An empty publisherId clears.
		case "spotlight:set":
			w.room.SetSpotlight(msg.PublisherID)

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

// handlePublishOffer relays one publisher's raw WHIP offer to MediaMTX
// and answers with its SDP. Publishing state is a consequence of media
// actually being accepted: the target and the roster flag are only set
// once MediaMTX has answered.
func (w *wsSession) handlePublishOffer(msg clientMessage) {
	if msg.SDP == "" {
		return
	}
	if w.server.media == nil || !w.server.media.Configured() {
		w.peer.Send(map[string]any{"type": "publish:error", "error": "servidor sem MediaMTX configurado", "retryable": false})
		return
	}
	if len(msg.SDP) > maxSDPBytes {
		w.peer.Send(map[string]any{"type": "publish:error", "error": "SDP grande demais", "retryable": false})
		return
	}
	// Re-publishing (switching from screen to camera, say) replaces the
	// previous share rather than stacking a second one.
	w.stopPublishing()

	path := mediamtx.PathFor(w.room.ID, w.peer.ID)
	result, err := w.server.media.Publish(path, msg.SDP)
	if err != nil {
		w.server.log.ErrorContext(w.ctx, "mediamtx publish failed", "peer_id", w.peer.ID, "room_id", w.room.ID, "error", err)
		// A transient handshake miss to MediaMTX is worth a retry; the
		// client retries a bounded number of times.
		w.peer.Send(map[string]any{"type": "publish:error", "error": "não foi possível iniciar a transmissão", "retryable": true})
		return
	}

	// The audio flag comes from the publisher's own SDP, never a client
	// claim -- viewers read it to decide whether to ask MediaMTX for an
	// audio m-line.
	w.room.SetPublishTarget(w.peer, path, result.Location, mediamtx.OfferHasAudio(msg.SDP))
	w.peer.Send(map[string]any{"type": "publish:answer", "seq": msg.Seq, "sdp": result.SDP})
	// Announced separately from the media so the grid can show someone
	// as sharing while their connection is still negotiating.
	w.room.SetPublishing(w.peer, true)
}

// handleSubscribeOffer relays a viewer's raw WHEP offer to MediaMTX for
// one publisher's path and answers with the SDP. The path never reaches
// the client.
func (w *wsSession) handleSubscribeOffer(msg clientMessage) {
	if msg.SDP == "" || msg.PublisherID == "" {
		return
	}
	if w.server.media == nil || !w.server.media.Configured() {
		w.peer.Send(map[string]any{"type": "subscribe:error", "publisherId": msg.PublisherID, "error": "servidor sem MediaMTX configurado", "retryable": false})
		return
	}
	if len(msg.SDP) > maxSDPBytes {
		w.peer.Send(map[string]any{"type": "subscribe:error", "publisherId": msg.PublisherID, "error": "SDP grande demais", "retryable": false})
		return
	}
	if msg.PublisherID == w.peer.ID {
		return // nobody pulls their own share: they already have the local one
	}
	path, _, ok := w.room.PublishTarget(msg.PublisherID)
	if !ok {
		// The publisher's path isn't live (or already stopped). Not
		// retryable: retrying against a stopped share just loops.
		w.peer.Send(map[string]any{"type": "subscribe:error", "publisherId": msg.PublisherID, "error": "essa transmissão ainda não está no ar", "retryable": false})
		return
	}

	result, err := w.server.media.Subscribe(path, msg.SDP)
	if err != nil {
		w.server.log.ErrorContext(w.ctx, "mediamtx subscribe failed", "peer_id", w.peer.ID, "publisher_id", msg.PublisherID, "error", err)
		// The path is live but MediaMTX may not have registered it yet
		// (the publisher's ICE/DTLS can lag the WHIP answer), so this
		// is worth a bounded retry.
		w.peer.Send(map[string]any{"type": "subscribe:error", "publisherId": msg.PublisherID, "error": "falha ao receber essa transmissão", "retryable": true})
		return
	}
	w.peer.Send(map[string]any{"type": "subscribe:answer", "seq": msg.Seq, "publisherId": msg.PublisherID, "sdp": result.SDP})
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
