package decks

import (
	"slices"
	"testing"
)

// Regression for a nasty one: the rejection limit was computed with
// uint32 arithmetic, so for any span that divides 2^32 evenly (every
// power of two -- and shuffling a 72-card deck passes through span 64)
// the limit overflowed to 0 and rejected every draw forever. The
// symptom was a shuffle that never returned. Sizes here deliberately
// include the powers of two on both sides of a real deal, plus a
// 300-card combined pile bigger than a single 4-byte... well, bigger
// than anything a room will deal.
func TestShuffleIsAPermutationAndTerminates(t *testing.T) {
	for _, n := range []int{1, 2, 3, 4, 8, 16, 31, 32, 63, 64, 65, 71, 72, 100, 128, 129, 255, 256, 257, 300} {
		items := make([]int, n)
		for i := range items {
			items[i] = i
		}
		shuffled, err := Shuffle(items)
		if err != nil {
			t.Fatalf("Shuffle(%d): %v", n, err)
		}
		if len(shuffled) != n {
			t.Fatalf("Shuffle(%d): length = %d", n, len(shuffled))
		}
		want := make([]int, n)
		for i := range want {
			want[i] = i
		}
		slices.Sort(shuffled)
		if !slices.Equal(shuffled, want) {
			t.Fatalf("Shuffle(%d) is not a permutation of its input", n)
		}
	}
}

// The deal must not be a no-op: for a decent-sized pile, a correct
// Fisher-Yates leaves almost nothing where it started (expected fixed
// points = 1). This can't fail for a merely lucky-but-biased shuffle,
// but it would catch one that does nothing at all.
func TestShuffleActuallyShuffles(t *testing.T) {
	n := 200
	items := make([]int, n)
	for i := range items {
		items[i] = i
	}
	shuffled, err := Shuffle(items)
	if err != nil {
		t.Fatalf("Shuffle: %v", err)
	}
	fixed := 0
	for i := range shuffled {
		if shuffled[i] == i {
			fixed++
		}
	}
	// Expected fixed points for a uniform shuffle of 200 is 1; 20 would
	// be wildly improbable for a real shuffle.
	if fixed > 20 {
		t.Fatalf("shuffle looks like a no-op: %d of %d cards stayed put", fixed, n)
	}
}