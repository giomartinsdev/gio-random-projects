"""Base class every flow's Load stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod

from flows.shared.logger import Loggable


class Loader[TIn](Loggable, ABC):
    """Writes a typed model to a destination. Returns nothing — side effect only."""

    @abstractmethod
    def load(self, data: TIn) -> None: ...
