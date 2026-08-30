"""Endpoint + mapping for the public feed API of source "pld".

Field names and formats checked against the live API in the spike
(2026-08-30): temperature is the source's community score, sourceUrl
is the outbound store link (comes with a "ref=" of theirs), prices are
floats, and expired deals hide behind status != "active".

We take recents only: hottest/highlights are orderings of later
activity, and a fresh-deals worker wants recency -- the score layer
will compute its own heat from data it controls.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime

from deals_common.fetch import HttpClient
from deals_common.model import RawDeal
from deals_common.normalize import canonical_url, normalize_title, parse_price_brl, to_utc

log = logging.getLogger(__name__)

PAGE_LIMIT = 20
STATUS_ACTIVE = "active"


def base_url() -> str:
    """The polled source stays anonymous in the repo: no hostname in code,
    the value arrives via SOURCE_BASE_URL at deploy time (vault item)."""
    return os.environ["SOURCE_BASE_URL"].rstrip("/")


def fetch_recent(http: HttpClient, pages: int = 1) -> list[dict]:
    """Walk the recents cursor for a few pages -- 5s of API time each cycle."""
    deals: list[dict] = []
    after: str | None = None
    for _ in range(pages):
        params: dict[str, str] = {"limit": str(PAGE_LIMIT), "hideExpired": "true"}
        if after:
            params["after"] = after
        data = http.get_json(f"{base_url()}/feed/v2/recents", params).get("data", {})
        page_deals = data.get("deals", [])
        deals.extend(page_deals)
        page_info = data.get("pageInfo", {})
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
    return deals


def to_raw(deal: dict, scraped_at: datetime) -> RawDeal | None:
    """One feed item -> RawDeal; None for anything not worth storing."""
    if deal.get("status") != STATUS_ACTIVE or not deal.get("id") or not deal.get("title"):
        return None

    price_cents = parse_price_brl(deal.get("price"))
    old_price_cents = _old_price(deal, price_cents)

    return RawDeal(
        source="pld",
        source_deal_id=str(deal["id"]),
        title=normalize_title(deal["title"]),
        url=canonical_url(deal.get("sourceUrl") or deal.get("redirectUrl") or ""),
        store=(deal.get("store") or {}).get("name"),
        price_cents=price_cents,
        old_price_cents=old_price_cents,
        posted_at=to_utc(deal.get("firstApprovedAt") or deal.get("createdAt")),
        scraped_at=scraped_at,
        payload=deal,
    )


def _old_price(deal: dict, price_cents: int | None) -> int | None:
    """Reconstruct the pre-discount price the feed implies.

    The feed ships the discount instead of the base price; both
    directions are reversible to within a cent, which is plenty for
    display -- exact basis becomes real once we track price history
    ourselves.
    """
    if price_cents is None:
        return None
    if (fixed := deal.get("discountFixed")) is not None:
        return price_cents + parse_price_brl(fixed)
    if (pct := deal.get("discountPercentage")) is not None:
        if 0 < pct < 100:
            return int(round(price_cents * 100 / (100 - pct)))
    return None