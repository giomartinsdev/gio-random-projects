// Identity = Cloudflare Access, the same shape bet-api's /api path uses.
//
// The bare hostname clubs-api.giomartins.dev is PUBLIC — a visitor with no
// account reads the whole public dataset, which is the point of the product.
// Only the /api path carries an Access application (see
// path_protected_hostnames in locals.tf), so this middleware is mounted on
// the personal routes only. The edge stamps every request it passes through
// with the Cf-Access-Jwt-Assertion header; this verifies it properly —
// signature against the team JWKS, issuer against the team domain, audience
// against this app's aud — because the same ingress also routes direct
// (non-edge) traffic here, so anyone bypassing Cloudflare still needs a
// valid JWT.
//
// CLUBS_DEV_BYPASS_AUTH + CLUBS_DEV_USER_EMAIL is the explicit local-dev
// escape hatch, mirroring harness-api/bet-api: with no JWT present, requests
// run as that email. It must stay unset in prod.
package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
)

// Identity is who is calling. Email is the stable key everywhere (it is what
// a watchlist entry's usuario_email stores in domain-api).
type Identity struct {
	Email string
}

type identityContextKey struct{}

// WithIdentity puts an Identity in a request context — exported for tests,
// which build requests as already-authenticated users this way.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityContextKey{}, id)
}

// IdentityFrom reads the caller's Identity, set by the auth middleware.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityContextKey{}).(Identity)
	return id, ok
}

// AccessAuth verifies Cloudflare Access JWTs against the team's JWKS.
type AccessAuth struct {
	jwks          keyfunc.Keyfunc
	issuer        string
	audiences     []string
	allowedEmails []string
	devEmail      string
	log           *slog.Logger
}

// NewAccessAuth builds the verifier. An empty teamDomain (local dev without
// Access) leaves jwks nil, and only the dev bypass can authenticate — which
// is exactly the intended local-dev behavior.
func NewAccessAuth(teamDomain string, audiences, allowedEmails []string, devEmail string, log *slog.Logger) (*AccessAuth, error) {
	a := &AccessAuth{
		issuer:        "https://" + teamDomain,
		audiences:     audiences,
		allowedEmails: allowedEmails,
		devEmail:      strings.ToLower(strings.TrimSpace(devEmail)),
		log:           log,
	}
	if teamDomain == "" {
		return a, nil
	}
	jwks, err := keyfunc.NewDefault([]string{a.issuer + "/cdn-cgi/access/certs"})
	if err != nil {
		return nil, err
	}
	a.jwks = jwks
	return a, nil
}

// Enabled reports whether real verification is wired up.
func (a *AccessAuth) Enabled() bool { return a != nil && a.jwks != nil }

// verify resolves the caller's identity from the Access JWT (or the dev
// bypass). It never trusts the edge's decision alone.
func (a *AccessAuth) verify(r *http.Request) (Identity, error) {
	token := r.Header.Get("Cf-Access-Jwt-Assertion")
	if token == "" {
		if a.devEmail != "" {
			return Identity{Email: a.devEmail}, nil
		}
		return Identity{}, errors.New("not authenticated")
	}
	if a.jwks == nil {
		return Identity{}, errors.New("access verification not configured")
	}

	parsed, err := jwt.Parse(token, a.jwks.Keyfunc,
		jwt.WithIssuer(a.issuer),
		jwt.WithAudience(a.audiences...),
		jwt.WithValidMethods([]string{"RS256"}))
	if err != nil || !parsed.Valid {
		return Identity{}, errors.New("invalid access token")
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return Identity{}, errors.New("invalid access claims")
	}
	email, _ := claims["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return Identity{}, errors.New("access token has no email claim")
	}
	if len(a.allowedEmails) > 0 && !contains(a.allowedEmails, email) {
		return Identity{}, errors.New("email not allowed")
	}
	return Identity{Email: email}, nil
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if strings.EqualFold(strings.TrimSpace(s), v) {
			return true
		}
	}
	return false
}

// requireIdentity resolves identity before a handler runs. Used on the
// personal routes only — the public dataset stays reachable with no account.
func (a *AccessAuth) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFrom(r.Context())
		if !ok {
			var err error
			if id, err = a.verify(r); err != nil {
				writeError(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			r = r.WithContext(WithIdentity(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}
