// Package httpapi is leads-api's whole transport layer: one public
// route, POST /api/leads, that captures an e-mail from
// financas-frontend's landing page before that visitor ever
// authenticates. Deliberately NOT behind Cloudflare Access -- an
// anonymous visitor filling a form can't complete a Google SSO
// redirect, the same reasoning ai.giomartins.dev's /v1 and every other
// public-by-design hostname in excluded_hostnames already documents.
// The only gate here is CORS (answered only for financas-frontend's
// own origin) plus a small in-memory per-IP rate limit, since a public
// unauthenticated POST route is the obvious target for spam.
package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/leads-api/internal/domainapi"
)

type Config struct {
	// financas-frontend's own origin(s) -- the only ones CORS is
	// answered for. No Access session cookie rides along (this route
	// is intentionally public), so no credentials in the CORS headers.
	AllowedOrigins []string
}

type Server struct {
	domain  *domainapi.Client
	cfg     Config
	mux     *http.ServeMux
	limiter *ipRateLimiter
}

func New(domain *domainapi.Client, cfg Config) *Server {
	cfg.AllowedOrigins = normalizeOrigins(cfg.AllowedOrigins)
	s := &Server{
		domain:  domain,
		cfg:     cfg,
		mux:     http.NewServeMux(),
		limiter: newIPRateLimiter(5, time.Minute),
	}
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("POST /api/leads", s.handleCapturarLead)
	return s
}

func (s *Server) Handler() http.Handler {
	return s.cors(s.mux)
}

// cors is deliberately credential-free (no Access cookie exists to
// carry) -- the allowlist alone is the gate, same shape as every other
// -api's cors middleware minus Access-Control-Allow-Credentials.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if slices.Contains(s.cfg.AllowedOrigins, origin) {
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
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type capturarLeadRequest struct {
	Email string `json:"email"`
}

func (s *Server) handleCapturarLead(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "muitas_tentativas", "aguarde um instante antes de tentar de novo")
		return
	}

	var req capturarLeadRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "corpo inválido")
		return
	}
	email := strings.TrimSpace(req.Email)
	if email == "" || !looksLikeEmail(email) {
		writeError(w, http.StatusUnprocessableEntity, "email_invalido", "informe um e-mail válido")
		return
	}

	err := s.domain.CaptureEmail(r.Context(), email)
	switch {
	case err == nil:
		writeJSON(w, http.StatusCreated, map[string]any{"status": "capturado"})
	case isRejected(err):
		writeError(w, http.StatusUnprocessableEntity, "email_invalido", "informe um e-mail válido")
	case isQueued(err):
		// Publicado, só não confirmado a tempo -- do ponto de vista de
		// quem preencheu o formulário isso já é sucesso (o e-mail não
		// se perde, só a confirmação síncrona é que não chegou).
		writeJSON(w, http.StatusAccepted, map[string]any{"status": "recebido"})
	default:
		writeError(w, http.StatusBadGateway, "domain_indisponivel", "não foi possível salvar agora, tente de novo em instantes")
	}
}

func isRejected(err error) bool { return errors.Is(err, domainapi.ErrRejected) }
func isQueued(err error) bool   { return errors.Is(err, domainapi.ErrQueued) }

// looksLikeEmail is a light sanity check -- the domain-worker aggregate
// is the real source of truth for validity, this just avoids wasting a
// round-trip on obvious garbage.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	return at > 0 && at < len(s)-1 && !strings.ContainsRune(s[at+1:], '@') && strings.ContainsRune(s[at+1:], '.')
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("Cf-Connecting-Ip"); fwd != "" {
		return fwd
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if i := strings.IndexByte(fwd, ','); i >= 0 {
			return strings.TrimSpace(fwd[:i])
		}
		return strings.TrimSpace(fwd)
	}
	return r.RemoteAddr
}

func normalizeOrigins(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if o = strings.TrimSpace(strings.TrimSuffix(o, "/")); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, codigo, mensagem string) {
	writeJSON(w, status, map[string]any{"erro": map[string]any{"codigo": codigo, "mensagem": mensagem}})
}

// ipRateLimiter is a tiny fixed-window limiter -- good enough to blunt
// a bot hammering the one public POST route this service exposes,
// without pulling in a dependency for it. State is per-process memory,
// which is fine: a redeploy resetting counters is not a security
// regression here, just a rare free retry for whoever was mid-block.
type ipRateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func newIPRateLimiter(limit int, window time.Duration) *ipRateLimiter {
	return &ipRateLimiter{limit: limit, window: window, hits: make(map[string][]time.Time)}
}

func (l *ipRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	kept := l.hits[ip][:0]
	for _, t := range l.hits[ip] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.limit {
		l.hits[ip] = kept
		return false
	}
	l.hits[ip] = append(kept, now)
	return true
}
