"""Base classes every flow's Extract/Transform/Load tasks inherit from.

Generic in the shapes they read/produce, so a subclass declares its I/O in
the type parameters (`class NameExtractor(Extractor[RawName])`) — mypy
catches a Transformer wired to the wrong Extractor's output at the
flow-assembly point, not at runtime.

These classes are deliberately Prefect-agnostic (no `@task` here, no
`prefect` import) — that's what keeps them unit-testable with plain
pytest, no Prefect runtime/context needed. Each flow's flow.py wraps calls
to them in thin `@task` functions instead (see
flows/greeting_etl/flow.py for the reference shape).
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

TIn = TypeVar("TIn")
TOut = TypeVar("TOut")


def get_logger(name: str) -> logging.Logger:
    """Standard logger config — same format for every ETL class in every flow."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)-8s | %(name)s | %(message)s")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


class _Loggable:
    def __init__(self) -> None:
        self.logger: logging.Logger = get_logger(
            f"{self.__class__.__module__}.{self.__class__.__qualname__}"
        )


class Extractor(_Loggable, ABC, Generic[TOut]):
    """Reads from a source and returns a typed model. No transform logic here."""

    @abstractmethod
    def extract(self) -> TOut: ...


class Transformer(_Loggable, ABC, Generic[TIn, TOut]):
    """Pure function from one typed model to another. No I/O."""

    @abstractmethod
    def transform(self, data: TIn) -> TOut: ...


class Loader(_Loggable, ABC, Generic[TIn]):
    """Writes a typed model to a destination. Returns nothing — side effect only."""

    @abstractmethod
    def load(self, data: TIn) -> None: ...
