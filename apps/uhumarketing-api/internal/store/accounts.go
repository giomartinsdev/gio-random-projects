package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// Contas e sessões. Ficam neste arquivo, e não no store.go, porque têm uma
// regra própria: workspace nasce vazio e token é sempre hash.

// ErrEmailTaken é devolvido quando o índice único de e-mail barra o cadastro.
// A tradução para HTTP é do handler; aqui é só o fato.
var ErrEmailTaken = errors.New("e-mail já cadastrado")

// NewID gera um id com prefixo legível, no mesmo formato do resto do banco.
func NewID(prefix string) string { return prefix + "_" + uuid.NewString()[:8] }

// AccountInput é o que o cadastro precisa gravar. PasswordHash já vem pronto:
// o store não conhece regra de hash nem custo.
type AccountInput struct {
	UserID       string
	WorkspaceID  string
	Name         string
	Email        string
	PasswordHash string
	Company      string
}

// Account é a conta lida do banco (com hash, para o login comparar).
type Account struct {
	UserID       string
	WorkspaceID  string
	Name         string
	Email        string
	Company      string
	PasswordHash string
}

// Session é o resultado de resolver um token: quem é e de qual workspace.
type Session struct {
	UserID      string
	WorkspaceID string
	Name        string
	Email       string
}

// CreateAccount cria workspace vazio + usuário numa transação. Se o usuário
// falhar (e-mail duplicado), o workspace não fica órfão no banco.
func (s *Store) CreateAccount(ctx context.Context, in AccountInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		-- quality e messaging_limit nascem VAZIOS: quem os informa é a Meta. Um
		-- "green" numa conta sem número seria uma qualidade inventada, e a tela
		-- mostraria um número saudável que não existe.
		INSERT INTO workspaces (id, name, plan, timezone, quality, messaging_limit)
		VALUES ($1,$2,'starter','America/Sao_Paulo','','')`, in.WorkspaceID, in.Company); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO workspaces_meta (workspace_id, created_by) VALUES ($1,$2)`,
		in.WorkspaceID, in.UserID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO users (id, workspace_id, name, email, password_hash, company)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		in.UserID, in.WorkspaceID, in.Name, in.Email, in.PasswordHash, in.Company); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrEmailTaken
		}
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) AccountByEmail(ctx context.Context, email string) (Account, error) {
	var a Account
	err := s.pool.QueryRow(ctx, `
		SELECT id, workspace_id, name, email, company, password_hash
		FROM users WHERE lower(email)=lower($1)`, email).
		Scan(&a.UserID, &a.WorkspaceID, &a.Name, &a.Email, &a.Company, &a.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Account{}, domain.ErrNotFound
	}
	return a, err
}

func (s *Store) CreateSession(ctx context.Context, tokenHash, userID string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
		tokenHash, userID, expiresAt)
	return err
}

// SessionByHash resolve o token em workspace. Sessão expirada é tratada como
// inexistente — e é apagada na leitura, para a tabela não crescer para sempre.
func (s *Store) SessionByHash(ctx context.Context, tokenHash string) (Session, error) {
	var sess Session
	err := s.pool.QueryRow(ctx, `
		SELECT u.id, u.workspace_id, u.name, u.email
		FROM sessions s JOIN users u ON u.id=s.user_id
		WHERE s.token_hash=$1 AND s.expires_at > now()`, tokenHash).
		Scan(&sess.UserID, &sess.WorkspaceID, &sess.Name, &sess.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1 AND expires_at <= now()`, tokenHash)
		return Session{}, domain.ErrUnauthorized
	}
	return sess, err
}

func (s *Store) RevokeSession(ctx context.Context, tokenHash string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, tokenHash)
	return err
}

// WipeAccount apaga o conteúdo de uma conta, não a conta.
//
// A ordem respeita as FKs (filhos antes dos pais) e o workspace fica de pé: o
// usuário continua logando e vê o produto vazio. `webhook_events` é global e
// também é limpo, mas só quando o reset é pedido — é deduplicação, não dado.
func (s *Store) WipeAccount(ctx context.Context, workspaceID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		DELETE FROM contact_consents WHERE contact_id IN
			(SELECT id FROM contacts WHERE workspace_id=$1)`, workspaceID); err != nil {
		return err
	}
	// Uma tabela por statement: o pgx usa o protocolo estendido, que não aceita
	// vários comandos no mesmo Exec.
	for _, table := range []string{
		"sends", "campaigns", "flows", "segments", "contacts", "templates", "activity",
	} {
		if _, err := tx.Exec(ctx, `DELETE FROM `+table+` WHERE workspace_id=$1`, workspaceID); err != nil {
			return err
		}
	}
	// Chaves de deduplicação do webhook são globais; limpá-las no reset é
	// seguro (só faz um evento antigo voltar a ser processável).
	if _, err := tx.Exec(ctx, `DELETE FROM webhook_events`); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
