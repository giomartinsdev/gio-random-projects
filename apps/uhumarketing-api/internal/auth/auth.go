package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// SessionTTL é a validade de um token. Longo o suficiente para uma sessão de
// trabalho, curto o bastante para um token vazado expirar sozinho.
const SessionTTL = 30 * 24 * time.Hour

// Account é o que o cadastro cria: um usuário e o workspace dele.
type Account struct {
	UserID      string `json:"userId"`
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
	Email       string `json:"email"`
	Company     string `json:"company"`
	Token       string `json:"token"`
}

// SignupError distingue e-mail já usado de entrada inválida, para o handler
// escolher 409 ou 422 sem inspecionar Strings.
var ErrEmailTaken = errors.New("e-mail já cadastrado")

// Signup cria usuário + workspace vazio. O workspace nasce VAZIO de propósito:
// uma conta nova não pode herdar template, contato ou campanha de demonstração.
func Signup(ctx context.Context, st *store.Store, name, email, password, company string) (Account, error) {
	name = strings.TrimSpace(name)
	email = normalizeEmail(email)
	company = strings.TrimSpace(company)

	if name == "" {
		return Account{}, domain.Invalid("name", "informe seu nome")
	}
	if err := validEmail(email); err != nil {
		return Account{}, err
	}
	if err := validPassword(password); err != nil {
		return Account{}, err
	}
	if company == "" {
		company = name
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return Account{}, err
	}

	userID := store.NewID("usr")
	wsID := store.NewID("ws")

	if err := st.CreateAccount(ctx, store.AccountInput{
		UserID: userID, WorkspaceID: wsID, Name: name, Email: email,
		PasswordHash: string(hash), Company: company,
	}); err != nil {
		if errors.Is(err, store.ErrEmailTaken) {
			return Account{}, ErrEmailTaken
		}
		return Account{}, err
	}

	token, err := issueToken(ctx, st, userID)
	if err != nil {
		return Account{}, err
	}
	return Account{UserID: userID, WorkspaceID: wsID, Name: name, Email: email, Company: company, Token: token}, nil
}

// Login confere a senha e abre uma sessão. A mensagem de erro é a mesma para
// e-mail inexistente e senha errada: dizer qual dos dois falhou entrega a
// existência da conta para quem está tentando entrar.
func Login(ctx context.Context, st *store.Store, email, password string) (Account, error) {
	email = normalizeEmail(email)
	acc, err := st.AccountByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return Account{}, domain.Invalid("email", "e-mail ou senha inválidos")
		}
		return Account{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(acc.PasswordHash), []byte(password)) != nil {
		return Account{}, domain.Invalid("email", "e-mail ou senha inválidos")
	}
	token, err := issueToken(ctx, st, acc.UserID)
	if err != nil {
		return Account{}, err
	}
	return Account{
		UserID: acc.UserID, WorkspaceID: acc.WorkspaceID, Name: acc.Name,
		Email: email, Company: acc.Company, Token: token,
	}, nil
}

// Resolve troca um token pelo workspace dono dele. É a única porta de entrada
// das rotas autenticadas: sem sessão válida não há workspace, e sem workspace
// não há dado para ler.
func Resolve(ctx context.Context, st *store.Store, token string) (store.Session, error) {
	if token == "" {
		return store.Session{}, domain.ErrUnauthorized
	}
	return st.SessionByHash(ctx, hashToken(token))
}

func Logout(ctx context.Context, st *store.Store, token string) error {
	if token == "" {
		return nil
	}
	return st.RevokeSession(ctx, hashToken(token))
}

func issueToken(ctx context.Context, st *store.Store, userID string) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	if err := st.CreateSession(ctx, hashToken(token), userID, time.Now().Add(SessionTTL)); err != nil {
		return "", err
	}
	return token, nil
}

// hashToken guarda só o hash: um dump do banco não vira um punhado de sessões
// prontas para usar.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func validEmail(email string) error {
	at := strings.IndexByte(email, '@')
	if at <= 0 || at == len(email)-1 || !strings.Contains(email[at+1:], ".") {
		return domain.Invalid("email", "informe um e-mail válido")
	}
	if strings.ContainsAny(email, " \t") {
		return domain.Invalid("email", "informe um e-mail válido")
	}
	return nil
}

func validPassword(password string) error {
	if len(password) < 8 {
		return domain.Invalid("password", "a senha precisa de pelo menos 8 caracteres")
	}
	return nil
}
