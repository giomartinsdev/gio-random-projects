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

	club            domainclubs.Club
	matches         []domainclubs.Match
	players         []domainclubs.PlayerProfile
	count           int
	recentNo        int
	rankPlayers     []domainclubs.RankPlayer
	rankClubs       []domainclubs.ClubRef
	announces       []domainclubs.Announcement
	annCount        int
	squad           []domainclubs.SquadMember
	fetchRun        domainclubs.FetchRun
	pending         []domainclubs.FetchRun
	searchRun       domainclubs.SearchRun
	pendingSearches []domainclubs.SearchRun
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
func (s *stubClubs) RankingPlayers(context.Context, string, string) ([]domainclubs.RankPlayer, error) {
	return s.rankPlayers, nil
}
func (s *stubClubs) RankingClubs(context.Context, string) ([]domainclubs.ClubRef, error) {
	return s.rankClubs, nil
}
func (s *stubClubs) RecentAnnouncements(context.Context, int) ([]domainclubs.Announcement, error) {
	return s.announces, nil
}
func (s *stubClubs) AnnouncementCount(context.Context) (int, error) { return s.annCount, nil }
func (s *stubClubs) Squad(context.Context, string) ([]domainclubs.SquadMember, error) {
	return s.squad, nil
}
func (s *stubClubs) GetFetchRun(context.Context, string) (domainclubs.FetchRun, error) {
	return s.fetchRun, nil
}
func (s *stubClubs) ListPendingFetches(context.Context) ([]domainclubs.FetchRun, error) {
	return s.pending, nil
}
func (s *stubClubs) GetSearchRun(context.Context, string) (domainclubs.SearchRun, error) {
	return s.searchRun, nil
}
func (s *stubClubs) ListPendingSearches(context.Context) ([]domainclubs.SearchRun, error) {
	return s.pendingSearches, nil
}

func clubsRouter(repo domainclubs.Repository) http.Handler {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	h := NewClubsHandlers(repo, log)
	r := chi.NewRouter()
	r.Get("/clubs/{clubId}", h.GetClub)
	r.Get("/players", h.ListPlayers)
	r.Get("/clubs/{clubId}/squad", h.GetSquad)
	r.Get("/clubs/{clubId}/fetch-run", h.GetFetchRun)
	r.Get("/fetch-pending", h.ListPendingFetches)
	r.Get("/search-run", h.GetSearchRun)
	r.Get("/search-pending", h.ListPendingSearches)
	r.Get("/rankings/players", h.RankingPlayers)
	r.Get("/rankings/clubs", h.RankingClubs)
	r.Get("/announcements", h.ListAnnouncements)
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

func rankPlayers(n int) []domainclubs.RankPlayer {
	out := make([]domainclubs.RankPlayer, n)
	for i := range out {
		out[i] = domainclubs.RankPlayer{PlayerID: string(rune('a' + i)), Gamertag: "p"}
	}
	return out
}

// The ranking paginates: `total` is the whole ranking (so the caller knows
// where the end is) while the payload is only the requested window. Capping
// or returning everything made "até o último" impossible from the home.
func TestRankingPlayersPaginates(t *testing.T) {
	repo := &stubClubs{rankPlayers: rankPlayers(25)}

	rec := getJSON(t, clubsRouter(repo), "/rankings/players?metrica=nota&limite=10&offset=0")
	var first struct {
		Jogadores []domainclubs.RankPlayer `json:"jogadores"`
		Total     int                      `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &first); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(first.Jogadores) != 10 || first.Total != 25 {
		t.Fatalf("page0: got %d of total %d; want 10 of 25", len(first.Jogadores), first.Total)
	}

	// The last page is partial, not empty: offset 20 of 25 -> 5 rows.
	rec = getJSON(t, clubsRouter(repo), "/rankings/players?metrica=nota&limite=10&offset=20")
	var last struct {
		Jogadores []domainclubs.RankPlayer `json:"jogadores"`
		Total     int                      `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &last); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(last.Jogadores) != 5 {
		t.Fatalf("last page: got %d; want 5", len(last.Jogadores))
	}
	if last.Total != 25 {
		t.Fatalf("last page total = %d; want 25", last.Total)
	}
}

// An offset past the end is an empty page, not a panic.
func TestRankingPlayersOffsetPastEnd(t *testing.T) {
	repo := &stubClubs{rankPlayers: rankPlayers(3)}
	rec := getJSON(t, clubsRouter(repo), "/rankings/players?metrica=nota&limite=10&offset=99")
	var body struct {
		Jogadores []domainclubs.RankPlayer `json:"jogadores"`
		Total     int                      `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Jogadores) != 0 || body.Total != 3 {
		t.Fatalf("got %d of total %d; want 0 of 3", len(body.Jogadores), body.Total)
	}
}

// The feed is capped at a few items, but the header's "anúncios" number is
// every live announcement -- slicing the feed must not shrink the count.
func TestAnnouncementsTotalIsNotTheFeedLength(t *testing.T) {
	repo := &stubClubs{
		announces: []domainclubs.Announcement{{ID: "1"}, {ID: "2"}, {ID: "3"}},
		annCount:  200,
	}
	rec := getJSON(t, clubsRouter(repo), "/announcements?limite=3")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s; want 200", rec.Code, rec.Body)
	}
	var body struct {
		Anuncios []domainclubs.Announcement `json:"anuncios"`
		Total    int                        `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Anuncios) != 3 {
		t.Fatalf("feed: got %d; want 3", len(body.Anuncios))
	}
	if body.Total != 200 {
		t.Fatalf("total = %d; want 200 (all live, not the feed page)", body.Total)
	}
}

// O elenco da tela de resgate precisa dizer quais pros JÁ têm dono, senão ela
// oferece um botão "SOU EU" que só falharia depois. O bloqueio é do lado do
// servidor -- a SPA só desenha o que vier.
func TestGetSquadCarriesResgatado(t *testing.T) {
	repo := &stubClubs{squad: []domainclubs.SquadMember{
		{PlayerID: "free", Gamertag: "Livre", Resgatado: false},
		{PlayerID: "taken", Gamertag: "ComDono", Resgatado: true},
	}}
	rec := getJSON(t, clubsRouter(repo), "/clubs/141881/squad")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var body struct {
		Jogadores []domainclubs.SquadMember `json:"jogadores"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Jogadores) != 2 {
		t.Fatalf("got %d players; want 2", len(body.Jogadores))
	}
	// O campo precisa chegar ao JSON -- sem `json:"resgatado"` ele sumiria e a
	// tela bloquearia (ou deixaria de bloquear) errado.
	if body.Jogadores[1].PlayerID != "taken" || !body.Jogadores[1].Resgatado {
		t.Fatalf("o pro com dono deve vir resgatado=true: %+v", body.Jogadores[1])
	}
	if body.Jogadores[0].Resgatado {
		t.Fatalf("o pro livre não deve vir resgatado: %+v", body.Jogadores[0])
	}
}

// A tela polla o estado do fetch até o elenco ficar pronto. Antes do primeiro
// pedido a linha não existe: isso é "ainda não busquei", não erro.
func TestGetFetchRunDefaultsToNotStarted(t *testing.T) {
	repo := &stubClubs{fetchRun: domainclubs.FetchRun{ClubID: "141881"}}
	rec := getJSON(t, clubsRouter(repo), "/clubs/141881/fetch-run")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var run domainclubs.FetchRun
	if err := json.Unmarshal(rec.Body.Bytes(), &run); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if run.Rodando || run.ConcluidoEm != nil {
		t.Fatalf("run não iniciado deve vir zerado: %+v", run)
	}
}

// A fila que o worker de ingestão consome.
func TestListPendingFetches(t *testing.T) {
	repo := &stubClubs{pending: []domainclubs.FetchRun{
		{ClubID: "141881", Rodando: true},
		{ClubID: "234", Rodando: true},
	}}
	rec := getJSON(t, clubsRouter(repo), "/fetch-pending")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var body struct {
		Pendentes []domainclubs.FetchRun `json:"pendentes"`
		Total     int                    `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Total != 2 || len(body.Pendentes) != 2 {
		t.Fatalf("got %d pendentes (total %d); want 2", len(body.Pendentes), body.Total)
	}
}

// O termo é a CHAVE da fila de busca ao vivo. Sem normalizar, "Vila " e "vila"
// seriam duas linhas para o mesmo pedido -- trabalho duplicado no CDN, e a SPA
// pollando uma linha que não é a que o worker preenche.
func TestNormalizeTermo(t *testing.T) {
	cases := map[string]string{
		"  Vila  ":      "vila",
		"VILANOVA FC":   "vilanova fc",
		"Sporting":      "sporting",
		"":              "",
		"   ":           "",
		"já tem acento": "já tem acento",
	}
	for in, want := range cases {
		if got := normalizeTermo(in); got != want {
			t.Errorf("normalizeTermo(%q) = %q; want %q", in, got, want)
		}
	}
}

// O estado de um termo nunca buscado é "ainda não busquei", não erro.
func TestGetSearchRunDefaultsToNotStarted(t *testing.T) {
	repo := &stubClubs{searchRun: domainclubs.SearchRun{Termo: "vila"}}
	rec := getJSON(t, clubsRouter(repo), "/search-run?termo=vila")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var run domainclubs.SearchRun
	if err := json.Unmarshal(rec.Body.Bytes(), &run); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if run.Rodando || run.ConcluidoEm != nil {
		t.Fatalf("run não iniciado deve vir zerado: %+v", run)
	}
}

// A fila que o worker de ingestão consome para buscar na fonte.
func TestListPendingSearches(t *testing.T) {
	repo := &stubClubs{pendingSearches: []domainclubs.SearchRun{
		{Termo: "vila", Rodando: true},
		{Termo: "sporting", Rodando: true},
	}}
	rec := getJSON(t, clubsRouter(repo), "/search-pending")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d; want 200", rec.Code)
	}
	var body struct {
		Pendentes []domainclubs.SearchRun `json:"pendentes"`
		Total     int                     `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Total != 2 {
		t.Fatalf("total = %d; want 2", body.Total)
	}
}
