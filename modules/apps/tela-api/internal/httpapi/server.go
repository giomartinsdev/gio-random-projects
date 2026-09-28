// Package httpapi is the whole transport layer for tela-api: a tiny
// JSON API to create and check rooms, and the WebSocket that carries
// WebRTC signalling. The React bundle is a separate app now
// (tela-frontend) served from its own origin -- see AllowedOrigins
// for why every route here needs an explicit cross-origin policy
// instead of relying on same-origin defaults.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/clips"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/cluster"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/mediamtx"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/turn"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type Server struct {
	registry *rooms.Registry
	limiter  *attemptLimiter
	mux      *http.ServeMux
	// Proxies screen-share media through MediaMTX (WHIP to publish, WHEP
	// to read). Nil means no MediaMTX configured, in which case
	// publishing is refused with a clear message rather than failing
	// halfway through a handshake.
	media *mediamtx.Proxy
	// Decides which ICE servers the browser gets: STUN always, TURN when
	// configured (a relay fallback for a path that can't carry media).
	turn *turn.Proxy
	// tela-frontend's own origin(s) -- the only ones the REST API sends
	// CORS headers for and the WebSocket accepts a connection from. See
	// ws.go's use of this for why it can't just trust r.Host anymore.
	AllowedOrigins []string
	log            *slog.Logger

	// Clip storage, wired by RegisterClips (see clips.go). Nil until
	// then, and the routes simply don't exist.
	clipStore clips.Store
	clipTTL   time.Duration

	// Multi-node routing (see cluster.go), wired by RegisterCluster.
	// Nil in the common single-node deployment.
	cluster *cluster.Cluster
}

// The metrics handler is optional (nil = the /metrics route doesn't
// exist at all) because scraping is a deployment's choice, not the
// app's: TELA_METRICS=1 in main is what turns it on.
func New(registry *rooms.Registry, media *mediamtx.Proxy, turnProxy *turn.Proxy, allowedOrigins []string, log *slog.Logger, metrics http.Handler) *Server {
	s := &Server{
		registry:       registry,
		limiter:        newAttemptLimiter(),
		mux:            http.NewServeMux(),
		media:          media,
		turn:           turnProxy,
		AllowedOrigins: allowedOrigins,
		log:            log,
	}

	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("GET /statusz", s.handleStatusz)
	if metrics != nil {
		s.mux.Handle("GET /metrics", metrics)
	}
	s.mux.HandleFunc("GET /api/rtc/ice", s.handleIceServers)
	s.mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	s.mux.HandleFunc("GET /api/rooms", s.handleListRooms)
	s.mux.HandleFunc("GET /api/rooms/{id}", s.handleRoomStatus)
	s.mux.HandleFunc("DELETE /api/rooms/{id}", s.handleDeleteRoom)
	s.mux.HandleFunc("POST /api/rooms/{id}/check", s.handleCheckPassword)
	s.mux.HandleFunc("POST /api/rooms/{id}/knock", s.handleKnock)
	s.mux.HandleFunc("GET /api/rooms/{id}/knock/{requestId}", s.handleKnockStatus)
	s.mux.HandleFunc("GET /ws", s.handleWS)

	return s
}

// otelhttp wraps the whole transport (CORS included) so every request
// gets exactly one span, and its context feeds every log line below --
// trace_id in the JSON output is what links a line to its trace in
// Tempo. Span names use the URL path (the mux's route patterns aren't
// visible to otelhttp before the request is dispatched, and every span
// sharing an operation name reads terribly in Tempo).
func (s *Server) Handler() http.Handler {
	return otelhttp.NewHandler(s.cors(s.mux), "tela-api",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)
}

// Wraps every route: tela-frontend calls this API cross-origin now, so
// every response needs the CORS headers, not just a subset -- the
// browser applies its own-origin check uniformly regardless of which
// route actually gets hit.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Requests forwarded by a cluster peer skip CORS entirely: the
		// peer already answered the browser, and a second layer here
		// would duplicate the header (the proxy copies response
		// headers additively) -- which browsers treat as a violation.
		if !s.isFromPeer(r) && slices.Contains(s.AllowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			// traceparent/tracestate/baggage: the frontend's fetch
			// instrumentation (tela-frontend/src/telemetry.ts) adds these
			// to every call, and a preflight that doesn't allow them
			// kills the request before it starts.
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, traceparent, tracestate, baggage")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "rooms": s.registry.Count()})
}

type createRoomRequest struct {
	Password string `json:"password"`
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	var req createRoomRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if len(req.Password) < 4 {
		writeError(w, http.StatusBadRequest, "a senha precisa ter pelo menos 4 caracteres")
		return
	}
	if len(req.Password) > 200 {
		writeError(w, http.StatusBadRequest, "senha longa demais")
		return
	}

	room, err := s.registry.Create(req.Password)
	if err != nil {
		if errors.Is(err, rooms.ErrTooManyRooms) {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		s.log.ErrorContext(r.Context(), "create room failed", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível criar a sala")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"roomId": room.ID})
}

// Lets the home page show "salas rolando" -- who's live right now --
// so switching rooms doesn't require someone to paste you a code.
// Never leaks a password or its hash, only what handleRoomStatus
// already exposes per-room without auth (a count of people). Under a
// cluster the lists of every live peer are merged in, so the home
// page shows the whole fleet no matter which node answered.
func (s *Server) handleListRooms(w http.ResponseWriter, r *http.Request) {
	local := s.registry.Active()
	if s.cluster != nil {
		local = mergeRooms(local, s.cluster.RemoteRooms(r.Context()))
	}
	writeJSON(w, http.StatusOK, local)
}

// Deliberately says nothing about whether the room exists beyond
// "found or not" -- no password hints, no viewer identities.
func (s *Server) handleRoomStatus(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomOrProxy(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"roomId":     room.ID,
		"people":     room.PeerCount(),
		"publishing": room.PublisherCount(),
	})
}

type deleteRoomRequest struct {
	Password string `json:"password"`
}

// handleDeleteRoom lets the room creator (who knows the password)
// destroy a room immediately instead of waiting for the janitor.
func (s *Server) handleDeleteRoom(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomOrProxy(w, r)
	if !ok {
		return
	}

	var req deleteRoomRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}

	if err := s.registry.Delete(room.ID, req.Password); err != nil {
		if errors.Is(err, rooms.ErrNotFound) {
			writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
			return
		}
		if errors.Is(err, rooms.ErrWrongSecret) {
			writeError(w, http.StatusUnauthorized, rooms.ErrWrongSecret.Error())
			return
		}
		s.log.ErrorContext(r.Context(), "delete room failed", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível apagar a sala")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Lets the join form report a wrong password without first opening a
// WebSocket. Rate limited per client IP, since a room code plus a
// short password is exactly the shape of thing worth guessing.
func (s *Server) handleCheckPassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "muitas tentativas, espere um pouco")
		return
	}

	// Resolve the room before touching the body: under a cluster the
	// request may be forwarded verbatim, and a body read here first
	// would hand the proxy a corpse.
	room, ok := s.roomOrProxy(w, r)
	if !ok {
		return
	}

	var req createRoomRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if !room.CheckPassword(req.Password) {
		s.limiter.fail(ip)
		writeError(w, http.StatusUnauthorized, rooms.ErrWrongSecret.Error())
		return
	}
	s.limiter.reset(ip)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "people": room.PeerCount()})
}

type knockCreateRequest struct {
	Name string `json:"name"`
}

// handleKnock is the whole point of not needing the password: anyone
// with just the room code can ask to be let in, and everyone already
// inside is notified over their own WebSocket (see rooms.Knock). Rate
// limited the same way a password guess is -- it's the same kind of
// "someone hammering a room they don't have the credentials for".
func (s *Server) handleKnock(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "muitas tentativas, espere um pouco")
		return
	}

	// Same order as handleCheckPassword: room first, body after, so a
	// room on a peer gets the request with its body intact.
	room, ok := s.roomOrProxy(w, r)
	if !ok {
		return
	}

	var req knockCreateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}

	k, err := room.Knock(sanitizeName(req.Name))
	if err != nil {
		if errors.Is(err, rooms.ErrTooManyKnocks) {
			writeError(w, http.StatusTooManyRequests, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "não foi possível pedir para entrar")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"requestId": k.ID})
}

// handleKnockStatus is polled by whoever is waiting in the lobby --
// deliberately not a held-open connection, so an absent or slow room
// never blocks their tab (see this app's concurrency note in
// Room.tsx's knock lobby). The admit token only comes back once the
// request is actually approved.
func (s *Server) handleKnockStatus(w http.ResponseWriter, r *http.Request) {
	room, ok := s.roomOrProxy(w, r)
	if !ok {
		return
	}

	k, ok := room.KnockLookup(r.PathValue("requestId"))
	if !ok {
		writeError(w, http.StatusNotFound, "pedido não encontrado ou expirado")
		return
	}

	resp := map[string]any{"status": k.Status}
	if k.Status == rooms.KnockApproved {
		resp["admitToken"] = k.AdmitToken
	}
	writeJSON(w, http.StatusOK, resp)
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64*1024))
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func clientIP(r *http.Request) string {
	// Behind Cloudflare and the host's own nginx ingress, so the direct
	// RemoteAddr is always localhost. CF-Connecting-IP is set by the
	// edge and passed through untouched -- the only header here that
	// isn't attacker-controlled.
	if ip := r.Header.Get("CF-Connecting-IP"); ip != "" {
		return ip
	}
	host, _, found := strings.Cut(r.RemoteAddr, ":")
	if !found {
		return r.RemoteAddr
	}
	return host
}

// A small fixed-window counter, per client IP. Not a general-purpose
// rate limiter -- it exists to make guessing a room password slow, and
// resets as soon as a correct password proves the client is legitimate.
type attemptLimiter struct {
	mu      sync.Mutex
	entries map[string]*attemptEntry
}

type attemptEntry struct {
	count int
	since time.Time
}

const (
	maxFailures    = 10
	failureWindow  = 5 * time.Minute
	limiterMaxKeys = 10000
)

func newAttemptLimiter() *attemptLimiter {
	return &attemptLimiter{entries: make(map[string]*attemptEntry)}
}

func (l *attemptLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok {
		return true
	}
	if time.Since(e.since) > failureWindow {
		delete(l.entries, ip)
		return true
	}
	return e.count < maxFailures
}

func (l *attemptLimiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok || time.Since(e.since) > failureWindow {
		if len(l.entries) >= limiterMaxKeys {
			// Cheapest possible bound: an attacker rotating IPs would
			// otherwise grow this map without limit. Dropping everything
			// is fine -- the window is minutes, not hours.
			l.entries = make(map[string]*attemptEntry)
		}
		l.entries[ip] = &attemptEntry{count: 1, since: time.Now()}
		return
	}
	e.count++
}

func (l *attemptLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, ip)
}
