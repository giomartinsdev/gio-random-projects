package mediamtx_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/mediamtx"
)

// fakeMediaMTX is a real HTTP server standing in for MediaMTX: the whole
// point of the proxy is the raw SDP round trip, so a stubbed client
// would test nothing worth testing.
type fakeMediaMTX struct {
	srv *httptest.Server

	mu       sync.Mutex
	offers   map[string]string // path -> raw offer body received
	deletes  []string          // absolute paths deleted
	location string            // Location header returned for WHIP publishes
	answer   string
}

func newFakeMediaMTX(t *testing.T) *fakeMediaMTX {
	t.Helper()
	f := &fakeMediaMTX{
		offers: make(map[string]string),
		answer: "v=0\r\no=- answer 0 0 IN IP4 127.0.0.1\r\n",
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()

		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/whip"):
			body := readBody(t, r)
			f.offers[r.URL.Path] = body
			if f.location != "" {
				w.Header().Set("Location", f.location)
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(f.answer))

		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/whep"):
			body := readBody(t, r)
			f.offers[r.URL.Path] = body
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(f.answer))

		case r.Method == http.MethodDelete:
			f.deletes = append(f.deletes, r.URL.Path)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func readBody(t *testing.T, r *http.Request) string {
	t.Helper()
	defer r.Body.Close()
	buf := make([]byte, 4096)
	n, _ := r.Body.Read(buf)
	return string(buf[:n])
}

func TestOfferHasAudioReadsTheSDP(t *testing.T) {
	withAudio := "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n"
	videoOnly := "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n"
	if !mediamtx.OfferHasAudio(withAudio) {
		t.Error("an offer with an audio m-line should report audio")
	}
	if mediamtx.OfferHasAudio(videoOnly) {
		t.Error("a video-only offer should not report audio")
	}
	if mediamtx.OfferHasAudio("a=audio not an m-line") {
		t.Error("a=audio is not an m-line and must not count")
	}
}

func TestPublishForwardsTheRawOfferAndReturnsTheAnswer(t *testing.T) {
	f := newFakeMediaMTX(t)
	f.location = "/tela-sala-p1/whip/sessao-123"
	proxy := mediamtx.NewProxy(f.srv.URL)
	if !proxy.Configured() {
		t.Fatal("a proxy built from a base URL must be configured")
	}

	offer := "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\ncustom=1\r\n"
	res, err := proxy.Publish("tela-sala-p1", offer)
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if res.SDP != f.answer {
		t.Fatalf("answer = %q, want %q", res.SDP, f.answer)
	}
	if res.Location != f.location {
		t.Fatalf("location = %q, want %q", res.Location, f.location)
	}
	if got := f.offers["/tela-sala-p1/whip"]; got != offer {
		t.Fatalf("MediaMTX received %q, want the raw offer %q", got, offer)
	}
}

func TestSubscribeReturnsTheWhepAnswer(t *testing.T) {
	f := newFakeMediaMTX(t)
	proxy := mediamtx.NewProxy(f.srv.URL)

	res, err := proxy.Subscribe("tela-sala-p1", "v=0\r\nm=video 0\r\n")
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if res.SDP != f.answer {
		t.Fatalf("answer = %q, want %q", res.SDP, f.answer)
	}
	if _, ok := f.offers["/tela-sala-p1/whep"]; !ok {
		t.Fatal("MediaMTX never received the WHEP offer")
	}
}

// MediaMTX answers WHIP with a RELATIVE Location, which Node/Go URLs
// reject outright -- the proxy has to resolve it against the base before
// the DELETE, or every teardown silently fails.
func TestCloseResolvesARelativeLocation(t *testing.T) {
	f := newFakeMediaMTX(t)
	proxy := mediamtx.NewProxy(f.srv.URL)

	if err := proxy.Close("/tela-sala-p1/whip/sessao-123"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if len(f.deletes) != 1 || f.deletes[0] != "/tela-sala-p1/whip/sessao-123" {
		t.Fatalf("deleted %v, want the resolved session path", f.deletes)
	}
}

func TestCloseOfAnEmptyLocationIsANoOp(t *testing.T) {
	f := newFakeMediaMTX(t)
	proxy := mediamtx.NewProxy(f.srv.URL)

	if err := proxy.Close(""); err != nil {
		t.Fatalf("close empty: %v", err)
	}
	if len(f.deletes) != 0 {
		t.Fatalf("an empty location must not delete anything, deleted %v", f.deletes)
	}
}

// A 404 means the session is already gone -- the intended end state, not
// a teardown failure.
func TestCloseTreatsAMissingSessionAsDone(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if err := mediamtx.NewProxy(srv.URL).Close("/x/whip/y"); err != nil {
		t.Fatalf("404 teardown must be tolerated, got %v", err)
	}
}

func TestAnEmptyBaseURLDisablesTheTransport(t *testing.T) {
	if mediamtx.NewProxy("") != nil {
		t.Fatal("an empty MEDIAMTX_INTERNAL_URL must yield a nil proxy, disabling the transport")
	}
}

func TestPathForIsDeterministicAndNamespaced(t *testing.T) {
	got := mediamtx.PathFor("abacate98suco", "PeerABC")
	if got != "tela-abacate98suco-peerabc" {
		t.Fatalf("PathFor = %q, want a lowercased, namespaced path", got)
	}
	if mediamtx.PathFor("abacate98suco", "x") == mediamtx.PathFor("outra", "x") {
		t.Fatal("rooms must not collide on the same path")
	}
}
