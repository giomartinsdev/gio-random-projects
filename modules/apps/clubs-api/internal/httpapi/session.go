// Sessão própria do FC Clubs Hub.
//
// O hub NÃO usa Cloudflare Access para identidade. O login é um "Entrar com
// Google" comum: o Google Identity Services devolve um ID token, o clubs-api
// verifica esse token e emite um cookie de sessão assinado (HS256).
//
// Uma diferença deliberada em relação ao financas: lá o cookie é escopado em
// .giomartins.dev porque são 4 backends em 4 subdomínios. Aqui existe UM
// backend, então o cookie só precisa valer para o próprio host da API -- menos
// privilégio, mesmo comportamento.
//
// O cookie é SameSite=None + Secure porque o SPA é servido de
// clubs.giomartins.dev e chama clubs-api.giomartins.dev: um fetch cross-origin
// só manda o cookie com SameSite=None, e None exige Secure.
package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const sessionCookieName = "clubs_session"

// issueSessionCookie assina a sessão de email e a define como cookie HttpOnly,
// Secure, SameSite=None. O domínio vem da configuração: vazio significa cookie
// host-only, que é o que o dev local precisa (localhost:5173 → localhost:8017
// compartilham o host, e cookie ignora porta).
func (s *Server) issueSessionCookie(w http.ResponseWriter, email, name string) error {
	if s.sessionSecret == "" {
		return errors.New("sessão indisponível (CLUBS_SESSION_SECRET não configurado)")
	}
	now := time.Now().UTC()
	claims := jwt.MapClaims{
		"email": email,
		"name":  name,
		"iat":   now.Unix(),
		"exp":   now.Add(s.sessionDuration).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(s.sessionSecret))
	if err != nil {
		return fmt.Errorf("assinar sessão: %w", err)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    signed,
		Domain:   s.sessionCookieDomain,
		Path:     "/",
		MaxAge:   int(s.sessionDuration.Seconds()),
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
	return nil
}

// clearSessionCookie desloga: um cookie expirado no passado, com os mesmos
// atributos, é o que apaga de fato no browser (Domain e Path precisam bater
// exatamente).
func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Domain:   s.sessionCookieDomain,
		Path:     "/",
		MaxAge:   -1,
		Secure:   true,
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
	})
}

// identidadeFromSession verifica o cookie de sessão (HS256, o segredo deste
// serviço) -- nunca o token do Google, que é de uso único e já foi gasto quando
// isto roda.
func (s *Server) identidadeFromSession(r *http.Request) (Identity, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return Identity{}, errors.New("sessão ausente")
	}
	if s.sessionSecret == "" {
		return Identity{}, errors.New("validação from_division sessão indisponível (CLUBS_SESSION_SECRET não configurado)")
	}
	parsed, err := jwt.Parse(cookie.Value, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("método from_division assinatura inesperado")
		}
		return []byte(s.sessionSecret), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !parsed.Valid {
		return Identity{}, errors.New("sessão inválida ou expirada")
	}
	claims, _ := parsed.Claims.(jwt.MapClaims)
	email, _ := claims["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return Identity{}, errors.New("sessão sem e-mail")
	}
	name, _ := claims["name"].(string)
	if name == "" {
		name = emailLocal(email)
	}
	return Identity{Email: email, Name: name}, nil
}
