// Package auth is prospecta-api's own session layer: it mints and verifies the
// host-only JWT session cookie and holds the signup/login use cases. It mirrors
// clubs-api's session.go (HS256, HttpOnly, SameSite=None, Secure) and
// finance-api's session.py, but authenticates with e-mail + password instead of
// Google.
//
// The cookie is host-only on purpose: the SPA and the API are distinct origins
// on the same host (prospecta. and prospecta-api.), so SameSite=None; Secure is
// required for the cross-origin fetch to send it, but it must not leak to other
// subdomains. Without PROSPECTA_SESSION_SECRET the whole /auth surface answers
// 503 and the service keeps serving everything else.
package auth

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// SessionCookieName is the cookie's name, fixed by the contract.
const SessionCookieName = "prospecta_session"

// ErrDisabled is returned when signing is asked for with no configured secret.
// The transport maps it to 503, never to a 500 that would take the service down.
var ErrDisabled = errors.New("sessão indisponível (PROSPECTA_SESSION_SECRET não configurado)")

const sessionAlg = "HS256"

// Session is who is logged in and which tenant/company is theirs. It is the
// claim set that rides in the cookie.
type Session struct {
	UserID    string
	Email     string
	Name      string
	CompanyID string
	TenantID  string
}

// Manager mints and verifies session cookies with one HS256 secret. A zero
// TTL falls back to DefaultTTL.
type Manager struct {
	secret string
	ttl    time.Duration
}

// DefaultTTL is the session lifetime when nothing else is configured (30 days,
// matching the other apps' sessions).
const DefaultTTL = 30 * 24 * time.Hour

// NewManager builds the manager. An empty secret leaves it disabled: Enabled()
// reports false and Issue errors, which is what turns /auth into 503 in dev.
func NewManager(secret string, ttl time.Duration) *Manager {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	return &Manager{secret: secret, ttl: ttl}
}

// Enabled reports whether the manager can sign and verify cookies.
func (m *Manager) Enabled() bool { return m != nil && m.secret != "" }

// TTL is the session's lifetime, used by both the cookie MaxAge and the exp
// claim so they never drift.
func (m *Manager) TTL() time.Duration { return m.ttl }

// Issue signs a session token and returns the raw cookie value.
func (m *Manager) Issue(s Session) (string, error) {
	if !m.Enabled() {
		return "", ErrDisabled
	}
	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"user_id":    s.UserID,
		"email":      s.Email,
		"name":       s.Name,
		"company_id": s.CompanyID,
		"tenant_id":  s.TenantID,
		"iat":        now.Unix(),
		"exp":        now.Add(m.ttl).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(m.secret))
	if err != nil {
		return "", fmt.Errorf("assinar sessão: %w", err)
	}
	return signed, nil
}

// Verify checks the cookie value and returns the session. Any expired,
// tampered, wrong-algorithm or empty token is rejected as "not logged in".
func (m *Manager) Verify(raw string) (Session, error) {
	if !m.Enabled() {
		return Session{}, ErrDisabled
	}
	if strings.TrimSpace(raw) == "" {
		return Session{}, errors.New("sessão ausente")
	}
	parsed, err := jwt.Parse(raw, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("método de assinatura inesperado")
		}
		return []byte(m.secret), nil
	}, jwt.WithValidMethods([]string{sessionAlg}))
	if err != nil || !parsed.Valid {
		return Session{}, errors.New("sessão inválida ou expirada")
	}
	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return Session{}, errors.New("claims ilegíveis")
	}
	s := Session{
		UserID:    claimString(claims, "user_id"),
		Email:     claimString(claims, "email"),
		Name:      claimString(claims, "name"),
		CompanyID: claimString(claims, "company_id"),
		TenantID:  claimString(claims, "tenant_id"),
	}
	if s.UserID == "" || s.Email == "" || s.TenantID == "" {
		return Session{}, errors.New("sessão sem identidade")
	}
	return s, nil
}

// SetCookie writes the signed session as a host-only, HttpOnly, Secure,
// SameSite=None cookie (no Domain), so a cross-origin fetch from the SPA sends
// it but other subdomains never receive it.
func (m *Manager) SetCookie(w http.ResponseWriter, s Session) error {
	value, err := m.Issue(s)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(m.ttl.Seconds()),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
	return nil
}

// ClearCookie expires the session cookie. The attributes must match SetCookie
// exactly (Path, and no Domain) for the browser to actually drop it.
func (m *Manager) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
}

// SessionFrom reads and verifies the session cookie off the request. A missing
// or invalid cookie yields ok=false -- never an error the caller must handle.
func (m *Manager) SessionFrom(r *http.Request) (Session, bool) {
	if !m.Enabled() {
		return Session{}, false
	}
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil {
		return Session{}, false
	}
	s, err := m.Verify(cookie.Value)
	if err != nil {
		return Session{}, false
	}
	return s, true
}

func claimString(claims jwt.MapClaims, key string) string {
	v, _ := claims[key].(string)
	return strings.TrimSpace(v)
}
