// Structured logging, one JSON object per line to stdout — alloy tails
// this container's stdout into Loki, so: string levels (the pipeline's
// stage.labels keys on them), no pid/hostname base fields, and the pino
// mixin carries trace_id/span_id inside any undici span (telemetry.ts).
//
// Copied from bet-api (copied from post-api; this repo has no shared
// TS package, apps copy this file instead).
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