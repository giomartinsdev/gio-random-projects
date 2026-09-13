// apostas-api: the BFF for the Apostas module (betting-house wallet
// reconciliation) -- registering a bet debits its conta, resolving it
// green/cancelada credits the payout back, red does nothing more (the
// loss already happened at registration). No database of its own:
// every aposta and every transação lives in the shared domain-api (see
// internal/domainapi). Identity comes from financas' own session
// cookie (see internal/httpapi/auth.go), verify-only -- contas-api is
// the one service that issues it. The frontend is a separate app (its
// own origin) that talks to this one over CORS.
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/domainapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/apostas-api/internal/httpapi"
)

func main() {
	port := env("PORT", "8016")

	domain := domainapi.NewFromEnv()
	if domain == nil {
		log.Printf("APOSTAS_DOMAIN_API_URL/APOSTAS_DOMAIN_API_KEY unset: rotas de apostas vão falhar com 502")
	}

	sessionSecret := os.Getenv("FINANCAS_SESSION_SECRET")
	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("APOSTAS_FRONTEND_ORIGINS")),
		SessionSecret:  sessionSecret,
		AllowedEmails:  splitCSV(os.Getenv("APOSTAS_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("APOSTAS_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("APOSTAS_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("APOSTAS_DEV_USER_NOME"),
	}
	if sessionSecret == "" && !cfg.DevBypassAuth {
		log.Printf("FINANCAS_SESSION_SECRET unset e sem bypass dev: nenhuma sessão vai validar")
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
