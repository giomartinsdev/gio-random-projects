package httpapi_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/clips"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/cluster"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/mediamtx"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

// Two real nodes, each wired to the other as its only peer -- the whole
// point of RegisterCluster happening after Handler() is that this works
// in one process: both muxes are shared references, so the internal
// routes exist on both sides before any request is made.
func newClusteredServers(t *testing.T) (a, b *httptest.Server) {
	t.Helper()

	build := func() (*httptest.Server, *httpapi.Server) {
		media := mediamtx.NewProxy(fakeMediaMTX(t).URL)
		api := httpapi.New(rooms.NewRegistry(""), media,
			[]string{"http://example.com"}, slog.New(slog.NewJSONHandler(io.Discard, nil)), nil)
		api.RegisterClips(clips.NewMemoryStore(), 24*time.Hour)
		srv := httptest.NewServer(api.Handler())
		return srv, api
	}

	a, apiA := build()
	b, apiB := build()
	t.Cleanup(a.Close)
	t.Cleanup(b.Close)

	// Peers point at each other over the real HTTP addresses; the token
	// is what both sides use to authenticate internal traffic.
	apiA.RegisterCluster(cluster.New("a", "token-secreto", []cluster.Peer{{Name: "b", Base: b.URL}}))
	apiB.RegisterCluster(cluster.New("b", "token-secreto", []cluster.Peer{{Name: "a", Base: a.URL}}))
	return a, b
}

func get(t *testing.T, srv *httptest.Server, path string) *http.Response {
	t.Helper()
	res, err := srv.Client().Get(srv.URL + path)
	if err != nil {
		t.Fatalf("get %s: %v", path, err)
	}
	return res
}

func postJSON(t *testing.T, srv *httptest.Server, path, body string) *http.Response {
	t.Helper()
	res, err := srv.Client().Post(srv.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("post %s: %v", path, err)
	}
	return res
}

// The headline guarantee: a room that lives on node A answers normally
// when asked through node B -- including requests that need the room's
// actual state (password checks) and destructive ones (delete).
func TestRoomOnAnotherNodeIsReachableThroughThisOne(t *testing.T) {
	a, b := newClusteredServers(t)
	roomID := createRoom(t, a, "segredo123")

	// Status proxied, not 404.
	res := get(t, b, "/api/rooms/"+roomID)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status via peer: %d, want 200", res.StatusCode)
	}

	// A wrong password is judged by the OWNING node: through B it still
	// comes back 401, and a right one 200.
	res = postJSON(t, b, "/api/rooms/"+roomID+"/check", `{"password":"errada"}`)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password via peer: %d, want 401", res.StatusCode)
	}
	res.Body.Close()
	res = postJSON(t, b, "/api/rooms/"+roomID+"/check", `{"password":"segredo123"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("right password via peer: %d, want 200", res.StatusCode)
	}
	res.Body.Close()

	// Delete through B must actually delete on A.
	delReq, err := http.NewRequest(http.MethodDelete, b.URL+"/api/rooms/"+roomID,
		strings.NewReader(`{"password":"segredo123"}`))
	if err != nil {
		t.Fatalf("delete req: %v", err)
	}
	delRes, err := b.Client().Do(delReq)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	delRes.Body.Close()
	if delRes.StatusCode != http.StatusOK {
		t.Fatalf("delete via peer: %d, want 200", delRes.StatusCode)
	}
	res = get(t, a, "/api/rooms/"+roomID)
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("room after delete via peer: %d, want 404 on the owning node", res.StatusCode)
	}
}

// A room that exists on neither node is a plain 404 everywhere -- the
// cluster asks its peers, gets nothing, and answers honestly.
func TestUnknownRoomIsStillA404UnderACluster(t *testing.T) {
	_, b := newClusteredServers(t)
	res := get(t, b, "/api/rooms/naoexiste")
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown room via peer: %d, want 404", res.StatusCode)
	}
}

// WebSockets forward too: the handshake proxies to the owning node and
// the signalling flows end to end through the node the browser dialed.
func TestWSDialsThroughAPeerNode(t *testing.T) {
	a, b := newClusteredServers(t)
	roomID := createRoom(t, a, "segredo123")

	// Someone is already on A.
	home, _ := join(t, a, roomID)
	defer home.Close(websocket.StatusNormalClosure, "")

	// A second person dials B for a room that only exists on A.
	guest := mustDial(t, b, "room="+roomID+"&password=segredo123")
	defer guest.Close(websocket.StatusNormalClosure, "")
	welcome := read(t, guest)
	if welcome["type"] != "welcome" {
		t.Fatalf("via peer: expected welcome, got %v", welcome["type"])
	}
	guestID, _ := welcome["peerId"].(string)
	if guestID == "" {
		t.Fatal("welcome carried no peer id")
	}

	// The node that owns the room saw the join arrive through the proxy,
	// attributed to the same peer id the proxied handshake was given.
	msg := readUntil(t, home, "peer:join")
	if msg["peerId"] != guestID {
		t.Fatalf("peer:join for %v, want the proxied guest %s", msg["peerId"], guestID)
	}

	// A room nobody owns is refused at dial time, same as single-node.
	if _, _, err := dial(t, b, "room=naoexiste&password=x"); err == nil {
		t.Fatal("dial for an unknown room via peer unexpectedly upgraded")
	}
}

// The internal endpoints are the API's open proxy if the token check
// ever fails to happen. No token, wrong token: 401, always.
func TestInternalEndpointsNeedTheNodeToken(t *testing.T) {
	a, _ := newClusteredServers(t)
	roomID := createRoom(t, a, "segredo123")

	res := get(t, a, "/internal/rooms")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("list rooms without token: %d, want 401", res.StatusCode)
	}
	res.Body.Close()
	res = get(t, a, "/internal/rooms/"+roomID+"/owner")
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("owner without token: %d, want 401", res.StatusCode)
	}
	res.Body.Close()

	// Right token: the owner endpoint answers with the node's name...
	req, err := http.NewRequest(http.MethodGet, a.URL+"/internal/rooms/"+roomID+"/owner", nil)
	if err != nil {
		t.Fatalf("req: %v", err)
	}
	req.Header.Set(cluster.TokenHeader, "token-secreto")
	res, err = a.Client().Do(req)
	if err != nil {
		t.Fatalf("owner with token: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("owner with token: %d, want 200", res.StatusCode)
	}
	var body struct {
		Node string `json:"node"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode owner: %v", err)
	}
	if body.Node != "a" {
		t.Fatalf("owner node = %q, want %q", body.Node, "a")
	}
}

// The home page's "salas rolando" is the whole cluster, not just the
// node that happened to answer.
func TestHomeListMergesPeerRooms(t *testing.T) {
	a, b := newClusteredServers(t)
	roomA := createRoom(t, a, "segredo123")
	roomB := createRoom(t, b, "segredo123")

	// Active() only lists rooms with someone in them, so each room gets
	// one member on its own node before the lists are compared.
	ca, _ := join(t, a, roomA)
	defer ca.Close(websocket.StatusNormalClosure, "")
	cb, _ := join(t, b, roomB)
	defer cb.Close(websocket.StatusNormalClosure, "")

	for _, srv := range []*httptest.Server{a, b} {
		res := get(t, srv, "/api/rooms")
		var list []rooms.RoomSummary
		if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		res.Body.Close()
		ids := map[string]bool{}
		for _, r := range list {
			ids[r.ID] = true
		}
		if !ids[roomA] || !ids[roomB] {
			t.Fatalf("list via one node = %v, want both %s and %s", ids, roomA, roomB)
		}
	}
}
