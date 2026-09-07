package game

import (
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/cch-api/internal/decks"
)

func joinAll(t *testing.T, g *Game, ids ...string) {
	t.Helper()
	for _, id := range ids {
		g.Join(id, "Pessoa "+strings.ToUpper(id))
	}
}

// mustStart is the boilerplate every flow test shares: three players,
// every deck, no winning score cap.
func mustStart(t *testing.T, g *Game, caller string) {
	t.Helper()
	ids := decks.All()
	deckIDs := make([]string, 0, len(ids))
	for _, d := range ids {
		deckIDs = append(deckIDs, d.ID)
	}
	if err := g.Start(caller, deckIDs, 99); err != nil {
		t.Fatalf("Start: %v", err)
	}
}

func TestStartRequiresThreePlayers(t *testing.T) {
	g := New()
	g.Join("a", "A")
	g.Join("b", "B")
	ids := []string{"classico"}
	if err := g.Start("a", ids, 5); err != ErrNotEnoughPlayers {
		t.Fatalf("Start with 2 players: got %v, want ErrNotEnoughPlayers", err)
	}
	g.Join("c", "C")
	if err := g.Start("a", ids, 5); err != nil {
		t.Fatalf("Start with 3 players: %v", err)
	}
	if g.Snapshot("a").Phase != PhasePlaying {
		t.Fatal("phase after start should be playing")
	}
}

func TestStartRefusesUnknownDeck(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	if err := g.Start("a", []string{"nao-existe"}, 5); err != ErrDeckNotFound {
		t.Fatalf("got %v, want ErrDeckNotFound", err)
	}
}

func TestFullRoundFlow(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	st := g.Snapshot("b")
	if st.BlackCard == nil || st.BlackCard.Text == "" {
		t.Fatal("black card should be dealt")
	}
	if st.BlackBlanks < 1 {
		t.Fatalf("black card %q should have at least one blank", st.BlackCard.Text)
	}
	if len(g.Snapshot("a").Players) != 3 {
		t.Fatal("three players expected")
	}

	// The Czar holds no hand; the others hold HandSize.
	aHand := g.Hand("a")
	if len(aHand) != 0 {
		t.Fatalf("czar's hand should be empty, got %d", len(aHand))
	}
	for _, id := range []string{"b", "c"} {
		if len(g.Hand(id)) != HandSize {
			t.Fatalf("%s hand = %d, want %d", id, len(g.Hand(id)), HandSize)
		}
	}

	// A player cannot submit the wrong number of cards -- one more than
	// the black card asks for, whatever that count is.
	if err := g.Submit("b", make([]Play, st.BlackBlanks+1)); err != ErrWrongPlayCount {
		t.Fatalf("%d cards for %d blanks: got %v", st.BlackBlanks+1, st.BlackBlanks, err)
	}

	// Playing a card you don't hold fails without touching the hand.
	if err := g.Submit("b", []Play{{CardID: "nope-w-999"}}); err != ErrCardNotInHand {
		t.Fatalf("got %v, want ErrCardNotInHand", err)
	}

	// Everyone but the Czar submits; then judging opens.
	handB := g.Hand("b")
	plays := make([]Play, st.BlackBlanks)
	for i := range plays {
		plays[i] = Play{CardID: handB[i].ID}
	}
	if err := g.Submit("b", plays); err != nil {
		t.Fatalf("Submit b: %v", err)
	}
	// The played cards leave the hand immediately.
	if len(g.Hand("b")) != HandSize-st.BlackBlanks {
		t.Fatalf("hand after submit = %d", len(g.Hand("b")))
	}
	if err := g.Submit("b", plays); err != ErrAlreadySubmitted {
		t.Fatalf("double submit: got %v", err)
	}

	// Judging does not open while anyone can still play.
	if g.Snapshot("a").Phase == PhaseJudging {
		t.Fatal("judging opened before every player submitted")
	}
	handC := g.Hand("c")
	plays = make([]Play, st.BlackBlanks)
	for i := range plays {
		plays[i] = Play{CardID: handC[i].ID}
	}
	if err := g.Submit("c", plays); err != nil {
		t.Fatalf("Submit c: %v", err)
	}
	if g.Snapshot("a").Phase != PhaseJudging {
		t.Fatal("judging should open once everyone submitted")
	}

	// The Czar sees submissions; the players don't.
	if got := g.Snapshot("a").Submissions; len(got) != 2 {
		t.Fatalf("czar submissions = %d, want 2", len(got))
	}
	if got := g.Snapshot("b").Submissions; got != nil {
		t.Fatalf("non-czar should see no submissions, got %v", got)
	}

	// Only the Czar can pick.
	if err := g.Pick("b", g.Snapshot("a").Submissions[0].ID); err != ErrNotYourTurn {
		t.Fatalf("non-czar pick: got %v", err)
	}
	first := g.Snapshot("a").Submissions[0]
	if err := g.Pick("a", first.ID); err != nil {
		t.Fatalf("Pick: %v", err)
	}
	if g.Snapshot("a").Phase != PhaseRoundEnd {
		t.Fatal("phase after pick should be roundEnd")
	}

	// The winner is whoever played the picked submission, and they have
	// a point. Reveal the mapping directly through a fresh round.
	st = g.Snapshot("a")
	if st.Winner == nil || st.Winner.Lines == nil || len(st.Winner.Lines) != st.BlackBlanks {
		t.Fatalf("winner reveal = %+v", st.Winner)
	}

	// Only the Czar can advance.
	if err := g.Next("b"); err != ErrNotYourTurn {
		t.Fatalf("non-czar next: got %v", err)
	}
	if err := g.Next("a"); err != nil {
		t.Fatalf("Next: %v", err)
	}
	if g.Snapshot("a").Phase != PhasePlaying {
		t.Fatal("phase after next should be playing")
	}
	// The Czar rotated a -> b, so b now holds no hand and c's hand was
	// dealt fresh.
	if len(g.Hand("b")) != 0 {
		t.Fatalf("new czar's hand = %d, want 0", len(g.Hand("b")))
	}
	if len(g.Hand("c")) != HandSize {
		t.Fatalf("hand after refill = %d, want %d", len(g.Hand("c")), HandSize)
	}
}

// The Czar must rotate through join order, and a reconnecting czar
// keeps their identity.
func TestCzarRotatesInJoinOrder(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	if !g.Snapshot("a").Players[0].IsCzar {
		t.Fatal("starter should be czar first")
	}
	// Fast-forward through two full rounds with minimal plays.
	for round := 0; round < 2; round++ {
		st := g.Snapshot("a")
		if st.Phase != PhasePlaying {
			t.Fatalf("phase = %s", st.Phase)
		}
		var czar string
		for _, p := range st.Players {
			if p.IsCzar {
				czar = p.PlayerID
			}
		}
		for _, p := range st.Players {
			if p.PlayerID == czar || p.Submitted {
				continue
			}
			hand := g.Hand(p.PlayerID)
			plays := make([]Play, st.BlackBlanks)
			for i := range plays {
				plays[i] = Play{CardID: hand[i].ID}
			}
			if err := g.Submit(p.PlayerID, plays); err != nil {
				t.Fatalf("round %d Submit %s: %v", round, p.PlayerID, err)
			}
		}
		pick := g.Snapshot(czar).Submissions[0].ID
		if err := g.Pick(czar, pick); err != nil {
			t.Fatalf("round %d Pick: %v", round, err)
		}
		if err := g.Next(czar); err != nil {
			t.Fatalf("round %d Next: %v", round, err)
		}
	}
	// Join order a, b, c: after a, then b, the czar in round 3 is c.
	var czar string
	for _, p := range g.Snapshot("a").Players {
		if p.IsCzar {
			czar = p.PlayerID
		}
	}
	if czar != "c" {
		t.Fatalf("round 3 czar = %s, want c", czar)
	}
}

func TestGameEndsAtWinningScore(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	if err := g.Start("a", []string{"classico"}, 1); err != nil {
		t.Fatalf("Start: %v", err)
	}

	submitAll(t, g)
	pick := g.Snapshot("a").Submissions[0].ID
	if err := g.Pick("a", pick); err != nil {
		t.Fatalf("Pick: %v", err)
	}
	// With winningScore 1 the pick ends the game outright; the winner
	// is whoever the picked submission belonged to -- identifiable as
	// the one player holding a point.
	winnerID := ""
	for _, p := range g.Snapshot("a").Players {
		if p.Score == 1 {
			winnerID = p.PlayerID
		}
	}
	if winnerID == "" {
		t.Fatal("no player scored")
	}
	if g.Snapshot("a").Phase != PhaseGameOver {
		t.Fatalf("phase = %s, want gameOver", g.Snapshot("a").Phase)
	}
	if g.Snapshot("a").GameWinner == nil || g.Snapshot("a").GameWinner.PlayerID != winnerID {
		t.Fatalf("gameWinner = %+v", g.Snapshot("a").GameWinner)
	}

	// Reset back to the lobby once it's over.
	if err := g.Reset("b"); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	if g.Snapshot("a").Phase != PhaseLobby {
		t.Fatal("phase after reset should be lobby")
	}
	if g.Snapshot("a").Players[0].Score != 0 {
		t.Fatal("scores should clear on reset")
	}
}

// Skip awards nothing and deals the next round.
func TestSkip(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	blackBefore := g.Snapshot("a").BlackCard.Text
	if err := g.Skip("b"); err != ErrNotYourTurn {
		t.Fatalf("non-czar skip: got %v", err)
	}
	if err := g.Skip("a"); err != nil {
		t.Fatalf("Skip: %v", err)
	}
	st := g.Snapshot("a")
	if st.Phase != PhasePlaying {
		t.Fatalf("phase after skip = %s", st.Phase)
	}
	if st.Round != 2 {
		t.Fatalf("round after skip = %d, want 2", st.Round)
	}
	for _, p := range st.Players {
		if p.Score != 0 {
			t.Fatal("skip must not score")
		}
	}
	if st.BlackCard == nil || st.BlackCard.Text == "" {
		t.Fatal("a black card should be dealt after skip")
	}
	_ = blackBefore // the black card may legitimately repeat; no assertion on it
}

// The Czar leaving mid-judging hands judging to the next player, who
// must not end up judging their own submission.
func TestCzarLeavesMidJudging(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a") // a is czar

	// b and c submit.
	for _, id := range []string{"b", "c"} {
		hand := g.Hand(id)
		plays := make([]Play, g.Snapshot("a").BlackBlanks)
		for i := range plays {
			plays[i] = Play{CardID: hand[i].ID}
		}
		if err := g.Submit(id, plays); err != nil {
			t.Fatalf("Submit %s: %v", id, err)
		}
	}
	if g.Snapshot("a").Phase != PhaseJudging {
		t.Fatal("expected judging")
	}

	// The czar leaves; b (next in order) judges. b's own play is
	// recycled -- nobody judges their own submission -- so exactly one
	// submission (c's) remains in the frozen view.
	g.Leave("a")
	st := g.Snapshot("b")
	if st.Phase != PhaseJudging {
		t.Fatalf("phase after czar leave = %s", st.Phase)
	}
	if len(st.Submissions) != 1 {
		t.Fatalf("submissions = %d, want 1 (c's; b's own play was recycled)", len(st.Submissions))
	}
	if err := g.Pick("b", st.Submissions[0].ID); err != nil {
		t.Fatalf("Pick by new czar: %v", err)
	}
}

// A player leaving mid-round doesn't stall it: the round advances once
// the remaining players have all submitted.
func TestPlayerLeaveAdvancesRound(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	// a is the czar. c leaves without playing; b submits -> judging.
	g.Leave("c")
	hand := g.Hand("b")
	plays := make([]Play, g.Snapshot("a").BlackBlanks)
	for i := range plays {
		plays[i] = Play{CardID: hand[i].ID}
	}
	if err := g.Submit("b", plays); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if g.Snapshot("a").Phase != PhaseJudging {
		t.Fatalf("phase = %s, want judging", g.Snapshot("a").Phase)
	}
	// Only b's submission is in the judging view -- c left without
	// playing.
	if len(g.Snapshot("a").Submissions) != 1 {
		t.Fatalf("submissions = %d, want 1", len(g.Snapshot("a").Submissions))
	}
}

// Someone arriving mid-round is dealt in immediately; the round then
// waits for their submission like anyone else's.
func TestMidRoundJoinGetsHand(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	g.Join("d", "D")
	if len(g.Hand("d")) != HandSize {
		t.Fatalf("mid-round join hand = %d, want %d", len(g.Hand("d")), HandSize)
	}

	// b and c play; judging must not open -- d is in the round now.
	for _, id := range []string{"b", "c"} {
		hand := g.Hand(id)
		plays := make([]Play, g.Snapshot("a").BlackBlanks)
		for i := range plays {
			plays[i] = Play{CardID: hand[i].ID}
		}
		if err := g.Submit(id, plays); err != nil {
			t.Fatalf("Submit %s: %v", id, err)
		}
	}
	if g.Snapshot("a").Phase == PhaseJudging {
		t.Fatal("judging opened before the mid-round joiner played")
	}
	hand := g.Hand("d")
	plays := make([]Play, g.Snapshot("a").BlackBlanks)
	for i := range plays {
		plays[i] = Play{CardID: hand[i].ID}
	}
	if err := g.Submit("d", plays); err != nil {
		t.Fatalf("Submit d: %v", err)
	}
	if g.Snapshot("a").Phase != PhaseJudging {
		t.Fatal("judging should open once the joiner submits")
	}
}

// A resumed connection comes back with a fresh hand after Leave set
// the old one aside.
func TestResumeAfterLeaveRedealsHand(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	g.Leave("b")
	g.Join("b", "B")
	if len(g.Hand("b")) != HandSize {
		t.Fatalf("resumed hand = %d, want %d", len(g.Hand("b")), HandSize)
	}
	// And b is expected to play again: judging only opens once the
	// resumed player has submitted too.
	for _, id := range []string{"b", "c"} {
		hand := g.Hand(id)
		plays := make([]Play, g.Snapshot("a").BlackBlanks)
		for i := range plays {
			plays[i] = Play{CardID: hand[i].ID}
		}
		if err := g.Submit(id, plays); err != nil {
			t.Fatalf("Submit %s: %v", id, err)
		}
	}
	if g.Snapshot("a").Phase != PhaseJudging {
		t.Fatal("judging should open once everyone, resumed player included, submitted")
	}
}
func TestTooFewPlayersFallsBackToLobby(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	g.Leave("b")
	g.Leave("c")
	st := g.Snapshot("a")
	if st.Phase != PhaseLobby {
		t.Fatalf("phase = %s, want lobby", st.Phase)
	}
}

// Write-your-own cards resolve to the player's text.
func TestBlankWhiteCards(t *testing.T) {
	g := riggedBlankGame(t)

	blankID := ""
	for _, c := range g.Hand("b") {
		if c.BlankWhite() {
			blankID = c.ID
		}
	}
	if blankID == "" {
		t.Fatal("rigged game should deal a blank card to b")
	}
	if err := g.Submit("b", []Play{{CardID: blankID, Text: "  um gato sem vergonha  "}}); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	hand := g.Hand("c")
	plays := make([]Play, g.Snapshot("a").BlackBlanks)
	for i := range plays {
		plays[i] = Play{CardID: hand[i].ID}
	}
	if err := g.Submit("c", plays); err != nil {
		t.Fatalf("Submit c: %v", err)
	}
	found := false
	for _, v := range g.Snapshot("a").Submissions {
		if len(v.Lines) == 1 && v.Lines[0] == "um gato sem vergonha" {
			found = true
		}
	}
	if !found {
		t.Fatalf("blank text not resolved in submissions: %+v", g.Snapshot("a").Submissions)
	}

	// An empty write-your-own text is rejected.
	g2 := riggedBlankGame(t)
	if err := g2.Submit("b", []Play{{CardID: blankID, Text: "   "}}); err != ErrEmptyText {
		t.Fatalf("blank submit with empty text: got %v", err)
	}
}

// riggedBlankGame builds a one-blank round guaranteed to deal a blank
// card to b: both the black card and b's hand are set directly.
// Reaching into internals is fine from the same package, and a
// deterministic test beats hoping a random deal cooperates.
func riggedBlankGame(t *testing.T) *Game {
	t.Helper()
	g := New()
	joinAll(t, g, "a", "b", "c")
	if err := g.Start("a", []string{"classico"}, 99); err != nil {
		t.Fatalf("Start: %v", err)
	}
	g.blackCard = decks.Card{ID: "classico-b-test", Text: "Aqui jaz quem morreu de _."}
	g.blackBlanks = 1
	blank := decks.Card{ID: "classico-w-blank-test", Text: decks.BlankWhiteText}
	g.hands["b"] = append([]decks.Card{blank}, g.hands["b"]...)
	return g
}

func TestDiscardOncePerRound(t *testing.T) {
	g := New()
	joinAll(t, g, "a", "b", "c")
	mustStart(t, g, "a")

	hand := g.Hand("b")
	discarded := hand[0].ID
	if err := g.Discard("b", discarded); err != nil {
		t.Fatalf("Discard: %v", err)
	}
	next := g.Hand("b")
	for _, c := range next {
		if c.ID == discarded {
			t.Fatal("discarded card should have left the hand")
		}
	}
	if len(next) != HandSize {
		t.Fatalf("hand after trade = %d, want %d", len(next), HandSize)
	}
	if err := g.Discard("b", next[0].ID); err != ErrAlreadyTraded {
		t.Fatalf("second trade: got %v", err)
	}
	// The Czar cannot trade -- and holds no hand to trade from anyway.
	if err := g.Discard("a", "classico-w-0"); err != ErrNotYourTurn {
		t.Fatalf("czar trade: got %v", err)
	}
}

// submitAll submits every non-czar connected player, using whatever
// their hand holds.
func submitAll(t *testing.T, g *Game) {
	t.Helper()
	st := g.Snapshot("anyone")
	for _, p := range st.Players {
		if p.IsCzar || p.Submitted || !p.Connected {
			continue
		}
		hand := g.Hand(p.PlayerID)
		plays := make([]Play, st.BlackBlanks)
		for i := range plays {
			plays[i] = Play{CardID: hand[i].ID}
		}
		if err := g.Submit(p.PlayerID, plays); err != nil {
			t.Fatalf("Submit %s: %v", p.PlayerID, err)
		}
	}
}

func TestDeckContentsAreSane(t *testing.T) {
	all := decks.All()
	if len(all) < 3 {
		t.Fatalf("expected at least 3 decks, got %d", len(all))
	}
	for _, d := range all {
		if len(d.Whites()) < 20 || len(d.Blacks()) < 5 {
			t.Errorf("deck %s too small: %d whites, %d blacks", d.ID, len(d.Whites()), len(d.Blacks()))
		}
		for _, b := range d.Blacks() {
			if decks.Blanks(b) < 1 {
				t.Errorf("black card %q in %s has no blank", b.Text, d.ID)
			}
		}
		seen := map[string]bool{}
		for _, w := range d.Whites() {
			// Every deck carries a couple of write-your-own cards with
			// the same "__" text by design (see decks.go) -- those are
			// the one duplicate allowed here.
			if seen[w.Text] && w.Text != decks.BlankWhiteText {
				t.Errorf("deck %s repeats white card %q", d.ID, w.Text)
			}
			seen[w.Text] = true
		}
	}
}