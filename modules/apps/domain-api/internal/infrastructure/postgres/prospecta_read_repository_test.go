package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// A projeção de leitura do Prospecta: a empresa com o ICP quando definido, e o
// isolamento por tenant no read path (defesa em profundidade além do RLS). Só
// um banco real prova a query.
func TestProspectaReadCompanyWithICPAndTenantIsolation(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)

	tenant := uuid.NewString()
	companyID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_company WHERE tenant_id = $1`, tenant)
	})

	// O domain-api é read-only: a escrita é simulada direto no banco (o dono
	// real é o domain-worker).
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_company (id, tenant_id, name, site, description)
		VALUES ($1,$2,'ACME','acme.com','vende coisas')`, companyID, tenant); err != nil {
		t.Fatalf("seed company: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_icp (id, tenant_id, company_id, definition, signals)
		VALUES ($1,$2,$3,'transportadoras','{"frota","novo CD"}')`, uuid.NewString(), tenant, companyID); err != nil {
		t.Fatalf("seed icp: %v", err)
	}

	got, err := repo.GetCompany(ctx, tenant, companyID)
	if err != nil {
		t.Fatalf("GetCompany: %v", err)
	}
	if got.Name != "ACME" || got.ICP == nil {
		t.Fatalf("projeção = %+v; want ACME com ICP", got)
	}
	if got.ICP.Definition != "transportadoras" || len(got.ICP.Signals) != 2 {
		t.Fatalf("icp = %+v", got.ICP)
	}

	// Outro tenant não vê a empresa: o filtro explícito do read path barra
	// mesmo se a role da conexão ignorar a policy de RLS.
	if _, err := repo.GetCompany(ctx, uuid.NewString(), companyID); err == nil {
		t.Fatal("GetCompany(outro tenant) devia falhar")
	}
}
