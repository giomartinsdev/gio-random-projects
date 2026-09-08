// Package game is the whole rules engine of the game: phases, hands,
// submissions, judging and scoring. It is deliberately transport-free
// -- no WebSockets, no broadcasts, no room logic. internal/rooms owns
// the room and its peers; this package only ever sees player ids,
// which are the same peer ids the room hands out.
//
// The rules, in one place:
//
//   - three or more connected players to start;
//   - one Card Czar per round, rotating through join order;
//   - everyone but the Czar plays as many white cards as the black
//     card's "_" marks demand; submissions land face down and the Czar
//     turns them face up one by one, each turn broadcast so the whole
//     room reads along -- every card carries its owner's avatar, so
//     authorship is public knowledge via the bonequinho, not a secret;
//   - only face-up submissions can be crowned;
//   - the Czar picks a winner, who scores a point;
//   - first to the room's winning score wins the game;
//   - each player may trade one white card per round, before playing.
package game

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

var (
	ErrNotEnoughPlayers = errors.New("o jogo precisa de pelo menos 3 pessoas conectadas")
	ErrWrongPhase       = errors.New("a rodada não está nessa fase")
	ErrNotYourTurn      = errors.New("você não pode fazer isso agora")
	ErrAlreadySubmitted = errors.New("você já jogou nesta rodada")
	ErrAlreadyTraded    = errors.New("você já trocou uma carta nesta rodada")
	ErrCardNotInHand    = errors.New("essa carta não está na sua mão")
	ErrWrongPlayCount   = errors.New("essa carta preta pede um número diferente de cartas")
	ErrNoSuchPlayer     = errors.New("você não está no jogo")
	ErrNoSubmissions    = errors.New("jogada não encontrada")
	ErrNotRevealed      = errors.New("vire a carta antes de escolher")
	ErrDeckNotFound     = errors.New("deck desconhecido")
	ErrEmptyText        = errors.New("a carta escrita não pode ficar vazia")
)

// Phase is where a round, or the game, currently stands.
type Phase string

const (
	// PhaseLobby: people are connecting and picking decks; no round in
	// flight.
	PhaseLobby Phase = "lobby"
	// PhasePlaying: black card is up, players are submitting.
	PhasePlaying Phase = "playing"
	// PhaseJudging: every submission is in, the Czar is choosing.
	PhaseJudging Phase = "judging"
	// PhaseRoundEnd: winner picked, authors revealed, waiting for the
	// Czar to deal the next round.
	PhaseRoundEnd Phase = "roundEnd"
	// PhaseGameOver: someone reached the winning score.
	PhaseGameOver Phase = "gameOver"
)

// HandSize is how many white cards everyone keeps in hand. Dealt at
// every round start, so a late joiner is never stuck short.
const HandSize = 10

// CustomTextLimit bounds write-your-own card text, in runes -- long
// enough for a proper punchline, short enough that one card can't
// monopolise the table (same reasoning as the display-name cap in
// httpapi).
const CustomTextLimit = 120

// Card mirrors decks.Card on the wire.
type Card = decks.Card

// Play is one card a player puts down. Text only matters for
// write-your-own cards; for printed ones the server ignores it.
type Play struct {
	CardID string `json:"cardId"`
	Text   string `json:"text,omitempty"`
}

// Submission is one player's answer to the current black card. Cards
// keeps the original hand cards (a write-your-own card recycles as
// "__", its printed id intact); Lines holds the same plays resolved
// into display text, custom text already substituted.
type Submission struct {
	PlayerID string
	Cards    []Card
	Lines    []string
}

// PlayerState is a player's standing in the game -- what every other
// player is told about them. A disconnected player keeps their score
// and slot; a resume reconnect lights Connected back up. Avatar is the
// player's bonequinho index: handed out once at join and kept for the
// room's whole life, so the same little character always means the
// same person -- on the scoreboard, on their submissions, everywhere.
type PlayerState struct {
	PlayerID  string `json:"peerId"`
	Name      string `json:"name"`
	Avatar    int    `json:"avatar"`
	Score     int    `json:"score"`
	IsCzar    bool   `json:"isCzar"`
	Connected bool   `json:"connected"`
	Submitted bool   `json:"submitted"`
}

// player is the internal record behind PlayerState.
type player struct {
	name       string
	avatar     int
	score      int
	connected  bool
	czar       bool
	submission *Submission
	traded     bool
}

// Game is one room's game. Its zero value (see New) is an empty
// lobby. All methods are safe for concurrent use.
type Game struct {
	mu sync.Mutex

	phase        Phase
	round        int
	decks        []string
	winningScore int

	// players, in join order -- czar rotation follows this slice.
	order   []string
	players map[string]*player

	// The deal. Draw piles are consumed in order; played cards go to
	// the used pile and the pile is reshuffled when it runs dry, so a
	// long game out-lives any single shuffle of the chosen decks.
	whiteDraw []Card
	whiteUsed []Card
	blackDraw []Card
	blackUsed []Card
	hands     map[string][]Card

	blackCard   Card
	blackBlanks int

	// The judging view, built once when judging opens and kept stable
	// afterwards -- a client re-fetching state mid-judging must see the
	// same cards in the same order it was already reading, not a fresh
	// shuffle. judgeOrder[i] is the author of judgeViews[i]; only the
	// views themselves ever leave the server while judging.
	judgeViews  []SubmissionView
	judgeOrder  []string
	winnerID    string

	// Which judge views the Czar has turned face up so far, keyed by
	// view id. Every submission starts face down when judging opens;
	// each Flip is broadcast, so the room reads the table together.
	// Ephemeral by design: judging itself lives only in memory.
	revealed map[string]bool
}

// SubmissionView is one submission on the judging table, as everyone
// sees it. While judging, Lines arrive empty until the Czar has turned
// that card face up (Revealed) -- the id still travels, so every client
// can render the right card back and animate the same turn. Avatar is
// the owner's bonequinho: deliberately visible even face down, since
// the little character standing beside a card IS the authorship signal
// now (names stay off the cards; the scoreboard keeps them).
type SubmissionView struct {
	ID       string   `json:"id"`
	Lines    []string `json:"lines"`
	Avatar   int      `json:"avatar"`
	Revealed bool     `json:"revealed"`
}

// New returns a fresh game in the lobby phase.
func New() *Game {
	return &Game{
		phase:   PhaseLobby,
		players: make(map[string]*player),
		hands:   make(map[string][]Card),
	}
}

// Join adds a player (a room peer) to the game. Anyone may join at any
// time; mid-game they simply wait for the next round's deal, which is
// exactly what a newcomer wants anyway.
func (g *Game) Join(playerID, name string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[playerID]; ok {
		// Resume: same identity back. The name is whatever the server's
		// identity said this time -- a reconnect can't retype it.
		p.name = name
		p.connected = true
		// Leave set their hand aside; a mid-round resume plays the
		// round with a fresh deal, same as any other arrival.
		g.dealIfHandlessLocked(playerID)
		return
	}
	g.players[playerID] = &player{name: name, connected: true, avatar: g.nextAvatarLocked()}
	g.order = append(g.order, playerID)
	g.dealIfHandlessLocked(playerID)
}

// avatarRosterSize must match the client's AVATARS array (see
// cch-frontend's lib/avatars.ts) -- it's how many distinct bonequinhos
// exist to hand out.
const avatarRosterSize = 18

// nextAvatarLocked hands out a random avatar index nobody currently in
// the room holds -- disconnected players included, so a resume
// reconnect (and the scoreboard chip that outlived them) keeps the
// same character. Random, not lowest-first: with the roster this size
// a fixed order would mean the first three people through the door
// always see the same three faces. The client renders
// `avatar % len(roster)`, so indices still wrap gracefully if a room
// somehow outgrows the whole cast. Caller must hold g.mu.
func (g *Game) nextAvatarLocked() int {
	used := make(map[int]bool, len(g.players))
	for _, p := range g.players {
		used[p.avatar] = true
	}
	candidates := make([]int, 0, avatarRosterSize)
	for i := 0; i < avatarRosterSize; i++ {
		if !used[i] {
			candidates = append(candidates, i)
		}
	}
	if len(candidates) == 0 {
		// The whole cast is already on stage (a room bigger than the
		// roster) -- share one at random rather than refuse to seat
		// anyone; avatars.ts's wraparound is exactly for this.
		for i := 0; i < avatarRosterSize; i++ {
			candidates = append(candidates, i)
		}
	}
	if shuffled, err := decks.Shuffle(candidates); err == nil && len(shuffled) > 0 {
		return shuffled[0]
	}
	return candidates[0]
}

// RenamePlayer updates a player's display name mid-game. The next
// broadcast carries it to every scoreboard; hands, scores and the
// round itself are untouched. A resume reconnect also carries a name
// (see Join) -- this is the explicit-rename path only.
func (g *Game) RenamePlayer(playerID, name string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if p, ok := g.players[playerID]; ok {
		p.name = name
	}
}

// dealIfHandlessLocked gives a (re)joiner cards for the round in
// progress. Without this, someone arriving mid-round -- or resuming
// after Leave set their hand aside -- would sit connected with nothing
// to play, and the round would wait forever on a submission that can
// never come. Caller must hold g.mu.
func (g *Game) dealIfHandlessLocked(playerID string) {
	if g.phase != PhasePlaying {
		return
	}
	p := g.players[playerID]
	if p == nil || !p.connected || p.submission != nil || g.czarIDLocked() == playerID {
		return
	}
	g.drawWhiteLocked(playerID, HandSize-len(g.hands[playerID]))
}

// Leave marks a player disconnected and repairs whatever the round was
// doing when they vanished. The boolean says the game fell back to the
// lobby because play became impossible (fewer than a Czar plus one
// submitter); the room broadcasts state either way.
func (g *Game) Leave(playerID string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	p, ok := g.players[playerID]
	if !ok {
		return false
	}
	// Whether they were judging has to be decided before the connected
	// flag flips -- czarIDLocked only counts connected players, and the
	// leaver is about to stop being one.
	wasCzar := g.czarIDLocked() == playerID
	p.connected = false
	p.submission = nil
	p.traded = false
	// Their cards go back into circulation -- a hand left out of the
	// pools would slowly drain the deck in rooms with churn.
	g.whiteUsed = append(g.whiteUsed, g.hands[playerID]...)
	delete(g.hands, playerID)

	switch g.phase {
	case PhaseLobby, PhaseRoundEnd, PhaseGameOver:
		return false
	case PhasePlaying, PhaseJudging:
		if wasCzar {
			// The judge vanished: hand the black card to the next
			// connected player in join order. If that player had already
			// played this round, their play is recycled and they judge
			// instead -- nobody judges their own submission.
			if next := g.rotateCzarLocked(playerID); next != "" {
				if np := g.players[next]; np != nil && np.submission != nil {
					g.whiteUsed = append(g.whiteUsed, np.submission.Cards...)
					np.submission = nil
					if g.phase == PhaseJudging {
						// The frozen judging view still shows the play the
						// new judge just got rid of -- rebuild without it.
						g.openJudgingLocked()
					}
				}
			}
		}
		if g.phase == PhasePlaying && g.allSubmittedLocked() {
			g.openJudgingLocked()
		}
		if g.connectedCountLocked() < 2 {
			g.toLobbyLocked()
			return true
		}
		return false
	}
	return false
}

// Start begins a game with the given decks and winning score. Everyone
// connected at this moment is in; whoever connects later waits for the
// next round's deal.
func (g *Game) Start(callerID string, deckIDs []string, winningScore int) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhaseLobby {
		return ErrWrongPhase
	}
	if g.connectedCountLocked() < 3 {
		return ErrNotEnoughPlayers
	}
	if len(deckIDs) == 0 {
		return ErrDeckNotFound
	}
	var whites, blacks []Card
	for _, id := range deckIDs {
		deck, ok := decks.Get(id)
		if !ok {
			return ErrDeckNotFound
		}
		whites = append(whites, deck.Whites()...)
		blacks = append(blacks, deck.Blacks()...)
	}
	if winningScore < 1 {
		winningScore = 5
	}
	wd, err := decks.Shuffle(whites)
	if err != nil {
		return err
	}
	bd, err := decks.Shuffle(blacks)
	if err != nil {
		return err
	}
	g.decks = append([]string(nil), deckIDs...)
	g.winningScore = winningScore
	g.whiteDraw = wd
	g.whiteUsed = nil
	g.blackDraw = bd
	g.blackUsed = nil
	g.winnerID = ""
	g.judgeViews = nil
	g.judgeOrder = nil
	for _, id := range g.order {
		p := g.players[id]
		p.score = 0
		p.submission = nil
		p.traded = false
		p.czar = false
	}
	g.hands = make(map[string][]Card)

	// The caller -- whoever pressed start -- is the first Czar. Someone
	// has to be, and "whoever pressed the button" is the least
	// surprising choice there is.
	g.round = 0
	return g.startRoundLocked(callerID)
}

// Submit plays white cards for the current black card. Text is only
// read for write-your-own cards; everything else is validated first,
// so a failed submit leaves the hand untouched.
func (g *Game) Submit(playerID string, plays []Play) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhasePlaying {
		return ErrWrongPhase
	}
	if playerID == g.czarIDLocked() {
		return ErrNotYourTurn // the Czar judges, not plays
	}
	p, ok := g.players[playerID]
	if !ok || !p.connected {
		return ErrNoSuchPlayer
	}
	if p.submission != nil {
		return ErrAlreadySubmitted
	}
	if len(plays) != g.blackBlanks {
		return ErrWrongPlayCount
	}

	hand := g.hands[playerID]
	played := make([]Card, 0, len(plays))
	lines := make([]string, 0, len(plays))
	seen := make(map[string]bool, len(plays))
	for _, play := range plays {
		if seen[play.CardID] {
			return ErrCardNotInHand // the same card twice
		}
		seen[play.CardID] = true
		card, ok := findCard(hand, play.CardID)
		if !ok {
			return ErrCardNotInHand
		}
		text := card.Text
		if card.BlankWhite() {
			text = strings.TrimSpace(play.Text)
			if text == "" {
				return ErrEmptyText
			}
			text = truncateRunes(text, CustomTextLimit)
		}
		played = append(played, card)
		lines = append(lines, text)
	}

	// Only now that every play validates do we touch state: pull the
	// cards out of the hand, recycle them, record the submission.
	for _, card := range played {
		hand = removeCard(hand, card.ID)
		g.whiteUsed = append(g.whiteUsed, card)
	}
	g.hands[playerID] = hand
	p.submission = &Submission{PlayerID: playerID, Cards: played, Lines: lines}
	if g.allSubmittedLocked() {
		g.openJudgingLocked()
	}
	return nil
}

// Discard trades one card from the player's hand for a fresh draw --
// once per round, before playing, the original game's one-card swap
// rule.
func (g *Game) Discard(playerID, cardID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhasePlaying {
		return ErrWrongPhase
	}
	if playerID == g.czarIDLocked() {
		return ErrNotYourTurn
	}
	p, ok := g.players[playerID]
	if !ok || !p.connected {
		return ErrNoSuchPlayer
	}
	if p.submission != nil {
		return ErrAlreadySubmitted
	}
	if p.traded {
		return ErrAlreadyTraded
	}
	card, hand, ok := takeCard(g.hands[playerID], cardID)
	if !ok {
		return ErrCardNotInHand
	}
	g.hands[playerID] = hand
	g.whiteUsed = append(g.whiteUsed, card)
	p.traded = true
	g.drawWhiteLocked(playerID, 1)
	return nil
}

// Flip turns one judging-table card face up -- the Czar reading the
// table out loud, one card at a time. The boolean says the flip was a
// change; flipping an already-open card is a no-op (the caller then
// skips the broadcast, so a double-tap doesn't re-spin everyone's
// animation). The turn itself is not the reveal of authorship -- every
// card already carries its owner's avatar face down; this is about
// pacing the reading.
func (g *Game) Flip(callerID, submissionID string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhaseJudging {
		return false, ErrWrongPhase
	}
	if callerID != g.czarIDLocked() {
		return false, ErrNotYourTurn
	}
	found := false
	for _, view := range g.judgeViews {
		if view.ID == submissionID {
			found = true
			break
		}
	}
	if !found {
		return false, ErrNoSubmissions
	}
	if g.revealed[submissionID] {
		return false, nil
	}
	g.revealed[submissionID] = true
	return true, nil
}

// Pick awards the round to the submission the Czar chose, identified
// by the id the judging view handed out. Only face-up submissions can
// be crowned: the flip-first flow is the point of the feature, and a
// crafted message shouldn't shortcut past the room reading together.
func (g *Game) Pick(callerID, submissionID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhaseJudging {
		return ErrWrongPhase
	}
	if callerID != g.czarIDLocked() {
		return ErrNotYourTurn
	}
	for i, view := range g.judgeViews {
		if view.ID != submissionID {
			continue
		}
		if !g.revealed[submissionID] {
			return ErrNotRevealed
		}
		g.winnerID = g.judgeOrder[i]
		winner := g.players[g.winnerID]
		winner.score++
		// Every play of this round is spent -- back into circulation.
		for _, p := range g.players {
			if p.submission != nil {
				g.whiteUsed = append(g.whiteUsed, p.submission.Cards...)
			}
		}
		if winner.score >= g.winningScore {
			g.phase = PhaseGameOver
		} else {
			g.phase = PhaseRoundEnd
		}
		return nil
	}
	return ErrNoSubmissions
}

// Next deals the following round. The Czar's call -- they run the
// table while the round is theirs.
func (g *Game) Next(callerID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhaseRoundEnd {
		return ErrWrongPhase
	}
	if callerID != g.czarIDLocked() {
		return ErrNotYourTurn
	}
	return g.startRoundLocked("")
}

// Skip abandons the current round without awarding anything -- the
// Czar's escape hatch when someone went AFK. Nothing is scored; the
// black card goes back into the draw pile.
func (g *Game) Skip(callerID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhasePlaying && g.phase != PhaseJudging {
		return ErrWrongPhase
	}
	if callerID != g.czarIDLocked() {
		return ErrNotYourTurn
	}
	// Straight back into the draw pile -- NOT the used pile, or the
	// same card would exist twice in circulation once the pile
	// reshuffles.
	g.blackDraw = append(g.blackDraw, g.blackCard)
	shuffled, err := decks.Shuffle(g.blackDraw)
	if err != nil {
		return err
	}
	g.blackDraw = shuffled
	return g.startRoundLocked("")
}

// Reset sends the game back to the lobby. Anyone may call it once the
// game is over -- a room has no owner, same as tela's rooms.
func (g *Game) Reset(callerID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.phase != PhaseGameOver {
		return ErrWrongPhase
	}
	g.toLobbyLocked()
	return nil
}

// Caller must hold g.mu.
func (g *Game) toLobbyLocked() {
	g.phase = PhaseLobby
	g.round = 0
	g.blackCard = Card{}
	g.blackBlanks = 0
	g.whiteDraw = nil
	g.whiteUsed = nil
	g.blackDraw = nil
	g.blackUsed = nil
	g.winnerID = ""
	g.judgeViews = nil
	g.judgeOrder = nil
	for _, p := range g.players {
		p.score = 0
		p.submission = nil
		p.traded = false
		p.czar = false
	}
	g.hands = make(map[string][]Card)
	g.revealed = nil
}

// startRoundLocked deals a fresh round: rotate the Czar, draw a black
// card, top up every connected player's hand. Caller must hold g.mu.
func (g *Game) startRoundLocked(czarID string) error {
	for _, p := range g.players {
		p.submission = nil
		p.traded = false
	}
	g.judgeViews = nil
	g.judgeOrder = nil
	g.winnerID = ""
	g.revealed = nil

	if czarID != "" {
		if p := g.players[czarID]; p == nil || !p.connected {
			czarID = ""
		}
	}
	if czarID != "" {
		g.setCzarLocked(czarID)
	} else {
		g.rotateCzarLocked("")
	}

	var connected []string
	for _, id := range g.order {
		if p := g.players[id]; p != nil && p.connected {
			connected = append(connected, id)
		}
	}
	if len(connected) < 2 {
		// A Czar needs at least one player to judge. Back to the lobby;
		// scores keep for whoever restarts with company.
		g.toLobbyLocked()
		return ErrNotEnoughPlayers
	}

	black, err := g.drawBlackLocked()
	if err != nil {
		return err
	}
	g.blackCard = black
	g.blackBlanks = decks.Blanks(black)
	g.round++

	czar := g.czarIDLocked()
	for _, id := range connected {
		if id == czar {
			// The Czar holds no hand while judging: whatever they kept
			// from earlier rounds goes back into circulation, and they
			// draw fresh when their turn to play comes around.
			g.whiteUsed = append(g.whiteUsed, g.hands[id]...)
			delete(g.hands, id)
			continue
		}
		g.drawWhiteLocked(id, HandSize-len(g.hands[id]))
	}
	g.phase = PhasePlaying
	return nil
}

// openJudgingLocked freezes the round's judging view: stable ids,
// shuffled once. Views and authors travel together -- the shuffle must
// not decouple a submission from whoever played it. Every view opens
// face down (fresh revealed set): the Czar turns them one by one from
// here. Caller must hold g.mu.
func (g *Game) openJudgingLocked() {
	pairs := make([]struct {
		view   SubmissionView
		author string
	}, 0, len(g.order))
	for _, id := range g.order {
		p := g.players[id]
		if p == nil || p.submission == nil {
			continue
		}
		pairs = append(pairs, struct {
			view   SubmissionView
			author string
		}{SubmissionView{ID: fmt.Sprintf("s%d", len(pairs)), Lines: p.submission.Lines}, id})
	}
	shuffled, err := decks.Shuffle(pairs)
	if err != nil {
		// A crypto failure would only affect presentation order --
		// degenerate, not fatal.
		shuffled = pairs
	}
	g.judgeViews = make([]SubmissionView, len(shuffled))
	g.judgeOrder = make([]string, len(shuffled))
	for i, s := range shuffled {
		g.judgeViews[i] = s.view
		g.judgeOrder[i] = s.author
	}
	g.revealed = make(map[string]bool, len(shuffled))
	g.phase = PhaseJudging
}

// drawBlackLocked pops the next black card, reshuffling used ones when
// the pile runs dry. Caller must hold g.mu.
func (g *Game) drawBlackLocked() (Card, error) {
	if len(g.blackDraw) == 0 {
		g.blackDraw = g.blackUsed
		g.blackUsed = nil
		if len(g.blackDraw) == 0 {
			return Card{}, errors.New("nenhuma carta preta disponível")
		}
		shuffled, err := decks.Shuffle(g.blackDraw)
		if err != nil {
			return Card{}, err
		}
		g.blackDraw = shuffled
	}
	card := g.blackDraw[0]
	g.blackDraw = g.blackDraw[1:]
	g.blackUsed = append(g.blackUsed, card)
	return card, nil
}

// drawWhiteLocked tops a player's hand up by n cards. Caller must hold
// g.mu.
func (g *Game) drawWhiteLocked(playerID string, n int) {
	for i := 0; i < n; i++ {
		if len(g.whiteDraw) == 0 {
			g.whiteDraw = g.whiteUsed
			g.whiteUsed = nil
			if len(g.whiteDraw) == 0 {
				// Every played card is already back in circulation, so
				// this only happens in pathological rooms. Leave the hand
				// short rather than spinning forever.
				return
			}
			shuffled, err := decks.Shuffle(g.whiteDraw)
			if err != nil {
				return
			}
			g.whiteDraw = shuffled
		}
		card := g.whiteDraw[0]
		g.whiteDraw = g.whiteDraw[1:]
		g.hands[playerID] = append(g.hands[playerID], card)
	}
}

// Caller must hold g.mu.
func (g *Game) allSubmittedLocked() bool {
	czar := g.czarIDLocked()
	for _, id := range g.order {
		p := g.players[id]
		if p == nil || !p.connected || id == czar {
			continue
		}
		if p.submission == nil {
			return false
		}
	}
	return true
}

// Caller must hold g.mu.
func (g *Game) connectedCountLocked() int {
	n := 0
	for _, p := range g.players {
		if p.connected {
			n++
		}
	}
	return n
}

// Caller must hold g.mu.
func (g *Game) czarIDLocked() string {
	for _, id := range g.order {
		if p := g.players[id]; p != nil && p.connected && p.czar {
			return id
		}
	}
	return ""
}

// setCzarLocked makes `id` the Czar, clearing everyone else. Caller
// must hold g.mu.
func (g *Game) setCzarLocked(id string) {
	for pid, p := range g.players {
		p.czar = pid == id
	}
}

// rotateCzarLocked advances the Czar to the next connected player in
// join order, returning who that is ("" when nobody else is connected,
// which leaves the caller to fall back to the lobby). The search starts
// just past `from` -- the leaving Czar's position -- or, when `from` is
// empty, just past the current Czar's. Caller must hold g.mu.
func (g *Game) rotateCzarLocked(from string) string {
	start := -1
	if from != "" {
		start = indexOf(g.order, from)
	} else if cur := g.czarIDLocked(); cur != "" {
		start = indexOf(g.order, cur)
	}
	if start < 0 {
		// No anchor: search from the front, wrapping to zero first.
		start = len(g.order) - 1
	}
	for step := 1; step <= len(g.order); step++ {
		id := g.order[(start+step)%len(g.order)]
		if p := g.players[id]; p != nil && p.connected {
			g.setCzarLocked(id)
			return id
		}
	}
	// Nobody else is connected. The caller falls back to the lobby.
	return ""
}

func indexOf(items []string, want string) int {
	for i, s := range items {
		if s == want {
			return i
		}
	}
	return -1
}

// judgeViewsForLocked copies the frozen judging table for the wire,
// stamping each view with its author's avatar (the copy, never the
// stored view -- the stored Lines must survive for the reveal). While
// judging (`hideUnrevealed`) a card the czar hasn't turned yet travels
// without its lines; at the reveal everything goes out open. Caller
// must hold g.mu.
func (g *Game) judgeViewsForLocked(hideUnrevealed bool) []SubmissionView {
	out := make([]SubmissionView, len(g.judgeViews))
	for i, view := range g.judgeViews {
		out[i] = view
		if author := g.players[g.judgeOrder[i]]; author != nil {
			out[i].Avatar = author.avatar
		}
		if hideUnrevealed && !g.revealed[view.ID] {
			out[i].Lines = nil
			out[i].Revealed = false
		} else {
			out[i].Revealed = true
		}
	}
	return out
}

// State is the per-viewer snapshot the WebSocket sends on every change.
// Fields the viewer shouldn't see -- other players' hands -- are simply
// absent from their copy. Authorship is deliberately NOT hidden: every
// submission carries its owner's avatar, and cards reach the table face
// down with that badge already showing (see SubmissionView).
type State struct {
	Phase        Phase           `json:"phase"`
	Round        int             `json:"round"`
	Decks        []string        `json:"decks"`
	WinningScore int             `json:"winningScore"`
	Players      []PlayerState   `json:"players"`
	BlackCard    *Card           `json:"blackCard"`
	BlackBlanks  int             `json:"blackBlanks"`
	MyLines      []string        `json:"myLines,omitempty"`
	MyTraded     bool            `json:"myTraded"`
	Submissions  []SubmissionView `json:"submissions,omitempty"`
	// When the round is over, which entry inside Submissions won. The
	// client highlights it by id -- matching by text could collide when
	// two write-your-own answers say the same thing.
	WinnerSubmissionID string        `json:"winnerSubmissionId,omitempty"`
	Winner             *WinnerView   `json:"winner,omitempty"`
	GameWinner         *WinnerView   `json:"gameWinner,omitempty"`
}

// WinnerView is a revealed winner: who they are and what they played.
// Avatar rides along so the client can put the winner's bonequinho on
// stage without joining against the players list.
type WinnerView struct {
	PlayerID string   `json:"peerId"`
	Name     string   `json:"name"`
	Avatar   int      `json:"avatar"`
	Lines    []string `json:"lines"`
}

// Snapshot builds the viewer's copy of the game state. Hands travel
// separately -- see Hand -- so reconnects can send one without the
// other.
func (g *Game) Snapshot(viewerID string) State {
	g.mu.Lock()
	defer g.mu.Unlock()

	st := State{
		Phase:        g.phase,
		Decks:        g.deckIDsLocked(),
		WinningScore: g.winningScore,
	}
	st.Round = g.round

	players := make([]PlayerState, 0, len(g.order))
	czar := g.czarIDLocked()
	for _, id := range g.order {
		p := g.players[id]
		if p == nil {
			continue
		}
		players = append(players, PlayerState{
			PlayerID:  id,
			Name:      p.name,
			Avatar:    p.avatar,
			Score:     p.score,
			IsCzar:    id == czar,
			Connected: p.connected,
			Submitted: p.submission != nil,
		})
	}
	st.Players = players

	if g.blackCard.Text != "" {
		card := g.blackCard
		st.BlackCard = &card
		st.BlackBlanks = g.blackBlanks
	}

	me := g.players[viewerID]
	if me != nil {
		st.MyTraded = me.traded
	}

	switch g.phase {
	case PhasePlaying:
		if me != nil && me.submission != nil {
			st.MyLines = me.submission.Lines
		}
	case PhaseJudging:
		// Everyone sees the table while the czar works through it: cards
		// start face down, and each turn the czar makes is broadcast so
		// the room reads along together. Authorship travels as the
		// owner's avatar -- the bonequinho standing beside the card IS
		// the ownership marker now -- so MyLines is only how a player
		// double-checks which face-up entry is theirs.
		st.Submissions = g.judgeViewsForLocked(true)
		if me != nil && me.submission != nil {
			st.MyLines = me.submission.Lines
		}
	case PhaseRoundEnd, PhaseGameOver:
		// The full table stays up through the reveal so the room can
		// relive every answer; the winner's entry is called out by id.
		st.Submissions = g.judgeViewsForLocked(false)
		if g.winnerID != "" {
			for i, author := range g.judgeOrder {
				if author == g.winnerID && i < len(g.judgeViews) {
					st.WinnerSubmissionID = g.judgeViews[i].ID
					break
				}
			}
			p := g.players[g.winnerID]
			if p != nil && p.submission != nil {
				lines := append([]string(nil), p.submission.Lines...)
				st.Winner = &WinnerView{PlayerID: g.winnerID, Name: p.name, Avatar: p.avatar, Lines: lines}
			}
		}
		if g.phase == PhaseGameOver && g.winnerID != "" {
			p := g.players[g.winnerID]
			st.GameWinner = &WinnerView{PlayerID: g.winnerID, Name: p.name, Avatar: p.avatar}
		}
	}
	return st
}

// Hand is the viewer's own white cards, ordered by id so the client
// never re-shuffles a hand the player is mid-read.
func (g *Game) Hand(viewerID string) []Card {
	g.mu.Lock()
	defer g.mu.Unlock()
	hand := g.hands[viewerID]
	out := make([]Card, len(hand))
	copy(out, hand)
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Caller must hold g.mu.
func (g *Game) deckIDsLocked() []string {
	if len(g.decks) == 0 {
		return []string{}
	}
	return append([]string(nil), g.decks...)
}

func findCard(hand []Card, id string) (Card, bool) {
	for _, c := range hand {
		if c.ID == id {
			return c, true
		}
	}
	return Card{}, false
}

// takeCard finds a card and returns it together with the hand without
// it. A failed lookup returns the hand untouched.
func takeCard(hand []Card, id string) (Card, []Card, bool) {
	for i, c := range hand {
		if c.ID != id {
			continue
		}
		out := make([]Card, 0, len(hand)-1)
		out = append(out, hand[:i]...)
		out = append(out, hand[i+1:]...)
		return c, out, true
	}
	return Card{}, hand, false
}

func removeCard(hand []Card, id string) []Card {
	_, out, _ := takeCard(hand, id)
	return out
}

// truncateRunes bounds text in runes, not bytes -- cutting must not
// land inside a multi-byte character (an accented letter, an emoji).
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}