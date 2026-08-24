// Package config reads process configuration from the environment. No
// defaults for secrets — refuse to boot misconfigured rather than
// silently pointing at localhost.
//
// DATABASE_URL and DOMAIN_API_KEYS are preferred from the secrets
// bridge (modules/infra/terraform/modules/compute/vaultwarden_bridge)
// when SECRETS_BRIDGE_URL/SECRETS_BRIDGE_API_KEY are set — actual
// values live as items in the Vaultwarden vault, not in Terraform
// state or GH secrets. Falls back to reading the same names straight
// from the environment when the bridge isn't configured, so this
// still boots on a from-scratch bring-up before the vault exists.
package config

import (
	"os"
	"strconv"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-api/internal/infrastructure/secretsbridge"
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
	resolve := secretsbridge.NewResolver()

	databaseURL, err := resolve("DATABASE_URL")
	if err != nil {
		return Config{}, err
	}
	apiKeys, err := resolve("DOMAIN_API_KEYS")
	if err != nil {
		return Config{}, err
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		return Config{}, secretsbridge.ErrRequired("REDIS_ADDR")
	}
	httpAddr := os.Getenv("HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = ":8000"
	}

	rps := 1.0
	if v := os.Getenv("RATE_LIMIT_RPS"); v != "" {
		parsed, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return Config{}, secretsbridge.ErrParse("RATE_LIMIT_RPS", err)
		}
		rps = parsed
	}
	burst := 5
	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, secretsbridge.ErrParse("RATE_LIMIT_BURST", err)
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
