// This service only ever VERIFIES the financas_session cookie -- it's
// contas-api that verifies the Google ID token and mints the cookie in
// the first place (see that service's own session.go for the issuing
// half and the reasoning behind Domain=.giomartins.dev).
package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const sessionCookieName = "financas_session"

func (s *Server) identidadeFromSession(r *http.Request) (Identity, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return Identity{}, errors.New("sessão ausente")
	}
	if s.cfg.SessionSecret == "" {
		return Identity{}, errors.New("validação de sessão indisponível (FINANCAS_SESSION_SECRET não configurado)")
	}
	parsed, err := jwt.Parse(cookie.Value, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("método de assinatura inesperado")
		}
		return []byte(s.cfg.SessionSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !parsed.Valid {
		return Identity{}, errors.New("sessão inválida ou expirada")
	}
	claims, _ := parsed.Claims.(jwt.MapClaims)
	email, _ := claims["email"].(string)
	if email == "" {
		return Identity{}, errors.New("sessão sem e-mail")
	}
	nome, _ := claims["name"].(string)
	if nome == "" {
		nome = emailLocal(strings.ToLower(email))
	}
	return Identity{Email: strings.ToLower(email), Nome: nome}, nil
}
