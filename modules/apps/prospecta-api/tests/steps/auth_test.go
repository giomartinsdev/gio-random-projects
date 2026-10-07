package steps

// Steps do BDD (godog) para tests/features/auth.feature (US5).
//
// Exercita /auth/signup, /auth/login, /auth/me e /auth/logout pelo router de
// produção via httptest, contra o par de domínio FALSO em container -- que
// registra CreateCompany/CreateUser e serve GET /users/by-email/{email}. Assim
// os cenários provam o contrato congelado: os status, o Set-Cookie, o efeito dos
// comandos publicados (tenant novo, company_id = command_id, hash bcrypt, role
// owner) e que e-mail duplicado não escreve nada.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/cucumber/godog"
	"golang.org/x/crypto/bcrypt"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/auth"
)

func TestAuthBdd(t *testing.T) {
	ctx := context.Background()

	pairURL, pairHTTP, stop := startFakeDomainPair(t, ctx)
	defer stop()

	suite := godog.TestSuite{
		Name: "prospecta-auth",
		ScenarioInitializer: func(sc *godog.ScenarioContext) {
			st := &state{pairURL: pairURL, pairHTTP: pairHTTP}
			registerCommonSteps(sc, st, ctx)
			registerAuthSteps(sc, st, ctx)
		},
		Options: &godog.Options{
			Format:   "pretty",
			Paths:    []string{"../features/auth.feature"},
			TestingT: t,
			Dialect:  "pt",
		},
	}
	if suite.Run() != 0 {
		t.Fatal("cenários de autenticação falharam")
	}
}

// registerAuthSteps declara os passos específicos de /auth.
func registerAuthSteps(sc *godog.ScenarioContext, st *state, ctx context.Context) {
	sc.Step(`^que eu tenho uma API com autenticação configurada$`, func() error {
		st.newAuthAPI()
		return nil
	})

	sc.Step(`^que eu tenho uma API sem segredo de sessão$`, func() error {
		st.newAPIWithoutSession()
		return nil
	})

	sc.Step(`^eu faço o cadastro com:$`, func(doc *godog.DocString) error {
		return st.postCookie(ctx, "/auth/signup", doc.Content, nil)
	})

	sc.Step(`^eu faço o login com:$`, func(doc *godog.DocString) error {
		return st.postCookie(ctx, "/auth/login", doc.Content, nil)
	})

	sc.Step(`^eu faço GET "([^"]*)" com o cookie de sessão$`, func(path string) error {
		return st.getCookie(ctx, path, st.cookie)
	})

	sc.Step(`^eu faço GET "([^"]*)" sem o cookie de sessão$`, func(path string) error {
		return st.getCookie(ctx, path, nil)
	})

	sc.Step(`^eu faço POST "([^"]*)" com o cookie de sessão$`, func(path string) error {
		return st.postCookie(ctx, path, "", st.cookie)
	})

	sc.Step(`^eu faço POST "([^"]*)" com o cookie de sessão e corpo:$`, func(path string, doc *godog.DocString) error {
		return st.postCookie(ctx, path, doc.Content, st.cookie)
	})

	sc.Step(`^eu limpo os comandos registrados no par de domínio$`, func() error {
		return clearCommands(ctx, st)
	})

	sc.Step(`^a resposta traz um cookie de sessão$`, func() error {
		if st.cookie == nil || strings.TrimSpace(st.cookie.Value) == "" {
			return fmt.Errorf("resposta sem Set-Cookie %q", auth.SessionCookieName)
		}
		return nil
	})

	sc.Step(`^a resposta NÃO traz cookie de sessão$`, func() error {
		if st.cookie != nil && strings.TrimSpace(st.cookie.Value) != "" {
			return fmt.Errorf("resposta trouxe cookie de sessão inesperado: %q", st.cookie.Value)
		}
		return nil
	})

	sc.Step(`^a resposta apaga o cookie de sessão$`, func() error {
		for _, c := range st.resp.Result().Cookies() {
			if c.Name == auth.SessionCookieName && c.MaxAge < 0 {
				return nil
			}
		}
		return fmt.Errorf("logout não apagou o cookie (MaxAge<0): %v", st.resp.Header().Values("Set-Cookie"))
	})

	sc.Step(`^o usuário da resposta tem "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		user, err := st.nested("user")
		if err != nil {
			return err
		}
		got, _ := user[field].(string)
		if got != want {
			return fmt.Errorf("user.%s = %q; want %q", field, got, want)
		}
		return nil
	})

	sc.Step(`^a empresa da resposta tem "([^"]*)" igual a "([^"]*)"$`, func(field, want string) error {
		company, err := st.nested("company")
		if err != nil {
			return err
		}
		got, _ := company[field].(string)
		if got != want {
			return fmt.Errorf("company.%s = %q; want %q", field, got, want)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" começando com "([^"]*)"$`, func(action, field, prefix string) error {
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		got, _ := payload[field].(string)
		if !strings.HasPrefix(got, prefix) {
			return fmt.Errorf("%s.%s = %q; want prefix %q", action, field, got, prefix)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" não vazio$`, func(action, field string) error {
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		got, _ := payload[field].(string)
		if strings.TrimSpace(got) == "" {
			return fmt.Errorf("%s.%s vazio: %v", action, field, payload)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" igual ao id do comando "([^"]*)"$`, func(action, field, otherAction string) error {
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		other, err := findCommand(ctx, st, otherAction)
		if err != nil {
			return err
		}
		if other == nil {
			return fmt.Errorf("comando %q não foi publicado", otherAction)
		}
		got, _ := payload[field].(string)
		if got != other.ID {
			return fmt.Errorf("%s.%s = %q; want %q (id de %s)", action, field, got, other.ID, otherAction)
		}
		return nil
	})

	sc.Step(`^o comando "([^"]*)" publicado tem "([^"]*)" igual ao tenant da sessão$`, func(action, field string) error {
		if st.sessionTenant == "" {
			return fmt.Errorf("sem tenant de sessão decodificado")
		}
		payload, err := commandPayload(ctx, st, action)
		if err != nil {
			return err
		}
		got, _ := payload[field].(string)
		if got != st.sessionTenant {
			return fmt.Errorf("%s.%s = %q; want %q (tenant da sessão)", action, field, got, st.sessionTenant)
		}
		return nil
	})

	// "o usuário X existe com a senha Y" cria a conta já com hash bcrypt, sem
	// passar pelo signup -- isola o caminho do login.
	sc.Step(`^o usuário "([^"]*)" existe com a senha "([^"]*)" no par de domínio$`, func(email, password string) error {
		return seedUser(ctx, st, email, password, "11111111-1111-1111-1111-111111111111", operatorTenant)
	})

	// "o usuário X já existe" cria a conta só para o cenário de e-mail
	// duplicado (a senha é irrelevante ali).
	sc.Step(`^o usuário "([^"]*)" já existe no par de domínio$`, func(email string) error {
		return seedUser(ctx, st, email, "segredo-forte", "11111111-1111-1111-1111-111111111111", operatorTenant)
	})
}

// --- helpers de auth -------------------------------------------------------

func (st *state) nested(field string) (map[string]any, error) {
	obj, ok := st.body[field].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("corpo sem objeto %q: %v", field, st.body)
	}
	return obj, nil
}

// postCookie faz um POST com o cookie opcional e decodifica o tenant da sessão
// quando um novo cookie é emitido.
func (st *state) postCookie(ctx context.Context, path, body string, cookie *http.Cookie) error {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil && cookie.Value != "" {
		req.AddCookie(cookie)
	}
	st.serve(req)
	st.captureSessionTenant()
	return nil
}

func (st *state) getCookie(ctx context.Context, path string, cookie *http.Cookie) error {
	req := httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx)
	if cookie != nil && cookie.Value != "" {
		req.AddCookie(cookie)
	}
	st.serve(req)
	st.captureSessionTenant()
	return nil
}

// captureSessionTenant decodifica o tenant do cookie recém-emitido, para o
// cenário provar que a rota de negócio usou o tenant da sessão. Só atualiza
// quando um novo cookie chegou; uma requisição seguinte sem Set-Cookie (ex.: a
// rota de negócio) não apaga o tenant já decodificado.
func (st *state) captureSessionTenant() {
	if st.cookie == nil || st.cookie.Value == "" {
		return
	}
	if s, err := auth.NewManager(sessionSecret, 0).Verify(st.cookie.Value); err == nil {
		st.sessionTenant = s.TenantID
	}
}

// seedUser registra um usuário no fake com hash bcrypt, para o login.
func seedUser(ctx context.Context, st *state, email, password, companyID, tenantID string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(map[string]any{
		"id":            "user-" + email,
		"email":         email,
		"name":          "Ana Souza",
		"password_hash": string(hash),
		"company_id":    companyID,
		"tenant_id":     tenantID,
		"role":          "owner",
	})
	if err != nil {
		return err
	}
	resp, err := st.control(ctx, http.MethodPost, "/__seed/user", strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("seed user retornou %d", resp.StatusCode)
	}
	return nil
}
