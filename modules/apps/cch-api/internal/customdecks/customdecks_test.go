package customdecks

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

// fakeBackend is the in-memory stand-in for the durable store: it
// records saves and play bumps so tests can assert on them, and can be
// told to fail.
type fakeBackend struct {
	mu      sync.Mutex
	decks   map[string]Deck
	saves   int
	played  []string
	saveErr error
}

func newFakeBackend() *fakeBackend {
	return &fakeBackend{decks: map[string]Deck{}}
}

func (b *fakeBackend) Load(context.Context) ([]Deck, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([]Deck, 0, len(b.decks))
	for _, d := range b.decks {
		out = append(out, d)
	}
	return out, nil
}

func (b *fakeBackend) Save(_ context.Context, deck Deck) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.saveErr != nil {
		return b.saveErr
	}
	b.saves++
	b.decks[deck.ID] = deck
	return nil
}

func (b *fakeBackend) PlayCounted(_ context.Context, id string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.played = append(b.played, id)
	return nil
}

// A publishable deck: 12 whites, 5 blacks, every black with a blank.
func goodInput(name string) PublishInput {
	return PublishInput{
		Name:   name,
		Emoji:  "🧪",
		Whites: []string{"O teste verde", "O build quebrado", "A reunião às 8h", "O deploy na sexta", "O lint reclamando", "O café derramado no teclado", "A planilha sagrada", "O print no grupo", "O commit 'misc'", "A senha no README", "O estagiário herói", "A dívida técnica"},
		Blacks: []string{"O que derrubou a produção? _.", "Meu commit favorito: _.", "A sprint acabou com _.", "No retro, confessei _.", "_ é o novo _."},
	}
}

func TestPublishRegistersAndPersists(t *testing.T) {
	backend := newFakeBackend()
	s := New(backend)

	d, err := s.Publish(goodInput("Deck de Teste"))
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if !strings.HasPrefix(d.ID, IDPrefix) {
		t.Fatalf("custom deck id should carry the %q prefix, got %q", IDPrefix, d.ID)
	}

	// Registered for the game engine, resolvable like a built-in.
	registered, ok := decks.Get(d.ID)
	if !ok {
		t.Fatal("published deck not resolvable via decks.Get")
	}
	if len(registered.Whites()) != 12 || len(registered.Blacks()) != 5 {
		t.Fatalf("registered deck has wrong sizes: %d whites, %d blacks", len(registered.Whites()), len(registered.Blacks()))
	}
	// Card ids unique per deck and kind.
	if registered.Blacks()[0].ID != d.ID+"-b-0" {
		t.Fatalf("unexpected black card id %q", registered.Blacks()[0].ID)
	}

	// The durable copy exists, and a fresh store loading from the same
	// backend sees the deck, registered too.
	if _, ok := backend.decks[d.ID]; !ok {
		t.Fatal("deck was not written to the backend before Publish returned")
	}
	s2 := New(backend)
	if err := s2.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if _, ok := s2.Get(d.ID); !ok {
		t.Fatal("deck did not survive a reload")
	}
	if _, ok := decks.Get(d.ID); !ok {
		t.Fatal("reloaded deck not registered into the decks registry")
	}
}

// A failed durable write must leave the marketplace untouched: no
// memory copy, no registration, error reported to the caller.
func TestPublishFailsWhenSaveFails(t *testing.T) {
	backend := newFakeBackend()
	backend.saveErr = errors.New("domain down")
	s := New(backend)

	d, err := s.Publish(goodInput("Fantasma"))
	if err == nil {
		t.Fatal("Publish should surface the backend error")
	}
	if d.ID != "" {
		t.Fatalf("no deck should be returned on failure, got %+v", d)
	}
	if len(s.List()) != 0 {
		t.Fatal("failed publish left a deck in the marketplace")
	}
	if _, ok := decks.Get(strings.TrimPrefix(d.ID, IDPrefix)); ok {
		t.Fatal("failed publish registered the deck for the game engine")
	}
}

func TestPublishValidation(t *testing.T) {
	s := New(nil)

	cases := []struct {
		name   string
		mutate func(*PublishInput)
	}{
		{"sem nome", func(in *PublishInput) { in.Name = "   " }},
		{"brancas de menos", func(in *PublishInput) { in.Whites = in.Whites[:5] }},
		{"pretas de menos", func(in *PublishInput) { in.Blacks = in.Blacks[:2] }},
		{"preta sem lacuna", func(in *PublishInput) { in.Blacks[0] = "carta sem lacuna nenhuma" }},
		{"preta com lacunas demais", func(in *PublishInput) { in.Blacks[0] = "_ e _ e _ e _" }},
		{"pai desconhecido", func(in *PublishInput) { in.ParentID = "deck-que-nao-existe" }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := goodInput("Válido")
			tc.mutate(&in)
			if _, err := s.Publish(in); err == nil {
				t.Fatal("Publish should have failed")
			}
		})
	}
}

func TestPublishSanitizesAndDedupes(t *testing.T) {
	s := New(nil)
	in := goodInput("  Deck com sujeira  ")
	// Whitespace-only lines vanish, dups collapse, and the name is
	// trimmed -- the counts still hold afterwards.
	in.Whites = append(in.Whites, "   ", "O teste verde", strings.Repeat("x", 500))
	d, err := s.Publish(in)
	if err != nil {
		t.Fatalf("Publish with junk lines should pass: %v", err)
	}
	if d.Name != "Deck com sujeira" {
		t.Fatalf("name not trimmed: %q", d.Name)
	}
	if len(d.Whites) != 13 {
		// 12 originais + a linha longa (truncada, única); a linha em
		// branco e a duplicata exata somem.
		t.Fatalf("expected 13 whites after sanitize (blank+dup dropped, long kept truncated), got %d", len(d.Whites))
	}
	for _, w := range d.Whites {
		if len([]rune(w)) > maxWhiteLen {
			t.Fatalf("white card not length-capped: %q", w)
		}
	}
}

func TestIncPlaysAndList(t *testing.T) {
	backend := newFakeBackend()
	s := New(backend)
	d1, err := s.Publish(goodInput("Um"))
	if err != nil {
		t.Fatalf("Publish 1: %v", err)
	}
	d2, err := s.Publish(goodInput("Dois"))
	if err != nil {
		t.Fatalf("Publish 2: %v", err)
	}
	// Sleep a hair so the two decks' timestamps differ -- the listing
	// sorts newest-first, breaking ties by id.
	time.Sleep(2 * time.Millisecond)

	s.IncPlays(d1.ID)
	s.IncPlays(d1.ID)
	s.IncPlays("cx-inexistente") // must not panic

	got, ok := s.Get(d1.ID)
	if !ok || got.Plays != 2 {
		t.Fatalf("plays not counted: %+v", got)
	}

	list := s.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 listings, got %d", len(list))
	}
	if list[0].ID != d2.ID {
		t.Fatalf("listing should be newest-first: first is %q", list[0].ID)
	}
	for _, info := range list {
		if info.Whites != 12 || info.Blacks != 5 {
			t.Fatalf("listing should carry counts, got %+v", info)
		}
	}

	// The bumps went out on the async path — both for the real deck,
	// none for the unknown id.
	deadline := time.Now().Add(1 * time.Second)
	for len(backend.played) < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(backend.played) != 2 {
		t.Fatalf("expected 2 async play bumps, got %v", backend.played)
	}
}

func TestLoadSkipsInvalidDeck(t *testing.T) {
	backend := newFakeBackend()
	// One good deck, one with no blank in its blacks (what an older,
	// looser validation would have let through). Load must keep the
	// good one and skip the bad one.
	s := New(backend)
	if _, err := s.Publish(goodInput("Bom")); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	backend.mu.Lock()
	backend.decks["cx-bad"] = Deck{ID: "cx-bad", Name: "Ruim", Whites: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}, Blacks: []string{"sem lacuna"}}
	backend.mu.Unlock()

	s2 := New(backend)
	if err := s2.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(s2.List()) != 1 {
		t.Fatalf("only the valid deck should have loaded, got %d", len(s2.List()))
	}
}