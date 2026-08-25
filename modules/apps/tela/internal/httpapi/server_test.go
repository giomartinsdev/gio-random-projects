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

func createRoom(t *testing.T, srv *httptest.Server, password string) (roomID, hostToken string) {
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
		RoomID    string `json:"roomId"`
		HostToken string `json:"hostToken"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body.RoomID, body.HostToken
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
	roomID, _ := createRoom(t, srv, "segredo123")

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

func TestViewerNeedsCorrectPassword(t *testing.T) {
	srv := newServer(t)
	roomID, _ := createRoom(t, srv, "segredo123")

	if _, _, err := dial(t, srv, "room="+roomID+"&role=viewer&password=errada"); err == nil {
		t.Fatal("expected the upgrade to be refused with a wrong password")
	}
}

func TestHostNeedsToken(t *testing.T) {
	srv := newServer(t)
	roomID, _ := createRoom(t, srv, "segredo123")

	// Knowing the password lets you watch, never take over the share.
	if _, _, err := dial(t, srv, "room="+roomID+"&role=host&token=segredo123"); err == nil {
		t.Fatal("expected the upgrade to be refused without the host token")
	}
}

// The core flow: host and viewer find each other and the server moves
// an opaque payload from one to the other, tagged with who really sent
// it rather than whatever the sender claimed.
func TestSignallingRelay(t *testing.T) {
	srv := newServer(t)
	roomID, hostToken := createRoom(t, srv, "segredo123")

	host := mustDial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	if got := read(t, host)["type"]; got != "welcome" {
		t.Fatalf("host: expected welcome, got %v", got)
	}

	viewer := mustDial(t, srv, "room="+roomID+"&role=viewer&password=segredo123")
	viewerWelcome := read(t, viewer)
	if viewerWelcome["hostOnline"] != true {
		t.Fatal("viewer: expected hostOnline to be true")
	}
	viewerID, _ := viewerWelcome["peerId"].(string)
	hostID := ""

	join := read(t, host)
	if join["type"] != "viewer:join" {
		t.Fatalf("host: expected viewer:join, got %v", join["type"])
	}
	if join["peerId"] != viewerID {
		t.Fatalf("host was told about %v but the viewer is %v", join["peerId"], viewerID)
	}

	write(t, host, map[string]any{
		"type":    "signal",
		"to":      viewerID,
		"payload": map[string]any{"kind": "offer", "sdp": "FAKE_SDP"},
	})

	relayed := read(t, viewer)
	if relayed["type"] != "signal" {
		t.Fatalf("viewer: expected signal, got %v", relayed["type"])
	}
	payload, _ := relayed["payload"].(map[string]any)
	if payload["sdp"] != "FAKE_SDP" {
		t.Fatalf("payload did not survive the relay: %v", relayed["payload"])
	}
	hostID, _ = relayed["from"].(string)
	if hostID == "" {
		t.Fatal("relayed message carried no sender id")
	}

	// And back the other way.
	write(t, viewer, map[string]any{
		"type":    "signal",
		"to":      hostID,
		"payload": map[string]any{"kind": "answer", "sdp": "FAKE_ANSWER"},
	})
	answer := read(t, host)
	answerPayload, _ := answer["payload"].(map[string]any)
	if answerPayload["sdp"] != "FAKE_ANSWER" {
		t.Fatalf("answer did not survive the relay: %v", answer["payload"])
	}
	if answer["from"] != viewerID {
		t.Fatalf("answer claimed to be from %v, expected %v", answer["from"], viewerID)
	}
}

func TestSecondHostIsRefused(t *testing.T) {
	srv := newServer(t)
	roomID, hostToken := createRoom(t, srv, "segredo123")

	first := mustDial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	read(t, first) // welcome

	// The upgrade succeeds (the token is valid) and the server then
	// closes it, so the failure shows up on the first read.
	second, _, err := dial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	if err != nil {
		return // refused outright is fine too
	}
	defer second.Close(websocket.StatusNormalClosure, "")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, _, err := second.Read(ctx); err == nil {
		t.Fatal("expected the second host to be closed out")
	}
}

func TestViewersCannotReachEachOther(t *testing.T) {
	srv := newServer(t)
	roomID, hostToken := createRoom(t, srv, "segredo123")

	host := mustDial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	read(t, host)

	a := mustDial(t, srv, "room="+roomID+"&role=viewer&password=segredo123")
	aID, _ := read(t, a)["peerId"].(string)
	read(t, host) // viewer:join for a

	b := mustDial(t, srv, "room="+roomID+"&role=viewer&password=segredo123")
	read(t, b)
	read(t, host) // viewer:join for b

	// b addresses a directly. A viewer may only ever talk to the host,
	// so this must go nowhere rather than letting one guest reach
	// another.
	write(t, b, map[string]any{
		"type":    "signal",
		"to":      aID,
		"payload": map[string]any{"kind": "offer", "sdp": "SHOULD_NOT_ARRIVE"},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if _, data, err := a.Read(ctx); err == nil {
		t.Fatalf("viewer received a message from another viewer: %s", data)
	}
}

func TestViewerLeaveNotifiesHost(t *testing.T) {
	srv := newServer(t)
	roomID, hostToken := createRoom(t, srv, "segredo123")

	host := mustDial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	read(t, host)

	viewer, _, err := dial(t, srv, "room="+roomID+"&role=viewer&password=segredo123")
	if err != nil {
		t.Fatalf("viewer dial: %v", err)
	}
	viewerID, _ := read(t, viewer)["peerId"].(string)
	read(t, host) // viewer:join

	_ = viewer.Close(websocket.StatusNormalClosure, "")

	leave := read(t, host)
	if leave["type"] != "viewer:leave" || leave["peerId"] != viewerID {
		t.Fatalf("expected viewer:leave for %s, got %v", viewerID, leave)
	}
}

func TestViewerToldWhenHostGoesAway(t *testing.T) {
	srv := newServer(t)
	roomID, hostToken := createRoom(t, srv, "segredo123")

	host, _, err := dial(t, srv, "room="+roomID+"&role=host&token="+hostToken)
	if err != nil {
		t.Fatalf("host dial: %v", err)
	}
	read(t, host)

	viewer := mustDial(t, srv, "room="+roomID+"&role=viewer&password=segredo123")
	read(t, viewer) // welcome
	read(t, host)   // viewer:join

	_ = host.Close(websocket.StatusNormalClosure, "")

	if got := read(t, viewer)["type"]; got != "host:offline" {
		t.Fatalf("expected host:offline, got %v", got)
	}
}
