package httpapi

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/domainclient"
)

// Preview de link (Open Graph) para as páginas de detalhe.
//
// O problema que isto resolve: o SPA é estático, servido do MinIO, e o cartão
// de preview que Discord/WhatsApp/X desenham vem do HTML cru -- nenhum deles
// roda JavaScript. Sem isto, TODO link de clube/partida/jogador compartilhado
// aparece sem título, sem descrição e sem imagem. Numa comunidade que vive de
// link em Discord, isso é a diferença entre um cartão que convida ao clique e
// um link pelado.
//
// A solução: o nginx do ingress roteia requisições de crawler (pelo
// User-Agent) para cá; humanos continuam recebendo o SPA normal. Este handler
// lê o dado do domain-api (a mesma leitura pública do /api) e devolve um HTML
// mínimo com as meta tags certas, redirecionando o visitante real para a
// página do SPA. Para um crawler, o corpo com as metas é tudo que importa.
//
// Os valores são escapados com html/template? Não -- usamos `html.EscapeString`
// explicitamente para manter o handler pequeno e o escape óbvio; nada aqui é
// HTML controlado pelo usuário além de nomes de clube/jogador, e todo campo
// passa pelo escape.

type ogData struct {
	Title       string
	Description string
	// Path é o caminho do SPA para onde um humano deve ser levado (o crawler
	// ignora). Sempre um caminho relativo.
	Path string
	// Image é uma URL absoluta ou vazia. Vazia = sem og:image (o cartão ainda
	// usa título e descrição).
	Image string
	// Kind é "website" ou "article" -- o og:type.
	Kind string
}

func (s *Server) ogClub(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	var club struct {
		Name     string `json:"name"`
		Tag      string `json:"tag"`
		Division int    `json:"division"`
		Played   int    `json:"played"`
		Wins     int    `json:"wins"`
		Draws    int    `json:"draws"`
		Losses   int    `json:"losses"`
		Goals    int    `json:"goals"`
	}
	if !s.readInto(r.Context(), "/clubs/"+id, &club) {
		// Sem dado: ainda assim devolvemos uma página com fallback, para o
		// link nunca ficar totalmente pelado.
		s.writeOG(w, r, ogData{
			Title:       "FC Clubs Hub",
			Description: "Perfil, elenco e histórico do clube no FC Clubs Hub.",
			Path:        "/club/" + id,
			Kind:        "article",
		})
		return
	}
	nome := strings.TrimSpace(club.Name)
	if nome == "" {
		nome = "Clube " + id
	}
	desc := fmt.Sprintf("%d jogos · %dV %dE %dD", club.Played, club.Wins, club.Draws, club.Losses)
	if club.Division > 0 {
		desc = fmt.Sprintf("Divisão %d · %s", club.Division, desc)
	}
	if club.Tag != "" {
		desc = "[" + club.Tag + "] " + desc
	}
	s.writeOG(w, r, ogData{
		Title:       nome + " — FC Clubs Hub",
		Description: desc,
		Path:        "/club/" + id,
		Kind:        "article",
	})
}

func (s *Server) ogPlayer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "playerId")
	var p struct {
		Gamertag string  `json:"gamertag"`
		ClubName string  `json:"club_name"`
		Played   int     `json:"played"`
		Goals    int     `json:"goals"`
		Assists  int     `json:"assists"`
		Rating   float64 `json:"rating"`
	}
	if !s.readInto(r.Context(), "/players/"+id, &p) {
		s.writeOG(w, r, ogData{
			Title:       "FC Clubs Hub",
			Description: "Perfil do jogador no FC Clubs Hub.",
			Path:        "/player/" + id,
			Kind:        "article",
		})
		return
	}
	nome := strings.TrimSpace(p.Gamertag)
	if nome == "" {
		nome = "Jogador " + id
	}
	desc := fmt.Sprintf("%d jogos · %d gols · %d assistências", p.Played, p.Goals, p.Assists)
	if p.ClubName != "" {
		desc = p.ClubName + " · " + desc
	}
	s.writeOG(w, r, ogData{
		Title:       nome + " — FC Clubs Hub",
		Description: desc,
		Path:        "/player/" + id,
		Kind:        "article",
	})
}

func (s *Server) ogMatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "matchId")
	var m struct {
		HomeClubName string `json:"home_club_name"`
		AwayClubName string `json:"away_club_name"`
		HomeGoals    int    `json:"home_goals"`
		AwayGoals    int    `json:"away_goals"`
	}
	if !s.readInto(r.Context(), "/matches/"+id, &m) {
		s.writeOG(w, r, ogData{
			Title:       "FC Clubs Hub",
			Description: "Partida no FC Clubs Hub.",
			Path:        "/match/" + id,
			Kind:        "article",
		})
		return
	}
	title := fmt.Sprintf("%s %d–%d %s", m.HomeClubName, m.HomeGoals, m.AwayGoals, m.AwayClubName)
	s.writeOG(w, r, ogData{
		Title:       strings.TrimSpace(title) + " — FC Clubs Hub",
		Description: "Placar, elenco e destaques da partida, no FC Clubs Hub.",
		Path:        "/match/" + id,
		Kind:        "article",
	})
}

// readInto busca um caminho do domain-api e decodifica em out. Devolve false
// quando não há persistência, o recurso não existe, ou a leitura falhou -- o
// chamador usa o fallback. Nunca devolve erro para o handler: o preview é um
// extra, e um clube inexistente não pode virar 500 no cartão do link.
func (s *Server) readInto(ctx context.Context, path string, out any) bool {
	if !s.domain.Enabled() {
		return false
	}
	if err := s.domain.Get(ctx, path, out); err != nil {
		if err != domainclient.ErrNotFound {
			s.log.ErrorContext(ctx, "og read", "path", path, "error", err)
		}
		return false
	}
	return true
}

// writeOG escreve a página mínima de preview. O corpo inclui um redirect do
// lado do cliente para o SPA: um crawler não o executa (e só lê as metas), e um
// humano que caia aqui por engano (User-Agent quebrado, clique direto) é levado
// ao app em vez de ver HTML pelado.
func (s *Server) writeOG(w http.ResponseWriter, r *http.Request, d ogData) {
	abs := func(path string) string {
		if s.publicOrigin == "" {
			return path
		}
		return s.publicOrigin + path
	}
	esc := htmlEscape
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Cache curto: o preview muda quando o clube joga. Um minuto é suficiente
	// para absorver uma rajada de crawlers (o bot do Discord bate várias vezes)
	// sem servir um placar velho por muito tempo.
	w.Header().Set("Cache-Control", "public, max-age=60")
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>%s</title>
<meta name="description" content="%s">
<link rel="canonical" href="%s">
<meta property="og:type" content="%s">
<meta property="og:site_name" content="FC Clubs Hub">
<meta property="og:title" content="%s">
<meta property="og:description" content="%s">
<meta property="og:url" content="%s">
%s<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%s">
<meta name="twitter:description" content="%s">
</head>
<body>
<script>location.replace(%q)</script>
<p>%s</p>
</body>
</html>`,
		esc(d.Title), esc(d.Description), esc(abs(d.Path)),
		esc(d.Kind),
		esc(d.Title), esc(d.Description), esc(abs(d.Path)),
		ogImageTag(abs(d.Image)),
		esc(d.Title), esc(d.Description),
		d.Path, esc(d.Title),
	)
}

// ogImageTag monta a tag og:image só quando há imagem. Uma tag com src vazio
// faz alguns scrapers desistirem do cartão inteiro.
func ogImageTag(image string) string {
	if image == "" {
		return ""
	}
	return fmt.Sprintf("<meta property=\"og:image\" content=\"%s\">\n", htmlEscape(image))
}

func htmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	// xml.EscapeText não escapa aspas simples/duplas em texto, mas o conteúdo
	// vai em atributos; cobrimos aspas explicitamente.
	out := b.String()
	out = strings.ReplaceAll(out, `"`, "&#34;")
	out = strings.ReplaceAll(out, `'`, "&#39;")
	return out
}
