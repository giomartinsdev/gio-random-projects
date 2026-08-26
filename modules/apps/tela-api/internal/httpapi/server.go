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
	"log"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/sfu"
)

type Server struct {
	registry *rooms.Registry
	limiter  *attemptLimiter
	mux      *http.ServeMux
	// Forwards media between peers. Nil means no SFU configured, in
	// which case publishing is refused with a clear message rather than
	// failing halfway through a handshake.
	sfu *sfu.Server
	// tela-frontend's own origin(s) -- the only ones the REST API sends
	// CORS headers for and the WebSocket accepts a connection from. See
	// ws.go's use of this for why it can't just trust r.Host anymore.
	AllowedOrigins []string
}

func New(registry *rooms.Registry, media *sfu.Server, allowedOrigins []string) *Server {
	s := &Server{
		registry:       registry,
		limiter:        newAttemptLimiter(),
		mux:            http.NewServeMux(),
		sfu:            media,
		AllowedOrigins: allowedOrigins,
	}

	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	s.mux.HandleFunc("GET /api/rooms/{id}", s.handleRoomStatus)
	s.mux.HandleFunc("POST /api/rooms/{id}/check", s.handleCheckPassword)
	s.mux.HandleFunc("GET /ws", s.handleWS)

	return s
}

func (s *Server) Handler() http.Handler { return s.cors(s.mux) }

// Wraps every route: tela-frontend calls this API cross-origin now, so
// every response needs the CORS headers, not just a subset -- the
// browser applies its own-origin check uniformly regardless of which
// route actually gets hit.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if slices.Contains(s.AllowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
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
		log.Printf("[tela] create room failed: %v", err)
		writeError(w, http.StatusInternalServerError, "não foi possível criar a sala")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"roomId": room.ID})
}

// Deliberately says nothing about whether the room exists beyond
// "found or not" -- no password hints, no viewer identities.
func (s *Server) handleRoomStatus(w http.ResponseWriter, r *http.Request) {
	room, err := s.registry.Get(strings.ToUpper(r.PathValue("id")))
	if err != nil {
		writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"roomId":     room.ID,
		"people":     room.PeerCount(),
		"publishing": room.PublisherCount(),
	})
}

// Lets the join form report a wrong password without first opening a
// WebSocket. Rate limited per client IP, since a 6-character room code
// plus a short password is exactly the shape of thing worth guessing.
func (s *Server) handleCheckPassword(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !s.limiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "muitas tentativas, espere um pouco")
		return
	}

	var req createRoomRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}

	room, err := s.registry.Get(strings.ToUpper(r.PathValue("id")))
	if err != nil {
		writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
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
