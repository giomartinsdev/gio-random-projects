package tests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/cucumber/godog"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/domain"
)

// Os cenários de conta falam só HTTP: quem prova o isolamento é o servidor,
// não uma chamada direta ao store. Um teste que "pula" o middleware provaria
// que o SQL filtra, mas não que a rota exige sessão.
//
// O harness monta um servidor sem dados semeados (accountsWorld) para que
// "conta nova tem zero templates" seja uma afirmação sobre o cadastro, não
// sobre o seed.

func registerAccountSteps(sc *godog.ScenarioContext, w *accountsWorld) {
	sc.Step(`^um servidor de teste sem dados semeados$`, func() error {
		return w.newServer()
	})

	/* ------------------------------------------------------------- cadastro */

	sc.Step(`^eu me cadastro com "([^"]*)" e senha "([^"]*)"$`, func(email, password string) error {
		w.postAnon("/api/v1/auth/signup", map[string]any{
			"name": "Marina Reis", "email": email, "password": password, "company": "Café Aurora",
		})
		if w.status == http.StatusCreated {
			var acc struct {
				Token       string `json:"token"`
				WorkspaceID string `json:"workspaceId"`
			}
			w.decode(&acc)
			w.token, w.workspaceID = acc.Token, acc.WorkspaceID
		}
		return nil
	})

	sc.Step(`^uma conta com o e-mail "([^"]*)"$`, func(email string) error {
		w.postAnon("/api/v1/auth/signup", map[string]any{
			"name": "Marina Reis", "email": email, "password": "cafe1234", "company": "Café Aurora",
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("criar conta %s: %d %s", email, w.status, w.body)
		}
		var acc struct {
			Token       string `json:"token"`
			WorkspaceID string `json:"workspaceId"`
		}
		w.decode(&acc)
		w.token, w.workspaceID = acc.Token, acc.WorkspaceID
		w.status, w.body = 0, nil
		return nil
	})

	sc.Step(`^outra conta com o e-mail "([^"]*)"$`, func(email string) error {
		w.postAnon("/api/v1/auth/signup", map[string]any{
			"name": "João Souza", "email": email, "password": "cafe1234", "company": "Outra Café",
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("criar segunda conta %s: %d %s", email, w.status, w.body)
		}
		var acc struct {
			Token       string `json:"token"`
			WorkspaceID string `json:"workspaceId"`
		}
		w.decode(&acc)
		w.otherToken, w.otherWorkspaceID = acc.Token, acc.WorkspaceID
		w.status, w.body = 0, nil
		return nil
	})

	/* ---------------------------------------------------------------- login */

	sc.Step(`^eu faço login com "([^"]*)" e a senha certa$`, func(email string) error {
		w.postAnon("/api/v1/auth/login", map[string]any{"email": email, "password": "cafe1234"})
		if w.status == http.StatusOK {
			var acc struct {
				Token       string `json:"token"`
				WorkspaceID string `json:"workspaceId"`
			}
			w.decode(&acc)
			w.loginWorkspaceID = acc.WorkspaceID
			w.token = acc.Token
		}
		return nil
	})

	sc.Step(`^eu faço login com "([^"]*)" e a senha errada$`, func(email string) error {
		w.postAnon("/api/v1/auth/login", map[string]any{"email": email, "password": "senha-errada"})
		return nil
	})

	sc.Step(`^eu faço logout$`, func() error {
		w.post("/api/v1/auth/logout", nil)
		return nil
	})

	/* ---------------------------------------------------------------- token */

	sc.Step(`^a resposta traz um token de sessão$`, func() error {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(w.body, &body); err != nil {
			return err
		}
		if body.Token == "" {
			return fmt.Errorf("resposta sem token: %s", w.body)
		}
		return nil
	})

	sc.Step(`^a resposta não traz token$`, func() error {
		var body struct {
			Token string `json:"token"`
		}
		if err := json.Unmarshal(w.body, &body); err != nil {
			return err
		}
		if body.Token != "" {
			return fmt.Errorf("resposta não deveria trazer token: %s", w.body)
		}
		return nil
	})

	sc.Step(`^o workspace da conta se chama "([^"]*)"$`, func(want string) error {
		w.get("/api/v1/bootstrap")
		if w.status != http.StatusOK {
			return fmt.Errorf("bootstrap: %d %s", w.status, w.body)
		}
		var boot struct {
			Workspace domain.Workspace `json:"workspace"`
		}
		w.decode(&boot)
		if boot.Workspace.Name != want {
			return fmt.Errorf("workspace %q, esperava %q", boot.Workspace.Name, want)
		}
		return nil
	})

	sc.Step(`^o workspace é o mesmo do cadastro$`, func() error {
		if w.loginWorkspaceID == "" {
			return fmt.Errorf("login não devolveu workspace")
		}
		if w.loginWorkspaceID != w.workspaceID {
			return fmt.Errorf("workspace do login %q, cadastro %q", w.loginWorkspaceID, w.workspaceID)
		}
		return nil
	})

	sc.Step(`^eu leio o bootstrap sem token$`, func() error {
		w.token = ""
		w.get("/api/v1/bootstrap")
		return nil
	})

	sc.Step(`^eu leio o bootstrap com o token "([^"]*)"$`, func(token string) error {
		w.token = token
		w.get("/api/v1/bootstrap")
		return nil
	})

	sc.Step(`^eu leio o bootstrap com o mesmo token$`, func() error {
		// w.token continua sendo o token do cadastro; o logout é que deve
		// invalidá-lo. Não reatribuímos nada aqui de propósito.
		w.get("/api/v1/bootstrap")
		return nil
	})

	/* ------------------------------------------------------------ isolamento */

	sc.Step(`^eu crio um template na primeira conta$`, func() error {
		w.post("/api/v1/templates", map[string]any{
			"name": "boas_vindas", "displayName": "Boas-vindas", "category": "marketing",
			"language": "pt_BR", "header": map[string]string{"kind": "none"},
			"body": "Oi, {{1}}!", "buttons": []any{},
			"variables": []map[string]string{{"index": "1", "label": "nome", "example": "Ana"}},
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("criar template: %d %s", w.status, w.body)
		}
		w.status, w.body = 0, nil
		return nil
	})

	sc.Step(`^eu leio os templates da segunda conta$`, func() error {
		w.do(http.MethodGet, "/api/v1/templates", nil, w.otherToken)
		return nil
	})

	sc.Step(`^a segunda conta vê zero templates$`, func() error {
		var items []domain.Template
		if err := json.Unmarshal(w.body, &items); err != nil {
			return err
		}
		if len(items) != 0 {
			return fmt.Errorf("segunda conta vê %d templates", len(items))
		}
		return nil
	})

	sc.Step(`^a primeira conta monta uma campanha com (\d+) contato e dispara$`, func(n int) error {
		// Conta nova não tem número conectado, e disparar sem número é recusado
		// pelo domínio. Conectar o WhatsApp é configuração da conta, não dado de
		// exemplo — é o primeiro passo real de quem chega.
		w.do(http.MethodPut, "/api/v1/workspace", map[string]any{
			"name": "Café Aurora", "segment": "café", "site": "cafeaurora.com.br",
			"timezone": "America/Sao_Paulo", "plan": "POC",
			"whatsappNumber": "5511912345678", "emailSender": "time@cafeaurora.com.br",
			"quality": "green", "messagingLimit": "100 mil",
			"optInPolicy": "opt-in explícito", "quietHours": map[string]int{"start": 21, "end": 8},
		}, w.token)
		if w.status != http.StatusOK {
			return fmt.Errorf("configurar workspace: %d %s", w.status, w.body)
		}

		w.post("/api/v1/templates", map[string]any{
			"name": "reativacao", "displayName": "Reativação", "category": "marketing",
			"language": "pt_BR", "header": map[string]string{"kind": "none"},
			"body": "Oi, {{1}}!", "buttons": []any{},
			"variables": []map[string]string{{"index": "1", "label": "nome", "example": "Ana"}},
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("template: %d %s", w.status, w.body)
		}
		var tpl domain.Template
		w.decode(&tpl)

		for i := 0; i < n; i++ {
			w.post("/api/v1/contacts", map[string]any{
				"name": fmt.Sprintf("Contato %d", i), "phone": fmt.Sprintf("5511999%05d", i),
				"email": "", "city": "São Paulo", "uf": "SP", "tags": []string{},
				"source": "manual", "optIn": true, "optInSource": "manual",
			})
			if w.status != http.StatusCreated {
				return fmt.Errorf("contato: %d %s", w.status, w.body)
			}
		}

		w.post("/api/v1/segments", map[string]any{
			"name": "Todos", "description": "", "kind": "static", "source": "manual",
			"rules": []map[string]string{
				{"id": "r1", "field": "cidade", "operator": "eq", "value": "São Paulo"},
			},
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("audiência: %d %s", w.status, w.body)
		}
		var seg domain.Segment
		w.decode(&seg)

		// A janela tem que conter "agora", senão o worker pula a campanha e o
		// cenário passaria a depender da hora em que a suíte roda. A janela em
		// si é testada em campaign_send.feature.
		loc, _ := time.LoadLocation("America/Sao_Paulo")
		hour := time.Now().In(loc).Hour()

		w.post("/api/v1/campaigns", map[string]any{
			"name": "Campanha", "objective": "conversao", "status": "scheduled",
			"channel": "whatsapp", "templateId": tpl.ID, "segmentIds": []string{seg.ID},
			"schedule": map[string]any{
				"startAt": "2026-01-01T00:00:00Z", "windowStart": hour, "windowEnd": (hour + 1) % 24,
				"days": []int{0, 1, 2, 3, 4, 5, 6}, "throttlePerMinute": 600,
				"timezone": "America/Sao_Paulo",
			},
			"offer":            map[string]any{"enabled": false, "kind": "cupom", "codePattern": "", "discountLabel": "", "validUntil": ""},
			"requiresApproval": false, "notes": "",
		})
		if w.status != http.StatusCreated {
			return fmt.Errorf("campanha: %d %s", w.status, w.body)
		}
		var camp domain.Campaign
		w.decode(&camp)

		w.post("/api/v1/campaigns/"+camp.ID+"/launch", nil)
		if w.status != http.StatusCreated {
			return fmt.Errorf("disparo: %d %s", w.status, w.body)
		}
		w.campaignID = camp.ID
		w.status, w.body = 0, nil
		return nil
	})

	sc.Step(`^a fila processa todos os workspaces$`, func() error {
		// O worker é global: tem que achar a fila da conta nova, não só a do
		// workspace fixo que existia antes.
		for i := 0; i < 10; i++ {
			n, err := w.worker.Tick(context.Background())
			if err != nil {
				return err
			}
			if n == 0 {
				return nil
			}
		}
		return nil
	})

	sc.Step(`^a primeira conta tem envios$`, func() error {
		w.get("/api/v1/sends")
		var items []domain.Send
		if err := json.Unmarshal(w.body, &items); err != nil {
			return err
		}
		if len(items) == 0 {
			return fmt.Errorf("primeira conta sem envios: %s", w.body)
		}
		return nil
	})

	sc.Step(`^a segunda conta não tem envios$`, func() error {
		w.do(http.MethodGet, "/api/v1/sends", nil, w.otherToken)
		var items []domain.Send
		if err := json.Unmarshal(w.body, &items); err != nil {
			return err
		}
		if len(items) != 0 {
			return fmt.Errorf("segunda conta vê %d envios", len(items))
		}
		return nil
	})

	sc.Step(`^eu apago os dados da conta$`, func() error {
		w.post("/api/v1/dev/reset", nil)
		return nil
	})

	sc.Step(`^a conta continua existindo$`, func() error {
		// O reset é do CONTEÚDO, não do login: o mesmo token ainda vale.
		w.get("/api/v1/auth/me")
		if w.status != http.StatusOK {
			return fmt.Errorf("sessão morreu no reset: %d %s", w.status, w.body)
		}
		w.status, w.body = 0, nil
		return nil
	})

	sc.Step(`^a conta não tem templates$`, func() error { return w.assertEmpty("templates") })
	sc.Step(`^a conta não tem contatos$`, func() error { return w.assertEmpty("contacts") })
	sc.Step(`^a conta não tem campanhas$`, func() error { return w.assertEmpty("campaigns") })
	sc.Step(`^a conta não tem envios$`, func() error { return w.assertEmpty("sends") })

	sc.Step(`^não existe workspace "([^"]*)" no banco$`, func(id string) error {
		var n int
		if err := pool.QueryRow(context.Background(),
			`SELECT count(*) FROM workspaces WHERE id=$1`, id).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			return fmt.Errorf("workspace %q existe no banco", id)
		}
		return nil
	})

	/* ----------------------------------------------------------------- comum */

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
		if err := json.Unmarshal(w.body, &body); err != nil {
			return err
		}
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
}
