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
	"strconv"

	"github.com/giomartinsdev/gio-random-projects/modules/apps/domain-worker/internal/infrastructure/secretsbridge"
)

type Config struct {
	DatabaseURL string
	RedisAddr   string
	RedisPass   string
	// EventsQueueMax caps the durable event queue's length from the
	// tail (event_bus.go's LTRIM).
	EventsQueueMax int
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

	queueMax := 10000
	if v := os.Getenv("DOMAIN_EVENTS_QUEUE_MAX"); v != "" {
		parsed, err := strconv.Atoi(v)
		if err != nil {
			return Config{}, secretsbridge.ErrParse("DOMAIN_EVENTS_QUEUE_MAX", err)
		}
		queueMax = parsed
	}

	return Config{
		DatabaseURL:    databaseURL,
		RedisAddr:      redisAddr,
		RedisPass:      os.Getenv("REDIS_PASSWORD"),
		EventsQueueMax: queueMax,
	}, nil
}
