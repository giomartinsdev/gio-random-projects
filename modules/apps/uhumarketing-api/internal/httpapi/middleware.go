// Package httpapi é a borda HTTP: traduz JSON ↔ domínio, decide status code e
// não contém regra de negócio. Toda regra que importa (opt-in, template
// aprovado, telefone configurado) mora no domínio ou no serviço — aqui só se
// escolhe como o erro aparece para o cliente.
package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// APIKeys é o mapa chave→rótulo lido de UHU_API_KEYS. O rótulo é só para log.
type APIKeys map[string]string

func (k APIKeys) Label(key string) (string, bool) {
	for candidate, label := range k {
		if subtle.ConstantTimeCompare([]byte(candidate), []byte(key)) == 1 {
			return label, true
		}
	}
	return "", false
}

type ctxKey struct{}

// secure exige X-API-Key (ou Bearer) em tudo que não é público. Público:
// /healthz, o handshake do webhook e o próprio webhook (que se autentica por
// assinatura HMAC, não por chave de API).
func secure(next http.Handler, keys APIKeys, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("X-API-Key")
		if key == "" {
			if bearer := r.Header.Get("Authorization"); strings.HasPrefix(bearer, "Bearer ") {
				key = strings.TrimPrefix(bearer, "Bearer ")
			}
		}
		label, ok := keys.Label(key)
		if !ok {
			writeError(w, http.StatusUnauthorized, "chave de API inválida ou ausente (X-API-Key)")
			return
		}
		ctx := contextWithLabel(r, label)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// cors libera a SPA em desenvolvimento. Em produção o app é servido do mesmo
// host e isto pode ficar restrito a uma origem.
func cors(origins []string, next http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, o := range origins {
		allowed[o] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (allowed[origin] || allowed["*"]) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key, Authorization")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

/* ------------------------------------------------------------------ JSON */

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if body == nil {
		return
	}
	_ = json.NewEncoder(w).Encode(body)
}

type errorBody struct {
	Error  string `json:"error"`
	Field  string `json:"field,omitempty"`
	Status int    `json:"status"`
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorBody{Error: msg, Status: status})
}

// writeDomainError traduz o erro de domínio no status que a SPA entende. É o
// único lugar com esse mapa: espalhar `switch` de erro pelos handlers faria as
// telas receberem 500 para um caso previsto.
func writeDomainError(w http.ResponseWriter, log *slog.Logger, err error) {
	var verr domain.ValidationError
	switch {
	case errors.As(err, &verr):
		writeJSON(w, http.StatusUnprocessableEntity, errorBody{
			Error: verr.Message, Field: verr.Field, Status: http.StatusUnprocessableEntity,
		})
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "não encontrado")
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "já existe um registro com este valor")
	default:
		log.Error("erro interno", "error", err)
		writeError(w, http.StatusInternalServerError, "erro interno")
	}
}

func decode(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return domain.Invalid("body", "JSON inválido: "+err.Error())
	}
	return nil
}
