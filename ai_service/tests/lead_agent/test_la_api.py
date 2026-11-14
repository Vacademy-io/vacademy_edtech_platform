"""The Lead Agent API through FastAPI's TestClient on real Postgres, with the
pinned-principal dependency overridden: agent CRUD + validation, candidates and
decisions, suppressions, workers, the extension protocol (pair -> hello ->
claim -> result -> revoke -> 401), and the role / allowlist gates."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from conftest import AUDIENCE, BRIEF, INSTITUTE, make_candidate, make_world
from app.core.security import get_pinned_principal
from app.routers import lead_agent as la_router
from app.schemas.auth import PinnedPrincipal
from app.services.lead_agent import delivery, flags, store

BASE = "/lead-agent/v1"
HOME_HTML = ("<html><body><h1>WiNNERS Institute</h1><p>JEE coaching in Indore since 2004, admissions open.</p>"
             "<p>We teach physics, chemistry and maths to students preparing for JEE Main and Advanced.</p>"
             "<p>Call +91 98765 12345 or write to info@winners.example.in for the 2027 batch details.</p>"
             "<a href='/contact'>Contact</a></body></html>")


@pytest.fixture
def client(la_db):
    state = {"roles": ["ADMIN"], "institute": INSTITUTE}
    app = FastAPI()
    app.include_router(la_router.router)
    app.dependency_overrides[get_pinned_principal] = lambda: PinnedPrincipal(
        user_id="user-1", institute_id=state["institute"], roles=state["roles"], is_root_user=True)
    with la_db() as db:
        db.execute(text("INSERT INTO institutes (id, name) VALUES (:i, 'Test Institute')"), {"i": INSTITUTE})
        db.execute(text("INSERT INTO audience (id, institute_id, campaign_name) VALUES (:a, :i, 'Coaching leads'), "
                        "('aud-other', 'inst-other', 'Not yours')"), {"a": AUDIENCE, "i": INSTITUTE})
        db.commit()
    c = TestClient(app)
    c.state = state
    return c


def body(**over):
    b = {"audience_id": AUDIENCE, "name": "Indore coaching", "brief": BRIEF,
         "markets": [{"country": "India", "city": "Indore"}], "daily_quota": 10, "mode": "AUTO"}
    b.update(over)
    return b


def test_agent_crud_and_shape(client):
    r = client.post(f"{BASE}/agents", json=body())
    assert r.status_code == 201, r.text
    a = r.json()
    assert a["status"] == "PAUSED" and a["audience_name"] == "Coaching leads"
    assert a["brief"]["industries"][0]["search_term"] == "coaching institute"
    assert a["gate"]["auto_score"] == 70 and a["window"]["tz"] == "Asia/Kolkata"
    assert a["gate"]["send_score"] == 50 and a["gate"]["require_approval"] is False
    assert "brief_json" not in a and "plan_json" not in a
    assert a["today"] == {"delivered": 0, "review": 0, "rejected": 0} and a["workers_online"] == 0
    assert client.post(f"{BASE}/agents", json=body()).status_code == 409          # one live agent per list
    r = client.put(f"{BASE}/agents/{a['id']}", json={"daily_quota": 25, "gate": {"auto_score": 80, "review_score": 50}})
    assert r.status_code == 200 and r.json()["daily_quota"] == 25 and r.json()["gate"]["review_score"] == 50
    r = client.post(f"{BASE}/agents/{a['id']}/status", json={"status": "ACTIVE"})
    assert r.json()["status"] == "ACTIVE"
    lst = client.get(f"{BASE}/agents").json()
    assert [x["id"] for x in lst] == [a["id"]] and lst[0]["review_waiting"] == 0
    assert client.get(f"{BASE}/agents/{a['id']}").json()["name"] == "Indore coaching"


@pytest.mark.parametrize("over", [
    {"daily_quota": 0}, {"daily_quota": 201},
    {"markets": [{"country": "India"}] * 6}, {"markets": []},
    {"brief": {**BRIEF, "industries": [{"name": f"I{i}", "search_term": f"t{i}"} for i in range(7)]}},
    {"brief": {**BRIEF, "industries": []}},
    {"gate": {"auto_score": 40, "review_score": 60}}, {"gate": {"auto_score": 101}},
    {"gate": {"send_score": 101}}, {"gate": {"send_score": -1}}, {"gate": {"require_approval": "maybe"}},
    {"window": {"tz": "Mars/Base", "start": "09:00", "end": "18:00", "days": [1]}},
    {"window": {"tz": "Asia/Kolkata", "start": "9am", "end": "18:00", "days": [1]}},
    {"window": {"tz": "Asia/Kolkata", "start": "09:00", "end": "18:00", "days": [8]}},
    {"mode": "CLOUD"}, {"monthly_credit_cap": -1},
    {"brief": {**BRIEF, "products": [], "offer": None}},                                # nothing said about what is sold
    {"brief": {**BRIEF, "offer": {"name": "  "}}},
    {"brief": {**BRIEF, "offer": {"name": "Solar", "competitors": [{"name": "X", "domain": "not a domain"}]}}},
    {"brief": {**BRIEF, "offer": {"name": "Solar", "fit_signals": [{"label": "a", "weight": 5}]}}},
])
def test_create_validation(client, over):
    assert client.post(f"{BASE}/agents", json=body(**over)).status_code == 422


def test_long_suggested_lists_keep_their_first_items(client):
    brief = {**BRIEF, "buyer_roles": [f"Role {i}" for i in range(16)], "hiring_roles": [f"job {i}" for i in range(9)],
             "keywords": ["need lms", "Need  LMS"] + [f"kw {i}" for i in range(14)]}
    r = client.post(f"{BASE}/agents", json=body(brief=brief))
    assert r.status_code == 201, r.text
    saved = r.json()["brief"]
    assert saved["buyer_roles"] == [f"Role {i}" for i in range(10)] and len(saved["hiring_roles"]) == 6
    assert saved["keywords"][:2] == ["need lms", "kw 0"] and len(saved["keywords"]) == 10
    r = client.put(f"{BASE}/agents/{r.json()['id']}",
                   json={"brief": {**BRIEF, "hiring_roles": ["hiring telecaller", "Hiring faculty for coaching institute"]}})
    assert r.json()["brief"]["hiring_roles"] == ["telecaller", "faculty"]  # roles, not job-post phrases


def test_an_offer_is_saved_with_keys_and_an_older_brief_reads_back_with_one(client):
    offer = {"name": " Rooftop  solar ", "seller": "SunGrid",
             "fit_signals": [{"label": "Owns a warehouse", "description": "Runs its own warehouse.", "weight": 3},
                             {"label": "owns a warehouse", "weight": 1}, {"label": "Cold storage", "weight": 2}],
             "competitors": [{"name": "Tata Power Solar", "domain": "https://www.TataPowerSolar.com/x"}],
             "competitor_kinds": ["crm", "crm"]}
    r = client.post(f"{BASE}/agents", json=body(brief={**BRIEF, "products": [], "offer": offer}))
    assert r.status_code == 201, r.text
    saved = r.json()["brief"]["offer"]
    assert saved["name"] == "Rooftop solar" and saved["competitor_kinds"] == ["crm"]
    assert [(s["key"], s["label"]) for s in saved["fit_signals"]] == [("fit_1", "Owns a warehouse"), ("fit_2", "Cold storage")]
    assert saved["competitors"] == [{"name": "Tata Power Solar", "domain": "tatapowersolar.com"}]

    r = client.put(f"{BASE}/agents/{r.json()['id']}", json={"brief": {**BRIEF, "products": ["lms"]}})
    assert r.status_code == 200, r.text
    derived = r.json()["brief"]["offer"]
    assert derived["name"] == "LMS" and derived["education"] is True and derived["fit_signals"]


def test_another_institutes_list_is_refused(client):
    assert client.post(f"{BASE}/agents", json=body(audience_id="aud-other")).status_code == 404


def test_roles_and_allowlist(client, monkeypatch):
    client.state["roles"] = ["TEACHER"]
    assert client.get(f"{BASE}/agents").status_code == 200                       # staff reads
    assert client.post(f"{BASE}/agents", json=body()).status_code == 403         # only admins write
    client.state["roles"] = ["STUDENT"]
    assert client.get(f"{BASE}/agents").status_code == 403                       # root learner: still no
    client.state["roles"] = ["ADMIN"]
    monkeypatch.setattr(flags, "available", lambda i: False)
    r = client.get(f"{BASE}/agents")
    assert r.status_code == 403 and r.json()["detail"]["code"] == "not_available"


def test_candidates_and_decisions(client, la_db):
    agent = make_world(la_db)
    review = make_candidate(la_db, agent, "a.in", status="REVIEW", score=60, decision="REVIEW",
                            score_json={"score": 60, "fit": 70, "intent": 40, "reach": 60, "risk": 10,
                                        "flags": ["competitor_platform:appx"], "reasons": ["Uses Appx"]},
                            lead_json={"organisation": {"name": "A", "city": "Indore"},
                                       "contacts": [{"kind": "institute_phone", "value": "+91 98765 12345",
                                                     "quality": "likely"}],
                                       "contact_quality": {"level": "likely", "label": "Desk mobile"},
                                       "evidence": [{"field": "x", "quote": "y", "url": "z"}]})
    other = make_candidate(la_db, agent, "b.in", status="REVIEW", score=50)
    page = client.get(f"{BASE}/agents/{agent['id']}/candidates", params={"status": "REVIEW"}).json()
    assert page["total"] == 2 and page["items"][0]["id"] == review["id"]
    item = page["items"][0]
    assert item["score_parts"] == {"fit": 70, "intent": 40, "reach": 60, "risk": 10}
    assert item["flags"] == ["competitor_platform:appx"] and item["top_reason"] == "Uses Appx"
    assert item["best_contact"]["quality"] == "likely" and item["org"]["domain"] == "a.in"
    detail = client.get(f"{BASE}/candidates/{review['id']}").json()
    assert detail["evidence"] == [{"field": "x", "quote": "y", "url": "z"}]
    r = client.post(f"{BASE}/candidates/{review['id']}/decision", json={"action": "APPROVE"})
    assert r.status_code == 200 and r.json()["status"] == "APPROVED" and r.json()["reviewed_by"] == "user-1"
    assert client.post(f"{BASE}/candidates/{review['id']}/decision", json={"action": "APPROVE"}).status_code == 409
    r = client.post(f"{BASE}/candidates/bulk-decision", json={"ids": [review["id"], other["id"]], "action": "REJECT",
                                                              "reason": "Too big"})
    assert r.json() == {"updated": 2}
    assert client.get(f"{BASE}/candidates/{other['id']}").json()["reject_reason"] == "Too big"
    stats = client.get(f"{BASE}/agents/{agent['id']}/stats", params={"days": 7}).json()
    assert stats == []


def test_a_card_shows_what_delivery_will_send_and_skipped_duplicates_list_with_rejects(client, la_db):
    agent = make_world(la_db)
    # The first usable contact (a desk landline) is not what goes out: delivery sends the likely mobile
    # from the Google Maps listing, the organisation's own inbox over an unnamed Gmail, and asks for the
    # decision maker because the phone sent is nobody's own line.
    lead = {"organisation": {"name": "Alpha Academy", "domain": "a.in", "city": "Indore"}, "phone_region": "IN",
            "decision_maker": {"name": "Meena Iyer", "role": "Founder"},
            "contact_quality": {"level": "likely", "label": "Best-rated contact"},
            "contacts": [
                {"kind": "institute_phone", "value": "+91 80 4567 8901", "quality": "general",
                 "quality_note": "front desk landline"},
                {"kind": "published_email", "value": "rk1980@gmail.com", "quality": "likely", "owner": "free"},
                {"kind": "institute_phone", "value": "+91 98290 55555", "quality": "likely",
                 "quality_note": "desk mobile on its Google Maps listing", "found_by": "google_maps"},
                {"kind": "published_email", "value": "info@a.in", "quality": "general", "owner": "own",
                 "quality_note": "the organisation's own inbox"}]}
    sent = make_candidate(la_db, agent, "a.in", status="REVIEW", score=60, decision="REVIEW", lead_json=lead,
                          score_json={"score": 60, "flags": [], "reasons": ["Fits"]})
    item = client.get(f"{BASE}/agents/{agent['id']}/candidates", params={"status": "REVIEW"}).json()["items"][0]
    assert item["best_contact"] == {"kind": "institute_phone", "value": "+91 98290 55555", "quality": "likely",
                                    "label": "desk mobile on its Google Maps listing"}
    assert item["send"] == {
        "phone": {"value": "+91 98290 55555", "quality": "likely", "quality_note": "desk mobile on its Google Maps listing",
                  "maps_confirmed": False, "from_maps": True},
        "email": {"value": "info@a.in", "quality": "general", "quality_note": "the organisation's own inbox",
                  "owner": "own"},
        "name": "Alpha Academy", "role": None, "ask_for": "Meena Iyer (Founder)"}
    assert item["maps_only"] is False and item["duplicate_of"] is None
    row = delivery.build_row(sent)
    assert (row["mobile"], row["email"], row["full_name"], row["custom_fields"]["la_ask_for"]) == (
        "+919829055555", "info@a.in", "Alpha Academy", "Meena Iyer (Founder)")

    # The same organisation under another domain is SKIPPED by research; it lists with the rejects.
    note = "Same organisation as a.in: both show phone 9829055555"
    dup = make_candidate(la_db, agent, "a-academy.in", status="SKIPPED", score=58, decision="REVIEW",
                         delivery_note=note, lead_json={**lead, "maps_only": True},
                         score_json={"score": 58, "flags": ["maps_only"], "reasons": [note],
                                     "duplicate_of": {"candidate_id": sent["id"], "domain": "a.in", "shared": []}})
    bare = make_candidate(la_db, agent, "b.in", status="REJECTED", reject_reason="No readable page")
    page = client.get(f"{BASE}/agents/{agent['id']}/candidates", params={"status": "REJECTED,SKIPPED"}).json()
    assert page["total"] == 2
    by_id = {i["id"]: i for i in page["items"]}
    assert by_id[dup["id"]]["status"] == "SKIPPED" and by_id[dup["id"]]["duplicate_of"] == "a.in"
    assert by_id[dup["id"]]["delivery_note"] == note and by_id[dup["id"]]["maps_only"] is True
    assert by_id[bare["id"]]["send"] is None and by_id[bare["id"]]["best_contact"] is None  # nothing to send
    assert client.get(f"{BASE}/candidates/{dup['id']}").json()["send"]["phone"]["from_maps"] is True


def test_a_new_gate_passes_the_waiting_leads_it_now_accepts(client, la_db):
    agent = make_world(la_db)
    lead = {"organisation": {"name": "A", "city": "Indore"},
            "contacts": [{"kind": "institute_phone", "value": "+91 98765 12345", "quality": "likely"}],
            "contact_quality": {"level": "likely", "label": "Desk mobile"}}
    scored = {"risk": 0, "flags": [], "has_intent": False, "reach_level": "likely"}
    plain = make_candidate(la_db, agent, "a.in", status="REVIEW", score=55, decision="REVIEW", lead_json=lead,
                           score_json={**scored, "score": 55, "base_score": 55})
    switcher = make_candidate(la_db, agent, "b.in", status="REVIEW", score=40, decision="REVIEW", lead_json=lead,
                              score_json={**scored, "score": 40, "base_score": 60, "risk": 40,
                                          "flags": ["competitor_platform:appx"]})
    big = make_candidate(la_db, agent, "c.in", status="REVIEW", score=50, decision="REVIEW", lead_json=lead,
                         score_json={**scored, "score": 50, "base_score": 65, "risk": 30, "flags": ["enterprise"]})

    def status_of(c):
        return client.get(f"{BASE}/candidates/{c['id']}").json()["status"]

    r = client.put(f"{BASE}/agents/{agent['id']}", json={"gate": {"send_score": 55, "require_approval": True}})
    # with approval on nothing moves: every waiting lead waits for a person
    assert r.status_code == 200 and r.json()["review_waiting"] == 3
    r = client.put(f"{BASE}/agents/{agent['id']}",
                   json={"gate": {"require_approval": False, "auto_competitor_users": True}})
    # effort: the gate's validation effort level (effort.py), STANDARD when never set; auto_score and
    # review_score (the bars before rank and fill, 2026-10-30) are kept as saved and decide nothing
    assert r.json()["gate"] == {"send_score": 55, "require_approval": False, "auto_score": 70, "review_score": 45,
                                "min_contact": "likely", "require_intent": False, "auto_competitor_users": True,
                                "effort": "STANDARD"}
    # saving the gate judges the waiting leads at once (scheduler.rejudge_waiting): the plain lead and the
    # competitor's user (judged without that penalty now) clear the bar, the very large one (50 after its
    # penalty) is rejected
    assert [status_of(c) for c in (plain, switcher, big)] == ["APPROVED", "APPROVED", "REJECTED"]
    assert r.json()["review_waiting"] == 0
    with la_db() as db:
        row = store.get_candidate(db, switcher["id"])
        gone = store.get_candidate(db, big["id"])
    assert row["decision"] == "AUTO" and row["reviewed_by"] is None
    assert "competitor" in row["score_json"]["gate_reasons"][1]
    assert "below the send bar (55)" in gone["reject_reason"]
    # saving the old bars from a screen that does not know the new settings keeps them
    r = client.put(f"{BASE}/agents/{agent['id']}", json={"gate": {"auto_score": 60, "review_score": 45,
                                                                   "min_contact": "likely", "require_intent": False}})
    gate = r.json()["gate"]
    assert gate["auto_competitor_users"] is True and gate["auto_score"] == 60 and gate["send_score"] == 55
    # a merge that breaks the old bars' order is still refused, not saved
    r = client.put(f"{BASE}/agents/{agent['id']}", json={"gate": {"review_score": 65}})
    assert r.status_code == 422 and client.get(f"{BASE}/agents/{agent['id']}").json()["gate"]["review_score"] == 45
    r = client.put(f"{BASE}/agents/{agent['id']}", json={"gate": {"require_approval": True}})
    assert r.json()["gate"]["require_approval"] is True and r.json()["gate"]["send_score"] == 55


def test_an_agent_saved_before_rank_and_fill_shows_the_default_send_bar(client, la_db):
    agent = make_world(la_db)
    with la_db() as db:  # the gate as V612 stored it, before send_score / require_approval (2026-10-30)
        store.update_agent(db, agent["id"], INSTITUTE, {"gate_json": {
            "auto_score": 70, "review_score": 45, "min_contact": "likely", "require_intent": False,
            "auto_competitor_users": False}})
        db.commit()
    gate = client.get(f"{BASE}/agents/{agent['id']}").json()["gate"]
    assert gate == {"send_score": 50, "require_approval": False, "auto_score": 70, "review_score": 45,
                    "min_contact": "likely", "require_intent": False, "auto_competitor_users": False,
                    "effort": "STANDARD"}


def test_suppressions_normalise(client):
    r = client.post(f"{BASE}/suppressions", json={"kind": "DOMAIN", "value": "https://WWW.Allen.in/kota",
                                                  "reason": "COMPETITOR"})
    assert r.status_code == 201 and r.json()["value"] == "allen.in"
    assert client.post(f"{BASE}/suppressions", json={"kind": "PHONE", "value": "+91 98765-12345"}).json()["value"] \
        == "9876512345"
    assert client.post(f"{BASE}/suppressions", json={"kind": "EMAIL", "value": "nope"}).status_code == 422
    rows = client.get(f"{BASE}/suppressions").json()
    assert len(rows) == 2
    assert client.delete(f"{BASE}/suppressions/{rows[0]['id']}").json() == {"deleted": True}
    assert len(client.get(f"{BASE}/suppressions").json()) == 1


def test_extension_protocol(client, la_db):
    paired = client.post(f"{BASE}/workers/pair", json={"label": "Office Chrome"}).json()
    token, worker_id = paired["token"], paired["worker_id"]
    assert len(token) >= 40
    with la_db() as db:   # only the hash is stored
        assert db.execute(text("SELECT count(*) FROM lead_agent_worker WHERE token_hash = :t"), {"t": token}).scalar() == 0
    h = {"X-Lead-Agent-Token": token}
    assert client.post(f"{BASE}/ext/hello", json={"version": "1.0.0"}).status_code == 401
    assert client.post(f"{BASE}/ext/hello", json={"version": "1.0.0"}, headers={"X-Lead-Agent-Token": "x" * 43}
                       ).status_code == 401
    hello = client.post(f"{BASE}/ext/hello", json={"version": "1.0.0"}, headers=h).json()
    assert hello["worker_id"] == worker_id and hello["institute_name"] == "Test Institute"
    assert hello["paused"] is True                      # no ACTIVE local/auto agent yet

    agent = make_world(la_db, mode="LOCAL")
    cand = make_candidate(la_db, agent, "winners.example.in")
    with la_db() as db:
        from app.services.lead_agent import fetcher
        fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent)
        db.commit()
    assert client.post(f"{BASE}/ext/hello", json={}, headers=h).json()["paused"] is False
    claim = client.post(f"{BASE}/ext/claim", json={"max": 4}, headers=h).json()
    assert len(claim["tasks"]) == 1 and claim["tasks"][0]["render"] == "fetch" and claim["lease_s"] == 120
    workers = client.get(f"{BASE}/workers").json()
    assert workers[0]["online"] is True and workers[0]["version"] == "1.0.0"
    task_id = claim["tasks"][0]["id"]
    r = client.post(f"{BASE}/ext/result", headers=h, json={
        "task_id": task_id, "ok": True, "status_code": 200, "final_url": "https://winners.example.in/",
        "content_type": "text/html", "html": HOME_HTML})
    assert r.json() == {"accepted": True}
    assert client.post(f"{BASE}/ext/result", headers=h, json={"task_id": task_id, "ok": True}).json() == \
        {"accepted": False}                             # already done
    with la_db() as db:
        page = db.execute(text("SELECT access, fetched_by, fetched_institute_id FROM lead_org_page")).first()
        assert tuple(page) == ("ok", "EXTENSION", INSTITUTE)   # private to this institute
        assert db.execute(text("SELECT pages_today FROM lead_agent_worker")).scalar() == 1
    assert client.get(f"{BASE}/workers").json()[0]["pages_today"] == 1
    assert client.delete(f"{BASE}/workers/{worker_id}").json() == {"revoked": True}
    assert client.post(f"{BASE}/ext/claim", json={"max": 1}, headers=h).status_code == 401


def test_thin_page_is_asked_again_in_a_tab(client, la_db):
    token = client.post(f"{BASE}/workers/pair", json={}).json()["token"]
    h = {"X-Lead-Agent-Token": token}
    agent = make_world(la_db, mode="LOCAL")
    cand = make_candidate(la_db, agent, "spa.example.in")
    with la_db() as db:
        from app.services.lead_agent import fetcher
        fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent)
        db.commit()
    t = client.post(f"{BASE}/ext/claim", json={"max": 1}, headers=h).json()["tasks"][0]
    client.post(f"{BASE}/ext/result", headers=h, json={"task_id": t["id"], "ok": True, "status_code": 200,
                                                       "content_type": "text/html",
                                                       "html": "<html><body><div id=root></div><script src=a.js></script></body></html>"})
    again = client.post(f"{BASE}/ext/claim", json={"max": 1}, headers=h).json()["tasks"]
    assert again and again[0]["id"] == t["id"] and again[0]["render"] == "tab"


def test_daily_page_cap(client, la_db, monkeypatch):
    token = client.post(f"{BASE}/workers/pair", json={}).json()["token"]
    agent = make_world(la_db, mode="LOCAL")
    cand = make_candidate(la_db, agent, "cap.example.in")
    with la_db() as db:
        from app.services.lead_agent import fetcher
        fetcher.schedule_candidate(db, store.get_candidate(db, cand["id"]), agent)
        db.execute(text("UPDATE lead_agent_worker SET pages_today = 300, pages_day = (now() AT TIME ZONE 'UTC')::date"))
        db.commit()
    assert client.post(f"{BASE}/ext/claim", json={"max": 2}, headers={"X-Lead-Agent-Token": token}).json()["tasks"] == []


def test_extension_bodies_are_capped_before_parsing(client):
    token = client.post(f"{BASE}/workers/pair", json={}).json()["token"]
    h = {"X-Lead-Agent-Token": token, "Content-Type": "application/json"}
    big = b'{"task_id": "t", "ok": true, "html": "' + b"x" * (la_router.MAX_EXT_BODY + 10) + b'"}'
    r = client.post(f"{BASE}/ext/result", content=big, headers=h)
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_large"

    def chunks():   # no Content-Length: counted while it streams
        yield b'{"task_id": "t", "ok": true, "html": "'
        for _ in range(30):
            yield b"y" * 100_000
        yield b'"}'
    r = client.post(f"{BASE}/ext/result", content=chunks(), headers=h)
    assert r.status_code == 413
    r = client.post(f"{BASE}/ext/result", headers={"X-Lead-Agent-Token": token},
                    json={"task_id": "t", "ok": True, "html": "z" * 1_600_001})
    assert r.status_code == 422                          # under the byte cap, over the field cap
    assert client.post(f"{BASE}/ext/result", headers={"X-Lead-Agent-Token": token},
                       json={"task_id": "t", "ok": True, "html": "<html></html>"}).json() == {"accepted": False}


def test_a_suggestion_needs_credits_and_is_charged_to_the_user(client, monkeypatch):
    from types import SimpleNamespace

    from app.services.lead_agent import llm

    calls = []

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=0):
        calls.append(ctx)
        return {"summary": "Rooftop solar for factories.", "industries": [], "description": "Solar for factories."}
    monkeypatch.setattr(llm, "ask", fake_ask)
    monkeypatch.setattr(la_router, "_suggest_credits", lambda db, i, u: SimpleNamespace(has_sufficient_credits=False))
    r = client.post(f"{BASE}/brief/suggest", json={"name": "Rooftop solar"})
    assert r.status_code == 402 and r.json()["detail"]["code"] == "no_credits" and calls == []   # nothing spent
    monkeypatch.setattr(la_router, "_suggest_credits", lambda db, i, u: SimpleNamespace(has_sufficient_credits=True))
    r = client.post(f"{BASE}/brief/suggest", json={"name": "Rooftop solar"})
    assert r.status_code == 200 and r.json()["description"] == "Solar for factories."
    assert (calls[0].charge, calls[0].institute_id, calls[0].user_id) == (True, INSTITUTE, "user-1")
