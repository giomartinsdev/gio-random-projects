from __future__ import annotations

from flows.base import Loader
from flows.greeting_etl.schemas import GreetingResult


class GreetingLoader(Loader[GreetingResult]):
    """Writes the greeting to the flow's logs — stand-in for a real sink
    (a database write, an API call, a file upload)."""

    def load(self, data: GreetingResult) -> None:
        self.logger.info(data.message)
