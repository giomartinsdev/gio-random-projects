package httpapi

import (
	"crypto/subtle"
	"net/http"
	"sort"
	"strings"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/cluster"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

// RegisterCluster wires the room-ownership lookup and proxy routing.
// With it, a room that lives on another node is reachable through
// this one as if it were local. The token must be non-empty -- the
// internal endpoints are the API's open proxy otherwise.
func (s *Server) RegisterCluster(c *cluster.Cluster) {
	if c.Token() == "" {
		panic("httpapi: cluster sem token (TELA_NODE_TOKEN)")
	}
	s.cluster = c
	s.mux.HandleFunc("GET /internal/rooms", s.handleInternalListRooms)
	s.mux.HandleFunc("GET /internal/rooms/{id}/owner", s.handleInternalRoomOwner)
}

// isFromPeer says whether this request arrived through a cluster peer
// rather than straight from a browser. Peer requests are already
// CORS-handled upstream (the peer's own wrapper answered the browser);
// re-adding the header here would duplicate it and make the browser
// refuse the response. Constant-time compare: the header IS the
// credential for internal endpoints.
func (s *Server) isFromPeer(r *http.Request) bool {
	if s.cluster == nil {
		return false
	}
	v := r.Header.Get(cluster.TokenHeader)
	return v != "" && subtle.ConstantTimeCompare([]byte(v), []byte(s.cluster.Token())) == 1
}

// handleInternalRoomOwner answers "is THIS room yours" for a peer
// deciding where to route. 200 means yes, 404 means no -- and nothing
// about the room beyond its existence leaks here.
func (s *Server) handleInternalRoomOwner(w http.ResponseWriter, r *http.Request) {
	if !s.isFromPeer(r) {
		http.Error(w, "não autorizado", http.StatusUnauthorized)
		return
	}
	if _, err := s.registry.Get(strings.ToLower(r.PathValue("id"))); err != nil {
		writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"node": s.cluster.Self()})
}

// handleInternalListRooms backs the home page's "salas rolando" under
// multi-node: each node serves its own slice, the asker merges.
func (s *Server) handleInternalListRooms(w http.ResponseWriter, r *http.Request) {
	if !s.isFromPeer(r) {
		http.Error(w, "não autorizado", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": s.registry.Active()})
}

// roomOrProxy resolves the {id} path value to a local room. When the
// room lives on another node, the request is forwarded there verbatim
// -- body included, so POST/DELETE with payloads work unchanged.
// Returned bool: true means "room is local, carry on"; false means
// the response was fully handled (proxied, or a 404).
func (s *Server) roomOrProxy(w http.ResponseWriter, r *http.Request) (*rooms.Room, bool) {
	id := strings.ToLower(r.PathValue("id"))
	room, err := s.registry.Get(id)
	if err == nil {
		return room, true
	}
	if s.cluster != nil {
		if target, ok := s.cluster.Locate(r.Context(), id); ok {
			s.cluster.Proxy(w, r, target)
			return nil, false
		}
	}
	writeError(w, http.StatusNotFound, rooms.ErrNotFound.Error())
	return nil, false
}

// mergeRooms dedupes remote summaries against local ones (local wins:
// it's the freshest view of itself) and sorts most-people-first, the
// same order Registry.Active uses.
func mergeRooms(local []rooms.RoomSummary, remotes []cluster.RoomSummary) []rooms.RoomSummary {
	if len(remotes) == 0 {
		return local
	}
	seen := make(map[string]bool, len(local))
	for _, r := range local {
		seen[r.ID] = true
	}
	for _, rc := range remotes {
		if seen[rc.RoomID] {
			continue
		}
		seen[rc.RoomID] = true
		local = append(local, rooms.RoomSummary{
			ID:         rc.RoomID,
			People:     rc.People,
			Publishing: rc.Publishing,
			CreatedAt:  rc.CreatedAt,
		})
	}
	sort.SliceStable(local, func(i, j int) bool { return local[i].People > local[j].People })
	return local
}