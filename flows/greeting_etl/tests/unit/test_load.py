from __future__ import annotations

import io
import logging

from flows.greeting_etl.load import GreetingLoader
from flows.greeting_etl.schemas import GreetingResult


def test_loader_logs_the_message() -> None:
    # Given a greeting result, a loader, and a handler attached directly to
    # its logger (get_logger() sets propagate=False to avoid duplicate
    # lines when a root handler is also configured, which means pytest's
    # caplog — which listens at the root logger — never sees anything
    # here; attaching our own handler is the reliable way to capture it)
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    result = GreetingResult(name="gio", message="Hello, gio!")
    loader = GreetingLoader()
    loader.logger.addHandler(handler)

    # When load is called
    try:
        loader.load(result)
    finally:
        loader.logger.removeHandler(handler)

    # Then the message was logged
    assert "Hello, gio!" in stream.getvalue()
