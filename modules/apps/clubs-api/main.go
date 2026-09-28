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
	"strconv"
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

	// Identidade: sessão própria, não Cloudflare Access. O login é um "Entrar
	// com Google" comum -- o SPA manda o ID token, este serviço verifica e
	// emite o cookie de sessão.
	sessionSecret := os.Getenv("CLUBS_SESSION_SECRET")
	googleClientID := os.Getenv("CLUBS_GOOGLE_CLIENT_ID")
	devBypass := os.Getenv("CLUBS_DEV_BYPASS_AUTH") == "1"
	devEmail := os.Getenv("CLUBS_DEV_USER_EMAIL")

	// A escotilha de dev e um client ID real não podem coexistir: a combinação
	// significa rodar com login de verdade configurado E aceitar qualquer
	// requisição como uma identidade fixa. É o buraco de autenticação mais
	// fácil de criar sem perceber, então vira falha de boot em vez de warning.
	if devBypass && googleClientID != "" {
		log.Error("recusando iniciar: CLUBS_DEV_BYPASS_AUTH=1 com CLUBS_GOOGLE_CLIENT_ID definido",
			"dica", "a escotilha é só para dev local; remova-a onde o login do Google estiver configurado")
		os.Exit(1)
	}
	if devBypass && devEmail == "" {
		log.Warn("CLUBS_DEV_BYPASS_AUTH=1 mas CLUBS_DEV_USER_EMAIL vazio; usando dev@local")
		devEmail = "dev@local"
	}

	if sessionSecret == "" && !devBypass {
		// Não é fatal -- a leitura pública segue inteira -- mas precisa ser
		// alto, porque a camada pessoal para de funcionar em silêncio.
		log.Warn("emissão de sessão DESLIGADA: /api/auth/google vai recusar todo login e as rotas pessoais respondem 401",
			"corrija", "defina CLUBS_SESSION_SECRET + CLUBS_GOOGLE_CLIENT_ID, ou CLUBS_DEV_BYPASS_AUTH=1 para dev")
	}
	if googleClientID == "" && !devBypass {
		log.Warn("CLUBS_GOOGLE_CLIENT_ID vazio: o login com Google não vai funcionar")
	}

	cfg := httpapi.Config{
		AllowedOrigins:      origins,
		SessionSecret:       sessionSecret,
		SessionCookieDomain: os.Getenv("CLUBS_SESSION_COOKIE_DOMAIN"),
		SessionDuration:     envDuration("CLUBS_SESSION_DURATION", 30*24*time.Hour),
		GoogleClientID:      googleClientID,
		DevUserEmail:        devEmail,
		// Origem pública do SPA: usada para montar og:url/og:image absolutos no
		// preview de link. Sem ela, os links do cartão saem relativos.
		PublicOrigin: os.Getenv("CLUBS_PUBLIC_ORIGIN"),
	}
	if cfg.SessionCookieDomain != "" {
		log.Info("cookie de sessão escopado", "domain", cfg.SessionCookieDomain)
	} else {
		log.Info("cookie de sessão host-only (certo para dev; em produção escopar em .giomartins.dev se o hub precisar)")
	}

	srv := &http.Server{
		Addr: ":" + port,
		Handler: otelhttp.NewHandler(httpapi.NewServer(domain, cfg, log).Handler(), "clubs-api",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				return r.Method + " " + r.URL.Path
			})),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
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

// envDuration lê uma duração em segundos (a convenção do repo é um número
// simples, não uma string de duração do Go) com um default.
func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return def
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
