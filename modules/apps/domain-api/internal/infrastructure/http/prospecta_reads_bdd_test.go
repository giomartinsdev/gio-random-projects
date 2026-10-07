package httpapi

// Steps do BDD (godog) para features/prospecta_reads.feature: as leituras do
// Prospecta que faltavam no domain-api (specs/004-prospecta).
//
// Roda contra Postgres REAL (testcontainers, o mesmo schema.sql do
// domain-worker) e sobe o ROUTER DE PRODUÇÃO, então o que se prova é a query, o
// RLS por tenant e o wiring das rotas — não uma cópia deles. O feed SSE é lido
// linha a linha de um cliente HTTP de verdade.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/postgres"
)

const (
	testAPIKey = "test-key"
	tenantA    = "11111111-1111-1111-1111-111111111111"
	tenantB    = "22222222-2222-2222-2222-222222222222"
)

var readsDSN string

func TestMain(m *testing.M) {
	os.Exit(runReadsPostgres(m))
}

func runReadsPostgres(m *testing.M) int {
	ctx := context.Background()
	abs, err := filepath.Abs(filepath.Join("..", "postgres", "schema.sql"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "schema não encontrado: %v\n", err)
		return m.Run()
	}
	pg, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("teste"),
		tcpostgres.WithUsername("teste"),
		tcpostgres.WithPassword("teste"),
		tcpostgres.WithInitScripts(abs),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintf(os.Stderr, "testcontainers indisponível (%v); leituras do Prospecta puladas\n", err)
		return m.Run()
	}
	defer func() { _ = pg.Terminate(ctx) }()

	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintf(os.Stderr, "connection string: %v\n", err)
		return 1
	}
	readsDSN = dsn
	return m.Run()
}

type readsState struct {
	pool   *pgxpool.Pool
	server *httptest.Server
	client *http.Client

	status int
	body   []byte

	campaignID     string
	leadID         string
	conversationID string
	convLeadID     string
	messageID      string
	runID          string
	leadPhoneID    string

	feed             *http.Response
	feedCancel       context.CancelFunc
	feedContentType  string
	feedEvents       []map[string]any
	goroutinesBefore int
}

func TestProspectaReadsBdd(t *testing.T) {
	if readsDSN == "" {
		t.Skip("Docker indisponível; pulando BDD das leituras do Prospecta")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, readsDSN)
	if err != nil {
		t.Fatalf("conectar: %v", err)
	}
	t.Cleanup(pool.Close)

	reads := postgres.NewProspectaReadRepository(pool)
	handlers := NewProspectaHandlers(reads, nil, discardLogger())
	router := NewRouter(NewHandlers(discardLogger()), nil, nil, nil, nil, nil, handlers,
		APIKeys{testAPIKey: "test"}, NewIPRateLimiter(1000, 1000), discardLogger())

	server := httptest.NewServer(router)
	defer server.Close()

	suite := godog.TestSuite{
		Name: "prospecta-reads",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &readsState{pool: pool, server: server, client: server.Client()}
			registerReadsSteps(sc, st)

			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				st.lastReset()
				if _, err := pool.Exec(ctx, `
					DELETE FROM prospecta_message;
					DELETE FROM prospecta_conversation;
					DELETE FROM prospecta_lead;
					DELETE FROM prospecta_campaign;
					DELETE FROM prospecta_agent_run;
					DELETE FROM prospecta_opt_out;
					DELETE FROM prospecta_user;`); err != nil {
					return ctx, err
				}
				return ctx, nil
			})
			sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
				st.closeFeed()
				return ctx, nil
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features/prospecta_reads.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários das leituras do Prospecta falharam")
	}
}

func (s *readsState) lastReset() {
	s.status, s.body = 0, nil
	s.campaignID, s.leadID, s.conversationID, s.convLeadID, s.messageID = "", "", "", "", ""
	s.runID, s.leadPhoneID = "", ""
	s.feed, s.feedCancel, s.feedContentType, s.feedEvents = nil, nil, "", nil
	s.goroutinesBefore = 0
}

func registerReadsSteps(sc *godog.ScenarioContext, st *readsState) {
	sc.Step(`^um banco de domínio limpo$`, func() error { return nil })

	sc.Step(`^uma campanha do tenant "([^"]*)" chamada "([^"]*)"$`, func(tenant, name string) error {
		st.campaignID = uuid.NewString()
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_campaign (id, tenant_id, company_id, name, channels, status)
			VALUES ($1,$2,$3,$4,'{email}','draft')`,
			st.campaignID, tenant, uuid.NewString(), name)
		return err
	})

	sc.Step(`^um lead do tenant "([^"]*)" na campanha "([^"]*)" com fit (\d+) e status "([^"]*)"$`,
		func(tenant, campaignID string, fit int, status string) error {
			st.leadID = uuid.NewString()
			return st.insertLead(st.leadID, tenantA, campaignID, fit, status)
		})

	sc.Step(`^uma conversa do tenant "([^"]*)" com thread "([^"]*)"$`, func(tenant, thread string) error {
		st.convLeadID = uuid.NewString()
		if err := st.insertLead(st.convLeadID, tenant, uuid.NewString(), 0, "contacted"); err != nil {
			return err
		}
		st.conversationID = uuid.NewString()
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_conversation (id, tenant_id, lead_id, thread_key, state)
			VALUES ($1,$2,$3,$4,'open')`, st.conversationID, tenant, st.convLeadID, thread)
		return err
	})

	sc.Step(`^duas mensagens na conversa uma "([^"]*)" e outra "([^"]*)"$`, func(dir1, dir2 string) error {
		for _, dir := range []string{dir1, dir2} {
			content, status := "Olá", "sent"
			if dir == "in" {
				content = "Bom dia"
			}
			if _, err := st.pool.Exec(context.Background(), `
				INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status)
				VALUES ($1,$2,$3,'email',$4,$5,$6)`,
				uuid.NewString(), tenantA, st.convLeadID, dir, content, status); err != nil {
				return err
			}
		}
		return nil
	})

	sc.Step(`^uma mensagem "([^"]*)" no lead cadastrado$`, func(status string) error {
		st.messageID = uuid.NewString()
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_message (id, tenant_id, lead_id, channel, direction, content, status)
			VALUES ($1,$2,$3,'email','out','Olá, tudo bem?',$4)`,
			st.messageID, tenantA, st.leadID, status)
		return err
	})

	sc.Step(`^um usuário do tenant "([^"]*)" com e-mail "([^"]*)" e hash "([^"]*)"$`, func(tenant, email, hash string) error {
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_user (id, tenant_id, company_id, name, email, password_hash, role)
			VALUES ($1,$2,$3,'Ana',$4,$5,'admin')`,
			uuid.NewString(), tenant, uuid.NewString(), email, hash)
		return err
	})

	sc.Step(`^um run do agente "([^"]*)" em "([^"]*)" no tenant "([^"]*)"$`, func(agent, state, tenant string) error {
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_agent_run (id, tenant_id, campaign_id, agent, state, metrics)
			VALUES ($1,$2,$3,$4,$5,'{"found":12}')`,
			uuid.NewString(), tenant, uuid.NewString(), agent, state)
		return err
	})

	// Um run com id capturado, para os passos que o leem de volta. Fechado
	// (done/failed) tem ended_at; running não.
	sc.Step(`^um run fechado do tenant "([^"]*)" do agente "([^"]*)" em "([^"]*)"$`, func(tenant, agent, state string) error {
		st.runID = uuid.NewString()
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_agent_run (id, tenant_id, campaign_id, agent, state, metrics, ended_at)
			VALUES ($1,$2,$3,$4,$5,'{"found":12}', now())`,
			st.runID, tenant, uuid.NewString(), agent, state)
		return err
	})
	sc.Step(`^eu leio o run pelo id cadastrado$`, func() error {
		return st.get("/agent/runs/" + st.runID + "?tenant_id=" + tenantA)
	})

	sc.Step(`^um opt-out do lead "([^"]*)" para o tenant "([^"]*)"$`, func(leadID, tenant string) error {
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_opt_out (id, tenant_id, lead_id, reason)
			VALUES ($1,$2,$3,'pedido do titular')`,
			uuid.NewString(), tenant, leadID)
		return err
	})

	// O telefone vive em enriched->>'phone' (E.164 sem +) — a leitura by-phone é
	// cross-tenant e casa por este valor normalizado.
	sc.Step(`^um lead do tenant "([^"]*)" com telefone "([^"]*)"$`, func(tenant, phone string) error {
		st.leadPhoneID = uuid.NewString()
		_, err := st.pool.Exec(context.Background(), `
			INSERT INTO prospecta_lead (id, tenant_id, campaign_id, company_name, domain, segment, channel, fit, status, source_url, enriched)
			VALUES ($1,$2,$3,'Northwind Log',$4,'logística','whatsapp',0,'discovered','https://exemplo.com',$5)`,
			st.leadPhoneID, tenant, uuid.NewString(),
			"northwind-"+strings.ReplaceAll(st.leadPhoneID, "-", "")[:8]+".com",
			`{"phone":"`+phone+`"}`)
		return err
	})

	sc.Step(`^eu faço GET "([^"]*)"$`, func(path string) error { return st.get(path) })
	sc.Step(`^eu leio o lead cadastrado$`, func() error {
		return st.get("/leads/" + st.leadID + "?tenant_id=" + tenantA)
	})
	sc.Step(`^eu leio a conversa cadastrada$`, func() error {
		return st.get("/conversations/" + st.conversationID + "?tenant_id=" + tenantA)
	})
	sc.Step(`^eu leio a mensagem cadastrada$`, func() error {
		return st.get("/messages/" + st.messageID + "?tenant_id=" + tenantA)
	})
	sc.Step(`^eu leio a mensagem inexistente$`, func() error {
		return st.get("/messages/00000000-0000-0000-0000-000000000000?tenant_id=" + tenantA)
	})

	sc.Step(`^a resposta tem status HTTP (\d+)$`, func(want int) error {
		if st.status != want {
			return fmt.Errorf("status = %d; want %d (%s)", st.status, want, st.body)
		}
		return nil
	})
	sc.Step(`^o corpo traz a lista "([^"]*)" com (\d+) itens$`, func(field string, want int) error {
		body, err := st.json()
		if err != nil {
			return err
		}
		items, _ := body[field].([]any)
		if len(items) != want {
			return fmt.Errorf("%s = %d itens; want %d (%s)", field, len(items), want, st.body)
		}
		return nil
	})
	sc.Step(`^a resposta traz um "([^"]*)" não vazio$`, func(field string) error {
		body, err := st.json()
		if err != nil {
			return err
		}
		if got, _ := body[field].(string); got == "" {
			return fmt.Errorf("%s vazio; want não vazio (%s)", field, st.body)
		}
		return nil
	})
	sc.Step(`^o corpo traz "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		got, _ := st.field(field).(string)
		if got != want {
			return fmt.Errorf("%s = %q; want %q", field, got, want)
		}
		return nil
	})
	sc.Step(`^o corpo traz "([^"]*)" igual a (\d+)$`, func(field string, want int) error {
		got, _ := st.field(field).(float64)
		if int(got) != want {
			return fmt.Errorf("%s = %v; want %d", field, st.field(field), want)
		}
		return nil
	})
	sc.Step(`^o corpo traz "([^"]*)" igual a (true|false)$`, func(field, want string) error {
		got, _ := st.field(field).(bool)
		if got != (want == "true") {
			return fmt.Errorf("%s = %v; want %s", field, st.field(field), want)
		}
		return nil
	})
	sc.Step(`^o corpo traz "([^"]*)" não vazio$`, func(field string) error {
		if got, _ := st.field(field).(string); got == "" {
			return fmt.Errorf("%s vazio; want não vazio (%s)", field, st.body)
		}
		return nil
	})

	// Feed SSE.
	sc.Step(`^eu abro o feed "([^"]*)"$`, func(path string) error { return st.openFeed(path) })
	sc.Step(`^o feed responde "([^"]*)"$`, func(want string) error {
		if !strings.HasPrefix(st.feedContentType, want) {
			return fmt.Errorf("Content-Type = %q; want %q", st.feedContentType, want)
		}
		return nil
	})
	sc.Step(`^o feed entrega o primeiro evento com "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		if len(st.feedEvents) == 0 {
			return fmt.Errorf("nenhum evento recebido")
		}
		got, _ := st.feedEvents[0][field].(string)
		if got != want {
			return fmt.Errorf("evento 1: %s = %q; want %q", field, got, want)
		}
		return nil
	})
	sc.Step(`^eu abro o feed "([^"]*)" e depois desconecto$`, func(path string) error {
		st.goroutinesBefore = runtime.NumGoroutine()
		if err := st.openFeed(path); err != nil {
			return err
		}
		return st.disconnectFeed()
	})
	sc.Step(`^nenhuma goroutine do feed fica pendurada$`, func() error {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			runtime.GC()
			time.Sleep(20 * time.Millisecond)
			if runtime.NumGoroutine() <= st.goroutinesBefore+2 {
				return nil
			}
		}
		return fmt.Errorf("goroutines = %d; antes do feed = %d (vazamento?)",
			runtime.NumGoroutine(), st.goroutinesBefore)
	})
}

func (s *readsState) insertLead(id, tenant, campaignID string, fit int, status string) error {
	// domain é parte da chave de dedup (tenant_id, domain, company_name): varia
	// por id para que dois leads do mesmo tenant sejam linhas distintas.
	domain := "northwind-" + strings.ReplaceAll(id, "-", "")[:8] + ".com"
	_, err := s.pool.Exec(context.Background(), `
		INSERT INTO prospecta_lead (id, tenant_id, campaign_id, company_name, domain, segment, channel, fit, status, source_url, enriched)
		VALUES ($1,$2,$3,'Northwind Log',$4,'logística','email',$5,$6,'https://exemplo.com','{"decision_maker":"Ana"}')`,
		id, tenant, campaignID, domain, fit, status)
	return err
}

func (s *readsState) get(path string) error {
	req, err := http.NewRequest(http.MethodGet, s.server.URL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-API-Key", testAPIKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	s.status, s.body = resp.StatusCode, body
	return nil
}

func (s *readsState) json() (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(s.body, &body); err != nil {
		return nil, fmt.Errorf("corpo não é JSON: %v (%s)", err, s.body)
	}
	return body, nil
}

func (s *readsState) field(name string) any {
	body, err := s.json()
	if err != nil {
		return nil
	}
	return body[name]
}

func (s *readsState) openFeed(path string) error {
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.server.URL+path, nil)
	if err != nil {
		cancel()
		return err
	}
	req.Header.Set("X-API-Key", testAPIKey)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := s.client.Do(req)
	if err != nil {
		cancel()
		return err
	}
	s.feed, s.feedCancel = resp, cancel
	s.status, s.feedContentType = resp.StatusCode, resp.Header.Get("Content-Type")

	// O handler emite o primeiro lote já na conexão (o run foi semeado antes),
	// então um evento é lido aqui, com prazo — sem depender do tick de 2s.
	if resp.StatusCode == http.StatusOK {
		ev, err := readSSEEvent(resp.Body)
		if err != nil {
			return err
		}
		s.feedEvents = append(s.feedEvents, ev)
	}
	return nil
}

func (s *readsState) disconnectFeed() error {
	if s.feedCancel != nil {
		s.feedCancel()
	}
	if s.feed != nil {
		_ = s.feed.Body.Close()
	}
	return nil
}

func (s *readsState) closeFeed() { _ = s.disconnectFeed() }

// readSSEEvent lê um bloco `event:`/`data:` e devolve o JSON do data.
func readSSEEvent(r io.Reader) (map[string]any, error) {
	reader := bufio.NewReader(r)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("ler stream: %w", err)
		}
		line = strings.TrimRight(line, "\r\n")
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var ev map[string]any
		if err := json.Unmarshal([]byte(payload), &ev); err != nil {
			return nil, fmt.Errorf("data não é JSON: %q", payload)
		}
		return ev, nil
	}
	return nil, fmt.Errorf("nenhum evento do feed em 5s")
}
