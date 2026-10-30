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
from app.services.lead_agent.engine.scoring import DEFAULT_GATE, gate, score_lead, send_bar, signal_age_days

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
    # ... but with no buying signal and only a reception line it is never sent.
    assert decision == "REJECT" and scored["score"] < DEFAULT_GATE["send_score"]
    assert not scored["has_intent"] and scored["intent"] == 0
    assert reasons == [f"Score {scored['score']} is below the send bar (50)"]


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
    decision, reasons = gate(scored, lead, {"send_score": 50, "min_contact": "likely", "require_intent": False})
    assert decision == "AUTO", (scored, reasons)
    assert reasons == [f"Score {scored['score']} meets the send bar (50) with a likely contact"]
    assert scored["products"][0]["key"] == "complete_vacademy" and scored["products"][0]["score"] >= 50
    # A stricter list does not send it; one that approves every lead shows it to a person instead.
    assert gate(scored, lead, {"min_contact": "direct"}) == (
        "REJECT", ["Best contact is likely; this list needs at least direct"])
    assert gate(scored, lead, {"min_contact": "direct", "require_approval": True})[0] == "REVIEW"
    # The same post a year old counts for much less and is not a buying signal any more.
    stale = {**lead, "signals": [{**s, "event_date": "14 months ago"} if s["key"] == "hiring" else s
                                 for s in lead["signals"]]}
    old = score_lead(stale, BRIEF, [], {"tier": "small"}, today=TODAY)
    assert old["intent"] < scored["intent"] / 2 and not old["has_intent"]
    assert gate(old, stale, {"require_intent": True, "send_score": 0}) == (
        "REJECT", ["No buying signal, and this list requires one"])
    assert gate(old, stale, {"require_intent": True, "send_score": 0, "require_approval": True})[0] == "REVIEW"


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
    # The risk ranks the lead lower and the reject says why; it no longer holds a lead back (2026-10-30).
    decision, reasons = gate(flagged, lead, DEFAULT_GATE)
    assert decision == "REJECT" and reasons[0] == f"Score {flagged['score']} is below the send bar (50)"
    assert any("Classplus" in r for r in reasons) and "Single tutor or home tuition" in reasons
    assert gate({**flagged, "score": 80}, lead, DEFAULT_GATE)[0] == "AUTO"


def test_a_list_can_take_competitor_users_without_review():
    pages = [PageText(1, SITE, "home", "Alpha", TYPICAL_HOME)]
    lead = _lead(pages, [("institute_phone", "+91 98450 12345", SITE, "mobile")], TYPICAL_SIGNALS)
    classplus = [{"key": "classplus", "name": "Classplus", "kind": "lms", "competitor": True, "evidence": "x", "url": SITE}]
    flagged = score_lead(lead, BRIEF, classplus, {}, today=TODAY)
    assert flagged["flags"] == ["competitor_platform:classplus"] and flagged["risk"] == 40
    bars = {"send_score": flagged["base_score"], "min_contact": "likely"}
    decision, reasons = gate(flagged, lead, bars)              # by default the competitor's penalty counts
    assert decision == "REJECT" and any("Classplus" in r for r in reasons)
    decision, reasons = gate(flagged, lead, {**bars, "auto_competitor_users": True})
    assert decision == "AUTO", reasons                          # judged without the competitor penalty
    assert reasons[0].startswith(f"Score {flagged['base_score']} ") and "competitor" in reasons[1]
    # the other risks still count: a single tutor or a very large organisation scores below the same bar
    micro = score_lead(lead, BRIEF, classplus, {"tier": "micro", "micro_hint": "home tuition"}, today=TODAY)
    decision, reasons = gate(micro, lead, {**bars, "auto_competitor_users": True})
    assert decision == "REJECT" and reasons[1:] == ["Single tutor or home tuition"]  # Classplus is not held against it
    big = score_lead(lead, BRIEF, classplus, {"tier": "enterprise"}, today=TODAY)
    assert gate(big, lead, {**bars, "auto_competitor_users": True})[0] == "REJECT"
    assert gate(big, lead, {"send_score": 0, "auto_competitor_users": True})[0] == "AUTO"  # ranked, never held


# ------------------------------------------------------------------ rank and fill: one send bar (2026-10-30)
# Prod 2026-10-30: quotas of 100-200 a day, but a lead without a buying signal could hardly pass the auto
# bar (70); everything from 45 to 69 waited in REVIEW, which nobody works on (about 820 leads; Voomsales
# 14 delivered, 214 in REVIEW in two days). Now one bar: at or above it a lead is sent, best first.

LIKELY = {"contact_quality": {"level": "likely"}}
GENERAL = {"contact_quality": {"level": "general"}}


def _scored(score, flags=(), *, base=None, risk=0, has_intent=False, level="likely"):
    return {"score": score, "base_score": score if base is None else base, "risk": risk, "flags": list(flags),
            "has_intent": has_intent, "reach_level": level}


def test_one_send_bar_sends_at_or_above_it_and_rejects_below():
    assert gate(_scored(50), LIKELY, {"send_score": 50}) == (
        "AUTO", ["Score 50 meets the send bar (50) with a likely contact"])
    assert gate(_scored(49), LIKELY, {"send_score": 50}) == ("REJECT", ["Score 49 is below the send bar (50)"])
    assert gate(_scored(62), LIKELY, DEFAULT_GATE)[0] == "AUTO"  # the old gate parked 45-69 in REVIEW
    assert gate(_scored(0), LIKELY, {"send_score": 0})[0] == "AUTO"


def test_an_agent_saved_before_send_score_gets_the_default_bar_and_its_old_bars_are_ignored():
    old_agent = {"auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False,
                 "auto_competitor_users": False}
    assert gate(_scored(55), LIKELY, old_agent)[0] == "AUTO"  # was REVIEW: below the auto bar
    assert gate(_scored(47), LIKELY, old_agent) == ("REJECT", ["Score 47 is below the send bar (50)"])
    assert gate(_scored(55), LIKELY, {"send_score": None})[0] == "AUTO"
    assert gate(_scored(55), LIKELY, None)[0] == "AUTO"
    assert send_bar({}) == send_bar(None) == send_bar({"send_score": "high"}) == 50
    assert send_bar({"send_score": 130}) == 100 and send_bar({"send_score": "35"}) == 35


def test_a_hard_reject_comes_before_everything_else():
    decision, reasons = gate(_scored(95, ["no_contact", "maps_only"]), LIKELY, {"require_approval": True})
    assert decision == "REJECT" and reasons == [
        "No usable contact (only helplines, support inboxes or an enquiry form)"]


@pytest.mark.parametrize("flag, words", [
    ("maps_only", "Judged from its Google Maps listing: the website could not be read"),
    ("possible_duplicate:quantumcoaching.in", "Possibly the same organisation as quantumcoaching.in"),
])
@pytest.mark.parametrize("score", [50, 95])
def test_validity_flags_at_or_above_the_bar_wait_for_a_person(flag, words, score):
    decision, reasons = gate(_scored(score, [flag]), LIKELY, {"send_score": 50})
    assert decision == "REVIEW" and words in reasons[-1], reasons
    assert gate(_scored(score, [flag]), GENERAL, {"send_score": 50, "require_intent": True})[0] == "REVIEW"


@pytest.mark.parametrize("score", [5, 49])
def test_validity_flags_below_the_bar_are_rejected_since_nobody_reviews(score):
    assert gate(_scored(score, ["maps_only"]), LIKELY, {"send_score": 50}) == (
        "REJECT", [f"Judged from its Google Maps listing only: score {score} is below the send bar (50)"])
    assert gate(_scored(score, ["possible_duplicate:quantumcoaching.in"]), LIKELY, {"send_score": 50}) == (
        "REJECT", [f"Score {score} is below the send bar (50)"])
    # a lead that says it was judged from its listing is held like the flag, wherever it is stored
    assert gate(_scored(score), {**LIKELY, "maps_only": True}, {"send_score": 50})[1][0].startswith(
        "Judged from its Google Maps listing only")
    assert gate(_scored(60), {**LIKELY, "maps_only": True}, {"send_score": 50})[0] == "REVIEW"


def test_the_risk_penalty_ranks_a_lead_lower_and_no_longer_holds_it_back():
    competitor = _scored(45, ["competitor_platform:classplus"], base=65, risk=40)
    decision, reasons = gate(competitor, LIKELY, DEFAULT_GATE)
    assert decision == "REJECT" and reasons[0] == "Score 45 is below the send bar (50)"  # was REVIEW (base >= 45)
    assert "Classplus" in reasons[1]
    assert gate({**competitor, "score": 55}, LIKELY, DEFAULT_GATE)[0] == "AUTO"  # was REVIEW at any score
    big = _scored(60, ["enterprise"], base=75, risk=30)
    assert gate(big, LIKELY, DEFAULT_GATE)[0] == "AUTO"
    assert gate({**big, "score": 40}, LIKELY, DEFAULT_GATE) == (
        "REJECT", ["Score 40 is below the send bar (50)", "Very large organisation: not a self-serve buyer"])


def test_contact_and_intent_requirements_reject_unless_the_list_approves_every_lead():
    assert gate(_scored(80, level="general"), GENERAL, DEFAULT_GATE) == (
        "REJECT", ["Best contact is general; this list needs at least likely"])
    assert gate(_scored(80), LIKELY, {"require_intent": True}) == (
        "REJECT", ["No buying signal, and this list requires one"])
    assert gate(_scored(80, has_intent=True), LIKELY, {"require_intent": True})[0] == "AUTO"
    assert gate(_scored(80, level="general"), GENERAL, {"require_approval": True}) == (
        "REVIEW", ["Best contact is general; this list needs at least likely"])
    assert gate(_scored(30, level="general"), GENERAL, {"require_approval": True})[0] == "REJECT"  # the bar first


def test_require_approval_holds_every_sendable_lead_for_a_person():
    assert gate(_scored(90), LIKELY, {"require_approval": True}) == (
        "REVIEW", ["Waiting for your approval: this list sends no lead without it",
                   "Score 90 meets the send bar (50) with a likely contact"])
    assert gate(_scored(49), LIKELY, {"require_approval": True}) == (
        "REJECT", ["Score 49 is below the send bar (50)"])


@pytest.mark.parametrize("written, days", [
    ("3 days ago", 3), ("Posted 2 weeks ago", 14), ("a month ago", 30), ("30+ days ago", 30), ("today", 0),
    ("yesterday", 1), ("24 September 2026", 31), ("24th Sep 2026", 31), ("2026-10-03", 22), ("Sep 2026", 40),
    ("1 Nov 2026", 0), ("2026-27", None), (None, None),
])
def test_signal_dates_are_read_as_written(written, days):
    assert signal_age_days(written, TODAY) == days
