package main

// Steps do BDD (godog) para features/clubs_routing.feature.
//
// Este arquivo mora no pacote main de propósito: o que ele testa --
// classifyClubsAction e os payloads de clubs -- só existe ali, e mover a lógica
// para um pacote só para testar seria refatorar o produto por causa do teste.
//
// O runner é o godog (o Cucumber do Go). Ele é plugado no TestMain do pacote
// (main_test.go), então `go test` roda os cenários junto com os testes Go
// normais -- um único comando verifica tudo.

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
)

type routingState struct {
	acao      application.Action
	destino   clubsKind
	fetchSave clubsFetchSavePayload
	saude     clubsIngestPayload
	err       error
}

func (s *routingState) reset() { *s = routingState{} }

func TestClubsRoutingBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "clubs-routing",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			state := &routingState{}

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				state.reset()
				return ctx, nil
			})

			sc.Step(`^classifico a ação "([^"]*)"$`, func(a string) error {
				state.acao = application.Action(a)
				state.destino = classifyClubsAction(state.acao)
				return nil
			})
			sc.Step(`^o destino é a fila de fetch$`, func() error {
				return espera(state.destino, clubsKindFetch, "fila de fetch")
			})
			sc.Step(`^o destino é a gravação do fetch$`, func() error {
				return espera(state.destino, clubsKindFetchSave, "gravação do fetch")
			})
			sc.Step(`^o destino é a fila de busca$`, func() error {
				return espera(state.destino, clubsKindSearch, "fila de busca")
			})
			sc.Step(`^o destino é a saúde do worker$`, func() error {
				return espera(state.destino, clubsKindIngestHealth, "saúde do worker")
			})
			sc.Step(`^o destino é outro$`, func() error {
				return espera(state.destino, clubsKindOther, "outro")
			})

			sc.Step(`^o payload de resultado de fetch:$`, func(doc *godog.DocString) error {
				state.err = json.Unmarshal([]byte(doc.Content), &state.fetchSave)
				return state.err
			})
			sc.Step(`^o resultado de fetch decodifica com (\d+) jogadores, (\d+) partidas e (\d+) clubes$`,
				func(players, matches, clubs int) error {
					if state.fetchSave.Players != players || state.fetchSave.Matches != matches || state.fetchSave.Clubs != clubs {
						return fmt.Errorf("decodificou %d/%d/%d; want %d/%d/%d",
							state.fetchSave.Players, state.fetchSave.Matches, state.fetchSave.Clubs,
							players, matches, clubs)
					}
					return nil
				})
			sc.Step(`^o resultado de fetch está concluído$`, func() error {
				if !state.fetchSave.Concluido {
					return fmt.Errorf("concluido = false; o produtor manda true")
				}
				return nil
			})

			sc.Step(`^o payload de saúde:$`, func(doc *godog.DocString) error {
				state.err = json.Unmarshal([]byte(doc.Content), &state.saude)
				return state.err
			})
			sc.Step(`^a saúde decodifica com (\d+) ciclos e (\d+) clubes ok$`, func(cycles, ok int) error {
				if state.saude.Cycles != cycles || state.saude.ClubsOK != ok {
					return fmt.Errorf("decodificou cycles=%d clubs_ok=%d; want %d/%d",
						state.saude.Cycles, state.saude.ClubsOK, cycles, ok)
				}
				return nil
			})
			sc.Step(`^a saúde marca a fonte como indisponível com o motivo "([^"]*)"$`, func(motivo string) error {
				if state.saude.SourceAvailable {
					return fmt.Errorf("source_available = true; o produtor marcou false")
				}
				if state.saude.SourceError != motivo {
					return fmt.Errorf("source_error = %q; want %q", state.saude.SourceError, motivo)
				}
				return nil
			})
		},
		Options: &godog.Options{
			Format: "pretty",
			// Só este feature: o diretório features/ tem mais de um arquivo, e
			// rodar todos aqui faria os steps do outro suite aparecerem como
			// indefinidos (o Strict é false, então passariam em silêncio).
			Paths: []string{"features/clubs_routing.feature"},
			// `TestingT` liga o godog ao `go test`; `Dialect: "pt"` porque o
			// produto é escrito em português (Funcionalidade/Cenário/...).
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de roteamento de clubs falharam")
	}
}

func espera(got, want clubsKind, nome string) error {
	if got != want {
		return fmt.Errorf("destino = %v; want %s (%v)", got, nome, want)
	}
	return nil
}
