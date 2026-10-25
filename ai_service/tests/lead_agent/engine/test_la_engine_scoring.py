"""Lead score and gate (spec §3): being a coaching institute is not enough for auto-delivery."""

from __future__ import annotations

from datetime import date

import pytest

import la_engine_fixtures  # noqa: F401 - puts ai_service on sys.path

from app.services.lead_agent.engine.research.catalogue import score_products
from app.services.lead_agent.engine.research.contacts import Contact
from app.services.lead_agent.engine.research.extract import PageText
from app.services.lead_agent.engine.research.lead import build_lead
from app.services.lead_agent.engine.schemas import AccountExtraction
from app.services.lead_agent.engine.scoring import DEFAULT_GATE, gate, score_lead, signal_age_days

TODAY = date(2026, 10, 25)
SITE = "https://www.alpha-academy.in/"
BRIEF = {"products": ["complete_vacademy"], "hiring_roles": ["telecaller"], "buyer_roles": ["founder"],
         "markets": [{"country": "India", "state": "Rajasthan", "city": "Jaipur"}],
         "must_have": ["offers online courses"], "deal_breakers": ["schools"], "exclude": ["Schools & playschools"]}


def _extraction(signals, people=(), **overrides):
    values = {"organisation_name": "Alpha Academy", "is_target_segment": True,
              "what_they_do": "JEE and NEET coaching in Jaipur.", "city": "Jaipur", "branches": [],
              "signals": list(signals), "people": list(people), "current_software": [], "unknowns": [],
              "discovery_question": "", "summary": ""}
    values.update(overrides)
    return AccountExtraction.model_validate(values)


def _signal(key, quote, page=1, date=None):
    return {"signal": key, "observation": quote, "event_date": date, "cite": {"page": page, "quote": quote}}


TYPICAL_HOME = ("Alpha Academy, Jaipur\nAdmissions open for 2026-27\nSend us your enquiry\nCall us now for a free "
                "counselling session\nOffice: 0141 456 7890")
TYPICAL_SIGNALS = [_signal("admissions_open", "Admissions open for 2026-27"),
                   _signal("enquiry_forms", "Send us your enquiry"),
                   _signal("high_call_volume", "Call us now for a free counselling session")]


def _lead(pages, contacts, signals, people=(), external=None, products=("complete_vacademy",), **extraction):
    return build_lead(name="Alpha Academy", website=SITE, domain="alpha-academy.in",
                      extraction=_extraction(signals, people, **extraction), pages=pages,
                      contacts=[Contact(*c) for c in contacts], products=list(products), buyer_roles=["founder"],
                      external_signals=external, hiring_roles=["telecaller"], country="India")


def test_a_typical_coaching_site_with_only_a_landline_is_not_auto_delivered():
    pages = [PageText(1, SITE, "home", "Alpha", TYPICAL_HOME)]
    lead = _lead(pages, [("institute_phone", "+91 141 456 7890", SITE, "landline")], TYPICAL_SIGNALS)
    # The engine's own rules call this qualified (CRM 62 > 40) ...
    assert score_products(["crm"], {"admissions_open", "enquiry_forms", "high_call_volume"})[0].score >= 40
    assert lead["contact_quality"]["level"] == "general"
    scored = score_lead(lead, BRIEF, [], {"tier": None}, today=TODAY)
    decision, reasons = gate(scored, lead, DEFAULT_GATE)
    # ... but with no buying signal and only a reception line it is never delivered on its own.
    assert decision != "AUTO" and scored["score"] < DEFAULT_GATE["auto_score"]
    assert not scored["has_intent"] and scored["intent"] == 0
    assert decision == "REJECT" and "below the review bar" in reasons[0]


def test_a_small_institute_hiring_telecallers_now_with_a_desk_mobile_and_its_founder_is_auto():
    pages = [PageText(1, SITE, "home", "Alpha",
                      "Alpha Academy, Jaipur\nAdmissions open for 2026-27\nSend us your enquiry\n"
                      "Live online classes and recorded online courses for JEE"),
             PageText(2, SITE + "contact", "contact", "Contact", "Call us\n98450 12345"),
             PageText(3, SITE + "about", "about", "About", "Meena Iyer, Founder & Director")]
    hiring = [{"key": "hiring", "label": "Hiring telecaller", "direct": True, "value": "Telecaller",
               "event_date": "12 days ago", "quote": "Alpha Academy is hiring telecallers", "external": True,
               "url": "https://www.naukri.com/job-listings-telecaller-alpha-academy-1", "source": "Hiring posts"}]
    founder = [{"name": "Meena Iyer", "role": "Founder & Director", "cite": {"page": 3, "quote": "Meena Iyer, Founder & Director"}}]
    signals = [_signal("admissions_open", "Admissions open for 2026-27"), _signal("enquiry_forms", "Send us your enquiry"),
               _signal("online_courses", "Live online classes and recorded online courses")]
    from app.services.lead_agent.engine.research.contacts import extract_contacts

    contacts = extract_contacts([{"url": p.url, "text": p.text, "links": [], "has_form": p.id == 1,
                                  "page_type": p.page_type} for p in pages], "alpha-academy.in", "India")
    lead = build_lead(name="Alpha Academy", website=SITE, domain="alpha-academy.in",
                      extraction=_extraction(signals, founder), pages=pages, contacts=contacts,
                      products=["complete_vacademy"], buyer_roles=["founder"], external_signals=hiring,
                      hiring_roles=["telecaller"], country="India")
    assert lead["contact_quality"]["label"] == "Desk mobile / WhatsApp: ask for Meena Iyer"
    scored = score_lead(lead, BRIEF, [], {"tier": "small"}, today=TODAY)
    assert scored["has_intent"] and scored["intent"] >= 80  # dated within 60 days: boosted
    assert scored["reach"] == 70 and scored["flags"] == []
    decision, reasons = gate(scored, lead, {"auto_score": 70, "review_score": 45, "min_contact": "likely",
                                            "require_intent": False})
    assert decision == "AUTO", (scored, reasons)
    assert scored["products"][0]["key"] == "complete_vacademy" and scored["products"][0]["score"] >= 50
    # A stricter list waits for a person instead.
    assert gate(scored, lead, {"min_contact": "direct"})[0] == "REVIEW"
    # The same post a year old counts for much less and is not a buying signal any more.
    stale = {**lead, "signals": [{**s, "event_date": "14 months ago"} if s["key"] == "hiring" else s
                                 for s in lead["signals"]]}
    old = score_lead(stale, BRIEF, [], {"tier": "small"}, today=TODAY)
    assert old["intent"] < scored["intent"] / 2 and not old["has_intent"]
    assert gate(old, stale, {"require_intent": True})[0] == "REVIEW"


def test_no_usable_contact_is_rejected_whatever_the_score():
    pages = [PageText(1, SITE, "home", "Alpha", TYPICAL_HOME)]
    lead = _lead(pages, [("contact_form", SITE, SITE, "enquiry form on the home page")], TYPICAL_SIGNALS)
    assert lead["contact_quality"]["level"] == "none"
    scored = score_lead(lead, BRIEF, [], {}, today=TODAY)
    assert "no_contact" in scored["flags"]
    decision, reasons = gate({**scored, "score": 99}, lead, DEFAULT_GATE)
    assert decision == "REJECT" and reasons[0].startswith("No usable contact")


def test_hard_rejects_for_kind_segment_and_deal_breakers():
    pages = [PageText(1, SITE, "home", "Peepal", "Peepal Prodigy School, Jaipur\nAdmissions open for 2026-27")]
    contacts = [("institute_phone", "+91 98450 12345", SITE, "mobile")]
    school = build_lead(name="Peepal Prodigy School", website=SITE, domain="peepal.in",
                        extraction=_extraction([_signal("admissions_open", "Admissions open for 2026-27")],
                                               organisation_name="Peepal Prodigy School", is_target_segment=False,
                                               what_they_do="CBSE school"),
                        pages=pages, contacts=[Contact(*c) for c in contacts], products=["complete_vacademy"],
                        buyer_roles=[])
    scored = score_lead(school, BRIEF, [], {}, today=TODAY)
    assert {"not_target_segment", "excluded_kind:Schools & playschools", "deal_breaker:schools"} <= set(scored["flags"])
    assert gate(scored, school, DEFAULT_GATE)[0] == "REJECT"
    # A coaching institute teaching school students is not a school.
    coaching = _lead([PageText(1, SITE, "home", "Alpha", "Coaching for school students")], contacts,
                     [], what_they_do="Coaching for school students in Jaipur")
    assert not any(f.startswith(("deal_breaker", "excluded_kind")) for f in score_lead(coaching, BRIEF, [], {})["flags"])


def test_an_unreadable_site_is_rejected():
    job_only = [PageText(1, "https://apna.co/job/1", "job_post", "Telecaller", "Alpha Academy hiring telecaller")]
    lead = _lead(job_only, [("institute_phone", "+91 98450 12345", "https://apna.co/job/1", "mobile")], [])
    scored = score_lead(lead, BRIEF, [], {})
    assert "site_unreadable" in scored["flags"] and gate(scored, lead, DEFAULT_GATE)[0] == "REJECT"


def test_competitor_enterprise_and_micro_carry_risk():
    pages = [PageText(1, SITE, "home", "Alpha", TYPICAL_HOME)]
    lead = _lead(pages, [("institute_phone", "+91 98450 12345", SITE, "mobile")], TYPICAL_SIGNALS)
    plain = score_lead(lead, BRIEF, [], {}, today=TODAY)
    classplus = [{"key": "classplus", "name": "Classplus", "kind": "lms", "competitor": True, "evidence": "x", "url": SITE},
                 {"key": "razorpay", "name": "Razorpay", "kind": "payments", "competitor": False, "evidence": "y", "url": SITE}]
    flagged = score_lead(lead, BRIEF, classplus, {"tier": "micro", "micro_hint": "home tuition"}, today=TODAY)
    assert flagged["risk"] == 40 + 25 and abs(flagged["score"] - (plain["score"] - 0.5 * 65)) <= 1
    assert flagged["flags"] == ["competitor_platform:classplus", "micro"]
    _, reasons = gate({**flagged, "score": 80}, lead, DEFAULT_GATE)
    assert any("Classplus" in r for r in reasons)  # flagged leads are never AUTO


@pytest.mark.parametrize("written, days", [
    ("3 days ago", 3), ("Posted 2 weeks ago", 14), ("a month ago", 30), ("30+ days ago", 30), ("today", 0),
    ("yesterday", 1), ("24 September 2026", 31), ("24th Sep 2026", 31), ("2026-10-03", 22), ("Sep 2026", 40),
    ("1 Nov 2026", 0), ("2026-27", None), (None, None),
])
def test_signal_dates_are_read_as_written(written, days):
    assert signal_age_days(written, TODAY) == days
