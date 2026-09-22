// clubs-api: the backend for the FC Clubs Hub (clubs.giomartins.dev).
//
// The hub is a public encyclopedia of Pro Clubs data plus an optional
// personal layer. A visitor with no account reads the whole dataset; logging
// in (Google, via Cloudflare Access on the /api path) is what lets the hub
// discover and sync that person's own clubs. There is no database here —
// every read and write goes through domain-api, same as cch-api and the
// financas modules. See internal/httpapi for the two access tiers.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/domainclient"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/clubs-api/internal/telemetry"
)

func main() {
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	port := env("PORT", "8017")
	// The SPA's MinIO-served origin plus localhost dev. Empty means nothing
	// is allowed cross-origin (the API still answers curl).
	var origins []string
	if v := os.Getenv("CLUBS_FRONTEND_ORIGINS"); v != "" {
		origins = strings.Split(v, ",")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	shutdownTelemetry, err := telemetry.Init(ctx, "clubs-api")
	if err != nil {
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	domain := domainclient.NewFromEnv()
	if domain.Enabled() {
		log.Info("persistência via domain-api", "url", os.Getenv("CLUBS_DOMAIN_API_URL"))
	} else {
		log.Warn("CLUBS_DOMAIN_API_URL/KEY ausentes: servindo estados vazios (dev)")
	}

	var allowedEmails []string
	if v := os.Getenv("CLUBS_ALLOWED_EMAILS"); v != "" {
		allowedEmails = strings.Split(v, ",")
	}
	var audiences []string
	if v := os.Getenv("CLUBS_ACCESS_AUD"); v != "" {
		audiences = strings.Split(v, ",")
	}
	auth, err := httpapi.NewAccessAuth(
		os.Getenv("CLUBS_ACCESS_TEAM_DOMAIN"),
		audiences,
		allowedEmails,
		os.Getenv("CLUBS_DEV_USER_EMAIL"),
		log,
	)
	if err != nil {
		log.Error("access auth init failed", "error", err)
		os.Exit(1)
	}
	if os.Getenv("CLUBS_DEV_BYPASS_AUTH") == "1" && os.Getenv("CLUBS_DEV_USER_EMAIL") == "" {
		log.Warn("CLUBS_DEV_BYPASS_AUTH=1 but CLUBS_DEV_USER_EMAIL is empty; defaulting to dev@local")
		os.Setenv("CLUBS_DEV_USER_EMAIL", "dev@local")
	}

	srv := &http.Server{
		Addr: ":" + port,
		Handler: otelhttp.NewHandler(httpapi.NewServer(domain, auth, origins, log).Handler(), "clubs-api",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			})),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Info("clubs-api listening", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "error", err)
			stop()
		}
	}()

	// Keep the tracer referenced so the telemetry package's span attrs are
	// meaningful even before the first request.
	_, span := otel.Tracer("clubs-api").Start(ctx, "boot", trace.WithAttributes(attribute.String("service", "clubs-api")))
	span.End()

	<-ctx.Done()
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
