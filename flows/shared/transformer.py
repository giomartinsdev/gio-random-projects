"""Base class every flow's Transform stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from flows.shared.logger import Loggable

TIn = TypeVar("TIn")
TOut = TypeVar("TOut")


class Transformer(Loggable, ABC, Generic[TIn, TOut]):
    """Pure function from one typed model to another. No I/O."""

    @abstractmethod
    def transform(self, data: TIn) -> TOut: ...
