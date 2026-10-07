package prospecta

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrEmailRequired        = errors.New("email is required")
	ErrEmailInvalid         = errors.New("email is invalid")
	ErrPasswordHashRequired = errors.New("password_hash is required")
)

// User é a conta de autenticação do Prospecta: e-mail + senha (bcrypt) para o
// login. O e-mail é a identidade e é ÚNICO GLOBALMENTE (índice em lower(email)),
// por isso a leitura por e-mail é cross-tenant — o login acha o usuário antes de
// saber o tenant. O password_hash já chega pronto (bcrypt): o domínio nunca vê a
// senha em claro e nunca faz hashing; ele só guarda o que veio.
type User struct {
	ID           string
	TenantID     string
	CompanyID    string
	Name         string
	Email        string
	PasswordHash string
	Role         string
	CreatedAt    time.Time
}

// NewUser valida os invariantes: tenant e empresa de origem, e-mail (não vazio e
// com formato plausível) e o hash da senha. O e-mail é normalizado em minúsculas
// — a coluna é comparada sempre por lower(email), então guardar já normalizado
// mantém a leitura e a unicidade consistentes.
func NewUser(id, tenantID, companyID, name, email, passwordHash, role string) (User, error) {
	if tenantID == "" {
		return User{}, ErrTenantIDRequired
	}
	if companyID == "" {
		return User{}, ErrCompanyIDRequired
	}
	if email == "" {
		return User{}, ErrEmailRequired
	}
	if !validEmail(email) {
		return User{}, ErrEmailInvalid
	}
	if passwordHash == "" {
		return User{}, ErrPasswordHashRequired
	}
	return User{
		ID:           id,
		TenantID:     tenantID,
		CompanyID:    companyID,
		Name:         name,
		Email:        strings.ToLower(email),
		PasswordHash: passwordHash,
		Role:         role,
	}, nil
}

// validEmail é a checagem mínima de formato: exatamente um "@", com algo antes e
// um domínio com "." depois. O contrato não pede RFC 5322 — pede recusar o
// claramente inválido ("sem-arroba", "@x", "a@b") sem barrar endereços legítimos.
func validEmail(email string) bool {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at != strings.LastIndexByte(email, '@') {
		return false
	}
	local, domain := email[:at], email[at+1:]
	if local == "" || domain == "" {
		return false
	}
	dot := strings.IndexByte(domain, '.')
	if dot <= 0 || dot == len(domain)-1 {
		return false
	}
	if strings.ContainsAny(email, " \t\r\n") {
		return false
	}
	return true
}
