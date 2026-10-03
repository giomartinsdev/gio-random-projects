"""OpenTelemetry wiring, optional and never fatal.

Mirrors the reasoning in the Go services' ``internal/telemetry``: an empty
``OTEL_EXPORTER_OTLP_ENDPOINT`` means telemetry is off (local dev), and a
failure to initialise it must **not** take the ACL down -- losing traces is
annoying, refusing to serve the finance context is worse.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def configure_telemetry(endpoint: str, service_name: str) -> object | None:
    """Set up OTLP traces/metrics when an endpoint is configured.

    Returns the ``TracerProvider`` for shutdown, or ``None`` when telemetry
    is off or could not be initialised.
    """
    if not endpoint:
        # No endpoint, no telemetry -- the same explicit "empty = off"
        # convention the Go services document.
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:  # pragma: no cover - optional deps
        logger.warning("opentelemetry packages unavailable; telemetry stays off")
        return None

    try:
        # The exporter appends /v1/traces itself; the stack passes the bare
        # host:port (http://alloy:4318) exactly as the Go services do.
        trace_endpoint = endpoint.rstrip("/")
        if not trace_endpoint.endswith("/v1/traces"):
            trace_endpoint = f"{trace_endpoint}/v1/traces"

        provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=trace_endpoint))
        )
        trace.set_tracer_provider(provider)
        return provider
    except Exception as exc:  # noqa: BLE001 - telemetry must never be fatal
        logger.warning("telemetry init failed; continuing without it: %s", exc)
        return None


def instrument_app(app: object) -> None:
    """Attach FastAPI/httpx instrumentation, tolerating its absence."""
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        FastAPIInstrumentor.instrument_app(app)  # type: ignore[arg-type]
        HTTPXClientInstrumentor().instrument()
    except Exception as exc:  # noqa: BLE001 - telemetry must never be fatal
        logger.warning("telemetry instrumentation skipped: %s", exc)
