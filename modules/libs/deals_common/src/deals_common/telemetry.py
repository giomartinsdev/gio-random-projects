"""OpenTelemetry bootstrap for every deals worker — one call wires
traces + metrics to the collector named by OTEL_EXPORTER_OTLP_ENDPOINT.

Empty endpoint = the whole thing no-ops (local dev, tests): init
returns a shutdown that does nothing, and the tracer/counter/histogram
helpers below hand back the SDK's no-op objects, so call sites are
identical with and without a collector.

Logs are deliberately NOT shipped over OTLP — they reach Loki as
stdout JSON scraped off the container, so configure_logging writes one
JSON object per line (lowercase `level`, plus trace_id/span_id when a
span is active) instead of the default plain-text format. That's the
exact convention the Go side follows via internal/telemetry.

The exporters here read OTEL_EXPORTER_OTLP_ENDPOINT themselves (OTel
spec: base URL + /v1/traces + /v1/metrics appended) — never pass the
endpoint into the exporter constructors: a URL with or without the
signal path there targets that path VERBATIM and every export 404s.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

_logger_inited = False
_inited = False

_shutdown: Callable[[Any], object] | None = None


class _JSONFormatter(logging.Formatter):
    """One JSON object per log line, collector-friendly."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "time": datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            # Lowercase, string — the same shape the Go services log.
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Span context, when a span is active — that's what turns a log
        # row in Grafana into a click through to its trace in Tempo.
        sc = None
        try:
            from opentelemetry import trace

            sc = trace.get_current_span().get_span_context()
        except Exception:  # noqa: BLE001
            pass
        if sc and sc.is_valid:
            entry["trace_id"] = format(sc.trace_id, "032x")
            entry["span_id"] = format(sc.span_id, "016x")
        if record.exc_info:
            entry["error"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def init(service_name: str) -> Callable[[], None]:
    """Install tracer + meter providers if an OTLP endpoint is set.

    Returns a shutdown callable (safe to call more than once) — run it
    on exit so batched spans/metrics actually flush. Never raises: a
    telemetry failure downgrades to no telemetry, the workers have
    deals to scrape.
    """
    global _inited, _shutdown
    if _inited:
        return shutdown

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    if not endpoint:
        logging.getLogger(__name__).debug("otel disabled: OTEL_EXPORTER_OTLP_ENDPOINT unset")
        _inited = True
        return shutdown

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

        from opentelemetry import metrics
        from opentelemetry.propagate import set_global_textmap
        from opentelemetry.propagators.composite import CompositePropagator
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
        from opentelemetry.baggage.propagation import W3CBaggagePropagator

        resource = Resource.create(attributes={"service.name": service_name})

        set_global_textmap(CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()]))

        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)

        reader = PeriodicExportingMetricReader(OTLPMetricExporter())
        meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
        metrics.set_meter_provider(meter_provider)

        _shutdown = lambda: (provider.shutdown(), meter_provider.shutdown())  # noqa: E731
    except Exception:  # noqa: BLE001 — telemetry must never take the worker down
        logging.getLogger(__name__).exception("otel init failed; continuing without it")
        _shutdown = None

    _inited = True
    return shutdown


def shutdown() -> None:
    """Flush pending spans/metrics; idempotent and never raises."""
    global _shutdown
    if _shutdown is None:
        return
    try:
        _shutdown()
    except Exception:  # noqa: BLE001
        pass
    _shutdown = None


def configure_logging(level: int = logging.INFO) -> None:
    """Swap the root handler for the JSON one (exactly once).

    Called by worker mains after init() — logs carry trace_id only if
    the emitting code also keeps the span active, which runner.py's
    cycle span does.
    """
    global _logger_inited
    if _logger_inited:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(_JSONFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    _logger_inited = True


def _current_span():
    try:
        from opentelemetry import trace

        return trace.get_current_span()
    except Exception:  # noqa: BLE001
        return None


def tracer(name: str):
    """The module's tracer; a no-op one until init() ran."""
    from opentelemetry import trace

    return trace.get_tracer(name)


def counter(name: str, *, description: str | None = None):
    """Create a counter instrument.

    Call AFTER init(): instruments created before the meter provider is
    installed bind to a no-op meter and never emit anything.
    """
    try:
        from opentelemetry import metrics

        meter = metrics.get_meter("deals")
        kwargs = {"description": description} if description else {}
        return meter.create_counter(name, **kwargs)
    except Exception:  # noqa: BLE001
        return _NoopInstrument()


def histogram(name: str, *, description: str | None = None):
    """Create a histogram instrument — same 'call after init()' rule."""
    try:
        from opentelemetry import metrics

        meter = metrics.get_meter("deals")
        kwargs = {"description": description} if description else {}
        return meter.create_histogram(name, **kwargs)
    except Exception:  # noqa: BLE001
        return _NoopInstrument()


class _NoopInstrument:
    """Stand-in when the SDK isn't available at all."""

    def add(self, *args: Any, **kwargs: Any) -> None: ...

    def record(self, *args: Any, **kwargs: Any) -> None: ...