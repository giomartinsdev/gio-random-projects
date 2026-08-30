package telemetry

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// Counters every aggregate's write path feeds, declared once here so
// their names live in exactly one place (the Grafana panels match
// these strings). Cardinality stays bounded: every label comes from a
// short enum — action from the command's own name, status from
// success/error, source/result from the deal pipeline — never from
// free-text like IDs, slugs or titles.
var (
	// CommandsProcessed counts commands the worker picked up off the
	// queue, labeled by what they were and how they ended.
	CommandsProcessed metric.Int64Counter
	// DealsUpserted counts raw_deals writes, labeled by which source
	// fed the row and whether it was a genuine insert (news) or an
	// update (a re-poll of a known deal) — the ratio of inserted to
	// updated is the cheapest possible signal that scraping still
	// surfaces fresh deals.
	DealsUpserted metric.Int64Counter
)

// InitMetrics registers the meter-owned instruments against the global
// provider (telemetry.Init must have run first, or these silently
// no-op like everything else without a collector).
func InitMetrics() error {
	meter := otel.Meter("domain-worker")

	commands, err := meter.Int64Counter(
		"domain_commands_total",
		metric.WithDescription("Commands processed, by action and outcome"),
	)
	if err != nil {
		return err
	}
	CommandsProcessed = commands

	deals, err := meter.Int64Counter(
		"deal_upserts_total",
		metric.WithDescription("raw_deals upserts, by source and insert/update result"),
	)
	if err != nil {
		return err
	}
	DealsUpserted = deals
	return nil
}

// Helpers keep the label sets consistent at every call site.

func RecordCommand(action, status string) {
	if CommandsProcessed == nil {
		return
	}
	CommandsProcessed.Add(context.TODO(), 1,
		metric.WithAttributes(
			attribute.String("action", action),
			attribute.String("status", status),
		))
}

func RecordDealUpsert(source, result string) {
	if DealsUpserted == nil {
		return
	}
	DealsUpserted.Add(context.TODO(), 1,
		metric.WithAttributes(
			attribute.String("source", source),
			attribute.String("result", result),
		))
}
