// prospecta-api: the BFF/ACL of the Prospecta bounded context
// (prospecta-api.giomartins.dev, porta 8022).
//
// Leitura (GET) passa pelo par de domínio e devolve projeção JSON; escrita
// (POST) vira comando no envelope {action, payload} e responde 202. Este
// serviço NÃO tem banco, NÃO tem DATABASE_URL e NÃO tem driver de banco --
// os únicos donos da persistência são domain-api/domain-worker (§1.1).
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

	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/application"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/auth"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/infrastructure"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/prospecta-api/internal/telemetry"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(telemetry.NewLogger(slog.NewJSONHandler(os.Stdout, nil)))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Telemetry failing to start must never take the API down -- degrade to
	// no telemetry and carry on. Empty OTEL_EXPORTER_OTLP_ENDPOINT (local
	// dev) skips init entirely; see internal/telemetry.
	shutdownTelemetry, err := telemetry.Init(ctx, "prospecta-api")
	if err != nil {
		log.Error("telemetry init failed; continuing without it", "error", err)
		shutdownTelemetry = func(context.Context) error { return nil }
	}
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = shutdownTelemetry(shutdownCtx)
	}()

	apiKey := os.Getenv("PROSPECTA_API_KEY")
	if apiKey == "" {
		// Sem chave configurada o middleware deixa passar e avisa alto: em
		// produção isto precisa estar definido (o host não fica atrás do
		// Access, §D8).
		log.Warn("PROSPECTA_API_KEY vazia: o middleware X-API-Key está deixando passar (dev)")
	}

	// O par de domínio é a única saída de escrita e a fonte das leituras.
	// Sem URL/chave, a API sobe mas responde 503 nas rotas de negócio -- o
	// que é o certo em dev, e melhor do que uma leitura vazia disfarçada.
	domainPair := infrastructure.NewFromEnv()
	if domainPair.Enabled() {
		log.Info("par de domínio configurado", "url", os.Getenv("PROSPECTA_DOMAIN_API_URL"))
	} else {
		log.Warn("PROSPECTA_DOMAIN_API_URL/KEY ausentes: rotas de negócio respondem 503 (dev)")
	}

	// Tenant do operador (modo X-API-Key): o workspace fixo de antes. A sessão
	// de um usuário sobrepõe este valor por request (o DomainClient lê o
	// tenant do contexto).
	tenantID := os.Getenv("PROSPECTA_TENANT_ID")
	if tenantID == "" {
		tenantID = infrastructure.DefaultTenantID
	}

	// Sessão por e-mail+senha. Sem segredo, Enabled() é false e /auth responde
	// 503 -- o serviço continua de pé para as rotas de negócio.
	sessions := auth.NewManager(os.Getenv("PROSPECTA_SESSION_SECRET"), 0)
	if !sessions.Enabled() {
		log.Warn("PROSPECTA_SESSION_SECRET ausente: /auth responde 503 (dev)")
	}

	// Google SSO: o mesmo client ID público dos outros apps. Sem ele,
	// /auth/google responde 503 e o cadastro por e-mail+senha segue normal.
	googleVerifier := auth.NewGoogleVerifier(os.Getenv("PROSPECTA_GOOGLE_CLIENT_ID"))
	if googleVerifier == nil {
		log.Warn("PROSPECTA_GOOGLE_CLIENT_ID ausente: /auth/google responde 503 (dev)")
	}

	// Cada slice tem seu serviço; o par de domínio é publisher e reader deles
	// todos (e a fonte do feed SSE). Nenhum serviço segura banco ou broker.
	services := httpapi.Services{
		Companies: application.NewCompanyService(domainPair, domainPair),
		Campaigns: application.NewCampaignService(domainPair, domainPair),
		Leads:     application.NewLeadService(domainPair, domainPair),
		Messaging: application.NewMessagingService(domainPair, domainPair, domainPair),
		Activity:  application.NewActivityService(domainPair),
	}
	authService := auth.NewService(domainPair, domainPair, domainPair, sessions, googleVerifier, log)

	cfg := httpapi.Config{
		APIKey:         apiKey,
		TenantID:       tenantID,
		Auth:           authService,
		AllowedOrigins: corsOrigins(),
	}

	// O handler de otelhttp abre o span de cada request; a formatação do nome
	// usa o método + path (o ServeMux não expõe o pattern ao otelhttp).
	handler := otelhttp.NewHandler(httpapi.NewRouter(cfg, services, log), "prospecta-api",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return r.Method + " " + r.URL.Path
		}),
	)

	addr := bindHost() + ":" + env("PORT", "8022")
	server := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Info("prospecta-api listening", "addr", addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server error", "error", err)
		os.Exit(1)
	}
}

// corsOrigins reads the SPA's allowed origins from PROSPECTA_FRONTEND_ORIGINS
// (comma-separated). Empty means no browser page may call cross-origin.
func corsOrigins() []string {
	v := os.Getenv("PROSPECTA_FRONTEND_ORIGINS")
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			origins = append(origins, p)
		}
	}
	return origins
}

func bindHost() string {
	if h := os.Getenv("BIND_HOST"); h != "" {
		return h
	}
	return "0.0.0.0"
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
