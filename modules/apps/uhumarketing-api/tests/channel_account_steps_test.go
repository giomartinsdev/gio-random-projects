package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/channel"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/secret"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

// Aqui o que está em julgamento é o ISOLAMENTO: a conta A não pode enviar pelo
// número da B, e conta sem canal não pode enviar de jeito nenhum. Por isso o
// teste usa o resolvedor de verdade (banco + cifra) e uma Graph de mentira via
// HTTP, não um Provider fake.

const testChannelToken = "EAAJ-token-de-teste-do-canal"

func registerAccountChannelSteps(sc *godog.ScenarioContext, w *world) {
	var graph *fakeGraph

	sc.Before(func(ctx context.Context, _ *godog.Scenario) (context.Context, error) {
		graph = nil
		return ctx, nil
	})

	// configure monta o resolver com o modo pedido e, quando existe Graph de
	// teste, aponta o HTTP do CloudProvider para ela.
	configure := func(mode string) error {
		box, err := secret.New("uma-chave-bem-comprida-para-teste")
		if err != nil {
			return err
		}
		resolver := &channel.Resolver{
			Store:   w.store,
			Box:     box,
			Mode:    mode,
			BaseURL: "https://graph.invalid",
			Version: "v21.0",
		}
		if graph != nil {
			resolver.BaseURL = graph.server.URL
			resolver.HTTP = graph.server.Client()
		}
		w.channels = resolver
		w.svc.Channels = resolver
		w.worker.Channels = resolver
		return nil
	}

	sc.Step(`^um serviço com canal por conta em (live|dry-run)$`, func(mode string) error {
		return configure(mode)
	})

	// O template é criado direto no store: em live sem canal, a rota de criação
	// devolve 422 — e o cenário quer testar o disparo, não a submissão.
	sc.Step(`^um template aprovado já existente$`, func() error {
		tpl, err := w.store.CreateTemplate(context.Background(), w.workspaceID, domain.TemplateInput{
			Name: "reativacao_cupom", DisplayName: "Volta pro café", Category: "marketing",
			Language: "pt_BR", Header: domain.TemplateHeader{Kind: "none"},
			Body: "Oi, {{1}}! Seu cupom é {{2}}.", Buttons: []domain.TemplateButton{},
			Variables: []domain.TemplateVariable{
				{Index: "1", Label: "nome", Example: "Ana"},
				{Index: "2", Label: "cupom", Example: "VOLTA15"},
			},
		}, "approved", "tpl_existente")
		if err != nil {
			return err
		}
		w.templateID = tpl.ID
		return nil
	})

	sc.Step(`^uma Graph de teste que aceita o canal$`, func() error {
		graph = newFakeGraph()
		w.t.Cleanup(graph.server.Close)
		return configure("live")
	})

	sc.Step(`^uma Graph de teste que recusa o token$`, func() error {
		graph = newFakeGraph()
		graph.denyToken = true
		w.t.Cleanup(graph.server.Close)
		return configure("live")
	})

	sc.Step(`^uma Graph de teste com a WABA banida$`, func() error {
		graph = newFakeGraph()
		graph.banned = true
		w.t.Cleanup(graph.server.Close)
		return configure("live")
	})

	sc.Step(`^eu ativo o canal com apenas o token$`, func() error {
		w.put("/api/v1/channel", map[string]any{"token": testChannelToken})
		return nil
	})

	sc.Step(`^eu ativo o canal (?:em )?(live|dry-run) com credenciais completas$`, func(mode string) error {
		w.put("/api/v1/channel", map[string]any{
			"mode":    mode,
			"wabaId":  "waba-da-conta",
			"phoneId": "phone-da-conta",
			"token":   testChannelToken,
		})
		return nil
	})

	sc.Step(`^eu desativo o canal$`, func() error {
		w.do(http.MethodDelete, "/api/v1/channel", nil)
		return nil
	})

	sc.Step(`^que outra conta ativou o canal dela$`, func() error {
		// Uma conta de verdade, com workspace próprio: reaproveitar o workspace
		// deste cenário provaria nada.
		otherWS := "ws_outra_conta"
		if _, err := pool.Exec(context.Background(),
			`INSERT INTO workspaces (id, name, plan, timezone, quality, messaging_limit)
			 VALUES ($1,'Outra Empresa','starter','America/Sao_Paulo','','')`, otherWS); err != nil {
			return err
		}
		// Ativa direto no store: o objetivo é provar que o canal da OUTRA conta
		// não aparece neste bootstrap, não repetir o fluxo HTTP.
		box, err := secret.New("uma-chave-bem-comprida-para-teste")
		if err != nil {
			return err
		}
		sealed, err := box.Seal(testChannelToken)
		if err != nil {
			return err
		}
		if err := w.store.SaveChannel(context.Background(), storeChannel(otherWS, "live", sealed)); err != nil {
			return err
		}
		return nil
	})

	sc.Step(`^o canal está ativo$`, func() error {
		info := w.providerInfo()
		if !info.Activated {
			return fmt.Errorf("canal não está ativo: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o canal não está ativo$`, func() error {
		info := w.providerInfo()
		if info.Activated {
			return fmt.Errorf("canal apareceu ativo sem ter sido ativado: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o canal está live$`, func() error {
		if !w.providerInfo().Live {
			return fmt.Errorf("canal não está live: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o canal não está live$`, func() error {
		if w.providerInfo().Live {
			return fmt.Errorf("canal dry-run se declarou live: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o bootstrap explica como ativar o WhatsApp$`, func() error {
		info := w.providerInfo()
		if !strings.Contains(strings.ToLower(info.Note), "ativ") {
			return fmt.Errorf("nota não explica a ativação: %q", info.Note)
		}
		return nil
	})

	sc.Step(`^o bootstrap diz que o canal é simulado$`, func() error {
		info := w.providerInfo()
		if !strings.Contains(strings.ToLower(info.Note), "simulad") {
			return fmt.Errorf("nota não diz que é simulado: %q", info.Note)
		}
		return nil
	})

	sc.Step(`^o bootstrap mostra o telefone "([^"]*)"$`, func(want string) error {
		info := w.providerInfo()
		if info.DisplayPhone != want {
			return fmt.Errorf("telefone %q, esperava %q (%s)", info.DisplayPhone, want, w.body)
		}
		return nil
	})

	sc.Step(`^a resposta não contém o token$`, func() error {
		if strings.Contains(string(w.body), testChannelToken) {
			return fmt.Errorf("o token do canal apareceu na resposta: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o token no banco não é o texto enviado$`, func() error {
		var cipher string
		if err := pool.QueryRow(context.Background(),
			`SELECT token_cipher FROM channels WHERE workspace_id=$1`, w.workspaceID).Scan(&cipher); err != nil {
			return err
		}
		if cipher == "" {
			return fmt.Errorf("canal ativo sem token gravado")
		}
		if cipher == testChannelToken || strings.Contains(cipher, testChannelToken) {
			return fmt.Errorf("token gravado em claro: %q", cipher)
		}
		return nil
	})
}

// providerInfo lê o canal da última resposta. Bootstrap e ativação devolvem
// formatos diferentes, então o helper cobre os dois.
func (w *world) providerInfo() httpapiProviderInfo {
	var full struct {
		Provider httpapiProviderInfo `json:"provider"`
	}
	if err := json.Unmarshal(w.body, &full); err == nil && full.Provider.Name != "" {
		return full.Provider
	}
	var direct httpapiProviderInfo
	_ = json.Unmarshal(w.body, &direct)
	return direct
}

// httpapiProviderInfo espelha o JSON de httpapi.ProviderInfo sem importar o
// pacote interno inteiro no teste — o que importa é o contrato da API.
type httpapiProviderInfo struct {
	Name         string `json:"name"`
	Mode         string `json:"mode"`
	Live         bool   `json:"live"`
	Activated    bool   `json:"activated"`
	DisplayPhone string `json:"displayPhone"`
	VerifiedName string `json:"verifiedName"`
	WebhookURL   string `json:"webhookUrl"`
	Note         string `json:"note"`
}

// storeChannel monta a linha do canal sem passar por HTTP, para o cenário de
// isolamento.
func storeChannel(ws, mode, sealed string) store.Channel {
	return store.Channel{
		WorkspaceID: ws, Mode: mode,
		WABAID: "waba-da-outra", PhoneID: "phone-da-outra",
		TokenCipher: sealed, DisplayPhone: "5511900000000",
		VerifiedName: "Outra Empresa",
	}
}
