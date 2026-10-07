package postgres

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// As leituras do Prospecta contra Postgres REAL (mesmo harness/schema do
// domain-api). O que só o banco prova: a paginação por cursor, o leads_count e
// o unread derivados, a ordem da thread, a timeline/última mensagem derivadas e
// o isolamento por tenant. Os shapes finos (JSON igual ao da prospecta-api)
// ficam travados no BDD de handler, que sobe o router de produção.

func seedProspectaLead(t *testing.T, pool *pgxpool.Pool, tenant, campaignID, company string, fit int, status string) string {
	t.Helper()
	id := uuid.NewString()
	domain := "d-" + id[:8] + ".com"
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO prospecta_lead
			(id, tenant_id, campaign_id, company_name, domain, segment, channel, fit, status, source_url, enriched)
		VALUES ($1,$2,$3,$4,$5,'logística','email',$6,$7,'https://exemplo.com','{"decision_maker":"Ana"}')`,
		id, tenant, campaignID, company, domain, fit, status); err != nil {
		t.Fatalf("seed lead: %v", err)
	}
	return id
}

func cleanupProspecta(t *testing.T, pool *pgxpool.Pool, tenant string) {
	t.Helper()
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_message WHERE tenant_id = $1`, tenant)
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_conversation WHERE tenant_id = $1`, tenant)
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_lead WHERE tenant_id = $1`, tenant)
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_campaign WHERE tenant_id = $1`, tenant)
		_, _ = pool.Exec(ctx, `DELETE FROM prospecta_agent_run WHERE tenant_id = $1`, tenant)
	})
}

func TestProspectaReadListCampaignsPaginatesAndCountsLeads(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)
	tenant := uuid.NewString()
	cleanupProspecta(t, pool, tenant)

	c1, c2 := uuid.NewString(), uuid.NewString()
	for _, c := range []string{c1, c2} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO prospecta_campaign (id, tenant_id, company_id, name, channels, status)
			VALUES ($1,$2,$3,'Campanha','{email}','draft')`, c, tenant, uuid.NewString()); err != nil {
			t.Fatalf("seed campaign: %v", err)
		}
	}
	seedProspectaLead(t, pool, tenant, c1, "A", 80, "qualified")
	seedProspectaLead(t, pool, tenant, c1, "B", 40, "discovered")

	// limit=1 do total de 2: há próxima página e o cursor é o id do item.
	page, err := repo.ListCampaigns(ctx, tenant, 1, "")
	if err != nil {
		t.Fatalf("ListCampaigns: %v", err)
	}
	if len(page.Items) != 1 || page.Next == nil {
		t.Fatalf("página 1 = %d itens, next=%v; want 1 item e next não nulo", len(page.Items), page.Next)
	}
	firstID := page.Items[0].ID

	page2, err := repo.ListCampaigns(ctx, tenant, 1, *page.Next)
	if err != nil {
		t.Fatalf("ListCampaigns cursor: %v", err)
	}
	if len(page2.Items) != 1 || page2.Items[0].ID == firstID {
		t.Fatalf("página 2 = %+v; want o outro item", page2.Items)
	}
	if page2.Next != nil {
		t.Fatalf("next da última página = %v; want nil", *page2.Next)
	}

	// leads_count é derivado: a campanha c1 tem 2 leads.
	all, err := repo.ListCampaigns(ctx, tenant, 10, "")
	if err != nil {
		t.Fatalf("ListCampaigns all: %v", err)
	}
	var count int
	for _, c := range all.Items {
		if c.ID == c1 {
			count = c.LeadsCount
		}
	}
	if count != 2 {
		t.Fatalf("leads_count da campanha com 2 leads = %d; want 2", count)
	}
}

func TestProspectaReadGetLeadCarriesEnrichedTimelineAndLastMessage(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)
	tenant := uuid.NewString()
	cleanupProspecta(t, pool, tenant)

	campaignID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_campaign (id, tenant_id, company_id, name, channels, status)
		VALUES ($1,$2,$3,'Campanha','{email}','running')`, campaignID, tenant, uuid.NewString()); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	leadID := seedProspectaLead(t, pool, tenant, campaignID, "Northwind Log", 80, "qualified")
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status)
		VALUES ($1,$2,$3,'email','out','Olá, tudo bem?','drafted')`,
		uuid.NewString(), tenant, leadID); err != nil {
		t.Fatalf("seed message: %v", err)
	}

	got, err := repo.GetLead(ctx, tenant, leadID)
	if err != nil {
		t.Fatalf("GetLead: %v", err)
	}
	if got.CompanyName != "Northwind Log" || got.Fit != 80 {
		t.Fatalf("lead = %+v; want Northwind Log fit 80", got)
	}
	if got.Enriched == nil || got.Enriched["decision_maker"] != "Ana" {
		t.Fatalf("enriched = %v; want decision_maker=Ana", got.Enriched)
	}
	if len(got.Timeline) == 0 || got.Timeline[0].Kind == "" {
		t.Fatalf("timeline = %+v; want ao menos discovered", got.Timeline)
	}
	if got.LastMessage == nil || got.LastMessage.Content != "Olá, tudo bem?" || got.LastMessage.Status != "drafted" {
		t.Fatalf("last_message = %+v; want a mensagem drafted", got.LastMessage)
	}

	// Lead de outro tenant não é encontrado.
	if _, err := repo.GetLead(ctx, uuid.NewString(), leadID); err == nil {
		t.Fatal("GetLead(outro tenant) devia falhar")
	}
}

func TestProspectaReadConversationThreadOrderAndUnread(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)
	tenant := uuid.NewString()
	cleanupProspecta(t, pool, tenant)

	leadID := seedProspectaLead(t, pool, tenant, uuid.NewString(), "Northwind Log", 0, "contacted")
	convID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_conversation (id, tenant_id, lead_id, thread_key, state)
		VALUES ($1,$2,$3,'thread-1','open')`, convID, tenant, leadID); err != nil {
		t.Fatalf("seed conversation: %v", err)
	}
	// out mais antiga, in mais nova: a thread lê em ordem cronológica.
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status, created_at)
		VALUES ($1,$2,$3,'email','out','Olá','sent', now() - interval '1 hour')`,
		uuid.NewString(), tenant, leadID); err != nil {
		t.Fatalf("seed out: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status, created_at)
		VALUES ($1,$2,$3,'email','in','Bom dia','sent', now())`,
		uuid.NewString(), tenant, leadID); err != nil {
		t.Fatalf("seed in: %v", err)
	}

	got, err := repo.GetConversation(ctx, tenant, convID)
	if err != nil {
		t.Fatalf("GetConversation: %v", err)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("mensagens = %d; want 2", len(got.Messages))
	}
	if got.Messages[0].Direction != "out" || got.Messages[1].Direction != "in" {
		t.Fatalf("ordem = %q,%q; want out,in", got.Messages[0].Direction, got.Messages[1].Direction)
	}
	if got.Unread != 1 {
		t.Fatalf("unread = %d; want 1 (uma mensagem in)", got.Unread)
	}
	if got.CompanyName != "Northwind Log" || got.LastMessage != "Bom dia" {
		t.Fatalf("company/last = %q/%q; want Northwind Log/Bom dia", got.CompanyName, got.LastMessage)
	}
}

func TestProspectaReadListActivityIsTenantScoped(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)
	tenantA, tenantB := uuid.NewString(), uuid.NewString()
	cleanupProspecta(t, pool, tenantA)
	cleanupProspecta(t, pool, tenantB)
	for _, tenant := range []string{tenantA, tenantB} {
		for i := 0; i < 2; i++ {
			if _, err := pool.Exec(ctx, `
				INSERT INTO prospecta_agent_run (id, tenant_id, campaign_id, agent, state, metrics)
				VALUES ($1,$2,$3,'prospector','running','{"found":12}')`,
				uuid.NewString(), tenant, uuid.NewString()); err != nil {
				t.Fatalf("seed run: %v", err)
			}
		}
	}
	got, err := repo.ListActivity(ctx, tenantA, 50)
	if err != nil {
		t.Fatalf("ListActivity: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("runs do tenant A = %d; want 2 (só do próprio tenant)", len(got))
	}
	for _, ev := range got {
		if ev.RunID == "" || ev.Agent != "prospector" || ev.State != "running" {
			t.Fatalf("evento = %+v; want run_id/agent/state preenchidos", ev)
		}
		if ev.Metric["found"] != float64(12) {
			t.Fatalf("metric = %v; want found=12", ev.Metric)
		}
	}
}

func TestProspectaReadListCampaignsOtherTenantIsEmpty(t *testing.T) {
	pool := readPool(t)
	ctx := context.Background()
	repo := NewProspectaReadRepository(pool)
	tenant := uuid.NewString()
	cleanupProspecta(t, pool, tenant)

	if _, err := pool.Exec(ctx, `
		INSERT INTO prospecta_campaign (id, tenant_id, company_id, name, channels, status)
		VALUES ($1,$2,$3,'Campanha','{email}','draft')`,
		uuid.NewString(), tenant, uuid.NewString()); err != nil {
		t.Fatalf("seed campaign: %v", err)
	}
	page, err := repo.ListCampaigns(ctx, uuid.NewString(), 10, "")
	if err != nil {
		t.Fatalf("ListCampaigns: %v", err)
	}
	if len(page.Items) != 0 {
		t.Fatalf("outro tenant viu %d campanhas; want 0", len(page.Items))
	}
	if page.Items == nil {
		t.Fatal("items = nil; want [] (a lista é vazia, não ausente)")
	}
}
