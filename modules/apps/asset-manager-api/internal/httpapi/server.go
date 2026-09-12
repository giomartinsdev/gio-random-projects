// Package httpapi is the whole transport layer for asset-manager-api: a
// small JSON BFF over domain-api (positions/movements) and brapi.dev
// (quotes, via internal/quotes). The React bundle is a separate app
// served from its own origin, so every route speaks CORS to it --
// cookies included, because the caller is authenticated by the
// Cloudflare Access session cookie, not by a token of ours. Route
// shapes and error bodies follow
// specs/002-gestao-financeira-modular/contracts/asset-manager-api.md.
package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/quotes"
)

// Config carries what main.go read from the environment.
type Config struct {
	// asset-manager-frontend's own origin(s), comma-separated in the
	// env -- the only ones CORS is answered for and /api/sso redirects
	// back to.
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
	s.mux.HandleFunc("GET /api/sso", s.handleSSO)
	// Ativo routes (US4) register themselves from ativohandlers.go.
	s.registrarRotasAtivos()

	return s
}

// Handler wraps the mux with the auth middleware and CORS. Only
// /api/health (probe) and /api/sso (the login hop itself) are public;
// everything else requires a verified Access identity.
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

// handleSSO is the login hop: the frontend NAVIGATES here top-level --
// never fetches, Google's own login can't run inside a fetch/iframe.
// The Access application in front of this API intercepts the
// navigation when there's no session yet; what the browser lands on
// after passing is this route, which bounces back to the SPA. The
// redirect target is the caller's ?return= as long as its ORIGIN is
// allowlisted -- so the hop can't be pointed anywhere else.
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
