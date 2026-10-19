package httpapi

import (
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/auth"
)

// Rotas de conta. São as únicas em /api/v1 que NÃO exigem sessão — login e
// cadastro são justamente como se obtém uma.

type signupInput struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Company  string `json:"company"`
}

func (h *Handlers) Signup(w http.ResponseWriter, r *http.Request) {
	var in signupInput
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	acc, err := auth.Signup(r.Context(), h.Service.Store, in.Name, in.Email, in.Password, in.Company)
	if err != nil {
		if err == auth.ErrEmailTaken {
			writeError(w, http.StatusConflict, "já existe uma conta com este e-mail")
			return
		}
		writeDomainError(w, h.Log, err)
		return
	}
	writeJSON(w, http.StatusCreated, acc)
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decode(r, &in); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	acc, err := auth.Login(r.Context(), h.Service.Store, in.Email, in.Password)
	if err != nil {
		// Credencial errada é 401, não 422: a diferença importa para o cliente
		// saber que deve mostrar "e-mail ou senha inválidos", não um erro de
		// formulário.
		writeError(w, http.StatusUnauthorized, "e-mail ou senha inválidos")
		return
	}
	writeJSON(w, http.StatusOK, acc)
}

func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if err := auth.Logout(r.Context(), h.Service.Store, bearerToken(r)); err != nil {
		writeDomainError(w, h.Log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Me devolve a conta da sessão — o que a SPA usa para restaurar o usuário no
// boot sem guardar nome/e-mail no localStorage como verdade.
func (h *Handlers) Me(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"userId": sess.UserID, "workspaceId": sess.WorkspaceID,
		"name": sess.Name, "email": sess.Email,
	})
}
