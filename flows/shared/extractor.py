"""Base class every flow's Extract stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod

from flows.shared.logger import Loggable


class Extractor[TOut](Loggable, ABC):
    """Reads from a source and returns a typed model. No transform logic here."""

    @abstractmethod
    def extract(self) -> TOut: ...
