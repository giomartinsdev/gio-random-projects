from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx

from flows.shared.extractor import Extractor

# Confirmed live against dados.mobilidade.rio: the SPPO endpoint reads
# dataInicial/dataFinal as America/Sao_Paulo wall-clock time, not UTC — a
# UTC-formatted window silently returns 200 with an empty array (reads
# exactly like "no live data", but is actually "no data 3 hours in the
# future"). Mirrors gio-dev-tools' worker/bus-tracker-poller (the RJ-SMTR/
# app-monitoramento-realtime reference frontend this API was built for).
_SP_TZ = ZoneInfo("America/Sao_Paulo")
_SPPO_URL = "https://dados.mobilidade.rio/gps/sppo"


class SppoExtractor(Extractor[list[dict[str, Any]]]):
    """Fetches every regular-bus GPS ping city-wide for the last
    `window_seconds` up to now. No line filter server-side — every bus
    in the city comes back regardless of route; filtering by tracked
    line, if ever needed, is the transform stage's job, not this one's.
    """

    def __init__(self, window_seconds: int, client: httpx.Client | None = None) -> None:
        super().__init__()
        self._window_seconds = window_seconds
        self._client = client or httpx.Client(timeout=60.0)

    def extract(self) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        data_inicial = now - timedelta(seconds=self._window_seconds)

        # Query string built by hand (`?&dataInicial=...+HH:MM:SS`, `+` as
        # the date/time separator) to match the reference frontend's own
        # `format(d, "yyyy-MM-dd+HH:mm:ss")` byte-for-byte, rather than
        # letting httpx's `params=` encode a space — both are accepted
        # (confirmed live), but this removes any doubt.
        url = f"{_SPPO_URL}?&dataInicial={self._format(data_inicial)}&dataFinal={self._format(now)}"
        self.logger.info(f"Fetching SPPO positions for the last {self._window_seconds}s")
        response = self._client.get(url)
        response.raise_for_status()
        raw = response.json()
        if not isinstance(raw, list):
            self.logger.warning("SPPO response was not a JSON array, treating as empty")
            return []
        # The feed is documented (and confirmed live) to always return an
        # array of row objects; this states that contract for the type
        # checker rather than re-validating every row's shape here — the
        # transform stage already handles a malformed individual row.
        rows = cast("list[dict[str, Any]]", raw)
        self.logger.info(f"Fetched {len(rows)} raw SPPO rows")
        return rows

    @staticmethod
    def _format(moment: datetime) -> str:
        return moment.astimezone(_SP_TZ).strftime("%Y-%m-%d+%H:%M:%S")
