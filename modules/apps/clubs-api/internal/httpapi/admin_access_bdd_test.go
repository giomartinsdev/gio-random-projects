package httpapi

// Runner do BDD (godog) do clubs-api.
//
// O cenário de produto (tests/features/admin_access.feature) descreve o gate de
// administração em Gherkin; estes steps ligam cada frase à função pura que a
// implementa. Assim o `.feature` não é documentação morta -- é o contrato que o
// CI executa junto com os testes Go normais.
//
// O que NÃO se testa aqui: a rota HTTP em si (isso está em admin_access_test.go,
// com httptest). O Gherkin cobre a REGRA (quem é admin), que é o que muda com o
// produto; o transporte fica no teste Go.

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
)

type adminState struct {
	lista []string
	set   map[string]struct{}
}

func TestAdminAccessBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "admin-access",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &adminState{}

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				*st = adminState{}
				return ctx, nil
			})

			sc.Step(`^a lista de administradores "([^"]*)"$`, func(raw string) error {
				st.set = parseAdminEmails(raw)
				return nil
			})
			sc.Step(`^"([^"]*)" é administrador$`, func(email string) error {
				s := &Server{adminEmails: st.set}
				if !s.isAdmin(email) {
					return fmt.Errorf("%q deveria ser administrador (lista=%v)", email, st.set)
				}
				return nil
			})
			sc.Step(`^"([^"]*)" não é administrador$`, func(email string) error {
				s := &Server{adminEmails: st.set}
				if s.isAdmin(email) {
					return fmt.Errorf("%q NÃO deveria ser administrador (lista=%v)", email, st.set)
				}
				return nil
			})
		},
		Options: &godog.Options{
			Format: "pretty",
			// O cwd do teste é o diretório do pacote; o .feature vive na raiz do
			// módulo.
			Paths:    []string{"../../tests/features"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de acesso à administração falharam")
	}
}
