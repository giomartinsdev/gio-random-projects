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
func NewRouter(h *Handlers, p *PostHandlers, rm *RoomHandlers, msg *MessageHandlers, dl *DealHandlers, sse *SSEHandlers, cch *CCHHandlers, sync *SyncHandlers, ct *ContaHandlers, tr *TransacaoHandlers, at *AtivoHandlers, ap *ApostaHandlers, dash *DashboardLayoutHandlers, keys APIKeys, limiter *IPRateLimiter, log *slog.Logger) http.Handler {
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
		r.Get("/apostas/{id}", ap.GetAposta)

		r.Get("/dashboardlayouts/{usuario}", dash.GetDashboardLayout)
	})

	return r
}
