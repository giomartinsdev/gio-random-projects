package apihttp

import "net/http"

func NewRouter(h *Handlers) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", h.Healthz)
	mux.HandleFunc("GET /users", h.ListUsers)
	mux.HandleFunc("POST /users", h.CreateUser)
	mux.HandleFunc("GET /users/{id}", h.GetUser)
	mux.HandleFunc("PUT /users/{id}", h.UpdateUser)
	mux.HandleFunc("DELETE /users/{id}", h.DeleteUser)
	return mux
}
