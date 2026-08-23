// Package config reads process configuration from the environment. No
// defaults for secrets — refuse to boot misconfigured rather than
// silently pointing at localhost.
package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	RedisAddr   string
	RedisPass   string
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
	return Config{
		DatabaseURL: databaseURL,
		RedisAddr:   redisAddr,
		RedisPass:   os.Getenv("REDIS_PASSWORD"),
	}, nil
}
