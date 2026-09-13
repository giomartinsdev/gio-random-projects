// asset-manager-api: the BFF for the Asset Manager module of the
// personal finance feature (specs/002-gestao-financeira-modular). No
// database of its own -- positions and movements persist through the
// shared domain-api; the only state kept in this process is an
// in-memory, non-durable cache of brapi.dev quotes (internal/quotes).
// Identity comes from financas' own session cookie (see
// internal/httpapi/session.go), not Cloudflare Access anymore.
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/asset-manager-api/internal/quotes"
)

func main() {
	port := env("PORT", "8022")

	domainClient := domainapi.NewFromEnv()
	if domainClient == nil {
		// This service has no fallback of its own for positions -- every
		// route but health/me/sso/cotacoes needs domain-api. It still
		// boots (so health checks pass during a partial rollout) but
		// every write/read against positions will 502 until the env is
		// set.
		log.Printf("ASSET_MANAGER_DOMAIN_API_URL/ASSET_MANAGER_DOMAIN_API_KEY unset: rotas de ativos vão falhar")
	}
	quoteClient := quotes.NewFromEnv()

	sessionSecret := os.Getenv("FINANCAS_SESSION_SECRET")
	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("ASSET_MANAGER_FRONTEND_ORIGINS")),
		SessionSecret:  sessionSecret,
		AllowedEmails:  splitCSV(os.Getenv("ASSET_MANAGER_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("ASSET_MANAGER_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("ASSET_MANAGER_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("ASSET_MANAGER_DEV_USER_NOME"),
	}
	if sessionSecret == "" && !cfg.DevBypassAuth {
		log.Printf("FINANCAS_SESSION_SECRET unset e sem bypass dev: nenhuma sessão vai validar")
	}

	// BIND_HOST lets an ingress deployment keep this off everything but
	// loopback, since nginx is the only thing meant to reach it directly.
	// Empty (bare metal / dev) falls back to every interface.
	server := &http.Server{
		Addr:              os.Getenv("BIND_HOST") + ":" + port,
		Handler:           httpapi.New(domainClient, quoteClient, cfg).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (domain-api: %v, bypass dev: %v, origens: %v)",
			port, domainClient.Enabled(), cfg.DevBypassAuth, cfg.AllowedOrigins)
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

// splitCSV reads a comma-separated env value into a slice, dropping
// empties and surrounding spaces ("" -> nil).
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
