package domain

import (
	"errors"
	"net/mail"
	"strings"
)

// MinPasswordLength is the floor for a signup password. Kept here (not in the
// transport) so the rule is one value the tests and the handler both read.
const MinPasswordLength = 8

// Signup validation errors, all mapped to 422 by the transport: the body is
// well-formed but semantically invalid, and no command was published, so there
// is never a partial write.
var (
	ErrUserNameRequired = errors.New("nome é obrigatório")
	ErrUserEmailInvalid = errors.New("e-mail inválido")
	ErrUserPasswordWeak = errors.New("a senha precisa de ao menos 8 caracteres")
	ErrUserExists       = errors.New("e-mail já cadastrado")
)

// User is the projection of prospecta_user this ACL reads back. The domain pair
// owns the row and the hash; this side only compares the hash on login.
type User struct {
	ID           string `json:"id"`
	TenantID     string `json:"tenant_id,omitempty"`
	CompanyID    string `json:"company_id,omitempty"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash,omitempty"`
	Role         string `json:"role,omitempty"`
}

// ValidateSignup checks the invariant set the contract fixes for POST
// /auth/signup: name, email, password and company.name must all be present and
// valid before anything is published.
func ValidateSignup(name, email, password, companyName string) error {
	if strings.TrimSpace(name) == "" {
		return ErrUserNameRequired
	}
	if !ValidEmail(email) {
		return ErrUserEmailInvalid
	}
	if len([]rune(password)) < MinPasswordLength {
		return ErrUserPasswordWeak
	}
	if strings.TrimSpace(companyName) == "" {
		return ErrCompanyNameRequired
	}
	return nil
}

// ValidEmail accepts a single RFC 5322 address and rejects anything with
// display-name decoration, so "Ana <a@b.com>" is not accepted as an e-mail.
func ValidEmail(email string) bool {
	email = strings.TrimSpace(email)
	if email == "" {
		return false
	}
	addr, err := mail.ParseAddress(email)
	if err != nil {
		return false
	}
	return addr.Address == email && strings.Contains(addr.Address, "@")
}

// NormalizeEmail lowercases and trims, the canonical key for the by-email
// lookup and the session claim.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}
