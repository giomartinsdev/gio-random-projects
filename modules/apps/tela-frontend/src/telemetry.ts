// Browser telemetry: one trace per page load (DocumentLoad) and per API
// call (Fetch), exported to the public OTLP endpoint (otel.giomartins.dev
// → ingress → alloy's OTLP receiver, whose CORS allowlist is exactly
// tela.giomartins.dev).
//
// The web SDK can't read env vars at runtime — VITE_* is baked into the
// bundle at build time (ts-frontend-ci-cd.yml) — so the exporter URL is
// read explicitly here. Unset (local dev) means no telemetry: the whole
// init is skipped.
//
// Sampling is 20% of page loads (ParentBased, so a sampled root carries
// its children): enough signal to debug with, at a fraction of the span
// volume Tempo's 3-day disk has to hold.
//
// FetchInstrumentation is also what PROPAGATES: it adds traceparent to
// calls at tela-api, which is why that server's CORS config allows
// traceparent/tracestate/baggage (tela-api internal/httpapi/server.go) —
// a preflight that didn't would kill every call. The signalling
// WebSocket itself can't carry HTTP headers after the upgrade, but the
// GET /ws that opens it is an instrumented fetch like any other, so the
// whole connection's server-side span hangs off the page's trace.
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";

const endpoint = import.meta.env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  // The exporter's own requests must not be traced — that way lies
  // telemetry about telemetry, and a feedback loop.
  const otelUrlFilter = new RegExp(`^${endpoint.replace(/\/$/, "")}/`);

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ "service.name": "tela-frontend" }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.2) }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
        }),
      ),
    ],
  });

  provider.register({
    // ZoneContextManager is what keeps the active span reachable across
    // async boundaries (fetch handlers, React effects) — without it
    // child spans lose their parents and every trace falls apart.
    contextManager: new ZoneContextManager(),
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        // Only tela-api gets traceparent (and thus a preflight asking
        // for it) — third-party requests are left untouched.
        propagateTraceHeaderCorsUrls: [/^https:\/\/tela-api\.giomartins\.dev\//],
        ignoreUrls: [otelUrlFilter],
      }),
    ],
  });
}