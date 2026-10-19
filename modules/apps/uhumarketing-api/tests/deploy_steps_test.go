package tests

import (
	"fmt"

	"github.com/cucumber/godog"
)

// registerDeploySteps cobre o que só aparece fora do localhost: a URL que o
// operador cola na Meta, o webhook que deixa de ser privado e as rotas de
// desenvolvimento que não podem existir com dado real.
func registerDeploySteps(sc *godog.ScenarioContext, w *world) {
	sc.Step(`^o serviço sabe que a base pública é "([^"]*)"$`, func(base string) error {
		w.svc.PublicBaseURL = base
		return nil
	})

	sc.Step(`^o bootstrap mostra o webhook "([^"]*)"$`, func(want string) error {
		got := w.providerInfo().WebhookURL
		if got != want {
			return fmt.Errorf("webhook %q, esperava %q (%s)", got, want, w.body)
		}
		return nil
	})

	sc.Step(`^o bootstrap não mostra webhook$`, func() error {
		if got := w.providerInfo().WebhookURL; got != "" {
			return fmt.Errorf("bootstrap inventou webhook %q sem base pública", got)
		}
		return nil
	})

	// Em live a assinatura é obrigatória: o webhook é público e qualquer um
	// poderia marcar envio como lido ou forjar opt-out.
	sc.Step(`^o webhook exige assinatura$`, func() error {
		w.handlers.RequireSignature = true
		w.handlers.AppSecret = "segredo-de-teste"
		return nil
	})

	sc.Step(`^o webhook exige assinatura sem META_APP_SECRET$`, func() error {
		w.handlers.RequireSignature = true
		w.handlers.AppSecret = ""
		return nil
	})

	sc.Step(`^as ações de desenvolvimento estão desligadas$`, func() error {
		w.handlers.AllowDevActions = false
		return nil
	})

	sc.Step(`^eu peço o reset da conta$`, func() error {
		w.post("/api/v1/dev/reset", nil)
		return nil
	})
}
