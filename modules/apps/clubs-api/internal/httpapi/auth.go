// Identidade do FC Clubs Hub: sessão própria, não Cloudflare Access.
//
// O fluxo é o de um "Entrar com Google" comum, e ele é o ÚNICO caminho de
// entrada -- não há edge de Access na frente deste host:
//
//  1. o SPA carrega o Google Identity Services e renderiza o botão oficial;
//  2. o Google devolve um ID token (JWT assinado pelo Google);
//  3. o SPA manda esse token para POST /api/auth/google;
//  4. este serviço verifica o token contra o JWKS do Google E contra o nosso
//     client ID (handleAuthGoogle, em authhandlers.go);
//  5. verificada, emite o cookie clubs_session;
//  6. toda requisição seguinte se identifica por esse cookie.
//
// O primeiro login de uma conta Google JÁ É a criação da conta: não há cadastro
// separado, porque todo dado pessoal do hub é particionado por e-mail.
package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

// Identity é quem está chamando. Email é a chave estável em todo lugar (é o que
// vai em usuario_email na base de domínio); Nome é só exibição.
type Identity struct {
	Email string
	Name  string
}

type identityContextKey struct{}

// WithIdentity põe uma Identity no contexto da requisição — exportado para os
// testes, que montam requisições como usuário já autenticado; em produção o
// único escritor é o middleware abaixo.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityContextKey{}, id)
}

// IdentityFrom lê a Identity do contexto, definida pelo middleware.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityContextKey{}).(Identity)
	return id, ok
}

// AuthEnabled reporta se a emissão de sessão está configurada. Sem segredo não
// há como assinar cookie, então /api/auth/google não consegue logar ninguém.
func (s *Server) AuthEnabled() bool { return s.sessionSecret != "" }

// verify resolve a identidade: a sessão primeiro; se não houver e a escotilha
// de dev estiver ligada, o e-mail de dev.
func (s *Server) verify(r *http.Request) (Identity, error) {
	if id, err := s.identidadeFromSession(r); err == nil {
		return id, nil
	}
	if s.devEmail != "" {
		return Identity{Email: s.devEmail, Name: emailLocal(s.devEmail)}, nil
	}
	return Identity{}, errors.New("não autenticado")
}

// requireIdentity protege as rotas pessoais. As rotas públicas continuam
// abertas: o dataset do hub é público de propósito, e o login só liga a camada
// pessoal.
func (s *Server) requireIdentity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := IdentityFrom(r.Context())
		if !ok {
			var err error
			if id, err = s.verify(r); err != nil {
				writeError(w, http.StatusUnauthorized, "nao_autenticado")
				return
			}
			r = r.WithContext(WithIdentity(r.Context(), id))
		}
		next.ServeHTTP(w, r)
	})
}

// sessionTTL é a duração padrão de uma sessão quando nada é configurado.
const sessionTTL = 30 * 24 * time.Hour

// emailLocal é a parte local de um e-mail ("ana@corp" -> "ana"), o nome de
// exibição de fallback quando não há um nome real.
func emailLocal(email string) string {
	local, _, _ := strings.Cut(email, "@")
	return local
}
