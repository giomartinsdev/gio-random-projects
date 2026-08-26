package sfu

import (
	"net"

	"github.com/pion/ice/v4"
	"github.com/pion/interceptor"
	"github.com/pion/logging"
	"github.com/pion/webrtc/v4"
)

// One UDP socket shared by every peer connection. The alternative is a
// port per connection, which would mean opening a whole range on the
// VPS firewall instead of a single port.
func newUDPMux(port int) (ice.UDPMux, error) {
	conn, err := net.ListenUDP("udp", &net.UDPAddr{IP: net.IPv4zero, Port: port})
	if err != nil {
		return nil, err
	}
	return ice.NewUDPMuxDefault(ice.UDPMuxParams{
		UDPConn: conn,
		Logger:  logging.NewDefaultLoggerFactory().NewLogger("sfu-mux"),
	}), nil
}

// Wraps pion's default interceptors. Without these there's no NACK
// (so a lost packet is lost for good, showing as persistent artefacts),
// no RTCP reports, and no bandwidth estimation feedback.
type interceptorRegistry struct {
	registry *interceptor.Registry
}

func (r *interceptorRegistry) setup(media *webrtc.MediaEngine) error {
	r.registry = &interceptor.Registry{}
	return webrtc.RegisterDefaultInterceptors(media, r.registry)
}
