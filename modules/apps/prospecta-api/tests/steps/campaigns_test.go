package steps

// Steps do BDD (godog) para tests/features/campaigns.feature (US2).

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

func TestCampaignsBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-campaigns",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)

			sc.Step(`^a campanha de id "([^"]*)" existe no par de domínio$`, func(id string) error {
				return seedRecord(ctx, st, "campaign", fmt.Sprintf(
					`{"id":%q,"company_id":"11111111-1111-1111-1111-111111111111","icp_id":"icp-1",`+
						`"name":"Logística Sudeste","status":"draft","channels":["email"],"leads_count":0}`, id))
			})

			sc.Step(`^a campanha de id "([^"]*)" existe com ICP no par de domínio$`, func(id string) error {
				return seedRecord(ctx, st, "campaign", fmt.Sprintf(
					`{"id":%q,"company_id":"11111111-1111-1111-1111-111111111111","icp_id":"icp-1",`+
						`"name":"Logística Sudeste","status":"draft","channels":["email"],"leads_count":0}`, id))
			})

			sc.Step(`^a campanha de id "([^"]*)" existe sem ICP no par de domínio$`, func(id string) error {
				return seedRecord(ctx, st, "campaign", fmt.Sprintf(
					`{"id":%q,"company_id":"11111111-1111-1111-1111-111111111111","name":"Sem ICP",`+
						`"status":"draft","channels":["email"],"leads_count":0}`, id))
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/campaigns.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de campanhas falharam")
	}
}
