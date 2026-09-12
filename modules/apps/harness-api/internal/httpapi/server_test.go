package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api/internal/store"
)

const frontendOrigin = "https://harness-frontend.giomartins.dev"

func newTestHandler(t *testing.T, mutate func(*Config)) (http.Handler, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "harness.db"))
	if err != nil {
		t.Fatalf("abrir store: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	cfg := Config{AllowedOrigins: []string{frontendOrigin}}
	if mutate != nil {
		mutate(&cfg)
	}
	return New(st, cfg).Handler(), st
}

func do(h http.Handler, method, target string, id *Identity) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	if id != nil {
		req = req.WithContext(WithIdentity(req.Context(), *id))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func erroBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("corpo não é JSON: %v (%s)", err, rec.Body.String())
	}
	erro, _ := body["erro"].(map[string]any)
	if erro == nil {
		t.Fatalf("corpo sem \"erro\": %s", rec.Body.String())
	}
	return erro
}

// Healthcheck é a única rota que responde sem identidade nenhuma.
func TestHealthSemAuth(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	rec := do(h, http.MethodGet, "/api/health", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, queria 200", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["status"] != "ok" {
		t.Fatalf("corpo = %s, queria {\"status\":\"ok\"}", rec.Body.String())
	}
}

func TestMeExigeAuth(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	rec := do(h, http.MethodGet, "/api/me", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, queria 401", rec.Code)
	}
	erro := erroBody(t, rec)
	if erro["codigo"] != "nao_autenticado" {
		t.Fatalf("codigo = %v, queria nao_autenticado", erro["codigo"])
	}
}

// Com a identidade no context (como os testes das user stories vão
// injetar para simular usuários), /api/me devolve ela e o middleware
// NÃO deve rejeitar nem recalcular.
func TestMeComIdentidadeInjetada(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	rec := do(h, http.MethodGet, "/api/me", &Identity{Email: "b@corp", Nome: "Bia"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, queria 200 (%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["email"] != "b@corp" || body["nome"] != "Bia" {
		t.Fatalf("corpo = %v, queria o usuário injetado", body)
	}
}

func TestMeDevBypass(t *testing.T) {
	h, _ := newTestHandler(t, func(c *Config) {
		c.DevBypassAuth = true
		c.DevUserEmail = "gio@corp"
		c.DevUserNome = "Gio"
	})

	rec := do(h, http.MethodGet, "/api/me", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, queria 200 (%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["email"] != "gio@corp" || body["nome"] != "Gio" {
		t.Fatalf("corpo = %v, queria o usuário dev", body)
	}
}

// O middleware tem que alimentar o cache usuarios (research D7) — é daí
// que a lista/timeline vai tirar o nome de outras pessoas.
func TestAuthFazUpsertUsuarios(t *testing.T) {
	h, st := newTestHandler(t, nil)

	rec := do(h, http.MethodGet, "/api/me", &Identity{Email: "b@corp", Nome: "Bia"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, queria 200", rec.Code)
	}
	u, ok, err := st.UsuarioPorEmail("b@corp")
	if err != nil || !ok {
		t.Fatalf("usuário não foi cacheado: ok=%v err=%v", ok, err)
	}
	if u.Nome != "Bia" {
		t.Fatalf("nome cacheado = %q, queria %q", u.Nome, "Bia")
	}
}

func TestSSORedirecionaOrigemPermitida(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	// Deep link completo tem que sobreviver ao hop.
	rec := do(h, http.MethodGet, "/api/sso?return=https%3A%2F%2Fharness-frontend.giomartins.dev%2Fsessoes%2F12", nil)
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, queria 302 (%s)", rec.Code, rec.Body.String())
	}
	if loc := rec.Header().Get("Location"); loc != frontendOrigin+"/sessoes/12" {
		t.Fatalf("Location = %q, queria o return original", loc)
	}
}

// Origem fora da allowlist (ou return ausente) é 422 validacao — nunca
// um redirect silencioso para outro lugar.
func TestSSORecusaOrigemDesconhecida(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	for name, target := range map[string]string{
		"outra origem":  "/api/sso?return=https%3A%2F%2Fevil.example.com%2Fphish",
		"sem return":    "/api/sso",
		"url relativa":  "/api/sso?return=%2Fsessoes%2F12",
		"url quebrada":  "/api/sso?return=%3A%2F%2F",
		"host sem args": "/api/sso?return=x",
	} {
		t.Run(name, func(t *testing.T) {
			rec := do(h, http.MethodGet, target, nil)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, queria 422", rec.Code)
			}
			erro := erroBody(t, rec)
			if erro["codigo"] != "validacao" {
				t.Fatalf("codigo = %v, queria validacao", erro["codigo"])
			}
		})
	}
}

// O hop de login é público por design: sem Access cookie ele continua
// alcançável (é o Access em si que intercepta a navegação até aqui).
func TestSSONaoExigeAuth(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	rec := do(h, http.MethodGet, "/api/sso?return="+frontendOrigin, nil)
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, queria 302 sem auth", rec.Code)
	}
}

func TestCORSPreflight(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	req := httptest.NewRequest(http.MethodOptions, "/api/sessoes", nil)
	req.Header.Set("Origin", frontendOrigin)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, queria 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != frontendOrigin {
		t.Fatalf("Allow-Origin = %q, queria a origem ecoada", got)
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatal("Allow-Credentials ausente — o fetch com credentials:\"include\" quebraria")
	}
	if rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatal("Allow-Methods ausente")
	}

	// Origem desconhecida: preflight responde, mas sem liberar CORS.
	req = httptest.NewRequest(http.MethodOptions, "/api/sessoes", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("Allow-Origin não deveria existir para origem desconhecida")
	}
}

// Rota autenticada com método errado vira 405 do mux — o 401 de sessão
// só existe quando não há identidade.
func TestMetodoErradoAposAuth(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	rec := do(h, http.MethodPost, "/api/me", &Identity{Email: "b@corp", Nome: "B"})
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, queria 405", rec.Code)
	}
}
