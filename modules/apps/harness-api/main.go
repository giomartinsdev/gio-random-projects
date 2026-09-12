// harness-api: the backend for the corporate harness (specs/
// 001-harness-corporativo) -- implementation handoff sessions the whole
// team starts, retakes and extends. Go + stdlib mux + pure-Go SQLite on
// a docker volume; identity comes from the Cloudflare Access JWT the
// edge stamps on every request (see internal/httpapi/auth.go). The React
// frontend is a separate app (harness-frontend, its own origin) that
// talks to this one over CORS.
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/harness-api/internal/store"
)

func main() {
	port := env("PORT", "8010")
	// The SQLite file lives on a docker volume in prod (/data). Local dev
	// must point HARNESS_DB_PATH somewhere writable (e.g. ./harness.db) --
	// the default intentionally matches the container, not the laptop.
	dbPath := env("HARNESS_DB_PATH", "/data/harness.db")

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("abrir banco: %v", err)
	}
	defer st.Close()

	cfg := httpapi.Config{
		AllowedOrigins: splitCSV(os.Getenv("HARNESS_FRONTEND_ORIGINS")),
		AccessIssuer:   os.Getenv("HARNESS_ACCESS_ISSUER"),
		AccessAud:      os.Getenv("HARNESS_ACCESS_AUD"),
		AllowedEmails:  splitCSV(os.Getenv("HARNESS_ALLOWED_EMAILS")),
		DevBypassAuth:  os.Getenv("HARNESS_DEV_BYPASS_AUTH") == "1",
		DevUserEmail:   os.Getenv("HARNESS_DEV_USER_EMAIL"),
		DevUserNome:    os.Getenv("HARNESS_DEV_USER_NOME"),
	}
	// The Access team JWKS is what makes the token path work at all
	// (research D3). keyfunc refreshes it in the background. In prod a
	// failure to load it means every authenticated request would 401, so
	// refuse to boot; in dev (bypass on) the API is still usable without
	// it, tokens just keep failing.
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
		// Terraform — vale gritar no boot.
		log.Printf("HARNESS_ACCESS_ISSUER unset e sem bypass dev: nenhuma rota autenticada vai aceitar token")
	}

	// Host networking (see the container's own docs) means this binds
	// straight onto the VPS's interfaces -- BIND_HOST lets the ingress
	// deployment keep it off everything but loopback, since nginx is the
	// only thing meant to reach it directly. Empty (bare metal / dev)
	// falls back to every interface, same as cch-api.
	server := &http.Server{
		Addr:              os.Getenv("BIND_HOST") + ":" + port,
		Handler:           httpapi.New(st, cfg).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Printf("listening on :%s (db %s, bypass dev: %v, origens: %v)",
			port, dbPath, cfg.DevBypassAuth, cfg.AllowedOrigins)
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
