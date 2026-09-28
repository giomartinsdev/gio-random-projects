package rooms

import "testing"

// A publisher is more than a boolean now: the server also has to
// remember WHICH MediaMTX path that publisher owns and the session
// Location to tear it down. The target lives on the peer, guarded by the
// room mutex, with the same lifetime as the peer itself.
func TestPublishTargetRoundTrips(t *testing.T) {
	room := &Room{peers: map[string]*Peer{}, knocks: map[string]*Knock{}}
	p := NewPeer("p1", "Ana")
	room.peers[p.ID] = p

	room.SetPublishTarget(p, "tela-sala-p1", "/tela-sala-p1/whip/sessao", true)
	path, location, ok := room.PublishTarget("p1")
	if !ok || path != "tela-sala-p1" || location != "/tela-sala-p1/whip/sessao" {
		t.Fatalf("target = (%q, %q, %v), want the stored path/location", path, location, ok)
	}
	gotPath, gotAudio, ok := room.PublishTargetInfo("p1")
	if !ok || gotPath != "tela-sala-p1" || !gotAudio {
		t.Fatalf("info = (%q, %v, %v), want the path and audio flag", gotPath, gotAudio, ok)
	}

	room.ClearPublishTarget(p)
	if _, _, ok := room.PublishTarget("p1"); ok {
		t.Fatal("a cleared target must no longer report as present")
	}
}

func TestPublishTargetForAnUnknownPeerIsAbsent(t *testing.T) {
	room := &Room{peers: map[string]*Peer{}, knocks: map[string]*Knock{}}
	if _, _, ok := room.PublishTarget("ninguem"); ok {
		t.Fatal("an unknown peer has no publish target")
	}
}

// A peer that leaves must not leave its MediaMTX path pinned to a ghost
// -- the target dies with the peer.
func TestPublishTargetDiesWithThePeer(t *testing.T) {
	room := &Room{peers: map[string]*Peer{}, knocks: map[string]*Knock{}}
	p := NewPeer("p1", "Ana")
	room.peers[p.ID] = p
	room.SetPublishTarget(p, "tela-sala-p1", "/x/whip/y", false)

	room.Leave(p)

	if _, _, ok := room.PublishTarget("p1"); ok {
		t.Fatal("the publish target survived the peer leaving")
	}
}
