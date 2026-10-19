// Package httpapi é a borda HTTP: traduz JSON ↔ domínio, decide status code e
// não contém regra de negócio. Toda regra que importa (opt-in, template
// aprovado, telefone configurado) mora no domínio ou no serviço — aqui só se
// escolhe como o erro aparece para o cliente.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

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
	case errors.Is(err, domain.ErrUnauthorized):
		writeError(w, http.StatusUnauthorized, "sessão inválida: entre de novo")
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
