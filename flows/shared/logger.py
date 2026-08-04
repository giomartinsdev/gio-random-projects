"""Standard logging setup shared by every ETL base class."""

from __future__ import annotations

import logging


class _CorrelatedFormatter(logging.Formatter):
    """Formats otelTraceID/otelSpanID when present, "-" otherwise.

    OTel's LoggingInstrumentor (active when a flow run is wrapped with
    opentelemetry-instrument + OTEL_PYTHON_LOG_CORRELATION=true) stamps
    every LogRecord with these two attributes for the span active at
    emit time — which is the same trace_id Tempo groups the whole flow
    run's spans under, so this ties a log line to both its own span and
    the run's root trace at once. Outside that context (plain pytest,
    a script run directly) the attributes never get set, so referencing
    them via a plain "%(otelTraceID)s" format string would raise — this
    subclass fills in "-" instead of failing.
    """

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "otelTraceID"):
            record.otelTraceID = "-"
        if not hasattr(record, "otelSpanID"):
            record.otelSpanID = "-"
        return super().format(record)


def get_logger(name: str) -> logging.Logger:
    """Standard logger config — same format for every ETL class in every flow.

    Must propagate to the root logger (the default — never set False here):
    OTel's logging auto-instrumentation attaches its handler there, so a
    non-propagating logger's records never reach the OTLP exporter and
    silently never show up in Loki, even though they print to console fine.
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            _CorrelatedFormatter(
                "%(asctime)s | %(levelname)-8s | %(name)s | "
                "trace_id=%(otelTraceID)s span_id=%(otelSpanID)s | %(message)s"
            )
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


class Loggable:
    """Mixin giving a class a `self.logger` named after its own module + class name."""

    def __init__(self) -> None:
        self.logger: logging.Logger = get_logger(
            f"{self.__class__.__module__}.{self.__class__.__qualname__}"
        )
