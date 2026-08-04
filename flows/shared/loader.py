"""Base class every flow's Load stage inherits from."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from flows.shared.logger import Loggable

TIn = TypeVar("TIn")


class Loader(Loggable, ABC, Generic[TIn]):
    """Writes a typed model to a destination. Returns nothing — side effect only."""

    @abstractmethod
    def load(self, data: TIn) -> None: ...
