// Package metrics exposes the app's vital signs in Prometheus format.
// Opt-in by design -- the deployment decides whether /metrics exists at
// all (TELA_METRICS=1); off is the default, and off means the route
// isn't even registered rather than returning an error.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/tela-api/internal/rooms"
)

// New builds a metrics handler reading live counts off the room
// registry. Gauges are computed at scrape time rather than maintained
// on mutation: a registry already locks its maps per read, room counts
// are O(rooms) with rooms capped in the hundreds, and scrapes arrive
// every few seconds at most -- bookkeeping on every join/leave would
// buy nothing and risk drifting out of sync with the truth.
func New(registry *rooms.Registry) http.Handler {
	reg := prometheus.NewRegistry()

	gauge := func(name, help string, fn func() float64) {
		reg.MustRegister(prometheus.NewGaugeFunc(
			prometheus.GaugeOpts{Name: name, Help: help}, fn,
		))
	}

	gauge("tela_rooms", "Salas existentes (inclui vazias dentro da graça do janitor).", func() float64 {
		return float64(registry.Count())
	})

	gauge("tela_people", "Pessoas conectadas agora, em todas as salas.", func() float64 {
		total := 0
		for _, room := range registry.Active() {
			total += room.People
		}
		return float64(total)
	})

	gauge("tela_publishers", "Transmissões ativas agora, em todas as salas.", func() float64 {
		total := 0
		for _, room := range registry.Active() {
			total += room.Publishing
		}
		return float64(total)
	})

	gauge("tela_rooms_active", "Salas com pelo menos uma pessoa conectada.", func() float64 {
		return float64(len(registry.Active()))
	})

	// Go runtime + process metrics (memory, GC, file descriptors, start
	// time) come along for free -- /statusz answers "is it up"; these
	// answer "how is it holding up" over time.
	return promhttp.HandlerFor(reg, promhttp.HandlerOpts{})
}
