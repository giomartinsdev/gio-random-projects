// Package redis is domain-worker's half of the event bus: the Relay
// (bridges the pub/sub command channel into a durable list), the queue
// consumer, and the outbound event publisher. domain-api's own copy of
// this package (in its module) only has the publish side. Both sides
// must agree on these three names; they're duplicated here
// deliberately rather than shared, per this module's independence from
// domain-api's.
package redis

const (
	commandChannel   = "domain.commands"
	commandQueueKey  = "domain.commands.queue"
	processedChannel = "domain.events"
)
