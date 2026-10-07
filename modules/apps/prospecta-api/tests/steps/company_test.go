package steps

// Steps do BDD (godog) para tests/features/company.feature (US1).
//
// O que se testa aqui é a API de verdade, por httptest, contra um "par de
// domínio" FALSO que roda num container (golang:alpine, veja
// tests/fake-domain-pair/main.go). Não é um mock in-process: o cliente HTTP
// tipado da API faz uma travessia de rede real, e o fake registra os comandos
// que recebe -- então os cenários conseguem provar o que a API publicou e,
// crucialmente, o que ela NÃO publicou quando recusou o pedido antes de
// qualquer escrita.

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/cucumber/godog"
)

func TestCompanyBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-company",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)

			sc.Step(`^a empresa de id "([^"]*)" existe no par de domínio$`, func(id string) error {
				return seedRecord(ctx, st, "company", fmt.Sprintf(
					`{"id":%q,"name":"Northwind Log","site":"northwindlog.com.br",`+
						`"description":"Software de gestão de frotas.","icp":{"definition":"Logística B2B","signals":["expansão de frota"]}}`, id))
			})

			sc.Step(`^o corpo traz o ICP com "([^"]*)" não vazio$`, func(field string) error {
				icp, ok := st.body["icp"].(map[string]any)
				if !ok {
					return fmt.Errorf("corpo sem objeto icp: %v", st.body)
				}
				v, _ := icp[field].(string)
				if strings.TrimSpace(v) == "" {
					return fmt.Errorf("icp.%s vazio: %v", field, icp)
				}
				return nil
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/company.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de empresa/ICP falharam")
	}
}
