package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter wires every route. /healthz and the API docs stay public
// (no key, no rate limit) — everything under /users, /posts, /rooms,
// /messages, /deals, /cch, and /sync requires the apiKey security
// scheme (see openapi.yaml and Secure in middleware.go). /posts/id/{id}
// is not for public browsing -- see PostHandlers.GetPostByID's own doc
// comment. /sync is the synchronous-write exception -- see
// SyncHandlers.Sync's doc comment before reaching for it.
func NewRouter(h *Handlers, p *PostHandlers, rm *RoomHandlers, msg *MessageHandlers, dl *DealHandlers, sse *SSEHandlers, cch *CCHHandlers, sync *SyncHandlers, ct *ContaHandlers, tr *TransacaoHandlers, at *AtivoHandlers, ap *ApostaHandlers, dash *DashboardLayoutHandlers, cl *ClubsHandlers, clw *ClubsWriteHandlers, keys APIKeys, limiter *IPRateLimiter, log *slog.Logger) http.Handler {
	r := chi.NewRouter()

	r.Get("/healthz", h.Healthz)
	r.Get("/openapi.yaml", ServeOpenAPISpec)
	r.Get("/docs", ServeDocs)

	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return Secure(next, keys, limiter, log)
		})
		r.Get("/users", h.ListUsers)
		r.Post("/users", h.CreateUser)
		r.Get("/users/{id}", h.GetUser)
		r.Put("/users/{id}", h.UpdateUser)
		r.Delete("/users/{id}", h.DeleteUser)

		r.Get("/posts", p.ListPosts)
		r.Post("/posts", p.CreatePost)
		r.Get("/posts/slug/{slug}", p.GetPostBySlug)
		r.Get("/posts/id/{id}", p.GetPostByID)
		r.Get("/posts/author/{id}", p.ListPostsByAuthor)
		r.Put("/posts/{id}", p.UpdatePost)
		r.Delete("/posts/{id}", p.DeletePost)

		r.Get("/rooms", rm.ListRooms)
		r.Post("/rooms", rm.CreateRoom)
		r.Get("/rooms/{id}", rm.GetRoom)
		r.Put("/rooms/{id}", rm.UpdateRoom)
		r.Delete("/rooms/{id}", rm.DeleteRoom)
		r.Get("/rooms/{id}/events", sse.StreamRoomEvents)

		r.Get("/messages", msg.ListMessages)
		r.Post("/messages", msg.CreateMessage)

		r.Post("/deals", dl.CreateDeal)
		r.Get("/deals", dl.ListDeals)
		r.Get("/deals/{source}/{sourceDealID}", dl.GetDeal)

		// cch-api's boot load + its write doors: structural writes go
		// through /sync (the documented exception), the cosmetic play
		// count through the normal async 202 pattern.
		r.Get("/cch/rooms", cch.ListCCHRooms)
		r.Get("/cch/decks", cch.ListCCHDecks)
		r.Post("/cch/decks/{id}/plays", cch.PlayCCHDeck)
		r.Post("/sync", sync.Sync)

		// Gestão financeira modular (specs/002) -- conta and
		// dashboardlayout are read-only here (writes go through /sync
		// above); transacao and ativo's quote update get dedicated async
		// 202 routes, same pattern as /rooms.
		r.Get("/contas", ct.ListContas)
		r.Get("/contas/{id}", ct.GetConta)

		r.Get("/transacoes", tr.ListTransacoes)
		r.Post("/transacoes", tr.CreateTransacao)
		r.Patch("/transacoes/{id}", tr.UpdateTransacao)
		r.Delete("/transacoes/{id}", tr.DeleteTransacao)

		r.Get("/ativos", at.ListAtivos)
		r.Get("/ativos/todos", at.ListTodosAtivos)
		r.Get("/ativos/{id}/movimentos", at.GetAtivoMovimentos)
		r.Post("/ativos/{id}/cotacao", at.UpdateAtivoQuote)

		r.Get("/apostas", ap.ListApostas)
		r.Get("/apostas/pendentes", ap.ListApostasPendentes)
		r.Get("/apostas/{id}", ap.GetAposta)

		r.Get("/dashboardlayouts/{usuario}", dash.GetDashboardLayout)

		// FC Clubs Hub (specs/003). Reads are public data + per-person
		// preferences; writes are the doors the clubs services call --
		// structural ones ride /sync above, append-only ones (snapshot,
		// anuncio) use the normal async 202 path.
		r.Get("/clubs", cl.ListClubs)
		r.Get("/clubs/search", cl.SearchClubs)
		r.Get("/clubs/{clubId}", cl.GetClub)
		r.Get("/clubs/{clubId}/squad", cl.GetSquad)
		r.Get("/clubs/{clubId}/matches", cl.ListMatches)
		r.Get("/clubs/{clubId}/evolution", cl.GetEvolution)
		r.Get("/clubs/{clubId}/division-changes", cl.GetDivisionChanges)
		r.Get("/clubs/{clubId}/records", cl.GetRecords)
		r.Get("/clubs/{clubId}/h2h/{rivalId}", cl.HeadToHead)
		r.Get("/matches/{matchId}", cl.GetMatch)
		r.Get("/rankings/clubs", cl.RankingClubs)
		r.Get("/rankings/players", cl.RankingPlayers)
		r.Get("/players", cl.ListPlayers)
		r.Get("/players/{playerId}", cl.GetPlayer)
		r.Get("/announcements", cl.ListAnnouncements)
		r.Get("/watchlist", cl.ListWatch)
		r.Get("/notifications", cl.GetNotificacoes)
		r.Get("/claimed-pro", cl.GetClaimed)
		r.Get("/sync-status", cl.GetSyncRun)
		// Consumida pelo worker de ingestão: quem pediu sync e ainda não terminou.
		r.Get("/sync-pending", cl.ListPendingSyncs)
		// Fila de fetch sob demanda de um clube: a tela de resgate grava o
		// pedido, o worker de ingestão polla `fetch-pending`, busca o elenco e
		// publica o resultado em /fetch-run.
		r.Get("/fetch-pending", cl.ListPendingFetches)
		r.Get("/clubs/{clubId}/fetch-run", cl.GetFetchRun)
		// Busca ao vivo na fonte: a busca local é a do diretório; esta é a
		// saída para um clube que o hub ainda não viu.
		r.Get("/search-pending", cl.ListPendingSearches)
		r.Get("/search-run", cl.GetSearchRun)
		r.Get("/admin/status", cl.AdminStatus)
		// Saúde do worker de ingestão (ele não tem host próprio).
		r.Get("/admin/ingest", cl.GetIngestEstado)

		r.Post("/clubs", clw.UpsertClub)
		r.Post("/clubs/{clubId}/totals", clw.UpsertTotais)
		r.Post("/clubs/{clubId}/matches", clw.UpsertMatch)
		r.Post("/clubs/{clubId}/snapshots", clw.AppendSnapshot)
		r.Post("/announcements", clw.CreateAnnouncement)
		r.Post("/watchlist", clw.SetWatch)
		r.Post("/notifications", clw.SaveNotifications)
		r.Post("/claimed-pro", clw.ClaimPro)
		r.Post("/sync-status", clw.SaveSyncRun)
		r.Post("/admin/ingest", clw.SaveIngestEstado)
		// Fetch sob demanda: a SPA pede, o worker Python busca,
		r.Post("/fetch-run", clw.RequestFetch)
		r.Post("/fetch-run/result", clw.SaveFetchRun)
		r.Post("/search-run", clw.RequestSearch)
		r.Post("/search-run/result", clw.SaveSearchRun)
	})

	return r
}
