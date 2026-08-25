// Package sfu forwards media between the people in a room.
//
// The mesh this replaces made whoever was sharing encode a separate
// stream for every viewer: two viewers meant two encodes and twice the
// upload, which is what made a second person joining fall apart. Here
// each publisher sends ONE stream to this server, and the server
// forwards the packets to everyone watching -- the publisher's cost
// stops growing with the audience, and the bandwidth cost moves to the
// server, where it's cheap and symmetric.
//
// Nothing is transcoded. Packets arrive and are written straight back
// out to the subscribers, which is what makes this affordable on a
// small box: the CPU cost is per-packet bookkeeping, not per-frame
// encoding.
package sfu

import (
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// How often to ask a publisher for a fresh keyframe. A subscriber that
// joins mid-stream sees nothing until the next keyframe arrives, and
// encoders left alone can go many seconds between them.
const keyframeInterval = 2 * time.Second

// Server owns the WebRTC stack shared by every connection. One per
// process: the ICE UDP mux underneath it binds a port, and binding one
// port per peer connection is exactly what we're avoiding.
type Server struct {
	api *webrtc.API
	cfg webrtc.Configuration

	mu    sync.RWMutex
	rooms map[string]*Room
}

type Options struct {
	// The address browsers will send media to. On a VPS this is its
	// public IP -- without it the server would advertise only its
	// private address and no browser could reach it.
	PublicIP string
	// Single UDP port for all media, so deployment means opening one
	// port rather than a range.
	UDPPort int
	// STUN for the browsers' side of the connection; the server itself
	// doesn't need it once PublicIP is set.
	STUNURLs []string
}

func New(opts Options) (*Server, error) {
	media := &webrtc.MediaEngine{}
	if err := media.RegisterDefaultCodecs(); err != nil {
		return nil, fmt.Errorf("register codecs: %w", err)
	}

	// Interceptors give us RTCP reports, NACK-based retransmission and
	// TWCC for free -- without them a subscriber loses packets with no
	// way to ask for them again, which looks like a permanently glitchy
	// picture.
	registry := &interceptorRegistry{}
	if err := registry.setup(media); err != nil {
		return nil, err
	}

	settings := webrtc.SettingEngine{}
	mux, err := newUDPMux(opts.UDPPort)
	if err != nil {
		return nil, fmt.Errorf("udp mux on port %d: %w", opts.UDPPort, err)
	}
	settings.SetICEUDPMux(mux)
	if opts.PublicIP != "" {
		// Makes the server advertise the address browsers can actually
		// reach, rather than the container's private one.
		settings.SetNAT1To1IPs([]string{opts.PublicIP}, webrtc.ICECandidateTypeHost)
	}

	iceServers := make([]webrtc.ICEServer, 0, len(opts.STUNURLs))
	if len(opts.STUNURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: opts.STUNURLs})
	}

	return &Server{
		api: webrtc.NewAPI(
			webrtc.WithMediaEngine(media),
			webrtc.WithInterceptorRegistry(registry.registry),
			webrtc.WithSettingEngine(settings),
		),
		cfg:   webrtc.Configuration{ICEServers: iceServers},
		rooms: make(map[string]*Room),
	}, nil
}

// Room holds what's being published inside one room and who is
// listening. It exists only while someone is connected to it.
type Room struct {
	id string

	mu          sync.RWMutex
	tracks      map[string][]*publishedTrack // by publisher peer id
	subscribers map[string]*Subscriber       // by subscriber peer id
}

type publishedTrack struct {
	local  *webrtc.TrackLocalStaticRTP
	remote *webrtc.TrackRemote
	// Publisher peer id -- carried on the track so subscribers can tell
	// whose picture they're looking at.
	publisher string
}

func (s *Server) room(roomID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[roomID]
	if !ok {
		room = &Room{
			id:          roomID,
			tracks:      make(map[string][]*publishedTrack),
			subscribers: make(map[string]*Subscriber),
		}
		s.rooms[roomID] = room
	}
	return room
}

// dropRoomIfEmpty keeps the map from growing forever as rooms come and
// go. Called whenever a publisher or subscriber goes away.
func (s *Server) dropRoomIfEmpty(roomID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	room, ok := s.rooms[roomID]
	if !ok {
		return
	}
	room.mu.RLock()
	empty := len(room.tracks) == 0 && len(room.subscribers) == 0
	room.mu.RUnlock()
	if empty {
		delete(s.rooms, roomID)
	}
}

func (r *Room) allTracks() []*publishedTrack {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*publishedTrack, 0, len(r.tracks))
	for _, list := range r.tracks {
		out = append(out, list...)
	}
	return out
}

func (r *Room) addTrack(t *publishedTrack) []*Subscriber {
	r.mu.Lock()
	r.tracks[t.publisher] = append(r.tracks[t.publisher], t)
	subs := make([]*Subscriber, 0, len(r.subscribers))
	for id, sub := range r.subscribers {
		// Nobody subscribes to their own published track: they already
		// have the local one, and sending it back would waste the
		// server's upload on a picture the browser already has.
		if id == t.publisher {
			continue
		}
		subs = append(subs, sub)
	}
	r.mu.Unlock()
	return subs
}

func (r *Room) removePublisher(peerID string) []*Subscriber {
	r.mu.Lock()
	delete(r.tracks, peerID)
	subs := make([]*Subscriber, 0, len(r.subscribers))
	for id, sub := range r.subscribers {
		if id == peerID {
			continue
		}
		subs = append(subs, sub)
	}
	r.mu.Unlock()
	return subs
}

// forward pumps one publisher's RTP straight into every subscriber's
// copy of that track. This is the whole point of the package: no
// decoding, no encoding, just packets moving.
func forward(remote *webrtc.TrackRemote, local *webrtc.TrackLocalStaticRTP) {
	buf := make([]byte, 1500)
	for {
		n, _, err := remote.Read(buf)
		if err != nil {
			if err != io.EOF {
				// Publisher went away or the connection failed; either
				// way this track is done.
				return
			}
			return
		}
		// A subscriber that can't keep up is skipped rather than
		// blocking everyone else -- TrackLocalStaticRTP handles that
		// internally per-sender.
		if _, err := local.Write(buf[:n]); err != nil && err != io.ErrClosedPipe {
			return
		}
	}
}

// requestKeyframes nags the publisher for a keyframe on a timer. A
// subscriber joining mid-stream has nothing to decode until one
// arrives, so waiting for the encoder to produce one on its own can
// mean several seconds of black.
func requestKeyframes(pc *webrtc.PeerConnection, remote *webrtc.TrackRemote, done <-chan struct{}) {
	ticker := time.NewTicker(keyframeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			err := pc.WriteRTCP([]rtcp.Packet{
				&rtcp.PictureLossIndication{MediaSSRC: uint32(remote.SSRC())},
			})
			if err != nil {
				return
			}
		}
	}
}
