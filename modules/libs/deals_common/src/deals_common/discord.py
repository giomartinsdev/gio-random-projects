"""Discord delivery for fresh deals.

Same philosophy as post-api's announcer (lib/announcer.ts there): a
webhook URL is the whole integration, and a blank env simply disables
it. Announce-only -- a failed webhook never re-fires an older deal,
because the caller only hands over deals that were INSERTED this cycle
(an already-stored deal is never "new" again). Missed announcements
are acceptable noise, not worth persistent state.

stdlib-only on purpose: one POST per deal needs neither a library nor
async.
"""

from __future__ import annotations

import json
import logging
import urllib.request

from .model import RawDeal

log = logging.getLogger(__name__)

MAX_PER_CYCLE = 10


def _brl(cents: int) -> str:
    text = f"{cents / 100:,.2f}"  # "1,234.56"
    return text.replace(",", "X").replace(".", ",").replace("X", ".")  # "1.234,56"


def _render(deal: RawDeal) -> str:
    body = f"🔥 **{deal.title}**"
    if deal.price_cents is not None:
        line = f"R$ {_brl(deal.price_cents)}"
        if deal.old_price_cents and deal.old_price_cents > deal.price_cents:
            off = round(100 * (deal.old_price_cents - deal.price_cents) / deal.old_price_cents)
            line += f" ~~R$ {_brl(deal.old_price_cents)}~~ (-{off}%)"
        body += f"\n{line}"
    details = [part for part in (deal.store, deal.source) if part]
    if details:
        body += "\n🏪 " + " · ".join(details)
    return f"{body}\n{deal.url}"


def announce(webhook_url: str, deals: list[RawDeal]) -> int:
    """Post up to MAX_PER_CYCLE, oldest first; returns the sent count."""
    if not webhook_url or not deals:
        return 0

    sent = 0
    for deal in sorted(deals, key=lambda d: d.posted_at or d.scraped_at)[:MAX_PER_CYCLE]:
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps({"content": _render(deal)}).encode("utf-8"),
            headers={"content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                if 200 <= res.status < 300:
                    sent += 1
        except Exception as err:  # webhook wobble shouldn't kill the rest
            log.warning("discord announce failed for %s: %s", deal.source_deal_id, err)
    return sent