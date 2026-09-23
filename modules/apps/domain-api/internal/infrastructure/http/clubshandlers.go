// clubs handlers: domain-api's read surface for the FC Clubs Hub plus the
// write doors the clubs services call. Reads go straight to Postgres (the
// synchronous path). Structural writes go through /sync (the documented
// exception — the caller must know the record landed); the high-volume
// append-only ones (snapshot, anuncio) use the normal async 202 path.
package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

type ClubsHandlers struct {
	clubs domainclubs.Repository
	log   *slog.Logger
}

func NewClubsHandlers(repo domainclubs.Repository, log *slog.Logger) *ClubsHandlers {
	return &ClubsHandlers{clubs: repo, log: log}
}

// intParam reads a query param with a fallback and a ceiling — a public read
// endpoint should never let a caller ask for unbounded rows.
func intParam(r *http.Request, name string, def, max int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// page slices a fully-sorted list for the caller's `limite`/`offset`. The
// ranking endpoints build the whole list (Postgres computes the order), then
// hand back only the requested window -- so "page 3 of 129" is a slice, not a
// second query, and the last page is always reachable.
func page[T any](list []T, r *http.Request) []T {
	limit := intParam(r, "limite", 10, 100)
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			offset = n
		}
	}
	if offset >= len(list) {
		return []T{}
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	return list[offset:end]
}

// ------------------------------------------------------------------ clubes

func (h *ClubsHandlers) ListClubs(w http.ResponseWriter, r *http.Request) {
	onlyFollowed := r.URL.Query().Get("acompanhados") == "1"
	list, err := h.clubs.ListClubs(r.Context(), onlyFollowed)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubs": list, "total": len(list)})
}

// SearchClubs is the public search — tolerant of accents and case.
func (h *ClubsHandlers) SearchClubs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	list, err := h.clubs.SearchClubs(r.Context(), q)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubs": list, "total": len(list), "termo": q})
}

func (h *ClubsHandlers) GetClub(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	c, err := h.clubs.GetClub(r.Context(), id)
	if errors.Is(err, domainclubs.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "clube não encontrado"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}

	// The profile also carries the derived runs and the opponent history —
	// both need the persisted matches, not the source's window.
	if seq, err := h.clubs.RecentMatchCount(r.Context(), id); err == nil && seq > 0 {
		matches, err := h.clubs.ListMatches(r.Context(), id, "", 100)
		if err == nil {
			var win, unbeat int
			opponents := map[string]*domainclubs.Adversario{}
			var order []string
			for i, m := range matches {
				if i < 30 {
					if m.OurResult == "win" {
						win++
						unbeat++
					} else if m.OurResult == "draw" && win == 0 {
						unbeat++
					} else if i == 0 || win > 0 {
						// only extend while the run is unbroken
					}
				}
				if m.OurResult == "win" && win == i {
					// keep counting
				}
				if i < 10 {
					// Vocabulary, not letter: every other forma path
					// (withForm) and the frontend's FormChips map on
					// "vitoria"/"empate"/"derrota". Emitting "V" here made
					// the profile header render "?" for every chip while the
					// same club read correctly in the list.
					c.Form = append(c.Form, m.OurResult)
				}
				o, ok := opponents[m.AdversarioID]
				if !ok {
					o = &domainclubs.Adversario{ClubID: m.AdversarioID, Name: m.OpponentName, Tag: m.OpponentTag}
					opponents[m.AdversarioID] = o
					order = append(order, m.AdversarioID)
				}
				o.Played++
				o.Goals += m.OurGoals
				o.GoalsAgainst += m.TheirGoals
				switch m.OurResult {
				case "win":
					o.V++
				case "loss":
					o.D++
				default:
					o.E++
				}
				if m.Timestamp.After(o.LastMatch) {
					o.LastMatch = m.Timestamp
				}
			}
			// Recompute the runs properly: scan newest-first and stop at the
			// first break.
			win, unbeat = 0, 0
			for _, m := range matches {
				if m.OurResult == "win" {
					win++
					unbeat++
					continue
				}
				if m.OurResult == "draw" && win == 0 {
					unbeat++
					continue
				}
				break
			}
			c.Streak = domainclubs.Streak{Wins: win, Unbeaten: unbeat}
			for _, id := range order {
				c.Adversarios = append(c.Adversarios, *opponents[id])
			}
		}
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *ClubsHandlers) GetSquad(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	list, err := h.clubs.Squad(r.Context(), id)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": list, "total": len(list)})
}

// ---------------------------------------------------------------- partidas

func (h *ClubsHandlers) ListMatches(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	kind := r.URL.Query().Get("kind")
	limit := intParam(r, "limite", 25, 200)
	list, err := h.clubs.ListMatches(r.Context(), id, kind, limit)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"matches": list, "total": len(list)})
}

func (h *ClubsHandlers) GetMatch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "matchId")
	m, err := h.clubs.GetMatch(r.Context(), id)
	if errors.Is(err, domainclubs.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "partida não encontrada"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

func (h *ClubsHandlers) HeadToHead(w http.ResponseWriter, r *http.Request) {
	aID, bID := chi.URLParam(r, "clubId"), chi.URLParam(r, "rivalId")
	h2h, err := h.clubs.HeadToHead(r.Context(), aID, bID)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, h2h)
}

// ----------------------------------------------------------------- histórico

func (h *ClubsHandlers) GetEvolution(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	var since time.Time
	if d := r.URL.Query().Get("dias"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 {
			since = time.Now().UTC().AddDate(0, 0, -n)
		}
	}
	series, err := h.clubs.Snapshots(r.Context(), id, since)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	latest, _ := h.clubs.LatestSnapshot(r.Context(), id)
	writeJSON(w, http.StatusOK, map[string]any{
		"serie": series,
		"total": len(series),
		"current": latest,
		// Explicit so the UI can explain "history grows with every sync"
		// instead of drawing a degenerate one-point chart.
		"historico_curto": len(series) < 2,
	})
}

func (h *ClubsHandlers) GetDivisionChanges(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	changes, err := h.clubs.DivisionChanges(r.Context(), id)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mudancas": changes, "total": len(changes)})
}

func (h *ClubsHandlers) GetRecords(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	rec, err := h.clubs.Records(r.Context(), id)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// ------------------------------------------------------------------ rankings

func (h *ClubsHandlers) RankingClubs(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("metric")
	list, err := h.clubs.RankingClubs(r.Context(), metric)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	// `total` is the whole ranking, not the page: the SPA paginates and needs
	// to know where the end is. The page itself is sliced here so the caller
	// only pays for what it shows.
	total := len(list)
	list = page(list, r)
	writeJSON(w, http.StatusOK, map[string]any{"metric": metric, "clubs": list, "total": total})
}

func (h *ClubsHandlers) RankingPlayers(w http.ResponseWriter, r *http.Request) {
	metric := r.URL.Query().Get("metric")
	position := r.URL.Query().Get("position")
	list, err := h.clubs.RankingPlayers(r.Context(), metric, position)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	total := len(list)
	list = page(list, r)
	writeJSON(w, http.StatusOK, map[string]any{"metric": metric, "players": list, "total": total})
}

// ------------------------------------------------------------------ jogadores

func (h *ClubsHandlers) ListPlayers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	limit := intParam(r, "limite", 60, 300)
	list, err := h.clubs.SearchPlayers(r.Context(), q, limit)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	// `total` is the whole index, not the page: the home header asks "how many
	// players has the hub found?", and len(list) would answer "how many fit in
	// this page". The listing itself only reads `jogadores`.
	total, err := h.clubs.PlayerCount(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": list, "total": total, "termo": q})
}

func (h *ClubsHandlers) GetPlayer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "playerId")
	p, err := h.clubs.GetPlayer(r.Context(), id)
	if errors.Is(err, domainclubs.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "jogador não encontrado"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// ---------------------------------------------------------------------- feed

func (h *ClubsHandlers) ListAnnouncements(w http.ResponseWriter, r *http.Request) {
	limit := intParam(r, "limite", 12, 50)
	list, err := h.clubs.RecentAnnouncements(r.Context(), limit)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	// `total` is everything live, not just this page: the home shows the last
	// 3 in the feed, and its header must still say how many there are.
	total, err := h.clubs.AnnouncementCount(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"announcements": list, "total": total})
}

// -------------------------------------------------------------- preferências

func (h *ClubsHandlers) ListWatch(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("usuario")
	list, err := h.clubs.ListWatch(r.Context(), email)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubs": list, "total": len(list)})
}

func (h *ClubsHandlers) GetNotificacoes(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("usuario")
	p, err := h.clubs.GetNotificacoes(r.Context(), email)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *ClubsHandlers) GetClaimed(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("usuario")
	p, err := h.clubs.GetClaimed(r.Context(), email)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	if p == nil {
		writeJSON(w, http.StatusOK, map[string]any{"pro": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pro": p})
}

// ListPendingSyncs é consumida pelo worker de ingestão: devolve quem pediu
// sincronização (rodando=true, sem concluido_em). É a ponte entre o clique no
// SPA e o worker que faz a descoberta, sem os dois se conhecerem.
func (h *ClubsHandlers) ListPendingSyncs(w http.ResponseWriter, r *http.Request) {
	list, err := h.clubs.ListPendingSyncs(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pendentes": list, "total": len(list)})
}

func (h *ClubsHandlers) GetSyncRun(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("usuario")
	run, err := h.clubs.GetSyncRun(r.Context(), email)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// ListPendingFetches é consumida pelo worker de ingestão: os alvos (clube ou
// jogador) que a SPA pediu e ainda não foram buscados.
func (h *ClubsHandlers) ListPendingFetches(w http.ResponseWriter, r *http.Request) {
	list, err := h.clubs.ListPendingFetches(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pendentes": list, "total": len(list)})
}

// GetFetchRun é o estado do sync de um alvo, lido pela tela para saber quando
// o dado está pronto -- sem esperar o ciclo do worker.
//
// O alvo vem do CAMINHO (`/clubs/{id}/fetch-run` ou `/players/{id}/fetch-run`),
// e não de um parâmetro: assim o id não pode ser confundido com um tipo, e a
// rota diz por si o que está sendo sincronizado.
func (h *ClubsHandlers) GetFetchRun(w http.ResponseWriter, r *http.Request) {
	target, alvoID := alvoDoPath(r)
	run, err := h.clubs.GetFetchRun(r.Context(), target, alvoID)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// ClubsDoJogador é o que o worker consulta para saber quais clubes atualizar
// quando o pedido é um jogador.
func (h *ClubsHandlers) ClubsDoJogador(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "playerId")
	ids, err := h.clubs.ClubsDoJogador(r.Context(), id)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubs": ids, "total": len(ids)})
}

// alvoDoPath lê o (alvo, id) de uma rota de fetch-run. Os dois conjuntos de
// rotas coexistem -- clube e jogador -- e é o parâmetro presente que diz qual é.
func alvoDoPath(r *http.Request) (string, string) {
	if id := chi.URLParam(r, "playerId"); id != "" {
		return domainclubs.AlvoJogador, id
	}
	return domainclubs.AlvoClube, chi.URLParam(r, "clubId")
}

// GetSearchRun é o estado da busca ao vivo de um termo. A busca do diretório é
// local; esta é a que vai na fonte, para um clube que o hub ainda não viu.
func (h *ClubsHandlers) GetSearchRun(w http.ResponseWriter, r *http.Request) {
	termo := normalizeTermo(r.URL.Query().Get("termo"))
	run, err := h.clubs.GetSearchRun(r.Context(), termo)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// ListPendingSearches é consumida pelo worker de ingestão.
func (h *ClubsHandlers) ListPendingSearches(w http.ResponseWriter, r *http.Request) {
	list, err := h.clubs.ListPendingSearches(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pendentes": list, "total": len(list)})
}

// normalizeTermo deixa o termo comparável: minúsculo e sem espaços nas pontas.
// É a chave da fila, então "Vila " e "vila" precisam apontar para a MESMA
// linha -- senão o mesmo pedido entraria duas vezes.
func normalizeTermo(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// ------------------------------------------------------------- administração

// GetIngestEstado expõe a saúde do worker de ingestão. Ele não serve HTTP, e
// sem isto uma falha em produção (por exemplo o CDN da fonte bloqueando o IP
// do datacenter) fica invisível: o log está no container, atrás do SSH.
func (h *ClubsHandlers) GetIngestEstado(w http.ResponseWriter, r *http.Request) {
	e, err := h.clubs.IngestEstado(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (h *ClubsHandlers) AdminStatus(w http.ResponseWriter, r *http.Request) {
	st, err := h.clubs.AdminStatus(r.Context())
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ------------------------------------------------------------------ helpers

func (h *ClubsHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "clubs handler error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}

// publishClubsCommand marshals and publishes, mirroring Handlers.publish but
// living here so the clubs routes stay in one file.
func (h *ClubsHandlers) publishClubsCommand(w http.ResponseWriter, r *http.Request, publisher application.CommandPublisher, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := publisher.Publish(r.Context(), cmd); err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}
