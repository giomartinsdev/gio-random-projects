from __future__ import annotations

from flows.base import Transformer
from flows.greeting_etl.schemas import GreetingResult, RawName


class GreetingTransformer(Transformer[RawName, GreetingResult]):
    """Builds the greeting message from the raw name. Pure — no I/O."""

    def transform(self, data: RawName) -> GreetingResult:
        self.logger.info("Building greeting for %s", data.name)
        return GreetingResult(name=data.name, message=f"Hello, {data.name}!")
