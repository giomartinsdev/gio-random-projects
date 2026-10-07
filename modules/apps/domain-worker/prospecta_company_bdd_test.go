package main

// Steps do BDD (godog) para features/prospecta_company.feature — o primeiro
// vertical slice do Prospecta (specs/004-prospecta).
//
// Diferente do clubs_routing (que testa uma função pura), este suite exercita a
// trilha de escrita REAL do worker: process() -> CommandHandler -> repositório
// -> Postgres. Sobe um Postgres via testcontainers (o mesmo schema.sql do
// worker) e reusa o process() de produção, então o que se prova é o wiring e a
// auditoria, não uma cópia deles. Sem Docker, o suite se pula (não falha).
//
// O evento não vai a broker nenhum no teste: um bus stub captura o nome do
// evento levantado. O que importa aqui é a DECISÃO de levantar (ou não, numa
// reentrega) — o outbox durável já é coberto por outbox_repository_test.go.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/outbox"
	appprospecta "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application/prospecta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/postgres"
)

var prospectaDSN string

func TestMain(m *testing.M) {
	os.Exit(runProspectaPostgres(m))
}

func runProspectaPostgres(m *testing.M) int {
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		prospectaDSN = dsn
		return m.Run()
	}
	ctx := context.Background()
	pg, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("teste"),
		tcpostgres.WithUsername("teste"),
		tcpostgres.WithPassword("teste"),
		tcpostgres.WithInitScripts(workerSchemaAbsPath()),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testcontainers indisponível (%v); BDD do Prospecta pulado\n", err)
		return m.Run()
	}
	defer func() { _ = pg.Terminate(ctx) }()
	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		return 1
	}
	prospectaDSN = dsn
	return m.Run()
}

// workerSchemaAbsPath: o cwd do teste de pacote main é a raiz do módulo.
func workerSchemaAbsPath() string {
	abs, err := filepath.Abs(filepath.Join("internal", "infrastructure", "postgres", "schema.sql"))
	if err != nil {
		return "schema.sql"
	}
	return abs
}

// busStub satisfaz outbox.Bus e só registra o nome de cada evento publicado.
type busStub struct {
	names []string
}

func (b *busStub) EnvelopeBytes(_ string, _ string, eventName string, _ time.Time, _ json.RawMessage) ([]byte, error) {
	b.names = append(b.names, eventName)
	return json.RawMessage(`{}`), nil
}

func (b *busStub) PublishRaw(context.Context, []byte) error { return nil }

// prospectaState guarda o estado entre os passos de um cenário.
type prospectaState struct {
	tenant     string
	name       string
	site       string
	companyID  string
	definition string
	signals    []string
	noName     bool
	lastCmdID  string
	cmdErr     error
	bus        *busStub
}

// reset limpa o estado mantendo a MESMA instância do bus: o relay é criado uma
// vez e publica nessa instância, então trocá-la aqui faria as asserções lerem
// um bus diferente do que recebeu os eventos.
func (s *prospectaState) reset() {
	bus := s.bus
	*s = prospectaState{bus: bus}
	if bus != nil {
		bus.names = nil
	}
	*s = prospectaState{bus: bus}
}

func TestProspectaCompanyBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "prospecta-company",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			state := &prospectaState{bus: &busStub{}}
			pool := prospectaPool(t)
			h := prospectaHandler(pool, state)

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				state.reset()
				if _, err := pool.Exec(ctx, `DELETE FROM prospecta_icp; DELETE FROM prospecta_company; DELETE FROM audit_log; DELETE FROM outbox`); err != nil {
					return ctx, err
				}
				return ctx, nil
			})

			sc.Step(`^um banco de domínio limpo$`, func() error { return nil })

			sc.Step(`^o worker processa "CreateCompany" para o tenant "([^"]*)" com nome "([^"]*)" e site "([^"]*)"$`,
				func(tenant, nome, site string) error {
					state.tenant, state.name, state.site, state.noName = tenant, nome, site, false
					return processCreate(state, pool, h)
				})
			sc.Step(`^o worker processa "CreateCompany" sem nome para o tenant "([^"]*)"$`,
				func(tenant string) error {
					state.tenant, state.name, state.noName = tenant, "", true
					return processCreate(state, pool, h)
				})
			sc.Step(`^uma empresa do tenant "([^"]*)" cadastrada como "([^"]*)"$`,
				func(tenant, nome string) error {
					state.tenant, state.name, state.noName = tenant, nome, false
					if err := processCreate(state, pool, h); err != nil {
						return err
					}
					return pool.QueryRow(context.Background(),
						`SELECT id::text FROM prospecta_company WHERE tenant_id=$1 AND name=$2 ORDER BY created_at DESC LIMIT 1`,
						tenant, nome).Scan(&state.companyID)
				})
			sc.Step(`^o worker processa "DefineICP" para essa empresa com definição "([^"]*)" e sinais "([^"]*)"$`,
				func(def, sinais string) error {
					state.definition = def
					state.signals = splitSignals(sinais)
					return processICP(state, h, state.companyID, false)
				})
			sc.Step(`^o worker processa "DefineICP" para uma empresa inexistente do tenant "([^"]*)"$`,
				func(tenant string) error {
					state.tenant = tenant
					return processICP(state, h, "99999999-9999-9999-9999-999999999999", false)
				})
			sc.Step(`^o worker processa o MESMO comando de novo$`, func() error {
				cmd := application.Command{
					ID:     state.lastCmdID,
					Action: application.ActionCreateCompany,
					Payload: mustJSON(appprospecta.CreateCompanyInput{
						TenantID: state.tenant, Name: state.name, Site: state.site,
					}),
				}
				state.cmdErr = runProcess(h, cmd)
				return nil
			})

			sc.Step(`^o comando termina sem erro$`, func() error {
				if state.cmdErr != nil {
					return fmt.Errorf("esperava sucesso; veio %v", state.cmdErr)
				}
				return nil
			})
			sc.Step(`^o comando termina com erro$`, func() error {
				if state.cmdErr == nil {
					return fmt.Errorf("esperava erro; o comando passou")
				}
				return nil
			})
			sc.Step(`^existem (\d+) empresas do tenant "([^"]*)"$`, func(n int, tenant string) error {
				return esperaInt(pool, `SELECT count(*) FROM prospecta_company WHERE tenant_id=$1`, tenant, n, "empresas")
			})
			sc.Step(`^existem (\d+) ICPs do tenant "([^"]*)"$`, func(n int, tenant string) error {
				return esperaInt(pool, `SELECT count(*) FROM prospecta_icp WHERE tenant_id=$1`, tenant, n, "ICPs")
			})
			sc.Step(`^a empresa do tenant "([^"]*)" tem nome "([^"]*)"$`, func(tenant, nome string) error {
				var got string
				if err := pool.QueryRow(context.Background(),
					`SELECT name FROM prospecta_company WHERE tenant_id=$1 LIMIT 1`, tenant).Scan(&got); err != nil {
					return err
				}
				if got != nome {
					return fmt.Errorf("nome = %q; want %q", got, nome)
				}
				return nil
			})
			sc.Step(`^o ICP do tenant "([^"]*)" tem definição "([^"]*)"$`, func(tenant, def string) error {
				var got string
				if err := pool.QueryRow(context.Background(),
					`SELECT definition FROM prospecta_icp WHERE tenant_id=$1 LIMIT 1`, tenant).Scan(&got); err != nil {
					return err
				}
				if got != def {
					return fmt.Errorf("definition = %q; want %q", got, def)
				}
				return nil
			})
			sc.Step(`^o evento "([^"]*)" foi levantado$`, func(nome string) error {
				if !contains(state.bus.names, nome) {
					return fmt.Errorf("evento %q não levantado; veio %v", nome, state.bus.names)
				}
				return nil
			})
			sc.Step(`^houve apenas (\d+) evento "([^"]*)"$`, func(n int, nome string) error {
				if got := countOf(state.bus.names, nome); got != n {
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
			Format: "pretty",
			// Só este feature (o diretório features/ tem mais de um arquivo):
			// rodar todos aqui faria os steps do clubs_routing aparecerem como
			// indefinidos e, com Strict=false, passarem em silêncio.
			Paths:    []string{"features/prospecta_company.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários do Prospecta falharam")
	}
}

func prospectaPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if prospectaDSN == "" {
		t.Skip("Docker indisponível; pulando BDD do Prospecta")
	}
	pool, err := pgxpool.New(context.Background(), prospectaDSN)
	if err != nil {
		t.Fatalf("conectar: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := postgres.Migrate(context.Background(), pool); err != nil {
		t.Fatalf("aplicar schema: %v", err)
	}
	return pool
}

// prospectaHandler monta o handler + o process() reais, com o bus stub.
func prospectaHandler(pool *pgxpool.Pool, state *prospectaState) func(application.Command) error {
	repo := postgres.NewProspectaRepository(pool)
	handler := appprospecta.NewCommandHandler(appprospecta.NewService(repo))
	audits := postgres.NewAuditRepository(pool)
	relay := outbox.NewRelay(postgres.NewOutboxRepository(pool), state.bus, discardLog())
	hs := handlers{prospecta: handler}
	log := discardLog()
	return func(cmd application.Command) error {
		process(context.Background(), log, hs, audits, relay, cmd)
		// process() não devolve erro: ele grava o resultado na auditoria. O
		// step lê a linha da auditoria pelo command_id para saber o desfecho.
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

func processCreate(state *prospectaState, pool *pgxpool.Pool, h func(application.Command) error) error {
	cmd := application.Command{
		ID:     newCmdID(),
		Action: application.ActionCreateCompany,
		Payload: mustJSON(appprospecta.CreateCompanyInput{
			TenantID: state.tenant, Name: state.name, Site: state.site,
		}),
	}
	state.lastCmdID = cmd.ID
	state.cmdErr = h(cmd)
	return nil
}

func processICP(state *prospectaState, h func(application.Command) error, companyID string, _ bool) error {
	cmd := application.Command{
		ID:     newCmdID(),
		Action: application.ActionDefineICP,
		Payload: mustJSON(appprospecta.DefineICPInput{
			TenantID: state.tenant, CompanyID: companyID,
			Definition: state.definition, Signals: state.signals,
		}),
	}
	state.lastCmdID = cmd.ID
	state.cmdErr = h(cmd)
	return nil
}

func runProcess(h func(application.Command) error, cmd application.Command) error {
	return h(cmd)
}

func esperaInt(pool *pgxpool.Pool, query, tenant string, want int, what string) error {
	var got int
	if err := pool.QueryRow(context.Background(), query, tenant).Scan(&got); err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("%s = %d; want %d", what, got, want)
	}
	return nil
}

func splitSignals(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func countOf(xs []string, x string) int {
	n := 0
	for _, v := range xs {
		if v == x {
			n++
		}
	}
	return n
}

func newCmdID() string {
	// audit_log.command_id é UUID NOT NULL: o id do teste precisa ser um UUID
	// de verdade para a linha de auditoria gravar.
	return uuid.NewString()
}

func mustJSON(v any) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return raw
}

func discardLog() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}
