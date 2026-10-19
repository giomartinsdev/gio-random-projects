package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
)

// O provedor `live` é testado contra uma Graph de mentira via HTTP — não contra
// um `Provider` fake. O que pode dar errado aqui é a URL, o cabeçalho do token
// e a leitura do envelope de erro da Meta; um fake de interface esconderia
// exatamente isso.

// fakeGraph é uma Graph API mínima: responde número, status de template e
// recusa token quando pedido.
type fakeGraph struct {
	server       *httptest.Server
	denyToken    bool
	banned       bool
	templateStat string
	seenToken    string
	seenPath     string
}

func newFakeGraph() *fakeGraph {
	g := &fakeGraph{templateStat: "APPROVED"}
	g.server = httptest.NewServer(http.HandlerFunc(g.handle))
	return g
}

func (g *fakeGraph) handle(w http.ResponseWriter, r *http.Request) {
	g.seenToken = r.Header.Get("Authorization")
	g.seenPath = r.URL.Path + "?" + r.URL.RawQuery

	if g.denyToken {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid OAuth access token - Cannot parse access token","type":"OAuthException","code":190,"error_subcode":0}}`))
		return
	}

	if g.banned {
		// Forma real do bloqueio: a Graph responde 400 com 131031 e a mensagem
		// de enforcement. O produto tem que traduzir isso, não vazar o código.
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"Your account is restricted from using WhatsApp Business API due to a policy enforcement action","type":"OAuthException","code":131031,"error_subcode":0}}`))
		return
	}

	switch {
	case strings.HasSuffix(r.URL.Path, "/messages"):
		_, _ = w.Write([]byte(`{"messages":[{"id":"wamid.host.1"}]}`))
	case strings.HasSuffix(r.URL.Path, "/message_templates"):
		_, _ = w.Write([]byte(`{"id":"tpl_externo_1","status":"PENDING"}`))
	case strings.Contains(r.URL.RawQuery, "display_phone_number"):
		_, _ = w.Write([]byte(`{"display_phone_number":"5511912345678","verified_name":"Café Aurora","quality_rating":"GREEN"}`))
	case strings.Contains(r.URL.RawQuery, "status"):
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status":%q,"rejected_reason":"NONE"}`, g.templateStat)))
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"message":"rota de teste desconhecida","code":100}}`))
	}
}

// registerChannelSteps liga os passos do cenário de canal. Fica num arquivo
// separado do steps_test.go porque é um mundo diferente: aqui o provedor é o
// CloudProvider real falando HTTP.
func registerChannelSteps(sc *godog.ScenarioContext, w *world) {
	var graph *fakeGraph

	sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
		graph = nil
		return ctx, nil
	})

	liveProvider := func(deny bool) error {
		graph = newFakeGraph()
		graph.denyToken = deny
		w.provider = &meta.CloudProvider{
			BaseURL:       graph.server.URL,
			APIVersion:    "v21.0",
			WABAID:        "waba-teste",
			PhoneNumberID: "phone-teste",
			Token:         "token-de-teste",
			HTTP:          graph.server.Client(),
		}
		w.svc.Provider = w.provider
		w.t.Cleanup(graph.server.Close)
		return nil
	}

	sc.Step(`^um canal live apontando para uma Graph de teste$`, func() error {
		return liveProvider(false)
	})

	sc.Step(`^um canal live apontando para uma Graph de teste que recusa o token$`, func() error {
		return liveProvider(true)
	})

	sc.Step(`^um canal live apontando para uma Graph de teste com a WABA banida$`, func() error {
		if err := liveProvider(false); err != nil {
			return err
		}
		graph.banned = true
		return nil
	})

	sc.Step(`^um canal live apontando para uma Graph de teste com o template "([^"]*)"$`, func(status string) error {
		if err := liveProvider(false); err != nil {
			return err
		}
		graph.templateStat = strings.ToUpper(status)
		return nil
	})

	sc.Step(`^o workspace está com o telefone configurado$`, func() error {
		// O reset() já configura; o passo existe para o cenário ler bem.
		return nil
	})

	sc.Step(`^eu verifico o canal$`, func() error {
		w.get("/api/v1/channel")
		return nil
	})

	sc.Step(`^a verificação diz que é live$`, func() error {
		var info meta.ChannelInfo
		w.decode(&info)
		if !info.Live {
			return fmt.Errorf("esperava live=true: %s", w.body)
		}
		return nil
	})

	sc.Step(`^a verificação diz que não é live$`, func() error {
		var info meta.ChannelInfo
		w.decode(&info)
		if info.Live {
			return fmt.Errorf("dry-run se declarou live: %s", w.body)
		}
		return nil
	})

	sc.Step(`^a verificação diz que o canal não está ok$`, func() error {
		var info meta.ChannelInfo
		w.decode(&info)
		if info.OK {
			return fmt.Errorf("canal com token recusado foi reportado ok: %s", w.body)
		}
		return nil
	})

	sc.Step(`^a verificação mostra o número "([^"]*)"$`, func(want string) error {
		var info meta.ChannelInfo
		w.decode(&info)
		if info.Number != want {
			return fmt.Errorf("número %q, esperava %q (%s)", info.Number, want, w.body)
		}
		return nil
	})

	sc.Step(`^a verificação mostra o nome verificado "([^"]*)"$`, func(want string) error {
		var info meta.ChannelInfo
		w.decode(&info)
		if info.VerifiedName != want {
			return fmt.Errorf("nome verificado %q, esperava %q (%s)", info.VerifiedName, want, w.body)
		}
		return nil
	})

	sc.Step(`^a verificação menciona "([^"]*)"$`, func(want string) error {
		var info meta.ChannelInfo
		w.decode(&info)
		if !strings.Contains(info.Note, want) {
			return fmt.Errorf("nota %q não menciona %q", info.Note, want)
		}
		return nil
	})

	sc.Step(`^eu envio um teste da campanha$`, func() error {
		w.post("/api/v1/campaigns/"+w.campaignID+"/test", nil)
		return nil
	})

	sc.Step(`^eu envio um teste da campanha de novo$`, func() error {
		w.post("/api/v1/campaigns/"+w.campaignID+"/test", nil)
		return nil
	})

	sc.Step(`^nenhum envio tem id externo$`, func() error {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM sends WHERE workspace_id=$1 AND external_id<>''`, w.workspaceID).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return fmt.Errorf("%d envio(s) saíram, mas a janela estava fechada", n)
		}
		return nil
	})

	sc.Step(`^o envio de teste é para o último contato cadastrado$`, func() error {
		var dest string
		if err := pool.QueryRow(context.Background(),
			`SELECT destination FROM sends WHERE workspace_id=$1 AND is_test AND status='queued'`,
			w.workspaceID).Scan(&dest); err != nil {
			return err
		}
		if dest != w.lastPhone {
			return fmt.Errorf("teste foi para %q, mas o último contato cadastrado é %q", dest, w.lastPhone)
		}
		return nil
	})

	sc.Step(`^eu sincronizo o status do template$`, func() error {
		w.post("/api/v1/templates/"+w.templateID+"/sync", nil)
		return nil
	})

	sc.Step(`^um template pendente com id externo "([^"]*)"$`, func(external string) error {
		// Criado direto no store: com o provedor `live` no ar, passar pela rota
		// de criação falaria com a Graph de teste e voltaria "pending" por
		// outro motivo — o cenário é sobre a CONSULTA, não sobre a submissão.
		tpl, err := w.store.CreateTemplate(context.Background(), w.workspaceID, domain.TemplateInput{
			Name: "template_pendente", DisplayName: "Template pendente", Category: "marketing",
			Language: "pt_BR", Header: domain.TemplateHeader{Kind: "none"},
			Body: "Oi, {{1}}!", Buttons: []domain.TemplateButton{},
			Variables: []domain.TemplateVariable{{Index: "1", Label: "nome", Example: "Ana"}},
		}, "draft", "")
		if err != nil {
			return err
		}
		if err := w.store.MarkTemplateSubmitted(context.Background(), w.workspaceID, tpl.ID, external, "pending"); err != nil {
			return err
		}
		w.templateID = tpl.ID
		return nil
	})

	sc.Step(`^o template fica "([^"]*)"$`, func(want string) error {
		return w.assertTemplateStatus(want)
	})

	// A verificação do cabeçalho prova que o token sai como Bearer — o erro
	// mais comum ao integrar a Graph é mandar o token no corpo.
	sc.Step(`^o provedor recebeu o token no cabeçalho$`, func() error {
		if graph == nil {
			return fmt.Errorf("nenhuma chamada ao provedor")
		}
		if graph.seenToken != "Bearer token-de-teste" {
			return fmt.Errorf("cabeçalho Authorization = %q", graph.seenToken)
		}
		return nil
	})

	_ = json.Marshal
}
