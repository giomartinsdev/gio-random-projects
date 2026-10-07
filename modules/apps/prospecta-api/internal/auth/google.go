package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"google.golang.org/api/idtoken"
)

// GoogleIdentity é quem o ID token do Google afirma ser: o e-mail (chave global
// do login, sempre normalizado em minúsculas) e o nome de exibição (só
// decoração; pode vir vazio).
type GoogleIdentity struct {
	Email string
	Name  string
}

// Erros do SSO. O transporte mapeia qualquer um destes a 401, exceto
// ErrGoogleDisabled, que é configuração (503) — nunca token ruim.
var (
	ErrGoogleInvalid    = errors.New("token do Google inválido ou expirado")
	ErrGoogleUnverified = errors.New("e-mail do Google não verificado")
	ErrGoogleNoEmail    = errors.New("token do Google sem e-mail")
	// ErrGoogleDisabled diz que não há client ID configurado. É o mesmo caso do
	// /auth sem PROSPECTA_SESSION_SECRET: o serviço sobe e a rota responde 503.
	ErrGoogleDisabled = errors.New("login com Google não configurado")
)

// GoogleVerifier é a única coisa que confia no Google. O resto do SSO (sessão,
// cookie, identidade) é nosso e testado sem rede; os testes injetam um fake que
// nunca fala com o Google.
type GoogleVerifier interface {
	Verify(credential string) (GoogleIdentity, error)
}

// NewGoogleVerifier devolve o verificador real, ou nil quando não há client ID
// configurado (Login com Google desabilitado → 503). O import do idtoken vive
// SÓ neste arquivo: é a fronteira da dependência do Google, para o resto do
// serviço compilar e subir sem que ela vaze para o domínio ou a borda.
func NewGoogleVerifier(clientID string) GoogleVerifier {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return nil
	}
	return &googleVerifier{clientID: clientID}
}

type googleVerifier struct{ clientID string }

// Verify valida o ID token contra o JWKS do Google E contra o nosso client ID,
// e exige email_verified — a única checagem substantiva que idtoken.Validate
// não faz. Qualquer falha vira um dos sentinelas acima.
func (v *googleVerifier) Verify(credential string) (GoogleIdentity, error) {
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return GoogleIdentity{}, ErrGoogleInvalid
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	payload, err := idtoken.Validate(ctx, credential, v.clientID)
	if err != nil {
		return GoogleIdentity{}, ErrGoogleInvalid
	}
	email, _ := payload.Claims["email"].(string)
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return GoogleIdentity{}, ErrGoogleNoEmail
	}
	verified, _ := payload.Claims["email_verified"].(bool)
	if !verified {
		return GoogleIdentity{}, ErrGoogleUnverified
	}
	name, _ := payload.Claims["name"].(string)
	return GoogleIdentity{Email: email, Name: strings.TrimSpace(name)}, nil
}
