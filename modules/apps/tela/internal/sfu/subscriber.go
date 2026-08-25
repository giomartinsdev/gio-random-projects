package sfu

import (
	"fmt"
	"sync"

	"github.com/pion/webrtc/v4"
)

// Subscriber is one person receiving everyone else's media. Unlike the
// publisher side, the SERVER offers here: tracks appear and disappear
// as other people start and stop sharing, and each change needs a new
// offer that the browser answers.
type Subscriber struct {
	pc     *webrtc.PeerConnection
	server *Server
	room   *Room
	peerID string

	// Serialises renegotiation. Two people starting to share at the
	// same instant would otherwise race to offer on the same
	// connection, and the second offer would land while the first is
	// still unanswered.
	negotiateMu sync.Mutex
	onOffer     func(webrtc.SessionDescription)

	mu      sync.Mutex
	senders map[string][]*webrtc.RTPSender // by publisher peer id
	closed  bool
}

// Subscribe opens the receive side for one person. onOffer is called
// whenever the server needs the browser to answer -- immediately for
// whatever is already being published, and again on every change.
func (s *Server) Subscribe(roomID, peerID string, onICE func(webrtc.ICECandidateInit), onOffer func(webrtc.SessionDescription)) (*Subscriber, error) {
	pc, err := s.api.NewPeerConnection(s.cfg)
	if err != nil {
		return nil, fmt.Errorf("new peer connection: %w", err)
	}

	room := s.room(roomID)
	sub := &Subscriber{
		pc:      pc,
		server:  s,
		room:    room,
		peerID:  peerID,
		onOffer: onOffer,
		senders: make(map[string][]*webrtc.RTPSender),
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
	sender, err := s.pc.AddTrack(t.local)
	if err != nil {
		return false
	}
	s.senders[t.publisher] = append(s.senders[t.publisher], sender)

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

func (s *Subscriber) removePublisher(publisherID string) {
	s.mu.Lock()
	senders := s.senders[publisherID]
	delete(s.senders, publisherID)
	closed := s.closed
	s.mu.Unlock()

	if closed || len(senders) == 0 {
		return
	}
	for _, sender := range senders {
		_ = s.pc.RemoveTrack(sender)
	}
	s.negotiate()
}

// negotiate makes a fresh offer reflecting the tracks currently
// attached. Serialised, because an offer sent while the previous one is
// still unanswered puts the connection in an invalid state.
func (s *Subscriber) negotiate() {
	s.negotiateMu.Lock()
	defer s.negotiateMu.Unlock()

	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return
	}

	offer, err := s.pc.CreateOffer(nil)
	if err != nil {
		return
	}
	if err := s.pc.SetLocalDescription(offer); err != nil {
		return
	}
	s.onOffer(offer)
}

// Answer takes the browser's reply to an offer we sent.
func (s *Subscriber) Answer(answer webrtc.SessionDescription) error {
	return s.pc.SetRemoteDescription(answer)
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
