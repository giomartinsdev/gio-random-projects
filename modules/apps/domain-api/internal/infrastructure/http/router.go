package httpapi

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// NewRouter wires every route. /healthz and the API docs stay public
// (no key, no rate limit) — everything under /users, /posts, /rooms,
// and /messages requires the apiKey security scheme (see openapi.yaml
// and Secure in middleware.go). /posts/id/{id} is not for public
// browsing -- see PostHandlers.GetPostByID's own doc comment.
func NewRouter(h *Handlers, p *PostHandlers, rm *RoomHandlers, msg *MessageHandlers, sse *SSEHandlers, keys APIKeys, limiter *IPRateLimiter, log *slog.Logger) http.Handler {
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
	})

	return r
}
