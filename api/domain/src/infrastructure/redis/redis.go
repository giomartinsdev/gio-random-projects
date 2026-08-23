// Package redis is the event-driven backbone: domain-api publishes a
// Command onto a pub/sub channel (CommandBus); Relay bridges that
// channel onto a durable list (CommandQueue implements
// application.CommandConsumer) because raw pub/sub drops any message
// published while nothing is subscribed — the list is what lets
// domain-worker consume at its own pace and survive a restart without
// losing whatever arrived while it was down. After domain-worker
// applies a command, EventBus publishes the resulting domain event on a
// second channel for anything downstream that wants to react (nothing
// subscribes to it yet).
package redis

const (
	commandChannel   = "domain.commands"
	commandQueueKey  = "domain.commands.queue"
	processedChannel = "domain.events"
)
