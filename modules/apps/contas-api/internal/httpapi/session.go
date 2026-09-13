// Package httpapi's own session: financas stopped relying on Cloudflare
// Access for identity (the user's own account creation is a plain
// "Sign in with Google" on the frontend, open to any Google account --
// no Access allowlist, no team login page in the way). This service is
// the one that actually verifies the Google ID token and mints the
// session; the other 3 financas backends only ever verify the cookie
// this issues (see their own session.go, byte-for-byte the same
// verify half, copied like every other cross-service pattern in this
// repo since there's no shared Go module).
//
// The cookie is set with Domain=.giomartins.dev on purpose: the 4
// financas backends live on 4 different subdomains, and a session has
// to be readable by all of them without a shared session store --
// HMAC-signing it with a secret only those 4 processes know is what
// makes that safe (any other subdomain's server just ignores a cookie
// name it doesn't recognize; HttpOnly keeps it from every subdomain's
// own JS).
package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const sessionCookieName = "financas_session"

// issueSessionCookie signs a session for email/nome and sets it as an
// HttpOnly, Secure, SameSite=None cookie scoped to every financas
// subdomain. SameSite=None is required for it to ride along on the
// cross-origin fetches financas-frontend makes to the other 3
// backends; that in turn requires Secure, which is fine since
// everything here runs behind TLS in production.
func (s *Server) issueSessionCookie(w http.ResponseWriter, email, nome string) error {
	if s.cfg.SessionSecret == "" {
		return errors.New("sessão indisponível (FINANCAS_SESSION_SECRET não configurado)")
	}
	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"email": email,
		"name":  nome,
		"iat":   now.Unix(),
		"exp":   now.Add(s.cfg.SessionDuration).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(s.cfg.SessionSecret))
	if err != nil {
		return fmt.Errorf("assinar sessão: %w", err)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    signed,
		Domain:   s.cfg.SessionCookieDomain,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionDuration.Seconds()),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
	return nil
}

// clearSessionCookie logs the caller out -- an expired-in-the-past
// cookie with the same Domain/Path is what actually deletes it in the
// browser (attributes must match exactly for the deletion to take).
func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Domain:   s.cfg.SessionCookieDomain,
		Path:     "/",
		MaxAge:   -1,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
}

// identidadeFromSession verifies the financas_session cookie (HS256,
// this service's own signing secret -- never the Google token itself,
// which is single-use and already spent by the time this runs).
func (s *Server) identidadeFromSession(r *http.Request) (Identity, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return Identity{}, errors.New("sessão ausente")
	}
	if s.cfg.SessionSecret == "" {
		return Identity{}, errors.New("validação de sessão indisponível (FINANCAS_SESSION_SECRET não configurado)")
	}
	parsed, err := jwt.Parse(cookie.Value, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("método de assinatura inesperado")
		}
		return []byte(s.cfg.SessionSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !parsed.Valid {
		return Identity{}, errors.New("sessão inválida ou expirada")
	}
	claims, _ := parsed.Claims.(jwt.MapClaims)
	email, _ := claims["email"].(string)
	if email == "" {
		return Identity{}, errors.New("sessão sem e-mail")
	}
	nome, _ := claims["name"].(string)
	if nome == "" {
		nome = emailLocal(strings.ToLower(email))
	}
	return Identity{Email: strings.ToLower(email), Nome: nome}, nil
}
