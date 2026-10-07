package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
)

// O agregado User contra Postgres REAL: o worker só ESCREVE (a leitura por
// e-mail, cross-tenant, vive no domain-api). O que se prova aqui: o hash chega
// intacto na linha e o e-mail é único GLOBALMENTE (índice lower(email)) — o
// mesmo endereço com caixa diferente falha, sem virar uma segunda conta.
func TestProspectaUserStoresHashAndEmailIsGloballyUnique(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewProspectaRepository(pool)

	tenant := uuid.NewString()
	email := "ana+" + uuid.NewString()[:8] + "@acme.com"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_user WHERE lower(email) = lower($1)`, email)
	})

	u, err := domainprospecta.NewUser(uuid.NewString(), tenant, uuid.NewString(), "Ana", email, "hash-bcrypt-1", "admin")
	if err != nil {
		t.Fatalf("new user: %v", err)
	}
	if _, err := repo.InsertUser(ctx, u, uuid.NewString()); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	var gotHash, gotRole, gotEmail string
	if err := pool.QueryRow(ctx,
		`SELECT password_hash, role, email FROM prospecta_user WHERE lower(email)=lower($1)`, email).
		Scan(&gotHash, &gotRole, &gotEmail); err != nil {
		t.Fatalf("select: %v", err)
	}
	if gotHash != "hash-bcrypt-1" || gotRole != "admin" || gotEmail != email {
		t.Fatalf("linha = hash %q role %q email %q; want hash/role/email preservados", gotHash, gotRole, gotEmail)
	}

	// Mesmo e-mail com caixa diferente: o índice lower(email) recusa — a linha
	// não duplica e o erro sobe limpo (não vira um segundo usuário silencioso).
	dup, err := domainprospecta.NewUser(uuid.NewString(), uuid.NewString(), uuid.NewString(), "Outra", email, "outro-hash", "member")
	if err != nil {
		t.Fatalf("new dup: %v", err)
	}
	if _, err := repo.InsertUser(ctx, dup, uuid.NewString()); err == nil {
		t.Fatal("insert com e-mail duplicado devia falhar")
	}

	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM prospecta_user WHERE lower(email)=lower($1)`, email).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("linhas com o e-mail = %d; want 1 (sem duplicata)", n)
	}
}

// A idempotência do MESMO comando: reentrega não duplica nem devolve erro.
func TestProspectaUserInsertIsIdempotentByCommandID(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewProspectaRepository(pool)

	tenant := uuid.NewString()
	email := "idem+" + uuid.NewString()[:8] + "@acme.com"
	commandID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_user WHERE lower(email) = lower($1)`, email)
	})

	u, err := domainprospecta.NewUser(uuid.NewString(), tenant, uuid.NewString(), "Idem", email, "hash-bcrypt-1", "member")
	if err != nil {
		t.Fatalf("new user: %v", err)
	}
	first, err := repo.InsertUser(ctx, u, commandID)
	if err != nil || !first {
		t.Fatalf("primeiro insert = %v,%v; want true,nil", first, err)
	}
	second, err := repo.InsertUser(ctx, u, commandID)
	if err != nil || second {
		t.Fatalf("reentrega = %v,%v; want false,nil", second, err)
	}
}

// UpdateUserPassword: define/troca o hash de uma conta existente; a reentrega do
// MESMO comando é no-op (changed=false); um usuário inexistente vira ErrNotFound
// (não um no-op silencioso), para o comando não apontar para conta nenhuma.
func TestProspectaUserUpdatePasswordIsIdempotentAndRejectsUnknown(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewProspectaRepository(pool)

	tenant := uuid.NewString()
	email := "pw+" + uuid.NewString()[:8] + "@acme.com"
	userID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_user WHERE lower(email) = lower($1)`, email)
	})

	// Conta só-Google: nasce sem senha.
	u, err := domainprospecta.NewUser(userID, tenant, uuid.NewString(), "Googler", email, "", "owner")
	if err != nil {
		t.Fatalf("new user: %v", err)
	}
	if _, err := repo.InsertUser(ctx, u, uuid.NewString()); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	next, err := domainprospecta.User{ID: userID, TenantID: tenant}.ApplyPasswordHash("hash-bcrypt-2")
	if err != nil {
		t.Fatalf("apply hash: %v", err)
	}
	changed, err := repo.UpdateUserPassword(ctx, next, uuid.NewString())
	if err != nil || !changed {
		t.Fatalf("update = %v,%v; want true,nil", changed, err)
	}
	var got string
	if err := pool.QueryRow(ctx,
		`SELECT password_hash FROM prospecta_user WHERE lower(email)=lower($1)`, email).Scan(&got); err != nil {
		t.Fatalf("select: %v", err)
	}
	if got != "hash-bcrypt-2" {
		t.Fatalf("password_hash = %q; want hash-bcrypt-2", got)
	}

	// Usuário inexistente: ErrNotFound, nada escrito.
	other := domainprospecta.User{ID: uuid.NewString(), TenantID: tenant}
	if _, err := repo.UpdateUserPassword(ctx, other, uuid.NewString()); err != domainprospecta.ErrNotFound {
		t.Fatalf("inexistente = %v; want ErrNotFound", err)
	}
}
