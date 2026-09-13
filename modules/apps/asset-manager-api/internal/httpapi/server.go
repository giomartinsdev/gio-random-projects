// Package httpapi is the whole transport layer for asset-manager-api: a
// small JSON BFF over domain-api (positions/movements) and brapi.dev
// (quotes, via internal/quotes). The React bundle is a separate app
// served from its own origin, so every route speaks CORS to it --
// cookies included, because the caller is authenticated by financas'
// own session cookie (see session.go), not Cloudflare Access anymore.
// Route shapes and error bodies follow
// specs/002-gestao-financeira-modular/contracts/asset-manager-api.md.
package httpapi

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/quotes"
)

// Config carries what main.go read from the environment.
type Config struct {
	// asset-manager-frontend's own origin(s), comma-separated in the
	// env -- the only ones CORS is answered for.
	AllowedOrigins []string
	// SessionSecret verifies the financas_session cookie (HS256) --
	// contas-api is the one service that also issues it.
	SessionSecret string
	// The emails an operator wants to still restrict to, if ever --
	// empty by default now that financas is open signup.
	AllowedEmails []string
	// Dev bypass: when set and no session cookie is present, requests
	// run as the dev user. Must stay unset in prod.
	DevBypassAuth bool
	DevUserEmail  string
	DevUserNome   string
}

type Server struct {
	domain *domainapi.Client
	quotes *quotes.Client
	cfg    Config
	mux    *http.ServeMux
}

func New(domain *domainapi.Client, q *quotes.Client, cfg Config) *Server {
	cfg.AllowedOrigins = normalizeOrigins(cfg.AllowedOrigins)
	cfg.AllowedEmails = normalizeEmails(cfg.AllowedEmails)
	s := &Server{domain: domain, quotes: q, cfg: cfg, mux: http.NewServeMux()}

	// Foundational routes.
	s.mux.HandleFunc("GET /api/health", s.handleHealth)
	s.mux.HandleFunc("GET /api/me", s.handleMe)
	// Ativo routes (US4) register themselves from ativohandlers.go.
	s.registrarRotasAtivos()

	return s
}

// Handler wraps the mux with the auth middleware and CORS. Only
// /api/health is public; everything else requires a verified financas
// session.
func (s *Server) Handler() http.Handler {
	authed := s.requireAuth(s.mux)
	return s.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			s.mux.ServeHTTP(w, r)
			return
		}
		authed.ServeHTTP(w, r)
	}))
}

// cors mirrors the other modules' single middleware, with credentials
// allowed: the frontend calls cross-origin with credentials:"include" so
// the Access cookie rides along.
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

// handleMe is the identity probe the SPA uses to decide between
// rendering and bouncing to the /api/sso login hop.
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
	if err := dec.Decode(dst); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// erroCampo is one entry of a 422 `detalhes` array: which field and why.
type erroCampo struct {
	Campo    string `json:"campo"`
	Problema string `json:"problema"`
}

// writeError answers with the platform's single error body:
// {"erro":{"codigo","mensagem"}} -- stable codigo values are what the
// frontend switches on.
func writeError(w http.ResponseWriter, status int, codigo, mensagem string) {
	writeJSON(w, status, map[string]any{
		"erro": map[string]any{"codigo": codigo, "mensagem": mensagem},
	})
}

// writeValidacao is the 422 flavor, carrying per-field details.
func writeValidacao(w http.ResponseWriter, mensagem string, detalhes []erroCampo) {
	writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"erro": map[string]any{
			"codigo":   "validacao",
			"mensagem": mensagem,
			"detalhes": detalhes,
		},
	})
}
