package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"google.golang.org/api/idtoken"
)

// registrarRotasAuth wires the two public auth routes: this is the ONE
// financas backend that ever sees a Google ID token or mints the
// session cookie the other 3 verify (see session.go).
func (s *Server) registrarRotasAuth() {
	s.mux.HandleFunc("POST /api/auth/google", s.handleAuthGoogle)
	s.mux.HandleFunc("POST /api/auth/logout", s.handleAuthLogout)
}

type authGoogleRequest struct {
	// "credential" matches Google Identity Services' own callback
	// field name for the ID token -- the frontend forwards it as-is,
	// no renaming.
	Credential string `json:"credential"`
}

// handleAuthGoogle is account creation AND login in one action: the
// first time a given Google account shows up here, that login itself
// creates the pessoa usuária (nothing else to set up -- every module
// already scopes data by usuario_email alone). Verifies the ID token
// against Google's own JWKS (idtoken.Validate fetches and caches those
// keys itself) and against our OAuth client ID, so a token minted for
// some unrelated Google app can't be replayed here.
func (s *Server) handleAuthGoogle(w http.ResponseWriter, r *http.Request) {
	var req authGoogleRequest
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Credential) == "" {
		writeError(w, http.StatusUnprocessableEntity, "validacao", "credential é obrigatório")
		return
	}
	if s.cfg.GoogleClientID == "" {
		writeError(w, http.StatusInternalServerError, "auth_indisponivel", "login com Google não configurado")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	payload, err := idtoken.Validate(ctx, req.Credential, s.cfg.GoogleClientID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "token_invalido", "token do Google inválido ou expirado")
		return
	}

	email, _ := payload.Claims["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		writeError(w, http.StatusUnauthorized, "token_invalido", "token do Google sem e-mail")
		return
	}
	// email_verified is Google's own signal that the address on the
	// token was actually confirmed to belong to the account -- refusing
	// unverified emails here is the one substantive check idtoken.Validate
	// doesn't already make for us.
	if verified, _ := payload.Claims["email_verified"].(bool); !verified {
		writeError(w, http.StatusUnauthorized, "email_nao_verificado", "e-mail do Google não verificado")
		return
	}
	nome, _ := payload.Claims["name"].(string)
	if nome == "" {
		nome = emailLocal(email)
	}

	if err := s.issueSessionCookie(w, email, nome); err != nil {
		writeError(w, http.StatusInternalServerError, "auth_indisponivel", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"email": email, "nome": nome})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, _ *http.Request) {
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deslogado"})
}
