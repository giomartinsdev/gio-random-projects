package sfu_test

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/sfu"
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
	}, func(string) {})
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
	}, func(string) {})
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
	}, func(string) {})
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

// A hostname is resolved to an address at startup, because ICE
// candidates carry addresses and browsers don't resolve names handed to
// them in a candidate.
func TestPublicHostAcceptsAnIPOrAHostname(t *testing.T) {
	direct, err := sfu.New(sfu.Options{UDPPort: 0, PublicHost: "203.0.113.7"})
	if err != nil {
		t.Fatalf("literal ip: %v", err)
	}
	if got := direct.PublicIP(); got != "203.0.113.7" {
		t.Fatalf("a literal IP should be used as-is, got %q", got)
	}

	named, err := sfu.New(sfu.Options{UDPPort: 0, PublicHost: "localhost"})
	if err != nil {
		t.Fatalf("hostname: %v", err)
	}
	if got := named.PublicIP(); got != "127.0.0.1" {
		t.Fatalf("expected localhost to resolve to 127.0.0.1, got %q", got)
	}

	none, err := sfu.New(sfu.Options{UDPPort: 0})
	if err != nil {
		t.Fatalf("unset: %v", err)
	}
	if got := none.PublicIP(); got != "" {
		t.Fatalf("nothing configured should advertise nothing, got %q", got)
	}
}

// A name that doesn't resolve fails at startup rather than silently
// advertising nothing and leaving video that never begins.
func TestUnresolvableHostFailsLoudly(t *testing.T) {
	if _, err := sfu.New(sfu.Options{UDPPort: 0, PublicHost: "nao-existe.invalid"}); err == nil {
		t.Fatal("expected an unresolvable host to be an error")
	}
}

// browserSubscriber is the far end of the subscriber side: a real peer
// connection that answers every offer the server throws at it, the way a
// healthy browser does. Offers are answered one at a time on a single
// goroutine, mirroring the client, which runs its signalling serially.
type browserSubscriber struct {
	sub   *sfu.Subscriber
	pc    *webrtc.PeerConnection
	got   chan string // remote track IDs, as negotiated onto this PC
	fatal chan string

	mu       sync.Mutex
	offerLog []string // SDP of every offer the server sent, in arrival order
}

func (b *browserSubscriber) offersSince(n int) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]string(nil), b.offerLog[n:]...)
}

func (b *browserSubscriber) offerCount() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.offerLog)
}

func newBrowserSubscriber(t *testing.T, s *sfu.Server, roomID, peerID string) *browserSubscriber {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("subscriber pc: %v", err)
	}
	t.Cleanup(func() { _ = pc.Close() })
	b := &browserSubscriber{pc: pc, got: make(chan string, 64), fatal: make(chan string, 4)}
	pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		select {
		case b.got <- remote.ID():
		default:
		}
	})
	offers := make(chan webrtc.SessionDescription, 64)
	b.sub, err = s.Subscribe(roomID, peerID,
		func(c webrtc.ICECandidateInit) {
			_ = pc.AddICECandidate(c)
		},
		func(o webrtc.SessionDescription) {
			// Same buffer discipline as the peer's send queue: dropping
			// would leave the server wedged in have-local-offer, which is
			// a bug in itself, so the channel is generously sized.
			offers <- o
		},
		func(code string) {
			select {
			case b.fatal <- code:
			default:
			}
		},
	)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	t.Cleanup(func() { b.sub.Close() })
	go func() {
		for o := range offers {
			b.mu.Lock()
			b.offerLog = append(b.offerLog, o.SDP)
			b.mu.Unlock()
			if err := pc.SetRemoteDescription(o); err != nil {
				continue
			}
			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				continue
			}
			if err := pc.SetLocalDescription(answer); err != nil {
				continue
			}
			_ = b.sub.Answer(gathered(t, pc))
		}
	}()
	return b
}

// startPublisher offers one video track from its own peer connection and
// keeps frames flowing until the test ends. Returns the connection so a
// test can close it out of order -- re-shares are the whole point of these
// tests.
func startPublisher(t *testing.T, s *sfu.Server, roomID, peerID, trackID string) (*webrtc.PeerConnection, func()) {
	t.Helper()
	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("publisher pc: %v", err)
	}
	track, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, trackID, peerID)
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
	_, answer, err := s.Publish(roomID, peerID, gathered(t, pubPC), func(webrtc.ICECandidateInit) {})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	// The pump stops when a test's cleanup closes the PC underneath it,
	// which can race a test's own explicit stop -- one close, ever.
	stop := make(chan struct{})
	var once sync.Once
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

	if err := pubPC.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("publisher set remote: %v", err)
	}
	t.Cleanup(func() { _ = pubPC.Close() })
	return pubPC, func() { once.Do(func() { close(stop) }) }
}

// An answer with no offer outstanding used to be applied anyway; on pion
// it silently wedged the SDP state machine. It must come back as an error
// instead.
func TestAnswerWithoutOfferIsAnError(t *testing.T) {
	server := newServer(t)
	b := newBrowserSubscriber(t, server, "SALA-G", "sub-g")

	err := b.sub.Answer(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: "v=0\r\n"})
	if err == nil {
		t.Fatal("an out-of-turn answer should be an error, not silently dropped")
	}
}

// The re-share race: person X stops sharing and immediately starts again
// under the same peer id. The old connection's teardown drains
// asynchronously -- each track's forward loop notices the close on its
// own -- and used to delete the NEW share's registration from the room on
// its way out, making every viewer's tile freeze. After a late teardown,
// someone joining fresh must still be offered the surviving share.
func TestStaleTeardownDoesNotWipeTheReshare(t *testing.T) {
	server := newServer(t)
	const roomID, peerID = "SALA-RE", "pub-x"

	_, stopA := startPublisher(t, server, roomID, peerID, "share-a")
	defer stopA()

	b := newBrowserSubscriber(t, server, roomID, "watcher")
	select {
	case <-b.got:
	case code := <-b.fatal:
		t.Fatalf("subscriber signalled an error while receiving the first share: %s", code)
	case <-time.After(15 * time.Second):
		t.Fatal("viewer never received the first share")
	}

	// Re-share on the same peer id while the first connection is still
	// running -- this is what the server does when a publish:offer
	// replaces an in-flight share, and its reap step takes over cleanup
	// of the old registration.
	startPublisher(t, server, roomID, peerID, "share-b")
	select {
	case <-b.got:
	case code := <-b.fatal:
		t.Fatalf("subscriber signalled an error on re-share: %s", code)
	case <-time.After(15 * time.Second):
		t.Fatal("viewer never received the re-shared source")
	}

	// NOW let the old connection tear down -- by the time its forward
	// goroutines notice, the room must be holding only share-b.
	stopA()
	time.Sleep(300 * time.Millisecond)

	// A viewer that joins after all of that still sees the share.
	late := newBrowserSubscriber(t, server, roomID, "watcher-late")
	select {
	case track := <-late.got:
		if track != "share-b" {
			t.Fatalf("late viewer received %q, want the surviving re-share", track)
		}
	case code := <-late.fatal:
		t.Fatalf("late subscriber signalled an error: %s", code)
	case <-time.After(15 * time.Second):
		t.Fatal("the re-share vanished: a late viewer was offered nothing")
	}
}

// Serialise-or-die: publishers starting and stopping back to back hammer
// the subscriber's negotiation state machine with add and remove events in
// quick succession. The swapped-offer bug (an offer fired while the
// previous one was still unanswered) swallowed entire renegotiations at
// random and left the viewer with whichever m-lines happened to survive.
// The end state that matters is simple: the LAST publisher's media reaches
// the viewer.
func TestChurnedPublishersAlwaysDeliverTheLastShare(t *testing.T) {
	server := newServer(t)
	const roomID, peerID = "SALA-CH", "pub-c"

	b := newBrowserSubscriber(t, server, roomID, "watcher-old")
	defer b.sub.Close()

	// Stop the previous share and start the next one back to back --
	// removal and addition renegotiations interleaving in the sub-100ms
	// window is exactly the pattern that used to swallow offers.
	var prevStop func()
	for i := 0; i < 8; i++ {
		if prevStop != nil {
			prevStop()
		}
		startPublisher(t, server, roomID, peerID, fmt.Sprintf("gen-%d", i))
		time.Sleep(150 * time.Millisecond) // let its track register before the next churn
	}
	if prevStop != nil {
		defer prevStop()
	}

	// Media of the final generation has to show up.
	deadline := time.Now().Add(20 * time.Second)
	var got []string
	for time.Now().Before(deadline) {
		select {
		case track := <-b.got:
			got = append(got, track)
			if track == "gen-7" {
				return
			}
		case code := <-b.fatal:
			t.Fatalf("subscriber signalled an error during churn: %s", code)
		case <-time.After(100 * time.Millisecond):
		}
	}
	t.Fatalf("churn lost renegotiations: the last generation never arrived (got %v)", got)
}

// startPublisherAV is startPublisher with an audio track riding beside
// the video. The video-toggle tests need it to prove that silencing one
// publisher's VIDEO leaves its AUDIO flowing -- something a video-only
// publisher cannot demonstrate.
func startPublisherAV(t *testing.T, s *sfu.Server, roomID, peerID, videoID, audioID string) *webrtc.PeerConnection {
	t.Helper()
	pubPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("publisher pc: %v", err)
	}
	video, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, videoID, peerID)
	if err != nil {
		t.Fatalf("video track: %v", err)
	}
	audio, err := webrtc.NewTrackLocalStaticSample(
		webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, audioID, peerID)
	if err != nil {
		t.Fatalf("audio track: %v", err)
	}
	if _, err := pubPC.AddTrack(video); err != nil {
		t.Fatalf("add video track: %v", err)
	}
	if _, err := pubPC.AddTrack(audio); err != nil {
		t.Fatalf("add audio track: %v", err)
	}
	offer, err := pubPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := pubPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local: %v", err)
	}
	_, answer, err := s.Publish(roomID, peerID, gathered(t, pubPC), func(webrtc.ICECandidateInit) {})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}

	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				_ = video.WriteSample(media.Sample{Data: []byte{0x00, 0x01, 0x02, 0x03}, Duration: 20 * time.Millisecond})
				_ = audio.WriteSample(media.Sample{Data: []byte{0x00, 0x01, 0x02, 0x03}, Duration: 20 * time.Millisecond})
			}
		}
	}()

	if err := pubPC.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("publisher set remote: %v", err)
	}
	t.Cleanup(func() { _ = pubPC.Close() })
	return pubPC
}

// waitForOffer waits for an offer whose SDP satisfies pred, considering
// only offers logged after `since`. `since` MUST be captured with
// b.offerCount() BEFORE the action that triggers the negotiation: the
// server sends the offer synchronously inside that action (onOffer), and
// the helper goroutine's log append can land before a wait that started
// afterwards takes its own snapshot -- which would make a negotiation
// that did happen read as "0 new offers" and time out. This was a real
// flake under -race, where that window widens from nanoseconds to
// milliseconds. The server may coalesce several track changes into one
// offer, so the predicate is applied to each new offer in arrival order
// and the first match wins.
func waitForOffer(t *testing.T, b *browserSubscriber, since int, timeout time.Duration, pred func(sdp string) bool) string {
	t.Helper()
	start := since
	deadline := time.After(timeout)
	for {
		for _, sdp := range b.offersSince(start) {
			if pred(sdp) {
				return sdp
			}
		}
		select {
		case <-deadline:
			// The SDP of the last new offer turns a bare "none matched"
			// into something diagnosable -- a direction that didn't flip,
			// an m-line missing entirely, and so on.
			seen := b.offersSince(start)
			last := ""
			if len(seen) > 0 {
				last = seen[len(seen)-1]
			}
			t.Fatalf("no offer matching the predicate arrived (%d new offers, none matched)\nlast offer SDP:\n%s",
				b.offerCount()-start, last)
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// countSendonlySections counts media sections of one kind whose body
// declares `a=sendonly`. Section counts alone would lie here: pion's
// RemoveTrack turns a transceiver's direction from sendonly to INACTIVE
// but leaves the m-line in the offer, so "the video is gone" reads as a
// direction change, not as a missing m-line.
func countSendonlySections(sdp, kind string) int {
	count, inSection := 0, false
	for _, line := range strings.Split(sdp, "\r\n") {
		if strings.HasPrefix(line, "m=") {
			inSection = strings.HasPrefix(line, "m="+kind+" ")
			continue
		}
		if inSection && strings.TrimSpace(line) == "a=sendonly" {
			count++
		}
	}
	return count
}

// waitForTrack blocks until the subscriber's PC fires ontrack for one
// specific track id, draining any other id that arrives first. There is
// no guaranteed order between the receivers of a renegotiation: the new
// audio of a re-share can announce itself before the new video, and a
// test that read a single receive as "the video" would pass on a fast
// machine and flake on CI.
func waitForTrack(t *testing.T, b *browserSubscriber, want, stage string, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case id := <-b.got:
			if id == want {
				return
			}
		case code := <-b.fatal:
			t.Fatalf("%s: %s", stage, code)
		case <-deadline:
			t.Fatalf("%s: never received track %q", stage, want)
		}
	}
}

// Turning a publisher's video off is a per-subscriber renegotiation: the
// offer loses the video m-line's sendonly direction while the audio
// m-line keeps it, and turning it back on brings the picture (and a new
// video m-line -- pion won't reuse a transceiver the browser has
// answered inactive) with it.
func TestSubscriberVideoToggleStopsAndRestoresVideo(t *testing.T) {
	server := newServer(t)
	const roomID, peerID = "SALA-VO", "pub-v"

	startPublisherAV(t, server, roomID, peerID, "share-a", "voice-a")
	b := newBrowserSubscriber(t, server, roomID, "watcher")

	// Both tracks of the share arrive before anything is toggled.
	received := map[string]bool{}
	for len(received) < 2 {
		select {
		case id := <-b.got:
			received[id] = true
		case code := <-b.fatal:
			t.Fatalf("subscriber signalled an error before the toggle: %s", code)
		case <-time.After(15 * time.Second):
			t.Fatalf("viewer never received both tracks, got %v", received)
		}
	}

	since := b.offerCount()
	if err := b.sub.SetPublisherVideoEnabled(peerID, false); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	waitForOffer(t, b, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") == 0 && countSendonlySections(sdp, "audio") >= 1
	})

	since = b.offerCount()
	if err := b.sub.SetPublisherVideoEnabled(peerID, true); err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	waitForOffer(t, b, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") >= 1
	})
	select {
	case id := <-b.got:
		if id != "share-a" {
			t.Fatalf("expected the video track back, got %q", id)
		}
	case code := <-b.fatal:
		t.Fatalf("subscriber signalled an error on restore: %s", code)
	case <-time.After(15 * time.Second):
		t.Fatal("video never came back after the re-enable")
	}
}

// A viewer who turned a publisher's video off must not get it back just
// because the publisher stopped and re-shared: a re-share replaces the
// publishedTrack objects, and the opt-out is keyed by peer id, so the
// fan-out of the replacement has to honour it too.
func TestVideoOptOutSurvivesAPublisherReshare(t *testing.T) {
	server := newServer(t)
	const roomID, peerID = "SALA-RS", "pub-r"

	startPublisherAV(t, server, roomID, peerID, "gen-a", "voice-a")
	b := newBrowserSubscriber(t, server, roomID, "watcher")

	received := map[string]bool{}
	for len(received) < 2 {
		select {
		case id := <-b.got:
			received[id] = true
		case code := <-b.fatal:
			t.Fatalf("subscriber signalled an error before the toggle: %s", code)
		case <-time.After(15 * time.Second):
			t.Fatalf("viewer never received both tracks, got %v", received)
		}
	}

	since := b.offerCount()
	if err := b.sub.SetPublisherVideoEnabled(peerID, false); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	waitForOffer(t, b, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") == 0 && countSendonlySections(sdp, "audio") >= 1
	})

	// Re-share under the same peer id, the way a fast stop/start does.
	since = b.offerCount()
	startPublisherAV(t, server, roomID, peerID, "gen-b", "voice-b")
	waitForOffer(t, b, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") == 0 && countSendonlySections(sdp, "audio") >= 1
	})

	// The re-shared audio arrives; the re-shared video must not.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case id := <-b.got:
			if id == "gen-b" {
				t.Fatal("the opted-out viewer received the re-shared video anyway")
			}
		case code := <-b.fatal:
			t.Fatalf("subscriber signalled an error during the re-share: %s", code)
		case <-time.After(200 * time.Millisecond):
		}
	}

	since = b.offerCount()
	if err := b.sub.SetPublisherVideoEnabled(peerID, true); err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	waitForOffer(t, b, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") >= 1
	})
	// The video id, specifically -- the re-share's audio may still be in
	// flight and must not be mistaken for the restore having worked.
	waitForTrack(t, b, "gen-b", "the re-shared video never came back after the re-enable", 15*time.Second)
}

// One viewer's choices say nothing about another's: silencing a
// publisher's video for yourself must not touch anyone else's
// subscription.
func TestVideoOptOutOnlyAffectsTheAskingSubscriber(t *testing.T) {
	server := newServer(t)
	const roomID, peerID = "SALA-OO", "pub-o"

	startPublisherAV(t, server, roomID, peerID, "gen-a", "voice-a")
	b1 := newBrowserSubscriber(t, server, roomID, "watcher-1")
	b2 := newBrowserSubscriber(t, server, roomID, "watcher-2")

	received := map[string]bool{}
	for len(received) < 4 { // both tracks, both viewers
		select {
		case id := <-b1.got:
			received["1:"+id] = true
		case id := <-b2.got:
			received["2:"+id] = true
		case <-time.After(15 * time.Second):
			t.Fatalf("viewers never received both tracks, got %v", received)
		}
	}

	since := b1.offerCount()
	if err := b1.sub.SetPublisherVideoEnabled(peerID, false); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	waitForOffer(t, b1, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") == 0 && countSendonlySections(sdp, "audio") >= 1
	})

	// Re-share under the same peer id: b2 keeps getting video, b1 must
	// not -- until b1 asks for it back.
	startPublisherAV(t, server, roomID, peerID, "gen-b", "voice-b")
	// The re-share's two new tracks fire ontrack in either order, so
	// wait for the video id specifically and let waitForTrack drain the
	// audio one if it got there first.
	waitForTrack(t, b2, "gen-b", "the unaffected viewer, during the re-share", 15*time.Second)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case id := <-b1.got:
			if id == "gen-b" {
				t.Fatal("the opted-out viewer received the re-shared video anyway")
			}
		case <-time.After(200 * time.Millisecond):
		}
	}

	since = b1.offerCount()
	if err := b1.sub.SetPublisherVideoEnabled(peerID, true); err != nil {
		t.Fatalf("toggle on: %v", err)
	}
	waitForOffer(t, b1, since, 10*time.Second, func(sdp string) bool {
		return countSendonlySections(sdp, "video") >= 1
	})
	waitForTrack(t, b1, "gen-b", "b1's video never came back after the re-enable", 15*time.Second)
}
