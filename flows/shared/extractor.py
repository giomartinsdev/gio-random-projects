"""Base class every flow's Extract stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from flows.shared.logger import Loggable

TOut = TypeVar("TOut")


class Extractor(Loggable, ABC, Generic[TOut]):
    """Reads from a source and returns a typed model. No transform logic here."""

    @abstractmethod
    def extract(self) -> TOut: ...
