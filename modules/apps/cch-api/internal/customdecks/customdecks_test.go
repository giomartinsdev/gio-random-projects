package customdecks

import (
	"strings"
	"testing"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

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
	path := t.TempDir() + "/decks.json"
	s := New(path)

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

	// A fresh store from disk sees the same deck, registered too.
	s2 := New(path)
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

func TestPublishValidation(t *testing.T) {
	s := New("")

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
	s := New("")
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
	s := New("")
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
}

func TestLoadSkipsInvalidDeck(t *testing.T) {
	path := t.TempDir() + "/decks.json"
	s := New(path)
	if _, err := s.Publish(goodInput("Bom")); err != nil {
		t.Fatalf("Publish: %v", err)
	}
	// Hand-corrupt the file: one good deck, one with no blank in its
	// blacks. Load must keep the good one and skip the bad one.
	s.mu.Lock()
	s.decks["cx-bad"] = &Deck{ID: "cx-bad", Name: "Ruim", Whites: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}, Blacks: []string{"sem lacuna"}}
	s.persistLocked()
	s.mu.Unlock()

	s2 := New(path)
	if err := s2.Load(); err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(s2.List()) != 1 {
		t.Fatalf("only the valid deck should have loaded, got %d", len(s2.List()))
	}
}