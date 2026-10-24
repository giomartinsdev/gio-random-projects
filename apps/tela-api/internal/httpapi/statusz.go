package httpapi

import (
	"net/http"
	"time"
)

// Version is what /statusz reports. Overridable at link time
// (--ldflags "-X ...httpapi.Version=v1.2.3"); "dev" means a go run
// without that decoration, which is honest enough for a hobby deploy.
var Version = "dev"

// processStart is when this binary came up -- /statusz's uptime is
// measured from here, not from New, so the number means the
// deployment's age rather than the handler's.
var processStart = time.Now()

// handleStatusz is the public pulse check: what a person (or a phone
// shortcut, or a monitor) wants to know before joining -- is the thing
// up, how long has it been up, and how busy is it. Deliberately the
// same aggregate shape the home page already gets from GET /api/rooms
// (counts only, no room ids, no names) plus the deployment facts the
// process itself knows best. The name keeps the tradition of a
// slightly playful but plain status path.
func (s *Server) handleStatusz(w http.ResponseWriter, _ *http.Request) {
	// One pass over the registry: Active already sorts by occupancy,
	// which /statusz doesn't need, but the sums it yields are exactly
	// the busy-ness numbers -- and this runs at human polling
	// frequency, not per frame.
	active := s.registry.Active()
	people, publishing := 0, 0
	for _, room := range active {
		people += room.People
		publishing += room.Publishing
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":        "ok",
		"version":       Version,
		"uptimeSeconds": int(time.Since(processStart).Seconds()),
		"rooms":         s.registry.Count(),
		"activeRooms":   len(active),
		"people":        people,
		"publishing":    publishing,
	})
}
