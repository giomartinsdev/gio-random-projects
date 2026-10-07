package main

// Steps do BDD (godog) para features/prospecta_agent_run.feature — o comando
// UpdateAgentRun do Prospecta (specs/004-prospecta).
//
// Mesma trilha real do prospecta_company: process() -> CommandHandler ->
// repositório -> Postgres (testcontainers, o schema.sql do worker). Reusa os
// helpers de prospecta_company_bdd_test.go (prospectaPool, busStub, discardLog,
// handlers, process, mustJSON, newCmdID), que vivem no mesmo pacote main.
//
// O run é aberto pelo RequestProspect (comando separado); aqui o teste o semeia
// direto no banco para focar no FECHAMENTO (UpdateAgentRun): state, metrics,
// ended_at e a idempotência que não regride um run terminal.

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/cucumber/godog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/prospecta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
)

type agentRunState struct {
	tenant string
	runID  string
	agent  string

	state   string
	metrics string

	lastCmdID string
	cmdErr    error
	bus       *busStub
}

func (s *agentRunState) reset() {
	bus := s.bus
	*s = agentRunState{bus: bus, agent: "prospector"}
	if bus != nil {
		bus.names = nil
	}
}

func TestProspectaAgentRunBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "prospecta-agent-run",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &agentRunState{bus: &busStub{}, agent: "prospector"}
			pool := prospectaPool(t)
			h := agentRunHandler(pool, st.bus)

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				st.reset()
				if _, err := pool.Exec(ctx, `DELETE FROM prospecta_agent_run; DELETE FROM audit_log; DELETE FROM outbox`); err != nil {
					return ctx, err
				}
				return ctx, nil
			})

			sc.Step(`^um banco de domínio limpo$`, func() error { return nil })

			sc.Step(`^um run do tenant "([^"]*)" do agente "([^"]*)" em "([^"]*)"$`,
				func(tenant, agent, state string) error {
					st.tenant, st.agent, st.state = tenant, agent, state
					st.runID = uuid.NewString()
					_, err := pool.Exec(context.Background(), `
						INSERT INTO prospecta_agent_run (id, tenant_id, campaign_id, agent, state)
						VALUES ($1,$2,$3,$4,$5)`,
						st.runID, tenant, uuid.NewString(), agent, state)
					return err
				})

			sc.Step(`^o worker processa "UpdateAgentRun" para esse run com state "([^"]*)" e metrics "([^"]*)"$`,
				func(state, metrics string) error {
					st.state, st.metrics = state, metrics
					return processUpdateRun(st, h, st.runID, true)
				})

			sc.Step(`^o worker processa "UpdateAgentRun" para um run inexistente do tenant "([^"]*)"$`,
				func(tenant string) error {
					st.tenant, st.state, st.metrics = tenant, "done", ""
					return processUpdateRun(st, h, "99999999-9999-9999-9999-999999999999", true)
				})

			sc.Step(`^o worker processa o MESMO comando de novo$`, func() error {
				cmd := application.Command{
					ID:     st.lastCmdID,
					Action: application.ActionUpdateAgentRun,
					Payload: mustJSON(appprospecta.UpdateAgentRunInput{
						TenantID: st.tenant, RunID: st.runID, State: st.state,
						Metrics: parseMetrics(st.metrics),
					}),
				}
				st.cmdErr = runProcess(h, cmd)
				return nil
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

			sc.Step(`^o run do tenant "([^"]*)" tem state "([^"]*)"$`, func(tenant, want string) error {
				var got string
				if err := pool.QueryRow(context.Background(),
					`SELECT state FROM prospecta_agent_run WHERE tenant_id=$1 LIMIT 1`, tenant).Scan(&got); err != nil {
					return err
				}
				if got != want {
					return fmt.Errorf("state = %q; want %q", got, want)
				}
				return nil
			})
			sc.Step(`^o run do tenant "([^"]*)" tem metrics "([^"]*)" igual a (\d+)$`, func(tenant, key string, want int) error {
				var got int
				if err := pool.QueryRow(context.Background(),
					`SELECT (metrics->>$2)::int FROM prospecta_agent_run WHERE tenant_id=$1 LIMIT 1`, tenant, key).Scan(&got); err != nil {
					return err
				}
				if got != want {
					return fmt.Errorf("metrics[%s] = %d; want %d", key, got, want)
				}
				return nil
			})
			sc.Step(`^o run do tenant "([^"]*)" tem ended_at preenchido$`, func(tenant string) error {
				var filled bool
				if err := pool.QueryRow(context.Background(),
					`SELECT ended_at IS NOT NULL FROM prospecta_agent_run WHERE tenant_id=$1 LIMIT 1`, tenant).Scan(&filled); err != nil {
					return err
				}
				if !filled {
					return fmt.Errorf("ended_at vazio; want preenchido")
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
			Paths:    []string{"features/prospecta_agent_run.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários do AgentRun falharam")
	}
}

func agentRunHandler(pool *pgxpool.Pool, bus *busStub) func(application.Command) error {
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

func processUpdateRun(st *agentRunState, h func(application.Command) error, runID string, _ bool) error {
	cmd := application.Command{
		ID:     newCmdID(),
		Action: application.ActionUpdateAgentRun,
		Payload: mustJSON(appprospecta.UpdateAgentRunInput{
			TenantID: st.tenant, RunID: runID, State: st.state,
			Metrics: parseMetrics(st.metrics),
		}),
	}
	st.lastCmdID = cmd.ID
	st.cmdErr = h(cmd)
	return nil
}

// parseMetrics lê "found=12,latency=3" no mapa que o repositório grava em JSONB.
func parseMetrics(s string) map[string]any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	out := map[string]any{}
	for _, pair := range strings.Split(s, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if !ok {
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			out[strings.TrimSpace(k)] = n
			continue
		}
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out
}
