package httpapi

import "net/http"

// handleIceServers hands the browser its ICE configuration: STUN always,
// plus a TURN relay when one is configured. It is deliberately public --
// a room join happens before any credential exists, and the URLs alone
// (short-lived Cloudflare credentials, or coturn's room-limited ones)
// are not a secret. `iceTransportPolicy` is returned alongside so a
// client on a path that can't carry media can be pinned to the relay.
func (s *Server) handleIceServers(w http.ResponseWriter, r *http.Request) {
	servers, forceRelay, err := s.turn.IceServers(r.Context())
	if err != nil {
		// IceServers already degrades internally; this is belt-and-braces
		// so a future implementation can't strand a join.
		s.log.ErrorContext(r.Context(), "ice servers failed", "error", err)
		writeError(w, http.StatusInternalServerError, "não foi possível obter os servidores de ICE")
		return
	}
	policy := "all"
	if forceRelay {
		// `relay` makes the browser skip host/srflx candidates and go
		// straight through TURN -- the fix when the direct path drops the
		// large DTLS handshake packets.
		policy = "relay"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"iceServers":         servers,
		"iceTransportPolicy": policy,
	})
}
