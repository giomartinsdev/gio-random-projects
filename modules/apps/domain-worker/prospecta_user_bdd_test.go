package main

// Steps do BDD (godog) para features/prospecta_user.feature — o agregado User
// (autenticação e-mail+senha) do Prospecta (specs/004-prospecta).
//
// Mesma trilha real do prospecta_company: process() -> CommandHandler ->
// repositório -> Postgres (testcontainers, o schema.sql do worker). Reusa os
// helpers de prospecta_company_bdd_test.go (prospectaPool, busStub,
// discardLog, handlers, process), que vive no mesmo pacote main.
//
// O password_hash já chega pronto (bcrypt) no payload: o worker só grava, nunca
// vê a senha em claro. O e-mail é a chave do login e é único GLOBALMENTE
// (índice lower(email)): a leitura cross-tenant por e-mail vive no domain-api,
// não aqui.

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

type userState struct {
	tenant    string
	companyID string
	name      string
	email     string
	password  string
	role      string

	noEmail      bool
	invalidEmail bool
	noPassword   bool

	lastCmdID string
	cmdErr    error
	bus       *busStub
}

func (s *userState) reset() {
	bus := s.bus
	companyID := s.companyID
	*s = userState{bus: bus, companyID: companyID, role: "admin"}
	if bus != nil {
		bus.names = nil
	}
}

func TestProspectaUserBdd(t *testing.T) {
	suite := godog.TestSuite{
		Name: "prospecta-user",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &userState{bus: &busStub{}, companyID: uuid.NewString(), role: "admin"}
			pool := prospectaPool(t)
			h := userHandler(pool, st.bus)

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				st.reset()
				if _, err := pool.Exec(ctx, `DELETE FROM prospecta_user; DELETE FROM audit_log; DELETE FROM outbox`); err != nil {
					return ctx, err
				}
				return ctx, nil
			})

			sc.Step(`^um banco de domínio limpo$`, func() error { return nil })

			sc.Step(`^um usuário do tenant "([^"]*)" com e-mail "([^"]*)"$`, func(tenant, email string) error {
				if _, err := pool.Exec(context.Background(), `
					INSERT INTO prospecta_user (id, tenant_id, company_id, name, email, password_hash, role)
					VALUES ($1,$2,$3,'Seed',$4,'seed-hash','admin')`,
					uuid.NewString(), tenant, uuid.NewString(), email); err != nil {
					return err
				}
				return nil
			})

			sc.Step(`^o worker processa "CreateUser" para o tenant "([^"]*)" com e-mail "([^"]*)" e senha "([^"]*)"$`,
				func(tenant, email, senha string) error {
					st.tenant, st.email, st.password = tenant, email, senha
					st.name = "Ana"
					return processCreateUser(st, h)
				})
			sc.Step(`^o worker processa "CreateUser" sem e-mail para o tenant "([^"]*)"$`, func(tenant string) error {
				st.tenant, st.email, st.password, st.noEmail = tenant, "", "hash-bcrypt-1", true
				return processCreateUser(st, h)
			})
			sc.Step(`^o worker processa "CreateUser" com e-mail inválido "([^"]*)" para o tenant "([^"]*)"$`,
				func(email, tenant string) error {
					st.tenant, st.email, st.password = tenant, email, "hash-bcrypt-1"
					st.invalidEmail = true
					return processCreateUser(st, h)
				})
			sc.Step(`^o worker processa "CreateUser" sem senha para o tenant "([^"]*)"$`, func(tenant string) error {
				st.tenant, st.email, st.password, st.noPassword = tenant, "sem-senha@acme.com", "", true
				return processCreateUser(st, h)
			})
			sc.Step(`^o worker processa o MESMO comando CreateUser de novo$`, func() error {
				cmd := application.Command{
					ID:     st.lastCmdID,
					Action: application.ActionCreateUser,
					Payload: mustJSON(appprospecta.CreateUserInput{
						TenantID: st.tenant, CompanyID: st.companyID, Name: st.name,
						Email: st.email, PasswordHash: st.password, Role: st.role,
					}),
				}
				st.cmdErr = h(cmd)
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
			sc.Step(`^existem (\d+) usuários do tenant "([^"]*)"$`, func(n int, tenant string) error {
				return esperaInt(pool, `SELECT count(*) FROM prospecta_user WHERE tenant_id=$1`, tenant, n, "usuários")
			})
			sc.Step(`^o usuário "([^"]*)" tem role "([^"]*)"$`, func(email, role string) error {
				var got string
				if err := pool.QueryRow(context.Background(),
					`SELECT role FROM prospecta_user WHERE lower(email)=lower($1) LIMIT 1`, email).Scan(&got); err != nil {
					return err
				}
				if got != role {
					return fmt.Errorf("role = %q; want %q", got, role)
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
			Paths:    []string{"features/prospecta_user.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários do agregado User falharam")
	}
}

// userHandler monta o handler + o process() reais do worker, com o bus stub.
func userHandler(pool *pgxpool.Pool, bus *busStub) func(application.Command) error {
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

func processCreateUser(st *userState, h func(application.Command) error) error {
	cmd := application.Command{
		ID:     newCmdID(),
		Action: application.ActionCreateUser,
		Payload: mustJSON(appprospecta.CreateUserInput{
			TenantID: st.tenant, CompanyID: st.companyID, Name: st.name,
			Email: st.email, PasswordHash: st.password, Role: st.role,
		}),
	}
	st.lastCmdID = cmd.ID
	st.cmdErr = h(cmd)
	return nil
}
