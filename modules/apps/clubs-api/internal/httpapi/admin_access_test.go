package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

// parseAdminEmails normaliza e-mail em minúsculas e sem espaços: o valor vem de
// um env digitado à mão, e comparar cru faria "Ana@Corp.com " não casar com
// "ana@corp.com" -- a pessoa perderia o acesso sem sintoma nenhum.
func TestParseAdminEmailsNormaliza(t *testing.T) {
	set := parseAdminEmails(" Ana@Corp.com , b@corp.com,,")
	if _, ok := set["ana@corp.com"]; !ok {
		t.Error("e-mail com maiúscula/espaço deveria virar a chave em minúsculas")
	}
	if _, ok := set["b@corp.com"]; !ok {
		t.Error("e-mail sem espaço deveria entrar")
	}
	if len(set) != 2 {
		t.Errorf("lista = %v; want exatamente 2 (vazios descartados)", set)
	}
}

// Sem lista configurada, o default HARDCODED entra: o dono do hub é admin, e
// ninguém mais. O painel não fica inacessível por falta de config, nem aberto
// para qualquer um.
func TestSemListaUsaODefaultHardcoded(t *testing.T) {
	s := &Server{adminEmails: resolveAdminEmails("")}
	if !s.isAdmin("giovannidealmeidamartins@gmail.com") {
		t.Error("sem lista, o dono do hub deveria ser admin (default hardcoded)")
	}
	if !s.isAdmin("GiovanniDeAlmeidaMartins@Gmail.com") {
		t.Error("o default também compara case-insensitive")
	}
	if s.isAdmin("qualquer@corp.com") {
		t.Error("sem lista, só o default é admin -- ninguém além dele")
	}
	if s.isAdmin("") {
		t.Error("e-mail vazio nunca é admin")
	}
}

// O env sobrepõe o default quando definido: virar configurável depois não exige
// mexer no código.
func TestEnvSobrepOEODefault(t *testing.T) {
	s := &Server{adminEmails: resolveAdminEmails("ana@corp.com")}
	if !s.isAdmin("ana@corp.com") {
		t.Error("o e-mail do env deveria ser admin")
	}
	if s.isAdmin("giovannidealmeidamartins@gmail.com") {
		t.Error("com env definido, o default sai de cena")
	}
}

func TestIsAdminPorEmail(t *testing.T) {
	s := &Server{adminEmails: parseAdminEmails("ana@corp.com")}
	if !s.isAdmin("ana@corp.com") {
		t.Error("ana deveria ser admin")
	}
	if !s.isAdmin("Ana@Corp.com") {
		t.Error("a comparação é case-insensitive")
	}
	if s.isAdmin("bob@corp.com") {
		t.Error("bob não é admin")
	}
}

// O gate de verdade: a rota de administração responde 403 (não o conteúdo) para
// quem está logado mas não é admin, e 200 para quem é. É o comportamento que o
// cenário de produto promete -- o resto é consequência.
//
// Sem domain client o handler devolve um estado vazio com 200, o que basta: o
// que se testa aqui é o gate, não a leitura.
func TestAdminRotaExigeAllowlist(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))

	cases := []struct {
		nome   string
		admins string
		email  string
		want   int
	}{
		{"admin vê", "ana@corp.com", "ana@corp.com", http.StatusOK},
		{"não-admin não vê", "ana@corp.com", "bob@corp.com", http.StatusForbidden},
		// Sem env, o default hardcoded entra: o dono do hub vê; outra conta não.
		{"sem env, o dono do hub vê", "", "giovannidealmeidamartins@gmail.com", http.StatusOK},
		{"sem env, terceiro não vê", "", "ana@corp.com", http.StatusForbidden},
	}
	for _, c := range cases {
		t.Run(c.nome, func(t *testing.T) {
			s := NewServer(nil, Config{AdminEmails: c.admins}, log)
			h := s.Handler()

			req := httptest.NewRequest(http.MethodGet, "/api/admin/status", nil)
			// A identidade já resolvida, como se o middleware pessoal tivesse
			// rodado: é o que testa o gate de ADMIN isoladamente.
			req = req.WithContext(WithIdentity(req.Context(), Identity{Email: c.email}))
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)

			if rec.Code != c.want {
				t.Fatalf("status = %d; want %d (%s)", rec.Code, c.want, rec.Body.String())
			}
		})
	}
}
