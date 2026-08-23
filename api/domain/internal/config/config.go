// Package config reads process configuration from the environment. No
// defaults for secrets (DATABASE_URL, REDIS_ADDR) — refuse to boot
// misconfigured rather than silently pointing at localhost.
package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	RedisAddr   string
	RedisPass   string
	HTTPAddr    string
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
	return Config{
		DatabaseURL: databaseURL,
		RedisAddr:   redisAddr,
		RedisPass:   os.Getenv("REDIS_PASSWORD"),
		HTTPAddr:    httpAddr,
	}, nil
}
