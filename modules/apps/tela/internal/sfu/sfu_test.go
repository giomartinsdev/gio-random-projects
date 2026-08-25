package sfu_test

import (
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela/internal/sfu"
)

// A real publisher and a real subscriber, both actual WebRTC peer
// connections, with media crossing the server. Faking any of it would
// leave the interesting part -- whether packets actually arrive --
// untested.
func newServer(t *testing.T) *sfu.Server {
	t.Helper()
	// Port 0 lets the OS pick, so parallel test runs don't collide.
	s, err := sfu.New(sfu.Options{UDPPort: 0})
	if err != nil {
		t.Fatalf("new sfu: %v", err)
	}
	return s
}

// Trickled candidates would need plumbing on both sides; waiting for
// gathering to finish gives a complete SDP and keeps the tests about
// the SFU rather than about signalling.
func gathered(t *testing.T, pc *webrtc.PeerConnection) webrtc.SessionDescription {
	t.Helper()
	<-webrtc.GatheringCompletePromise(pc)
	return *pc.LocalDescription()
}

func TestPublishedMediaReachesASubscriber(t *testing.T) {
	server := newServer(t)

	// --- publisher ---
	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("publisher pc: %v", err)
	}
	defer pubPC.Close()

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", "publisher-stream")
	if err != nil {
		t.Fatalf("track: %v", err)
	}
	if _, err := pubPC.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}

	offer, err := pubPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := pubPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}

	_, answer, err := server.Publish("SALA1", "pub-1", gathered(t, pubPC), func(webrtc.ICECandidateInit) {})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if err := pubPC.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("publisher set remote: %v", err)
	}

	// Keep sending frames: a subscriber that joins later still needs
	// packets arriving to have anything to receive.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				_ = track.WriteSample(media.Sample{Data: []byte{0x00, 0x01, 0x02, 0x03}, Duration: 20 * time.Millisecond})
			}
		}
	}()

	// --- subscriber ---
	subPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("subscriber pc: %v", err)
	}
	defer subPC.Close()

	gotTrack := make(chan *webrtc.TrackRemote, 1)
	subPC.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case gotTrack <- remote:
		default:
		}
	})

	offers := make(chan webrtc.SessionDescription, 4)
	sub, err := server.Subscribe("SALA1", "sub-1", func(webrtc.ICECandidateInit) {}, func(o webrtc.SessionDescription) {
		offers <- o
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Close()

	// The publisher's ICE may still be connecting when we subscribe, so
	// its track can register slightly later -- wait for the offer that
	// actually carries video rather than whichever comes first.
	serverOffer := waitForVideoOffer(t, offers, 15*time.Second)

	if err := subPC.SetRemoteDescription(serverOffer); err != nil {
		t.Fatalf("subscriber set remote: %v", err)
	}
	subAnswer, err := subPC.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("subscriber answer: %v", err)
	}
	if err := subPC.SetLocalDescription(subAnswer); err != nil {
		t.Fatalf("subscriber set local: %v", err)
	}
	if err := sub.Answer(gathered(t, subPC)); err != nil {
		t.Fatalf("server take answer: %v", err)
	}

	select {
	case remote := <-gotTrack:
		// The stream id carries the publisher's peer id, which is how
		// the client labels each tile.
		if remote.StreamID() != "pub-1" {
			t.Fatalf("expected the track to be tagged with the publisher, got %q", remote.StreamID())
		}
	case <-time.After(15 * time.Second):
		t.Fatal("media published to the SFU never reached the subscriber")
	}
}

// Nobody should be sent their own picture back: the browser already has
// it locally, and forwarding it would spend the server's upload on
// something nobody watches.
func TestPublisherDoesNotSubscribeToItself(t *testing.T) {
	server := newServer(t)

	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("publisher pc: %v", err)
	}
	defer pubPC.Close()

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", "self")
	if err != nil {
		t.Fatalf("track: %v", err)
	}
	if _, err := pubPC.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}
	offer, err := pubPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := pubPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}
	if _, _, err := server.Publish("SALA2", "same-peer", gathered(t, pubPC), func(webrtc.ICECandidateInit) {}); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Give the track time to register before subscribing.
	time.Sleep(500 * time.Millisecond)

	offers := make(chan webrtc.SessionDescription, 4)
	sub, err := server.Subscribe("SALA2", "same-peer", func(webrtc.ICECandidateInit) {}, func(o webrtc.SessionDescription) {
		offers <- o
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Close()

	select {
	case o := <-offers:
		// An offer with no media section means nothing was attached,
		// which is what we want.
		if countVideoSections(o.SDP) != 0 {
			t.Fatal("a peer was offered its own published track back")
		}
	case <-time.After(3 * time.Second):
		// No offer at all is equally fine -- nothing to send.
	}
}

// Rooms don't see each other's media.
func TestMediaDoesNotCrossRooms(t *testing.T) {
	server := newServer(t)

	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("publisher pc: %v", err)
	}
	defer pubPC.Close()

	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", "a")
	if err != nil {
		t.Fatalf("track: %v", err)
	}
	if _, err := pubPC.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}
	offer, err := pubPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := pubPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}
	if _, _, err := server.Publish("SALA-A", "pub-a", gathered(t, pubPC), func(webrtc.ICECandidateInit) {}); err != nil {
		t.Fatalf("publish: %v", err)
	}
	time.Sleep(500 * time.Millisecond)

	offers := make(chan webrtc.SessionDescription, 4)
	sub, err := server.Subscribe("SALA-B", "sub-b", func(webrtc.ICECandidateInit) {}, func(o webrtc.SessionDescription) {
		offers <- o
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer sub.Close()

	select {
	case o := <-offers:
		if countVideoSections(o.SDP) != 0 {
			t.Fatal("a subscriber in one room was offered another room's media")
		}
	case <-time.After(3 * time.Second):
	}
}

func waitForVideoOffer(t *testing.T, offers <-chan webrtc.SessionDescription, timeout time.Duration) webrtc.SessionDescription {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case o := <-offers:
			if countVideoSections(o.SDP) > 0 {
				return o
			}
		case <-deadline:
			t.Fatal("server never offered the published track to the subscriber")
		}
	}
}

func countVideoSections(sdp string) int {
	count := 0
	for i := 0; i+8 <= len(sdp); i++ {
		if sdp[i:i+8] == "m=video " {
			count++
		}
	}
	return count
}
