"""Endpoint + mapping for the public offers API of source "phb".

Field names and formats checked against the live API in the spike
(2026-08-30): price/priceBasis are Brazilian strings ("88,22",
"8.834,07"), createdAt is unix seconds (shipped as a *string*), status
is the string "true", and the outbound url ships the source's own
Amazon Associates tag (the normalizer strips it -- links go out with
ours later, never theirs).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from deals_common.fetch import HttpClient
from deals_common.model import RawDeal
from deals_common.normalize import canonical_url, normalize_title, parse_price_brl, to_utc

log = logging.getLogger(__name__)

STATUS_TRUE = "true"


def base_url() -> str:
    """The polled source stays anonymous in the repo: no hostname in code,
    the value arrives via SOURCE_BASE_URL at deploy time (vault item)."""
    return os.environ["SOURCE_BASE_URL"].rstrip("/")


def fetch_recent(http: HttpClient, max_pages: int = 3) -> list[dict]:
    """Page forward until an empty page or max_pages."""
    offers: list[dict] = []
    for page in range(1, max_pages + 1):
        page_offers = http.get_json(f"{base_url()}/api/offers", {"page": str(page)}).get("offers", [])
        offers.extend(page_offers)
        if not page_offers:
            break
    return offers


def to_raw(offer: dict, scraped_at: datetime) -> RawDeal | None:
    """One /api/offers item -> RawDeal; None for anything not worth storing."""
    if offer.get("status") != STATUS_TRUE or not offer.get("id") or not offer.get("title"):
        return None

    price_cents = parse_price_brl(offer.get("price"))

    return RawDeal(
        source="phb",
        source_deal_id=str(offer["id"]),
        title=normalize_title(offer["title"]),
        url=canonical_url(offer.get("url") or ""),
        store=offer.get("store"),
        price_cents=price_cents,
        old_price_cents=parse_price_brl(offer.get("priceBasis")),
        posted_at=to_utc(offer.get("createdAt")),
        scraped_at=scraped_at,
        payload=offer,
    )