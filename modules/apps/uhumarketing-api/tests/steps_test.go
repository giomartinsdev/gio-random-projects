package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"
	"github.com/jackc/pgx/v5/pgxpool"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/dispatch"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// Os cenários rodam contra Postgres REAL (testcontainers) e o router REAL
// (httptest). Nada de repositório fake: o que precisa ser provado aqui inclui o
// SQL — o UNIQUE que impede mandar duas vezes para o mesmo contato, o claim com
// SKIP LOCKED e as métricas derivadas. Um fake esconderia exatamente esses
// erros.
//
// Sem Docker, a suíte inteira é pulada (o resto de `go test` continua).

var (
	pool     *pgxpool.Pool
	baseURL  string
	server   *httptest.Server
	testLog  = slog.New(slog.NewTextHandler(io.Discard, nil))
	testDSN  string
	dockerOK bool
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	container, err := tcpostgres.Run(ctx, "postgres:16-alpine",
		tcpostgres.WithDatabase("uhumarketing_test"),
		tcpostgres.WithUsername("uhu"),
		tcpostgres.WithPassword("uhu"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "docker indisponível; pulando testes de integração:", err)
		os.Exit(0)
	}

	testDSN, err = container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		_ = container.Terminate(ctx)
		os.Exit(1)
	}
	pool, err = pgxpool.New(ctx, testDSN)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		_ = container.Terminate(ctx)
		os.Exit(1)
	}
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "ping:", err)
		_ = container.Terminate(ctx)
		os.Exit(1)
	}
	dockerOK = true

	code := m.Run()
	pool.Close()
	_ = container.Terminate(ctx)
	os.Exit(code)
}

/* ------------------------------------------------------------------ features */

func TestTemplates(t *testing.T)      { runFeature(t, "templates.feature") }
func TestCampaignSend(t *testing.T)   { runFeature(t, "campaign_send.feature") }
func TestAudiencesOptin(t *testing.T) { runFeature(t, "audiences_optin.feature") }
func TestChannelLive(t *testing.T)    { runFeature(t, "channel_live.feature") }

func runFeature(t *testing.T, file string) {
	if !dockerOK {
		t.Skip("docker indisponível")
	}
	suite := godog.TestSuite{
		Name: file,
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			w := &world{t: t}
			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				w.reset()
				return ctx, nil
			})
			registerSteps(sc, w)
			registerChannelSteps(sc, w)
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features/" + file},
			TestingT: t,
			Strict:   true,
		},
	}
	if suite.Run() != 0 {
		t.Fatal("feature falhou")
	}
}

/* --------------------------------------------------------------------- mundo */

type world struct {
	t        *testing.T
	store    *store.Store
	svc      *httpapi.Service
	handlers *httpapi.Handlers
	provider meta.Provider

	status      int
	body        []byte
	token       string
	workspaceID string
	templateID  string
	campaignID  string
	segmentID   string
	lastPhone   string
	externalID  string
}

func (w *world) reset() {
	w.t.Helper()
	ctx := context.Background()

	// O schema é idempotente; roda antes do TRUNCATE porque na primeira vez as
	// tabelas ainda não existem.
	if err := store.Migrate(ctx, pool); err != nil {
		w.t.Fatalf("migrate: %v", err)
	}
	// Contas entram no TRUNCATE porque agora cada cenário cria a sua: sem isso
	// o e-mail do cenário anterior continuaria cadastrado.
	if _, err := pool.Exec(ctx, `
		TRUNCATE sessions, users, contact_consents, sends, campaigns, flows, segments,
		         contacts, templates, activity, webhook_events, workspaces
		RESTART IDENTITY CASCADE`); err != nil {
		w.t.Fatalf("limpar banco: %v", err)
	}

	w.store = store.New(pool)
	w.provider = &meta.DryRunProvider{}
	w.svc = &httpapi.Service{Store: w.store, Provider: w.provider, Log: testLog}
	w.handlers = &httpapi.Handlers{
		Service:            w.svc,
		Log:                testLog,
		WebhookVerifyToken: "verify-token",
		AllowDevActions:    true,
	}
	server = httptest.NewServer(httpapi.NewRouter(w.handlers, []string{"*"}, testLog))
	baseURL = server.URL
	w.t.Cleanup(server.Close)

	// Todo cenário roda como uma conta de verdade: cadastro, sessão e workspace
	// próprios. Assim o isolamento por workspace é exercitado em cada passo, e
	// não só no teste de contas.
	w.signup("marina@teste.dev", "cafe1234")

	// O número de WhatsApp é o que a Meta daria ao conectar o número; sem ele
	// nenhuma campanha pode disparar. Não é dado de demonstração, é
	// configuração da conta — o cadastro deixa em branco para o operador
	// preencher.
	if _, err := pool.Exec(ctx, `
		UPDATE workspaces SET segment='café', site='cafeaurora.com.br',
		       whatsapp_number='5511912345678', email_sender='time@cafeaurora.com.br',
		       quality='green', messaging_limit='100 mil', opt_in_policy='opt-in explícito',
		       quiet_start=21, quiet_end=8
		WHERE id=$1`, w.workspaceID); err != nil {
		w.t.Fatalf("configurar workspace: %v", err)
	}

	w.status, w.body = 0, nil
	w.templateID, w.campaignID, w.segmentID, w.lastPhone, w.externalID = "", "", "", "", ""
}

// signup cria a conta do cenário pelo mesmo endpoint que a SPA usa. Se o
// cadastro quebrar, o teste quebra aqui — e não três passos depois com um 401
// confuso.
func (w *world) signup(email, password string) {
	w.t.Helper()
	w.do(http.MethodPost, "/api/v1/auth/signup", map[string]any{
		"name": "Marina Reis", "email": email, "password": password, "company": "Café Aurora",
	})
	if w.status != http.StatusCreated {
		w.t.Fatalf("cadastro: %d %s", w.status, w.body)
	}
	var acc struct {
		Token       string `json:"token"`
		WorkspaceID string `json:"workspaceId"`
	}
	w.decode(&acc)
	w.token, w.workspaceID = acc.Token, acc.WorkspaceID
}

func (w *world) do(method, path string, body any) {
	w.t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			w.t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		w.t.Fatalf("request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Webhook e login/cadastro são públicos; o resto viaja com a sessão do
	// cenário.
	if !strings.HasPrefix(path, "/webhooks") && !strings.HasPrefix(path, "/api/v1/auth/") {
		req.Header.Set("Authorization", "Bearer "+w.token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		w.t.Fatalf("do %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	w.status = resp.StatusCode
	w.body, _ = io.ReadAll(resp.Body)
}

func (w *world) get(path string)          { w.do(http.MethodGet, path, nil) }
func (w *world) post(path string, b any)  { w.do(http.MethodPost, path, b) }
func (w *world) patch(path string, b any) { w.do(http.MethodPatch, path, b) }

func (w *world) decode(v any) {
	w.t.Helper()
	if err := json.Unmarshal(w.body, v); err != nil {
		w.t.Fatalf("decodificar %q: %v", string(w.body), err)
	}
}

/* --------------------------------------------------------------------- steps */

func registerSteps(sc *godog.ScenarioContext, w *world) {
	/* ------------------------------------------------------------ background */
	sc.Step(`^um workspace de teste$`, func() error { return nil })
	sc.Step(`^um provedor dry-run$`, func() error {
		w.provider = &meta.DryRunProvider{}
		w.svc.Provider = w.provider
		return nil
	})
	sc.Step(`^um provedor que falha com "([^"]*)"$`, func(msg string) error {
		w.provider = &meta.DryRunProvider{FailWith: msg}
		w.svc.Provider = w.provider
		return nil
	})

	/* -------------------------------------------------------------- templates */
	sc.Step(`^eu crio o template "([^"]*)" com categoria marketing e (\d+) variáveis$`, func(name string, n int) error {
		vars := make([]map[string]string, 0, n)
		body := "Oi, {{1}}!"
		for i := 1; i <= n; i++ {
			vars = append(vars, map[string]string{
				"index": fmt.Sprint(i), "label": "campo " + fmt.Sprint(i), "example": "exemplo" + fmt.Sprint(i),
			})
			if i > 1 {
				body += " {{" + fmt.Sprint(i) + "}}"
			}
		}
		w.post("/api/v1/templates", map[string]any{
			"name": name, "displayName": "Template " + name, "category": "marketing",
			"language": "pt_BR", "header": map[string]string{"kind": "none"},
			"body": body, "buttons": []any{}, "variables": vars,
		})
		if w.status == http.StatusCreated {
			var tpl domain.Template
			w.decode(&tpl)
			w.templateID = tpl.ID
		}
		return nil
	})

	sc.Step(`^eu crio o template "([^"]*)" com categoria marketing e 1 variável$`, func(name string) error {
		w.post("/api/v1/templates", templatePayload(name, "Oi, {{1}}!", true))
		return nil
	})

	sc.Step(`^eu crio um template chamado "([^"]*)" com uma variável sem exemplo$`, func(name string) error {
		w.post("/api/v1/templates", templatePayload(name, "Oi, {{1}}!", false))
		return nil
	})

	sc.Step(`^eu crio um template chamado "([^"]*)" cujo corpo usa \{\{2\}\} sem declarar$`, func(name string) error {
		w.post("/api/v1/templates", map[string]any{
			"name": name, "displayName": "Template " + name, "category": "marketing",
			"language": "pt_BR", "header": map[string]string{"kind": "none"},
			"body": "Oi, {{1}} e {{2}}!", "buttons": []any{},
			"variables": []map[string]string{{"index": "1", "label": "nome", "example": "Ana"}},
		})
		return nil
	})

	sc.Step(`^que existe um template chamado "([^"]*)"$`, func(name string) error {
		w.post("/api/v1/templates", templatePayload(name, "Oi, {{1}}!", true))
		if w.status != http.StatusCreated {
			return fmt.Errorf("template inicial: %d %s", w.status, w.body)
		}
		w.status, w.body = 0, nil
		return nil
	})

	sc.Step(`^eu crio outro template chamado "([^"]*)"$`, func(name string) error {
		w.post("/api/v1/templates", templatePayload(name, "Oi, {{1}}!", true))
		return nil
	})

	sc.Step(`^que existe um template aprovado$`, func() error {
		return w.createApprovedTemplate()
	})

	sc.Step(`^eu altero o corpo desse template$`, func() error {
		w.patch("/api/v1/templates/"+w.templateID, map[string]any{
			"name": "reativacao_cupom_volta", "displayName": "Editado", "category": "marketing",
			"language": "pt_BR", "header": map[string]string{"kind": "none"},
			"body": "Corpo novo, {{1}}, com outro texto.", "buttons": []any{},
			"variables": []map[string]string{{"index": "1", "label": "nome", "example": "Ana"}},
		})
		return nil
	})

	sc.Step(`^que existe um template pendente com id externo "([^"]*)"$`, func(external string) error {
		if err := w.createApprovedTemplate(); err != nil {
			return err
		}
		_, err := pool.Exec(context.Background(),
			`UPDATE templates SET external_id=$1, status='pending' WHERE id=$2`, external, w.templateID)
		return err
	})

	sc.Step(`^chega um webhook de template "([^"]*)" para "([^"]*)"$`, func(event, external string) error {
		return w.templateWebhook(event, external, "")
	})

	sc.Step(`^chega um webhook de template "([^"]*)" para "([^"]*)" com motivo "([^"]*)"$`, func(event, external, reason string) error {
		return w.templateWebhook(event, external, reason)
	})

	sc.Step(`^o template fica aprovado$`, func() error { return w.assertTemplateStatus("approved") })
	sc.Step(`^o template fica em rascunho$`, func() error { return w.assertTemplateStatus("draft") })
	sc.Step(`^o template fica rejeitado$`, func() error { return w.assertTemplateStatus("rejected") })

	sc.Step(`^o template tem um id externo do provedor$`, func() error {
		if !strings.HasPrefix(w.loadTemplate().MetaID, "dry_") {
			return fmt.Errorf("id externo = %q", w.loadTemplate().MetaID)
		}
		return nil
	})

	sc.Step(`^o template mantém o id externo anterior$`, func() error {
		if !strings.HasPrefix(w.loadTemplate().MetaID, "dry_") {
			return fmt.Errorf("id externo foi perdido na edição")
		}
		return nil
	})

	sc.Step(`^o motivo da rejeição menciona "([^"]*)"$`, func(want string) error {
		got := w.loadTemplate().RejectionReason
		if !strings.Contains(got, want) {
			return fmt.Errorf("motivo %q não menciona %q", got, want)
		}
		return nil
	})

	sc.Step(`^nenhum template novo é gravado$`, func() error {
		var n int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM templates`).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return fmt.Errorf("esperava 0 templates, achei %d", n)
		}
		return nil
	})

	/* -------------------------------------------------------------- audiências */
	sc.Step(`^eu crio o contato "([^"]*)" com telefone "([^"]*)" e opt-in$`, func(name, phone string) error {
		return w.createContact(name, phone, true, "São Paulo", nil)
	})
	sc.Step(`^eu crio o contato "([^"]*)" com telefone "([^"]*)" sem opt-in$`, func(name, phone string) error {
		return w.createContact(name, phone, false, "São Paulo", nil)
	})
	sc.Step(`^eu crio outro contato com telefone "([^"]*)"$`, func(phone string) error {
		return w.createContact("Outro Contato", phone, true, "São Paulo", nil)
	})
	sc.Step(`^que existe um contato com telefone "([^"]*)"$`, func(phone string) error {
		if err := w.createContact("Contato Base", phone, true, "São Paulo", nil); err != nil {
			return err
		}
		w.status, w.body = 0, nil
		return nil
	})
	sc.Step(`^o contato tem uma linha de consentimento ativa$`, func() error {
		var n int
		err := pool.QueryRow(context.Background(), `
			SELECT count(*) FROM contact_consents cc JOIN contacts c ON c.id=cc.contact_id
			WHERE c.phone=$1 AND cc.revoked_at IS NULL`, w.lastPhone).Scan(&n)
		if err != nil {
			return err
		}
		if n != 1 {
			return fmt.Errorf("esperava 1 consentimento ativo, achei %d", n)
		}
		return nil
	})
	sc.Step(`^o contato não pode receber marketing$`, func() error {
		var optIn bool
		if err := pool.QueryRow(context.Background(), `SELECT opt_in FROM contacts WHERE phone=$1`, w.lastPhone).Scan(&optIn); err != nil {
			return err
		}
		if optIn {
			return fmt.Errorf("contato sem opt-in ficou marcado como opt_in=true")
		}
		return nil
	})
	sc.Step(`^(\d+) contatos com opt-in e (\d+) sem opt-in na cidade "([^"]*)"$`, func(withOptIn, without int, city string) error {
		for i := 0; i < withOptIn; i++ {
			if err := w.createContact(fmt.Sprintf("Com Opt %d", i), fmt.Sprintf("55119%07d", i), true, city, nil); err != nil {
				return err
			}
		}
		for i := 0; i < without; i++ {
			if err := w.createContact(fmt.Sprintf("Sem Opt %d", i), fmt.Sprintf("55118%07d", i), false, city, nil); err != nil {
				return err
			}
		}
		w.status, w.body = 0, nil
		return nil
	})
	sc.Step(`^eu conto a audiência por cidade "([^"]*)" com opt-in$`, func(city string) error {
		w.segmentID = w.createSegment("Cidade "+city, city, "", true)
		return nil
	})
	sc.Step(`^um contato com opt-in e tag "([^"]*)"$`, func(tag string) error {
		if err := w.createContact("Tag VIP", "5511955554444", true, "São Paulo", []string{tag}); err != nil {
			return err
		}
		w.status, w.body = 0, nil
		return nil
	})
	sc.Step(`^eu conto a audiência por tag "([^"]*)" com opt-in$`, func(tag string) error {
		w.segmentID = w.createSegment("Tag "+tag, "", tag, true)
		return nil
	})
	sc.Step(`^o total é (\d+)$`, func(want int) error {
		segs, err := w.store.Segments(context.Background(), w.workspaceID)
		if err != nil {
			return err
		}
		for _, s := range segs {
			if s.ID != w.segmentID {
				continue
			}
			if s.ContactsCount != want {
				return fmt.Errorf("esperava %d contatos, achei %d", want, s.ContactsCount)
			}
			return nil
		}
		return fmt.Errorf("audiência %s não encontrada", w.segmentID)
	})
	sc.Step(`^uma audiência dinâmica por cidade "([^"]*)"$`, func(city string) error {
		for i := 0; i < 3; i++ {
			if err := w.createContact(fmt.Sprintf("Curitiba %d", i), fmt.Sprintf("55117%07d", i), true, city, nil); err != nil {
				return err
			}
		}
		w.segmentID = w.createSegment("Curitiba", city, "", true)
		w.status, w.body = 0, nil
		return nil
	})
	sc.Step(`^eu listo as audiências$`, func() error {
		w.get("/api/v1/segments")
		return nil
	})
	sc.Step(`^a audiência tem amostra não vazia$`, func() error {
		var segs []domain.Segment
		w.decode(&segs)
		for _, s := range segs {
			if s.ID == w.segmentID {
				if len(s.Sample) == 0 {
					return fmt.Errorf("amostra vazia")
				}
				return nil
			}
		}
		return fmt.Errorf("audiência %s não apareceu na listagem", w.segmentID)
	})

	/* --------------------------------------------------------------- campanha */
	sc.Step(`^um template aprovado com \d+ variável$`, func() error {
		return w.createApprovedTemplate()
	})
	sc.Step(`^uma audiência com (\d+) contatos? com opt-in e (\d+) sem opt-in$`, func(withOptIn, without int) error {
		return w.setupAudience(withOptIn, without)
	})
	sc.Step(`^uma audiência com (\d+) contatos? com opt-in$`, func(n int) error {
		return w.setupAudience(n, 0)
	})
	sc.Step(`^um template pendente de aprovação$`, func() error {
		if err := w.createApprovedTemplate(); err != nil {
			return err
		}
		_, err := pool.Exec(context.Background(), `UPDATE templates SET status='pending' WHERE id=$1`, w.templateID)
		return err
	})
	sc.Step(`^o workspace está sem telefone$`, func() error {
		_, err := pool.Exec(context.Background(), `UPDATE workspaces SET whatsapp_number=''`)
		return err
	})
	sc.Step(`^eu disparo a campanha$`, func() error {
		w.post("/api/v1/campaigns/"+w.campaignID+"/launch", nil)
		return nil
	})
	sc.Step(`^eu disparo a campanha de novo$`, func() error {
		w.post("/api/v1/campaigns/"+w.campaignID+"/launch", nil)
		return nil
	})
	sc.Step(`^a resposta diz que (\d+) envios entraram na fila$`, func(want int) error {
		var res httpapi.LaunchResults
		w.decode(&res)
		if res.Queued != want {
			return fmt.Errorf("esperava %d na fila, veio %d (%s)", want, res.Queued, w.body)
		}
		return nil
	})
	sc.Step(`^a resposta diz que (\d+) contato foi ignorado$`, func(want int) error {
		var res httpapi.LaunchResults
		w.decode(&res)
		if res.Skipped != want {
			return fmt.Errorf("esperava %d ignorado, veio %d (%s)", want, res.Skipped, w.body)
		}
		return nil
	})
	sc.Step(`^a segunda resposta diz que (\d+) envios entraram na fila$`, func(want int) error {
		var res httpapi.LaunchResults
		w.decode(&res)
		if res.Queued != want {
			return fmt.Errorf("esperava %d na fila no reenvio, veio %d (%s)", want, res.Queued, w.body)
		}
		return nil
	})
	sc.Step(`^o total de envios da campanha é (\d+)$`, func(want int) error {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM sends WHERE campaign_id=$1`, w.campaignID).Scan(&n); err != nil {
			return err
		}
		if n != want {
			return fmt.Errorf("esperava %d envios, achei %d", want, n)
		}
		return nil
	})
	sc.Step(`^a fila processa lotes até esvaziar$`, func() error {
		worker := &dispatch.Worker{Store: w.store, Provider: w.provider, Log: testLog, Interval: time.Second}
		// Ticks até não sair nada. O limite evita laço infinito se a fila travar
		// — um teste que pendura é pior do que um que falha.
		for i := 0; i < 20; i++ {
			n, err := worker.Tick(context.Background())
			if err != nil {
				return err
			}
			if n == 0 {
				return nil
			}
		}
		return fmt.Errorf("a fila não esvaziou em 20 ticks")
	})
	sc.Step(`^a campanha fica "([^"]*)"$`, func(want string) error {
		camp, err := w.store.Campaign(context.Background(), w.workspaceID, w.campaignID)
		if err != nil {
			return err
		}
		if camp.Status != want {
			return fmt.Errorf("status %q, esperava %q", camp.Status, want)
		}
		return nil
	})
	sc.Step(`^a fila processa um lote$`, func() error {
		worker := &dispatch.Worker{Store: w.store, Provider: w.provider, Log: testLog, Interval: time.Second}
		_, err := worker.Tick(context.Background())
		return err
	})
	sc.Step(`^existe um envio com id externo$`, func() error {
		rows, err := pool.Query(context.Background(),
			`SELECT external_id FROM sends WHERE status='sent' AND external_id<>'' ORDER BY created_at DESC LIMIT 1`)
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			return fmt.Errorf("nenhum envio com id externo")
		}
		return rows.Scan(&w.externalID)
	})
	sc.Step(`^chega um webhook de mensagem "([^"]*)" para esse id$`, func(status string) error {
		if w.externalID == "" {
			return fmt.Errorf("nenhum id externo capturado")
		}
		return w.messageWebhook(w.externalID, status, "")
	})
	sc.Step(`^chega um webhook de mensagem "([^"]*)" para esse envio$`, func(status string) error {
		return w.messageWebhook(w.externalID, status, "")
	})
	sc.Step(`^o envio fica "([^"]*)"$`, func(want string) error { return w.assertSendStatus(want) })
	sc.Step(`^o envio continua "([^"]*)"$`, func(want string) error { return w.assertSendStatus(want) })
	sc.Step(`^o erro do envio menciona "([^"]*)"$`, func(want string) error {
		var msg string
		if err := pool.QueryRow(context.Background(),
			`SELECT error FROM sends ORDER BY created_at DESC LIMIT 1`).Scan(&msg); err != nil {
			return err
		}
		if !strings.Contains(msg, want) {
			return fmt.Errorf("erro %q não menciona %q", msg, want)
		}
		return nil
	})
	sc.Step(`^o contato responde "([^"]*)" no WhatsApp$`, func(text string) error {
		return w.inbound(w.lastPhone, text)
	})
	sc.Step(`^o contato fica sem opt-in$`, func() error {
		var optIn bool
		if err := pool.QueryRow(context.Background(),
			`SELECT opt_in FROM contacts WHERE phone=$1`, w.lastPhone).Scan(&optIn); err != nil {
			return err
		}
		if optIn {
			return fmt.Errorf("opt-in não foi revogado")
		}
		return nil
	})
	sc.Step(`^o histórico guarda a revogação$`, func() error {
		var n int
		err := pool.QueryRow(context.Background(), `
			SELECT count(*) FROM contact_consents cc JOIN contacts c ON c.id=cc.contact_id
			WHERE c.phone=$1 AND cc.revoked_at IS NOT NULL`, w.lastPhone).Scan(&n)
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("consentimento não foi revogado no histórico")
		}
		return nil
	})

	/* ------------------------------------------------------------------ comum */
	sc.Step(`^a resposta é (\d+)$`, func(want int) error {
		if w.status != want {
			return fmt.Errorf("esperava %d, veio %d: %s", want, w.status, w.body)
		}
		return nil
	})
	sc.Step(`^o campo do erro é "([^"]*)"$`, func(want string) error {
		var body struct {
			Field string `json:"field"`
		}
		w.decode(&body)
		if body.Field != want {
			return fmt.Errorf("campo %q, esperava %q (%s)", body.Field, want, w.body)
		}
		return nil
	})
	sc.Step(`^a mensagem menciona "([^"]*)"$`, func(want string) error {
		if !strings.Contains(string(w.body), want) {
			return fmt.Errorf("resposta não menciona %q: %s", want, w.body)
		}
		return nil
	})
	sc.Step(`^existe atividade do tipo "([^"]*)"$`, func(kind string) error {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM activity WHERE kind=$1`, kind).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("nenhuma atividade do tipo %q", kind)
		}
		return nil
	})
	sc.Step(`^a verificação de assinatura está ligada$`, func() error {
		w.handlers.AppSecret = "segredo-de-teste"
		return nil
	})
	sc.Step(`^a campanha só pode enviar numa janela fechada agora$`, func() error {
		// Janela invertida de propósito (começa daqui a 1h e fecha daqui a 2h):
		// garante "fechada" mesmo quando o relógio da máquina está em qualquer
		// hora do dia, sem depender de fuso nem de dia da semana.
		now := time.Now().In(mustLocation("America/Sao_Paulo"))
		start := (now.Hour() + 1) % 24
		end := (now.Hour() + 2) % 24
		return w.patchCampaignSchedule(start, end)
	})
	sc.Step(`^a campanha pode enviar agora$`, func() error {
		start, end := openWindowNow()
		return w.patchCampaignSchedule(start, end)
	})
	sc.Step(`^eu leio o bootstrap$`, func() error {
		w.get("/api/v1/bootstrap")
		return nil
	})
	sc.Step(`^a fila diz que está bloqueada pela janela$`, func() error {
		info, err := w.queueInfo()
		if err != nil {
			return err
		}
		if info.BlockedBy != "window" {
			return fmt.Errorf("blockedBy = %q, esperava %q (%+v)", info.BlockedBy, "window", info)
		}
		return nil
	})
	sc.Step(`^a fila não está bloqueada$`, func() error {
		info, err := w.queueInfo()
		if err != nil {
			return err
		}
		if info.BlockedBy != "" {
			return fmt.Errorf("blockedBy = %q, esperava vazio (%+v)", info.BlockedBy, info)
		}
		return nil
	})
	sc.Step(`^a fila informa quando a janela abre$`, func() error {
		info, err := w.queueInfo()
		if err != nil {
			return err
		}
		if info.NextOpenAt.IsZero() {
			return fmt.Errorf("nextOpenAt veio zerado apesar da janela fechada")
		}
		return nil
	})
	sc.Step(`^a fila não informa horário de abertura$`, func() error {
		// Tem que ser no JSON cru: `time.Time` zero decodifica de
		// "0001-01-01T00:00:00Z" sem erro, então olhar a struct passaria mesmo
		// com a tela recebendo "abre 01/01/0001".
		var boot struct {
			Queue []map[string]any `json:"queue"`
		}
		if err := json.Unmarshal(w.body, &boot); err != nil {
			return err
		}
		for _, q := range boot.Queue {
			if q["campaignId"] != w.campaignID {
				continue
			}
			if raw, ok := q["nextOpenAt"]; ok {
				return fmt.Errorf("nextOpenAt = %v, esperava ausente", raw)
			}
			return nil
		}
		return fmt.Errorf("campanha %s não apareceu na fila: %s", w.campaignID, w.body)
	})
	sc.Step(`^chego no webhook sem assinatura$`, func() error {
		w.post("/webhooks/whatsapp", map[string]any{
			"object": "whatsapp_business_account",
			"entry":  []any{},
		})
		return nil
	})
}

/* --------------------------------------------------------------------- apoio */

func templatePayload(name, body string, withExample bool) map[string]any {
	example := ""
	if withExample {
		example = "Ana"
	}
	return map[string]any{
		"name": name, "displayName": "Template " + name, "category": "marketing",
		"language": "pt_BR", "header": map[string]string{"kind": "none"},
		"body": body, "buttons": []any{},
		"variables": []map[string]string{{"index": "1", "label": "nome", "example": example}},
	}
}

func (w *world) createApprovedTemplate() error {
	w.post("/api/v1/templates", map[string]any{
		"name": "reativacao_cupom_volta", "displayName": "Volta pro café", "category": "marketing",
		"language": "pt_BR", "header": map[string]string{"kind": "none"},
		"body": "Oi, {{1}}! Seu cupom é {{2}}.", "buttons": []any{},
		"variables": []map[string]string{
			{"index": "1", "label": "nome", "example": "Ana"},
			{"index": "2", "label": "cupom", "example": "VOLTA15"},
		},
	})
	if w.status != http.StatusCreated {
		return fmt.Errorf("template aprovado: %d %s", w.status, w.body)
	}
	var tpl domain.Template
	w.decode(&tpl)
	if tpl.Status != "approved" {
		return fmt.Errorf("dry-run deveria aprovar na hora; veio %q", tpl.Status)
	}
	w.templateID = tpl.ID
	return nil
}

func (w *world) loadTemplate() domain.Template {
	w.t.Helper()
	tpl, err := w.store.Template(context.Background(), w.workspaceID, w.templateID)
	if err != nil {
		w.t.Fatalf("carregar template: %v", err)
	}
	return tpl
}

func (w *world) assertTemplateStatus(want string) error {
	if got := w.loadTemplate().Status; got != want {
		return fmt.Errorf("status %q, esperava %q", got, want)
	}
	return nil
}

func (w *world) createContact(name, phone string, optIn bool, city string, tags []string) error {
	if tags == nil {
		tags = []string{}
	}
	w.post("/api/v1/contacts", map[string]any{
		"name": name, "phone": phone, "email": "contato@email.com", "city": city, "uf": "SP",
		"tags": tags, "source": "manual", "optIn": optIn, "optInSource": "manual",
	})
	if w.status != http.StatusCreated {
		// 4xx aqui pode ser o próprio cenário (telefone inválido/duplicado);
		// quem exige sucesso checa o status no step seguinte.
		if w.status >= 500 {
			return fmt.Errorf("criar contato %s: %d %s", name, w.status, w.body)
		}
		return nil
	}
	var c domain.Contact
	w.decode(&c)
	w.lastPhone = c.Phone
	return nil
}

func (w *world) createSegment(name, city, tag string, optIn bool) string {
	rules := []map[string]string{}
	if city != "" {
		rules = append(rules, map[string]string{"id": "r1", "field": "cidade", "operator": "eq", "value": city})
	}
	if tag != "" {
		rules = append(rules, map[string]string{"id": "r2", "field": "tag", "operator": "eq", "value": tag})
	}
	if optIn {
		rules = append(rules, map[string]string{"id": "r3", "field": "opt_in", "operator": "eq", "value": "sim"})
	}
	w.post("/api/v1/segments", map[string]any{
		"name": name, "description": "teste", "kind": "dynamic", "rules": rules, "source": "teste",
	})
	if w.status != http.StatusCreated {
		w.t.Fatalf("criar audiência: %d %s", w.status, w.body)
	}
	var seg domain.Segment
	w.decode(&seg)
	return seg.ID
}

func (w *world) setupAudience(withOptIn, without int) error {
	for i := 0; i < withOptIn; i++ {
		if err := w.createContact(fmt.Sprintf("Com Opt %d", i), fmt.Sprintf("55119%07d", i), true, "São Paulo", nil); err != nil {
			return err
		}
	}
	for i := 0; i < without; i++ {
		if err := w.createContact(fmt.Sprintf("Sem Opt %d", i), fmt.Sprintf("55118%07d", i), false, "São Paulo", nil); err != nil {
			return err
		}
	}
	// A audiência é definida por cidade, NÃO por opt-in: a regra de consentimento
	// é aplicada no disparo, e é isso que o cenário quer provar (1 ignorado).
	w.segmentID = w.createSegment("Audiência Teste", "São Paulo", "", false)
	// A janela tem que conter "agora": o worker respeita a janela, e um teste
	// que usa 9–18 passa de manhã e falha de madrugada. A janela em si é o que
	// os cenários de fila testam, com valores explícitos.
	start, end := openWindowNow()
	w.post("/api/v1/campaigns", map[string]any{
		"name": "Campanha de teste", "objective": "conversao", "status": "scheduled",
		"channel": "whatsapp", "templateId": w.templateID, "segmentIds": []string{w.segmentID},
		"schedule": map[string]any{
			"startAt": time.Now().UTC().Format(time.RFC3339), "windowStart": start, "windowEnd": end,
			"days": []int{0, 1, 2, 3, 4, 5, 6}, "throttlePerMinute": 600, "timezone": "America/Sao_Paulo",
		},
		"offer":            map[string]any{"enabled": true, "kind": "cupom", "codePattern": "TESTE-{nome}", "discountLabel": "10%", "validUntil": "2027-01-01T00:00:00Z"},
		"requiresApproval": false, "notes": "teste",
	})
	if w.status != http.StatusCreated {
		w.t.Fatalf("criar campanha: %d %s", w.status, w.body)
	}
	var c domain.Campaign
	w.decode(&c)
	w.campaignID = c.ID
	w.status, w.body = 0, nil
	return nil
}

// patchCampaignSchedule muda a janela da campanha do cenário por PATCH? Não
// existe rota de update de campanha; o caminho real é PUT /state, o mesmo que o
// frontend usa quando o operador ajusta a janela no drawer.
func (w *world) patchCampaignSchedule(start, end int) error {
	ctx := context.Background()
	camp, err := w.store.Campaign(ctx, w.workspaceID, w.campaignID)
	if err != nil {
		return err
	}
	ws, err := w.store.Workspace(ctx, w.workspaceID)
	if err != nil {
		return err
	}
	templates, err := w.store.Templates(ctx, w.workspaceID)
	if err != nil {
		return err
	}
	segments, err := w.store.Segments(ctx, w.workspaceID)
	if err != nil {
		return err
	}
	flows, err := w.store.Flows(ctx, w.workspaceID)
	if err != nil {
		return err
	}
	camp.Schedule.WindowStart = start
	camp.Schedule.WindowEnd = end
	camp.Schedule.Days = []int{0, 1, 2, 3, 4, 5, 6}
	camp.Schedule.ThrottlePerMinute = 600
	camp.Schedule.Timezone = "America/Sao_Paulo"

	w.do(http.MethodPut, "/api/v1/state", map[string]any{
		"workspace": ws, "templates": templates, "segments": segments,
		"campaigns": []domain.Campaign{camp}, "flows": flows,
	})
	if w.status != http.StatusOK {
		return fmt.Errorf("ajustar janela: %d %s", w.status, w.body)
	}
	w.status, w.body = 0, nil
	return nil
}

// openWindowNow devolve uma janela de uma hora que contém o instante atual, no
// fuso da campanha. Existe para os cenários que precisam da fila ANDANDO não
// dependerem da hora em que a suíte roda.
func openWindowNow() (start, end int) {
	now := time.Now().In(mustLocation("America/Sao_Paulo"))
	start = now.Hour()
	return start, (start + 1) % 24
}

// queueInfo lê a explicação da fila da campanha do cenário no último bootstrap.
func (w *world) queueInfo() (httpapi.QueueInfo, error) {
	var boot httpapi.Bootstrap
	w.decode(&boot)
	for _, q := range boot.Queue {
		if q.CampaignID == w.campaignID {
			return q, nil
		}
	}
	return httpapi.QueueInfo{}, fmt.Errorf("campanha %s não apareceu na fila: %s", w.campaignID, w.body)
}

func mustLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func (w *world) assertSendStatus(want string) error {
	var got string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM sends WHERE external_id=$1`, w.externalID).Scan(&got); err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("esperava status %q, achei %q", want, got)
	}
	return nil
}

func (w *world) templateWebhook(event, external, reason string) error {
	w.post("/webhooks/whatsapp", map[string]any{
		"object": "whatsapp_business_account",
		"entry": []any{map[string]any{
			"id": "wba",
			"changes": []any{map[string]any{
				"field": "message_template_status_update",
				"value": map[string]any{
					"event": event, "message_template_id": external, "reason": reason,
				},
			}},
		}},
	})
	return nil
}

func (w *world) messageWebhook(external, status, reason string) error {
	st := map[string]any{"id": external, "status": status, "recipient_id": "551190000001"}
	if reason != "" {
		st["errors"] = []any{map[string]any{"code": 131026, "title": reason}}
	}
	w.post("/webhooks/whatsapp", map[string]any{
		"object": "whatsapp_business_account",
		"entry": []any{map[string]any{
			"id": "wba",
			"changes": []any{map[string]any{
				"field": "messages",
				"value": map[string]any{"statuses": []any{st}},
			}},
		}},
	})
	if w.status != http.StatusOK {
		return fmt.Errorf("webhook: %d %s", w.status, w.body)
	}
	return nil
}

func (w *world) inbound(phone, text string) error {
	w.post("/webhooks/whatsapp", map[string]any{
		"object": "whatsapp_business_account",
		"entry": []any{map[string]any{
			"id": "wba",
			"changes": []any{map[string]any{
				"field": "messages",
				"value": map[string]any{
					"messages": []any{map[string]any{
						"id": "in-1", "from": phone, "text": map[string]string{"body": text},
					}},
				},
			}},
		}},
	})
	if w.status != http.StatusOK {
		return fmt.Errorf("inbound: %d %s", w.status, w.body)
	}
	return nil
}
