package steps

// Steps do BDD (godog) para tests/features/agent_routes.feature: as rotas que o
// prospecta-agent-worker chama na prospecta-api.
//
// Mesmo harness das demais features: sobe o fake-domain-pair REAL em container,
// o router de produção via httptest e confere o que foi publicado no par.
//
// NÃO existe POST /agent/runs — o run vem do evento ProspectRequested; o agente
// só ATUALIZA por POST /agent/runs/{id}.

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

func TestAgentRoutesBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-agent-routes",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)

			sc.Step(`^o lead "([^"]*)" está em opt-out no par de domínio$`, func(leadID string) error {
				return seedRecord(ctx, st, "opt-out", fmt.Sprintf(`{"lead_id":%q}`, leadID))
			})

			sc.Step(`^o lead "([^"]*)" do tenant "([^"]*)" tem telefone "([^"]*)" no par de domínio$`,
				func(leadID, tenant, phone string) error {
					return seedRecord(ctx, st, "lead", fmt.Sprintf(
						`{"id":%q,"tenant_id":%q,"campaign_id":"ccc","company_name":"Northwind Log",`+
							`"domain":"northwind.com","segment":"logística","channel":"whatsapp",`+
							`"fit":0,"status":"discovered","source_url":"https://exemplo.com",`+
							`"enriched":{"phone":%q}}`,
						leadID, tenant, phone))
				})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/agent_routes.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários das rotas do agente falharam")
	}
}
