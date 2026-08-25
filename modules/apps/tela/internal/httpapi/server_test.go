package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/pion/webrtc/v4"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/rooms"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/sfu"
)

// Everything below runs against a real HTTP server over a real
// WebSocket -- the signalling relay is the whole product, so faking
// the transport would test nothing worth testing.
func newServer(t *testing.T) *httptest.Server {
	t.Helper()
	// A real SFU on an OS-assigned port: the signalling handler now owns
	// publisher/subscriber connections, so handing it nil would leave
	// half the paths under test unexercised.
	media, err := sfu.New(sfu.Options{UDPPort: 0})
	if err != nil {
		t.Fatalf("sfu: %v", err)
	}
	srv := httptest.NewServer(httpapi.New(rooms.NewRegistry(""), t.TempDir(), media).Handler())
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

// Reconnecting with the identity the server issued is what makes a
// deploy invisible: same peer id means the other clients keep the peer
// connections they already have.
func TestResumeKeepsTheSamePeerIdentity(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	first := mustDial(t, srv, "room="+roomID+"&password=segredo123")
	welcome := read(t, first)
	peerID, _ := welcome["peerId"].(string)
	name, _ := welcome["name"].(string)
	token, _ := welcome["resume"].(string)
	if token == "" {
		t.Fatal("welcome carried no resume token")
	}
	_ = first.Close(websocket.StatusNormalClosure, "")

	back := mustDial(t, srv, "room="+roomID+"&password=segredo123"+
		"&peerId="+peerID+"&name="+url.QueryEscape(name)+"&resume="+url.QueryEscape(token))
	resumed := read(t, back)
	if resumed["peerId"] != peerID {
		t.Fatalf("expected to resume as %v, got %v", peerID, resumed["peerId"])
	}
	if resumed["name"] != name {
		t.Fatalf("expected to keep the name %v, got %v", name, resumed["name"])
	}
}

// The id alone must not be enough, or any member of a room could come
// back wearing another member's identity.
func TestForgedResumeGetsAFreshIdentity(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	first := mustDial(t, srv, "room="+roomID+"&password=segredo123")
	welcome := read(t, first)
	victimID, _ := welcome["peerId"].(string)
	victimName, _ := welcome["name"].(string)

	impostor := mustDial(t, srv, "room="+roomID+"&password=segredo123"+
		"&peerId="+victimID+"&name="+url.QueryEscape(victimName)+"&resume=nao-e-um-token-valido")
	got := read(t, impostor)
	if got["peerId"] == victimID {
		t.Fatal("a forged token was accepted -- one member could impersonate another")
	}
}

// A resumed connection replaces whatever socket was still registered
// under that id; two live sockets sharing an id would each get half the
// signalling.
func TestResumeTakesOverAStaleConnection(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	stale := mustDial(t, srv, "room="+roomID+"&password=segredo123")
	welcome := read(t, stale)
	peerID, _ := welcome["peerId"].(string)
	name, _ := welcome["name"].(string)
	token, _ := welcome["resume"].(string)

	// Resume WITHOUT closing the first socket.
	back := mustDial(t, srv, "room="+roomID+"&password=segredo123"+
		"&peerId="+peerID+"&name="+url.QueryEscape(name)+"&resume="+url.QueryEscape(token))
	read(t, back)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, _, err := stale.Read(ctx); err == nil {
		t.Fatal("expected the stale socket to be closed out")
	}
}

// Anyone may publish, and more than one at a time -- that's the whole
// point of the grid.
func TestEveryonePublishesIndependently(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, aID := join(t, srv, roomID)
	b, bID := join(t, srv, roomID)
	readUntil(t, a, "peer:join")

	publish(t, a)
	if got := readUntil(t, b, "publish:start"); got["peerId"] != aID {
		t.Fatalf("b should have been told a started publishing, got %v", got)
	}

	// b publishing too must not disturb a's stream in any way.
	publish(t, b)
	if got := readUntil(t, a, "publish:start"); got["peerId"] != bID {
		t.Fatalf("a should have been told b started publishing, got %v", got)
	}

	write(t, a, map[string]any{"type": "publish:stop"})
	if got := readUntil(t, b, "publish:stop"); got["peerId"] != aID {
		t.Fatalf("b should have been told a stopped, got %v", got)
	}
}

// Someone arriving mid-session has to learn who is already publishing,
// or they'd sit on an empty grid until the next state change.
func TestWelcomeListsWhoIsAlreadyPublishing(t *testing.T) {
	srv := newServer(t)
	roomID := createRoom(t, srv, "segredo123")

	a, aID := join(t, srv, roomID)
	publish(t, a)

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

// readUntil skips past whatever else is in flight (ICE trickling, other
// people's events) to the message the test is actually waiting for.
func readUntil(t *testing.T, conn *websocket.Conn, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		msg := read(t, conn)
		if msg["type"] == want {
			return msg
		}
	}
	t.Fatalf("never received a %q message", want)
	return nil
}

// A real publish handshake: a peer connection with a real track, an
// offer over the WebSocket, and the SFU's answer. Publishing state is a
// consequence of media actually being accepted now, not a flag the
// client asserts, so there's no shortcut worth taking here.
func publish(t *testing.T, conn *websocket.Conn) *webrtc.PeerConnection {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("peer connection: %v", err)
	}
	t.Cleanup(func() { _ = pc.Close() })

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", "stream")
	if err != nil {
		t.Fatalf("track: %v", err)
	}
	if _, err := pc.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}
	<-webrtc.GatheringCompletePromise(pc)

	write(t, conn, map[string]any{"type": "publish:offer", "sdp": pc.LocalDescription()})

	answer := readUntil(t, conn, "publish:answer")
	raw, err := json.Marshal(answer["sdp"])
	if err != nil {
		t.Fatalf("marshal answer: %v", err)
	}
	var sdp webrtc.SessionDescription
	if err := json.Unmarshal(raw, &sdp); err != nil {
		t.Fatalf("unmarshal answer: %v", err)
	}
	if err := pc.SetRemoteDescription(sdp); err != nil {
		t.Fatalf("set remote: %v", err)
	}
	return pc
}
