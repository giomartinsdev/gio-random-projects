package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"google.golang.org/api/idtoken"
)

// handleAuthGoogle é criação de conta E login na mesma ação: a primeira vez que
// uma conta Google aparece aqui, esse login já cria a pessoa (não há mais nada
// a configurar -- todo dado pessoal já é escopado por usuario_email).
//
// Verifica o ID token contra o JWKS do próprio Google (idtoken.Validate busca e
// cacheia essas chaves) e contra o NOSSO client ID, então um token emitido para
// qualquer outro app do Google não pode ser reapresentado aqui.
func (s *Server) handleAuthGoogle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		// "credential" é o nome do campo no callback do Google Identity
		// Services -- o frontend repassa como veio, sem renomear.
		Credential string `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Credential) == "" {
		writeError(w, http.StatusUnprocessableEntity, "credential é obrigatório")
		return
	}
	if s.googleClientID == "" {
		writeError(w, http.StatusInternalServerError, "login com Google não configurado")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	payload, err := idtoken.Validate(ctx, req.Credential, s.googleClientID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "token do Google inválido ou expirado")
		return
	}

	email, _ := payload.Claims["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		writeError(w, http.StatusUnauthorized, "token do Google sem e-mail")
		return
	}
	// email_verified é o sinal do próprio Google de que o endereço foi
	// confirmado como pertencente à conta -- recusar e-mails não verificados
	// aqui é a única checagem substantiva que idtoken.Validate não faz.
	if verified, _ := payload.Claims["email_verified"].(bool); !verified {
		writeError(w, http.StatusUnauthorized, "e-mail do Google não verificado")
		return
	}
	name, _ := payload.Claims["name"].(string)
	if name == "" {
		name = emailLocal(email)
	}

	if err := s.issueSessionCookie(w, email, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"email": email, "name": name})
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, _ *http.Request) {
	s.clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deslogado"})
}
