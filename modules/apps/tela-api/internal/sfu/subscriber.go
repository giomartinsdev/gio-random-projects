package sfu

import (
	"fmt"
	"sync"
	"time"

	"github.com/pion/webrtc/v4"
)

// How long an offer may sit unanswered before the connection rolls back
// and re-offers. The only way to hit this is a lost answer: the browser's
// reply is the only thing that moves this SDP state machine forward, and
// an offer can genuinely vanish -- Peer.Send drops rather than blocks when
// its buffer fills -- leaving the connection wedged in have-local-offer
// for as long as nobody notices. After this timeout a fresh offer is
// simply rebuilt from the tracks currently attached.
const negotiateFlightTimeout = 5 * time.Second

// Subscriber is one person receiving everyone else's media. Unlike the
// publisher side, the SERVER offers here: tracks appear and disappear
// as other people start and stop sharing, and each change needs a new
// offer that the browser answers.
//
// Lock order is s.mu -> negotiateMu: attach() holds s.mu, and everything
// below guards the SDP lifecycle with negotiateMu alone -- no code path
// takes negotiateMu and then reaches for s.mu.
type Subscriber struct {
	pc     *webrtc.PeerConnection
	server *Server
	room   *Room
	peerID string

	// Serialises renegotiation end to end, not just the moment of
	// creating the offer. Two people starting to share at the same
	// instant used to race their offers here, and pion has no implicit
	// rollback: a second SetLocalDescription(offer) while one is already
	// outstanding fails with InvalidModificationError -- an error this
	// file used to swallow, leaving the new track attached but never
	// negotiated and the viewer stuck on "connecting" forever.
	negotiateMu   sync.Mutex
	offerInFlight bool // offer is on its way to the browser, no answer yet
	offerQueued   bool // a track changed while the offer above was in flight
	inFlightAt    time.Time
	onOffer       func(webrtc.SessionDescription)
	// Called when the SDP state machine jams for good: the HTTP layer
	// turns these into "subscribe:error" messages so the viewer's UI can
	// say something instead of spinning a tile forever.
	onError func(code string)

	mu      sync.Mutex
	senders map[*publishedTrack][]*webrtc.RTPSender // by published track
	closed  bool

	// Publishers whose video this viewer asked NOT to receive, keyed by
	// publisher peer id. Audio always keeps flowing. Kept on the
	// Subscriber -- not looked up per negotiation -- because a re-share
	// replaces the publishedTrack objects: the choice has to outlive them
	// (and outlive the publisher stopping entirely). It dies with the
	// subscriber: a reconnect lands on a fresh Subscriber, and the client
	// re-sends its off-list after `welcome`.
	videoOptOut map[string]bool

	// Which simulcast layer ("high"/"low") this viewer gets of each
	// publisher's video, keyed by publisher peer id. Missing means "high"
	// -- everyone starts on the best layer, same as before simulcast
	// existed; a client-side heuristic (loss/jitter, watching its own
	// getStats()) asks to downgrade, not the server. Same lifetime rule
	// as videoOptOut: dies with the subscriber, re-asserted after a
	// reconnect isn't needed since a fresh Subscriber defaults to "high"
	// anyway, which is the same starting point a first-time join gets.
	videoLayer map[string]string
}

// Subscribe opens the receive side for one person. onOffer is called
// whenever the server needs the browser to answer -- immediately for
// whatever is already being published, and again on every change.
// onError is called when negotiation fails in a way the connection can't
// recover from on its own.
func (s *Server) Subscribe(roomID, peerID string, onICE func(webrtc.ICECandidateInit), onOffer func(webrtc.SessionDescription), onError func(code string)) (*Subscriber, error) {
	pc, err := s.api.NewPeerConnection(s.cfg)
	if err != nil {
		return nil, fmt.Errorf("new peer connection: %w", err)
	}

	room := s.room(roomID)
	sub := &Subscriber{
		pc:          pc,
		server:      s,
		room:        room,
		peerID:      peerID,
		onOffer:     onOffer,
		onError:     onError,
		senders:     make(map[*publishedTrack][]*webrtc.RTPSender),
		videoOptOut: make(map[string]bool),
		videoLayer:  make(map[string]string),
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			onICE(c.ToJSON())
		}
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			sub.Close()
		default:
		}
	})

	room.mu.Lock()
	room.subscribers[peerID] = sub
	room.mu.Unlock()

	// Whatever is already being shared, minus anything this person is
	// publishing themselves. If nothing is being shared yet there's
	// nothing to negotiate -- an offer with no media has no ICE
	// credentials in it and the browser rejects it outright. The first
	// real offer comes from addTrack when someone starts sharing.
	attached := false
	for _, track := range room.allTracks() {
		if track.publisher == peerID {
			continue
		}
		if sub.attach(track) {
			attached = true
		}
	}
	if attached {
		sub.negotiate()
	}

	return sub, nil
}

func (s *Subscriber) addTrack(t *publishedTrack) {
	if s.attach(t) {
		s.negotiate()
	}
}

func (s *Subscriber) attach(t *publishedTrack) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return false
	}
	// Already attached -- a second sender for the same track would
	// duplicate the stream. Matters when restoring a video: the audio
	// senders never left, so re-attaching must add only what's missing.
	if _, ok := s.senders[t]; ok {
		return false
	}
	// Every attach passes through here -- the initial Subscribe loop, the
	// fan-out when a track appears, and a re-enable -- so the opt-out
	// can't be forgotten by a future code path that attaches. A video
	// re-share creates a brand-new publishedTrack and flows through here
	// like the first one did.
	if t.local.Kind() == webrtc.RTPCodecTypeVideo && s.videoOptOut[t.publisher] {
		return false
	}
	// A simulcast layer this viewer didn't pick is not attached at all --
	// forwarding every layer to every viewer would defeat the entire
	// point (N times the upload cost for no benefit). Non-simulcast
	// tracks (t.rid == "") are unaffected: audio, camera shares, and
	// screen shares at an explicit low quality all attach exactly as
	// before.
	if t.rid != "" && t.rid != s.layerForLocked(t.publisher) {
		return false
	}
	// Sendonly, not AddTrack's default sendrecv: this side sends to the
	// browser and never receives. With the direction pinned, RemoveTrack
	// (a stop, not a restore) flips the transceiver to `inactive` -- with
	// sendrecv it would land on `recvonly`, and a fast re-enable would
	// try to re-add a track onto a recvonly transceiver, which pion
	// rejects as an invalid state transition. Each attach takes a fresh
	// transceiver (AddTransceiverFromTrack never reuses), so a stop/restore
	// cycle appends one m-line; see SetPublisherVideoEnabled.
	transceiver, err := s.pc.AddTransceiverFromTrack(t.local, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionSendonly,
	})
	if err != nil {
		return false
	}
	sender := transceiver.Sender()
	s.senders[t] = append(s.senders[t], sender)

	// Draining RTCP from this sender is what keeps NACK and receiver
	// reports flowing; without the read the interceptor chain stalls.
	go func() {
		buf := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buf); err != nil {
				return
			}
		}
	}()
	return true
}

// layerForLocked returns which simulcast layer this viewer wants of one
// publisher's video -- "high" if they never asked for anything else.
// Caller holds s.mu.
func (s *Subscriber) layerForLocked(publisherID string) string {
	if rid, ok := s.videoLayer[publisherID]; ok {
		return rid
	}
	return "high"
}

// removeTracks drops this subscriber's copies of exactly these tracks and
// renegotiates once at the end. Keyed by track, not by publisher, for the
// same reason removePublisherTracks is: a stale teardown must only ever
// detach the tracks of the connection that actually ended.
func (s *Subscriber) removeTracks(tracks []*publishedTrack) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	var senders []*webrtc.RTPSender
	for _, t := range tracks {
		senders = append(senders, s.senders[t]...)
		delete(s.senders, t)
	}
	s.mu.Unlock()

	if len(senders) == 0 {
		return
	}
	for _, sender := range senders {
		_ = s.pc.RemoveTrack(sender)
	}
	s.negotiate()
}

// SetPublisherVideoEnabled stops or restores forwarding ONE publisher's
// video track to this subscriber alone. Renegotiation is the only
// supported way to stop a track here: every subscriber shares the
// publisher's single TrackLocalStaticRTP, so dropping packets per viewer
// is impossible without transcoding. Audio is never touched -- muting
// someone's voice is already a purely local concern on the client.
//
// Lock order (this file's invariant): room.mu and s.mu are never held
// together, and s.mu is never held across negotiate(). The off path
// collects senders under s.mu and releases before removing; the on path
// reads the room (allTracks takes room.mu.RLock) before touching s.mu
// again inside attach.
//
// Each stop costs the browser a renegotiation whose offer carries the
// stopped video m-line as `a=inactive` -- RemoveTrack stops the sender
// but pion keeps the m-line in the SDP. Pion won't reuse a transceiver
// the browser has answered `inactive`, so restoring appends a fresh
// video m-line -- the SDP grows by one section per off/on cycle, which
// is harmless at the scale of a human pressing a button.
func (s *Subscriber) SetPublisherVideoEnabled(publisherID string, enabled bool) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	if enabled {
		delete(s.videoOptOut, publisherID)
	} else {
		s.videoOptOut[publisherID] = true
	}
	var toRemove []*publishedTrack
	if !enabled {
		for t := range s.senders {
			if t.publisher == publisherID && t.local.Kind() == webrtc.RTPCodecTypeVideo {
				toRemove = append(toRemove, t)
			}
		}
	}
	s.mu.Unlock()

	if enabled {
		// Restore whatever this publisher is sharing right now. Audio
		// senders never left, and attach skips what's already there, so
		// at most the video track is added.
		attached := false
		for _, t := range s.room.allTracks() {
			if t.publisher != publisherID {
				continue
			}
			if s.attach(t) {
				attached = true
			}
		}
		if attached {
			s.negotiate()
		}
		return nil
	}
	// removeTracks renegotiates ONCE at the end and no-ops when nothing
	// matched -- the publisher already stopped, or video was already off.
	s.removeTracks(toRemove)
	return nil
}

// SetPublisherVideoLayer switches which simulcast layer ("high"/"low")
// this viewer gets of one publisher's video -- the mechanism a
// client-side quality heuristic drives by watching its own connection
// (see useRoom.ts), same shape as SetPublisherVideoEnabled next to it.
// Asking for a layer that doesn't exist yet -- the publisher isn't
// simulcasting, or that layer hasn't arrived -- is not an error: the
// preference is recorded and applies the moment a matching
// publishedTrack shows up, via the normal addTrack fan-out.
func (s *Subscriber) SetPublisherVideoLayer(publisherID, rid string) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	current := s.layerForLocked(publisherID)
	if current == rid {
		s.mu.Unlock()
		return nil
	}
	s.videoLayer[publisherID] = rid
	s.mu.Unlock()

	// Only cut over once the wanted layer actually exists. A simulcast
	// publisher's lower layer can take a while to start flowing (some
	// browsers only spin up an unwatched encoding's RTP once something
	// asks), and a publisher who isn't simulcasting at all never has a
	// "low" to switch to. Either way, the preference above is recorded
	// and the normal addTrack fan-out applies it the moment a matching
	// publishedTrack shows up -- what must NOT happen is dropping the
	// layer that's already flowing on the strength of a preference for
	// one that isn't there yet, which would swap a working (if heavy)
	// picture for nothing at all.
	layers := s.room.videoLayersFor(publisherID)
	wanted := false
	for _, t := range layers {
		if t.rid == rid {
			wanted = true
			break
		}
	}
	if !wanted {
		return nil
	}

	s.mu.Lock()
	var old *publishedTrack
	for t := range s.senders {
		if t.publisher == publisherID && t.local.Kind() == webrtc.RTPCodecTypeVideo && t.rid == current {
			old = t
			break
		}
	}
	s.mu.Unlock()

	if old != nil {
		s.removeTracks([]*publishedTrack{old})
	}
	// attach() re-checks the (now-updated) preference itself, so handing
	// it every layer this publisher has is safe -- only the wanted one
	// actually attaches.
	attached := false
	for _, t := range layers {
		if s.attach(t) {
			attached = true
		}
	}
	if attached {
		s.negotiate()
	}
	return nil
}

// negotiate makes a fresh offer reflecting the tracks currently attached.
// The offer stays in flight until Answer() applies the browser's reply; a
// track change in that window is queued, not raced, and drained as one
// fresh offer the moment the connection is back to stable.
func (s *Subscriber) negotiate() {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return
	}

	s.negotiateMu.Lock()
	defer s.negotiateMu.Unlock()

	if s.offerInFlight {
		if time.Since(s.inFlightAt) < negotiateFlightTimeout {
			s.offerQueued = true
			return
		}
		// The answer never came, so the offer may never have arrived
		// either. Back to stable and re-offer everything below. Pion
		// needs a non-empty, parseable SDP to roll back with -- a bare
		// {Type: rollback} is itself rejected as an invalid
		// modification.
		if err := s.pc.SetLocalDescription(webrtc.SessionDescription{
			Type: webrtc.SDPTypeRollback,
			SDP:  s.pc.LocalDescription().SDP,
		}); err != nil {
			s.signalingError("rollback", err)
			return
		}
	}
	s.offerInFlight = true
	s.inFlightAt = time.Now()
	s.sendOfferLocked()
}

// sendOfferLocked runs the offer half of the negotiation. Caller holds
// negotiateMu. This used to return errors to nobody; now a failed
// renegotiation is announced to the viewer rather than silently granting
// them a permanent "connecting" tile.
func (s *Subscriber) sendOfferLocked() {
	offer, err := s.pc.CreateOffer(nil)
	if err != nil {
		s.offerInFlight = false
		s.signalingError("criar offer", err)
		return
	}
	if err := s.pc.SetLocalDescription(offer); err != nil {
		// Undo the half-applied local description so a later negotiate
		// starts from stable rather than compounding the error.
		_ = s.pc.SetLocalDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeRollback, SDP: offer.SDP})
		s.offerInFlight = false
		s.signalingError("aceitar offer", err)
		return
	}
	s.onOffer(offer)
}

func (s *Subscriber) signalingError(stage string, err error) {
	if s.onError == nil {
		return
	}
	s.onError(fmt.Sprintf("falha ao negociar a recepção (%s): %v", stage, err))
}

// Answer takes the browser's reply to an offer we sent. An answer that
// arrives out of turn -- no offer outstanding, or one whose reply already
// went stale -- is reported back instead of reset away: applying it blind
// is how a connection ends up describing tracks nobody ever offered.
func (s *Subscriber) Answer(answer webrtc.SessionDescription) error {
	s.negotiateMu.Lock()
	defer s.negotiateMu.Unlock()

	if s.pc.SignalingState() != webrtc.SignalingStateHaveLocalOffer {
		return fmt.Errorf("answer inesperado: estado de sinalização %s", s.pc.SignalingState())
	}
	if err := s.pc.SetRemoteDescription(answer); err != nil {
		return err
	}
	s.offerInFlight = false
	if s.offerQueued {
		s.offerQueued = false
		s.offerInFlight = true
		s.inFlightAt = time.Now()
		s.sendOfferLocked()
	}
	return nil
}

func (s *Subscriber) AddICECandidate(c webrtc.ICECandidateInit) error {
	return s.pc.AddICECandidate(c)
}

func (s *Subscriber) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.mu.Unlock()

	s.room.mu.Lock()
	delete(s.room.subscribers, s.peerID)
	s.room.mu.Unlock()

	_ = s.pc.Close()
	s.server.dropRoomIfEmpty(s.room.id)
}
