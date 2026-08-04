from __future__ import annotations

from flows.base import Extractor
from flows.greeting_etl.schemas import GreetingInput, RawName


class NameExtractor(Extractor[RawName]):
    """Extracts the raw name from the flow's input parameters.

    Stands in for "read from a source" — a real extractor here might hit
    an API, a database, or a bucket instead of just repackaging the
    flow's own input, but the shape of the class is the same either way.
    """

    def __init__(self, payload: GreetingInput) -> None:
        super().__init__()
        self._payload = payload

    def extract(self) -> RawName:
        self.logger.info("Extracting name from input payload")
        return RawName(name=self._payload.name)
