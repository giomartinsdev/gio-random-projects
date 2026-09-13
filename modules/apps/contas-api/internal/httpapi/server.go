// Package httpapi is the whole transport layer for contas-api: a small
// JSON BFF in front of the domain-api for the "Contas" module of the
// personal-finance feature. This service has no database of its own --
// every read and write goes through internal/domainapi. The frontend is
// a separate app on its own origin, so every route speaks CORS to it --
// cookies included, because the caller is authenticated by financas'
// own session cookie (see session.go), not Cloudflare Access anymore.
// Error bodies follow the same shape as harness-api/bet-api:
// {"erro":{"codigo","mensagem"}}. Contract:
// specs/002-gestao-financeira-modular/contracts/contas-api.md.
package httpapi

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/contas-api/internal/domainapi"
)

// Config carries what main.go read from the environment.
type Config struct {
	// financas-frontend's own origin(s), comma-separated in the env --
	// the only ones CORS is answered for.
	AllowedOrigins []string
	// SessionSecret signs/verifies the financas_session cookie (HS256)
	// -- shared with the other 3 financas backends, which only ever
	// verify it (this is the one service that also issues it).
	SessionSecret string
	// SessionCookieDomain is set to ".giomartins.dev" in production so
	// the cookie rides to every financas subdomain; empty (host-only
	// cookie) in local dev.
	SessionCookieDomain string
	// SessionDuration is how long a session lasts before requiring a
	// fresh Google login.
	SessionDuration time.Duration
	// GoogleClientID is this app's OAuth 2.0 client ID (Google Cloud
	// Console) -- idtoken.Validate checks every credential against it,
	// so a token minted for some unrelated Google app can't be replayed
	// here.
	GoogleClientID string
	// The emails an operator wants to still restrict to, if ever --
	// empty by default now that financas is open signup (any Google
	// account creates its own account on first login).
	AllowedEmails []string
	// Dev bypass: when set and no session cookie is present, requests
	// run as the dev user. Must stay unset in prod.
	DevBypassAuth bool
	DevUserEmail  string
	DevUserNome   string
}

type Server struct {
	domain *domainapi.Client
	cfg    Config
	mux    *http.ServeMux
}

func New(domain *domainapi.Client, cfg Config) *Server {
	cfg.AllowedOrigins = normalizeOrigins(cfg.AllowedOrigins)
	cfg.AllowedEmails = normalizeEmails(cfg.AllowedEmails)
	s := &Server{domain: domain, cfg: cfg, mux: http.NewServeMux()}

	// Foundational routes.
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/me", s.handleMe)
	// Auth routes register themselves from authhandlers.go.
	s.registrarRotasAuth()
	// Conta routes register themselves from contahandlers.go.
	s.registrarRotasContas()

	return s
}

// Handler wraps the mux with the auth middleware and CORS. Only
// /api/health (watchtower/compose probe) and the two /api/auth/* routes
// (sign-in itself, and logout) are public; everything else requires a
// verified financas session.
func (s *Server) Handler() http.Handler {
	authed := s.requireAuth(s.mux)
	return s.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" || strings.HasPrefix(r.URL.Path, "/api/auth/") {
			s.mux.ServeHTTP(w, r)
			return
		}
		authed.ServeHTTP(w, r)
	}))
}

// cors mirrors harness-api/cch-api's single middleware, with credentials
// allowed: the SPA calls cross-origin with credentials:"include" so the
// financas_session cookie rides along.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if slices.Contains(s.cfg.AllowedOrigins, origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
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

// handleMe is the identity probe the SPA uses to decide whether to
// render the app or show the sign-in screen.
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]string{"email": id.Email, "nome": id.Nome})
}

// normalizeOrigins trims and canonicalizes the CORS allowlist.
func normalizeOrigins(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			out = append(out, o)
		}
	}
	return out
}

// normalizeEmails lowercases the allowlist: the middleware compares
// against lowercased claim emails.
func normalizeEmails(emails []string) []string {
	out := make([]string, 0, len(emails))
	for _, e := range emails {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			out = append(out, e)
		}
	}
	return out
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	return dec.Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError answers with the contract's single error body:
// {"erro":{"codigo","mensagem"}} -- stable codigo values are what the
// frontend switches on.
func writeError(w http.ResponseWriter, status int, codigo, mensagem string) {
	writeJSON(w, status, map[string]any{
		"erro": map[string]any{"codigo": codigo, "mensagem": mensagem},
	})
}
