package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application"
	apppost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/application/post"
	domainpost "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/post"
)

// PostHandlers is separate from Handlers (the User aggregate's) on
// purpose -- each aggregate gets its own dependencies instead of one
// struct accumulating every repository/port in the codebase.
type PostHandlers struct {
	posts    domainpost.Repository
	commands application.CommandPublisher
	log      Logger
}

// Logger is the exact slice of *slog.Logger Handlers already uses --
// declared here so this file doesn't need to import log/slog just to
// name the field type twice.
type Logger interface {
	Error(msg string, args ...any)
}

func NewPostHandlers(posts domainpost.Repository, commands application.CommandPublisher, log Logger) *PostHandlers {
	return &PostHandlers{posts: posts, commands: commands, log: log}
}

func (h *PostHandlers) ListPosts(w http.ResponseWriter, r *http.Request) {
	posts, err := h.posts.ListPublished(r.Context())
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": toPostResponses(posts)})
}

func (h *PostHandlers) GetPostBySlug(w http.ResponseWriter, r *http.Request) {
	p, err := h.posts.FindBySlug(r.Context(), chi.URLParam(r, "slug"))
	h.respondPost(w, p, err)
}

// GetPostByID is not exposed for public browsing (no status filter --
// returns drafts too) -- it exists so a trusted caller (buteco-api,
// itself already API-key-authenticated to reach this route at all)
// can look up a post's current author_id before deciding whether to
// forward an edit/delete command, since domain-api/worker have no
// concept of buteco-api's own users to check that themselves.
func (h *PostHandlers) GetPostByID(w http.ResponseWriter, r *http.Request) {
	p, err := h.posts.FindByID(r.Context(), chi.URLParam(r, "id"))
	h.respondPost(w, p, err)
}

func (h *PostHandlers) respondPost(w http.ResponseWriter, p domainpost.Post, err error) {
	if errors.Is(err, domainpost.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "post not found"})
		return
	}
	if err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toPostResponse(p))
}

func (h *PostHandlers) CreatePost(w http.ResponseWriter, r *http.Request) {
	var input apppost.CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	if input.AuthorID == "" || input.Title == "" || input.BodyMarkdown == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "author_id, title and body_markdown are required"})
		return
	}
	h.publish(w, r, application.ActionCreatePost, input)
}

func (h *PostHandlers) UpdatePost(w http.ResponseWriter, r *http.Request) {
	var input apppost.UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.AuthorID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "author_id is required"})
		return
	}
	h.publish(w, r, application.ActionUpdatePost, input)
}

func (h *PostHandlers) DeletePost(w http.ResponseWriter, r *http.Request) {
	var input apppost.DeleteInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "invalid request body"})
		return
	}
	input.ID = chi.URLParam(r, "id")
	if input.AuthorID == "" {
		writeJSON(w, http.StatusBadRequest, errorBody{Error: "author_id is required"})
		return
	}
	h.publish(w, r, application.ActionDeletePost, input)
}

func (h *PostHandlers) publish(w http.ResponseWriter, r *http.Request, action application.Action, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		h.internalError(w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *PostHandlers) internalError(w http.ResponseWriter, err error) {
	h.log.Error("internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
