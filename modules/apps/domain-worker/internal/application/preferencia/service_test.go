package preferencia

import (
	"context"
	"testing"

	domainpref "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/preferencia"
)

// stubRepo implements domainpref.Repository by embedding the interface and
// overriding only the three methods the claim path touches. Anything else
// panics loudly rather than silently returning zero values.
type stubRepo struct {
	domainpref.Repository

	claimed  domainpref.ProReivindicado
	watches  []domainpref.WatchEntry
	claimErr error
	watchErr error
}

func (r *stubRepo) UpsertClaimed(_ context.Context, p domainpref.ProReivindicado) error {
	r.claimed = p
	return r.claimErr
}

func (r *stubRepo) SetWatchWithOrigem(_ context.Context, e domainpref.WatchEntry) error {
	r.watches = append(r.watches, e)
	return r.watchErr
}

func (r *stubRepo) ListWatch(context.Context, string) ([]domainpref.WatchEntry, error) {
	return nil, nil
}

// Claiming a pro is how a person says where they play. The club must become a
// FOLLOWED club with origem "proprio" -- that is what the sync's level 1 reads.
// Without it the login syncs from an empty watchlist and discovers nothing.
func TestClaimProAlsoFollowsTheClubAsProprio(t *testing.T) {
	repo := &stubRepo{}
	svc := NewService(repo)

	err := svc.ClaimPro(context.Background(), ClaimProInput{
		UsuarioEmail: "me@test",
		ClubID:       "141881",
		PlayerID:     "p1",
		Verificado:   true,
	})
	if err != nil {
		t.Fatalf("ClaimPro() error = %v", err)
	}

	if repo.claimed.PlayerID != "p1" || repo.claimed.ClubID != "141881" {
		t.Fatalf("claimed = %+v; want player p1 at club 141881", repo.claimed)
	}
	if len(repo.watches) != 1 {
		t.Fatalf("watches = %d; want 1 (the claimed club followed)", len(repo.watches))
	}
	w := repo.watches[0]
	if w.ClubID != "141881" {
		t.Fatalf("followed club = %q; want 141881", w.ClubID)
	}
	if w.Origem != domainpref.OrigemProprio {
		t.Fatalf("origem = %q; want %q", w.Origem, domainpref.OrigemProprio)
	}
}

// A claim without a club (the source did not name one) still records the pro;
// it just cannot follow a club it does not know.
func TestClaimProWithoutClubSkipsTheFollow(t *testing.T) {
	repo := &stubRepo{}
	svc := NewService(repo)

	if err := svc.ClaimPro(context.Background(), ClaimProInput{
		UsuarioEmail: "me@test",
		PlayerID:     "p1",
	}); err != nil {
		t.Fatalf("ClaimPro() error = %v", err)
	}
	if len(repo.watches) != 0 {
		t.Fatalf("watches = %d; want 0 (no club to follow)", len(repo.watches))
	}
	if repo.claimed.PlayerID != "p1" {
		t.Fatalf("claimed = %+v; want the pro recorded anyway", repo.claimed)
	}
}

// The claim must not run for an anonymous caller -- the repo would write a row
// keyed by the empty e-mail.
func TestClaimProRequiresIdentity(t *testing.T) {
	repo := &stubRepo{}
	svc := NewService(repo)

	if err := svc.ClaimPro(context.Background(), ClaimProInput{PlayerID: "p1"}); err == nil {
		t.Fatal("ClaimPro() with no usuario_email should fail")
	}
	if repo.claimed.PlayerID != "" || len(repo.watches) != 0 {
		t.Fatal("nothing should have been written")
	}
}
