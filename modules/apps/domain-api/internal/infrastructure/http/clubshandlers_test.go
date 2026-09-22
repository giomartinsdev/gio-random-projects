package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	domainclubs "github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/domain/clubs"
)

// stubClubs implements domainclubs.Repository by embedding the interface and
// overriding only the handful of methods these tests exercise. That keeps the
// stub honest about the rest of the port: calling anything unimplemented
// panics loudly instead of silently returning zeros.
type stubClubs struct {
	domainclubs.Repository

	club     domainclubs.Club
	matches  []domainclubs.Match
	players  []domainclubs.PlayerProfile
	count    int
	recentNo int
}

func (s *stubClubs) GetClub(context.Context, string) (domainclubs.Club, error) {
	return s.club, nil
}
func (s *stubClubs) RecentMatchCount(context.Context, string) (int, error) { return s.recentNo, nil }
func (s *stubClubs) ListMatches(context.Context, string, string, int) ([]domainclubs.Match, error) {
	return s.matches, nil
}
func (s *stubClubs) SearchPlayers(context.Context, string, int) ([]domainclubs.PlayerProfile, error) {
	return s.players, nil
}
func (s *stubClubs) PlayerCount(context.Context) (int, error) { return s.count, nil }

func clubsRouter(repo domainclubs.Repository) http.Handler {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewClubsHandlers(repo, log)
	r := chi.NewRouter()
	r.Get("/clubs/{clubId}", h.GetClub)
	r.Get("/players", h.ListPlayers)
	return r
}

func getJSON(t *testing.T, handler http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// The profile header's form chips are colored and lettered by result
// vocabulary ("vitoria"/"empate"/"derrota"), exactly like the directory rows
// produced by withForm. Emitting "V"/"E"/"D" here made every chip render "?"
// on the club page while the same club read correctly in the list.
func TestGetClubFormaUsesResultVocabulary(t *testing.T) {
	repo := &stubClubs{
		club:     domainclubs.Club{ClubID: "141881", Nome: "ACG ZW"},
		recentNo: 3,
		matches: []domainclubs.Match{
			{NossoResultado: "vitoria"},
			{NossoResultado: "derrota"},
			{NossoResultado: "empate"},
		},
	}
	rec := getJSON(t, clubsRouter(repo), "/clubs/141881")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200", rec.Code, rec.Body)
	}
	var got domainclubs.Club
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []string{"vitoria", "derrota", "empate"}
	if len(got.Forma) != len(want) {
		t.Fatalf("forma = %v; want %v", got.Forma, want)
	}
	for i := range want {
		if got.Forma[i] != want[i] {
			t.Fatalf("forma = %v; want %v", got.Forma, want)
		}
	}
}

// The home header shows "jogadores indexados" as the whole cross-club index.
// `total` must be that index size, not the page length -- reporting len(list)
// made a 1-item page claim there was 1 player while 1,249 were indexed.
func TestListPlayersTotalIsTheWholeIndex(t *testing.T) {
	repo := &stubClubs{
		players: []domainclubs.PlayerProfile{{PlayerID: "p1", Gamertag: "ana"}},
		count:   1249,
	}
	rec := getJSON(t, clubsRouter(repo), "/players?limite=1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200", rec.Code, rec.Body)
	}
	var body struct {
		Jogadores []domainclubs.PlayerProfile `json:"jogadores"`
		Total     int                         `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Jogadores) != 1 {
		t.Fatalf("returned %d players; want 1 (the page)", len(body.Jogadores))
	}
	if body.Total != 1249 {
		t.Fatalf("total = %d; want 1249 (the whole index)", body.Total)
	}
}

// A club with totals but no persisted matches must not panic the profile
// builder -- the forma/opponents block is skipped entirely.
func TestGetClubWithoutMatches(t *testing.T) {
	repo := &stubClubs{club: domainclubs.Club{ClubID: "1", Nome: "Sem Jogos"}}
	rec := getJSON(t, clubsRouter(repo), "/clubs/1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200", rec.Code, rec.Body)
	}
}
