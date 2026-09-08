// OpenTelemetry for the runner: traces over OTLP/HTTP to the collector
// named by OTEL_EXPORTER_OTLP_ENDPOINT. An empty value (local dev,
// tests) starts nothing at all — importing this module is a no-op
// there.
//
// No Pg instrumentation here (the runner never touches Postgres
// directly — it goes through bet-api) and no HTTP server
// instrumentation (nothing listens). The interesting trace is the
// undici/fetch one: claim + report calls stitch the runner into the
// same trace the BFF started.
//
// Must be the FIRST thing src/index.ts imports. Copied from bet-api
// (copied from post-api; no shared TS package in this repo).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    serviceName: "bet-runner",
    traceExporter: new OTLPTraceExporter(), // reads OTEL_EXPORTER_OTLP_ENDPOINT
    instrumentations: [new UndiciInstrumentation()],
  });
  sdk.start();

  const shutdown = () => {
    void sdk.shutdown();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}