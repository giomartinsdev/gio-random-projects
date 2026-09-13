// leads-api: the one public, unauthenticated backend in the financas
// feature -- it exists solely so financas-frontend's landing page can
// capture an e-mail before that visitor ever logs in. No Cloudflare
// Access, no database of its own; every capture is a "lead.create"
// command published through domain-api's generic POST /sync (see
// internal/domainapi's own doc comment for why).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/leads-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/leads-api/internal/httpapi"
)

func main() {
	port := env("PORT", "8015")

	domain := domainapi.NewFromEnv()
	if domain == nil {
		log.Println("LEADS_DOMAIN_API_URL/LEADS_DOMAIN_API_KEY unset: every capture will fail loudly instead of pretending to succeed")
	}

	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("LEADS_FRONTEND_ORIGINS")),
	}

	server := &http.Server{
		Addr:              os.Getenv("BIND_HOST") + ":" + port,
		Handler:           httpapi.New(domain, cfg).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (origens: %v)", port, cfg.AllowedOrigins)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("encerrando")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitCSV(v string) []string {
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
