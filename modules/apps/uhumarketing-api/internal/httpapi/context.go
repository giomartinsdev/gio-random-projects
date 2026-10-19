package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

func contextWithLabel(r *http.Request, label string) context.Context {
	return context.WithValue(r.Context(), ctxKey{}, label)
}

// labelFrom devolve o rótulo da chave que fez a chamada (para log/auditoria).
func labelFrom(r *http.Request) string {
	if v, ok := r.Context().Value(ctxKey{}).(string); ok {
		return v
	}
	return ""
}

func itoa(n int) string { return strconv.Itoa(n) }

func lowerTrim(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}
