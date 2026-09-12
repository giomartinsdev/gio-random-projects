// Package httpapi is the whole transport layer for transacional-api: a
// small JSON BFF over the shared domain-api's conta/transacao
// aggregates. This service has no database of its own -- see
// internal/domainapi for the persistence client. The React frontend is
// a separate app on its own origin, so every route speaks CORS to it --
// cookies included, because the caller is authenticated by the
// Cloudflare Access session, not by a token of ours. Route shapes and
// error bodies follow
// specs/002-gestao-financeira-modular/contracts/transacional-api.md.
package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/transacional-api/internal/domainapi"
)

// Config carries what main.go read from the environment.
type Config struct {
	// The frontend's own origin(s), comma-separated in the env -- the
	// only ones CORS is answered for and /api/sso redirects back to.
	AllowedOrigins []string
	// Cloudflare Access verification: issuer is the team domain URL,
	// audience this app's aud. Empty issuer means no JWKS exists to
	// verify tokens with.
	AccessIssuer string
	AccessAud    string
	// The emails terraform's Access policy allows -- defense in depth
	// behind Access's own decision. Empty means everyone who passed
	// Access is in.
	AllowedEmails []string
	// Dev bypass: when set and no JWT header is present, requests run as
	// the dev user. Must stay unset in prod.
	DevBypassAuth bool
	DevUserEmail  string
	DevUserNome   string
	// JWTKeyfunc resolves signing keys from the Access team JWKS; built
	// by main.go from AccessIssuer. Nil disables the token path (dev).
	JWTKeyfunc jwt.Keyfunc
	// MaxAnexoBytes bounds the decoded size of anexoImagem uploads.
	MaxAnexoBytes int64
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
	s.mux.HandleFunc("GET /api/sso", s.handleSSO)
	// Transação routes (US2).
	s.mux.HandleFunc("GET /api/transacoes", s.handleListarTransacoes)
	s.mux.HandleFunc("POST /api/transacoes", s.handleCriarTransacao)
	s.mux.HandleFunc("PATCH /api/transacoes/{id}", s.handleEditarTransacao)
	s.mux.HandleFunc("DELETE /api/transacoes/{id}", s.handleExcluirTransacao)

	return s
}

// Handler wraps the mux with the auth middleware and CORS. Only
// /api/health and /api/sso are public; everything else requires a
// verified Access identity.
func (s *Server) Handler() http.Handler {
	authed := s.requireAuth(s.mux)
	return s.cors(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" || r.URL.Path == "/api/sso" {
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
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

// handleSSO is the login hop: the frontend NAVIGATES here top-level --
// never fetches, the Access login can't run inside a fetch/iframe. The
// Access application in front of this API intercepts the navigation
// when there's no session yet; what the browser lands on after passing
// is this route, which bounces back to the SPA. The redirect target is
// the caller's ?return= as long as its ORIGIN is allowlisted -- so the
// hop can't be pointed anywhere else.
func (s *Server) handleSSO(w http.ResponseWriter, r *http.Request) {
	if origin, full, ok := originOf(r.URL.Query().Get("return")); ok && slices.Contains(s.cfg.AllowedOrigins, origin) {
		http.Redirect(w, r, full, http.StatusFound)
		return
	}
	writeError(w, http.StatusUnprocessableEntity, "validacao", "origem de retorno não permitida")
}

// originOf extracts the origin of an absolute URL ("https://x.dev/a?b"
// -> origin "https://x.dev", full URL as given). The full URL goes back
// in the redirect so deep links survive the login hop.
func originOf(raw string) (origin, full string, ok bool) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", "", false
	}
	return u.Scheme + "://" + u.Host, raw, true
}

// normalizeOrigins trims and canonicalizes the allowlist so
// "https://x.dev/" and "https://x.dev" match the same redirect target.
func normalizeOrigins(origins []string) []string {
	out := make([]string, 0, len(origins))
	for _, o := range origins {
		if origin, _, ok := originOf(strings.TrimSpace(o)); ok {
			out = append(out, origin)
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
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
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
