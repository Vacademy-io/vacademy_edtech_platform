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
from app.services.lead_agent import flags, store

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
