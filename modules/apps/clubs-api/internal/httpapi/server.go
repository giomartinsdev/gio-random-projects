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
		// Busca AO VIVO na fonte: a busca normal é local (só o que o hub já
		// viu). Esta é a saída para um clube que ainda não está na base --
		// quem chega novo procuraria por ele e não acharia nada.
		//
		// Registradas ANTES de /clubs/{clubId} de propósito: são caminhos
		// estáticos, e deixá-los junto do wildcard convidaria a leitura de
		// que "search-live" é um club_id.
		r.Get("/clubs/search-live", s.searchLiveStatus)
		r.Post("/clubs/search-live", s.requestSearchLive)
		r.Get("/clubs/{clubId}", s.getClub)
		r.Get("/clubs/{clubId}/squad", s.getSquad)
		// Fetch sob demanda do elenco: a tela de resgate pede e polla o
		// estado. PÚBLICO de propósito -- a pessoa decide o clube antes de
		// entrar, e o dado do elenco é o mesmo dataset público.
		r.Get("/clubs/{clubId}/fetch-run", s.getFetchRun)
		r.Post("/clubs/{clubId}/fetch-run", s.requestFetch)
		r.Get("/clubs/{clubId}/matches", s.listMatches)
		r.Get("/clubs/{clubId}/evolution", s.getEvolution)
		r.Get("/clubs/{clubId}/division-changes", s.getDivisionChanges)
		r.Get("/clubs/{clubId}/records", s.getRecords)
		r.Get("/records/global", s.getGlobalRecords)
		r.Get("/clubs/{clubId}/h2h/{rivalId}", s.headToHead)
		r.Get("/matches/{matchId}", s.getMatch)
		r.Get("/rankings/clubs", s.rankingClubs)
		r.Get("/rankings/players", s.rankingPlayers)
		r.Get("/players", s.listPlayers)
		r.Get("/players/{playerId}", s.getPlayer)
		// Sync sob demanda de um JOGADOR. Público pelo mesmo motivo do clube:
		// a pessoa quer forçar a atualização do que está olhando, e o dado do
		// jogador é derivado das partidas dos clubes dele.
		r.Get("/players/{playerId}/fetch-run", s.getFetchRunJogador)
		r.Post("/players/{playerId}/fetch-run", s.requestFetchJogador)
		// O worker Python consulta quais clubes atualizar quando o pedido é um
		// jogador. Público como o resto do dataset.
		r.Get("/players/{playerId}/clubs", s.clubsDoJogador)
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
			// Saúde do worker de ingestão: ele não tem host próprio, então é
			// por aqui que "está coletando?" e "qual foi o último erro?"
			// chegam ao painel.
			r.Get("/admin/ingest", s.ingestStatus)
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

// getFetchRun lê o estado do fetch sob demanda do elenco de um clube.
func (s *Server) getFetchRun(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/fetch-run")
}

// requestFetch abre a fila de sync do elenco de um clube. Público: a pessoa
// escolhe o clube antes de entrar, e o worker traz o elenco para ela escolher
// o próprio pro. A resposta é 202 -- a busca acontece em segundo plano.
func (s *Server) requestFetch(w http.ResponseWriter, r *http.Request) {
	if err := s.domain.Post(r.Context(), "/clubs/"+chi.URLParam(r, "clubId")+"/fetch-run", nil); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"iniciado": true})
}

// getFetchRunJogador lê o estado do sync de um jogador.
func (s *Server) getFetchRunJogador(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/players/"+chi.URLParam(r, "playerId")+"/fetch-run")
}

// requestFetchJogador abre a fila de sync de um jogador. Público pelo mesmo
// motivo do clube: a pessoa quer forçar a atualização do que está olhando. O
// trabalho real é atualizar as partidas dos clubes onde ele jogou -- a fonte
// não tem endpoint de jogador.
func (s *Server) requestFetchJogador(w http.ResponseWriter, r *http.Request) {
	if err := s.domain.Post(r.Context(), "/players/"+chi.URLParam(r, "playerId")+"/fetch-run", nil); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"iniciado": true})
}

// clubsDoJogador: os clubes onde um jogador apareceu -- o que o worker consulta
// para traduzir "syncar jogador" em trabalho.
func (s *Server) clubsDoJogador(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/players/"+chi.URLParam(r, "playerId")+"/clubs")
}

// searchLiveStatus lê o estado da busca ao vivo de um termo. A SPA polla isto
// depois de pedir, e mostra os clubes quando o worker termina.
func (s *Server) searchLiveStatus(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/search-run?termo="+domainclient.Escape(r.URL.Query().Get("termo")))
}

// requestSearchLive pede uma busca ao vivo na fonte. Público pelo mesmo motivo
// do fetch: a pessoa procura o próprio clube antes de entrar, e a busca local
// só conhece o que o hub já viu. 202 -- a consulta vai no CDN, em segundo plano.
func (s *Server) requestSearchLive(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Termo string `json:"termo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if len([]rune(body.Termo)) < 2 {
		writeError(w, http.StatusUnprocessableEntity, "termo precisa de ao menos 2 letras")
		return
	}
	if err := s.domain.Post(r.Context(), "/search-run", map[string]any{"termo": body.Termo}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"iniciado": true})
}

func (s *Server) listMatches(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/matches?kind="+domainclient.Escape(q.Get("kind"))+"&limite="+limitParam(q.Get("limite"), "25"))
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

func (s *Server) getGlobalRecords(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/records/global")
}

func (s *Server) headToHead(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/clubs/"+chi.URLParam(r, "clubId")+"/h2h/"+chi.URLParam(r, "rivalId"))
}

func (s *Server) getMatch(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/matches/"+chi.URLParam(r, "matchId"))
}

func (s *Server) rankingClubs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/rankings/clubs?metric="+domainclient.Escape(q.Get("metric"))+
		"&limite="+limitParam(q.Get("limite"), "10")+"&offset="+limitParam(q.Get("offset"), "0"))
}

func (s *Server) rankingPlayers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	s.proxyGet(w, r, "/rankings/players?metric="+domainclient.Escape(q.Get("metric"))+"&position="+domainclient.Escape(q.Get("position"))+
		"&limite="+limitParam(q.Get("limite"), "10")+"&offset="+limitParam(q.Get("offset"), "0"))
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
		Source   string `json:"source"`
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
		"user_email": id.Email, "club_id": body.ClubID, "seguindo": seguindo, "source": body.Source,
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"club_id": body.ClubID, "seguindo": seguindo})
}

func (s *Server) saveNotifications(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	var body struct {
		Channel             string `json:"channel"`
		WeeklyDigest   bool   `json:"weekly_digest"`
		RecordsAndDivisions bool   `json:"records_and_divisions"`
		MatchResults bool   `json:"match_results"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}
	if err := s.domain.Sync(r.Context(), "preferencia.saveNotificacoes", map[string]any{
		"user_email": id.Email, "channel": body.Channel,
		"weekly_digest": body.WeeklyDigest, "records_and_divisions": body.RecordsAndDivisions,
		"match_results": body.MatchResults,
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
		"user_email": id.Email, "club_id": body.ClubID, "player_id": body.PlayerID, "verified": true,
	}); err != nil {
		s.syncError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"player_id": body.PlayerID, "verified": true})
}

// startSync kicks the worker's three-level discovery. The worker polls its
// own queue; this only records the request as a sync run the SPA can watch.
func (s *Server) startSync(w http.ResponseWriter, r *http.Request) {
	id, _ := IdentityFrom(r.Context())
	if err := s.domain.Post(r.Context(), "/sync-status", map[string]any{
		"user_email": id.Email, "running": true, "skill_rating": 1, "total": 0, "completed": 0,
		"current": "", "new_items": []string{},
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

// ingestStatus encaminha a saúde do worker. É o diagnóstico de fora: sem isto,
// uma falha do coletor em produção só aparece via SSH no container.
func (s *Server) ingestStatus(w http.ResponseWriter, r *http.Request) {
	s.proxyGet(w, r, "/admin/ingest")
}

// --- helpers --------------------------------------------------------------

func (s *Server) proxyGet(w http.ResponseWriter, r *http.Request, path string) {
	if !s.domain.Enabled() {
		// No persistence wired (local dev): serve an honest empty state
		// rather than a 500 — the UI's empty-state path is worth testing.
		writeJSON(w, http.StatusOK, map[string]any{
			"aviso": "sem persistência configurada", "clubs": []any{}, "players": []any{},
			"matches": []any{}, "announcements": []any{}, "total": 0,
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
	writeJSON(w, status, map[string]string{"error": msg})
}
