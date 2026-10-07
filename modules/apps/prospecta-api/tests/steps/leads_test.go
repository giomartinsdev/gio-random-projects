package steps

// Steps do BDD (godog) para tests/features/leads.feature (US2).

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

func TestLeadsBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-leads",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)

			sc.Step(`^o lead de id "([^"]*)" existe com fit (\d+) e status "([^"]*)" na campanha "([^"]*)" no par de domínio$`,
				func(id string, fit int, status, campaignID string) error {
					return seedRecord(ctx, st, "lead", fmt.Sprintf(
						`{"id":%q,"campaign_id":%q,"company_name":"Northwind Log","segment":"logística",`+
							`"channel":"email","fit":%d,"status":%q,"source_url":"https://exemplo.com",`+
							`"enriched":{"decision_maker":"Ana"},"timeline":[{"at":"2026-10-07T10:00:00Z","kind":"discovered"}],`+
							`"last_message":{"id":"msg-x","content":"oi","status":"sent"}}`,
						id, campaignID, fit, status))
				})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/leads.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de leads falharam")
	}
}
