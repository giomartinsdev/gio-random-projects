// uhumarketing-api é o backend do uhumarketing: templates da Meta, audiências
// com opt-in, campanhas, a fila de disparo e o webhook de status.
//
// Modo de operação:
//
//   - META_MODE=dry-run (default) — nada sai para a Meta. A fila processa,
//     grava ids externos falsos e o produto inteiro funciona. É o modo para
//     desenvolver e testar sem conta de WhatsApp.
//   - META_MODE=live — Cloud API de verdade. NÃO existe token global: cada
//     conta ativa o próprio WhatsApp em Configurações → WhatsApp, e o token
//     dela é gravado cifrado com CHANNEL_SECRET (obrigatório no boot).
//
// O serviço é dono das próprias tabelas (store/schema.sql) e roda um worker
// in-process: um processo só, como o volume da POC pede. O claim da fila é
// `FOR UPDATE SKIP LOCKED`, então subir uma segunda instância não duplica
// mensagem.
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

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/channel"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/config"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/dispatch"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/httpapi"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/meta"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/secret"
	"github.com/giomartinsdev/gio-random-projects/modules/apps/uhumarketing-api/internal/store"
)

const shutdownTimeout = 10 * time.Second

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("config inválida", "error", err)
		os.Exit(1)
	}

	// Provedor de fallback. Em dry-run é o simulador; em live não existe canal
	// global — cada conta traz o próprio token, então o fallback só serve para
	// o health e nunca envia em nome de ninguém.
	provider, err := meta.Resolve(cfg.MetaMode, cfg.MetaBaseURL, cfg.MetaVersion)
	if err != nil {
		log.Error("provedor inválido", "error", err)
		os.Exit(1)
	}
	var box *secret.Box
	if cfg.ChannelSecret != "" {
		box, err = secret.New(cfg.ChannelSecret)
		if err != nil {
			log.Error("CHANNEL_SECRET inválido", "error", err)
			os.Exit(1)
		}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("postgres: conexão", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Error("postgres: ping", "error", err)
		os.Exit(1)
	}
	if err := store.Migrate(ctx, pool); err != nil {
		log.Error("postgres: schema", "error", err)
		os.Exit(1)
	}

	st := store.New(pool)

	channels := &channel.Resolver{
		Store:    st,
		Box:      box,
		Mode:     cfg.MetaMode,
		BaseURL:  cfg.MetaBaseURL,
		Version:  cfg.MetaVersion,
		Fallback: provider,
	}

	// Workspace vazio de propósito: cada requisição é escopada pelo middleware
	// de sessão. Um workspace fixo aqui seria justamente o bug de vazamento
	// entre contas.
	svc := &httpapi.Service{
		Store: st, Provider: provider, Channels: channels, Log: log,
		PublicBaseURL: cfg.PublicBaseURL,
	}
	worker := &dispatch.Worker{Store: st, Channels: channels, Log: log, Interval: cfg.WorkerInterval}

	live := strings.EqualFold(cfg.MetaMode, "live")
	if live && cfg.AppSecret == "" {
		log.Warn("webhook sem META_APP_SECRET: eventos serão recusados (503) até a chave ser configurada")
	}

	handlers := &httpapi.Handlers{
		Service:            svc,
		Log:                log,
		WebhookVerifyToken: cfg.WebhookVerify,
		AppSecret:          cfg.AppSecret,
		RequireSignature:   live,
		AllowDevActions:    cfg.AllowDevActions,
		Tick:               worker.Tick,
	}

	go worker.Run(ctx)

	router := httpapi.NewRouter(handlers, cfg.CORSOrigins, log)
	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Info("uhumarketing-api no ar",
		"addr", cfg.HTTPAddr,
		"provider", provider.Name(),
		"accounts", "multi-workspace",
		"worker", cfg.WorkerInterval.String(),
	)

	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("encerrando")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error("shutdown", "error", err)
	}
}
