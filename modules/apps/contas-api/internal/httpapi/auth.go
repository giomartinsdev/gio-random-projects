// Identity = financas' own session (see session.go), not Cloudflare
// Access anymore. The first "Sign in with Google" IS account creation
// -- any Google account works, no allowlist, no Access team login page
// in the way. CONTAS_DEV_BYPASS_AUTH=1 is the local-dev escape hatch:
// with no session cookie present, requests run as the
// CONTAS_DEV_USER_* user. Tests skip the middleware entirely by
// injecting an Identity straight into the request context.
package httpapi

import (
	"context"
	"net/http"
	"strings"
)

// Identity is who is calling. Email is the stable key everywhere; Nome
// is display only, from the Google account's "name" claim.
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
// a handler. Routes that are public by design (/api/health,
// /api/auth/google, /api/auth/logout) are exempted in Handler().
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

// identidade verifies the financas_session cookie or, in dev bypass
// mode with none present, returns the configured dev user.
func (s *Server) identidade(r *http.Request) (Identity, error) {
	id, err := s.identidadeFromSession(r)
	if err == nil {
		return id, nil
	}
	if s.cfg.DevBypassAuth {
		return s.cfg.devIdentity(), nil
	}
	return Identity{}, err
}

// devIdentity is the user CONTAS_DEV_BYPASS_AUTH=1 runs as.
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
// fallback display name when no real name is available.
func emailLocal(email string) string {
	local, _, _ := strings.Cut(email, "@")
	return local
}
