"""Mapping tests against a real /api/offers item pulled in the spike
(2026-08-30) -- trimmed, but the fields that matter kept verbatim,
including Brazilian price strings and the source's own affiliate tag.
"""

from datetime import UTC, datetime

from phb_scraper.client import to_raw

SCRAPED_AT = datetime(2026, 8, 30, 20, 15, tzinfo=UTC)

OFFER = {
    "id": "1",
    "title": "Ducha Futura Multitemperaturas 127V, 5500W, Lorenzetti 7531280, Branco",
    "description": "A melhor comunidade de promoções do Brasil!",
    "price": "88,22",
    "priceBasis": "105,90",
    "parcels": "",
    "coupon": "",
    "tag": "some-tag-20",
    "createdAt": "1674105580",
    "image": "https://d10aktedg4flw1.cloudfront.net/offers/images/x.jpeg",
    "url": "https://www.amazon.com.br/dp/B07FB4K8CJ?tag=some-tag-20&linkCode=ogi&th=1&psc=1",
    "store": "AMAZON",
    "category": "geral",
    "freeShipping": "true",
    "status": "true",
    "formattedMessage": "*Ducha...*",
}


def test_maps_an_active_offer():
    raw = to_raw(OFFER, SCRAPED_AT)
    assert raw is not None
    assert raw.source == "phb"
    assert raw.source_deal_id == "1"
    assert raw.price_cents == 8822
    assert raw.old_price_cents == 10590
    assert raw.url == "https://amazon.com.br/dp/B07FB4K8CJ"  # their tag stripped
    assert raw.store == "AMAZON"
    assert raw.posted_at == datetime.fromtimestamp(1674105580, tz=UTC)
    assert raw.payload == OFFER


def test_skips_inactive_and_incomplete():
    assert to_raw(OFFER | {"status": "false"}, SCRAPED_AT) is None
    assert to_raw(OFFER | {"title": None}, SCRAPED_AT) is None