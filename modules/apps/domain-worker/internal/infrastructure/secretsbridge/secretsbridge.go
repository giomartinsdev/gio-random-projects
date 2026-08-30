// Package secretsbridge fetches secret values from
// modules/infra/terraform/modules/compute/vaultwarden_bridge's
// GET /secret/:name API instead of reading them straight out of the
// environment — that bridge is what actually talks to Vaultwarden and
// decrypts vault items; this package is a thin, dependency-free HTTP
// client for it, not a Bitwarden client itself.
package secretsbridge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

func ErrRequired(name string) error {
	return fmt.Errorf("%s is required", name)
}

func ErrParse(name string, err error) error {
	return fmt.Errorf("%s is not parseable: %w", name, err)
}

type client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type secretResponse struct {
	Value string `json:"value"`
}

func (c *client) fetch(name string) (string, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(c.baseURL, "/")+"/secret/"+name, nil)
	if err != nil {
		return "", fmt.Errorf("secrets bridge request for %s: %w", name, err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("secrets bridge request for %s: %w", name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("secrets bridge returned %d for %s", resp.StatusCode, name)
	}

	var body secretResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("secrets bridge response for %s: %w", name, err)
	}
	if body.Value == "" {
		return "", fmt.Errorf("secrets bridge returned an empty value for %s", name)
	}
	return body.Value, nil
}

// NewResolver returns a function that fetches a named secret — from
// the bridge if SECRETS_BRIDGE_URL/SECRETS_BRIDGE_API_KEY are both
// set, otherwise falling back to os.Getenv(name) directly, so this
// still works before the bridge/vault exist.
func NewResolver() func(name string) (string, error) {
	baseURL := os.Getenv("SECRETS_BRIDGE_URL")
	apiKey := os.Getenv("SECRETS_BRIDGE_API_KEY")

	if baseURL == "" || apiKey == "" {
		return func(name string) (string, error) {
			v := os.Getenv(name)
			if v == "" {
				return "", ErrRequired(name)
			}
			return v, nil
		}
	}

	c := &client{baseURL: baseURL, apiKey: apiKey, http: &http.Client{Timeout: 10 * time.Second}}
	return c.fetch
}
