// OpenTelemetry for this service: traces and metrics over OTLP/HTTP to
// the collector named by OTEL_EXPORTER_OTLP_ENDPOINT. An empty value
// (local dev, tests) starts nothing at all — importing this module is a
// no-op there.
//
// Logs are deliberately NOT exported by this SDK: log lines go to
// stdout as JSON (logger.ts) and reach Loki through the collector's
// docker-socket stdout scrape — exporting them here too would
// double-ingest every line. The pino mixin in logger.ts is what puts
// trace_id on those lines, reading the spans this SDK creates.
//
// This module must be the FIRST thing src/index.ts imports: the
// instrumentation hooks only see modules loaded after the SDK starts.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    serviceName: "bookclub-api",
    traceExporter: new OTLPTraceExporter(), // reads OTEL_EXPORTER_OTLP_ENDPOINT
    metricReader: new PeriodicExportingMetricReader({
      exportIntervalMillis: 15_000,
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
      // Inbound requests (hono runs on node:http) and outbound node:http
      // clients — the minio SDK among them, so upload/download legs
      // land on the same trace as the request that caused them.
      new HttpInstrumentation(),
      // Every drizzle/pg query becomes a child span.
      new PgInstrumentation(),
      // Global fetch (lib/domainApiClient.ts) — stitches the
      // domain-api leg of a request into the same trace.
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();

  // Flush pending spans/metrics on the way out, capped at main's own
  // shutdown budget.
  const shutdown = () => {
    void sdk.shutdown();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}