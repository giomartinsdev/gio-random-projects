package httpapi

// The deck forge: AI generation, publishing, and the marketplace
// listing. Everything here is unauthenticated on purpose -- the game
// has no accounts, the room password is the only credential there is,
// and a party-game marketplace doesn't change that. The AI path is the
// only one with real cost attached, so it's the only one rate limited
// per IP and held to one generation at a time.

import (
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/customdecks"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

// One draft request costs real tokens upstream. Six per hour per IP is
// several full decks of tinkering -- and enough headroom that a table
// of five people forging together from one shared Wi-Fi (one IP) isn't
// locked out. The global slot keeps the proxy to one generation at a
// time: generations take tens of seconds and are strictly queue-shaped.
const (
	generationsPerHour = 6
	generationWindow   = time.Hour
)

// generateRequest asks for an amplified draft of an existing deck.
type generateRequest struct {
	ParentID string `json:"parentDeckId"`
	Theme    string `json:"theme"`
}

// handleGenerateDeck turns "deck base + tema" into a draft deck. The
// draft is NOT saved -- the Forja's editor gets it and the human
// refines; only handlePublishCustomDeck persists anything.
func (s *Server) handleGenerateDeck(w http.ResponseWriter, r *http.Request) {
	if !s.ai.Enabled() {
		writeError(w, http.StatusServiceUnavailable, "a forja de IA está desligada neste servidor")
		return
	}

	ip := clientIP(r)
	if !s.genLimiter.allow(ip) {
		writeError(w, http.StatusTooManyRequests, "limite de gerações atingido -- tente de novo mais tarde")
		return
	}
	// One at a time, globally. The waiter gets a friendly busy message
	// rather than queueing silently behind a 60s prompt.
	select {
	case s.generationSlot <- struct{}{}:
		defer func() { <-s.generationSlot }()
	default:
		writeError(w, http.StatusTooManyRequests, "outra geração está em andamento, tente em instantes")
		return
	}

	var req generateRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}

	parent, ok := decks.Get(req.ParentID)
	if !ok {
		writeError(w, http.StatusNotFound, "deck base desconhecido")
		return
	}

	// Tone sample: a random slice of the parent's cards, so repeated
	// generations of the same theme don't anchor on the same examples.
	whites, err := sampleCards(parent.Whites(), 8)
	if err != nil {
		log.Printf("[cch] forge sample failed: %v", err)
		writeError(w, http.StatusInternalServerError, "não foi possível preparar o pedido")
		return
	}
	blacks, err := sampleCards(parent.Blacks(), 4)
	if err != nil {
		log.Printf("[cch] forge sample failed: %v", err)
		writeError(w, http.StatusInternalServerError, "não foi possível preparar o pedido")
		return
	}

	draft, err := s.ai.Generate(r.Context(), ai.GenInput{
		ParentName:        parent.Name,
		ParentDescription: parent.Description,
		SampleWhites:      whites,
		SampleBlacks:      blacks,
		Theme:             req.Theme,
	})
	if err != nil {
		log.Printf("[cch] forge generate failed: %v", err)
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	// A successful generation starts the IP's window only now -- failed
	// attempts (proxy down, model wrong) don't burn quota.
	s.genLimiter.fail(ip)
	writeJSON(w, http.StatusOK, map[string]any{"draft": draft})
}

// sampleCards picks n random card texts via the same crypto shuffle the
// deal uses.
func sampleCards(cards []decks.Card, n int) ([]string, error) {
	shuffled, err := decks.Shuffle(cards)
	if err != nil {
		return nil, err
	}
	if n > len(shuffled) {
		n = len(shuffled)
	}
	out := make([]string, 0, n)
	for _, c := range shuffled[:n] {
		out = append(out, c.Text)
	}
	return out, nil
}

// handleAIStatus tells the Forja whether generation exists here, and
// which model won (if one has been used yet) -- so "IA offline" is a
// fact the UI can show instead of a mystery 503.
func (s *Server) handleAIStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"configured": s.ai.Enabled(),
		"model":      s.ai.Model(),
	})
}

// publishCustomRequest is the Forja's refined deck. The server owns the
// id, timestamp and play count.
type publishCustomRequest struct {
	Name        string   `json:"name"`
	Emoji       string   `json:"emoji"`
	Description string   `json:"description"`
	ParentID    string   `json:"parentId"`
	Author      string   `json:"author"`
	Whites      []string `json:"whites"`
	Blacks      []string `json:"blacks"`
}

// handlePublishCustomDeck validates and stores a deck, registering it
// so games can deal from it immediately.
func (s *Server) handlePublishCustomDeck(w http.ResponseWriter, r *http.Request) {
	var req publishCustomRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "corpo inválido")
		return
	}

	deck, err := s.custom.Publish(customdecks.PublishInput{
		Name:        req.Name,
		Emoji:       req.Emoji,
		Description: req.Description,
		ParentID:    req.ParentID,
		Author:      req.Author,
		Whites:      req.Whites,
		Blacks:      req.Blacks,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, deck)
}

// handleListCustomDecks is the marketplace listing: metadata only, the
// cards stay behind the deal.
func (s *Server) handleListCustomDecks(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.custom.List())
}

// handleGetCustomDeck returns one deck with its cards -- the Forja's
// "open and fork" flow. Browsing stays metadata-only; fetching the
// cards is an explicit act.
func (s *Server) handleGetCustomDeck(w http.ResponseWriter, r *http.Request) {
	id := strings.ToLower(r.PathValue("id"))
	deck, ok := s.custom.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "deck não encontrado no mercado")
		return
	}
	writeJSON(w, http.StatusOK, deck)
}

// generationLimiter is a fixed-window counter per IP for the AI path.
// Unlike attemptLimiter (which resets on success), a successful
// generation counts: the window exists to bound spend, not to block
// guessing.
type generationLimiter struct {
	mu      sync.Mutex
	entries map[string]*generationEntry
}

type generationEntry struct {
	count int
	since time.Time
}

func newGenerationLimiter() *generationLimiter {
	return &generationLimiter{entries: map[string]*generationEntry{}}
}

func (l *generationLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok {
		return true
	}
	if time.Since(e.since) > generationWindow {
		delete(l.entries, ip)
		return true
	}
	return e.count < generationsPerHour
}

// fail records a generation. The name mirrors attemptLimiter's because
// the call site reads the same way -- "this attempt burns quota".
func (l *generationLimiter) fail(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.entries[ip]
	if !ok || time.Since(e.since) > generationWindow {
		if len(l.entries) >= limiterMaxKeys {
			l.entries = map[string]*generationEntry{}
		}
		l.entries[ip] = &generationEntry{count: 1, since: time.Now()}
		return
	}
	e.count++
}