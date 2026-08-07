from __future__ import annotations

import csv
import io
import zipfile

import httpx

from flows.shared.extractor import Extractor

# Confirmed live: PrefeituraRio's ArcGIS-hosted item resolves this /data
# endpoint straight to the GTFS zip bytes (Content-Type: application/zip,
# no redirect, no API key needed) — the same file the data.rio catalog
# page (https://www.data.rio/datasets/8ffe62ad3b2f42e49814bf941654ea6c)
# links out to, just without its JS-rendered wrapper in the way. Owned
# by the Secretaria Municipal de Transportes (SMTR), updated monthly —
# see prefect.yaml's schedule for this flow.
_GTFS_URL = (
    "https://www.arcgis.com/sharing/rest/content/items/8ffe62ad3b2f42e49814bf941654ea6c/data"
)

# Only the four GTFS files the transform stage actually needs (stop
# names/coords, route names/modes, and enough of the trip/stop_times
# join to build a per-line stop sequence) — calendar/fare/shape files in
# the real feed are left unread.
_FILES = ("stops.txt", "routes.txt", "trips.txt", "stop_times.txt")


class GtfsExtractor(Extractor[dict[str, list[dict[str, str]]]]):
    """Downloads the SMTR's GTFS zip and parses the CSVs the transform
    stage needs into lists of raw dict rows, keyed by filename without
    its extension (e.g. "stops", "routes"). No shaping here — that's the
    transform stage's job."""

    def __init__(self, client: httpx.Client | None = None) -> None:
        super().__init__()
        # A ~25MB zip over a real network is comfortably slower than
        # httpx's 5s default; this is a GET with no bulk write on the
        # other end, so well under vehicle_position's own 90s
        # upstream-timeout convention for loaders.
        self._client = client or httpx.Client(timeout=60.0)

    def extract(self) -> dict[str, list[dict[str, str]]]:
        self.logger.info(f"Downloading GTFS feed from {_GTFS_URL}")
        response = self._client.get(_GTFS_URL)
        response.raise_for_status()

        tables: dict[str, list[dict[str, str]]] = {}
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            for filename in _FILES:
                key = filename.removesuffix(".txt")
                with archive.open(filename) as raw_file:
                    # utf-8-sig, not utf-8 — GTFS producers commonly
                    # prefix these CSVs with a BOM (confirmed against a
                    # live sample of this exact feed); utf-8 would leave
                    # it stuck on the first header name, silently
                    # breaking that one column's lookups everywhere.
                    text = io.TextIOWrapper(raw_file, encoding="utf-8-sig")
                    tables[key] = list(csv.DictReader(text))
                self.logger.info(f"Parsed {len(tables[key])} rows from {filename}")
        return tables
