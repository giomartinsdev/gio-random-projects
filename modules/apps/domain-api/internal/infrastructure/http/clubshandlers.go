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

// ------------------------------------------------------------------ clubes

func (h *ClubsHandlers) ListClubs(w http.ResponseWriter, r *http.Request) {
	onlyFollowed := r.URL.Query().Get("acompanhados") == "1"
	list, err := h.clubs.ListClubs(r.Context(), onlyFollowed)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubes": list, "total": len(list)})
}

// SearchClubs is the public search — tolerant of accents and case.
func (h *ClubsHandlers) SearchClubs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	list, err := h.clubs.SearchClubs(r.Context(), q)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubes": list, "total": len(list), "termo": q})
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
					if m.NossoResultado == "vitoria" {
						win++
						unbeat++
					} else if m.NossoResultado == "empate" && win == 0 {
						unbeat++
					} else if i == 0 || win > 0 {
						// only extend while the run is unbroken
					}
				}
				if m.NossoResultado == "vitoria" && win == i {
					// keep counting
				}
				if i < 10 {
					c.Forma = append(c.Forma, resultLetter(m.NossoResultado))
				}
				o, ok := opponents[m.AdversarioID]
				if !ok {
					o = &domainclubs.Adversario{ClubID: m.AdversarioID, Nome: m.AdversarioNome, Sigla: m.AdversarioSigla}
					opponents[m.AdversarioID] = o
					order = append(order, m.AdversarioID)
				}
				o.Jogos++
				o.Gols += m.NossosGols
				o.GolsContra += m.GolsDeles
				switch m.NossoResultado {
				case "vitoria":
					o.V++
				case "derrota":
					o.D++
				default:
					o.E++
				}
				if m.Timestamp.After(o.UltimoJogo) {
					o.UltimoJogo = m.Timestamp
				}
			}
			// Recompute the runs properly: scan newest-first and stop at the
			// first break.
			win, unbeat = 0, 0
			for _, m := range matches {
				if m.NossoResultado == "vitoria" {
					win++
					unbeat++
					continue
				}
				if m.NossoResultado == "empate" && win == 0 {
					unbeat++
					continue
				}
				break
			}
			c.Sequencia = domainclubs.Sequencia{Vitorias: win, Invicta: unbeat}
			for _, id := range order {
				c.Adversarios = append(c.Adversarios, *opponents[id])
			}
		}
	}
	writeJSON(w, http.StatusOK, c)
}

func resultLetter(r string) string {
	switch r {
	case "vitoria":
		return "V"
	case "derrota":
		return "D"
	default:
		return "E"
	}
}

func (h *ClubsHandlers) GetSquad(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	list, err := h.clubs.Squad(r.Context(), id)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"jogadores": list, "total": len(list)})
}

// ---------------------------------------------------------------- partidas

func (h *ClubsHandlers) ListMatches(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "clubId")
	tipo := r.URL.Query().Get("tipo")
	limit := intParam(r, "limite", 25, 200)
	list, err := h.clubs.ListMatches(r.Context(), id, tipo, limit)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"partidas": list, "total": len(list)})
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
		"atual": latest,
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
	metrica := r.URL.Query().Get("metrica")
	list, err := h.clubs.RankingClubs(r.Context(), metrica)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrica": metrica, "clubes": list, "total": len(list)})
}

func (h *ClubsHandlers) RankingPlayers(w http.ResponseWriter, r *http.Request) {
	metrica := r.URL.Query().Get("metrica")
	posicao := r.URL.Query().Get("posicao")
	list, err := h.clubs.RankingPlayers(r.Context(), metrica, posicao)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metrica": metrica, "jogadores": list, "total": len(list)})
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
	writeJSON(w, http.StatusOK, map[string]any{"jogadores": list, "total": len(list), "termo": q})
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
	writeJSON(w, http.StatusOK, map[string]any{"anuncios": list, "total": len(list)})
}

// -------------------------------------------------------------- preferências

func (h *ClubsHandlers) ListWatch(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("usuario")
	list, err := h.clubs.ListWatch(r.Context(), email)
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"clubes": list, "total": len(list)})
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

// ------------------------------------------------------------- administração

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
