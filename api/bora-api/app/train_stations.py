"""Static, pre-geocoded SuperVia station reference data.

trensrj's own API has no coordinates for any station — only a
free-text address (see trensrj_client.py's module docstring) — so
data/train_stations.json is this system's only source of truth for
"how far is this station from the rider." Built once via a one-off
geocoding pass against each station's address (Nominatim, same
provider bora-api already uses for destination search); re-run only if
SuperVia adds/removes/renames a station, not on any regular cadence,
since station locations don't change.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel

_DATA_PATH = Path(__file__).parent / "data" / "train_stations.json"


class TrainStation(BaseModel):
    id: str
    name: str
    slug: str
    latitude: float
    longitude: float


@lru_cache(maxsize=1)
def load_train_stations() -> list[TrainStation]:
    with _DATA_PATH.open(encoding="utf-8") as f:
        rows = json.load(f)
    return [TrainStation.model_validate(row) for row in rows]
