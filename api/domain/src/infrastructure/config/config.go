// Package config reads process configuration from the environment. No
// defaults for secrets (DATABASE_URL, REDIS_ADDR) — refuse to boot
// misconfigured rather than silently pointing at localhost.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL string
	RedisAddr   string
	RedisPass   string
	HTTPAddr    string
	// APIKeys is only read by domain-api (cmd/worker never touches HTTP),
	// but lives here so both binaries load config the same way.
	APIKeys       string
	RateLimitRPS  float64
	RateLimitBurst int
}

func Load() (Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		return Config{}, fmt.Errorf("REDIS_ADDR is required")
	}
	httpAddr := os.Getenv("HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8000"
	}

	rps := 1.0
	if v := os.Getenv("RATE_LIMIT_RPS"); v != "" {
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return Config{}, fmt.Errorf("RATE_LIMIT_RPS: %w", err)
		}
		rps = parsed
	}
	burst := 5
	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, fmt.Errorf("RATE_LIMIT_BURST: %w", err)
		}
		burst = parsed
	}

	return Config{
		DatabaseURL:    databaseURL,
		RedisAddr:      redisAddr,
		RedisPass:      os.Getenv("REDIS_PASSWORD"),
		HTTPAddr:       httpAddr,
		APIKeys:        os.Getenv("DOMAIN_API_KEYS"),
		RateLimitRPS:   rps,
		RateLimitBurst: burst,
	}, nil
}
