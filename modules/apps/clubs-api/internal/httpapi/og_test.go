package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/domainclient"
)

// Testes de integração do preview de link (Open Graph).
//
// Fronteira testada: o CLIENTE HTTP de verdade. O domain-api é substituído por
// um `httptest.Server` -- que é um servidor HTTP REAL, numa porta real, com
// decode de JSON real, não um mock que intercepta a chamada. Em Go esse é o
// upstream honesto: a coisa sob teste é "requisição HTTP -> HTML com metadados",
// e um servidor de verdade exercita exatamente isso.
//
// (Testcontainers aqui não acrescentaria: o domain-api de produção não é um
// serviço que se sobe sem banco, e o que o handler faz é um GET + decode. A
// infra real que importa -- o Postgres que responde esse GET -- é exercitada nos
// testes do domain-worker/domain-api.)

// upstreamDomain sobe um domain-api de mentira servindo os caminhos de leitura
// usados pelo OG. Devolve um *domainclient.Client apontado para ele.
func upstreamDomain(t *testing.T, routes map[string]string) *domainclient.Client {
	t.Helper()
	mux := http.NewServeMux()
	for path, body := range routes {
		body := body
		mux.HandleFunc(path, func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, body)
		})
	}
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return domainclient.New(ts.URL, "chave-de-teste")
}

func ogServer(t *testing.T, routes map[string]string, origin string) http.Handler {
	t.Helper()
	cfg := Config{PublicOrigin: origin}
	return NewServer(upstreamDomain(t, routes), cfg, slog.New(slog.NewTextHandler(io.Discard, nil))).Handler()
}

func getHTML(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

// O clube vira um cartão com nome, divisão e retrospecto -- e a URL absoluta,
// que é o que o Discord usa para buscar a imagem e o link.
func TestOGClubCarregaMetadadosEUrlAbsoluta(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/clubs/1001": `{"club_id":"1001","name":"Vila Nova FC","tag":"VNF","division":1,"played":50,"wins":30,"draws":5,"losses":15,"goals":120}`,
	}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/club/1001")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q; want text/html (um scraper não lê JSON)", ct)
	}
	body := rec.Body.String()
	for _, esperado := range []string{
		`<meta property="og:title" content="Vila Nova FC — FC Clubs Hub">`,
		`<meta property="og:url" content="https://clubs.giomartins.dev/club/1001">`,
		`Divisão 1`, // a descrição carrega o dado, não uma frase vazia
		`[VNF]`,
	} {
		if !strings.Contains(body, esperado) {
			t.Errorf("faltou no HTML: %q\n--- corpo ---\n%s", esperado, body)
		}
	}
}

// Clube que o domain-api não conhece ainda gera um preview de fallback, nunca
// um 500: um link compartilhado de um clube recém-descoberto não pode ficar
// pelado por causa de um 404 do backend.
func TestOGClubInexistenteUsaFallback(t *testing.T) {
	h := ogServer(t, map[string]string{}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/club/nao-existe")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200 (fallback, não erro)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "FC Clubs Hub") {
		t.Fatalf("sem título de fallback; corpo:\n%s", rec.Body.String())
	}
}

// A partida mostra o PLACAR no título -- é o que faz o cartão no Discord
// valer a pena clicar.
func TestOGMatchMostraOPlacar(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/matches/m-99": `{"match_id":"m-99","home_club_name":"Vila Nova FC","away_club_name":"Porto Rival","home_goals":3,"away_goals":1}`,
	}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/match/m-99")
	if !strings.Contains(rec.Body.String(), "Vila Nova FC 3–1 Porto Rival") {
		t.Fatalf("o placar não está no título. Corpo:\n%s", rec.Body.String())
	}
}

// A descrição de um jogador traz os números que dão vontade de abrir o perfil.
func TestOGJogadorMostraOsNumeros(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/players/p1": `{"player_id":"p1","gamertag":"Craque","club_name":"Vila Nova FC","played":40,"goals":21,"assists":8,"rating":8.5}`,
	}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/player/p1")
	body := rec.Body.String()
	if !strings.Contains(body, "Craque") || !strings.Contains(body, "21 gols") {
		t.Fatalf("faltou o jogador ou os números. Corpo:\n%s", body)
	}
}

// Sem PublicOrigin configurado, ainda assim monta o HTML (com URLs relativas):
// dev local não pode deixar o handler sem resposta.
func TestOGSemOrigemPublicaAindaResponde(t *testing.T) {
	h := ogServer(t, map[string]string{
		"/clubs/1": `{"club_id":"1","name":"X"}`,
	}, "")

	rec := getHTML(t, h, "/og/club/1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `content="/club/1"`) {
		t.Fatalf("esperava og:url relativo. Corpo:\n%s", rec.Body.String())
	}
}

// Um nome de clube com aspas/ângulo não pode escapar para dentro do atributo e
// quebrar o HTML (ou injetar marcação). O nome vem da fonte (EA), então é
// entrada não confiável.
func TestOGEscapaOConteudo(t *testing.T) {
	h := ogServer(t, map[string]string{
		`/clubs/1`: `{"club_id":"1","name":"<script>alert(1)</script>","tag":"X"}`,
	}, "https://clubs.giomartins.dev")

	rec := getHTML(t, h, "/og/club/1")
	body := rec.Body.String()
	if strings.Contains(body, "<script>alert(1)</script>") {
		t.Fatalf("o nome não foi escapado -- injeção de HTML no preview. Corpo:\n%s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Fatalf("esperava o nome escapado. Corpo:\n%s", body)
	}
}
