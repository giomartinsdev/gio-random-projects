"""Base class every flow's Transform stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod

from flows.shared.logger import Loggable


class Transformer[TIn, TOut](Loggable, ABC):
    """Pure function from one typed model to another. No I/O."""

    @abstractmethod
    def transform(self, data: TIn) -> TOut: ...
