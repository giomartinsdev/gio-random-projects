package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/prospecta"
)

// A leitura cross-tenant por e-mail (a do login): acha o usuário SEM tenant_id e
// devolve o password_hash para o bcrypt. Só o banco real prova que o bypass
// funciona e que a comparação é case-insensitive (índice lower(email)).
func TestProspectaReadUserByEmailIsCrossTenantAndCaseInsensitive(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)

	tenant := uuid.NewString()
	email := "login+" + uuid.NewString()[:8] + "@acme.com"
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_user WHERE lower(email)=lower($1)`, email)
	})
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_user (id, tenant_id, company_id, name, email, password_hash, role)
		VALUES ($1,$2,$3,'Ana',$4,'hash-bcrypt-1','admin')`,
		uuid.NewString(), tenant, uuid.NewString(), email); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// Sem tenant nenhum: a leitura é global por e-mail.
	got, err := repo.GetUserByEmail(ctx, email)
	if err != nil {
		t.Fatalf("GetUserByEmail: %v", err)
	}
	if got.TenantID != tenant || got.PasswordHash != "hash-bcrypt-1" || got.Role != "admin" {
		t.Fatalf("user = %+v; want tenant/hash/role", got)
	}
	if got.Email != email || got.CreatedAt == "" {
		t.Fatalf("email/created_at = %q/%q; want preenchidos", got.Email, got.CreatedAt)
	}

	// Caixa diferente acha o mesmo usuário.
	upper, err := repo.GetUserByEmail(ctx, upperEmail(email))
	if err != nil {
		t.Fatalf("GetUserByEmail(caixa alta): %v", err)
	}
	if upper.ID != got.ID {
		t.Fatalf("id(caixa alta) = %q; want %q", upper.ID, got.ID)
	}

	// Inexistente -> ErrNotFound (a borda vira 404).
	if _, err := repo.GetUserByEmail(ctx, "ninguem-"+uuid.NewString()+"@acme.com"); !errors.Is(err, domainprospecta.ErrNotFound) {
		t.Fatalf("inexistente = %v; want ErrNotFound", err)
	}
}

func upperEmail(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'a' && b[i] <= 'z' {
			b[i] -= 'a' - 'A'
		}
	}
	return string(b)
}
