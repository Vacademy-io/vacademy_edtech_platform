"""Research of one candidate with the REAL engine (extraction prompt, build_lead,
fingerprint, scoring, gate) and a scripted LLM / search: free rejects spend no
LLM call; a researched lead is saved with lead_json / score_json / decision; an
LLM outage puts the candidate back with a back-off."""
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
