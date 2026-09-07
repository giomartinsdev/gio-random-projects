// Package decks holds the game's content: the themed card decks. Each
// deck is a named set of white cards (answers) and black cards
// (questions, with one or more "_" blanks to fill in). Cards are plain
// Go data -- there's no admin UI, no database; a new deck is a new file
// in this package, exactly like tela's wordlist in internal/rooms.
//
// Content policy for everything here: dark, crude and absurd is the
// point of the game, but no slurs, nothing sexual involving minors,
// and no real people by name -- groups and roles ("meu tio", "o
// gerente") instead of individuals, so the joke always lands on the
// situation, not on a specific person. Nothing whose punchline targets
// an ethnicity, religion or people either: heaviness comes from death,
// bad luck, crime and absurdity, never from hate.
package decks

import (
	"crypto/rand"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// BlankWhiteText is the text of a write-your-own card. When it's
// played, the player supplies their own text and the server replaces
// the text with what they typed (see game.Submit).
const BlankWhiteText = "__"

// BlankBlackMark is the placeholder inside a black card's text. Each
// occurrence is one white card the round demands; a black card with
// two marks needs two white cards per submission.
const BlankBlackMark = "_"

// Card is one white or black card. ID is unique within a deck by kind
// ("classico-w-12"), and is what the client holds in its hand and
// sends back when playing.
type Card struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// BlankWhite reports whether this is a write-your-own card: the client
// prompts for text instead of playing a printed one.
func (c Card) BlankWhite() bool { return c.Text == BlankWhiteText }

// Deck is one themed set of cards.
type Deck struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Emoji       string `json:"emoji"`
	Description string `json:"description"`

	whites []string
	blacks []string
}

// New builds a deck from raw card texts. It exists for decks created at
// runtime -- the marketplace's custom decks (see internal/customdecks) --
// since everything here keeps its card texts unexported on purpose: the
// only way in is through this constructor, which validates the same
// invariants the built-in decks' test enforces. Every black card needs at
// least one blank mark (and at most three -- a sentence with more is not
// a joke, it's homework), and duplicate white texts are rejected.
func New(id, name, emoji, description string, whites, blacks []string) (Deck, error) {
	if id == "" {
		return Deck{}, errors.New("deck sem id")
	}
	if len(whites) == 0 || len(blacks) == 0 {
		return Deck{}, errors.New("deck precisa de cartas brancas e pretas")
	}
	for i, w := range whites {
		if strings.TrimSpace(w) == "" {
			return Deck{}, fmt.Errorf("carta branca %d vazia", i+1)
		}
	}
	for i, b := range blacks {
		n := strings.Count(b, BlankBlackMark)
		if n < 1 {
			return Deck{}, fmt.Errorf("carta preta %d sem lacuna \"_\"", i+1)
		}
		if n > 3 {
			return Deck{}, fmt.Errorf("carta preta %d com lacunas demais", i+1)
		}
	}
	seen := make(map[string]bool, len(whites))
	for _, w := range whites {
		if w == BlankWhiteText {
			continue // write-your-own cards may repeat
		}
		if seen[w] {
			return Deck{}, fmt.Errorf("carta branca duplicada: %q", w)
		}
		seen[w] = true
	}
	return Deck{
		ID:          id,
		Name:        name,
		Emoji:       emoji,
		Description: description,
		whites:      append([]string(nil), whites...),
		blacks:      append([]string(nil), blacks...),
	}, nil
}

// Whites returns this deck's white cards with stable, unique IDs.
func (d Deck) Whites() []Card { return cardsFor(d.ID, "w", d.whites) }

// Blacks returns this deck's black cards with stable, unique IDs. The
// number of blanks each round demands comes from counting the "_"
// marks in the black card's text.
func (d Deck) Blacks() []Card { return cardsFor(d.ID, "b", d.blacks) }

// Blanks counts how many white cards a black card consumes -- one per
// "_" mark. Cards spell the blank as a bare "_" so it composes into a
// sentence naturally ("Aqui jaz quem morreu de _.").
func Blanks(black Card) int { return strings.Count(black.Text, BlankBlackMark) }

// DeckInfo is the public view of a deck for GET /api/decks and the
// room setup screen: names and sizes, never the cards themselves --
// the deck's contents are the game's surprise and only go out through
// the deal.
type DeckInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Emoji       string `json:"emoji"`
	Description string `json:"description"`
	Whites      int    `json:"whites"`
	Blacks      int    `json:"blacks"`
}

// Info builds the public metadata view of a deck.
func (d Deck) Info() DeckInfo {
	return DeckInfo{
		ID:          d.ID,
		Name:        d.Name,
		Emoji:       d.Emoji,
		Description: d.Description,
		Whites:      len(d.whites),
		Blacks:      len(d.blacks),
	}
}

func cardsFor(deck, kind string, texts []string) []Card {
	out := make([]Card, len(texts))
	for i, text := range texts {
		out[i] = Card{ID: deck + "-" + kind + "-" + strconv.Itoa(i), Text: text}
	}
	return out
}

var (
	registryMu sync.RWMutex
	registry   = map[string]Deck{}
)

// Register adds a deck to the global registry. Called from each deck
// file's init() -- see classico.go and friends.
func Register(d Deck) {
	registryMu.Lock()
	defer registryMu.Unlock()
	registry[d.ID] = d
}

// All lists every registered deck, ordered by name. The order only
// matters for the setup screen's listing.
func All() []Deck {
	registryMu.RLock()
	defer registryMu.RUnlock()
	out := make([]Deck, 0, len(registry))
	for _, d := range registry {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Infos is the public view of every deck, same order as All.
func Infos() []DeckInfo {
	all := All()
	out := make([]DeckInfo, len(all))
	for i, d := range all {
		out[i] = d.Info()
	}
	return out
}

// Get looks a deck up by ID.
func Get(id string) (Deck, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	d, ok := registry[id]
	return d, ok
}

// Shuffle returns a copy of items in a fresh random order, using
// crypto/rand -- the deal must never be predictable, even to someone
// who can call the API. Fisher-Yates with the same
// rejection-sampling discipline the rest of this repo's randomness
// uses (see rooms.randomFrom): rand.Int's modulo bias doesn't exist
// because we read a full byte and reject out-of-range values. Generic
// because the game package shuffles cards, black-card piles AND the
// anonymous judging order (view/author pairs), and hand-rolling a
// second copy of the algorithm for one of those invites divergence.
func Shuffle[T any](items []T) ([]T, error) {
	out := make([]T, len(items))
	copy(out, items)
	// Four bytes, not one: a combined deal is bigger than 256 cards,
	// and a single-byte draw can't even represent indices past 255 --
	// every pick for a longer pile would be rejected forever. A uint32
	// covers any pile this room will ever hold, with the same rejection
	// discipline against modulo bias.
	//
	// The limit lives in uint64 arithmetic on purpose. When `span`
	// divides 2^32 evenly (any power of two -- and a 72-card hand hits
	// span 64 mid-shuffle), "2^32 - 2^32%span" IS 2^32, which overflows
	// any uint32 back to 0 and rejects literally every draw, forever.
	// Computed as uint64 the limit is then 2^32 itself, i.e. "accept
	// everything" -- which is also exactly right: with span dividing
	// the whole space, n%span is already unbiased.
	buf := make([]byte, 4)
	for i := len(out) - 1; i > 0; i-- {
		span := uint64(i + 1)
		limit := (uint64(1) << 32) - ((uint64(1) << 32) % span)
		j := 0
		for {
			if _, err := rand.Read(buf); err != nil {
				return nil, err
			}
			n := uint64(buf[0])<<24 | uint64(buf[1])<<16 | uint64(buf[2])<<8 | uint64(buf[3])
			if n >= limit {
				continue
			}
			j = int(n % span)
			break
		}
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}