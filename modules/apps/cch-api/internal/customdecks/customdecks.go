// Package customdecks is the deck marketplace: decks forged with AI
// (or by hand), refined and published, then selectable in any room like
// a built-in deck. Persistence goes through a Backend -- domain-api's
// cch_custom_decks table in production (see backend_domain.go), nothing
// at all in dev and tests. The marketplace is a few hundred small
// decks at most and lives entirely in memory after Load, same as the
// room registry.
//
// The interesting move is that a published deck registers itself in the
// decks package at boot (Load) and at publish time, so internal/game's
// Start resolves "cx…" ids through the same decks.Get lookup as the
// built-ins: the game engine never learns that custom decks exist.
package customdecks

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

// Custom deck ids get this prefix so the rest of the system can tell a
// marketplace deck from a built-in at a glance (ws.go counts plays with
// it; the frontend badges it).
const IDPrefix = "cx"

// Bounds for a published deck. Looser than the built-ins' test (a
// forged deck may be small -- that's the point of "amplify one theme"),
// but still bounded: a deck of 4 cards makes the game starve, and
// anything past these numbers is spam, not a deck.
const (
	minWhites = 10
	maxWhites = 150
	minBlacks = 4
	maxBlacks = 50
	maxDecks  = 300
)

// Field length caps. Same spirit as sanitizeName: someone pasting a
// novel into a card shouldn't get to stretch the deal UI.
const (
	maxNameLen        = 40
	maxEmojiLen       = 8
	maxDescriptionLen = 160
	maxWhiteLen       = 160
	maxBlackLen       = 200
	maxAuthorLen      = 30
)

// Deck is one marketplace deck, stored and served as raw card texts --
// ids are derived at registration time, so the persisted form is just
// what a Forja editor would have written.
type Deck struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji"`
	Description string    `json:"description"`
	ParentID    string    `json:"parentId,omitempty"`
	Author      string    `json:"author,omitempty"`
	Whites      []string  `json:"whites"`
	Blacks      []string  `json:"blacks"`
	CreatedAt   time.Time `json:"createdAt"`
	Plays       int       `json:"plays"`
}

// PublishInput is what the Forja sends: card texts and the deck's
// presentation. The id, timestamp and plays are the server's to decide.
type PublishInput struct {
	Name        string   `json:"name"`
	Emoji       string   `json:"emoji"`
	Description string   `json:"description"`
	ParentID    string   `json:"parentId"`
	Author      string   `json:"author"`
	Whites      []string `json:"whites"`
	Blacks      []string `json:"blacks"`
}

// Info is the marketplace listing view: metadata, never the cards --
// same rule as the built-in decks (the cards only reach a player
// through the deal, so browsing the market doesn't spoil a deck).
type Info struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Emoji       string    `json:"emoji"`
	Description string    `json:"description"`
	ParentID    string    `json:"parentId,omitempty"`
	Author      string    `json:"author,omitempty"`
	Whites      int       `json:"whites"`
	Blacks      int       `json:"blacks"`
	CreatedAt   time.Time `json:"createdAt"`
	Plays       int       `json:"plays"`
}

func (d Deck) Info() Info {
	return Info{
		ID:          d.ID,
		Name:        d.Name,
		Emoji:       d.Emoji,
		Description: d.Description,
		ParentID:    d.ParentID,
		Author:      d.Author,
		Whites:      len(d.Whites),
		Blacks:      len(d.Blacks),
		CreatedAt:   d.CreatedAt,
		Plays:       d.Plays,
	}
}

// Backend is the marketplace's durable slice: load everything at boot,
// save one deck on publish, bump one play count per game started.
//
// Implementations are allowed to be slow (Save is a synchronous HTTP
// round-trip through domain-api's /sync route), which is why Publish
// runs its Save with the store lock released -- the b433528 deadlock
// contract, marketplace edition.
type Backend interface {
	Load(ctx context.Context) ([]Deck, error)
	Save(ctx context.Context, deck Deck) error
	// PlayCounted is the fire-and-forget bump; it never blocks a game
	// start and its errors are only logged.
	PlayCounted(ctx context.Context, id string) error
}

// Store holds every published deck. Safe for concurrent use; nil-safe
// handlers check via Enabled.
type Store struct {
	mu      sync.RWMutex
	backend Backend
	decks   map[string]*Deck
}

// New builds a store. A nil backend keeps everything in memory (local
// dev and tests -- decks just don't survive a restart, same as the old
// empty-state-path behavior).
func New(backend Backend) *Store {
	return &Store{backend: backend, decks: map[string]*Deck{}}
}

// Load pulls the whole marketplace from the durable store and
// registers every deck into the decks package so games can deal from
// them. A deck that fails validation (an older schema, a hand-edited
// row) is skipped with a log line -- one bad deck must not take the
// marketplace down.
func (s *Store) Load() error {
	if s.backend == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	stored, err := s.backend.Load(ctx)
	if err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range stored {
		if d.ID == "" {
			continue
		}
		registered, err := d.toDecksDeck()
		if err != nil {
			log.Printf("[cch] skipping invalid custom deck %q: %v", d.ID, err)
			continue
		}
		decks.Register(registered)
		deck := d
		s.decks[d.ID] = &deck
	}
	return nil
}

func (d Deck) toDecksDeck() (decks.Deck, error) {
	return decks.New(d.ID, d.Name, d.Emoji, d.Description, d.Whites, d.Blacks)
}

// publishable validates and normalizes a PublishInput in place. It
// returns the human-readable reason the deck can't be published, or ""
// if it's good. Trimming and length caps run before the counts are
// checked so "11 copies of whitespace" doesn't count as cards.
func publishable(in *PublishInput) string {
	in.Name = trimRunes(in.Name, maxNameLen)
	in.Emoji = strings.TrimSpace(in.Emoji)
	in.Description = trimRunes(in.Description, maxDescriptionLen)
	in.Author = trimRunes(in.Author, maxAuthorLen)

	if in.Name == "" {
		return "o deck precisa de um nome"
	}
	if len([]rune(in.Emoji)) > maxEmojiLen {
		return "emoji longo demais"
	}
	in.Whites = sanitizeLines(in.Whites, maxWhiteLen)
	in.Blacks = sanitizeLines(in.Blacks, maxBlackLen)
	if len(in.Whites) < minWhites {
		return fmt.Sprintf("deck precisa de pelo menos %d cartas brancas (tem %d)", minWhites, len(in.Whites))
	}
	if len(in.Whites) > maxWhites {
		return fmt.Sprintf("limite de %d cartas brancas", maxWhites)
	}
	if len(in.Blacks) < minBlacks {
		return fmt.Sprintf("deck precisa de pelo menos %d cartas pretas (tem %d)", minBlacks, len(in.Blacks))
	}
	if len(in.Blacks) > maxBlacks {
		return fmt.Sprintf("limite de %d cartas pretas", maxBlacks)
	}
	// Every black needs a blank for the deal to work -- the game engine
	// fills them (decks.Blanks). Checked here so the editor's mistake is
	// caught at publish time, not mid-round.
	for i, b := range in.Blacks {
		n := strings.Count(b, decks.BlankBlackMark)
		if n < 1 {
			return fmt.Sprintf("carta preta %d não tem \"_\" para a lacuna", i+1)
		}
		if n > 3 {
			return fmt.Sprintf("carta preta %d tem lacunas demais (máximo 3)", i+1)
		}
	}
	if in.ParentID != "" {
		if _, ok := decks.Get(in.ParentID); !ok {
			return "deck base desconhecido"
		}
	}
	return ""
}

// Publish validates, persists, then stores and registers a new deck.
// The order is deliberate: the durable write happens BEFORE the deck
// enters memory, so by the time the Forja hears "publicado" the deck
// survives a restart — and a failed publish leaves the marketplace
// exactly as it was instead of listing a deck that will vanish on the
// next boot. (Strictly better than the old file store, which swallowed
// write errors and reported success anyway.)
func (s *Store) Publish(in PublishInput) (Deck, error) {
	if reason := publishable(&in); reason != "" {
		return Deck{}, errors.New(reason)
	}
	if in.Emoji == "" {
		in.Emoji = "🎴"
	}

	s.mu.Lock()
	if len(s.decks) >= maxDecks {
		s.mu.Unlock()
		return Deck{}, errors.New("mercado cheio -- apaguem decks velhos primeiro")
	}
	id, err := randomID()
	if err != nil {
		s.mu.Unlock()
		return Deck{}, err
	}
	deck := Deck{
		ID:          IDPrefix + id,
		Name:        in.Name,
		Emoji:       in.Emoji,
		Description: in.Description,
		ParentID:    in.ParentID,
		Author:      in.Author,
		Whites:      in.Whites,
		Blacks:      in.Blacks,
		CreatedAt:   time.Now().UTC(),
	}
	registered, err := deck.toDecksDeck()
	if err != nil {
		s.mu.Unlock()
		return Deck{}, err
	}
	s.mu.Unlock()

	// The Save runs with the lock released: it's a synchronous HTTP
	// round-trip, and holding s.mu across it would freeze the
	// marketplace listing, every Get and every IncPlays behind it.
	if s.backend != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := s.backend.Save(ctx, deck); err != nil {
			return Deck{}, err
		}
	}

	s.mu.Lock()
	decks.Register(registered)
	s.decks[deck.ID] = &deck
	s.mu.Unlock()
	return deck, nil
}

// List returns the marketplace's metadata, newest first.
func (s *Store) List() []Info {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Info, 0, len(s.decks))
	for _, d := range s.decks {
		out = append(out, d.Info())
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].CreatedAt.After(out[j].CreatedAt)
		}
		return out[i].ID > out[j].ID
	})
	return out
}

// Get returns the full deck (cards included) -- what the Forja's
// "open in the forge and fork it" flow needs. The cards were always
// reachable through play; the marketplace listing is what stays
// spoiler-free.
func (s *Store) Get(id string) (Deck, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	d, ok := s.decks[id]
	if !ok {
		return Deck{}, false
	}
	return *d, true
}

// IncPlays counts a game started with this deck. Called from the
// WebSocket's game:start, once per custom deck involved. The in-memory
// bump is immediate; the durable one is fire-and-forget on the async
// path — the count is cosmetic and must never delay (let alone fail) a
// game start, so a lost bump only leaves a badge a digit behind.
func (s *Store) IncPlays(id string) {
	s.mu.Lock()
	d, ok := s.decks[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	d.Plays++
	s.mu.Unlock()

	if s.backend == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if err := s.backend.PlayCounted(ctx, id); err != nil {
			log.Printf("[cch] contagem de plays de %s não persistida: %v", id, err)
		}
	}()
}

// sanitizeLines trims, drops empties, dedupes and rune-caps a card
// list. AI drafts and hand-typed decks both go through this, so the
// store only ever holds clean, bounded lists.
func sanitizeLines(lines []string, maxLen int) []string {
	out := make([]string, 0, len(lines))
	seen := make(map[string]bool, len(lines))
	for _, l := range lines {
		l = trimRunes(l, maxLen)
		if l == "" || seen[l] {
			continue
		}
		seen[l] = true
		out = append(out, l)
	}
	return out
}

// trimRunes trims whitespace and bounds by runes (never splitting a
// multi-byte character) -- same discipline as httpapi.sanitizeName.
func trimRunes(raw string, max int) string {
	s := strings.TrimSpace(raw)
	r := []rune(s)
	if len(r) > max {
		r = r[:max]
	}
	return string(r)
}

// randomID is 10 hex chars from crypto/rand -- the same randomness bar
// as room codes. 5 bytes give 2^40 space against the maxDecks cap.
func randomID() (string, error) {
	buf := make([]byte, 5)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}