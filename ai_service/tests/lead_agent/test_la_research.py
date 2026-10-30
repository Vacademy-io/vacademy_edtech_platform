"""Research of one candidate with the REAL engine (extraction prompt, build_lead,
fingerprint, scoring, gate) and a scripted LLM / search: free rejects spend no
LLM call; a researched lead is saved with lead_json / score_json / decision; an
LLM outage puts the candidate back with a back-off; the Google Maps listing's
phone confirms a website number or becomes the contact; a site that cannot be
read is judged from its Maps listing (REVIEW, never AUTO) or rejected; the same
organisation found under a second domain is SKIPPED (or waits for REVIEW when
only its name and city match); the validation effort's searches go through
Serper and are counted into the agent's day."""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, PLAN, make_candidate, make_world
from app.services.lead_agent import engine_api, llm, research, store
from app.services.lead_agent import search as search_mod

HOME = ("WiNNERS Institute Indore\nCall our admissions team: +91 98765 12345\n"
        "Email: info@winnersinstitute.in\nJEE and NEET coaching since 2004.\n"
        "Admissions open for the 2027 batch.\nWe are hiring telecallers for our admissions office.\n"
        "Results 2026: 120 selections.\nOur classrooms are in Vijay Nagar.\nFounder & Director: Aditya Patel")


def _page(la_db, cand, url, page_type, text_, links=(), fetched_by="SERVER", has_form=True, hints=()):
    with la_db() as db:
        store.upsert_page(db, org_id=cand["org_id"], url=url, page_type=page_type,
                          record={"access": "ok", "text": text_, "links": list(links), "has_form": has_form,
                                  "final_url": url, "platform_hints": list(hints)}, fetched_by=fetched_by,
                          institute_id=cand["institute_id"])
        db.commit()


def _extraction():
    return engine_api.schema("AccountExtraction").model_validate({
        "organisation_name": "WiNNERS Institute", "is_target_segment": True,
        "what_they_do": "JEE and NEET coaching in Indore", "city": "Indore", "branches": [],
        "signals": [{"signal": "admissions_open", "observation": "Admissions open for 2027", "event_date": None,
                     "cite": {"page": 1, "quote": "Admissions open for the 2027 batch."}},
                    {"signal": "hiring", "observation": "Hiring telecallers", "event_date": None,
                     "cite": {"page": 1, "quote": "We are hiring telecallers for our admissions office."}}],
        "people": [{"name": "Aditya Patel", "role": "Founder & Director",
                    "cite": {"page": 1, "quote": "Founder & Director: Aditya Patel"}}],
        "current_software": [], "job_posts": [], "unknowns": ["Budget"],
        "discovery_question": "How do you follow up on admission enquiries today?",
        "summary": "A JEE/NEET coaching institute hiring telecallers.",
    })


@pytest.fixture(autouse=True)
def nothing_in_the_leads(monkeypatch):
    """admin_core existing-contacts before research (test_la_spend.py covers it): nothing known yet."""
    from app.services.lead_agent import admin_core

    async def existing(institute_id, phones, emails):
        return {"phones": [], "emails": []}
    monkeypatch.setattr(admin_core, "existing_contacts", existing)


@pytest.fixture
def scripted(monkeypatch):
    calls = []

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        calls.append(purpose)
        if ctx and ctx.candidate_id:
            await asyncio.to_thread(_cost, ctx.candidate_id)
        if output.__name__ == "AccountExtraction":
            return _extraction()
        if output.__name__ == "ContactLookup":
            return output.model_validate({"people": []})
        raise AssertionError(output)

    monkeypatch.setattr(llm, "ask", fake_ask)

    class NoSearch:
        available = True

        async def search(self, query, **kw):
            calls.append("search")
            return [search_mod.SearchResult(query=query, rank=1, title="WiNNERS Institute Indore - team",
                                            url="https://winnersinstitute.in/team",
                                            snippet="WiNNERS Institute Indore: Aditya Patel, Founder & Director")]

        async def maps(self, query, **kw):
            calls.append("maps")
            return []
    monkeypatch.setattr(search_mod, "parallel", lambda: NoSearch())
    monkeypatch.setattr(search_mod, "serper", lambda: NoSearch())
    monkeypatch.setattr("app.services.lead_agent.mx.mx_lookup", lambda d: True)
    return calls


def _cost(cid):
    from app.services.lead_agent import db as ladb
    with ladb.session() as db:
        store.add_cost(db, cid, 0.0011)


def _claimed(la_db, cand):
    with la_db() as db:
        assert [r["id"] for r in store.claim_ready(db, 1)] == [cand["id"]]
        db.commit()


def _row(la_db, cid):
    with la_db() as db:
        return db.execute(text("SELECT status, decision, score, reject_reason, lead_json, score_json, cost_usd, "
                               "attempts FROM lead_candidate WHERE id = :i"), {"i": cid}).mappings().first()


def test_a_researched_lead_is_scored_gated_and_saved(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    with la_db() as db:   # review bar 0: the decision-maker lookup always runs
        store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {"auto_score": 70, "review_score": 0,
                                                                      "min_contact": "likely",
                                                                      "require_intent": False}})
        db.commit()
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME, fetched_by="EXTENSION")
    _claimed(la_db, cand)
    status = asyncio.run(research.research_candidate(cand["id"]))
    row = _row(la_db, cand["id"])
    assert status == row["status"] and status in ("APPROVED", "REVIEW", "REJECTED")
    assert scripted[0] == "extract" and "search" in scripted and "contacts" in scripted
    assert row["lead_json"]["fetch"]["decision_maker_lookup"] is True
    lead = row["lead_json"]
    assert lead["organisation"]["name"] == "WiNNERS Institute"
    assert any(c["kind"] == "institute_phone" for c in lead["contacts"])
    # the page came from the cache (no task of this candidate): it does not make the lead "local"
    assert lead["fetch"]["extension_pages"] == 0 and lead["fetch"]["pages_used"] == 1
    assert {"fit", "intent", "reach", "risk", "score", "flags", "gate_reasons"} <= set(row["score_json"])
    assert row["score"] == row["score_json"]["score"]
    assert float(row["cost_usd"]) > 0
    with la_db() as db:
        day = db.execute(text("SELECT researched, review + rejected FROM lead_agent_day")).first()
    assert day[0] == 1


def test_the_research_lease_is_renewed_before_each_llm_step(la_db, scripted, monkeypatch):
    agent = make_world(la_db, plan=PLAN)
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME)
    _claimed(la_db, cand)
    with la_db() as db:
        db.execute(text("UPDATE lead_candidate SET claimed_at = now() - interval '14 minutes'"))
        db.commit()
    seen = []
    real = research._renew

    def spy(cid):
        real(cid)
        with la_db() as db:
            seen.append(db.execute(text("SELECT claimed_at > now() - interval '1 minute' FROM lead_candidate "
                                        "WHERE id = :i"), {"i": cid}).scalar())
    monkeypatch.setattr(research, "_renew", spy)
    asyncio.run(research.research_candidate(cand["id"]))
    assert seen and all(seen)


def test_free_rejects_spend_no_llm_call(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    dead = make_candidate(la_db, agent, "dead.in", status="READY")          # no readable page
    nocontact = make_candidate(la_db, agent, "quiet.in", status="READY")    # no phone, email or form
    _page(la_db, nocontact, "https://quiet.in/", "home", "We teach maths. Visit us.", has_form=False)
    supp = make_candidate(la_db, agent, "blocked.in", status="READY")
    _page(la_db, supp, "https://blocked.in/", "home", HOME)
    with la_db() as db:
        store.insert_suppression(db, institute_id=INSTITUTE, kind="DOMAIN", value="blocked.in", reason="CUSTOMER",
                                 note=None, created_by="u")
        store.claim_ready(db, 5)
        db.commit()
    for c in (dead, nocontact, supp):
        assert asyncio.run(research.research_candidate(c["id"])) == "REJECTED"
    assert scripted == []
    assert _row(la_db, dead["id"])["reject_reason"].startswith("No readable page")
    assert _row(la_db, nocontact["id"])["reject_reason"].startswith("No contact")
    assert _row(la_db, supp["id"])["reject_reason"] == "Suppressed domain"


def test_an_llm_outage_releases_the_candidate_with_a_backoff(la_db, monkeypatch):
    async def down(*a, **k):
        raise llm.LLMUnavailable("every model failed")
    monkeypatch.setattr(llm, "ask", down)
    monkeypatch.setattr("app.services.lead_agent.mx.mx_lookup", lambda d: True)
    agent = make_world(la_db, plan=PLAN)
    cand = make_candidate(la_db, agent, "w.in", status="READY")
    _page(la_db, cand, "https://w.in/", "home", HOME)
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "READY"
    with la_db() as db:
        assert db.execute(text("SELECT not_before > now() + interval '5 minutes' FROM lead_candidate")).scalar()


def test_a_suppressed_phone_is_dropped_before_scoring(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME)
    with la_db() as db:
        store.insert_suppression(db, institute_id=INSTITUTE, kind="PHONE", value="9876512345", reason="OPTED_OUT",
                                 note=None, created_by="u")
        db.commit()
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    lead = _row(la_db, cand["id"])["lead_json"]
    assert all("98765" not in (c.get("value") or "") for c in lead["contacts"])


# ------------------------------------------------------------------------- Google Maps phone

MAPS = {"phone": "098450 12345", "rating": 4.6, "reviews": 120, "address": "Vijay Nagar, Indore",
        "type": "Coaching center"}
# Only a support helpline and a support inbox: nothing outreach can use on the website itself.
HELPLINE_HOME = (HOME.replace("Call our admissions team: +91 98765 12345", "Student support helpline: +91 98765 12345")
                 .replace("info@winnersinstitute.in", "support@winnersinstitute.in"))


def _maps_candidate(la_db, agent, domain="winnersinstitute.in", **maps):
    return make_candidate(la_db, agent, domain, status="READY",
                          discovery_json={"query": "coaching institute Indore", "maps": {**MAPS, **maps}})


def _maps_contacts(la_db, cid):
    return [c for c in _row(la_db, cid)["lead_json"]["contacts"] if c.get("found_by") == "google_maps"]


def _gate(la_db, agent, auto=70, review=0):
    """The bar a lead must reach: send_score since rank and fill (2026-10-30), review_score before it."""
    with la_db() as db:
        store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {"auto_score": auto, "review_score": review,
                                                                      "send_score": review, "min_contact": "likely",
                                                                      "require_intent": False}})
        db.commit()


def test_a_site_showing_only_a_helpline_keeps_its_maps_phone_as_the_contact(la_db, scripted):
    # Career Craft Patna, CMC Indore (2026-10-29): rejected for "no usable contact" while their
    # Google Maps listing showed a number
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent)
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HELPLINE_HOME, has_form=False)
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    row = _row(la_db, cand["id"])
    assert scripted[0] == "extract"
    maps = _maps_contacts(la_db, cand["id"])
    assert len(maps) == 1 and maps[0]["kind"] == "institute_phone" and maps[0]["note"] == "mobile"
    assert maps[0]["quality"] == "likely" and maps[0]["value"].replace(" ", "").endswith("9845012345")
    assert "Career" not in maps[0]["context"] and maps[0]["url"].startswith("https://www.google.com/maps/")
    assert row["lead_json"]["contact_quality"]["level"] == "likely"
    assert "no_contact" not in row["score_json"]["flags"]
    assert any(e["field"] == "Contact (Google Maps listing)" for e in row["lead_json"]["evidence"])


def test_a_maps_phone_matching_a_website_number_confirms_it(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, phone="098765 12345")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME)
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    contacts = _row(la_db, cand["id"])["lead_json"]["contacts"]
    phone = next(c for c in contacts if c["kind"] == "institute_phone")
    assert phone["maps_confirmed"] is True and not phone.get("found_by")
    assert _maps_contacts(la_db, cand["id"]) == []


def test_a_site_with_no_contact_but_a_maps_phone_is_researched_not_rejected(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, "quiet.in")
    _page(la_db, cand, "https://quiet.in/", "home", "We teach maths. Visit us.", has_form=False)
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    row = _row(la_db, cand["id"])
    assert scripted and scripted[0] == "extract"
    assert not (row["reject_reason"] or "").startswith("No contact")
    assert [c.get("found_by") for c in row["lead_json"]["contacts"]] == ["google_maps"]


def test_a_maps_landline_is_a_general_contact(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, phone="080 4567 8901")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HELPLINE_HOME, has_form=False)
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    maps = _maps_contacts(la_db, cand["id"])
    assert len(maps) == 1 and maps[0]["quality"] == "general"


def test_a_suppressed_maps_phone_is_never_used(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, "quiet.in")
    _page(la_db, cand, "https://quiet.in/", "home", "We teach maths. Visit us.", has_form=False)
    with la_db() as db:
        store.insert_suppression(db, institute_id=INSTITUTE, kind="PHONE", value="9845012345", reason="OPTED_OUT",
                                 note=None, created_by="u")
        db.commit()
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REJECTED"
    assert scripted == [] and _row(la_db, cand["id"])["reject_reason"].startswith("No contact")


# ------------------------------------------------------------------ same organisation, two domains

def test_a_lead_sharing_a_phone_with_a_delivered_lead_is_skipped(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    _gate(la_db, agent)
    other = make_candidate(la_db, agent, "winners-indore.in", status="DELIVERED", lead_json={
        "organisation": {"name": "Winners Indore", "city": "Indore", "domain": "winners-indore.in"},
        "contacts": [{"kind": "institute_phone", "value": "+91 98765 12345", "quality": "likely",
                      "context": "Call us"}]})
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME)
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "SKIPPED"
    with la_db() as db:
        note = db.execute(text("SELECT delivery_note FROM lead_candidate WHERE id = :i"), {"i": cand["id"]}).scalar()
        theirs = db.execute(text("SELECT status, lead_json FROM lead_candidate WHERE id = :i"),
                            {"i": other["id"]}).mappings().first()
        day = db.execute(text("SELECT researched, review, rejected, delivered FROM lead_agent_day")).first()
    assert "winners-indore.in" in note and "9876512345" in note
    assert theirs["status"] == "DELIVERED" and theirs["lead_json"]["organisation"]["name"] == "Winners Indore"
    assert tuple(day) == (1, 0, 0, 0)


def test_a_lead_with_the_same_name_and_city_as_a_live_lead_waits_for_review(la_db, scripted):
    agent = make_world(la_db, plan=PLAN)
    _gate(la_db, agent, auto=0)   # would otherwise go out on its own
    make_candidate(la_db, agent, "winnersindore.com", status="APPROVED", lead_json={
        "organisation": {"name": "WiNNERS Institute", "city": "Indore", "domain": "winnersindore.com"},
        "contacts": [{"kind": "institute_phone", "value": "+91 98450 54321", "quality": "likely"}]})
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HOME)
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REVIEW"
    row = _row(la_db, cand["id"])
    assert row["decision"] == "REVIEW" and "possible_duplicate:winnersindore.com" in row["score_json"]["flags"]


# ------------------------------------------------------- website unreadable: judged from its Google Maps listing

UNREADABLE_MAPS = {"address": "12, Vijay Nagar, Indore, Madhya Pradesh 452010"}


def test_an_unreadable_site_with_a_maps_phone_is_judged_from_the_listing_and_waits_for_review(la_db, scripted):
    # 2026-10-29 audit: 202 of 237 "No readable page" rejects on "Leads for Vacademy" had a listing with a phone.
    agent = make_world(la_db, plan=PLAN)
    _gate(la_db, agent, auto=0)  # would go out on its own if it were judged from a website
    cand = _maps_candidate(la_db, agent, "dead.in", **UNREADABLE_MAPS)  # no page at all
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REVIEW"
    row = _row(la_db, cand["id"])
    assert scripted == []  # no model, no search
    lead = row["lead_json"]
    assert lead["maps_only"] is True and "maps_only" in row["score_json"]["flags"]
    assert "Judged from its Google Maps listing: the website could not be read" in row["score_json"]["gate_reasons"]
    assert lead["organisation"]["city"] == "Indore" and lead["organisation"]["is_target_segment"] is True
    assert lead["maps_listing"]["matches"] == "Coaching institutes" and lead["maps_listing"]["reviews"] == 120
    assert [(c["found_by"], c["quality"]) for c in lead["contacts"]] == [("google_maps", "likely")]
    assert lead["fetch"]["pages_used"] == 0 and lead["fetch"]["maps_only"] is True


def test_a_maps_only_lead_below_the_send_bar_is_rejected_saying_why(la_db, scripted):
    # Rank and fill (2026-10-30, engine scoring.gate): a listing-only lead waits for a person only at or
    # above the send bar; below it (default 50) it is rejected, the reason naming the listing.
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, "dead.in", **UNREADABLE_MAPS)
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REJECTED"
    row = _row(la_db, cand["id"])
    assert scripted == [] and row["score"] < 50
    assert row["reject_reason"].startswith(f"Judged from its Google Maps listing only: score {row['score']}")


@pytest.mark.parametrize("maps, reason", [
    ({"type": "Business management consultant"}, research.MAPS_UNFIT),
    ({"type": "CBSE school"}, "Left out: Schools & playschools"),  # the brief leaves schools out
    ({"phone": None}, "No readable page (website could not be read)"),
])
def test_an_unreadable_site_is_rejected_when_its_listing_cannot_carry_it(la_db, scripted, maps, reason):
    agent = make_world(la_db, plan=PLAN)
    cand = _maps_candidate(la_db, agent, "dead.in", **{**UNREADABLE_MAPS, **maps})
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REJECTED"
    assert scripted == [] and _row(la_db, cand["id"])["reject_reason"] == reason


# ------------------------------------------------------------------- validation effort searches (wiring)

def test_the_effort_searches_go_through_serper_counted_into_the_agents_day(la_db, scripted, monkeypatch):
    seen = []

    class Serper:
        available = True

        async def search(self, query, **kw):
            seen.append(("web", query, kw))
            return []

        async def maps(self, query, **kw):
            seen.append(("maps", query, kw))
            return []
    monkeypatch.setattr(search_mod, "serper", lambda: Serper())
    agent = make_world(la_db, plan=PLAN)  # no effort chosen: STANDARD
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HELPLINE_HOME, has_form=False)
    _claimed(la_db, cand)
    assert asyncio.run(research.research_candidate(cand["id"])) == "REJECTED"
    assert [(kind, query) for kind, query, _ in seen] == [("maps", "WiNNERS Institute Indore"),
                                                           ("web", "WiNNERS Institute Indore contact number")]
    assert all(isinstance(kw["counter"], search_mod.SearchCounter) and kw["gl"] == "in" for _, _, kw in seen)
    row = _row(la_db, cand["id"])
    assert row["reject_reason"] == "No reachable contact after the website, Google Maps and 1 contact search"
    assert row["lead_json"] is not None and row["lead_json"]["fetch"]["contact_hunt_searches"] == 1


def test_a_basic_agent_spends_no_extra_search(la_db, scripted, monkeypatch):
    seen = []

    class Serper:
        available = True

        async def search(self, query, **kw):
            seen.append(query)
            return []

        async def maps(self, query, **kw):
            seen.append(query)
            return []
    monkeypatch.setattr(search_mod, "serper", lambda: Serper())
    agent = make_world(la_db, plan=PLAN)
    with la_db() as db:
        store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {**research.DEFAULT_GATE, "effort": "BASIC"}})
        db.commit()
    cand = make_candidate(la_db, agent, "winnersinstitute.in", status="READY")
    _page(la_db, cand, "https://winnersinstitute.in/", "home", HELPLINE_HOME, has_form=False)
    _claimed(la_db, cand)
    asyncio.run(research.research_candidate(cand["id"]))
    assert seen == [] and _row(la_db, cand["id"])["reject_reason"].startswith("No usable contact")
