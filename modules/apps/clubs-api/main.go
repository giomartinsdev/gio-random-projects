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
	teamDomain := os.Getenv("CLUBS_ACCESS_TEAM_DOMAIN")
	devBypass := os.Getenv("CLUBS_DEV_BYPASS_AUTH") == "1"
	devEmail := os.Getenv("CLUBS_DEV_USER_EMAIL")

	// The dev bypass must be impossible to combine with a configured Access
	// team: that combination means someone is running in front of real Access
	// while also accepting anyone as a fixed identity, which is exactly the way
	// a local shortcut turns into an authentication hole. Refuse to boot rather
	// than log a warning nobody reads.
	if devBypass && teamDomain != "" {
		log.Error("refusing to start: CLUBS_DEV_BYPASS_AUTH=1 with CLUBS_ACCESS_TEAM_DOMAIN set",
			"hint", "the bypass is for local dev only; unset it wherever Access is configured")
		os.Exit(1)
	}
	if devBypass && devEmail == "" {
		log.Warn("CLUBS_DEV_BYPASS_AUTH=1 but CLUBS_DEV_USER_EMAIL is empty; defaulting to dev@local")
		devEmail = "dev@local"
	}

	auth, err := httpapi.NewAccessAuth(teamDomain, audiences, allowedEmails, devEmail, log)
	if err != nil {
		log.Error("access auth init failed", "error", err)
		os.Exit(1)
	}
	if !auth.Enabled() {
		// Not fatal -- the public dataset is still fully served -- but it must
		// be loud, because the personal layer silently stops working.
		log.Warn("identity verification is OFF: the personal routes will answer 401 to everyone",
			"fix", "set CLUBS_ACCESS_TEAM_DOMAIN + CLUBS_ACCESS_AUD, or CLUBS_DEV_BYPASS_AUTH=1 for local dev")
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
