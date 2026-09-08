// Structured logging for the whole service. One JSON object per line to
// stdout — alloy tails this container's stdout into Loki (see the
// observability module's README), so everything below is shaped for
// that pipeline:
//
//   - string levels ("info", not pino's numeric default): that label is
//     what the log pipeline's stage.labels keys on;
//   - no pid/hostname base fields: noise in Loki, nothing reads them;
//   - the mixin is the trace-correlation half of the stack — inside any
//     request span (see telemetry.ts) every line carries
//     trace_id/span_id, which Grafana's Loki datasource links to the
//     trace in Tempo.
//
// Copied from post-api (this repo has no shared TS package; apps copy
// this file instead).
import pino from "pino";
import { context, trace, isSpanContextValid } from "@opentelemetry/api";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  mixin() {
    const spanContext = trace.getSpanContext(context.active());
    if (spanContext && isSpanContextValid(spanContext)) {
      return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
    }
    return {};
  },
});