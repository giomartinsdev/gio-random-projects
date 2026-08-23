// Package config reads process configuration from the environment. No
// defaults for secrets — refuse to boot misconfigured rather than
// silently pointing at localhost.
package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL    string
	RedisAddr      string
	RedisPass      string
	HTTPAddr       string
	APIKeys        string
	RateLimitRPS   float64
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
	apiKeys := os.Getenv("DOMAIN_API_KEYS")
	if apiKeys == "" {
		return Config{}, fmt.Errorf("DOMAIN_API_KEYS is required (this service is internet-facing)")
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
		APIKeys:        apiKeys,
		RateLimitRPS:   rps,
		RateLimitBurst: burst,
	}, nil
}
