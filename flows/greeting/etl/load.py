from __future__ import annotations

from flows.greeting.schemas import GreetingResult
from flows.shared.loader import Loader


class GreetingLoader(Loader[GreetingResult]):
    """Writes the greeting to the flow's logs — stand-in for a real sink
    (a database write, an API call, a file upload)."""

    def load(self, data: GreetingResult) -> None:
        self.logger.info(data.message)
