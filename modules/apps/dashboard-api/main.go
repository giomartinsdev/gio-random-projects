// dashboard-api: the BFF for the Dashboard module (specs/
// 002-gestao-financeira-modular) -- composes the personal finance
// dashboard layout. No database of its own: the layout is persisted
// through the shared domain-api's dashboardlayout aggregate over HTTP.
// Identity comes from financas' own session cookie (see
// internal/httpapi/session.go), not Cloudflare Access anymore. The
// React frontend is a separate app, its own origin, talking to this one
// over CORS.
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

	sessionSecret := os.Getenv("FINANCAS_SESSION_SECRET")
	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("DASHBOARD_FRONTEND_ORIGINS")),
		SessionSecret:  sessionSecret,
		AllowedEmails:  splitCSV(os.Getenv("DASHBOARD_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("DASHBOARD_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("DASHBOARD_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("DASHBOARD_DEV_USER_NOME"),
	}
	if sessionSecret == "" && !cfg.DevBypassAuth {
		log.Printf("FINANCAS_SESSION_SECRET unset e sem bypass dev: nenhuma sessão vai validar")
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
