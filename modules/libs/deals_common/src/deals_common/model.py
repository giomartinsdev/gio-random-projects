"""The one shape every scraper feeds into raw_deals.

`payload` keeps the source's own JSON verbatim so nobody ever has to
re-scrape to recover a field we didn't promote to a column today. The
dedupe/score engine reads the columns; the raw payload is insurance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class RawDeal:
    source: str  # short source code ("pld", "phb", ...) -- the ingesting worker's name
    source_deal_id: str  # the source's native id; (source, source_deal_id) is the upsert key
    title: str
    url: str  # canonicalized: tracking/affiliate params stripped
    store: str | None
    price_cents: int | None
    old_price_cents: int | None
    posted_at: datetime | None  # when the source published/approved the deal, UTC
    scraped_at: datetime  # when we saw it, UTC
    payload: dict[str, Any] = field(default_factory=dict, repr=False)