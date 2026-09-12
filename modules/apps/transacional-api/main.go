// transacional-api: the BFF for the Transacional module (specs/
// 002-gestao-financeira-modular) -- lançamentos (entradas/saídas)
// against contas managed elsewhere. No database of its own: every
// transação lives in the shared domain-api (see internal/domainapi).
// Identity comes from the Cloudflare Access JWT the edge stamps on
// every request (see internal/httpapi/auth.go). The frontend is a
// separate app (its own origin) that talks to this one over CORS.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/MicahParks/keyfunc/v3"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/transacional-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/transacional-api/internal/httpapi"
)

func main() {
	port := env("PORT", "8021")

	domain := domainapi.NewFromEnv()
	if domain == nil {
		// This service has no fallback storage -- unlike cch-api's
		// memory-only mode, a missing domain-api means it cannot do its
		// one job. Still boot (health checks and CI shouldn't need
		// secrets), but every write/read route will 502 until the env is
		// set.
		log.Printf("TRANSACIONAL_DOMAIN_API_URL/TRANSACIONAL_DOMAIN_API_KEY unset: rotas de transações vão falhar com 502")
	}

	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("TRANSACIONAL_FRONTEND_ORIGINS")),
		AccessIssuer:   os.Getenv("TRANSACIONAL_ACCESS_ISSUER"),
		AccessAud:      os.Getenv("TRANSACIONAL_ACCESS_AUD"),
		AllowedEmails:  splitCSV(os.Getenv("TRANSACIONAL_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("TRANSACIONAL_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("TRANSACIONAL_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("TRANSACIONAL_DEV_USER_NOME"),
		MaxAnexoBytes:  envInt64("TRANSACIONAL_MAX_ANEXO_BYTES", 5*1024*1024),
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
		log.Printf("TRANSACIONAL_ACCESS_ISSUER unset e sem bypass dev: nenhuma rota autenticada vai aceitar token")
	}

	server := &http.Server{
		Addr:              os.Getenv("BIND_HOST") + ":" + port,
		Handler:           httpapi.New(domain, cfg).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (domain-api: %v, bypass dev: %v, origens: %v)",
			port, domain.Enabled(), cfg.DevBypassAuth, cfg.AllowedOrigins)
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

func envInt64(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}

// splitCSV reads a comma-separated env value into a slice, dropping
// empties and surrounding spaces ("" -> nil: unset and empty mean the
// same thing to every consumer here).
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
