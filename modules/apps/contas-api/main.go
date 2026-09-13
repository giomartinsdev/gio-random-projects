// contas-api: the BFF for the "Contas" module of the personal-finance
// feature (specs/002-gestao-financeira-modular). No database of its
// own -- every read and write goes through HTTP to the shared
// domain-api (internal/domainapi). Identity comes from financas' own
// session (see internal/httpapi/session.go): this is the one backend
// that verifies a Google Sign-In credential and mints the session
// cookie the other 3 financas backends verify. The frontend is a
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/contas-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/contas-api/internal/httpapi"
)

func main() {
	port := env("PORT", "8020")

	domain := domainapi.NewFromEnv()
	if !domain.Enabled() {
		log.Printf("CONTAS_DOMAIN_API_URL/CONTAS_DOMAIN_API_KEY não configurados: nenhuma rota de contas vai funcionar")
	}

	sessionSecret := os.Getenv("FINANCAS_SESSION_SECRET")
	cfg := httpapi.Config{
		AllowedOrigins:      splitCSV(os.Getenv("CONTAS_FRONTEND_ORIGINS")),
		SessionSecret:       sessionSecret,
		SessionCookieDomain: os.Getenv("FINANCAS_SESSION_COOKIE_DOMAIN"),
		SessionDuration:     envDuration("FINANCAS_SESSION_DURATION", 24*time.Hour),
		GoogleClientID:      os.Getenv("GOOGLE_OAUTH_CLIENT_ID"),
		AllowedEmails:       splitCSV(os.Getenv("CONTAS_ALLOWED_EMAILS")),
		DevBypassAuth:       os.Getenv("CONTAS_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:        os.Getenv("CONTAS_DEV_USER_EMAIL"),
		DevUserNome:         os.Getenv("CONTAS_DEV_USER_NOME"),
	}
	if sessionSecret == "" && !cfg.DevBypassAuth {
		log.Printf("FINANCAS_SESSION_SECRET unset e sem bypass dev: nenhuma sessão vai validar, e /api/auth/google não vai conseguir logar ninguém")
	}
	if cfg.GoogleClientID == "" && !cfg.DevBypassAuth {
		log.Printf("GOOGLE_OAUTH_CLIENT_ID unset: /api/auth/google vai recusar todo login")
	}

	// Host networking means this binds straight onto the VPS's
	// interfaces -- BIND_HOST lets the ingress deployment keep it off
	// everything but loopback, since nginx is the only thing meant to
	// reach it directly. Empty (bare metal / dev) falls back to every
	// interface.
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

// envDuration reads an env var as a count of seconds (kept a plain
// integer, not Go duration syntax, so it's the same shape Terraform's
// var.session_duration-style inputs already use elsewhere in this repo).
func envDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	secs, err := strconv.Atoi(v)
	if err != nil || secs <= 0 {
		return fallback
	}
	return time.Duration(secs) * time.Second
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
