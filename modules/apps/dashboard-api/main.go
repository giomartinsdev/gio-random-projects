// dashboard-api: the BFF for the Dashboard module (specs/
// 002-gestao-financeira-modular) -- composes the personal finance
// dashboard layout. No database of its own: the layout is persisted
// through the shared domain-api's dashboardlayout aggregate over HTTP.
// Identity comes from the Cloudflare Access JWT the edge stamps on
// every request (see internal/httpapi/auth.go). The React frontend is a
// separate app, its own origin, talking to this one over CORS.
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/dashboard-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/dashboard-api/internal/httpapi"
)

func main() {
	port := env("PORT", "8023")

	domain := domainapi.NewFromEnv()
	if domain == nil {
		// This service has no other persistence path -- without
		// domain-api every layout call fails, but health/me/sso still
		// work, which is enough to keep the container up in a half
		// configured environment instead of crash-looping.
		log.Printf("DASHBOARD_DOMAIN_API_URL/DASHBOARD_DOMAIN_API_KEY unset: /api/layout vai falhar em toda chamada")
	}

	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("DASHBOARD_FRONTEND_ORIGINS")),
		AccessIssuer:   os.Getenv("DASHBOARD_ACCESS_ISSUER"),
		AccessAud:      os.Getenv("DASHBOARD_ACCESS_AUD"),
		AllowedEmails:  splitCSV(os.Getenv("DASHBOARD_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("DASHBOARD_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("DASHBOARD_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("DASHBOARD_DEV_USER_NOME"),
	}
	// The Access team JWKS is what makes the token path work at all.
	// keyfunc refreshes it in the background. In prod a failure to load
	// it means every authenticated request would 401, so refuse to
	// boot; in dev (bypass on) the API is still usable without it,
	// tokens just keep failing.
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
		// Sem issuer não existe JWKS para checar nada: a API sobe, mas só
		// o health responde. Quase sempre é esquecer de plugar o env do
		// Terraform -- vale gritar no boot.
		log.Printf("DASHBOARD_ACCESS_ISSUER unset e sem bypass dev: nenhuma rota autenticada vai aceitar token")
	}

	// BIND_HOST lets the ingress deployment keep this off everything but
	// loopback, since nginx is the only thing meant to reach it
	// directly. Empty (bare metal / dev) falls back to every interface,
	// same as every other module service.
	server := &http.Server{
		Addr:              os.Getenv("BIND_HOST") + ":" + port,
		Handler:           httpapi.New(domain, cfg).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (domain-api: %v, bypass dev: %v, origens: %v)",
			port, domain != nil, cfg.DevBypassAuth, cfg.AllowedOrigins)
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
