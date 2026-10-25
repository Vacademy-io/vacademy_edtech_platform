"""WiNNERS Institute (winnersinstitute.in), the 2026-10-25 review case.

Its admissions mobile is printed only on the contact page, under "Call us / Speak with our
admissions team"; the founder is named on the about page; an Instagram result prints the founder's
name next to the same number. The engine turned that snippet into a "direct" line to the founder.
The number must stay "likely" (a desk mobile), with the founder as the person to ask for.
"""

from __future__ import annotations

from datetime import date

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.discovery.search import SearchResult
from app.services.lead_agent.engine.errors import InvalidOutput
from app.services.lead_agent.engine.fingerprint import detect_platforms, size_signals
from app.services.lead_agent.engine.pagefetch import choose_pages, contact_pages, extraction_pages, parse_page
from app.services.lead_agent.engine.research.contact_search import lookup_contacts, merge_lookup
from app.services.lead_agent.engine.research.contacts import extract_contacts, rate_contact
from app.services.lead_agent.engine.research.lead import apply_rules, build_lead
from app.services.lead_agent.engine.schemas import AccountExtraction, ContactLookup
from app.services.lead_agent.engine.scoring import gate, score_lead

SITE = "https://www.winnersinstitute.in/"
NUMBER = "+91 90093 35533"

HOME_HTML = """<!doctype html><html><head><title>Best Coaching for MPPSC, SSC, Banking in Indore – WiNNERS Institute</title>
<script src="/_next/static/chunks/main-ae00dec8f5846b59.js"></script></head><body>
<nav><a href="/">Home</a><a href="https://live.winnersinstitute.in/">Student zone</a><a href="/apply">Apply Now</a>
<a href="/about-winners-institute">About</a><a href="/careers">Careers</a><a href="/contact">Contact</a>
<a href="https://live.winnersinstitute.in/courses/540-mppsc-mains">Courses</a><a href="https://live.winnersinstitute.in/">Login</a></nav>
<section><h1>Crack MPPSC, SSC &amp; Banking Exams with Expert Guidance</h1>
<p>Admissions open for the new online batches. Live and recorded online courses with unlimited online test series.</p>
<div><div><p>30k+</p><p>Total Selections</p></div><div><p>6M+</p><p>YouTube Subscribers</p></div>
<div><p>40Lac+</p><p>App Downloads</p></div><div><p>8+</p><p>Years of Service</p></div></div></section>
<footer><a href="https://www.instagram.com/thewinnersinstitute">Instagram</a>
<a href="https://www.youtube.com/@winnersinstitute">YouTube</a></footer></body></html>"""

CONTACT_HTML = """<html><head><title>Contact WiNNERS Institute – Get in Touch</title></head><body>
<h1>Contact WiNNERS Institute</h1>
<div><h3>Call us</h3><p>Speak with our admissions team</p><a href="tel:+919009335533">+91 90093 35533</a></div>
<div><h3>WhatsApp</h3><p>Get quick replies on our channel</p></div>
<div><h3>Visit us</h3><p>Indore, Madhya Pradesh</p></div>
<form><input name="name" placeholder="Enter your full name"/><input type="email" name="email"/><textarea name="message"></textarea>
<button>Send message</button></form></body></html>"""

ABOUT_HTML = """<html><head><title>About WiNNERS Institute</title></head><body>
<h2>About the Founder</h2>
<p>Aditya Patel is the Founder of the WiNNERS Institute with more than a decade of experience.</p>
<blockquote>WiNNERS - जहाँ ज़िद है सफलता की — Aditya Patel, Founder &amp; Director</blockquote></body></html>"""

PORTAL_HTML = """<html><head><link rel="icon" href="https://appx-wsb-gcp-mcdn.akamai.net.in/subject/2022-06-11-0.38.webp">
</head><body><div class="appx-version-id" appx-version-id="2026-10-24-15:53:30-201adb2"></div>
<img src="https://appx-content-v2.classx.co.in/website_slider/2026-10-16-0_26.jpeg"><p>Our courses</p></body></html>"""

INSTAGRAM = SearchResult(query="q", rank=1, title="WiNNERS Institute Indore (@winners_institute) - Instagram",
                         url="https://www.instagram.com/winners_institute/",
                         snippet="WiNNERS Institute Indore. Founder & Director Aditya Patel Sir. Admissions open, call +91 90093 35533")
LOOKUP_REPLY = ContactLookup.model_validate({"people": [{
    "result": 1, "name": "Aditya Patel", "role": "Founder & Director", "phone": NUMBER, "email": None,
    "quote": "Founder & Director Aditya Patel Sir. Admissions open, call +91 90093 35533"}]})


def _pages():
    home = {**parse_page(SITE, SITE, HOME_HTML, 200), "page_type": "home"}
    contact = {**parse_page(SITE + "contact", SITE + "contact", CONTACT_HTML, 200), "page_type": "contact"}
    about = {**parse_page(SITE + "about-winners-institute", SITE + "about-winners-institute", ABOUT_HTML, 200),
             "page_type": "about"}
    return home, contact, about


def _extraction():
    return AccountExtraction.model_validate({
        "organisation_name": "WiNNERS Institute", "is_target_segment": True,
        "what_they_do": "Coaching for MPPSC, SSC and banking exams in Indore, online and offline.", "city": "Indore",
        "branches": [], "current_software": [], "unknowns": [], "discovery_question": "", "summary": "",
        "signals": [
            {"signal": "admissions_open", "observation": "Admissions open", "event_date": None,
             "cite": {"page": 1, "quote": "Admissions open for the new online batches"}},
            {"signal": "online_courses", "observation": "Online courses", "event_date": None,
             "cite": {"page": 1, "quote": "Live and recorded online courses"}},
            {"signal": "test_series", "observation": "Test series", "event_date": None,
             "cite": {"page": 1, "quote": "unlimited online test series"}},
        ],
        "people": [{"name": "Aditya Patel", "role": "Founder & Director",
                    "cite": {"page": 3, "quote": "Aditya Patel, Founder & Director"}}],
    })


def _lead():
    pages = list(_pages())
    contacts = extract_contacts(contact_pages(pages), "winnersinstitute.in", "India")
    return build_lead(name="WiNNERS Institute", website=SITE, domain="winnersinstitute.in", extraction=_extraction(),
                      pages=extraction_pages(pages), contacts=contacts, products=["complete_vacademy"],
                      buyer_roles=["founder", "director"], country="India")


def _number(lead):
    return next(c for c in lead["contacts"] if c["value"] == NUMBER and c["kind"] == "institute_phone")


def test_the_website_alone_rates_the_admissions_mobile_likely():
    lead = _lead()
    phone = _number(lead)
    assert phone["seen_on"] == 1 and "admissions team" in phone["context"]
    assert phone["quality"] == "likely"
    assert lead["decision_maker"]["name"] == "Aditya Patel"
    assert lead["contact_quality"]["label"] == "Desk mobile / WhatsApp: ask for Aditya Patel"


def test_a_search_result_naming_the_founder_does_not_make_the_desk_mobile_direct():
    lead = _lead()
    found = lookup_contacts(lead, place="Indore", country="India", search=lambda q: [INSTAGRAM],
                            ask=lambda system, user, model: LOOKUP_REPLY)
    assert [c["value"] for c in found["contacts"]] == [NUMBER]  # the lookup did find the number by the name
    merged = apply_rules(merge_lookup(lead, found), ["complete_vacademy"], ["founder", "director"])
    phone = _number(merged)
    assert phone["quality"] == "likely"
    assert "person" not in phone and phone["ask_for"]["name"] == "Aditya Patel"
    assert phone["quality_note"] == ("Desk mobile / ask for Aditya Patel (Founder & Director); "
                                     "a web result shows them with this number")
    assert merged["contact_quality"]["level"] == "likely"
    assert "ask for Aditya Patel" in merged["contact_quality"]["label"]
    assert any(e["field"].startswith("Who to ask for") for e in merged["evidence"])


def test_a_number_found_only_in_a_search_result_next_to_the_name_can_be_direct():
    lead = _lead()
    other = SearchResult(query="q", rank=1, title="WiNNERS Institute Indore - Founder", url="https://www.facebook.com/x",
                         snippet="WiNNERS Institute Indore. Founder & Director Aditya Patel: 98260 12345")
    reply = ContactLookup.model_validate({"people": [{
        "result": 1, "name": "Aditya Patel", "role": "Founder & Director", "phone": "98260 12345", "email": None,
        "quote": "Founder & Director Aditya Patel: 98260 12345"}]})
    found = lookup_contacts(lead, place="Indore", country="India", search=lambda q: [other],
                            ask=lambda system, user, model: reply)
    merged = apply_rules(merge_lookup(lead, found), ["complete_vacademy"], ["founder", "director"])
    new = next(c for c in merged["contacts"] if c["value"] == "+91 98260 12345")
    assert new["quality"] == "direct" and new["person"]["name"] == "Aditya Patel"
    assert merged["contact_quality"]["level"] == "direct"
    assert _number(merged)["quality"] == "likely"  # the desk mobile is unchanged


def test_a_lead_merged_before_the_fix_is_read_the_same_way():
    """Saved contacts with person + linked_by on a desk line (the engine's merge) rate likely, not direct."""
    legacy = {"kind": "institute_phone", "value": NUMBER, "url": SITE + "contact", "note": "mobile", "seen_on": 1,
              "context": "Speak with our admissions team +91 90093 35533",
              "person": {"name": "Aditya Patel", "role": "Founder & Director"}, "person_quote": "q",
              "confirmed_by": INSTAGRAM.url, "linked_by": "web search (instagram.com)"}
    tier, note = rate_contact(legacy, site_domain="winnersinstitute.in", organisation="WiNNERS Institute",
                              leaders={"Aditya Patel"}, large_chain=False, region="IN")
    assert tier == "likely" and note.startswith("Desk mobile / ask for Aditya Patel")


def test_an_unusable_lookup_reply_keeps_the_website_contacts():
    def broken(system, user, model):
        raise InvalidOutput("cut off")

    assert lookup_contacts(_lead(), place="Indore", country="India", search=lambda q: [INSTAGRAM], ask=broken) == {
        "people": [], "contacts": []}


def test_winners_runs_on_appx_is_enterprise_sized_and_goes_to_review():
    home, contact, about = _pages()
    chosen = choose_pages(home)
    assert chosen == [(SITE + "contact", "contact"), (SITE + "about-winners-institute", "about"),
                      (SITE + "careers", "careers"), ("https://live.winnersinstitute.in/", "platform")]
    portal = {**parse_page("https://live.winnersinstitute.in/", "https://live.winnersinstitute.in/", PORTAL_HTML, 200),
              "page_type": "platform"}
    platforms = detect_platforms([home, contact, about, portal])
    appx = next(p for p in platforms if p["key"] == "appx")
    assert appx["competitor"] and appx["kind"] == "lms" and appx["url"] == "https://live.winnersinstitute.in/"
    assert appx["evidence"].startswith("live.winnersinstitute.in → Appx")
    size = size_signals([home], {})
    assert (size["youtube_subscribers"], size["app_downloads"], size["selections"]) == (6_000_000, 4_000_000, 30_000)
    assert size["tier"] == "enterprise"

    lead = _lead()
    found = lookup_contacts(lead, place="Indore", country="India", search=lambda q: [INSTAGRAM],
                            ask=lambda system, user, model: LOOKUP_REPLY)
    lead = apply_rules(merge_lookup(lead, found), ["complete_vacademy"], ["founder", "director"])
    brief = {"products": ["complete_vacademy"], "markets": [{"country": "India", "state": "Madhya Pradesh", "city": "Indore"}],
             "must_have": ["offers online courses"]}
    scored = score_lead(lead, brief, platforms, size, today=date(2026, 10, 25))
    assert "competitor_platform:appx" in scored["flags"] and "enterprise" in scored["flags"]
    decision, reasons = gate(scored, lead, {"auto_score": 70, "review_score": 45, "min_contact": "likely"})
    assert decision == "REVIEW"
    assert any("Appx" in r or "appx" in r for r in reasons) and any("large" in r.lower() for r in reasons)
