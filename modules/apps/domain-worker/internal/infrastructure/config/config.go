// Package config reads process configuration from the environment. No
// defaults for secrets — refuse to boot misconfigured rather than
// silently pointing at localhost.
//
// DATABASE_URL is preferred from the secrets bridge
// (modules/infra/terraform/modules/compute/vaultwarden_bridge) when
// SECRETS_BRIDGE_URL/SECRETS_BRIDGE_API_KEY are set — the actual
// value lives as an item in the Vaultwarden vault, not in Terraform
// state or GH secrets. Falls back to reading DATABASE_URL straight
// from the environment when the bridge isn't configured, so this
// still boots on a from-scratch bring-up before the vault exists.
package config

import (
	"os"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/secretsbridge"
)

type Config struct {
	DatabaseURL string
	RedisAddr   string
	RedisPass   string
}

func Load() (Config, error) {
	resolve := secretsbridge.NewResolver()

	databaseURL, err := resolve("DATABASE_URL")
	if err != nil {
		return Config{}, err
	}

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		return Config{}, secretsbridge.ErrRequired("REDIS_ADDR")
	}
	return Config{
		DatabaseURL: databaseURL,
		RedisAddr:   redisAddr,
		RedisPass:   os.Getenv("REDIS_PASSWORD"),
	}, nil
}
