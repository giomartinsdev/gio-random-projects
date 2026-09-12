// Identity = Cloudflare Access, the same pattern every other module in
// this platform runs in production (harness-api, bet-api, cch-api). The
// edge stamps every request that passes the Access application with the
// Cf-Access-Jwt-Assertion header -- a JWT signed with the team's public
// keys. This middleware verifies it properly: signature against the
// team JWKS, issuer against the team domain, audience against this
// app's ASSET_MANAGER_ACCESS_AUD -- because the same nginx also routes
// direct (non-edge) traffic here; anyone bypassing Cloudflare still
// needs a valid JWT.
//
// The verified email+name claims become an Identity in the request
// context (WithIdentity/IdentityFrom). ASSET_MANAGER_DEV_BYPASS_AUTH=1
// is the local-dev escape hatch: with no JWT header present, requests
// run as the ASSET_MANAGER_DEV_USER_* user. Tests skip the middleware
// entirely by injecting an Identity straight into the request context.
//
// Unlike harness-api, this service has no database of its own (no
// positions store, no usuarios cache) -- the identity is used only to
// scope calls to domain-api (usuario_email) and never persisted here.
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Identity is who is calling. Email is the stable key everywhere
// (usuario_email in domain-api); Nome is display only, from the Access
// "name" claim.
type Identity struct {
	Email string
	Nome  string
}

type identityContextKey struct{}

// WithIdentity puts an Identity in a request context. Exported for
// tests, which build requests as already-authenticated users this way;
// in production the only writer is the auth middleware below.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityContextKey{}, id)
}

// IdentityFrom reads the caller's Identity, set by the auth middleware.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityContextKey{}).(Identity)
	return id, ok
}

// requireAuth resolves the caller's identity before the request reaches
// a handler. Routes that are public by design (/api/health, /api/sso)
// are exempted in Handler().
func (s *Server) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFrom(r.Context())
		if !ok {
			var err error
			if id, err = s.identidade(r); err != nil {
				writeError(w, http.StatusUnauthorized, "nao_autenticado", err.Error())
				return
			}
			r = r.WithContext(WithIdentity(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

// identidade verifies the Access JWT or, in dev bypass mode with no
// token at all, returns the configured dev user.
func (s *Server) identidade(r *http.Request) (Identity, error) {
	token := r.Header.Get("Cf-Access-Jwt-Assertion")
	if token == "" {
		if s.cfg.DevBypassAuth {
			return s.cfg.devIdentity(), nil
		}
		return Identity{}, errors.New("sessão do Cloudflare Access ausente")
	}
	if s.cfg.JWTKeyfunc == nil {
		return Identity{}, errors.New("validação de token indisponível (JWKS do Access não configurado)")
	}

	opts := []jwt.ParserOption{jwt.WithValidMethods([]string{"RS256"})}
	// Issuer/aud are what actually scopes a token to THIS app; only
	// require them when configured, so a half-configured boot fails on
	// the keyfunc instead of on an impossible "" comparison.
	if s.cfg.AccessIssuer != "" {
		opts = append(opts, jwt.WithIssuer(s.cfg.AccessIssuer))
	}
	if s.cfg.AccessAud != "" {
		opts = append(opts, jwt.WithAudience(s.cfg.AccessAud))
	}
	parsed, err := jwt.Parse(token, s.cfg.JWTKeyfunc, opts...)
	if err != nil || !parsed.Valid {
		return Identity{}, errors.New("token do Cloudflare Access inválido ou expirado")
	}

	claims, _ := parsed.Claims.(jwt.MapClaims)
	email, _ := claims["email"].(string)
	if email == "" {
		return Identity{}, errors.New("token sem claim de e-mail")
	}
	email = strings.ToLower(email)
	// Defense in depth behind Access's own allowed_emails decision,
	// checked again here like every other module does.
	if len(s.cfg.AllowedEmails) > 0 && !slices.Contains(s.cfg.AllowedEmails, email) {
		return Identity{}, errors.New("e-mail não autorizado")
	}

	nome, _ := claims["name"].(string)
	if nome == "" {
		nome = emailLocal(email)
	}
	return Identity{Email: email, Nome: nome}, nil
}

// devIdentity is the user ASSET_MANAGER_DEV_BYPASS_AUTH=1 runs as.
func (c Config) devIdentity() Identity {
	email := strings.ToLower(c.DevUserEmail)
	if email == "" {
		email = "dev@local"
	}
	nome := c.DevUserNome
	if nome == "" {
		nome = emailLocal(email)
	}
	return Identity{Email: email, Nome: nome}
}

// emailLocal is the local part of an e-mail ("ana@corp" -> "ana"), the
// data-model's fallback display name when no real name is available.
func emailLocal(email string) string {
	local, _, _ := strings.Cut(email, "@")
	return local
}
