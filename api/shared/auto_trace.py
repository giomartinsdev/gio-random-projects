"""Zero-registration auto-tracing for any package under api/.

Installs an import hook (`install(["app"])`, called once from a
service's app/__init__.py) that wraps every function and class method
defined in any matching module with an OTel span, the moment that module
is imported — no route, handler, or class has to call anything itself.

Same mechanism as flows/shared/auto_trace.py, copied rather than
imported because api/<service>/ and flows/ ship as separate,
independently deployed things (each api/<service>/ is its own Docker
image with its own dependency set — there's no shared Python environment
to import a common package from across them). Complements framework-level
auto-instrumentation (FastAPI/httpx/SQLAlchemy spans via
`opentelemetry-instrument`, activated purely through env vars — see each
service's README): those cover request/response and outbound-call
boundaries; this covers every method call *inside* the service's own
domain/service/infrastructure code, nested under whichever request span
is active when the call happens.

Uses the modern find_spec/exec_module finder protocol (PEP 451) — an
earlier version of this hook used the legacy find_module/load_module
pair, which CPython's import system stopped calling somewhere around
3.12 (the finder sat in sys.meta_path but was never actually invoked,
so nothing got instrumented and nothing errored either — confirmed by
testing, not from changelog-reading).
"""

from __future__ import annotations

import functools
import importlib.abc
import importlib.machinery
import importlib.util
import inspect
import sys
from types import ModuleType
from typing import Any, Callable, Iterable, Sequence

from opentelemetry import trace
from opentelemetry.trace import StatusCode

tracer = trace.get_tracer("auto-tracer")


def _wrap_func(func: Callable[..., Any], span_name: str) -> Callable[..., Any]:
    if inspect.iscoroutinefunction(func):

        @functools.wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            with tracer.start_as_current_span(span_name) as span:
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(StatusCode.ERROR, str(e))
                    raise

        return async_wrapper

    @functools.wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        with tracer.start_as_current_span(span_name) as span:
            try:
                return func(*args, **kwargs)
            except Exception as e:
                span.record_exception(e)
                span.set_status(StatusCode.ERROR, str(e))
                raise

    return wrapper


def _wrap_classmethod(func: classmethod[Any, Any, Any], span_name: str) -> classmethod[Any, Any, Any]:
    original = func.__func__
    if inspect.iscoroutinefunction(original):

        @functools.wraps(original)
        async def async_wrapper(cls: type, *args: Any, **kwargs: Any) -> Any:
            with tracer.start_as_current_span(span_name) as span:
                try:
                    return await original(cls, *args, **kwargs)
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(StatusCode.ERROR, str(e))
                    raise

        return classmethod(async_wrapper)

    @functools.wraps(original)
    def wrapper(cls: type, *args: Any, **kwargs: Any) -> Any:
        with tracer.start_as_current_span(span_name) as span:
            try:
                return original(cls, *args, **kwargs)
            except Exception as e:
                span.record_exception(e)
                span.set_status(StatusCode.ERROR, str(e))
                raise

    return classmethod(wrapper)


def _wrap_staticmethod(func: staticmethod[Any, Any], span_name: str) -> staticmethod[Any, Any]:
    original = func.__func__
    if inspect.iscoroutinefunction(original):

        @functools.wraps(original)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            with tracer.start_as_current_span(span_name) as span:
                try:
                    return await original(*args, **kwargs)
                except Exception as e:
                    span.record_exception(e)
                    span.set_status(StatusCode.ERROR, str(e))
                    raise

        return staticmethod(async_wrapper)

    @functools.wraps(original)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        with tracer.start_as_current_span(span_name) as span:
            try:
                return original(*args, **kwargs)
            except Exception as e:
                span.record_exception(e)
                span.set_status(StatusCode.ERROR, str(e))
                raise

    return staticmethod(wrapper)


def _instrument_class(cls: type, module_name: str) -> None:
    for name, _ in inspect.getmembers(cls):
        if name.startswith("__") and name.endswith("__"):
            continue

        raw = cls.__dict__.get(name)
        if raw is None:
            continue

        span_name = f"{module_name}.{cls.__name__}.{name}"

        if isinstance(raw, classmethod):
            setattr(cls, name, _wrap_classmethod(raw, span_name))
        elif isinstance(raw, staticmethod):
            setattr(cls, name, _wrap_staticmethod(raw, span_name))
        elif inspect.isfunction(raw):
            setattr(cls, name, _wrap_func(raw, span_name))


def _instrument_module(module: ModuleType) -> None:
    module_name = module.__name__

    for func_name, func_obj in inspect.getmembers(module, predicate=inspect.isfunction):
        if func_obj.__module__ != module_name:
            continue
        if func_name.startswith("__"):
            continue
        span_name = f"{module_name}.{func_name}"
        setattr(module, func_name, _wrap_func(func_obj, span_name))

    for cls_name, cls_obj in inspect.getmembers(module, predicate=inspect.isclass):
        if cls_obj.__module__ != module_name:
            continue
        _instrument_class(cls_obj, module_name)


class _AutoTraceImportHook(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Wraps the REAL loader for any matching module: lets it do the actual
    file read/compile/exec, then instruments the result. The re-entrancy
    guard (`_resolving`) is what lets `importlib.util.find_spec()` below
    reach the standard `PathFinder` instead of looping back into us — we're
    first in `sys.meta_path`, so without it we'd ask ourselves for the spec
    forever.
    """

    def __init__(self, packages: Iterable[str]) -> None:
        self.packages = tuple(packages)
        self._resolving: set[str] = set()
        self._wrapped_loaders: dict[str, importlib.abc.Loader] = {}

    def _matches(self, fullname: str) -> bool:
        return any(fullname == p or fullname.startswith(p + ".") for p in self.packages)

    def find_spec(
        self, fullname: str, path: Sequence[str] | None, target: ModuleType | None = None
    ) -> importlib.machinery.ModuleSpec | None:
        if not self._matches(fullname) or fullname in self._resolving:
            return None

        self._resolving.add(fullname)
        try:
            spec = importlib.util.find_spec(fullname)
        finally:
            self._resolving.discard(fullname)

        if spec is None or spec.loader is None:
            return None

        self._wrapped_loaders[fullname] = spec.loader
        spec.loader = self
        return spec

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> ModuleType | None:
        original = self._wrapped_loaders[spec.name]
        create = getattr(original, "create_module", None)
        return create(spec) if create else None

    def exec_module(self, module: ModuleType) -> None:
        original = self._wrapped_loaders.pop(module.__name__)
        original.exec_module(module)
        _instrument_module(module)


_hook: _AutoTraceImportHook | None = None


def install(packages: list[str]) -> None:
    global _hook
    if _hook is not None:
        return
    _hook = _AutoTraceImportHook(packages)
    sys.meta_path.insert(0, _hook)
