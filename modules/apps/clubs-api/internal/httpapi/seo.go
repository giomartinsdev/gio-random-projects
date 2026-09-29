package httpapi

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/domainclient"
)

// SEO: sitemap.xml e robots.txt.
//
// Por que existem: o hub é uma SPA -- para um buscador, TODAS as rotas são o
// mesmo index.html sem conteúdo próprio (a menos que ele execute JS, o que nem
// todo crawler faz). Sem um sitemap, o Google não descobre os clubes e jogadores
// reais que o hub conhece, e cada link compartilhado que poderia virar busca
// orgânica não vira. O sitemap é a lista explícita dessas páginas.
//
// A lista é gerada da base (clubes e jogadores conhecidos), não escrita à mão:
// cresce sozinha conforme o hub descobre clubes.

// sitemapURL é uma <url> do sitemap. As tags seguem o schema do sitemaps.org.
type sitemapURL struct {
	Loc        string `xml:"loc"`
	ChangeFreq string `xml:"changefreq,omitempty"`
	Priority   string `xml:"priority,omitempty"`
}

type sitemapURLSet struct {
	XMLName xml.Name     `xml:"urlset"`
	Xmlns   string       `xml:"xmlns,attr"`
	URLs    []sitemapURL `xml:"url"`
}

// robotsTxt é estático, mas aponta para o sitemap no host certo.
func (s *Server) robots(w http.ResponseWriter, r *http.Request) {
	base := s.publicOrigin
	if base == "" {
		base = "https://clubs.giomartins.dev"
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = fmt.Fprintf(w, "User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n", base)
}

// sitemap lista as páginas indexáveis: a home, os clubes e os jogadores. As
// partidas ficam de fora por ora -- são milhares e mudam de valor com o tempo;
// dá para acrescentar quando a base estabilizar.
func (s *Server) sitemap(w http.ResponseWriter, r *http.Request) {
	base := s.publicOrigin
	if base == "" {
		base = "https://clubs.giomartins.dev"
	}
	set := sitemapURLSet{
		Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9",
		URLs: []sitemapURL{
			{Loc: base + "/", ChangeFreq: "daily", Priority: "1.0"},
			{Loc: base + "/clubs", ChangeFreq: "daily", Priority: "0.9"},
			{Loc: base + "/players", ChangeFreq: "daily", Priority: "0.8"},
		},
	}

	// Clubes: a lista inteira (o diretório não pagina).
	if clubs, err := s.fetchList(r.Context(), "/clubs", "clubs"); err == nil {
		for _, c := range clubs {
			id := str(c["club_id"])
			if id == "" {
				continue
			}
			set.URLs = append(set.URLs, sitemapURL{
				Loc: base + "/club/" + escapePath(id), ChangeFreq: "daily", Priority: "0.7",
			})
		}
	}
	// Jogadores: limite alto -- o sitemap é justamente onde vale listar muitos.
	if players, err := s.fetchList(r.Context(), "/players?limite=300", "players"); err == nil {
		for _, p := range players {
			id := str(p["player_id"])
			if id == "" {
				continue
			}
			set.URLs = append(set.URLs, sitemapURL{
				Loc: base + "/player/" + escapePath(id), ChangeFreq: "weekly", Priority: "0.6",
			})
		}
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	if err := enc.Encode(set); err != nil {
		s.log.WarnContext(r.Context(), "sitemap encode", "error", err)
	}
}

// fetchList lê uma lista do domain-api e devolve os itens da chave dada. Falha
// em silêncio (lista vazia): o sitemap é um extra e não pode derrubar a rota.
func (s *Server) fetchList(ctx context.Context, path, key string) ([]map[string]any, error) {
	if !s.domain.Enabled() {
		return nil, domainclient.ErrNotFound
	}
	var body map[string]any
	if err := s.domain.Get(ctx, path, &body); err != nil {
		return nil, err
	}
	raw, ok := body[key].([]any)
	if !ok {
		return nil, nil
	}
	out := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// escapePath faz o escape de um segmento de caminho -- ids da fonte podem ter
// caracteres que precisam de codificação na URL.
func escapePath(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, " ", "%20"), "#", "%23")
}
