package httpapi

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

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
		Image:       "/og/club/" + id + "/image.png",
		Kind:        "article",
	})
}

// ogClubImage gera o PNG do cartão do clube. É a imagem que o og:image aponta;
// o crawler a busca separadamente, DEPOIS de ler o HTML.
//
// Sempre responde um PNG -- se o clube não existe, um cartão genérico. Um 404
// faria o scraper mostrar link sem imagem; um cartão genérico ainda identifica o
// hub.
func (s *Server) ogClubImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	var club struct {
		Name     string `json:"name"`
		Tag      string `json:"tag"`
		Division int    `json:"division"`
		Played   int    `json:"played"`
		Wins     int    `json:"wins"`
		Draws    int    `json:"draws"`
		Losses   int    `json:"losses"`
	}
	if !s.readInto(r.Context(), "/clubs/"+id, &club) {
		club.Name = "FC Clubs Hub"
		club.Tag = "FC"
	}
	if strings.TrimSpace(club.Name) == "" {
		club.Name = "Clube " + id
	}
	if strings.TrimSpace(club.Tag) == "" {
		club.Tag = "FC"
	}

	png, err := drawCard(club.Name, club.Tag, club.Division, club.Played, club.Wins, club.Draws, club.Losses)
	if err != nil {
		s.log.ErrorContext(r.Context(), "og image", "club", id, "error", err)
		http.Error(w, "erro ao gerar a imagem", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	// Cache mais longo que o HTML (o escudo muda pouco): um dia absorve a
	// rajada de crawlers sem servir um cartão de semanas atrás.
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if _, err := w.Write(png); err != nil {
		s.log.WarnContext(r.Context(), "og image write", "club", id, "error", err)
	}
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
	m, ok := s.readMatch(r.Context(), id)
	if !ok {
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
		Image:       "/og/match/" + id + "/image.png",
		Kind:        "article",
	})
}

// matchPayload é o que a súmula precisa da partida. Um tipo só para o HTML de
// preview e para o PNG -- os dois leem o mesmo payload.
type matchPayload struct {
	HomeClubID       string `json:"home_club_id"`
	AwayClubID       string `json:"away_club_id"`
	HomeClubName     string `json:"home_club_name"`
	HomeClubTag      string `json:"home_club_tag"`
	AwayClubName     string `json:"away_club_name"`
	AwayClubTag      string `json:"away_club_tag"`
	HomeGoals        int    `json:"home_goals"`
	AwayGoals        int    `json:"away_goals"`
	Kind             string `json:"kind"`
	PlayoffRound     string `json:"playoff_round"`
	DecidedByForfeit bool   `json:"decided_by_forfeit"`
	Timestamp        string `json:"timestamp"`
	Players          []struct {
		ClubID   string  `json:"club_id"`
		Gamertag string  `json:"gamertag"`
		Rating   float64 `json:"rating"`
		Goals    int     `json:"goals"`
		Assists  int     `json:"assists"`
	} `json:"players"`
}

// readMatch lê a partida do domain-api. Devolve false quando não há persistência
// ou o recurso não existe.
func (s *Server) readMatch(ctx context.Context, id string) (matchPayload, bool) {
	var m matchPayload
	if !s.readInto(ctx, "/matches/"+id, &m) {
		return m, false
	}
	return m, true
}

// matchImage gera o PNG da súmula. É o og:image da partida E o arquivo que a
// tela baixa -- mesmo desenho, um gerador só.
func (s *Server) matchImage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "matchId")
	m, ok := s.readMatch(r.Context(), id)
	if !ok {
		// Sem partida, um cartão genérico: um 404 daria preview sem imagem.
		m = matchPayload{HomeClubName: "FC Clubs Hub", HomeClubTag: "FC", AwayClubName: "—", AwayClubTag: "—"}
	}

	// O melhor em campo, de qualquer lado, e a que clube pertence.
	bestName, bestRating, bestClub := "", 0.0, ""
	for _, p := range m.Players {
		if p.Rating > bestRating {
			bestRating = p.Rating
			bestName = p.Gamertag
			if p.ClubID == m.HomeClubID {
				bestClub = m.HomeClubName
			} else {
				bestClub = m.AwayClubName
			}
		}
	}

	var when time.Time
	if t, err := time.Parse(time.RFC3339, m.Timestamp); err == nil {
		when = t
	}

	png, err := drawMatchCard(matchCard{
		HomeName: m.HomeClubName, HomeTag: m.HomeClubTag,
		AwayName: m.AwayClubName, AwayTag: m.AwayClubTag,
		HomeGoals: m.HomeGoals, AwayGoals: m.AwayGoals,
		Kind: m.Kind, PlayoffRound: m.PlayoffRound, DecidedByForfeit: m.DecidedByForfeit,
		When: when, BestGamertag: bestName, BestRating: bestRating, BestClub: bestClub,
	})
	if err != nil {
		s.log.ErrorContext(r.Context(), "imagem da partida", "match", id, "error", err)
		http.Error(w, "erro ao gerar a imagem", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	if _, err := w.Write(png); err != nil {
		s.log.WarnContext(r.Context(), "imagem da partida write", "match", id, "error", err)
	}
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
	// A imagem é servida por ESTA API, não pelo SPA -- então a URL absoluta usa
	// a origem da API. Sem isto, o og:image apontaria para o host do SPA, que
	// não roteia /og/... e o cartão sairia sem imagem.
	absImage := func(path string) string {
		if s.apiOrigin == "" {
			return path
		}
		return s.apiOrigin + path
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
		ogImageTag(absImage(d.Image)),
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
