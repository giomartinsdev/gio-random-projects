"""Contract tests for the normalizers -- these guard the dedupe engine's
inputs, so they encode the actual source formats observed in the spike
(floats from one source; strings like "8.834,07" from the other;
affiliate tags on both) rather than idealized ones.
"""

from datetime import UTC, datetime

from deals_common.normalize import canonical_url, normalize_title, parse_price_brl, to_utc


def test_parse_price_brl_known_source_formats():
    assert parse_price_brl(18.99) == 1899  # float-shipping source
    assert parse_price_brl(0) == 0  # free game, not None
    assert parse_price_brl("88,22") == 8822  # BRL comma decimal
    assert parse_price_brl("8.834,07") == 883_407  # thousands+decimal
    assert parse_price_brl("105,90") == 10590
    assert parse_price_brl("105.90") == 10590  # lone dot = decimal point
    assert parse_price_brl("8.834") == 883_400  # lone dot = thousands
    assert parse_price_brl("R$ 1.234,56") == 123_456
    assert parse_price_brl(None) is None
    assert parse_price_brl("") is None


def test_canonical_url_strips_affiliate_and_tracking_params():
    # One outbound link wears an Amazon Associates tag of the source's.
    tagged = canonical_url(
        "https://www.amazon.com.br/dp/B07FB4K8CJ?tag=tag-of-theirs&linkCode=ogi&th=1&psc=1"
    )
    assert tagged == "https://amazon.com.br/dp/B07FB4K8CJ"

    # A recents feed ships sourceUrl with a reshipper/ref.
    reffed = canonical_url(
        "https://www.magazineluiza.com.br/produto/1234?ref=feedsender&utm_source=feed"
    )
    assert reffed == "https://magazineluiza.com.br/produto/1234"

    # Real product params survive -- only tracking goes.
    assert (
        canonical_url("https://store.steampowered.com/app/570/Dota_2/?l=brazillian")
        == "https://store.steampowered.com/app/570/Dota_2/?l=brazillian"
    )


def test_canonical_url_keeps_query_when_all_params_are_content():
    assert canonical_url("https://mercadolivre.com.br/sec/2Xy?x=1") == "https://mercadolivre.com.br/sec/2Xy?x=1"


def test_normalize_title():
    assert normalize_title("  iPhone\t14\nPro  ") == "iPhone 14 Pro"
    assert normalize_title(None) == ""


def test_to_utc_handles_every_source_format():
    assert to_utc("2026-08-30T20:07:52.946Z").year == 2026  # ISO string
    assert to_utc(1756577600).tzinfo == UTC  # unix seconds
    assert to_utc("1674105580").tzinfo == UTC  # unix seconds as a string
    assert to_utc(None) is None