package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

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
// name the field type twice. ErrorContext exists alongside Error so the
// telemetry handler (internal/telemetry) can see the request's span and
// stamp trace_id/span_id onto the line.
type Logger interface {
	Error(msg string, args ...any)
	ErrorContext(ctx context.Context, msg string, args ...any)
}

func NewPostHandlers(posts domainpost.Repository, commands application.CommandPublisher, log Logger) *PostHandlers {
	return &PostHandlers{posts: posts, commands: commands, log: log}
}

func (h *PostHandlers) ListPosts(w http.ResponseWriter, r *http.Request) {
	// ?q= narrows to a substring search without changing the shape --
	// same PostResponse list either way, so callers that never send q
	// are unaffected.
	query := strings.TrimSpace(r.URL.Query().Get("q"))

	var posts []domainpost.Post
	var err error
	if query == "" {
		posts, err = h.posts.ListPublished(r.Context())
	} else {
		posts, err = h.posts.SearchPublished(r.Context(), query)
	}
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": toPostResponses(posts)})
}

// ListPostsByAuthor backs post-api's by-author profile reads. It
// returns the author's drafts too -- that's deliberate (the owner's
// own profile needs them) and safe because this route requires the
// API key like every route here; the browser never reaches this file.
// post-api filters drafts out of responses the owner didn't request.
func (h *PostHandlers) ListPostsByAuthor(w http.ResponseWriter, r *http.Request) {
	posts, err := h.posts.ListByAuthor(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": toPostResponses(posts)})
}

func (h *PostHandlers) GetPostBySlug(w http.ResponseWriter, r *http.Request) {
	p, err := h.posts.FindBySlug(r.Context(), chi.URLParam(r, "slug"))
	h.respondPost(r, w, p, err)
}

// GetPostByID is not exposed for public browsing (no status filter --
// returns drafts too) -- it exists so a trusted caller (post-api,
// itself already API-key-authenticated to reach this route at all)
// can look up a post's current author_id before deciding whether to
// forward an edit/delete command, since domain-api/worker have no
// concept of post-api's own users to check that themselves.
func (h *PostHandlers) GetPostByID(w http.ResponseWriter, r *http.Request) {
	p, err := h.posts.FindByID(r.Context(), chi.URLParam(r, "id"))
	h.respondPost(r, w, p, err)
}

func (h *PostHandlers) respondPost(r *http.Request, w http.ResponseWriter, p domainpost.Post, err error) {
	if errors.Is(err, domainpost.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errorBody{Error: "post not found"})
		return
	}
	if err != nil {
		h.internalError(r, w, err)
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
		h.internalError(r, w, err)
		return
	}
	cmd := application.Command{ID: uuid.NewString(), Action: action, Payload: raw}
	if err := h.commands.Publish(r.Context(), cmd); err != nil {
		h.internalError(r, w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, acceptedBody{CommandID: cmd.ID, Status: "accepted"})
}

func (h *PostHandlers) internalError(r *http.Request, w http.ResponseWriter, err error) {
	h.log.ErrorContext(r.Context(), "internal error", "error", err)
	writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal server error"})
}
