// proventos-worker sweeps every open ativo position once a day,
// checking fundamentus.com.br for dividend events this app hasn't
// recorded yet. It is not an HTTP service: no port, no server, just a
// background loop -- see internal/worker.Cycle for the actual sweep and
// internal/domainapi for how it talks to the shared domain-api (same
// persistence pattern as every other module here, just with nobody's
// session to scope reads by).
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/fundamentus"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/proventos-worker/internal/worker"
)

func main() {
	domain := domainapi.NewFromEnv()
	if domain == nil {
		log.Fatal("PROVENTOS_WORKER_DOMAIN_API_URL/PROVENTOS_WORKER_DOMAIN_API_KEY unset: nada para este worker fazer")
	}
	dividends := fundamentus.New()
	interval := envDuration("PROVENTOS_WORKER_POLL_INTERVAL_SECONDS", 24*time.Hour)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("proventos-worker: iniciando, intervalo de %s", interval)
	runCycle(ctx, domain, dividends)

	for {
		select {
		case <-ctx.Done():
			log.Println("encerrando")
			return
		case <-time.After(jitter(interval)):
			runCycle(ctx, domain, dividends)
		}
	}
}

func runCycle(ctx context.Context, domain *domainapi.Client, dividends *fundamentus.Client) {
	inicio := time.Now()
	if err := worker.Cycle(ctx, domain, dividends); err != nil {
		log.Printf("proventos-worker: ciclo falhou: %v", err)
		return
	}
	log.Printf("proventos-worker: ciclo concluído em %s", time.Since(inicio))
}

// jitter spreads the poll by up to ±10%, same reasoning as the deals
// scrapers' own poller: keeps every instance of this worker (dev, prod)
// from hammering fundamentus.com.br at the exact same second forever.
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
