// Package telemetry wires OpenTelemetry into this app with one call:
// traces and metrics go over OTLP/HTTP to the collector named by
// OTEL_EXPORTER_OTLP_ENDPOINT (empty = everything no-ops, so local dev
// and tests run exactly as before).
//
// Copiado de domain-api/internal/telemetry: a receita do repo é copiar
// este pacote num app Go novo, não importar de outro app. Logs não fazem
// parte do SDK -- eles chegam ao Loki pelo scrape de stdout do container;
// o que o SDK faz é pôr um span em cada request (otelhttp, em main) para
// que NewLogger injete trace_id/span_id nas linhas slog.
package telemetry

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// Init installs the global tracer and meter providers, pointing both at
// OTEL_EXPORTER_OTLP_ENDPOINT, and returns a shutdown func that flushes
// them (main defers it with a timeout). It also installs the W3C
// propagator -- the otel default is a no-op propagator, and without this
// otelhttp would never read or write traceparent, so traces would never
// stitch across services.
//
// An empty endpoint disables everything and returns a shutdown that
// does nothing: no collector configured means no telemetry, by design.
func Init(ctx context.Context, serviceName string) (func(context.Context) error, error) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
	if endpoint == "" {
		return func(context.Context) error { return nil }, nil
	}

	res, err := resource.New(ctx, resource.WithAttributes(attribute.String("service.name", serviceName)))
	if err != nil {
		return nil, fmt.Errorf("telemetry resource: %w", err)
	}

	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	// Both exporters read OTEL_EXPORTER_OTLP_ENDPOINT from the env
	// themselves (OTel spec: the base URL gets /v1/traces and /v1/metrics
	// appended). Deliberately NOT WithEndpointURL(endpoint): there, a
	// path-less URL targets the ROOT path verbatim -- the signal path is
	// not appended -- and every export 404s against the collector.
	traceExp, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, fmt.Errorf("telemetry trace exporter: %w", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(traceExp))
	otel.SetTracerProvider(tp)

	meterExp, err := otlpmetrichttp.New(ctx)
	if err != nil {
		_ = tp.Shutdown(ctx) // don't leak the half-installed trace pipeline
		return nil, fmt.Errorf("telemetry metric exporter: %w", err)
	}
	mp := metric.NewMeterProvider(metric.WithResource(res), metric.WithReader(metric.NewPeriodicReader(meterExp)))
	otel.SetMeterProvider(mp)

	// Goroutines/heap/GC gauges -- the cheapest useful Grafana panel for
	// a Go service, and the first thing you want when one "looks slow".
	if err := runtime.Start(runtime.WithMeterProvider(mp)); err != nil {
		_ = mp.Shutdown(ctx)
		_ = tp.Shutdown(ctx)
		return nil, fmt.Errorf("telemetry runtime metrics: %w", err)
	}

	return func(ctx context.Context) error {
		return errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx))
	}, nil
}

// NewLogger wraps a slog handler so every record emitted while a span
// is active carries trace_id/span_id in its JSON line -- the field
// Grafana's Loki datasource matches on to link the line to its trace in
// Tempo. Applied unconditionally (collector configured or not): the
// fields are simply absent from lines logged outside a span. Call sites
// need a Context-aware slog method (ErrorContext & co) for the span to
// be visible -- plain log.Error has no context to read one from.
func NewLogger(inner slog.Handler) slog.Handler {
	return &traceHandler{inner: inner}
}

type traceHandler struct{ inner slog.Handler }

func (h *traceHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *traceHandler) Handle(ctx context.Context, r slog.Record) error {
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		r.AddAttrs(
			slog.String("trace_id", sc.TraceID().String()),
			slog.String("span_id", sc.SpanID().String()),
		)
	}
	return h.inner.Handle(ctx, r)
}

func (h *traceHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &traceHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h *traceHandler) WithGroup(name string) slog.Handler {
	return &traceHandler{inner: h.inner.WithGroup(name)}
}
