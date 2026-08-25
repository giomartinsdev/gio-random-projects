// Package httpapi is the whole transport layer: a tiny JSON API to
// create and check rooms, the WebSocket that carries WebRTC
// signalling, and the static React build.
package httpapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
)

type Server struct {
	registry *rooms.Registry
	webDir   string
	limiter  *attemptLimiter
	mux      *http.ServeMux
}

func New(registry *rooms.Registry, webDir string) *Server {
	s := &Server{
		registry: registry,
		webDir:   webDir,
		limiter:  newAttemptLimiter(),
		mux:      http.NewServeMux(),
	}

	s.mux.HandleFunc("GET /healthz", s.handleHealth)
	s.mux.HandleFunc("POST /api/rooms", s.handleCreateRoom)
	s.mux.HandleFunc("GET /api/rooms/{id}", s.handleRoomStatus)
	s.mux.HandleFunc("POST /api/rooms/{id}/check", s.handleCheckPassword)
	s.mux.HandleFunc("GET /ws", s.handleWS)
	s.mux.HandleFunc("/", s.handleStatic)

	return s
}

func (s *Server) Handler() http.Handler { return s.mux }

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

	room, hostToken, err := s.registry.Create(req.Password)
	if err != nil {
		if errors.Is(err, rooms.ErrTooManyRooms) {
			writeError(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		log.Printf("[tela] create room failed: %v", err)
		writeError(w, http.StatusInternalServerError, "não foi possível criar a sala")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"roomId":    room.ID,
		"hostToken": hostToken,
	})
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
		"roomId":   room.ID,
		"sharing":  room.HasHost(),
		"watching": room.ViewerCount(),
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

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "sharing": room.HasHost()})
}

// Serves the built SPA, falling back to index.html for any path the
// filesystem doesn't have so client-side routes (/r/ABC123) survive a
// hard reload. /api and /ws are handled above and never reach here.
func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	clean := filepath.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean == "." || clean == "/" {
		clean = "index.html"
	}
	// filepath.Clean already resolves .., but the path came from a
	// request -- refuse anything that still tries to climb out.
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		http.NotFound(w, r)
		return
	}

	target := filepath.Join(s.webDir, clean)
	if info, err := os.Stat(target); err != nil || info.IsDir() {
		target = filepath.Join(s.webDir, "index.html")
	}

	// Hashed asset filenames can be cached hard; index.html must not be,
	// or a deploy leaves people on a stale bundle.
	if strings.HasPrefix(clean, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, target)
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
	// Behind Cloudflare + cloudflared, so the direct RemoteAddr is
	// always the tunnel. CF-Connecting-IP is set by the edge and is the
	// only header here that isn't attacker-controlled.
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
