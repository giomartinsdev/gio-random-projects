package metrics_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/metrics"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

// The gauges are computed from the registry at scrape time: create a
// room, join two people, scrape, and the numbers must reflect that --
// no registration-time snapshotting, no drift.
func TestGaugesReadTheRegistryAtScrapeTime(t *testing.T) {
	reg := rooms.NewRegistry("")

	srv := httptest.NewServer(metrics.New(reg))
	t.Cleanup(srv.Close)

	scrape := func() string {
		res, err := srv.Client().Get(srv.URL + "/")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("status %d", res.StatusCode)
		}
		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		return string(body)
	}

	before := scrape()
	if strings.Contains(before, "tela_rooms 1") {
		t.Error("empty registry should report 0 rooms")
	}

	// A room appears; the next scrape must see it (and its people)
	// without any registration step in between.
	room, err := reg.Create("segredo123")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	room.Join(rooms.NewPeer("p1", "Um"))
	room.Join(rooms.NewPeer("p2", "Dois"))

	after := scrape()
	for _, want := range []string{
		"tela_rooms 1",
		"tela_rooms_active 1",
		"tela_people 2",
		"tela_publishers 0",
	} {
		if !strings.Contains(after, want) {
			t.Errorf("scrape missing %s in:\n%s", want, after)
		}
	}
}