// Package httpapi is clubs-api's interface layer.
//
// Two tiers, matching the product's "everything visible without login, login
// opt-in" design:
//
//   - PUBLIC routes (no identity): the home feed, global rankings, club and
//     player profiles, matches. A visitor with no account reads the whole
//     dataset — that is FR-001 and the point of the product.
//   - PERSONAL routes (identity required): watchlist, claimed pro,
//     notification prefs, sync status. These are the only per-person data,
//     and they are what makes logging in worth it.
//
// clubs-api has no database: every read and write goes through domain-api
// (see internal/domainclient). It never talks to the ingest worker either —
// the worker only ever writes to domain-api.
package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/domainclient"
)

// Config reúne o que o servidor precisa saber sobre identidade e CORS. Um
// struct em vez de uma lista de parâmetros posicionais: acrescentar um campo
// não muda a assinatura de quem chama.
type Config struct {
	// Origens com CORS liberado. A primeira também é o destino padrão em
	// qualquer decisão de redirect.
	AllowedOrigins []string
	// Segredo HS256 que assina o cookie de sessão. Vazio desliga a emissão
	// (login deixa de funcionar), o que é correto só em dev com a escotilha.
	SessionSecret string
	// Domínio do cookie. Vazio = host-only, que é o certo em dev
	// (localhost ignora porta, então 5173 e 8017 compartilham o cookie).
	SessionCookieDomain string
	SessionDuration     time.Duration
	// Client ID do Google OAuth que os ID tokens precisam declarar em aud.
	GoogleClientID string
	// Escotilha de dev: com ela, uma requisição sem cookie roda como este
	// e-mail. Nunca deve coexistir com um client ID configurado.
	DevUserEmail string
}

type Server struct {
	domain *domainclient.Client
	log    *slog.Logger

	origins             []string
	sessionSecret       string
	sessionCookieDomain string
	sessionDuration     time.Duration
	googleClientID      string
	devEmail            string
}

func NewServer(domain *domainclient.Client, cfg Config, log *slog.Logger) *Server {
	dur := cfg.SessionDuration
	if dur <= 0 {
		dur = sessionTTL
	}
	return &Server{
		domain:              domain,
		log:                 log,
		origins:             cfg.AllowedOrigins,
		sessionSecret:       cfg.SessionSecret,
		sessionCookieDomain: cfg.SessionCookieDomain,
		sessionDuration:     dur,
		googleClientID:      cfg.GoogleClientID,
		devEmail:            strings.ToLower(strings.TrimSpace(cfg.DevUserEmail)),
	}
}

// Handler wires every route. /healthz is public and unauthenticated so the
// deploy check (and the ingress) can reach it.
func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(s.cors)

	r.Get("/healthz", s.health)

	r.Route("/api", func(r chi.Router) {
		// --- public: no identity required -----------------------------
		r.Get("/clubs", s.listClubs)
		r.Get("/clubs/search", s.searchClubs)
		r.Get("/clubs/{clubId}", s.getClub)
		r.Get("/clubs/{clubId}/squad", s.getSquad)
		r.Get("/clubs/{clubId}/matches", s.listMatches)
		r.Get("/clubs/{clubId}/evolution", s.getEvolution)
		r.Get("/clubs/{clubId}/division-changes", s.getDivisionChanges)
		r.Get("/clubs/{clubId}/records", s.getRecords)
		r.Get("/clubs/{clubId}/h2h/{rivalId}", s.headToHead)
		r.Get("/matches/{matchId}", s.getMatch)
		r.Get("/rankings/clubs", s.rankingClubs)
		r.Get("/rankings/players", s.rankingPlayers)
		r.Get("/players", s.listPlayers)
		r.Get("/players/{playerId}", s.getPlayer)
		r.Get("/announcements", s.listAnnouncements)

		// --- personal: identity required ------------------------------
		r.Group(func(r chi.Router) {
			r.Use(s.requireIdentity)
			r.Get("/me", s.me)
			r.Get("/watchlist", s.listWatch)
			r.Post("/watchlist", s.setWatch)
			r.Get("/notifications", s.getNotifications)
			r.Post("/notifications", s.saveNotifications)
			r.Get("/claimed-pro", s.getClaimed)
			r.Post("/claimed-pro", s.claimPro)
			r.Get("/sync/status", s.syncStatus)
			r.Post("/sync", s.startSync)
			// O estado técnico é pessoal: o SPA só renderiza a aba de
			// administração para quem entrou. A restrição forte
			// (administrador de verdade) é uma decisão futura; hoje o login já
			// é opt-in e o conteúdo é agregado, não dado de outra pessoa.
			r.Get("/admin/status", s.adminStatus)
		})

		// --- auth: sessão própria, não Cloudflare Access -----------------
		// Públicas por definição: o login é justamente o que cria a sessão
		// que as rotas pessoais exigem.
		r.Post("/auth/google", s.handleAuthGoogle)
		r.Post("/auth/logout", s.handleAuthLogout)
	})
	return r
}

// cors allows the SPA's MinIO-served origin (and localhost dev) to call this
// cross-origin. An empty allowlist means no browser page can call it — the
// API still works from curl/server-to-server.
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.originAllowed(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Cf-Access-Jwt-Assertion")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) originAllowed(origin string) bool {
	for _, allowed := range s.origins {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return false
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	// Report whether persistence is wired, so a deploy check can tell
	// "running but disconnected" from "running".
	// "login_configurado" é o que diz se o login funciona: sem segredo de
	// sessão ou sem client ID, /api/auth/google recusa todo mundo, e o hub
	// fica só com a leitura pública (que continua funcionando de propósito).
	writeJSON(w, http.StatusOK, map[string]any{
		"status":            "ok",
		"persistencia":      s.domain.Enabled(),
		"login_configurado": s.AuthEnabled() && s.googleClientID != "",
	})
}

// me é a sonda de login do SPA: 200 com a identidade quando autenticado, 401
// quando não. Sem Access na frente deste host, um fetch simples basta -- não há
// redirect de edge para contornar.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"email": id.Email, "autenticado": true})
}

func (s *Server) listClubs(w http.ResponseWriter, r *http.Request) {
	only := ""
	if r.URL.Query().Get("acompanhados") == "1" {
		only = "?acompanhados=1"
	}
	s.proxyGet(w, r, "/clubs"+only)
}

func (s *Server) searchClubs(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/search?q="+domainclient.Escape(r.URL.Query().Get("q")))
}

func (s *Server) getClub(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId"))
}

func (s *Server) getSquad(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/squad")
}

func (s *Server) listMatches(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/matches?tipo="+domainclient.Escape(q.Get("tipo"))+"&limite="+limitParam(q.Get("limite"), "25"))
}

func (s *Server) getEvolution(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/evolution?dias="+limitParam(r.URL.Query().Get("dias"), ""))
}

func (s *Server) getDivisionChanges(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/division-changes")
}

func (s *Server) getRecords(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/records")
}

func (s *Server) headToHead(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/h2h/"+chi.URLParam(r, "rivalId"))
}

func (s *Server) getMatch(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/matches/"+chi.URLParam(r, "matchId"))
}

func (s *Server) rankingClubs(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/rankings/clubs?metrica="+domainclient.Escape(r.URL.Query().Get("metrica")))
}

func (s *Server) rankingPlayers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/rankings/players?metrica="+domainclient.Escape(q.Get("metrica"))+"&posicao="+domainclient.Escape(q.Get("posicao")))
}

func (s *Server) listPlayers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/players?q="+domainclient.Escape(q.Get("q"))+"&limite="+limitParam(q.Get("limite"), "60"))
}

func (s *Server) getPlayer(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/players/"+chi.URLParam(r, "playerId"))
}

func (s *Server) listAnnouncements(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/announcements?limite="+limitParam(r.URL.Query().Get("limite"), "12"))
}

// --- personal -------------------------------------------------------------

func (s *Server) listWatch(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	s.proxyGet(w, r, "/watchlist?usuario="+domainclient.Escape(id.Email))
}

func (s *Server) getNotifications(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	s.proxyGet(w, r, "/notifications?usuario="+domainclient.Escape(id.Email))
}

func (s *Server) getClaimed(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	s.proxyGet(w, r, "/claimed-pro?usuario="+domainclient.Escape(id.Email))
}

func (s *Server) syncStatus(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	s.proxyGet(w, r, "/sync-status?usuario="+domainclient.Escape(id.Email))
}

func (s *Server) setWatch(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	var body struct {
		ClubID   string `json:"club_id"`
		Seguindo *bool  `json:"seguindo"`
		Origem   string `json:"origem"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	seguindo := true
	if body.Seguindo != nil {
		seguindo = *body.Seguindo
	}
	action := "preferencia.setWatch"
	if !seguindo {
		action = "preferencia.removeWatch"
	}
	if err := s.domain.Sync(r.Context(), action, map[string]any{
		"usuario_email": id.Email, "club_id": body.ClubID, "seguindo": seguindo, "origem": body.Origem,
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"club_id": body.ClubID, "seguindo": seguindo})
}

func (s *Server) saveNotifications(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	var body struct {
		Canal             string `json:"canal"`
		ResumoPeriodico   bool   `json:"resumo_periodico"`
		RecordesEDivisoes bool   `json:"recordes_e_divisoes"`
		ResultadoPartidas bool   `json:"resultado_partidas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if err := s.domain.Sync(r.Context(), "preferencia.saveNotificacoes", map[string]any{
		"usuario_email": id.Email, "canal": body.Canal,
		"resumo_periodico": body.ResumoPeriodico, "recordes_e_divisoes": body.RecordesEDivisoes,
		"resultado_partidas": body.ResultadoPartidas,
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) claimPro(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	var body struct {
		ClubID   string `json:"club_id"`
		PlayerID string `json:"player_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if body.PlayerID == "" {
		writeError(w, http.StatusUnprocessableEntity, "player_id é obrigatório")
		return
	}
	if err := s.domain.Sync(r.Context(), "preferencia.claimPro", map[string]any{
		"usuario_email": id.Email, "club_id": body.ClubID, "player_id": body.PlayerID, "verificado": true,
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"player_id": body.PlayerID, "verificado": true})
}

// startSync kicks the worker's three-level discovery. The worker polls its
// own queue; this only records the request as a sync run the SPA can watch.
func (s *Server) startSync(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	if err := s.domain.Post(r.Context(), "/sync-status", map[string]any{
		"usuario_email": id.Email, "rodando": true, "nivel": 1, "total": 0, "concluidos": 0,
		"atual": "", "novos": []string{},
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"iniciado": true})
}

// adminStatus é o estado técnico que a área de administração desenha: quantos
// clubes o hub conhece e acompanha, volume de partidas e de leituras de nível,
// e o topo do ranking. Vem tudo de uma leitura só na base de domínio.
func (s *Server) adminStatus(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/admin/status")
}

// --- helpers --------------------------------------------------------------

func (s *Server) proxyGet(w http.ResponseWriter, r *http.Request, path string) {
	if !s.domain.Enabled() {
		// No persistence wired (local dev): serve an honest empty state
		// rather than a 500 — the UI's empty-state path is worth testing.
		writeJSON(w, http.StatusOK, map[string]any{
			"aviso": "sem persistência configurada", "clubes": []any{}, "jogadores": []any{},
			"partidas": []any{}, "anuncios": []any{}, "total": 0,
		})
		return
	}
	var out any
	if err := s.domain.Get(r.Context(), path, &out); err != nil {
		if err == domainclient.ErrNotFound {
			writeError(w, http.StatusNotFound, "não encontrado")
			return
		}
		s.log.ErrorContext(r.Context(), "proxy read", "path", path, "error", err)
		writeError(w, http.StatusBadGateway, "falha ao ler os dados")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) syncError(w http.ResponseWriter, r *http.Request, err error) {
	switch err {
	case domainclient.ErrRejected:
		writeError(w, http.StatusUnprocessableEntity, "comando recusado")
	case domainclient.ErrQueued:
		// Published but not yet confirmed — the write may still land.
		writeJSON(w, http.StatusAccepted, map[string]any{"status": "em_processamento"})
	default:
		s.log.ErrorContext(r.Context(), "sync write", "error", err)
		writeError(w, http.StatusBadGateway, "falha ao gravar")
	}
}

func limitParam(raw, def string) string {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	return strconv.Itoa(n)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"erro": msg})
}
