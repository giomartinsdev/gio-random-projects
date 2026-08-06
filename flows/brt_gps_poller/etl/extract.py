from __future__ import annotations

from typing import Any, cast

import httpx

from flows.shared.extractor import Extractor

# Confirmed live: unlike SPPO, BRT has no dataInicial/dataFinal window —
# it's always a live "right now" snapshot, no query params at all. The
# envelope is `{"veiculos": [...]}`, not a flat array like SPPO.
_BRT_URL = "https://dados.mobilidade.rio/gps/brt"


class BrtExtractor(Extractor[list[dict[str, Any]]]):
    """Fetches the current live snapshot of every BRT vehicle city-wide.
    No time window (there isn't one to ask for) and no line filter
    server-side — every vehicle currently reporting comes back."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._client = client or httpx.Client(timeout=60.0)

    def extract(self) -> list[dict[str, Any]]:
        self.logger.info("Fetching live BRT positions")
        response = self._client.get(_BRT_URL)
        response.raise_for_status()
        envelope = response.json()
        if not isinstance(envelope, dict):
            self.logger.warning("BRT response was not a JSON object, treating as empty")
            return []
        envelope = cast("dict[str, Any]", envelope)
        raw = envelope.get("veiculos")
        if not isinstance(raw, list):
            self.logger.warning("BRT response had no 'veiculos' array, treating as empty")
            return []
        rows = cast("list[dict[str, Any]]", raw)
        self.logger.info(f"Fetched {len(rows)} raw BRT rows")
        return rows
