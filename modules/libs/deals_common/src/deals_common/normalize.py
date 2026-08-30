"""Normalizers shared by every source.

Three jobs:
- parse_price_brl: the sources disagree on price format (floats from
  one, Brazilian strings like "8.834,07" from the other); the DB wants
  integer cents.
- canonical_url: offers arrive wearing each source's affiliate tags
  ("tag=...&linkCode=...") and reshipper refs ("ref="). The dedupe
  engine must match the same store offer from both sources, so
  tracking params are stripped and the store's own product URL is
  what gets stored. We'll re-monetize links ourselves later with our
  own affiliate -- never keep a third party's.
- helpers: title whitespace, UTC timestamps.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# Query params that are pure tracking/affiliate: dropped from every
# offer URL. "tag" alone is Amazon Associates' id param -- sources
# embed theirs; ours will go in at publish time, not storage time.
_TRACK_PARAMS = {
    "tag", "ref", "linkcode", "th", "psc", "ascsubtag", "associatetag",
    "gclid", "fbclid", "mcn", "msclkid", "twclid", "igshid", "ref_",
}
_TRACK_PARAM_PREFIXES = ("utm_", "pf_rd_", "promo_", "yclid", "vbref")

# "1.234.567" / "8.834": dot as strict thousands separator (groups of 3)
_THOUSANDS = re.compile(r"\d{1,3}(\.\d{3})+$")


def parse_price_brl(value: str | float | int | None) -> int | None:
    """R$/BR-formatted money -> integer cents. None stays None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(round(float(value) * 100))

    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace("R$", "").replace(" ", " ").strip()
    if not text:
        return None
    text = re.sub(r"\s+", "", text)

    if "," in text:
        # "8.834,07" / "88,22" -- dot is thousands, comma is decimal.
        whole, _, frac = text.partition(",")
        digits = f"{whole.replace('.', '')}.{frac or '0'}"
    elif _THOUSANDS.fullmatch(text):
        digits = text.replace(".", "")
    else:
        # "105.90" and friends: a lone dot the other way around is a
        # decimal point (float-shipping sources arrive as "18.99" here too).
        digits = text
    return int(round(float(digits) * 100))


def canonical_url(url: str) -> str:
    parsed = urlparse(url)
    scheme = "https"
    netloc = parsed.netloc.lower().removeprefix("www.")

    kept: list[tuple[str, str]] = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=False):
        if key.lower() in _TRACK_PARAMS or any(
            key.lower().startswith(prefix) for prefix in _TRACK_PARAM_PREFIXES
        ):
            continue
        kept.append((key, value))

    query = urlencode(kept)
    return urlunparse((scheme, netloc, parsed.path or "/", "", query, ""))


def normalize_title(title: str | None) -> str:
    if not title:
        return ""
    text = unicodedata.normalize("NFKC", title)
    return re.sub(r"\s+", " ", text).strip()


def to_utc(ts: datetime | float | int | str | None) -> datetime | None:
    """Sources use ISO strings and unix seconds; raw_deals wants aware UTC."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.replace(tzinfo=ts.tzinfo or UTC).astimezone(UTC)
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=UTC)
    text = str(ts).strip()
    if text.isdigit():  # one source ships unix seconds as *strings* ("1674105580")
        return datetime.fromtimestamp(int(text), tz=UTC)
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return parsed.astimezone(UTC) if parsed.tzinfo else parsed.replace(tzinfo=UTC)