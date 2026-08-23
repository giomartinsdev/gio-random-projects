package application

import "context"

// CommandPublisher is the only port domain-api needs — it hands off
// every write without touching storage itself.
type CommandPublisher interface {
	Publish(ctx context.Context, cmd Command) error
}
