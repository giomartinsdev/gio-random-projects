package steps

// Harness compartilhado das suítes BDD da prospecta-api.
//
// Cada área (company, campaigns, leads, conversations, activity) tem seu
// próprio .feature e sua própria suíte godog, mas todas rodam contra o MESMO
// "par de domínio" FALSO em container (tests/fake-domain-pair/main.go) e usam
// o MESMO router de produção via httptest. As ajudas comuns (requisição,
// leitura de corpo, comandos registrados, seeds) moram aqui para que os steps
// de cada área só declarem o que é específico dela.
//
// Sem Docker, a suíte toda é pulada (t.Skipf): um teste que não pode rodar não
// deve passar em silêncio.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/auth"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/infrastructure"
)

// As chaves são obviamente falsas para que um vazamento num erro seja inerte.
const (
	callerKey = "test-caller-key"
	domainKey = "test-domain-key"
	// operatorTenant é o workspace fixo do modo operador (X-API-Key). Os
	// cenários de negócio usam este caminho; os de auth usam a sessão.
	operatorTenant = "00000000-0000-0000-0000-000000000001"
	// sessionSecret assina os cookies dos cenários de auth.
	sessionSecret = "test-session-secret"
)

type recordedCommand struct {
	Action  string          `json:"action"`
	Payload json.RawMessage `json:"payload"`
	ID      string          `json:"command_id"`
}

type state struct {
	pairURL  string
	pairHTTP *http.Client
	handler  http.Handler
	resp     *httptest.ResponseRecorder
	body     map[string]any
	feed     *feedState
	// cookie guarda o último Set-Cookie emitido (o valor bruto), para os
	// cenários de auth reenviarem a sessão sem depender de um jar.
	cookie *http.Cookie
	// sessionTenant é o tenant_id da última sessão emitida, decodificado do
	// cookie, para os cenários provarem que a rota de negócio foi scoped nele.
	sessionTenant string
}

// buildServices monta todos os serviços de slice sobre o mesmo par de domínio,
// que é publisher e reader de todos (e fonte do feed SSE).
func buildServices(reader *infrastructure.DomainClient) httpapi.Services {
	return httpapi.Services{
		Companies: application.NewCompanyService(reader, reader),
		Campaigns: application.NewCampaignService(reader, reader),
		Leads:     application.NewLeadService(reader, reader),
		Messaging: application.NewMessagingService(reader, reader, reader),
		Activity:  application.NewActivityService(reader),
	}
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// buildAPIHandler monta o router de produção no modo operador (X-API-Key), com
// o tenant fixo. É o cenário histórico das features de negócio.
func buildAPIHandler(apiKey string, services httpapi.Services) http.Handler {
	return httpapi.NewRouter(httpapi.Config{
		APIKey:   apiKey,
		TenantID: operatorTenant,
	}, services, testLogger())
}

// newState sobe a API (router de produção) apontando para o fake, no modo
// operador.
func (st *state) newAPI() {
	st.handler = buildAPIHandler(callerKey, buildServices(infrastructure.New(st.pairURL, domainKey, operatorTenant)))
}

// newAuthAPI sobe a API com sessão habilitada, para os cenários de /auth. O
// verificador do Google é o FAKE (nunca fala com o Google).
func (st *state) newAuthAPI() {
	st.newAuthAPIWithGoogle(&fakeGoogleVerifier{})
}

// newAuthAPIWithGoogle monta a API de auth injetando o verificador do Google.
// nil desabilita o SSO (a rota responde 503), que é o cenário "sem client ID".
func (st *state) newAuthAPIWithGoogle(verifier auth.GoogleVerifier) {
	sessions := auth.NewManager(sessionSecret, 0)
	pair := infrastructure.New(st.pairURL, domainKey, operatorTenant)
	authService := auth.NewService(pair, pair, pair, sessions, verifier, testLogger())
	st.handler = httpapi.NewRouter(httpapi.Config{
		APIKey:   callerKey,
		TenantID: operatorTenant,
		Auth:     authService,
	}, buildServices(pair), testLogger())
}

// newAPIWithoutSession sobe a API com o serviço de auth desabilitado (sem
// segredo): /auth tem de responder 503 sem derrubar as rotas de negócio.
func (st *state) newAPIWithoutSession() {
	pair := infrastructure.New(st.pairURL, domainKey, operatorTenant)
	authService := auth.NewService(pair, pair, pair, auth.NewManager("", 0), &fakeGoogleVerifier{}, testLogger())
	st.handler = httpapi.NewRouter(httpapi.Config{
		APIKey:   callerKey,
		TenantID: operatorTenant,
		Auth:     authService,
	}, buildServices(pair), testLogger())
}

// fakeGoogleVerifier é o GoogleVerifier dos testes: NUNCA fala com o Google.
// Ele decodifica credenciais sintéticas:
//
//	"fake:ok:<email>:<nome>"    -> identidade verificada
//	"fake:ok:<email>"           -> identidade verificada, sem nome
//	"fake:unverified:<email>"   -> ErrGoogleUnverified
//	qualquer outra              -> ErrGoogleInvalid
type fakeGoogleVerifier struct{}

func (fakeGoogleVerifier) Verify(credential string) (auth.GoogleIdentity, error) {
	const ok, unverified = "fake:ok:", "fake:unverified:"
	switch {
	case strings.HasPrefix(credential, ok):
		rest := strings.TrimPrefix(credential, ok)
		email, name, _ := strings.Cut(rest, ":")
		if email == "" {
			return auth.GoogleIdentity{}, auth.ErrGoogleNoEmail
		}
		return auth.GoogleIdentity{Email: strings.ToLower(email), Name: name}, nil
	case strings.HasPrefix(credential, unverified):
		return auth.GoogleIdentity{}, auth.ErrGoogleUnverified
	default:
		return auth.GoogleIdentity{}, auth.ErrGoogleInvalid
	}
}

// --- passos comuns a todas as áreas ----------------------------------------

// registerCommonSteps declara os passos que qualquer feature pode usar: subir a
// API, disparar POST/GET, conferir status e comandos publicados.
func registerCommonSteps(sc *godog.ScenarioContext, st *state, ctx context.Context) {
	sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
		if err := clearState(ctx, st); err != nil {
			return ctx, err
		}
		st.resp = nil
		st.body = nil
		st.cookie = nil
		st.sessionTenant = ""
		return ctx, nil
	})

	sc.Step(`^que eu tenho uma API com X-API-Key configurada$`, func() error {
		st.newAPI()
		return nil
	})

	sc.Step(`^eu faço POST "([^"]*)" com:$`, func(path string, doc *godog.DocString) error {
		return st.post(ctx, path, doc.Content, true)
	})

	sc.Step(`^eu faço POST "([^"]*)" sem o cabeçalho X-API-Key com:$`, func(path string, doc *godog.DocString) error {
		return st.post(ctx, path, doc.Content, false)
	})

	sc.Step(`^eu faço POST "([^"]*)" sem corpo$`, func(path string) error {
		return st.post(ctx, path, "", true)
	})

	sc.Step(`^eu faço GET "([^"]*)"$`, func(path string) error {
		return st.get(ctx, path, true)
	})

	sc.Step(`^eu faço GET "([^"]*)" sem o cabeçalho X-API-Key$`, func(path string) error {
		return st.get(ctx, path, false)
	})

	sc.Step(`^a resposta tem status HTTP (\d+)$`, func(code int) error {
		if st.resp.Code != code {
			return fmt.Errorf("status = %d; want %d (corpo: %s)", st.resp.Code, code, st.resp.Body.String())
		}
		return nil
	})

	sc.Step(`^a resposta traz um "([^"]*)" não vazio$`, func(field string) error {
		v, _ := st.body[field].(string)
		if strings.TrimSpace(v) == "" {
			return fmt.Errorf("campo %q vazio no corpo: %v", field, st.body)
		}
		return nil
	})

	sc.Step(`^a resposta traz "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		got, _ := st.body[field].(string)
		if got != want {
			return fmt.Errorf("campo %q = %q; want %q", field, got, want)
		}
		return nil
	})

	sc.Step(`^o corpo traz "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		got, _ := st.body[field].(string)
		if got != want {
			return fmt.Errorf("campo %q = %q; want %q", field, got, want)
		}
		return nil
	})

	sc.Step(`^o corpo traz a lista "([^"]*)" com (\d+) itens$`, func(field string, want int) error {
		list, ok := st.body[field].([]any)
		if !ok {
			return fmt.Errorf("campo %q não é lista: %v", field, st.body)
		}
		if len(list) != want {
			return fmt.Errorf("lista %q tem %d itens; want %d", field, len(list), want)
		}
		return nil
	})

	sc.Step(`^o item (\d+) do corpo tem "([^"]*)" igual a "([^"]*)"$`, func(n int, field, want string) error {
		item, err := st.item("items", n)
		if err != nil {
			return err
		}
		got, _ := item[field].(string)
		if got != want {
			return fmt.Errorf("item[%d].%s = %q; want %q", n-1, field, got, want)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" foi publicado no par de domínio$`, func(action string) error {
		cmd, err := findCommand(ctx, st, action)
		if err != nil {
			return err
		}
		if cmd == nil {
			return fmt.Errorf("comando %q não foi publicado", action)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" NÃO foi publicado no par de domínio$`, func(action string) error {
		cmd, err := findCommand(ctx, st, action)
		if err != nil {
			return err
		}
		if cmd != nil {
			return fmt.Errorf("comando %q foi publicado, mas não deveria", action)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" igual a "([^"]*)"$`, func(action, field, want string) error {
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		got, _ := payload[field].(string)
		if got != want {
			return fmt.Errorf("%s.%s = %q; want %q", action, field, got, want)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" igual a (\d+)$`, func(action, field string, want int) error {
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		got, ok := payload[field].(float64)
		if !ok || int(got) != want {
			return fmt.Errorf("%s.%s = %v; want %d", action, field, payload[field], want)
		}
		return nil
	})
}

// --- helpers de requisição -------------------------------------------------

func (st *state) post(ctx context.Context, path, body string, withKey bool) error {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	if withKey {
		req.Header.Set("X-API-Key", callerKey)
	}
	st.serve(req)
	return nil
}

func (st *state) get(ctx context.Context, path string, withKey bool) error {
	req := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
	if withKey {
		req.Header.Set("X-API-Key", callerKey)
	}
	st.serve(req)
	return nil
}

func (st *state) serve(req *http.Request) {
	st.resp = httptest.NewRecorder()
	st.handler.ServeHTTP(st.resp, req)
	st.body = map[string]any{}
	_ = json.Unmarshal(st.resp.Body.Bytes(), &st.body)
	// Guarda o cookie de sessão emitido (se houver) para os cenários de auth
	// reenviarem; um 401/409 sem Set-Cookie deve zerá-lo, não herdar o antigo.
	st.cookie = nil
	for _, c := range st.resp.Result().Cookies() {
		if c.Name == auth.SessionCookieName {
			st.cookie = c
		}
	}
}

// item devolve o n-ésimo item (1-based) da lista `field` do corpo.
func (st *state) item(field string, n int) (map[string]any, error) {
	list, ok := st.body[field].([]any)
	if !ok {
		return nil, fmt.Errorf("campo %q não é lista: %v", field, st.body)
	}
	if n < 1 || n > len(list) {
		return nil, fmt.Errorf("item %d fora da lista %q (len=%d)", n, field, len(list))
	}
	item, ok := list[n-1].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("item %d de %q não é objeto", n, field)
	}
	return item, nil
}

// --- helpers do par de domínio falso ---------------------------------------

func (st *state) control(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, st.pairURL+path, body)
	if err != nil {
		return nil, err
	}
	return st.pairHTTP.Do(req)
}

func clearCommands(ctx context.Context, st *state) error {
	resp, err := st.control(ctx, http.MethodDelete, "/__commands", nil)
	if err != nil {
		return err
	}
	return resp.Body.Close()
}

// clearState zera comandos, projeções e usuários no fake. É o reset entre
// cenários: um usuário criado num cenário não pode vazar para o próximo (nem
// um CreateCompany, que aqui é persistido para as leituras).
func clearState(ctx context.Context, st *state) error {
	resp, err := st.control(ctx, http.MethodDelete, "/__state", nil)
	if err != nil {
		return err
	}
	return resp.Body.Close()
}

// seedRecord insere uma projeção crua no fake (collection é "company",
// "campaign", "lead", "conversation" ou "message").
func seedRecord(ctx context.Context, st *state, collection, raw string) error {
	resp, err := st.control(ctx, http.MethodPost, "/__seed/"+collection, strings.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("seed %s retornou %d", collection, resp.StatusCode)
	}
	return nil
}

func findCommand(ctx context.Context, st *state, action string) (*recordedCommand, error) {
	resp, err := st.control(ctx, http.MethodGet, "/__commands", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var cmds []recordedCommand
	if err := json.NewDecoder(resp.Body).Decode(&cmds); err != nil {
		return nil, err
	}
	for i := range cmds {
		if cmds[i].Action == action {
			return &cmds[i], nil
		}
	}
	return nil, nil
}

func commandPayload(ctx context.Context, st *state, action string) (map[string]any, error) {
	cmd, err := findCommand(ctx, st, action)
	if err != nil {
		return nil, err
	}
	if cmd == nil {
		return nil, fmt.Errorf("comando %q não foi publicado", action)
	}
	var payload map[string]any
	if err := json.Unmarshal(cmd.Payload, &payload); err != nil {
		return nil, fmt.Errorf("payload de %q ilegível: %w", action, err)
	}
	return payload, nil
}
