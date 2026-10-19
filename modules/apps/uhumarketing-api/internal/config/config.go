// Package config lê a configuração do processo do ambiente. Sem default para
// segredo: o serviço recusa subir apontando para um banco que não existe ou
// aceitando qualquer chave.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr        string
	DatabaseURL     string
	CORSOrigins     []string
	WebhookVerify   string
	AppSecret       string
	AllowDevActions bool

	MetaMode      string
	MetaBaseURL   string
	MetaVersion   string
	PublicBaseURL string
	// ChannelSecret cifra o token do WhatsApp de cada conta. Obrigatório em
	// live: token de terceiro em claro no banco é acesso total à conta dele.
	ChannelSecret string

	WorkerInterval time.Duration
}

func Load() (Config, error) {
	cfg := Config{
		HTTPAddr:        env("HTTP_ADDR", ":8195"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		WebhookVerify:   env("META_WEBHOOK_VERIFY_TOKEN", "uhu-dev-verify"),
		AppSecret:       os.Getenv("META_APP_SECRET"),
		MetaMode:        env("META_MODE", "dry-run"),
		MetaBaseURL:     env("META_GRAPH_URL", "https://graph.facebook.com"),
		MetaVersion:     env("META_GRAPH_VERSION", "v21.0"),
		ChannelSecret:   os.Getenv("CHANNEL_SECRET"),
		PublicBaseURL:   env("PUBLIC_BASE_URL", "http://localhost:8195"),
		WorkerInterval:  seconds("WORKER_INTERVAL_SECONDS", 2),
		AllowDevActions: boolEnv("ALLOW_DEV_ACTIONS", true),
	}

	if strings.EqualFold(cfg.MetaMode, "live") && len(cfg.ChannelSecret) < 16 {
		return Config{}, fmt.Errorf("META_MODE=live exige CHANNEL_SECRET com pelo menos 16 caracteres " +
			"(é a chave que cifra o token de cada conta; sem ela o token ficaria em claro no banco)")
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL é obrigatório (ex.: postgres://uhu:uhu@localhost:5433/uhumarketing?sslmode=disable)")
	}
	for _, o := range strings.Split(env("CORS_ORIGINS", "http://localhost:5180,http://127.0.0.1:5180"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, o)
		}
	}
	return cfg, nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func seconds(key string, fallback int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return time.Duration(fallback) * time.Second
}

func boolEnv(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "":
		return fallback
	case "1", "true", "yes", "sim":
		return true
	default:
		return false
	}
}
