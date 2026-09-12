// asset-manager-api: the BFF for the Asset Manager module of the
// personal finance feature (specs/002-gestao-financeira-modular). No
// database of its own -- positions and movements persist through the
// shared domain-api; the only state kept in this process is an
// in-memory, non-durable cache of brapi.dev quotes (internal/quotes).
// Identity comes from the Cloudflare Access JWT the edge stamps on
// every request (see internal/httpapi/auth.go), same pattern as every
// other module here.
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

	"github.com/MicahParks/keyfunc/v3"

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

	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("ASSET_MANAGER_FRONTEND_ORIGINS")),
		AccessIssuer:   os.Getenv("ASSET_MANAGER_ACCESS_ISSUER"),
		AccessAud:      os.Getenv("ASSET_MANAGER_ACCESS_AUD"),
		AllowedEmails:  splitCSV(os.Getenv("ASSET_MANAGER_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("ASSET_MANAGER_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("ASSET_MANAGER_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("ASSET_MANAGER_DEV_USER_NOME"),
	}
	// The Access team JWKS is what makes the token path work at all. In
	// prod a failure to load it means every authenticated request would
	// 401, so refuse to boot; in dev (bypass on) the API is still usable
	// without it, tokens just keep failing.
	if cfg.AccessIssuer != "" {
		jwksURL := strings.TrimRight(cfg.AccessIssuer, "/") + "/cdn-cgi/access/certs"
		kf, kfErr := keyfunc.NewDefault([]string{jwksURL})
		switch {
		case kfErr == nil:
			cfg.JWTKeyfunc = kf.Keyfunc
		case cfg.DevBypassAuth:
			log.Printf("JWKS do Access indisponível no boot (%v): requests com token vão falhar", kfErr)
		default:
			log.Fatalf("JWKS do Access (%s): %v", jwksURL, kfErr)
		}
	} else if !cfg.DevBypassAuth {
		log.Printf("ASSET_MANAGER_ACCESS_ISSUER unset e sem bypass dev: nenhuma rota autenticada vai aceitar token")
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
