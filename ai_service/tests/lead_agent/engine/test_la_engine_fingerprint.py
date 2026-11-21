"""fingerprint: platforms from concrete markers only, and size signals with quotes."""

from __future__ import annotations

import pytest

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.fingerprint import detect_platforms, parse_count, size_signals, size_tier
from app.services.lead_agent.engine.pagefetch import parse_page

SITE = "https://www.alpha-academy.in/"


def keys(html, text_links=None):
    record = parse_page(SITE, SITE, html, 200)
    if text_links:
        record["links"] = text_links
    return [p["key"] for p in detect_platforms([record])]


@pytest.mark.parametrize("html, expected", [
    ('<script src="https://cdn-wl-assets.classplus.co/build/app.js"></script>', ["classplus"]),
    ('<iframe src="https://alpha.teachmint.com/embed"></iframe>', ["teachmint"]),
    ('<link rel="stylesheet" href="https://assets.graphy.com/css/app.css">', ["graphy"]),
    ('<script src="https://web-in21.mxradon.com/t/Tracker.js"></script>', ["leadsquared"]),
    ('<script>var s="https://widgets.nopaperforms.com/emwgts.js";</script>', ["meritto"]),
    ('<script id="hs-script-loader" src="//js.hs-scripts.com/123.js"></script>', ["hubspot"]),
    ('<script>var $zoho=$zoho||{};$zoho.salesiq={widgetcode:"x"};</script>', ["zoho"]),
    ('<script src="https://wati-integration-service.wati.io/widget.js"></script>', ["wati"]),
    ('<script src="https://embed.tawk.to/abc/default"></script>', ["tawk"]),
    ('<script src="https://checkout.razorpay.com/v1/checkout.js"></script>', ["razorpay"]),
    ('<meta name="generator" content="WordPress 6.4"><script src="/wp-includes/js/jquery.js"></script>', ["wordpress"]),
    ('<img src="https://static.wixstatic.com/media/a.png">', ["wix"]),
    ('<div appx-version-id="2026-10-24"></div>', ["appx"]),
    ('<img src="https://appx-content-v2.classx.co.in/website_slider/1.png">', ["appx"]),
    ('<script src="/_next/static/chunks/main.js"></script>', ["nextjs"]),
])
def test_concrete_markers_name_the_platform(html, expected):
    assert keys(f"<html><head></head><body>{html}<p>Coaching</p></body></html>") == expected


def test_words_in_visible_text_are_never_a_platform():
    html = ("<html><body><p>Geography and graphy classes. Our director Mr. Inwati teaches. We compare Classplus and "
            "Teachmint in our blog. Hubspot of learning.</p><img src='https://geography.com/x.png'></body></html>")
    assert keys(html) == []


def test_powered_by_text_counts():
    assert keys("<html><body><footer>Powered by Graphy</footer></body></html>") == ["graphy"]
    assert keys("<html><body><footer>Developed & maintained by Atul Morchhlay</footer></body></html>") == []


def test_links_count_only_to_the_institutes_own_hosted_pages():
    mention = [("https://www.classplusapp.com/", "Classplus"), ("https://blog.teachmint.com/x", "read")]
    assert keys("<html><body><p>x</p></body></html>", mention) == []
    hosted = [("https://alphaacademy.classplusapp.com/", "Our app"), ("https://rzp.io/l/alpha-fees", "Pay fees")]
    assert keys("<html><body><p>x</p></body></html>", hosted) == ["classplus", "razorpay"]


def test_hints_saved_without_html_are_enough_and_raw_html_also_works():
    saved = {"url": SITE, "text": "", "links": [], "platform_hints": ["script:js.hs-scripts.com/123", "img:appx-wsb.x.in"]}
    found = detect_platforms([saved])
    assert [p["key"] for p in found] == ["appx", "hubspot"]  # course platforms and CRMs first
    assert found[0]["competitor"] and found[0]["evidence"] == "www.alpha-academy.in → Appx assets (appx-wsb.x.in)"
    raw = {"url": SITE, "text": "", "links": [], "html": '<html><script src="https://embed.tawk.to/a"></script></html>'}
    [tawk] = detect_platforms([raw])
    assert tawk["key"] == "tawk" and not tawk["competitor"] and tawk["kind"] == "chat"


# ------------------------------------------------------------------------------------------ size

@pytest.mark.parametrize("number, unit, value", [
    ("6", "M", 6_000_000), ("40", "Lac", 4_000_000), ("30", "k", 30_000), ("1,00,000", None, 100_000),
    ("2.5", "lakh", 250_000), ("1.2", "Cr", 12_000_000), ("12", None, 12),
])
def test_counts_are_read_in_indian_and_western_units(number, unit, value):
    assert parse_count(number, unit) == value


def _size(text, social=None):
    return size_signals([{"url": SITE, "text": text}], social or {})


def test_size_signals_quote_what_the_site_states():
    size = _size("Madhya Pradesh's Most Trusted Institute\n30k+\nTotal Selections\n6M+\nYouTube Subscribers\n"
                 "40Lac+\nApp Downloads\n8+\nYears of Service\nSince 2017\nCall 98450 12345")
    assert (size["youtube_subscribers"], size["app_downloads"], size["selections"]) == (6_000_000, 4_000_000, 30_000)
    assert size["students"] is None and size["branches"] is None and size["tier"] == "enterprise"
    assert {"field": "youtube_subscribers", "value": 6_000_000, "quote": "6M+ YouTube Subscribers", "url": SITE} in size["evidence"]


def test_students_and_branches():
    size = _size("Trusted by 1,00,000+ happy students across 12 branches in Rajasthan")
    assert (size["students"], size["branches"], size["tier"]) == (100_000, 12, "enterprise")
    assert _size("Students: 5,000+\nCentres: 4")["students"] == 5_000
    assert _size("Students: 5,000+\nCentres: 4")["tier"] == "mid"
    assert (_size("Students: 500\nCentres: 4")["branches"], _size("Students: 500\nCentres: 4")["students"]) == (4, 500)
    assert _size("We have 25+ centres")["branches"] == 25
    assert _size("Rated 5 stars by students")["students"] is None  # too small to be a size
    assert _size("Over 2.5 Lakh+ students trained")["tier"] == "enterprise"
    assert _size("25,000 students")["tier"] == "large" and _size("300 students")["tier"] == "small"


def test_single_tutors_are_micro_and_nothing_known_is_none():
    assert _size("Home tuition for classes 6-10 by an experienced teacher")["tier"] == "micro"
    assert _size("JEE and NEET coaching")["tier"] is None
    assert _size("Home tuition", {"youtube": {"url": "https://youtube.com/@x", "subscribers": 250_000}})["tier"] == "large"


def test_tier_thresholds():
    assert size_tier({"branches": 25}) == "enterprise" and size_tier({"branches": 8}) == "large"
    assert size_tier({"youtube_subscribers": 99_999}) == "mid" and size_tier({"app_downloads": 9_999}) == "small"
    assert size_tier({"selections": 20_000}) == "large"
