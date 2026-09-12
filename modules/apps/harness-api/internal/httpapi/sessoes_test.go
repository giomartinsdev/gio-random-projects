// Testes handler das user stories US1–US5, via httptest + SQLite
// temporário (newTestHandler em server_test.go). Usuários são simulados
// injetando Identity no context (WithIdentity) — ana e bruno cobrem os
// casos de duas pessoas (retomada, lista do time). O relógio do store é
// pinado para deixar ordenação e conflito otimista determinísticos.
package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api/internal/store"
)

var (
	ana   = Identity{Email: "ana@corp", Nome: "Ana"}
	bruno = Identity{Email: "bruno@corp", Nome: "Bruno"}
)

// t0 é a âncora do relógio pinado: um segundo inteiro qualquer, bem no
// passado, para caber avanços sem colidir com o time.Now real.
const t0 = int64(1_700_000_000)

// pinRelogio congela store.Now em t0 e devolve um ponteiro que os testes
// avançam entre chamadas — ordenação da lista e conflito otimista ficam
// determinísticos sem sleep.
func pinRelogio(t *testing.T) *int64 {
	t.Helper()
	agora := t0
	store.Now = func() time.Time { return time.Unix(agora, 0) }
	t.Cleanup(func() { store.Now = time.Now })
	return &agora
}

// ─── Corpos JSON de resposta ──────────────────────────────────────────

type usuarioJSON struct {
	Email string `json:"email"`
	Nome  string `json:"nome"`
}

type resumoJSON struct {
	ID        int64        `json:"id"`
	Titulo    string       `json:"titulo"`
	Status    string       `json:"status"`
	DonoAtual *usuarioJSON `json:"dono_atual"`
}

type sessaoJSON struct {
	ID               int64        `json:"id"`
	Titulo           string       `json:"titulo"`
	Objetivo         string       `json:"objetivo"`
	Repo             *string      `json:"repo"`
	ContextoMD       *string      `json:"contexto_md"`
	ProximosPassosMD *string      `json:"proximos_passos_md"`
	Status           string       `json:"status"`
	Criador          usuarioJSON  `json:"criador"`
	DonoAtual        usuarioJSON  `json:"dono_atual"`
	PRLink           *string      `json:"pr_link"`
	OrigemID         *int64       `json:"origem_id"`
	CriadoEm         int64        `json:"criado_em"`
	AtualizadoEm     int64        `json:"atualizado_em"`
	Origem           *resumoJSON  `json:"origem"`
	Extensoes        []resumoJSON `json:"extensoes"`
}

type detalheJSON struct {
	Campo    string `json:"campo"`
	Problema string `json:"problema"`
}

type erroJSON struct {
	Codigo   string        `json:"codigo"`
	Mensagem string        `json:"mensagem"`
	Detalhes []detalheJSON `json:"detalhes"`
}

// corpoComErro decoda o envelope de erro; Sessao é o estado vigente do
// 409 de edição (contrato).
type corpoComErro struct {
	Erro   erroJSON    `json:"erro"`
	Sessao *sessaoJSON `json:"sessao"`
}

type itemListaJSON struct {
	ID             int64       `json:"id"`
	Status         string      `json:"status"`
	DonoAtual      usuarioJSON `json:"dono_atual"`
	AtualizadoEm   int64       `json:"atualizado_em"`
	ResumoObjetivo string      `json:"resumo_objetivo"`
}

type listaJSON struct {
	Sessoes []itemListaJSON `json:"sessoes"`
}

type eventoJSON struct {
	ID       int64          `json:"id"`
	Tipo     string         `json:"tipo"`
	Autor    usuarioJSON    `json:"autor"`
	Payload  map[string]any `json:"payload"`
	CriadoEm int64          `json:"criado_em"`
}

type eventosJSON struct {
	Eventos []eventoJSON `json:"eventos"`
}

// ─── Helpers de chamada ───────────────────────────────────────────────

func doCorpo(t *testing.T, h http.Handler, method, target string, id *Identity, corpo any) *httptest.ResponseRecorder {
	t.Helper()
	var body io.Reader
	if corpo != nil {
		raw, err := json.Marshal(corpo)
		if err != nil {
			t.Fatalf("serializar corpo: %v", err)
		}
		body = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, target, body)
	if id != nil {
		req = req.WithContext(WithIdentity(req.Context(), *id))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodar[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("corpo não é JSON: %v (%s)", err, rec.Body.String())
	}
	return v
}

func exigirStatus(t *testing.T, rec *httptest.ResponseRecorder, querido int) {
	t.Helper()
	if rec.Code != querido {
		t.Fatalf("status = %d, queria %d (%s)", rec.Code, querido, rec.Body.String())
	}
}

func exigirCodigo(t *testing.T, rec *httptest.ResponseRecorder, codigo string) erroJSON {
	t.Helper()
	corpo := decodar[corpoComErro](t, rec)
	if corpo.Erro.Codigo != codigo {
		t.Fatalf("codigo = %q, queria %q (%s)", corpo.Erro.Codigo, codigo, rec.Body.String())
	}
	return corpo.Erro
}

// detalheDeProcura o problema de um campo nos detalhes de um 422.
func detalheDe(t *testing.T, rec *httptest.ResponseRecorder, campo string) string {
	t.Helper()
	erro := exigirCodigo(t, rec, "validacao")
	for _, d := range erro.Detalhes {
		if d.Campo == campo {
			return d.Problema
		}
	}
	t.Fatalf("detalhes não cita %q: %v", campo, erro.Detalhes)
	return ""
}

func rota(id int64) string       { return fmt.Sprintf("/api/sessoes/%d", id) }
func rotaStatus(id int64) string { return fmt.Sprintf("/api/sessoes/%d/status", id) }
func rotaRetomar(id int64) string {
	return fmt.Sprintf("/api/sessoes/%d/retomar", id)
}
func rotaEventos(id int64) string {
	return fmt.Sprintf("/api/sessoes/%d/eventos", id)
}

// criarSessao posta uma sessão básica com os extras dados e devolve o
// corpo do 201.
func criarSessao(t *testing.T, h http.Handler, quem Identity, extras map[string]any) sessaoJSON {
	t.Helper()
	corpo := map[string]any{"titulo": "sessão de " + quem.Email, "objetivo": "objetivo da sessão de teste"}
	for k, v := range extras {
		corpo[k] = v
	}
	rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &quem, corpo)
	exigirStatus(t, rec, http.StatusCreated)
	return decodar[sessaoJSON](t, rec)
}

// extender cria uma extensão da sessão origem (US-4).
func extender(t *testing.T, h http.Handler, quem Identity, origemID int64, titulo string) sessaoJSON {
	t.Helper()
	rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &quem, map[string]any{
		"titulo": titulo, "objetivo": "objetivo da extensão", "origem_id": origemID,
	})
	exigirStatus(t, rec, http.StatusCreated)
	return decodar[sessaoJSON](t, rec)
}

func obterSessao(t *testing.T, h http.Handler, quem Identity, id int64) sessaoJSON {
	t.Helper()
	rec := do(h, http.MethodGet, rota(id), &quem)
	exigirStatus(t, rec, http.StatusOK)
	return decodar[sessaoJSON](t, rec)
}

func eventosDe(t *testing.T, h http.Handler, quem Identity, id int64) []eventoJSON {
	t.Helper()
	rec := do(h, http.MethodGet, rotaEventos(id), &quem)
	exigirStatus(t, rec, http.StatusOK)
	return decodar[eventosJSON](t, rec).Eventos
}

func listaDeIDs(t *testing.T, h http.Handler, quem Identity, query string) []int64 {
	t.Helper()
	rec := do(h, http.MethodGet, "/api/sessoes"+query, &quem)
	exigirStatus(t, rec, http.StatusOK)
	lista := decodar[listaJSON](t, rec)
	ids := make([]int64, 0, len(lista.Sessoes))
	for _, item := range lista.Sessoes {
		ids = append(ids, item.ID)
	}
	return ids
}

func exigirLista(t *testing.T, h http.Handler, quem Identity, query string, quer []int64) {
	t.Helper()
	got := listaDeIDs(t, h, quem, query)
	if len(got) != len(quer) {
		t.Fatalf("lista %q = %v, queria %v", query, got, quer)
	}
	for i := range quer {
		if got[i] != quer[i] {
			t.Fatalf("lista %q = %v, queria %v (ordem incluída)", query, got, quer)
		}
	}
}

// mudarStatus aplica uma ação de status exigindo 200.
func mudarStatus(t *testing.T, h http.Handler, quem Identity, id int64, acao string, extras map[string]any) sessaoJSON {
	t.Helper()
	corpo := map[string]any{"acao": acao}
	for k, v := range extras {
		corpo[k] = v
	}
	rec := doCorpo(t, h, http.MethodPost, rotaStatus(id), &quem, corpo)
	exigirStatus(t, rec, http.StatusOK)
	return decodar[sessaoJSON](t, rec)
}

// sessaoEmEstado cria uma sessão de ana já no estado pedido, usando
// apenas transições válidas (entregar; entregar+arquivar).
func sessaoEmEstado(t *testing.T, h http.Handler, estado string) sessaoJSON {
	t.Helper()
	sess := criarSessao(t, h, ana, nil)
	switch estado {
	case "em_andamento":
	case "entregue":
		mudarStatus(t, h, ana, sess.ID, "entregar", nil)
	case "arquivada":
		mudarStatus(t, h, ana, sess.ID, "entregar", nil)
		mudarStatus(t, h, ana, sess.ID, "arquivar", nil)
	default:
		t.Fatalf("estado de teste desconhecido: %q", estado)
	}
	return obterSessao(t, h, ana, sess.ID)
}

// ─── US1 — criação, leitura, lista ────────────────────────────────────

func TestCriarSessaoValida(t *testing.T) {
	pinRelogio(t)
	h, _ := newTestHandler(t, nil)

	contexto := "decisões: ...\ngotchas: ..."
	sess := criarSessao(t, h, ana, map[string]any{
		"repo":               "bet-api@feat/auth-sessions",
		"contexto_md":        contexto,
		"proximos_passos_md": "1. middleware\n2. testes",
	})

	if sess.ID == 0 {
		t.Fatal("id ausente na resposta do 201")
	}
	if sess.Titulo != "sessão de ana@corp" {
		t.Fatalf("titulo = %q", sess.Titulo)
	}
	if sess.Status != store.StatusEmAndamento {
		t.Fatalf("status = %q, queria em_andamento", sess.Status)
	}
	// FR-012: dono atual nasce = criador.
	if sess.DonoAtual.Email != "ana@corp" || sess.DonoAtual.Nome != "Ana" {
		t.Fatalf("dono_atual = %+v, queria Ana", sess.DonoAtual)
	}
	if sess.Criador.Email != "ana@corp" {
		t.Fatalf("criador = %+v", sess.Criador)
	}
	if sess.Repo == nil || *sess.Repo != "bet-api@feat/auth-sessions" {
		t.Fatalf("repo = %v", sess.Repo)
	}
	if sess.ContextoMD == nil || *sess.ContextoMD != contexto {
		t.Fatalf("contexto_md = %v", sess.ContextoMD)
	}
	if sess.CriadoEm != t0 || sess.AtualizadoEm != t0 {
		t.Fatalf("timestamps = %d/%d, queria %d", sess.CriadoEm, sess.AtualizadoEm, t0)
	}
	if sess.PRLink != nil || sess.OrigemID != nil {
		t.Fatal("sessão nova não tem pr_link nem origem")
	}

	// A leitura por outra pessoa devolve o mesmo conteúdo, com os nomes
	// resolvidos pelo cache usuarios.
	lida := obterSessao(t, h, bruno, sess.ID)
	if lida.ContextoMD == nil || *lida.ContextoMD != contexto {
		t.Fatalf("contexto na leitura = %v", lida.ContextoMD)
	}
	if lida.Criador.Nome != "Ana" || lida.DonoAtual.Nome != "Ana" {
		t.Fatalf("nomes = %+v / %+v, queria Ana", lida.Criador, lida.DonoAtual)
	}
}

// Campos opcionais ausentes viram null, nunca "" (contrato).
func TestCriarSessaoOpcionaisNulos(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)
	if sess.Repo != nil || sess.ContextoMD != nil || sess.ProximosPassosMD != nil || sess.PRLink != nil {
		t.Fatalf("opcionais = %v/%v/%v/%v, queria tudo null", sess.Repo, sess.ContextoMD, sess.ProximosPassosMD, sess.PRLink)
	}
}

func TestCriarSessaoRecusaInvalidos(t *testing.T) {
	h, _ := newTestHandler(t, nil)

	casos := []struct {
		nome   string
		corpo  map[string]any
		campos []string
	}{
		{"sem título nem objetivo", map[string]any{}, []string{"titulo", "objetivo"}},
		{"título só de espaço", map[string]any{"titulo": "   ", "objetivo": "o"}, []string{"titulo"}},
		{"objetivo só de espaço", map[string]any{"titulo": "t", "objetivo": " "}, []string{"objetivo"}},
		{"título com 201 caracteres", map[string]any{"titulo": strings.Repeat("ç", 201), "objetivo": "o"}, []string{"titulo"}},
		{"objetivo com 5001 caracteres", map[string]any{"titulo": "t", "objetivo": strings.Repeat("á", 5001)}, []string{"objetivo"}},
		{"repo com 201 caracteres", map[string]any{"titulo": "t", "objetivo": "o", "repo": strings.Repeat("r", 201)}, []string{"repo"}},
		{"contexto com 65537 bytes", map[string]any{"titulo": "t", "objetivo": "o", "contexto_md": strings.Repeat("a", 65537)}, []string{"contexto_md"}},
		{"contexto 40 mil runes (80 mil bytes)", map[string]any{"titulo": "t", "objetivo": "o", "contexto_md": strings.Repeat("é", 40000)}, []string{"contexto_md"}},
		{"próximos passos com 16385 bytes", map[string]any{"titulo": "t", "objetivo": "o", "proximos_passos_md": strings.Repeat("a", 16385)}, []string{"proximos_passos_md"}},
	}
	for _, tt := range casos {
		t.Run(tt.nome, func(t *testing.T) {
			rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &ana, tt.corpo)
			exigirStatus(t, rec, http.StatusUnprocessableEntity)
			for _, campo := range tt.campos {
				if detalheDe(t, rec, campo) == "" {
					t.Fatalf("campo %q sem problema preenchido", campo)
				}
			}
		})
	}
}

// Nos limites exatos a sessão passa — e os contadores são os do
// data-model.md: runes para título/objetivo/repo, bytes para markdowns.
func TestCriarSessaoNosLimitesExatos(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &ana, map[string]any{
		"titulo":             strings.Repeat("ç", 200),  // 200 runes (400 bytes)
		"objetivo":           strings.Repeat("á", 5000), // 5000 runes (10 mil bytes)
		"repo":               strings.Repeat("r", 200),
		"contexto_md":        strings.Repeat("a", 65536), // 65536 bytes exatos
		"proximos_passos_md": strings.Repeat("a", 16384), // 16384 bytes exatos
	})
	exigirStatus(t, rec, http.StatusCreated)
}

// O título é trimado antes de gravar (data-model.md).
func TestCriarSessaoTrimaTitulo(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &ana, map[string]any{
		"titulo": "  com espaços nas pontas  ", "objetivo": "o",
	})
	exigirStatus(t, rec, http.StatusCreated)
	sess := decodar[sessaoJSON](t, rec)
	if sess.Titulo != "com espaços nas pontas" {
		t.Fatalf("titulo = %q, queria trimado", sess.Titulo)
	}
}

func TestTimelineDaCriacao(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	eventos := eventosDe(t, h, bruno, sess.ID)
	if len(eventos) != 1 {
		t.Fatalf("timeline da sessão nova = %d eventos, queria só a criacao", len(eventos))
	}
	e := eventos[0]
	if e.Tipo != "criacao" {
		t.Fatalf("tipo = %q, queria criacao", e.Tipo)
	}
	if e.Autor.Email != "ana@corp" || e.Autor.Nome != "Ana" {
		t.Fatalf("autor = %+v, queria Ana", e.Autor)
	}
	if e.Payload["titulo"] != sess.Titulo {
		t.Fatalf("payload = %v, queria o título", e.Payload)
	}
	if e.CriadoEm != sess.CriadoEm {
		t.Fatalf("criado_em do evento = %d, queria %d", e.CriadoEm, sess.CriadoEm)
	}
}

func TestGetSessaoInexistente(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	for _, target := range []string{"/api/sessoes/999", "/api/sessoes/abc", "/api/sessoes/0", "/api/sessoes/-1"} {
		t.Run(target, func(t *testing.T) {
			rec := do(h, http.MethodGet, target, &ana)
			exigirStatus(t, rec, http.StatusNotFound)
			if erro := erroBody(t, rec); erro["codigo"] != "nao_encontrado" {
				t.Fatalf("codigo = %v, queria nao_encontrado", erro["codigo"])
			}
		})
	}
}

// Lista do time (US-3): todo mundo autenticado vê as mesmas sessões,
// ativas primeiro e, dentro de cada grupo, atualizado_em desc.
func TestListaOrdenaAtivasPrimeiro(t *testing.T) {
	agora := pinRelogio(t)
	h, _ := newTestHandler(t, nil)

	s1 := criarSessao(t, h, ana, nil)
	s2 := criarSessao(t, h, ana, nil)
	s3 := criarSessao(t, h, bruno, nil)

	// s1 é editada (fica mais recente que s2 e s3); s2 é entregue.
	*agora += 60
	rec := doCorpo(t, h, http.MethodPatch, rota(s1.ID), &bruno, map[string]any{
		"proximos_passos_md": "passos atualizados", "base_atualizado_em": s1.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusOK)
	*agora += 60
	mudarStatus(t, h, ana, s2.ID, "entregar", nil)

	// s1 (t0+60) ficou a ativa mais recente; s3 (t0) vem depois; s2
	// entregue por último.
	exigirLista(t, h, bruno, "", []int64{s1.ID, s3.ID, s2.ID})
}

func TestResumoObjetivoNaLista(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	criarSessao(t, h, ana, map[string]any{"objetivo": strings.Repeat("á", 300)})
	criarSessao(t, h, bruno, map[string]any{"objetivo": "curto e direto"})

	rec := do(h, http.MethodGet, "/api/sessoes", &bruno)
	exigirStatus(t, rec, http.StatusOK)
	lista := decodar[listaJSON](t, rec)
	if len(lista.Sessoes) != 2 {
		t.Fatalf("lista = %d itens, queria 2", len(lista.Sessoes))
	}
	for _, item := range lista.Sessoes {
		runes := len([]rune(item.ResumoObjetivo))
		if runes > 141 { // 140 + reticência
			t.Fatalf("resumo = %d runes, deveria truncar em 141", runes)
		}
		if !strings.HasSuffix(item.ResumoObjetivo, "…") && item.ResumoObjetivo != "curto e direto" {
			t.Fatalf("resumo inesperado: %q", item.ResumoObjetivo)
		}
	}
}

// ─── US2 — retomada e edição concorrente ──────────────────────────────

func TestRetomarTrocaDonoEEvento(t *testing.T) {
	agora := pinRelogio(t)
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	*agora += 60
	rec := doCorpo(t, h, http.MethodPost, rotaRetomar(sess.ID), &bruno, map[string]any{})
	exigirStatus(t, rec, http.StatusOK)
	retomada := decodar[sessaoJSON](t, rec)

	if retomada.DonoAtual.Email != "bruno@corp" || retomada.DonoAtual.Nome != "Bruno" {
		t.Fatalf("dono_atual = %+v, queria Bruno", retomada.DonoAtual)
	}
	// A baton muda de mão, a autoria não (FR-005).
	if retomada.Criador.Email != "ana@corp" {
		t.Fatalf("criador = %+v, não devia mudar", retomada.Criador)
	}
	if retomada.AtualizadoEm != t0+60 {
		t.Fatalf("atualizado_em = %d, queria %d (retomada é mutação)", retomada.AtualizadoEm, t0+60)
	}

	eventos := eventosDe(t, h, ana, sess.ID)
	if len(eventos) != 2 {
		t.Fatalf("timeline = %d eventos, queria criacao + retomada", len(eventos))
	}
	e := eventos[1]
	if e.Tipo != "retomada" {
		t.Fatalf("tipo = %q, queria retomada", e.Tipo)
	}
	if e.Autor.Email != "bruno@corp" {
		t.Fatalf("autor da retomada = %+v, queria Bruno", e.Autor)
	}
	if e.Payload["dono_anterior"] != "ana@corp" || e.Payload["dono_novo"] != "bruno@corp" {
		t.Fatalf("payload = %v, queria a troca ana→bruno", e.Payload)
	}
}

// Segunda retomada do mesmo dono (e o próprio dono retomando): 200,
// nada muda, nenhum evento duplicado.
func TestRetomarIdempotente(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	for i := 0; i < 2; i++ {
		rec := doCorpo(t, h, http.MethodPost, rotaRetomar(sess.ID), &bruno, map[string]any{})
		exigirStatus(t, rec, http.StatusOK)
	}
	if n := len(eventosDe(t, h, ana, sess.ID)); n != 2 {
		t.Fatalf("timeline = %d eventos, queria criacao + 1 retomada só", n)
	}

	outra := criarSessao(t, h, ana, nil)
	rec := doCorpo(t, h, http.MethodPost, rotaRetomar(outra.ID), &ana, map[string]any{})
	exigirStatus(t, rec, http.StatusOK)
	if n := len(eventosDe(t, h, ana, outra.ID)); n != 1 {
		t.Fatalf("timeline = %d eventos, dono retomando não cria evento", n)
	}
}

// O corpo da retomada é tolerado em qualquer forma — vazio de verdade ou
// "{}" (o que o frontend manda).
func TestRetomarTolerarCorpoVazio(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	req := httptest.NewRequest(http.MethodPost, rotaRetomar(sess.ID), nil)
	req = req.WithContext(WithIdentity(req.Context(), bruno))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	exigirStatus(t, rec, http.StatusOK)

	rec = doCorpo(t, h, http.MethodPost, rotaRetomar(sess.ID), &bruno, map[string]any{})
	exigirStatus(t, rec, http.StatusOK)
}

func TestRetomarSessaoInexistente(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	rec := doCorpo(t, h, http.MethodPost, rotaRetomar(999), &bruno, nil)
	exigirStatus(t, rec, http.StatusNotFound)
	if erro := erroBody(t, rec); erro["codigo"] != "nao_encontrado" {
		t.Fatalf("codigo = %v, queria nao_encontrado", erro["codigo"])
	}
}

// A e B editam a mesma sessão: B salva primeiro, A recebe 409 com o
// estado vigente no corpo e só sobrescreve com force (quickstart §3).
func TestPatchConflitoComEstadoVigente(t *testing.T) {
	agora := pinRelogio(t)
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, map[string]any{"contexto_md": "versão da Ana"})

	// Bruno salva com a base que viu.
	*agora += 60
	rec := doCorpo(t, h, http.MethodPatch, rota(sess.ID), &bruno, map[string]any{
		"contexto_md": "versão do Bruno", "base_atualizado_em": sess.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusOK)
	editada := decodar[sessaoJSON](t, rec)
	if editada.ContextoMD == nil || *editada.ContextoMD != "versão do Bruno" {
		t.Fatalf("contexto = %v, queria a versão do Bruno", editada.ContextoMD)
	}
	// PATCH edita conteúdo, nunca o dono.
	if editada.DonoAtual.Email != "ana@corp" {
		t.Fatalf("dono = %+v, não devia mudar no PATCH", editada.DonoAtual)
	}
	if editada.AtualizadoEm != t0+60 {
		t.Fatalf("atualizado_em = %d, queria %d", editada.AtualizadoEm, t0+60)
	}

	// Ana salva com a base velha: 409 conflito + sessao vigente no corpo.
	rec = doCorpo(t, h, http.MethodPatch, rota(sess.ID), &ana, map[string]any{
		"contexto_md": "versão atrasada da Ana", "base_atualizado_em": sess.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusConflict)
	corpo := decodar[corpoComErro](t, rec)
	if corpo.Erro.Codigo != "conflito" {
		t.Fatalf("codigo = %q, queria conflito", corpo.Erro.Codigo)
	}
	if corpo.Sessao == nil {
		t.Fatal("409 sem sessão vigente no corpo")
	}
	if corpo.Sessao.ContextoMD == nil || *corpo.Sessao.ContextoMD != "versão do Bruno" {
		t.Fatalf("estado vigente no 409 = %v, queria a versão do Bruno", corpo.Sessao.ContextoMD)
	}

	// Sem force, nada foi sobrescrito.
	if lida := obterSessao(t, h, ana, sess.ID); *lida.ContextoMD != "versão do Bruno" {
		t.Fatalf("contexto depois do 409 = %v, não devia mudar", lida.ContextoMD)
	}

	// force:true vence (última escrita) e o evento registra o force.
	*agora += 60
	rec = doCorpo(t, h, http.MethodPatch, rota(sess.ID), &ana, map[string]any{
		"contexto_md": "versão forçada da Ana", "base_atualizado_em": sess.AtualizadoEm, "force": true,
	})
	exigirStatus(t, rec, http.StatusOK)
	if lida := obterSessao(t, h, ana, sess.ID); *lida.ContextoMD != "versão forçada da Ana" {
		t.Fatalf("contexto com force = %v, queria a versão da Ana", lida.ContextoMD)
	}

	eventos := eventosDe(t, h, ana, sess.ID)
	if len(eventos) != 3 {
		t.Fatalf("timeline = %d eventos, queria criacao + 2 atualizações", len(eventos))
	}
	for i, esperado := range []bool{false, true} {
		e := eventos[i+1]
		if e.Tipo != "atualizacao_contexto" {
			t.Fatalf("evento %d = %q, queria atualizacao_contexto", i+1, e.Tipo)
		}
		if e.Payload["force"] != esperado {
			t.Fatalf("evento %d force = %v, queria %v", i+1, e.Payload["force"], esperado)
		}
		campos, ok := e.Payload["campos"].([]any)
		if !ok || len(campos) != 1 || campos[0] != "contexto_md" {
			t.Fatalf("evento %d campos = %v, queria [contexto_md]", i+1, e.Payload["campos"])
		}
	}
}

// PATCH sem base_atualizado_em é tratado como base 0: conflito, a não
// ser que venha com force (contrato da concorrência otimista).
func TestPatchSemBaseEhConflito(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	rec := doCorpo(t, h, http.MethodPatch, rota(sess.ID), &bruno, map[string]any{"contexto_md": "x"})
	exigirStatus(t, rec, http.StatusConflict)

	rec = doCorpo(t, h, http.MethodPatch, rota(sess.ID), &bruno, map[string]any{"contexto_md": "x", "force": true})
	exigirStatus(t, rec, http.StatusOK)
}

func TestPatchRecusaInvalidos(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	// Nenhum campo editável informado.
	rec := doCorpo(t, h, http.MethodPatch, rota(sess.ID), &ana, map[string]any{
		"base_atualizado_em": sess.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "contexto_md") == "" || detalheDe(t, rec, "proximos_passos_md") == "" {
		t.Fatal("422 sem os detalhes dos campos editáveis")
	}

	// Contexto acima de 64 KB.
	rec = doCorpo(t, h, http.MethodPatch, rota(sess.ID), &ana, map[string]any{
		"contexto_md": strings.Repeat("a", 65537), "base_atualizado_em": sess.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "contexto_md") == "" {
		t.Fatal("422 sem detalhe de contexto_md")
	}

	// Sessão inexistente é 404.
	rec = doCorpo(t, h, http.MethodPatch, rota(999), &ana, map[string]any{
		"contexto_md": "x", "base_atualizado_em": 1,
	})
	exigirStatus(t, rec, http.StatusNotFound)
}

// ─── US3 — filtros da lista ───────────────────────────────────────────

func TestFiltrosDaLista(t *testing.T) {
	agora := pinRelogio(t)
	h, _ := newTestHandler(t, nil)

	s1 := criarSessao(t, h, ana, nil)   // ana, em_andamento
	s2 := criarSessao(t, h, ana, nil)   // ana, entregue
	s3 := criarSessao(t, h, bruno, nil) // bruno, em_andamento
	s4 := criarSessao(t, h, bruno, nil) // bruno, arquivada

	*agora += 60
	mudarStatus(t, h, ana, s2.ID, "entregar", nil) // atualizado_em t0+60
	*agora += 60
	mudarStatus(t, h, bruno, s4.ID, "arquivar", nil) // atualizado_em t0+120

	casos := []struct {
		nome  string
		query string
		quer  []int64
	}{
		{"sem filtro: ativas primeiro, resto por atualizado_em desc", "",
			[]int64{s3.ID, s1.ID, s4.ID, s2.ID}},
		{"status=entregue", "?status=entregue", []int64{s2.ID}},
		{"status repetível", "?status=em_andamento&status=arquivada", []int64{s3.ID, s1.ID, s4.ID}},
		{"dono=ana", "?dono=ana@corp", []int64{s1.ID, s2.ID}},
		{"dono=bruno", "?dono=bruno@corp", []int64{s3.ID, s4.ID}},
		{"status+dono combinados", "?status=entregue&dono=ana@corp", []int64{s2.ID}},
		{"dono sem sessões", "?dono=ninguem@corp", []int64{}},
		{"combinação sem resultados", "?status=entregue&dono=bruno@corp", []int64{}},
	}
	for _, tt := range casos {
		t.Run(tt.nome, func(t *testing.T) {
			exigirLista(t, h, ana, tt.query, tt.quer)
		})
	}

	// Valor de status desconhecido não vira filtro silencioso.
	rec := do(h, http.MethodGet, "/api/sessoes?status=pausada", &ana)
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "status") == "" {
		t.Fatal("422 sem detalhe de status")
	}

	// origem não numérico idem.
	rec = do(h, http.MethodGet, "/api/sessoes?origem=abc", &ana)
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "origem") == "" {
		t.Fatal("422 sem detalhe de origem")
	}
}

// ─── US4 — extensão (ramificação) ─────────────────────────────────────

func TestExtensaoCopiaContextoDaOrigem(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	origem := criarSessao(t, h, ana, map[string]any{
		"repo":               "bet-api@main",
		"contexto_md":        "decisões da origem",
		"proximos_passos_md": "1. passo da origem",
	})

	// Campos ausentes no body copiam a origem (US-4).
	filha := extender(t, h, bruno, origem.ID, "cobrir o runner também")
	if filha.ContextoMD == nil || *filha.ContextoMD != "decisões da origem" {
		t.Fatalf("contexto copiado = %v, queria o da origem", filha.ContextoMD)
	}
	if filha.ProximosPassosMD == nil || *filha.ProximosPassosMD != "1. passo da origem" {
		t.Fatalf("próximos passos copiados = %v", filha.ProximosPassosMD)
	}
	// Só contexto/próximos passos herdam; repo não.
	if filha.Repo != nil {
		t.Fatalf("repo = %v, não devia ser copiado", filha.Repo)
	}
	if filha.OrigemID == nil || *filha.OrigemID != origem.ID {
		t.Fatalf("origem_id = %v, queria %d", filha.OrigemID, origem.ID)
	}
	if filha.DonoAtual.Email != "bruno@corp" || filha.Criador.Email != "bruno@corp" {
		t.Fatalf("dono/criador = %+v/%+v, queria Bruno", filha.DonoAtual, filha.Criador)
	}
	if filha.Status != store.StatusEmAndamento {
		t.Fatalf("status da extensão = %q", filha.Status)
	}

	// Campos enviados sobrescrevem a cópia, um a um.
	rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &bruno, map[string]any{
		"titulo": "outra extensão", "objetivo": "x", "origem_id": origem.ID,
		"contexto_md": "contexto próprio",
	})
	exigirStatus(t, rec, http.StatusCreated)
	outra := decodar[sessaoJSON](t, rec)
	if outra.ContextoMD == nil || *outra.ContextoMD != "contexto próprio" {
		t.Fatalf("contexto = %v, queria o enviado no body", outra.ContextoMD)
	}
	if outra.ProximosPassosMD == nil || *outra.ProximosPassosMD != "1. passo da origem" {
		t.Fatalf("próximos passos = %v, queria a cópia", outra.ProximosPassosMD)
	}
}

func TestExtensaoEventos(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	origem := criarSessao(t, h, ana, map[string]any{"contexto_md": "ctx"})
	filha := extender(t, h, bruno, origem.ID, "cobrir o runner também")

	// extensao_criada na ORIGEM, com id e título da filha no payload.
	evOrigem := eventosDe(t, h, ana, origem.ID)
	if len(evOrigem) != 2 {
		t.Fatalf("timeline da origem = %d eventos, queria criacao + extensao_criada", len(evOrigem))
	}
	e := evOrigem[1]
	if e.Tipo != "extensao_criada" {
		t.Fatalf("tipo = %q, queria extensao_criada", e.Tipo)
	}
	if e.Autor.Email != "bruno@corp" {
		t.Fatalf("autor = %+v, queria Bruno", e.Autor)
	}
	if e.Payload["extensao_id"] != float64(filha.ID) || e.Payload["titulo"] != filha.Titulo {
		t.Fatalf("payload = %v, queria extensao_id/título da filha", e.Payload)
	}

	// criacao na filha, e a origem não ganha nada além do evento dela.
	evFilha := eventosDe(t, h, bruno, filha.ID)
	if len(evFilha) != 1 || evFilha[0].Tipo != "criacao" {
		t.Fatalf("timeline da filha = %+v, queria só criacao", evFilha)
	}
}

func TestEditarExtensaoNaoAlteraOrigem(t *testing.T) {
	agora := pinRelogio(t)
	h, _ := newTestHandler(t, nil)
	origem := criarSessao(t, h, ana, map[string]any{"contexto_md": "ctx da origem"})
	filha := extender(t, h, bruno, origem.ID, "extensão")

	*agora += 60
	rec := doCorpo(t, h, http.MethodPatch, rota(filha.ID), &bruno, map[string]any{
		"contexto_md": "ctx editado na filha", "base_atualizado_em": filha.AtualizadoEm,
	})
	exigirStatus(t, rec, http.StatusOK)

	// A origem segue intocada: conteúdo, atualizado_em e timeline.
	lida := obterSessao(t, h, ana, origem.ID)
	if lida.ContextoMD == nil || *lida.ContextoMD != "ctx da origem" {
		t.Fatalf("contexto da origem = %v, não devia mudar", lida.ContextoMD)
	}
	if lida.AtualizadoEm != t0 {
		t.Fatalf("atualizado_em da origem = %d, não devia mudar", lida.AtualizadoEm)
	}
	if n := len(eventosDe(t, h, ana, origem.ID)); n != 2 {
		t.Fatalf("timeline da origem = %d eventos, não devia crescer", n)
	}
}

func TestExtensaoOrigemInexistente(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	for _, origem := range []any{9999, 0, -1} {
		rec := doCorpo(t, h, http.MethodPost, "/api/sessoes", &bruno, map[string]any{
			"titulo": "x", "objetivo": "y", "origem_id": origem,
		})
		exigirStatus(t, rec, http.StatusUnprocessableEntity)
		if detalheDe(t, rec, "origem_id") == "" {
			t.Fatalf("origem_id %v: 422 sem detalhe de origem_id", origem)
		}
	}
}

func TestDetalheTrazOrigemExtensoes(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	origem := criarSessao(t, h, ana, nil)
	filha := extender(t, h, bruno, origem.ID, "cobrir o runner também")

	// Na origem: lista de extensões com dono (contrato).
	dOrigem := obterSessao(t, h, ana, origem.ID)
	if len(dOrigem.Extensoes) != 1 {
		t.Fatalf("extensoes = %+v, queria a filha", dOrigem.Extensoes)
	}
	if dOrigem.Extensoes[0].ID != filha.ID || dOrigem.Extensoes[0].Titulo != filha.Titulo {
		t.Fatalf("resumo da extensão = %+v", dOrigem.Extensoes[0])
	}
	if dOrigem.Extensoes[0].DonoAtual == nil || dOrigem.Extensoes[0].DonoAtual.Email != "bruno@corp" {
		t.Fatalf("dono da extensão no resumo = %+v, queria Bruno", dOrigem.Extensoes[0].DonoAtual)
	}
	if dOrigem.Origem != nil {
		t.Fatal("sessão sem origem_id não devia trazer origem")
	}

	// Na filha: resumo da origem (id/título/status, sem dono — contrato).
	dFilha := obterSessao(t, h, bruno, filha.ID)
	if dFilha.Origem == nil || dFilha.Origem.ID != origem.ID || dFilha.Origem.Titulo != origem.Titulo {
		t.Fatalf("origem no detalhe = %+v", dFilha.Origem)
	}
	if dFilha.Origem.DonoAtual != nil {
		t.Fatalf("resumo da origem = %+v, o contrato não traz dono", dFilha.Origem.DonoAtual)
	}
	if len(dFilha.Extensoes) != 0 {
		t.Fatalf("extensoes da filha = %+v, queria vazio", dFilha.Extensoes)
	}

	// Sessão sem vínculo: origem null e extensoes vazias.
	simples := criarSessao(t, h, ana, nil)
	d := obterSessao(t, h, ana, simples.ID)
	if d.Origem != nil || len(d.Extensoes) != 0 {
		t.Fatalf("detalhe simples = origem %+v, extensoes %+v", d.Origem, d.Extensoes)
	}

	// O filtro ?origem= da lista devolve as extensões da sessão.
	exigirLista(t, h, ana, fmt.Sprintf("?origem=%d", origem.ID), []int64{filha.ID})
	exigirLista(t, h, ana, fmt.Sprintf("?origem=%d", filha.ID), []int64{})
}

// ─── US5 — ciclo de vida ──────────────────────────────────────────────

func TestTransicoesValidas(t *testing.T) {
	casos := []struct {
		nome   string
		estado string
		acao   string
		prLink string
		final  string
	}{
		{"em_andamento → entregue (com pr_link)", "em_andamento", "entregar", "https://github.com/bet-api/pull/1", store.StatusEntregue},
		{"em_andamento → arquivada", "em_andamento", "arquivar", "", store.StatusArquivada},
		{"entregue → arquivada", "entregue", "arquivar", "", store.StatusArquivada},
		{"entregue → em_andamento", "entregue", "reabrir", "", store.StatusEmAndamento},
		{"arquivada → em_andamento", "arquivada", "reabrir", "", store.StatusEmAndamento},
	}
	for _, tt := range casos {
		t.Run(tt.nome, func(t *testing.T) {
			h, _ := newTestHandler(t, nil)
			sess := sessaoEmEstado(t, h, tt.estado)

			extras := map[string]any{}
			if tt.prLink != "" {
				extras["pr_link"] = tt.prLink
			}
			// Bruno aplica a transição: o dono não pode mudar.
			mudada := mudarStatus(t, h, bruno, sess.ID, tt.acao, extras)
			if mudada.Status != tt.final {
				t.Fatalf("status = %q, queria %q", mudada.Status, tt.final)
			}
			if mudada.DonoAtual.Email != "ana@corp" {
				t.Fatalf("dono = %+v, operação de status não muda o dono", mudada.DonoAtual)
			}
			if tt.prLink != "" && (mudada.PRLink == nil || *mudada.PRLink != tt.prLink) {
				t.Fatalf("pr_link = %v, queria %q", mudada.PRLink, tt.prLink)
			}

			eventos := eventosDe(t, h, bruno, sess.ID)
			e := eventos[len(eventos)-1]
			if e.Tipo != "status_mudou" {
				t.Fatalf("último evento = %q, queria status_mudou", e.Tipo)
			}
			if e.Autor.Email != "bruno@corp" {
				t.Fatalf("autor = %+v, queria Bruno", e.Autor)
			}
			if e.Payload["de"] != tt.estado || e.Payload["para"] != tt.final {
				t.Fatalf("payload = %v, queria %s→%s", e.Payload, tt.estado, tt.final)
			}
			if tt.prLink != "" && e.Payload["pr_link"] != tt.prLink {
				t.Fatalf("payload pr_link = %v, queria %q", e.Payload["pr_link"], tt.prLink)
			}
		})
	}
}

func TestTransicoesInvalidas(t *testing.T) {
	casos := []struct {
		nome   string
		estado string
		acao   string
	}{
		{"entregar arquivada", "arquivada", "entregar"},
		{"entregar entregue", "entregue", "entregar"},
		{"reabrir em andamento", "em_andamento", "reabrir"},
		{"arquivar arquivada", "arquivada", "arquivar"},
	}
	for _, tt := range casos {
		t.Run(tt.nome, func(t *testing.T) {
			h, _ := newTestHandler(t, nil)
			sess := sessaoEmEstado(t, h, tt.estado)
			antes := len(eventosDe(t, h, ana, sess.ID))

			rec := doCorpo(t, h, http.MethodPost, rotaStatus(sess.ID), &bruno, map[string]any{"acao": tt.acao})
			exigirStatus(t, rec, http.StatusUnprocessableEntity)
			if erro := erroBody(t, rec); erro["codigo"] != "transicao_invalida" {
				t.Fatalf("codigo = %v, queria transicao_invalida", erro["codigo"])
			}

			// A recusa não toca a sessão nem a timeline.
			if lida := obterSessao(t, h, ana, sess.ID); lida.Status != tt.estado {
				t.Fatalf("status = %q, não devia mudar", lida.Status)
			}
			if n := len(eventosDe(t, h, ana, sess.ID)); n != antes {
				t.Fatalf("timeline cresceu de %d para %d na transição recusada", antes, n)
			}
		})
	}
}

// pr_link só é gravado por entregar; arquivar/reabrir mantêm o que há
// (e entregar sem pr_link não inventa um).
func TestPRLinkSoPersisteEmEntregar(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	pr := "https://github.com/bet-api/pull/9"
	mudarStatus(t, h, bruno, sess.ID, "entregar", map[string]any{"pr_link": pr})
	if lida := obterSessao(t, h, ana, sess.ID); lida.PRLink == nil || *lida.PRLink != pr {
		t.Fatalf("pr_link do entregar = %v, queria %q", lida.PRLink, pr)
	}

	mudarStatus(t, h, bruno, sess.ID, "arquivar", map[string]any{"pr_link": "https://nao-grava"})
	if lida := obterSessao(t, h, ana, sess.ID); lida.PRLink == nil || *lida.PRLink != pr {
		t.Fatalf("pr_link depois do arquivar = %v, queria o anterior", lida.PRLink)
	}

	mudarStatus(t, h, bruno, sess.ID, "reabrir", map[string]any{"pr_link": "https://ainda-nada"})
	if lida := obterSessao(t, h, ana, sess.ID); lida.PRLink == nil || *lida.PRLink != pr {
		t.Fatalf("pr_link depois do reabrir = %v, queria o anterior", lida.PRLink)
	}

	outra := criarSessao(t, h, bruno, nil)
	mudarStatus(t, h, bruno, outra.ID, "entregar", nil)
	if lida := obterSessao(t, h, ana, outra.ID); lida.PRLink != nil {
		t.Fatalf("pr_link de entregar sem link = %v, queria null", lida.PRLink)
	}
}

func TestStatusRecusas(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	sess := criarSessao(t, h, ana, nil)

	// Ação desconhecida é validacao (não transicao_invalida).
	rec := doCorpo(t, h, http.MethodPost, rotaStatus(sess.ID), &bruno, map[string]any{"acao": "pausar"})
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "acao") == "" {
		t.Fatal("422 sem detalhe de acao")
	}

	// pr_link acima do limite idem.
	rec = doCorpo(t, h, http.MethodPost, rotaStatus(sess.ID), &bruno, map[string]any{
		"acao": "entregar", "pr_link": strings.Repeat("a", 501),
	})
	exigirStatus(t, rec, http.StatusUnprocessableEntity)
	if detalheDe(t, rec, "pr_link") == "" {
		t.Fatal("422 sem detalhe de pr_link")
	}

	// Sessão inexistente.
	rec = doCorpo(t, h, http.MethodPost, rotaStatus(999), &bruno, map[string]any{"acao": "entregar"})
	exigirStatus(t, rec, http.StatusNotFound)
}

// ─── Erros de transporte ──────────────────────────────────────────────

func TestCorpoQuebrado(t *testing.T) {
	h, _ := newTestHandler(t, nil)
	req := httptest.NewRequest(http.MethodPost, "/api/sessoes", strings.NewReader("{não é json"))
	req = req.WithContext(WithIdentity(req.Context(), ana))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	exigirStatus(t, rec, http.StatusBadRequest)
	if erro := erroBody(t, rec); erro["codigo"] != "validacao" {
		t.Fatalf("codigo = %v, queria validacao", erro["codigo"])
	}
}
