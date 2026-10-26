"""Discovery with the REAL engine discover() and fake Serper / LLM: candidates by
registered domain (directories and suppressed or known domains skipped), home
tasks in the agent's mode, the Maps lane, the cursor moving on, the next round
finding nothing it already has."""
from __future__ import annotations

import asyncio
import sys
import re

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, PLAN, make_world
from app.services.lead_agent import discovery, llm, store
from app.services.lead_agent import search as search_mod
from app.services.lead_agent.search import SearchResult

ORG_RESULTS = [
    ("WiNNERS Institute - JEE Coaching Indore", "https://www.winnersinstitute.in/jee"),
    ("Best 10 JEE coaching in Indore - Justdial", "https://www.justdial.com/Indore/jee"),
    ("Pulse Academy | NEET coaching", "https://pulseacademy.co.in/"),
    ("Blocked Classes Indore", "https://blockedclasses.in/"),
]


class FakeSerper:
    available = True

    def __init__(self):
        self.queries = []

    async def search(self, query, *, gl=None, location=None, num=10, page=1, counter=None):
        self.queries.append((query, page))
        return [SearchResult(query=query, rank=i, title=t, url=u, snippet=f"{t} in Indore. Call now.")
                for i, (t, u) in enumerate(ORG_RESULTS, start=1)]

    async def maps(self, query, *, gl=None, location=None, page=1, counter=None):
        return [{"title": "IIT-PULSE Indore", "website": "http://www.iitpulse.com/", "phone": "+91 98937 04288",
                 "rating": 4.8, "reviews": 890, "address": "AB Rd, Indore", "type": "Coaching center"},
                {"title": "No Website Tutor", "website": None, "phone": "+91 90000 00000"}]


@pytest.fixture
def fakes(monkeypatch):
    serper = FakeSerper()
    monkeypatch.setattr(search_mod, "serper", lambda: serper)

    class NoParallel:
        available = False
    monkeypatch.setattr(search_mod, "parallel", lambda: NoParallel())

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        if output.__name__ == "DiscoverySelection":
            picks = []
            for m in re.finditer(r"^\[(\d+)\] ([^|]+)\|", user, re.M):
                if "justdial" not in m.group(0).lower():
                    picks.append({"result_id": int(m.group(1)), "name": m.group(2).split(" - ")[0].strip(),
                                  "reason": "own site"})
            return output.model_validate({"organisations": picks})
        if output.__name__ == "SignalSelection":
            return output.model_validate({"findings": []})
        raise AssertionError(output.__name__)
    monkeypatch.setattr(llm, "ask", fake_ask)
    return serper


def _rows(la_db, sql):
    with la_db() as db:
        return db.execute(text(sql)).fetchall()


def test_a_round_creates_candidates_and_moves_the_cursor(la_db, fakes):
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    with la_db() as db:
        store.insert_suppression(db, institute_id=INSTITUTE, kind="DOMAIN", value="blockedclasses.in",
                                 reason="CUSTOMER", note=None, created_by="u")
        db.commit()
        agent = store.get_agent(db, agent["id"])
    out = asyncio.run(discovery.run_round(agent, agent["plan_json"], 10))
    domains = {r[0]: r[1] for r in _rows(la_db, "SELECT o.domain, c.source FROM lead_candidate c "
                                                "JOIN lead_org o ON o.id = c.org_id")}
    assert domains == {"winnersinstitute.in": "organisation_search", "pulseacademy.co.in": "organisation_search",
                       "iitpulse.com": "maps"}
    assert out["created"] == 3
    tasks = _rows(la_db, "SELECT url, page_type, mode FROM lead_fetch_task ORDER BY url")
    assert all(t[1] == "home" and t[2] == "REMOTE" for t in tasks) and len(tasks) == 3
    assert ("http://www.iitpulse.com/", "home", "REMOTE") in tasks
    maps = _rows(la_db, "SELECT discovery_json->'maps'->>'reviews' FROM lead_candidate WHERE source = 'maps'")
    assert maps == [("890",)]
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
        assert db.execute(text("SELECT discovered FROM lead_agent_day")).scalar() == 3
    cursor = agent["cursor_json"]
    assert cursor["rounds"] == 1 and cursor["org_idx"] == 0 and cursor["org_page"] == 2  # 2 queries: wrapped
    assert {q for q, _p in fakes.queries} >= set(PLAN["search_queries"])

    # next round: the next results page, nothing new from the same results
    out2 = asyncio.run(discovery.run_round(agent, agent["plan_json"], 10))
    assert out2["created"] == 0
    assert any(p == 2 for _q, p in fakes.queries)
    assert len(_rows(la_db, "SELECT id FROM lead_candidate")) == 3


def test_the_same_organisation_on_another_domain_is_not_added_twice(la_db, fakes, monkeypatch):
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    asyncio.run(discovery.run_round(agent, agent["plan_json"], 10))
    monkeypatch.setattr(sys.modules[__name__], "ORG_RESULTS",
                        [("Pulse Academy | NEET coaching Indore", "https://pulseacademy-indore.in/"),
                         ("Zenith Classes | JEE", "https://zenithclasses.in/")])
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    asyncio.run(discovery.run_round(agent, agent["plan_json"], 10))
    domains = {r[0] for r in _rows(la_db, "SELECT o.domain FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id")}
    assert "zenithclasses.in" in domains and "pulseacademy-indore.in" not in domains


def test_round_limit_per_day(la_db, fakes):
    agent = make_world(la_db, plan=PLAN)
    from app.services.lead_agent import pacing
    agent["cursor_json"] = {"day": pacing.agent_day(agent["window_json"]).isoformat(),
                            "rounds": discovery.MAX_ROUNDS_PER_DAY}
    assert asyncio.run(discovery.run_round(agent, agent["plan_json"], 5)) == {"skipped": "round limit for today"}
    assert fakes.queries == []
