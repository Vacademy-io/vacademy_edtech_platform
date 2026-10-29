"""The same organisation found twice under two domains, caught after its website is read
(dedupe.py): the matching rules on their own, the gate's new review flag, then the real SQL,
the agent's lock and research's save (SKIPPED / REVIEW and the day counters)."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, make_candidate, make_world
from app.services.lead_agent import dedupe, research, store
from app.services.lead_agent.engine.scoring import DEFAULT_GATE, gate


def _phone(value, quality="likely", context="Call us", kind="institute_phone"):
    return {"kind": kind, "value": value, "quality": quality, "context": context, "url": "https://x/"}


def _email(value, quality="general", context=""):
    return {"kind": "published_email", "value": value, "quality": quality, "context": context, "url": "https://x/"}


def _lead(name, city, *contacts, domain=None):
    return {"organisation": {"name": name, "city": city, "domain": domain}, "contacts": list(contacts),
            "contact_quality": {"level": "likely"}}


def _other(cid, domain, name="Someone Else", city="Lucknow", phones=(), emails=(), site_domain=None):
    return {"id": cid, "domain": domain, "site_domain": site_domain or domain, "name": name, "city": city,
            "phones": list(phones), "emails": list(emails), "status": "DELIVERED"}


# ------------------------------------------------------------------------------------ the rules

def test_two_sites_printing_the_same_mobiles_are_one_organisation():
    # centurionacademy.in & centuriondefenceacademy.com, Lucknow (2026-10-29 audit)
    lead = _lead("Centurion Defence Academy", "Lucknow", _phone("+91 97959 77776"), _phone("+91 97959 77779"),
                 domain="centuriondefenceacademy.com")
    others = [_other("c1", "centurionacademy.in", "Centurion Academy", phones=["9795977776", "9795977779"])]
    match = dedupe.judge(lead, others, org_domain="centuriondefenceacademy.com")
    assert match.kind == dedupe.SAME and match.candidate_id == "c1" and match.domain == "centurionacademy.in"
    assert match.note() == "Same organisation as centurionacademy.in: both show phone 9795977776, 9795977779"


def test_shared_emails_make_one_organisation():
    # iisdt.in & bkvps.in, Indore: 2 phones and 4 emails in common
    lead = _lead("BKVPS", "Indore", _email("enrollment@iisdt.in"), _email("Info@IISDT.in"), domain="bkvps.in")
    others = [_other("c1", "iisdt.in", "IISDT", "Indore", emails=["enrollment@iisdt.in", "info@iisdt.in"])]
    match = dedupe.judge(lead, others, org_domain="bkvps.in")
    assert match.kind == dedupe.SAME
    assert "both show email enrollment@iisdt.in, info@iisdt.in" in match.note()
    assert "this site shows" not in match.note()  # an email both show is named once


def test_an_email_on_the_other_candidates_domain_makes_one_organisation():
    # pws.edu.in shows school.pws@pathways.in; pathways.in was a candidate too: both delivered and charged
    lead = _lead("Pathways World School", "Gurugram", _email("school.pws@pathways.in"), domain="pws.edu.in")
    others = [_other("c1", "pathways.in", "Pathways School", "Gurugram", emails=["admissions@pathways.in"])]
    match = dedupe.judge(lead, others, org_domain="pws.edu.in")
    assert match.kind == dedupe.SAME and match.note() == (
        "Same organisation as pathways.in: this site shows school.pws@pathways.in")
    # ... and the other way round, when pathways.in is researched after pws.edu.in
    later = _lead("Pathways School", "Gurugram", _email("admissions@pathways.in"), domain="pathways.in")
    earlier = [_other("c2", "pws.edu.in", "Pathways World School", "Gurugram", emails=["school.pws@pathways.in"])]
    match = dedupe.judge(later, earlier, org_domain="pathways.in")
    assert match.kind == dedupe.SAME and "pws.edu.in shows school.pws@pathways.in" in match.note()


def test_a_home_page_opening_on_the_other_candidates_domain_is_one_organisation():
    lead = _lead("Pathways World School", "Gurugram", _phone("+91 98450 12345"), domain="pathways.in")
    others = [_other("c1", "pathways.in", phones=["9845054321"])]
    match = dedupe.judge(lead, others, org_domain="pws.edu.in", site_domain="pathways.in")
    assert match.kind == dedupe.SAME and "this site opens on pathways.in" in match.note()
    # two unrelated sites that both land on a shared host are not one organisation
    hosted = [_other("c2", "other.in", phones=["9845054321"], site_domain="blogspot.com")]
    assert dedupe.judge(lead, hosted, org_domain="mine.in", site_domain="blogspot.com") is None


def test_same_name_and_city_with_nothing_shared_is_only_a_possible_duplicate():
    # quantumcoaching.in & quantumcoachinginstitute.in: both "Quantum Coaching Institute", Lucknow
    lead = _lead("Quantum Coaching Institute", "Lucknow", _phone("+91 98450 12345"),
                 domain="quantumcoachinginstitute.in")
    others = [_other("c1", "quantumcoaching.in", "Quantum Coaching Institute", "Lucknow, Uttar Pradesh",
                     phones=["9845054321"])]
    match = dedupe.judge(lead, others, org_domain="quantumcoachinginstitute.in")
    assert match.kind == dedupe.POSSIBLE and match.domain == "quantumcoaching.in"
    # the city in the name does not make it another name
    lead["organisation"]["name"] = "Quantum Coaching Lucknow"
    assert dedupe.judge(lead, others, org_domain="quantumcoachinginstitute.in").kind == dedupe.POSSIBLE
    # same name in another city: a different centre, not flagged
    others[0]["city"] = "Kanpur"
    assert dedupe.judge(lead, others, org_domain="quantumcoachinginstitute.in") is None


def test_lines_outreach_would_not_use_never_make_two_organisations_one():
    shared = "+91 98450 12345"
    others = [_other("c1", "b.in", phones=["9845012345"], emails=["help@agency.in"])]
    for contact in (_phone(shared, quality="avoid", context="Toll-free helpline"),      # rated avoid
                    _phone(shared, context="Designed & developed by Pixel Infotech"),   # web agency's footer
                    {"kind": "contact_form", "value": "https://a.in/contact", "url": "https://a.in/contact"},
                    _email("help@agency.in", context="Website by Agency")):
        assert dedupe.judge(_lead("Alpha", "Indore", contact), others, org_domain="a.in") is None, contact


def test_a_certain_match_later_in_the_list_wins_over_an_earlier_possible_one():
    lead = _lead("Quantum Coaching Institute", "Lucknow", _phone("+91 98450 12345"), domain="q2.in")
    others = [_other("c1", "q1.in", "Quantum Coaching Institute", "Lucknow"),
              _other("c2", "q3.in", "Q3", "Kanpur", phones=["9845012345"])]
    match = dedupe.judge(lead, others, org_domain="q2.in")
    assert match.kind == dedupe.SAME and match.candidate_id == "c2"


def test_contact_keys_normalise_phones_and_emails():
    lead = _lead("A", "B", _phone("+91 98450-12345"), _phone("098450 54321", kind="whatsapp"),
                 _email("Director@Alpha.IN"), _phone("12345"))
    assert dedupe.contact_keys(lead) == ({"9845012345", "9845054321"}, {"director@alpha.in"})


# ----------------------------------------------------------------------------- applying a match

def _result(status="APPROVED", decision="AUTO", score=80, lead=None):
    scored = {"score": score, "base_score": score, "fit": 70, "intent": 60, "reach": 70, "risk": 0,
              "has_intent": True, "reach_level": "likely", "flags": [], "reasons": ["Fit 70/100", "Reach: likely"]}
    return {"status": status, "decision": decision, "score": score, "score_json": {**scored, "gate_reasons": []},
            "lead_json": lead or _lead("Quantum Coaching Institute", "Lucknow", _phone("+91 98450 12345")),
            "stage": "qualified", "reject_reason": None, "platforms": None}


def test_a_same_organisation_match_skips_the_lead_with_a_note():
    match = dedupe.Match(dedupe.SAME, "c1", "centurionacademy.in", ("both show phone 9795977776",))
    out = dedupe.apply(_result(), match, DEFAULT_GATE)
    assert out["status"] == "SKIPPED" and out["decision"] == "AUTO"
    assert out["delivery_note"] == "Same organisation as centurionacademy.in: both show phone 9795977776"
    assert out["score_json"]["reasons"][0] == out["delivery_note"]  # the dashboard shows the first reason
    assert out["score_json"]["duplicate_of"] == {"candidate_id": "c1", "domain": "centurionacademy.in",
                                                 "shared": ["both show phone 9795977776"]}


def test_a_possible_duplicate_waits_for_review_instead_of_going_out():
    out = dedupe.apply(_result(), dedupe.Match(dedupe.POSSIBLE, "c1", "quantumcoaching.in"), DEFAULT_GATE)
    assert out["status"] == "REVIEW" and out["decision"] == "REVIEW"
    assert "possible_duplicate:quantumcoaching.in" in out["score_json"]["flags"]
    assert any("Possibly the same organisation as quantumcoaching.in" in r for r in out["score_json"]["gate_reasons"])
    assert dedupe.apply(_result(), None, DEFAULT_GATE) == _result()


def test_the_possible_duplicate_flag_never_lifts_a_low_score_into_review():
    lead = {"contact_quality": {"level": "likely"}}
    flagged = {"score": 90, "base_score": 90, "risk": 0, "has_intent": True,
               "flags": ["possible_duplicate:quantumcoaching.in"]}
    decision, reasons = gate(flagged, lead, DEFAULT_GATE)
    assert decision == "REVIEW" and reasons == [
        "Possibly the same organisation as quantumcoaching.in (same name and city): check before it goes out"]
    # below the bar only because of a single tutor's risk: still rejected (no switch pitch to decide on)
    low = {"score": 30, "base_score": 50, "risk": 25, "has_intent": True,
           "flags": ["micro", "possible_duplicate:quantumcoaching.in"]}
    assert gate(low, lead, DEFAULT_GATE)[0] == "REJECT"


# --------------------------------------------------------------------------- SQL, lock and save

def _lead_json(name, city, domain, *contacts):
    return {"organisation": {"name": name, "city": city, "domain": domain}, "contacts": list(contacts),
            "contact_quality": {"level": "likely"}}


def test_the_query_finds_live_candidates_sharing_a_usable_contact(la_db):
    agent = make_world(la_db)
    me = make_candidate(la_db, agent, "centuriondefenceacademy.com", status="RESEARCHING")
    delivered = make_candidate(la_db, agent, "centurionacademy.in", status="DELIVERED", lead_json=_lead_json(
        "Centurion Academy", "Lucknow", "centurionacademy.in", _phone("+91 97959 77776"),
        _phone("+91 1800 102 2727", quality="avoid"), _email("Info@CenturionAcademy.in")))
    make_candidate(la_db, agent, "gone.in", status="REJECTED", lead_json=_lead_json(
        "Gone", "Lucknow", "gone.in", _phone("+91 97959 77776")))                  # not live
    make_candidate(la_db, agent, "helpline.in", status="APPROVED", lead_json=_lead_json(
        "Helpline", "Kanpur", "helpline.in", _phone("+91 97959 77779", quality="avoid")))  # avoid-rated only
    lead = _lead_json("Centurion Defence Academy", "Lucknow", "centuriondefenceacademy.com",
                      _phone("+91 97959 77776"), _phone("+91 97959 77779"))
    with la_db() as db:
        rows = store.same_org_candidates(db, agent_id=agent["id"], candidate_id=me["id"],
                                         statuses=dedupe.LIVE_STATUSES, phones=["9795977776", "9795977779"],
                                         emails=[], mail_domains=[], domains=["centuriondefenceacademy.com"],
                                         city="", limit=50)
        match = dedupe.check(db, agent_id=agent["id"], candidate_id=me["id"], lead=lead,
                             org_domain="centuriondefenceacademy.com")
    assert [r["id"] for r in rows] == [delivered["id"]]
    assert rows[0]["phones"] == ["9795977776"] and rows[0]["emails"] == ["info@centurionacademy.in"]
    assert match.kind == dedupe.SAME and match.candidate_id == delivered["id"]


def test_the_query_returns_same_city_candidates_for_the_name_check(la_db):
    agent = make_world(la_db)
    me = make_candidate(la_db, agent, "quantumcoachinginstitute.in", status="RESEARCHING")
    other = make_candidate(la_db, agent, "quantumcoaching.in", status="REVIEW", lead_json=_lead_json(
        "Quantum Coaching Institute", "Lucknow, Uttar Pradesh", "quantumcoaching.in", _phone("+91 98450 54321")))
    lead = _lead_json("Quantum Coaching Institute", "Lucknow", "quantumcoachinginstitute.in",
                      _phone("+91 98450 12345"))
    with la_db() as db:
        match = dedupe.check(db, agent_id=agent["id"], candidate_id=me["id"], lead=lead,
                             org_domain="quantumcoachinginstitute.in")
    assert match.kind == dedupe.POSSIBLE and match.candidate_id == other["id"]


def test_the_agents_lock_holds_a_second_saver_until_the_first_commits(la_db):
    from sqlalchemy.exc import OperationalError

    agent = make_world(la_db)
    first = la_db()
    try:
        store.lock_agent_dedupe(first, agent["id"])
        with la_db() as second:
            second.execute(text("SET LOCAL lock_timeout = '200ms'"))
            with pytest.raises(OperationalError):
                store.lock_agent_dedupe(second, agent["id"])
            second.rollback()
        first.commit()   # the lock ends with the transaction
        with la_db() as third:
            store.lock_agent_dedupe(third, agent["id"])
            third.rollback()
    finally:
        first.close()


def _saved(la_db, cid):
    with la_db() as db:
        return dict(db.execute(text("SELECT status, decision, delivery_note, score_json, lead_json, updated_at "
                                    "FROM lead_candidate WHERE id = :i"), {"i": cid}).mappings().first())


def _day(la_db):
    with la_db() as db:
        return dict(db.execute(text("SELECT researched, review, rejected, delivered FROM lead_agent_day"))
                    .mappings().first())


def test_research_saves_a_duplicate_as_skipped_and_leaves_the_other_row_alone(la_db):
    agent = make_world(la_db)
    other = make_candidate(la_db, agent, "centurionacademy.in", status="DELIVERED", lead_json=_lead_json(
        "Centurion Academy", "Lucknow", "centurionacademy.in", _phone("+91 97959 77776")))
    before = _saved(la_db, other["id"])
    me = make_candidate(la_db, agent, "centuriondefenceacademy.com", status="RESEARCHING")
    result = _result(lead=_lead_json("Centurion Defence Academy", "Lucknow", "centuriondefenceacademy.com",
                                     _phone("+91 97959 77776")))
    assert research._save(me, agent, result) == "SKIPPED"
    row = _saved(la_db, me["id"])
    assert row["status"] == "SKIPPED" and "centurionacademy.in" in row["delivery_note"]
    assert "9795977776" in row["delivery_note"] and row["lead_json"] is not None
    assert _saved(la_db, other["id"]) == before                 # never touched
    assert _day(la_db) == {"researched": 1, "review": 0, "rejected": 0, "delivered": 0}


def test_research_sends_a_possible_duplicate_to_review(la_db):
    agent = make_world(la_db)
    make_candidate(la_db, agent, "quantumcoaching.in", status="APPROVED", lead_json=_lead_json(
        "Quantum Coaching Institute", "Lucknow", "quantumcoaching.in", _phone("+91 98450 54321")))
    me = make_candidate(la_db, agent, "quantumcoachinginstitute.in", status="RESEARCHING")
    result = _result(lead=_lead_json("Quantum Coaching Institute", "Lucknow", "quantumcoachinginstitute.in",
                                     _phone("+91 98450 12345")))
    assert research._save(me, agent, result) == "REVIEW"
    row = _saved(la_db, me["id"])
    assert row["decision"] == "REVIEW" and "possible_duplicate:quantumcoaching.in" in row["score_json"]["flags"]
    assert row["delivery_note"] is None
    assert _day(la_db) == {"researched": 1, "review": 1, "rejected": 0, "delivered": 0}


def test_a_failing_duplicate_check_never_blocks_the_save(la_db, monkeypatch):
    agent = make_world(la_db)
    me = make_candidate(la_db, agent, "alpha.in", status="RESEARCHING")

    def broken(db, **kw):
        db.execute(text("SELECT no_such_column FROM lead_candidate"))
    monkeypatch.setattr(dedupe, "check", broken)
    assert research._save(me, agent, _result()) == "APPROVED"
    assert _saved(la_db, me["id"])["status"] == "APPROVED"


def test_a_rejected_result_is_saved_without_the_check(la_db, monkeypatch):
    agent = make_world(la_db)
    me = make_candidate(la_db, agent, "alpha.in", status="RESEARCHING")
    monkeypatch.setattr(dedupe, "check", lambda *a, **k: pytest.fail("checked a rejected lead"))
    rejected = {**_result(status="REJECTED", decision="REJECT"), "reject_reason": "Score 10 is below the review bar"}
    assert research._save(me, agent, rejected) == "REJECTED"
    with la_db() as db:
        assert store.get_candidate(db, me["id"], INSTITUTE)["status"] == "REJECTED"
