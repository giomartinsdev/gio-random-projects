package tests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/dispatch"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// accountsWorld roda os cenários de conta num banco limpo. Reaproveita o
// Postgres do testcontainers de TestMain (a mesma infra real), mas monta o
// servidor sem seed: o que está sob teste é o cadastro criando workspace
// vazio, não o seed de demonstração.
type accountsWorld struct {
	status int
	body   []byte

	token            string
	workspaceID      string
	otherToken       string
	otherWorkspaceID string
	loginWorkspaceID string
	campaignID       string

	worker *dispatch.Worker
	server *httptest.Server
}

func (w *accountsWorld) newServer() error {
	ctx := context.Background()
	if err := store.Migrate(ctx, pool); err != nil {
		return err
	}
	// Ordem importa: sessões e usuários antes do workspace (FK), e o CASCADE
	// cuida do resto.
	if _, err := pool.Exec(ctx, `
		TRUNCATE sessions, users, contact_consents, sends, campaigns, flows,
		         segments, contacts, templates, activity, webhook_events, workspaces
		RESTART IDENTITY CASCADE`); err != nil {
		return err
	}

	st := store.New(pool)
	svc := &httpapi.Service{Store: st, Provider: &meta.DryRunProvider{}, Log: testLog}
	h := &httpapi.Handlers{
		Service:            svc,
		Log:                testLog,
		WebhookVerifyToken: "verify-token",
		AllowDevActions:    true,
	}
	w.worker = &dispatch.Worker{Store: st, Provider: svc.Provider, Log: testLog, Interval: time.Second}
	h.Tick = w.worker.Tick

	w.server = httptest.NewServer(httpapi.NewRouter(h, []string{"*"}, testLog))
	w.status, w.body = 0, nil
	w.token, w.workspaceID, w.otherToken, w.otherWorkspaceID = "", "", "", ""
	w.loginWorkspaceID, w.campaignID = "", ""
	return nil
}

func (w *accountsWorld) do(method, path string, body any, token string) {
	url := w.server.URL + path
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			panic(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()
	w.status = res.StatusCode
	w.body, _ = io.ReadAll(res.Body)
}

func (w *accountsWorld) post(path string, body any) { w.do(http.MethodPost, path, body, w.token) }
func (w *accountsWorld) get(path string)            { w.do(http.MethodGet, path, nil, w.token) }
func (w *accountsWorld) postAnon(path string, body any) {
	w.do(http.MethodPost, path, body, "")
}

func (w *accountsWorld) decode(v any) {
	if err := json.Unmarshal(w.body, v); err != nil {
		panic(fmt.Sprintf("decodificar %T: %v (%s)", v, err, w.body))
	}
}

// assertEmpty confere uma coleção do bootstrap da conta atual. Sempre relê: o
// status no world pode ser de um POST anterior (o cadastro), e reaproveitá-lo
// aqui faria a asserção passar sem consultar nada.
func (w *accountsWorld) assertEmpty(which string) error {
	w.get("/api/v1/bootstrap")
	if w.status != http.StatusOK {
		return fmt.Errorf("bootstrap: %d %s", w.status, w.body)
	}
	var boot struct {
		Templates []domain.Template `json:"templates"`
		Segments  []domain.Segment  `json:"segments"`
		Campaigns []domain.Campaign `json:"campaigns"`
		Sends     []domain.Send     `json:"sends"`
		Contacts  []domain.Contact  `json:"contacts"`
	}
	w.decode(&boot)
	count := map[string]int{
		"templates": len(boot.Templates),
		"segments":  len(boot.Segments),
		"campaigns": len(boot.Campaigns),
		"sends":     len(boot.Sends),
		"contacts":  len(boot.Contacts),
	}
	if n := count[which]; n != 0 {
		return fmt.Errorf("conta nova tem %d em %s", n, which)
	}
	return nil
}

func TestAccounts(t *testing.T) {
	if !dockerOK {
		t.Skip("docker indisponível")
	}
	w := &accountsWorld{}
	suite := godog.TestSuite{
		Name: "accounts",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
				return ctx, nil
			})
			registerAccountSteps(sc, w)
			sc.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
				if w.server != nil {
					w.server.Close()
				}
				return ctx, nil
			})
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"features/accounts.feature"},
			TestingT: t,
			Strict:   true,
		},
	}
	if suite.Run() != 0 {
		t.Fatal("feature falhou")
	}
}
