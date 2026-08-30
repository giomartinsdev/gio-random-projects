"""Discord delivery, driven by the event queue instead of scrape
results — the announce half of the pipeline the scrapers used to do
themselves (deals_common.discord's render, re-homed here).

A message is one POST per deal: Discord hard-caps a message's content
at 2000 chars, so "one batch of N deals" is a lie that turns into
N requests anyway — making that explicit keeps rate-limit handling
per-deal and retry logic honest.

Event-facing too: deal_from_event turns a domain.events.queue envelope
into the same RawDeal render consumes, so the announcer and the
scrapers speak one format.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from .model import RawDeal

log = logging.getLogger(__name__)

MAX_PER_FLUSH = 10


def brl(cents: int) -> str:
    text = f"{cents / 100:,.2f}"  # "1,234.56"
    return text.replace(",", "X").replace(".", ",").replace("X", ".")  # "1.234,56"


def render(deal: RawDeal) -> str:
    body = f"🔥 **{deal.title}**"
    if deal.price_cents is not None:
        line = f"R$ {brl(deal.price_cents)}"
        if deal.old_price_cents and deal.old_price_cents > deal.price_cents:
            off = round(100 * (deal.old_price_cents - deal.price_cents) / deal.old_price_cents)
            line += f" ~~R$ {brl(deal.old_price_cents)}~~ (-{off}%)"
        body += f"\n{line}"
    details = [part for part in (deal.store, deal.source) if part]
    if details:
        body += "\n🏪 " + " · ".join(details)
    return f"{body}\n{deal.url}"


def _parse_dt(value) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        return None


def deal_from_event(event: dict) -> tuple[RawDeal, datetime] | None:
    """Turn one domain event into (deal, occurred_at), or None when the
    payload doesn't carry what rendering needs.

    `event` is the queue envelope: {"event_name", "occurred_at",
    "payload"}, with payload matching the worker's deal.created shape.
    """
    payload = event.get("payload")
    if not isinstance(payload, dict):
        return None
    title, url = payload.get("title"), payload.get("url")
    if not title or not url:
        return None

    occurred_at = _parse_dt(event.get("occurred_at")) or datetime.now(tz=timezone.utc)
    deal = RawDeal(
        source=str(payload.get("source") or "?"),
        source_deal_id=str(payload.get("source_deal_id") or ""),
        title=str(title),
        url=str(url),
        store=payload.get("store"),
        price_cents=payload.get("price_cents"),
        old_price_cents=payload.get("old_price_cents"),
        posted_at=_parse_dt(payload.get("posted_at")),
        scraped_at=_parse_dt(payload.get("scraped_at")) or occurred_at,
        payload=payload.get("payload") if isinstance(payload.get("payload"), dict) else {},
    )
    return deal, occurred_at