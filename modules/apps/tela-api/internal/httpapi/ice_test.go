package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/turn"
)

// The browser asks the server for its ICE configuration on join. With
// no TURN configured it must get STUN and a policy that does NOT force
// the relay -- forcing it without a relay would leave no candidates.
func TestIceEndpointStunOnlyWhenUnconfigured(t *testing.T) {
	srv := newServerWithTurn(t, turn.New(turn.Options{STUNURLs: []string{"stun:stun.example.org:3478"}}))

	res, err := srv.Client().Get(srv.URL + "/api/rtc/ice")
	if err != nil {
		t.Fatalf("get ice: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var body struct {
		IceServers []struct {
			URLs []string `json:"urls"`
		} `json:"iceServers"`
		Policy string `json:"iceTransportPolicy"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.IceServers) != 1 || body.IceServers[0].URLs[0] != "stun:stun.example.org:3478" {
		t.Fatalf("iceServers = %+v", body.IceServers)
	}
	if body.Policy != "all" {
		t.Fatalf("policy = %q, want all without a relay", body.Policy)
	}
}

// With TURN configured, the browser gets the relay and is pinned to it.
func TestIceEndpointForcesRelayWhenTurnConfigured(t *testing.T) {
	srv := newServerWithTurn(t, turn.New(turn.Options{
		STUNURLs:     []string{"stun:stun.example.org:3478"},
		TurnURLs:     []string{"turn:turn.example.org:3478?transport=udp"},
		TurnUsername: "u",
		TurnPassword: "p",
	}))

	res, err := srv.Client().Get(srv.URL + "/api/rtc/ice")
	if err != nil {
		t.Fatalf("get ice: %v", err)
	}
	defer res.Body.Close()
	var body struct {
		IceServers []struct {
			URLs       []string `json:"urls"`
			Username   string   `json:"username"`
			Credential string   `json:"credential"`
		} `json:"iceServers"`
		Policy string `json:"iceTransportPolicy"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.IceServers) != 2 {
		t.Fatalf("iceServers = %+v, want STUN + TURN", body.IceServers)
	}
	if body.IceServers[1].Username != "u" || body.IceServers[1].Credential != "p" {
		t.Fatalf("turn creds = %+v", body.IceServers[1])
	}
	if body.Policy != "relay" {
		t.Fatalf("policy = %q, want relay with TURN", body.Policy)
	}
}

func newServerWithTurn(t *testing.T, tp *turn.Proxy) *httptest.Server {
	t.Helper()
	api := buildServer(t, tp)
	srv := httptest.NewServer(api.Handler())
	t.Cleanup(srv.Close)
	return srv
}
