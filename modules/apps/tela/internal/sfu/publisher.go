package sfu

import (
	"fmt"

	"github.com/pion/webrtc/v4"
)

// Publisher is one person sending media in. The browser offers, the
// server answers -- the browser knows what it's sending, so it drives.
type Publisher struct {
	pc     *webrtc.PeerConnection
	server *Server
	room   *Room
	peerID string
	done   chan struct{}
}

// Publish takes the browser's offer and returns the server's answer.
// Tracks start flowing as soon as ICE connects; each one is registered
// with the room and pushed to everyone already subscribed.
func (s *Server) Publish(roomID, peerID string, offer webrtc.SessionDescription, onICE func(webrtc.ICECandidateInit)) (*Publisher, *webrtc.SessionDescription, error) {
	pc, err := s.api.NewPeerConnection(s.cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("new peer connection: %w", err)
	}

	room := s.room(roomID)
	p := &Publisher{pc: pc, server: s, room: room, peerID: peerID, done: make(chan struct{})}

	// We only ever receive here, but the transceivers have to exist
	// before setting the remote description or the tracks have nowhere
	// to land.
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		return nil, nil, err
	}
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		return nil, nil, err
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c != nil {
			onICE(c.ToJSON())
		}
	})

	pc.OnTrack(func(remote *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		// The stream id is the publisher's peer id, so subscribers can
		// tell whose picture a track belongs to without a side channel.
		local, err := webrtc.NewTrackLocalStaticRTP(remote.Codec().RTPCodecCapability, remote.ID(), peerID)
		if err != nil {
			return
		}
		track := &publishedTrack{local: local, remote: remote, publisher: peerID}

		for _, sub := range room.addTrack(track) {
			sub.addTrack(track)
		}

		if remote.Kind() == webrtc.RTPCodecTypeVideo {
			go requestKeyframes(pc, remote, p.done)
		}

		forward(remote, local)

		// The track ended: drop this publisher's tracks and let the
		// subscribers renegotiate without them.
		for _, sub := range room.removePublisher(peerID) {
			sub.removePublisher(peerID)
		}
		s.dropRoomIfEmpty(room.id)
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateFailed, webrtc.PeerConnectionStateClosed:
			p.Close()
		default:
		}
	})

	if err := pc.SetRemoteDescription(offer); err != nil {
		return nil, nil, fmt.Errorf("set remote description: %w", err)
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		return nil, nil, fmt.Errorf("create answer: %w", err)
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		return nil, nil, fmt.Errorf("set local description: %w", err)
	}

	return p, &answer, nil
}

func (p *Publisher) AddICECandidate(c webrtc.ICECandidateInit) error {
	return p.pc.AddICECandidate(c)
}

func (p *Publisher) Close() {
	select {
	case <-p.done:
		return
	default:
	}
	close(p.done)

	for _, sub := range p.room.removePublisher(p.peerID) {
		sub.removePublisher(p.peerID)
	}
	_ = p.pc.Close()
	p.server.dropRoomIfEmpty(p.room.id)
}
