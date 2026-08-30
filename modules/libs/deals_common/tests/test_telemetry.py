"""telemetry.py — the no-op path is the one every run without a
collector exercises; the wired path is checked against a stubbed
opentelemetry import set, and the JSON formatter is checked directly.
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import types
from unittest.mock import MagicMock

import pytest

from deals_common import telemetry

_OTEL_MODULES = [
    "opentelemetry",
    "opentelemetry.trace",
    "opentelemetry.metrics",
    "opentelemetry.propagate",
    "opentelemetry.propagators",
    "opentelemetry.propagators.composite",
    "opentelemetry.trace.propagation",
    "opentelemetry.trace.propagation.tracecontext",
    "opentelemetry.baggage",
    "opentelemetry.baggage.propagation",
    "opentelemetry.exporter",
    "opentelemetry.exporter.otlp",
    "opentelemetry.exporter.otlp.proto",
    "opentelemetry.exporter.otlp.proto.http",
    "opentelemetry.exporter.otlp.proto.http.trace_exporter",
    "opentelemetry.exporter.otlp.proto.http.metric_exporter",
    "opentelemetry.sdk",
    "opentelemetry.sdk.metrics",
    "opentelemetry.sdk.metrics.export",
    "opentelemetry.sdk.resources",
    "opentelemetry.sdk.trace",
    "opentelemetry.sdk.trace.export",
]


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """telemetry keeps module-level init state; isolate every test."""
    monkeypatch.setattr(telemetry, "_inited", False)
    monkeypatch.setattr(telemetry, "_shutdown", None)
    monkeypatch.setattr(telemetry, "_logger_inited", False)
    yield


def test_noop_without_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    teardown = telemetry.init("svc")
    assert teardown is telemetry.shutdown
    teardown()  # no-op, must not raise
    assert telemetry._shutdown is None


def test_wires_providers_with_endpoint(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")

    stubs = {name: MagicMock() for name in _OTEL_MODULES}
    # "from opentelemetry import trace" resolves against sys.modules
    # entry + attribute access on the parent stub — both covered here.
    for name, mod in stubs.items():
        monkeypatch.setitem(sys.modules, name, mod)
    trace_stub = stubs["opentelemetry"]

    teardown = telemetry.init("deals-worker")
    assert teardown is telemetry.shutdown
    assert telemetry._shutdown is not None

    # "from opentelemetry import trace" landed on the parent stub's
    # auto-created attribute (not the submodule stub).
    trace_mock = trace_stub.trace
    trace_mock.set_tracer_provider.assert_called_once()
    stubs["opentelemetry.sdk.trace"].TracerProvider.assert_called_once()
    stubs["opentelemetry.sdk.metrics"].MeterProvider.assert_called_once()

    # init is idempotent — a second call must not rewire providers.
    trace_mock.set_tracer_provider.reset_mock()
    assert telemetry.init("deals-worker") is telemetry.shutdown
    trace_mock.set_tracer_provider.assert_not_called()

    telemetry.shutdown()
    assert telemetry._shutdown is None  # torn down, further calls no-op


def test_init_survives_broken_sdk(monkeypatch):
    """A half-installed OTel env must downgrade, never crash a worker."""
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318")

    import builtins

    real_import = builtins.__import__

    def broken(name, *args, **kwargs):
        if name.startswith("opentelemetry"):
            raise ImportError("sdk gone")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", broken)
    teardown = telemetry.init("svc")  # must not raise
    teardown()  # and the returned shutdown must be inert


def test_json_formatter_shape():
    fmt = telemetry._JSONFormatter()
    record = logging.LogRecord(
        name="worker", level=logging.INFO, pathname=__file__, lineno=1,
        msg="cycle done", args=(), exc_info=None,
    )
    entry = json.loads(fmt.format(record))
    assert entry["level"] == "info"  # lowercase, like the Go services
    assert entry["msg"] == "cycle done"
    assert entry["logger"] == "worker"
    assert "T" in entry["time"] and entry["time"].endswith("Z")
    assert "trace_id" not in entry  # no span active outside a test span


def test_json_formatter_carries_exception():
    fmt = telemetry._JSONFormatter()
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        record = logging.LogRecord(
            name="w", level=logging.ERROR, pathname=__file__, lineno=1,
            msg="failed", args=(), exc_info=sys.exc_info(),
        )
    entry = json.loads(fmt.format(record))
    assert "boom" in entry["error"]


def test_configure_logging_installs_json_handler_once():
    telemetry.configure_logging()
    assert any(isinstance(h.formatter, telemetry._JSONFormatter) for h in logging.getLogger().handlers)
    count = len(logging.getLogger().handlers)
    telemetry.configure_logging()
    assert len(logging.getLogger().handlers) == count


def test_instruments_fall_back_to_noop_without_sdk(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def broken(name, *args, **kwargs):
        if name.startswith("opentelemetry"):
            raise ImportError("no sdk here")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", broken)
    telemetry.counter("x_total").add(1)
    telemetry.histogram("x_seconds").record(0.5)


def test_tracer_available_without_provider():
    assert telemetry.tracer("test") is not None


def test_otlp_imports_available():
    """The exporters this module relies on must be importable — one
    missing dep would otherwise silently degrade every worker."""
    code = (
        "from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter;"
        "from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter;"
        "import opentelemetry.baggage.propagation"
    )
    subprocess.run([sys.executable, "-c", code], check=True)