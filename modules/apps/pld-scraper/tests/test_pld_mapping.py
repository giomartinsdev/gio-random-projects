"""Mapping tests against a real feed item pulled in the spike
(2026-08-30) -- trimmed, but the fields that matter kept verbatim.
"""

from datetime import UTC, datetime

from pld_scraper.client import to_raw

SCRAPED_AT = datetime(2026, 8, 30, 20, 15, tzinfo=UTC)

DEAL = {
    "id": "66462ef8-3872-4016-83c7-12b1797e09e1",
    "slug": "rec-papel-higienico-vip-folha-tripla-12-rolos-54c8",
    "title": "[REC] Papel Higiênico Vip Folha Tripla 12 Rolos",
    "temperature": 21,
    "price": 18.99,
    "discountPercentage": None,
    "discountFixed": None,
    "status": "active",
    "createdAt": "2026-08-30T20:07:52.946Z",
    "firstApprovedAt": "2026-08-30T20:07:53.564Z",
    "store": {"id": "367", "name": "Amazon", "slug": "amazon"},
    "sourceUrl": "https://www.amazon.com.br/dp/B0C4CFDJVJ?ref=cm_sw_r_apan_dp_QWERTY",
    "kind": "product",
    "commentCount": 0,
    "userVote": None,
    "lastComment": None,
}


def test_maps_a_fresh_active_deal():
    raw = to_raw(DEAL, SCRAPED_AT)
    assert raw is not None
    assert raw.source == "pld"
    assert raw.source_deal_id == "66462ef8-3872-4016-83c7-12b1797e09e1"
    assert raw.title == "[REC] Papel Higiênico Vip Folha Tripla 12 Rolos"
    assert raw.price_cents == 1899
    assert raw.url == "https://amazon.com.br/dp/B0C4CFDJVJ"  # resshipper ref= stripped
    assert raw.store == "Amazon"
    assert raw.posted_at == datetime(2026, 8, 30, 20, 7, 53, 564000, tzinfo=UTC)
    assert raw.payload == DEAL


def test_skips_inactive_and_incomplete():
    assert to_raw(DEAL | {"status": "expired"}, SCRAPED_AT) is None
    assert to_raw(DEAL | {"id": None}, SCRAPED_AT) is None


def test_reconstructs_old_price_from_percentage():
    raw = to_raw(DEAL | {"discountPercentage": 40, "price": 99.0}, SCRAPED_AT)
    assert raw is not None
    assert raw.price_cents == 9900
    assert raw.old_price_cents == 16500