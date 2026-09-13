// apostas-resultado-worker sweeps every pending aposta once a day,
// trying to resolve it (green/red/cancelada) against a real match
// result -- no print, no click, no person involved. It is not an HTTP
// service: no port, no server, just a background loop -- see
// internal/worker.Cycle for the actual sweep, internal/ai for the two
// text-reasoning steps (extract the event, then judge it against a
// real placar), internal/sportsdata for where that placar comes from,
// and internal/domainapi for how it talks to the shared domain-api
// (same persistence pattern as every other module here, just with
// nobody's session to scope reads by -- see proventos-worker's own
// main.go, which this is a structural clone of).
package main

import (
	"context"
	"log"
	"math/rand/v2"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/ai"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/sportsdata"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-resultado-worker/internal/worker"
)

func main() {
	domain := domainapi.NewFromEnv()
	if domain == nil {
		log.Fatal("APOSTAS_RESULTADO_WORKER_DOMAIN_API_URL/APOSTAS_RESULTADO_WORKER_DOMAIN_API_KEY unset: nada para este worker fazer")
	}
	reasoning := ai.NewFromEnv()
	if reasoning == nil {
		log.Fatal("APOSTAS_RESULTADO_WORKER_AI_BASE_URL/APOSTAS_RESULTADO_WORKER_AI_MODEL unset: nada para este worker fazer")
	}
	scores := sportsdata.NewFromEnv()
	interval := envDuration("APOSTAS_RESULTADO_WORKER_POLL_INTERVAL_SECONDS", 24*time.Hour)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("apostas-resultado-worker: iniciando, intervalo de %s", interval)
	runCycle(ctx, domain, reasoning, scores)

	for {
		select {
		case <-ctx.Done():
			log.Println("encerrando")
			return
		case <-time.After(jitter(interval)):
			runCycle(ctx, domain, reasoning, scores)
		}
	}
}

func runCycle(ctx context.Context, domain *domainapi.Client, reasoning *ai.Client, scores *sportsdata.Client) {
	inicio := time.Now()
	if err := worker.Cycle(ctx, domain, reasoning, scores); err != nil {
		log.Printf("apostas-resultado-worker: ciclo falhou: %v", err)
		return
	}
	log.Printf("apostas-resultado-worker: ciclo concluído em %s", time.Since(inicio))
}

// jitter spreads the poll by up to ±10%, same reasoning as
// proventos-worker's own poller: keeps every instance of this worker
// from hitting the sports API/AI proxy at the exact same second every
// day.
func jitter(base time.Duration) time.Duration {
	delta := time.Duration(rand.Int64N(int64(base) / 5)) // up to 20% of base
	if rand.IntN(2) == 0 {
		return base + delta/2
	}
	return base - delta/2
}

func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(v)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}
