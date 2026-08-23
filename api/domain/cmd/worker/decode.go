package main

import (
	"encoding/json"
	"fmt"

	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/events"
	"github.com/giomartinsdev/gio-random-projects/api/domain/internal/models"
)

// decodeInput re-encodes cmd.Payload (a map[string]any after coming off
// Redis through encoding/json) back into the concrete UserInput shape
// domain-api originally sent.
func decodeInput(payload any) (models.UserInput, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return models.UserInput{}, fmt.Errorf("re-encode command payload: %w", err)
	}
	var input models.UserInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return models.UserInput{}, fmt.Errorf("decode command payload: %w", err)
	}
	return input, nil
}

func errUnknownAction(action events.Action) error {
	return fmt.Errorf("unknown command action: %q", action)
}
