package steps

// Testes do feed SSE (tests/features/activity.feature). Diferente das outras
// áreas, aqui a resposta é um stream aberto: httptest.NewRecorder não serve
// (bufferiza), então a API sobe num httptest.NewServer de verdade e o cliente lê
// o corpo linha a linha, como um browser faria.
//
// O que se prova:
//   - GET /agent/activity responde text/event-stream e entrega os eventos de
//     agent_run no formato `event: agent` + `data: {...}`;
//   - clientes que desconectam encerram o stream: o par de domínio vê a conexão
//     cair E o número de goroutines volta ao patamar inicial (sem vazamento).

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/infrastructure"
)

func TestActivityBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stopPair := startFakeDomainPair(t, ctx)
	defer stopPair()

	st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
	st.newAPI()

	server := httptest.NewServer(st.handler)
	defer server.Close()

	feature := "../features/activity.feature"
	sc := func(s *godog.ScenarioContext) {
		registerCommonSteps(s, st, ctx)
		s.After(func(ctx context.Context, _ *godog.Scenario, _ error) (context.Context, error) {
			// Fecha qualquer stream deixado aberto pelo cenário, senão o
			// httptest.Server.Close() esperaria a handler indefinidamente.
			closeFeed(st)
			st.feed = nil
			return ctx, nil
		})
		s.Step(`^eu abro o feed "([^"]*)" sem o cabeçalho X-API-Key$`, func(_ string) error {
			return openFeedNoKey(server, st)
		})
		s.Step(`^eu abro o feed "([^"]*)" e publico um run "([^"]*)" e depois "([^"]*)"$`,
			func(_ string, running, done string) error {
				return openFeedAndPublish(ctx, server, st, running, done)
			})
		s.Step(`^o feed responde "([^"]*)"$`, func(want string) error {
			return expectContentType(st, want)
		})
		s.Step(`^o feed entrega o primeiro evento com "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
			return expectEventField(st, 1, field, want)
		})
		s.Step(`^o feed entrega o segundo evento com "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
			return expectEventField(st, 2, field, want)
		})
		s.Step(`^eu abro o feed "([^"]*)" e depois desconecto$`, func(_ string) error {
			return openFeedThenDisconnect(ctx, server, st)
		})
		s.Step(`^o par de domínio vê a conexão encerrar$`, func() error {
			return expectPairSeesClose(st)
		})
		s.Step(`^nenhuma goroutine do feed fica pendurada$`, func() error {
			return expectNoLeak(st, server)
		})
	}

	suite := godog.TestSuite{
		Name:                "prospecta-activity",
		ScenarioInitializer: sc,
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{feature},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de atividade falharam")
	}
}

// state do feed entre cenários.
type feedState struct {
	contentType string
	resp        *http.Response
	cancel      context.CancelFunc
	events      []map[string]any

	// goroutinesBefore é o patamar do runtime imediatamente antes de abrir o
	// stream; comparar o depois com ele isola esta suíte das conexões keep-alive
	// de outros cenários/containers, tornando o teste de vazamento confiável.
	goroutinesBefore int
}

func openFeedNoKey(server *httptest.Server, st *state) error {
	resp, err := http.Get(server.URL + "/agent/activity")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	st.resp = &httptest.ResponseRecorder{Code: resp.StatusCode}
	return nil
}

func openFeedAndPublish(ctx context.Context, server *httptest.Server, st *state, running, done string) error {
	streamCtx, cancel := context.WithCancel(ctx)
	req, _ := http.NewRequestWithContext(streamCtx, http.MethodGet, server.URL+"/agent/activity", nil)
	req.Header.Set("X-API-Key", callerKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		return err
	}
	fs := feedState{contentType: resp.Header.Get("Content-Type"), resp: resp, cancel: cancel}
	st.feed = &fs

	waitForConnectionsErr(st, 1)
	if err := seedActivity(ctx, st, fmt.Sprintf(`{"run_id":"run-1","agent":"prospector","state":%q,"metric":{"found":12}}`, running)); err != nil {
		return err
	}
	if err := seedActivity(ctx, st, fmt.Sprintf(`{"run_id":"run-1","agent":"prospector","state":%q,"metric":{"found":12,"kept":3}}`, done)); err != nil {
		return err
	}

	reader := bufio.NewReader(resp.Body)
	first, err := readEventErr(reader)
	if err != nil {
		return err
	}
	second, err := readEventErr(reader)
	if err != nil {
		return err
	}
	st.feed.events = []map[string]any{first, second}
	return nil
}

// closeFeed encerra o stream (cancela a request e fecha o corpo). Sem isso o
// httptest.Server.Close esperaria a handler para sempre.
func closeFeed(st *state) {
	if st.feed == nil {
		return
	}
	if st.feed.cancel != nil {
		st.feed.cancel()
	}
	if st.feed.resp != nil && st.feed.resp.Body != nil {
		_ = st.feed.resp.Body.Close()
	}
}

func expectContentType(st *state, want string) error {
	if !strings.HasPrefix(st.feed.contentType, want) {
		return fmt.Errorf("Content-Type = %q; want %q", st.feed.contentType, want)
	}
	return nil
}

func expectEventField(st *state, n int, field, want string) error {
	if st.feed == nil || n > len(st.feed.events) {
		return fmt.Errorf("evento %d não capturado", n)
	}
	got, _ := st.feed.events[n-1][field].(string)
	if got != want {
		return fmt.Errorf("evento %d: %s = %q; want %q", n, field, got, want)
	}
	return nil
}

func openFeedThenDisconnect(ctx context.Context, server *httptest.Server, st *state) error {
	settle()
	st.feed = &feedState{goroutinesBefore: runtime.NumGoroutine()}
	streamCtx, cancel := context.WithCancel(ctx)
	req, _ := http.NewRequestWithContext(streamCtx, http.MethodGet, server.URL+"/agent/activity", nil)
	req.Header.Set("X-API-Key", callerKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		return err
	}
	st.feed.resp = resp
	st.feed.cancel = cancel
	if err := waitForConnectionsErr(st, 1); err != nil {
		return err
	}
	cancel()
	_ = resp.Body.Close()
	return nil
}

func expectPairSeesClose(st *state) error {
	return waitForConnectionsErr(st, 0)
}

// expectNoLeak prova que o stream desconectado não deixou goroutine pendurada:
// o runtime precisa voltar ao patamar de antes de abrir o stream (com folga de
// +2 para a goroutine do cliente HTTP e jitter). Medir do "antes" do cenário,
// e não de um baseline global, evita falhar por causa das conexões keep-alive
// que outros cenários mantêm abertas.
func expectNoLeak(st *state, _ *httptest.Server) error {
	before := 0
	if st.feed != nil {
		before = st.feed.goroutinesBefore
	}
	deadline := time.Now().Add(3 * time.Second)
	var got int
	for time.Now().Before(deadline) {
		settle()
		got = runtime.NumGoroutine()
		if got <= before+2 {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	return fmt.Errorf("goroutines = %d; antes do stream = %d (vazamento?)", got, before)
}

func waitForConnectionsErr(st *state, want int) error {
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		n, err := activityConnections(st)
		if err != nil {
			return err
		}
		if n == want {
			return nil
		}
		time.Sleep(20 * time.Millisecond)
	}
	n, _ := activityConnections(st)
	return fmt.Errorf("conexões do feed = %d; want %d", n, want)
}

func seedActivity(ctx context.Context, st *state, raw string) error {
	resp, err := st.control(ctx, http.MethodPost, "/__seed/activity", strings.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("seed activity retornou %d", resp.StatusCode)
	}
	return nil
}

// readEventErr lê um bloco SSE (`event:` + `data:`) e devolve o JSON do data.
func readEventErr(r *bufio.Reader) (map[string]any, error) {
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		line, err := r.ReadString('\n')
		if err != nil {
			return nil, fmt.Errorf("ler stream: %w", err)
		}
		line = strings.TrimRight(line, "\n")
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
	return nil, fmt.Errorf("nenhum evento recebido")
}

func activityConnections(st *state) (int, error) {
	resp, err := st.control(context.Background(), http.MethodGet, "/__activity/connections", nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var body struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return 0, err
	}
	return body.Count, nil
}

func settle() {
	runtime.GC()
	time.Sleep(50 * time.Millisecond)
}

var _ = infrastructure.New
