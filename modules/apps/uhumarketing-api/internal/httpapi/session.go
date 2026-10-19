package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/auth"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// Sessão na requisição.
//
// Antes daqui, a borda autenticava com uma chave de API fixa e todo mundo caía
// no mesmo workspace. Com contas de verdade, o workspace vem do token — é o
// middleware que impede uma conta de ler a outra, e nenhuma query precisa
// "lembrar" de filtrar por dono além do workspace_id que já recebe.

type sessionKey struct{}

// sessionAuth resolve o token em Session e coloca no contexto. Sem token
// válido, 401 e a rota nem roda.
func sessionAuth(authStore *store.Store, log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				writeError(w, http.StatusUnauthorized, "sessão ausente: entre na sua conta")
				return
			}
			sess, err := auth.Resolve(r.Context(), authStore, token)
			if err != nil {
				writeError(w, http.StatusUnauthorized, "sessão expirada: entre de novo")
				return
			}
			log.Debug("sessão", "user", sess.UserID, "workspace", sess.WorkspaceID)
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, sess)))
		})
	}
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	// Compatibilidade com o cliente antigo da POC, que mandava X-API-Key com o
	// token de sessão no mesmo campo.
	if v := r.Header.Get("X-API-Key"); v != "" {
		return v
	}
	return ""
}

// sessionFrom devolve a sessão da requisição. Os handlers autenticados só
// rodam atrás do middleware, então a ausência aqui é bug de rota, não de
// cliente.
func sessionFrom(r *http.Request) store.Session {
	sess, _ := r.Context().Value(sessionKey{}).(store.Session)
	return sess
}

// workspaceID é o atalho que os handlers usam: o workspace é sempre o da
// sessão, nunca um campo do corpo.
func workspaceID(r *http.Request) string { return sessionFrom(r).WorkspaceID }
