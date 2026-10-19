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
	MetaWABAID    string
	MetaPhoneID   string
	MetaToken     string
	PublicBaseURL string

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
		MetaWABAID:      os.Getenv("META_WABA_ID"),
		MetaPhoneID:     os.Getenv("META_PHONE_NUMBER_ID"),
		MetaToken:       os.Getenv("META_TOKEN"),
		PublicBaseURL:   env("PUBLIC_BASE_URL", "http://localhost:8195"),
		WorkerInterval:  seconds("WORKER_INTERVAL_SECONDS", 2),
		AllowDevActions: boolEnv("ALLOW_DEV_ACTIONS", true),
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
