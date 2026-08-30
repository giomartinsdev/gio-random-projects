package deal

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/application"
	domaindeal "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/domain/deal"
)

func commandFor(action string) application.Command {
	return application.Command{ID: "cmd-1", Action: application.Action(action), Payload: json.RawMessage(`{}`)}
}

// stubRepo records what it was asked to store and answers with a
// canned inserted flag — enough to drive the service's only branch.
type stubRepo struct {
	inserted bool
	err      error
	got      domaindeal.Deal
}

func (r *stubRepo) Upsert(_ context.Context, d domaindeal.Deal) (bool, error) {
	r.got = d
	return r.inserted, r.err
}

func sampleInput() UpsertInput {
	return UpsertInput{
		Source:       "phb",
		SourceDealID: "abc",
		Title:        "Mouse gamer",
		URL:          "https://example.com/mouse",
	}
}

func TestUpsertInsertRaisesCreated(t *testing.T) {
	repo := &stubRepo{inserted: true}
	svc := NewService(repo)

	_, evt, err := svc.Upsert(context.Background(), sampleInput())
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	if evt == nil || evt.EventName() != "deal.created" {
		t.Fatalf("event = %v, want deal.created", evt)
	}
	created, ok := evt.(domaindeal.Created)
	if !ok {
		t.Fatalf("event type = %T, want domaindeal.Created", evt)
	}
	if created.SourceDealID != "abc" || created.Title != "Mouse gamer" {
		t.Fatalf("event fields = %+v", created)
	}
}

func TestUpsertUpdateRaisesNoEventButReturnsDeal(t *testing.T) {
	repo := &stubRepo{inserted: false}
	svc := NewService(repo)

	d, evt, err := svc.Upsert(context.Background(), sampleInput())
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	if evt != nil {
		t.Fatalf("event = %v, want nil on update", evt)
	}
	if d.EntityID() != "phb:abc" {
		t.Fatalf("EntityID() = %q, want phb:abc", d.EntityID())
	}
}

func TestUpsertValidatesAndNormalizes(t *testing.T) {
	repo := &stubRepo{inserted: true}
	svc := NewService(repo)

	if _, _, err := svc.Upsert(context.Background(), UpsertInput{Source: "phb"}); !errors.Is(err, domaindeal.ErrSourceDealIDRequired) {
		t.Fatalf("missing source_deal_id: err = %v", err)
	}

	in := sampleInput()
	in.Payload = nil // must reach the repo as an empty JSON object
	if _, _, err := svc.Upsert(context.Background(), in); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	if string(repo.got.Payload) != "{}" {
		t.Fatalf("repo got payload %q, want {}", repo.got.Payload)
	}
	if repo.got.ScrapedAt.IsZero() {
		t.Fatal("ScrapedAt not normalized to now")
	}
}

func TestUpsertPropagatesRepoError(t *testing.T) {
	repo := &stubRepo{err: errors.New("db down")}
	svc := NewService(repo)

	if _, _, err := svc.Upsert(context.Background(), sampleInput()); err == nil {
		t.Fatal("want error from repo")
	}
}

func TestUnknownActionRejected(t *testing.T) {
	repo := &stubRepo{inserted: true}
	h := NewCommandHandler(NewService(repo))

	if _, _, err := h.Handle(context.Background(), commandFor("deal.delete")); err == nil {
		t.Fatal("unknown action must be rejected")
	}
}
