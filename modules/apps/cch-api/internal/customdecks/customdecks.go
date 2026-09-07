// Package customdecks is the deck marketplace: decks forged with AI
// (or by hand), refined and published, then selectable in any room like
// a built-in deck. Persistence is a single JSON file on the same volume
// as the room registry -- a marketplace is a few hundred small decks at
// most, and rewriting it whole on the rare write is the same trade the
// rooms store already made (see internal/rooms/store.go).
//
// The interesting move is that a published deck registers itself in the
// decks package at boot (Load) and at publish time, so internal/game's
// Start resolves "cx…" ids through the same decks.Get lookup as the
// built-ins: the game engine never learns that custom decks exist.
package customdecks

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
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

// Store holds every published deck. Safe for concurrent use; nil-safe
// handlers check via Enabled.
type Store struct {
	mu    sync.RWMutex
	path  string
	decks map[string]*Deck
}

// New builds a store. An empty path keeps everything in memory (local
// dev without the state volume).
func New(path string) *Store {
	return &Store{path: path, decks: map[string]*Deck{}}
}

// Enabled reports whether the store has a persistence path. Handlers
// still work without it (decks just don't survive a restart).
func (s *Store) Enabled() bool { return s != nil && s.path != "" }

// Load reads the marketplace file and registers every deck in it into
// the decks package so games can deal from them. A deck that fails
// validation (a hand-edited file, an older schema) is skipped with a
// log line -- one bad deck must not take the marketplace down.
func (s *Store) Load() error {
	if s.path == "" {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // first boot on a fresh volume
		}
		return err
	}
	var stored []*Deck
	if err := json.Unmarshal(data, &stored); err != nil {
		// Corrupt marketplace is bad; refusing to boot is worse. Same
		// trade as the rooms store.
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
		s.decks[d.ID] = d
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

// Publish validates, stores, registers and persists a new deck.
func (s *Store) Publish(in PublishInput) (Deck, error) {
	if reason := publishable(&in); reason != "" {
		return Deck{}, errors.New(reason)
	}
	if in.Emoji == "" {
		in.Emoji = "🎴"
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.decks) >= maxDecks {
		return Deck{}, errors.New("mercado cheio -- apaguem decks velhos primeiro")
	}

	id, err := randomID()
	if err != nil {
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
		return Deck{}, err
	}
	decks.Register(registered)
	s.decks[deck.ID] = &deck
	s.persistLocked()
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
// WebSocket's game:start, once per custom deck involved.
func (s *Store) IncPlays(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.decks[id]
	if !ok {
		return
	}
	d.Plays++
	s.persistLocked()
}

// persistLocked rewrites the marketplace file. Caller must hold s.mu.
// Write-then-rename so a crash mid-write keeps the previous file
// parseable (same reasoning as the rooms store).
func (s *Store) persistLocked() {
	if s.path == "" {
		return
	}
	stored := make([]*Deck, 0, len(s.decks))
	for _, d := range s.decks {
		stored = append(stored, d)
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
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