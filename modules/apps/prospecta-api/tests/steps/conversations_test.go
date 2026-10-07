package steps

// Steps do BDD (godog) para tests/features/conversations.feature (US3).

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

func TestConversationsBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-conversations",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)

			sc.Step(`^a conversa de id "([^"]*)" existe no par de domínio$`, func(id string) error {
				return seedRecord(ctx, st, "conversation", fmt.Sprintf(
					`{"id":%q,"lead_id":"bbbbbbbb-0000-0000-0000-000000000001","company_name":"Northwind Log",`+
						`"channel":"email","last_message":"Olá","unread":1,"state":"open",`+
						`"messages":[{"id":"m1","direction":"out","content":"Olá","status":"sent"},`+
						`{"id":"m2","direction":"in","content":"Bom dia","status":"received"}]}`, id))
			})

			sc.Step(`^a mensagem de id "([^"]*)" existe com status "([^"]*)" no par de domínio$`, func(id, status string) error {
				return seedRecord(ctx, st, "message", fmt.Sprintf(
					`{"id":%q,"lead_id":"bbbbbbbb-0000-0000-0000-000000000001","channel":"email",`+
						`"direction":"out","content":"Olá, tudo bem?","status":%q}`, id, status))
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/conversations.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de conversas falharam")
	}
}
