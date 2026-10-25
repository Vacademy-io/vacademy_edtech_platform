"""Fixtures for the Lead Agent orchestration tests (test_la_*.py). Nothing here is
autouse, so the engine tests under engine/ are unaffected."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))   # ai_service/ (import app.*)
sys.path.insert(0, str(HERE))              # la_pg


@pytest.fixture(scope="session")
def la_factory():
    from la_pg import pg_session_factory

    factory = pg_session_factory()
    yield factory
    factory.close()


@pytest.fixture
def la_db(la_factory, monkeypatch):
    """A clean scratch database that every lead_agent session uses; the platform
    switch on and every institute allowed."""
    from app.services.lead_agent import db as ladb
    from app.services.lead_agent import flags

    la_factory.reset()
    ladb.use_sessionmaker(la_factory)
    monkeypatch.setattr(flags, "platform_enabled", lambda: True)
    monkeypatch.setattr(flags, "allowed_institutes", lambda: flags.ALL_INSTITUTES)
    monkeypatch.setattr(flags, "institute_allowed", lambda i: bool(i))
    monkeypatch.setattr(flags, "available", lambda i: bool(i))
    monkeypatch.setattr(flags, "max_concurrency", lambda: 2)
    yield la_factory
    ladb.use_sessionmaker(None)


INSTITUTE = "inst-1"
AUDIENCE = "aud-1"


def make_world(factory, *, mode: str = "AUTO", quota: int = 5, status: str = "ACTIVE",
               window: Dict[str, Any] | None = None, plan: Dict[str, Any] | None = None) -> Dict[str, Any]:
    from sqlalchemy import text

    from app.services.lead_agent import store

    with factory() as db:
        db.execute(text("INSERT INTO institutes (id, name) VALUES (:i, 'Test Institute') ON CONFLICT DO NOTHING"),
                   {"i": INSTITUTE})
        db.execute(text("INSERT INTO audience (id, institute_id, campaign_name) VALUES (:a, :i, 'Coaching leads') "
                        "ON CONFLICT DO NOTHING"), {"a": AUDIENCE, "i": INSTITUTE})
        agent = store.insert_agent(
            db, institute_id=INSTITUTE, audience_id=AUDIENCE, name="Agent", brief=BRIEF,
            markets=[{"country": "India", "state": "Madhya Pradesh", "city": "Indore"}], daily_quota=quota,
            monthly_credit_cap=None, mode=mode, gate=None,
            window=window or {"tz": "Asia/Kolkata", "start": "00:00", "end": "23:59", "days": [1, 2, 3, 4, 5, 6, 7]},
            created_by="user-1")
        agent = store.update_agent(db, agent["id"], INSTITUTE, {"status": status})
        if plan is not None:
            store.set_plan(db, agent["id"], plan, "h")
            agent = store.get_agent(db, agent["id"])
        db.commit()
    return agent


def make_candidate(factory, agent: Dict[str, Any], domain: str = "winners.example.in",
                   status: str | None = None, **fields) -> Dict[str, Any]:
    from app.services.lead_agent import store

    with factory() as db:
        org_id = store.upsert_org(db, domain=domain, name=domain.split(".")[0].title(),
                                  website=f"https://{domain}/", city="Indore")
        cid = store.insert_candidate(db, agent_id=agent["id"], institute_id=agent["institute_id"], org_id=org_id,
                                     source="organisation_search", discovery={"query": "q"})
        if status or fields:
            store.set_candidate(db, cid, **({"status": status} if status else {}), **fields)
        db.commit()
        return store.get_candidate(db, cid)


BRIEF = {
    "products": ["complete_vacademy"], "description": "LMS + CRM for coaching institutes",
    "industries": [{"name": "Coaching institutes", "search_term": "coaching institute"}],
    "buyer_roles": ["founder", "director"], "hiring_roles": ["telecaller"], "keywords": ["looking for LMS"],
    "must_have": [], "deal_breakers": ["schools"], "exclude": ["Schools & playschools"],
    "sources": ["organisation_search", "maps"], "find_contacts": True,
}

PLAN = {
    "summary": "Coaching institutes in Indore", "segment": "coaching institutes", "locations": ["Indore"],
    "target_products": ["complete_vacademy"], "candidate_count": 20, "priority_signals": [], "buyer_roles": ["founder"],
    "search_queries": ["JEE coaching institute Indore", "NEET coaching Indore"], "hiring_roles": ["telecaller"],
    "keywords": [], "search_term": "coaching institute", "page_types": ["home"], "assumptions": [],
    "not_possible": [], "places": ["Indore"], "match_places": ["Indore"],
    "industries_detail": [{"name": "Coaching institutes", "search_term": "coaching institute"}],
}
