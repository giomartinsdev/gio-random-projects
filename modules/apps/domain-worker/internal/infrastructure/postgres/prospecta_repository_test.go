package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"

	domainprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/prospecta"
)

// O que só um banco real prova para o Prospecta: o isolamento por tenant (RLS
// + o filtro explícito) e o roundtrip do ICP (signals/embedding).

func TestProspectaCompanyIsIsolatedByTenant(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewProspectaRepository(pool)

	tenantA := uuid.NewString()
	tenantB := uuid.NewString()
	id := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_company WHERE tenant_id IN ($1,$2)`, tenantA, tenantB)
	})

	c, err := domainprospecta.NewCompany(id, tenantA, "ACME", "acme.com", "vende coisas")
	if err != nil {
		t.Fatalf("new company: %v", err)
	}
	if _, err := repo.InsertCompany(ctx, c, uuid.NewString()); err != nil {
		t.Fatalf("insert: %v", err)
	}

	// O MESMO id, consultado por outro tenant, não existe — a empresa de A não
	// vaza para B.
	if _, err := repo.FindCompany(ctx, tenantB, id); err != domainprospecta.ErrNotFound {
		t.Fatalf("FindCompany(outro tenant) = %v; want ErrNotFound", err)
	}
	// No tenant certo, existe e CompanyExists confirma.
	got, err := repo.FindCompany(ctx, tenantA, id)
	if err != nil {
		t.Fatalf("FindCompany(tenant certo): %v", err)
	}
	if got.Name != "ACME" {
		t.Fatalf("name = %q; want ACME", got.Name)
	}
	if exists, err := repo.CompanyExists(ctx, tenantB, id); err != nil || exists {
		t.Fatalf("CompanyExists(outro tenant) = %v,%v; want false,nil", exists, err)
	}
}

func TestProspectaICPStoresSignalsAndEmbedding(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	repo := NewProspectaRepository(pool)

	tenant := uuid.NewString()
	companyID := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_company WHERE tenant_id = $1`, tenant)
	})

	c, err := domainprospecta.NewCompany(companyID, tenant, "FrotaX", "", "")
	if err != nil {
		t.Fatalf("new company: %v", err)
	}
	if _, err := repo.InsertCompany(ctx, c, uuid.NewString()); err != nil {
		t.Fatalf("insert company: %v", err)
	}

	icpID := uuid.NewString()
	icp, err := domainprospecta.NewICP(icpID, tenant, companyID, "transportadoras", []string{"expansão de frota", "novo CD"})
	if err != nil {
		t.Fatalf("new icp: %v", err)
	}
	icp.Embedding = []float32{0.1, 0.2, 0.3}
	if _, err := repo.InsertICP(ctx, icp, uuid.NewString()); err != nil {
		t.Fatalf("insert icp: %v", err)
	}

	got, err := repo.FindICPByCompany(ctx, tenant, companyID)
	if err != nil {
		t.Fatalf("find icp: %v", err)
	}
	if len(got.Signals) != 2 || got.Signals[0] != "expansão de frota" {
		t.Fatalf("signals = %v", got.Signals)
	}
	if len(got.Embedding) != 3 || got.Embedding[1] != 0.2 {
		t.Fatalf("embedding = %v", got.Embedding)
	}
	// O ICP do tenant B no mesmo company_id não existe (isolamento).
	other, err := repo.FindICPByCompany(ctx, uuid.NewString(), companyID)
	if err != domainprospecta.ErrNotFound {
		t.Fatalf("FindICPByCompany(outro tenant) = %+v,%v; want ErrNotFound", other, err)
	}
}
