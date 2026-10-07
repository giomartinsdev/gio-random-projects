package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/auth"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/identity"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/infrastructure"
)

// authRoutes registers /auth/signup, /auth/login, /auth/me and /auth/logout on
// mux. They are public (no session required) and are the only writers of the
// session cookie.
func authRoutes(mux *http.ServeMux, h *Handlers) {
	mux.HandleFunc("POST /auth/signup", h.Signup)
	mux.HandleFunc("POST /auth/login", h.Login)
	mux.HandleFunc("GET /auth/me", h.Me)
	mux.HandleFunc("POST /auth/logout", h.Logout)
}

// Signup handles POST /auth/signup. The contract is frozen:
//   - 201 {user, company} + Set-Cookie on success;
//   - 422 on an invalid name/e-mail/password/company.name;
//   - 409 when the e-mail is already registered;
//   - 503 when sessions are not configured.
func (h *Handlers) Signup(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil || !h.auth.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "autenticação indisponível")
		return
	}
	var in auth.SignupInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	session, body, err := h.auth.Signup(r.Context(), in)
	if err != nil {
		h.writeAuthError(w, r, "signup", err)
		return
	}
	if err := h.auth.Sessions().SetCookie(w, session); err != nil {
		h.writeAuthError(w, r, "signup", err)
		return
	}
	writeJSON(w, http.StatusCreated, body)
}

// Login handles POST /auth/login: 200 {user, company} + Set-Cookie, or 401 for
// both a wrong password and an unknown user.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	if h.auth == nil || !h.auth.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "autenticação indisponível")
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "corpo inválido")
		return
	}
	session, body, err := h.auth.Login(r.Context(), in.Email, in.Password)
	if err != nil {
		h.writeAuthError(w, r, "login", err)
		return
	}
	if err := h.auth.Sessions().SetCookie(w, session); err != nil {
		h.writeAuthError(w, r, "login", err)
		return
	}
	writeJSON(w, http.StatusOK, body)
}

// Me handles GET /auth/me: 200 {user, company} for a valid session, 401 else.
func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	session, ok := h.sessionFrom(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "não autenticado")
		return
	}
	writeJSON(w, http.StatusOK, h.auth.Me(r.Context(), session))
}

// Logout handles POST /auth/logout: 204 and a cleared cookie. It is idempotent
// -- logging out with no session is still a 204.
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if h.auth != nil && h.auth.Sessions() != nil {
		h.auth.Sessions().ClearCookie(w)
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeAuthError maps an auth failure to the contract's status codes.
func (h *Handlers) writeAuthError(w http.ResponseWriter, r *http.Request, what string, err error) {
	switch {
	case errors.Is(err, auth.ErrDisabled), errors.Is(err, infrastructure.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, "autenticação indisponível")
	case errors.Is(err, domain.ErrUserExists):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrUserNameRequired),
		errors.Is(err, domain.ErrUserEmailInvalid),
		errors.Is(err, domain.ErrUserPasswordWeak),
		errors.Is(err, domain.ErrCompanyNameRequired):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case errors.Is(err, auth.ErrInvalidCredentials):
		writeError(w, http.StatusUnauthorized, "e-mail ou senha inválidos")
	default:
		h.log.ErrorContext(r.Context(), "auth", "op", what, "error", err)
		writeError(w, http.StatusBadGateway, "falha ao processar autenticação")
	}
}

// sessionFrom is the nil-safe session read used by Me and the middleware.
func (h *Handlers) sessionFrom(r *http.Request) (auth.Session, bool) {
	if h.auth == nil {
		return auth.Session{}, false
	}
	return h.auth.Sessions().SessionFrom(r)
}

// resolveIdentity is the single identity door for both auth and business
// routes:
//
//   - a valid session cookie wins and scopes the request to the user's tenant;
//   - else a valid X-API-Key identifies the operator and scopes it to the fixed
//     PROSPECTA_TENANT_ID (the flow that existed before sessions);
//   - else no identity: 401.
//
// An empty configured API key lets requests through with no identity (dev), as
// before.
func (h *Handlers) resolveIdentity(r *http.Request) (identity.Identity, bool) {
	if session, ok := h.sessionFrom(r); ok {
		return identity.Identity{
			UserID:    session.UserID,
			Email:     session.Email,
			Name:      session.Name,
			CompanyID: session.CompanyID,
			TenantID:  session.TenantID,
		}, true
	}
	if h.apiKey == "" {
		return identity.Identity{}, true
	}
	got := r.Header.Get("X-API-Key")
	if subtleConstantTimeEqual(got, h.apiKey) {
		return identity.Identity{TenantID: h.tenantID, Operator: true}, true
	}
	return identity.Identity{}, false
}

// requireIdentity injects the resolved identity into the request context. It is
// the guard for every business route: a request must present a session OR a
// valid X-API-Key.
func (h *Handlers) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := h.resolveIdentity(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		r = r.WithContext(identity.With(r.Context(), id))
		next.ServeHTTP(w, r)
	})
}

// subtleConstantTimeEqual compares two secrets in constant time.
func subtleConstantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
