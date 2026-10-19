package httpapi

import (
	"net/http"
	"strconv"
	"strings"
)

// callerFrom identifica quem fez a chamada para o log. Depois das contas, isso
// é o usuário da sessão — não mais o rótulo de uma chave de API.
func callerFrom(r *http.Request) string {
	if sess := sessionFrom(r); sess.UserID != "" {
		return sess.UserID
	}
	return "anon"
}

func itoa(n int) string { return strconv.Itoa(n) }

func lowerTrim(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}
