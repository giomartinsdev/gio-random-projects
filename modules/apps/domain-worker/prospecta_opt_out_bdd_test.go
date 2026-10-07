package main

// Steps do BDD (godog) para features/prospecta_opt_out.feature — o comando
// SetOptOut do Prospecta (specs/004-prospecta).
//
// Mesma trilha real do prospecta_company: process() -> CommandHandler ->
// repositório -> Postgres (testcontainers, o schema.sql do worker). Reusa os
// helpers de prospecta_company_bdd_test.go, que vivem no mesmo pacote main.

import (
	"context"
	"fmt"
	"testing"

	"github.com/cucumber/godog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/prospecta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
)

type optOutState struct {
	tenant string
	leadID string
	reason string

	noLead    bool
	lastCmdID string
	cmdErr    error
	bus       *busStub
}

func (s *optOutState) reset() {
	bus := s.bus
	*s = optOutState{bus: bus}
	if bus != nil {
		bus.names = nil
	}
}

func TestProspectaOptOutBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "prospecta-opt-out",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &optOutState{bus: &busStub{}}
			pool := prospectaPool(t)
			h := optOutHandler(pool, st.bus)

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				st.reset()
				if _, err := pool.Exec(ctx, `DELETE FROM prospecta_opt_out; DELETE FROM audit_log; DELETE FROM outbox`); err != nil {
					return ctx, err
				}
				return ctx, nil
			})

			sc.Step(`^um banco de domínio limpo$`, func() error { return nil })

			sc.Step(`^o worker processa "SetOptOut" para o lead do tenant "([^"]*)" com motivo "([^"]*)"$`,
				func(tenant, reason string) error {
					st.tenant, st.reason = tenant, reason
					st.leadID = uuid.NewString()
					return processOptOut(st, h, st.leadID)
				})

			sc.Step(`^o worker processa "SetOptOut" de novo para o MESMO lead do tenant "([^"]*)"$`,
				func(tenant string) error {
					st.tenant = tenant
					return processOptOut(st, h, st.leadID)
				})

			sc.Step(`^o worker processa "SetOptOut" sem lead para o tenant "([^"]*)"$`,
				func(tenant string) error {
					st.tenant, st.leadID = tenant, ""
					return processOptOut(st, h, "")
				})

			sc.Step(`^o comando termina sem erro$`, func() error {
				if st.cmdErr != nil {
					return fmt.Errorf("esperava sucesso; veio %v", st.cmdErr)
				}
				return nil
			})
			sc.Step(`^o comando termina com erro$`, func() error {
				if st.cmdErr == nil {
					return fmt.Errorf("esperava erro; o comando passou")
				}
				return nil
			})
			sc.Step(`^existem (\d+) opt-outs do tenant "([^"]*)"$`, func(n int, tenant string) error {
				return esperaInt(pool, `SELECT count(*) FROM prospecta_opt_out WHERE tenant_id=$1`, tenant, n, "opt-outs")
			})
			sc.Step(`^o opt-out do tenant "([^"]*)" tem motivo "([^"]*)"$`, func(tenant, want string) error {
				var got string
				if err := pool.QueryRow(context.Background(),
					`SELECT reason FROM prospecta_opt_out WHERE tenant_id=$1 LIMIT 1`, tenant).Scan(&got); err != nil {
					return err
				}
				if got != want {
					return fmt.Errorf("reason = %q; want %q", got, want)
				}
				return nil
			})
			sc.Step(`^o evento "([^"]*)" foi levantado$`, func(nome string) error {
				if !contains(st.bus.names, nome) {
					return fmt.Errorf("evento %q não levantado; veio %v", nome, st.bus.names)
				}
				return nil
			})
			sc.Step(`^houve apenas (\d+) evento "([^"]*)"$`, func(n int, nome string) error {
				if got := countOf(st.bus.names, nome); got != n {
					return fmt.Errorf("evento %q levantado %d vezes; want %d", nome, got, n)
				}
				return nil
			})
			sc.Step(`^há (\d+) linhas de auditoria (ok|falha) para "([^"]*)"$`, func(n int, status, action string) error {
				success := status == "ok"
				var got int
				if err := pool.QueryRow(context.Background(),
					`SELECT count(*) FROM audit_log WHERE action=$1 AND success=$2`, action, success).Scan(&got); err != nil {
					return err
				}
				if got != n {
					return fmt.Errorf("auditoria %s de %q = %d; want %d", status, action, got, n)
				}
				return nil
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features/prospecta_opt_out.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários do OptOut falharam")
	}
}

func optOutHandler(pool *pgxpool.Pool, bus *busStub) func(application.Command) error {
	repo := postgres.NewProspectaRepository(pool)
	handler := appprospecta.NewCommandHandler(appprospecta.NewService(repo))
	audits := postgres.NewAuditRepository(pool)
	relay := outbox.NewRelay(postgres.NewOutboxRepository(pool), bus, discardLog())
	hs := handlers{prospecta: handler}
	log := discardLog()
	return func(cmd application.Command) error {
		process(context.Background(), log, hs, audits, relay, cmd)
		var success bool
		if err := pool.QueryRow(context.Background(),
			`SELECT success FROM audit_log WHERE command_id=$1 ORDER BY created_at DESC LIMIT 1`, cmd.ID).Scan(&success); err != nil {
			return err
		}
		if !success {
			return fmt.Errorf("comando %s falhou", cmd.Action)
		}
		return nil
	}
}

func processOptOut(st *optOutState, h func(application.Command) error, leadID string) error {
	cmd := application.Command{
		ID:     newCmdID(),
		Action: application.ActionSetOptOut,
		Payload: mustJSON(appprospecta.SetOptOutInput{
			TenantID: st.tenant, LeadID: leadID, Reason: st.reason,
		}),
	}
	st.lastCmdID = cmd.ID
	st.cmdErr = h(cmd)
	return nil
}
