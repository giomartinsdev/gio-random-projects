package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
)

// Everything below runs against a real HTTP server over a real
// WebSocket -- the signalling relay is the whole product, so faking
// the transport would test nothing worth testing.
func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(httpapi.New(rooms.NewRegistry(), t.TempDir()).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func createRoom(t *testing.T, srv *httptest.Server, password string) string {
	t.Helper()
	res, err := srv.Client().Post(srv.URL+"/api/rooms", "application/json",
		strings.NewReader(`{"password":"`+password+`"}`))
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create room: status %d", res.StatusCode)
	}
	var body struct {
		RoomID string `json:"roomId"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body.RoomID
}

func dial(t *testing.T, srv *httptest.Server, query string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	url := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?" + query
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return websocket.Dial(ctx, url, &websocket.DialOptions{HTTPClient: srv.Client()})
}

func mustDial(t *testing.T, srv *httptest.Server, query string) *websocket.Conn {
	t.Helper()
	conn, _, err := dial(t, srv, query)
	if err != nil {
		t.Fatalf("dial %s: %v", query, err)
	}
	t.Cleanup(func() { _ = conn.Close(websocket.StatusNormalClosure, "") })
	return conn
}

func read(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal %q: %v", data, err)
	}
	return msg
}

func write(t *testing.T, conn *websocket.Conn, v any) {
	t.Helper()
	data, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestCreateRoomRejectsShortPassword(t *testing.T) {
	srv := newServer(t)
	res, err := srv.Client().Post(srv.URL+"/api/rooms", "application/json", strings.NewReader(`{"password":"ab"}`))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.StatusCode)
	}
}

func TestCheckPassword(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	// Room codes are shown uppercase but people paste them however they
	// like, so lookups are case-insensitive.
	for _, id := range []string{roomID, strings.ToLower(roomID)} {
		res, err := srv.Client().Post(srv.URL+"/api/rooms/"+id+"/check", "application/json",
			strings.NewReader(`{"password":"segredo123"}`))
		if err != nil {
			t.Fatalf("check: %v", err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Fatalf("check %q: expected 200, got %d", id, res.StatusCode)
		}
	}

	res, err := srv.Client().Post(srv.URL+"/api/rooms/"+roomID+"/check", "application/json",
		strings.NewReader(`{"password":"errada"}`))
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong password: expected 401, got %d", res.StatusCode)
	}
}

func TestJoinNeedsCorrectPassword(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	if _, _, err := dial(t, srv, "room="+roomID+"&password=errada"); err == nil {
		t.Fatal("expected the upgrade to be refused with a wrong password")
	}
}

func TestJoinUnknownRoom(t *testing.T) {
	srv := newServer(t)
	if _, _, err := dial(t, srv, "room=ZZZZZZ&password=segredo123"); err == nil {
		t.Fatal("expected the upgrade to be refused for a room that doesn't exist")
	}
}

func join(t *testing.T, srv *httptest.Server, roomID string) (*websocket.Conn, string) {
	t.Helper()
	conn := mustDial(t, srv, "room="+roomID+"&password=segredo123")
	welcome := read(t, conn)
	if welcome["type"] != "welcome" {
		t.Fatalf("expected welcome, got %v", welcome["type"])
	}
	id, _ := welcome["peerId"].(string)
	if id == "" {
		t.Fatal("welcome carried no peer id")
	}
	return conn, id
}

// The core flow: two peers find each other and the server moves an
// opaque payload between them, stamped with who really sent it rather
// than whatever the sender claimed.
func TestSignallingRelay(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, aID := join(t, srv, roomID)
	b, bID := join(t, srv, roomID)
	read(t, a) // peer:join for b

	write(t, a, map[string]any{
		"type":    "signal",
		"to":      bID,
		"payload": map[string]any{"kind": "offer", "sdp": "FAKE_SDP"},
	})

	relayed := read(t, b)
	if relayed["type"] != "signal" {
		t.Fatalf("expected signal, got %v", relayed["type"])
	}
	if payload, _ := relayed["payload"].(map[string]any); payload["sdp"] != "FAKE_SDP" {
		t.Fatalf("payload did not survive the relay: %v", relayed["payload"])
	}
	if relayed["from"] != aID {
		t.Fatalf("relayed message claimed to be from %v, expected %v", relayed["from"], aID)
	}

	// And back the other way -- with everyone able to publish, both
	// directions are ordinary traffic now.
	write(t, b, map[string]any{
		"type":    "signal",
		"to":      aID,
		"payload": map[string]any{"kind": "answer", "sdp": "FAKE_ANSWER"},
	})
	answer := read(t, a)
	if payload, _ := answer["payload"].(map[string]any); payload["sdp"] != "FAKE_ANSWER" {
		t.Fatalf("answer did not survive the relay: %v", answer["payload"])
	}
	if answer["from"] != bID {
		t.Fatalf("answer claimed to be from %v, expected %v", answer["from"], bID)
	}
}

// Anyone may publish, and more than one at a time -- that's the whole
// point of the grid.
func TestEveryonePublishesIndependently(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, aID := join(t, srv, roomID)
	b, bID := join(t, srv, roomID)
	read(t, a) // peer:join for b

	write(t, a, map[string]any{"type": "publish:start"})
	if got := read(t, b); got["type"] != "publish:start" || got["peerId"] != aID {
		t.Fatalf("b should have been told a started publishing, got %v", got)
	}

	// b publishing too must not disturb a's stream in any way.
	write(t, b, map[string]any{"type": "publish:start"})
	if got := read(t, a); got["type"] != "publish:start" || got["peerId"] != bID {
		t.Fatalf("a should have been told b started publishing, got %v", got)
	}

	write(t, a, map[string]any{"type": "publish:stop"})
	if got := read(t, b); got["type"] != "publish:stop" || got["peerId"] != aID {
		t.Fatalf("b should have been told a stopped, got %v", got)
	}
}

// Someone arriving mid-session has to learn who is already publishing,
// or they'd sit on an empty grid until the next state change.
func TestWelcomeListsWhoIsAlreadyPublishing(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, aID := join(t, srv, roomID)
	write(t, a, map[string]any{"type": "publish:start"})

	late := mustDial(t, srv, "room="+roomID+"&password=segredo123")
	welcome := read(t, late)

	peers, _ := welcome["peers"].([]any)
	if len(peers) != 1 {
		t.Fatalf("expected 1 existing peer, got %v", welcome["peers"])
	}
	peer, _ := peers[0].(map[string]any)
	if peer["peerId"] != aID {
		t.Fatalf("expected peer %v, got %v", aID, peer["peerId"])
	}
	if peer["publishing"] != true {
		t.Fatalf("expected a to be listed as publishing, got %v", peer)
	}
	if name, _ := peer["name"].(string); name == "" {
		t.Fatal("peers need a name for the grid to label them")
	}
}

func TestPeerJoinAndLeaveAreAnnounced(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, _ := join(t, srv, roomID)

	b, _, err := dial(t, srv, "room="+roomID+"&password=segredo123")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	bID, _ := read(t, b)["peerId"].(string)

	joined := read(t, a)
	if joined["type"] != "peer:join" || joined["peerId"] != bID {
		t.Fatalf("expected peer:join for %s, got %v", bID, joined)
	}
	if name, _ := joined["name"].(string); name == "" {
		t.Fatal("peer:join carried no name")
	}

	_ = b.Close(websocket.StatusNormalClosure, "")

	left := read(t, a)
	if left["type"] != "peer:leave" || left["peerId"] != bID {
		t.Fatalf("expected peer:leave for %s, got %v", bID, left)
	}
}

// Peer ids are unguessable, but the relay checks room membership
// anyway rather than trusting that.
func TestRelayDoesNotCrossRooms(t *testing.T) {
	srv := newServer(t)
	roomA := createRoom(t, srv, "segredo123")
	roomB := createRoom(t, srv, "segredo123")

	outsider, _ := join(t, srv, roomB)
	victim, victimID := join(t, srv, roomA)

	write(t, outsider, map[string]any{
		"type":    "signal",
		"to":      victimID,
		"payload": map[string]any{"kind": "offer", "sdp": "SHOULD_NOT_ARRIVE"},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if _, data, err := victim.Read(ctx); err == nil {
		t.Fatalf("a peer in another room reached this one: %s", data)
	}
}
