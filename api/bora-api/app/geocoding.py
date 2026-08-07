"""Free-text destination search via OpenStreetMap's Nominatim —
bora-api's own external integration; the domain and gateway never need
to know it exists. No API key: Nominatim's public instance only asks
for an identifying User-Agent (see _USER_AGENT) and reasonable request
volume, both of which fit a personal project's traffic.
"""

from __future__ import annotations

import httpx
from pydantic import BaseModel

_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
# Rio de Janeiro city's own bounding box (lon_min, lat_min, lon_max,
# lat_max) — scopes free-text search to the one city this whole system
# covers, so e.g. "Copacabana" doesn't resolve to a same-named street
# somewhere else in Brazil.
_RIO_VIEWBOX = "-43.7955,-23.0821,-43.0980,-22.7469"
_USER_AGENT = "bora-api (+https://github.com/giomartinsdev/gio-random-projects)"


class GeocodeResult(BaseModel):
    name: str
    latitude: float
    longitude: float


class NominatimGeocoder:
    def __init__(self, client: httpx.Client | None = None) -> None:
        self._client = client or httpx.Client(timeout=10.0, headers={"User-Agent": _USER_AGENT})

    def search(self, query: str, limit: int) -> list[GeocodeResult]:
        response = self._client.get(
            _NOMINATIM_URL,
            params={
                "q": query,
                "format": "jsonv2",
                "limit": limit,
                "viewbox": _RIO_VIEWBOX,
                "bounded": 1,
            },
        )
        response.raise_for_status()
        return [
            GeocodeResult(
                name=row["display_name"], latitude=float(row["lat"]), longitude=float(row["lon"])
            )
            for row in response.json()
        ]
