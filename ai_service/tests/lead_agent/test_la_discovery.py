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

from conftest import BRIEF, INSTITUTE, PLAN, make_world
from app.services.lead_agent import discovery, fetcher, llm, store
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
        self.maps_queries = []

    async def search(self, query, *, gl=None, location=None, num=10, page=1, counter=None):
        self.queries.append((query, page))
        return [SearchResult(query=query, rank=i, title=t, url=u, snippet=f"{t} in Indore. Call now.")
                for i, (t, u) in enumerate(ORG_RESULTS, start=1)]

    async def maps(self, query, *, gl=None, location=None, page=1, counter=None):
        self.maps_queries.append((query, page))
        return [{"title": "IIT-PULSE Indore", "website": "http://www.iitpulse.com/", "phone": "+91 98937 04288",
                 "rating": 4.8, "reviews": 890, "address": "AB Rd, Indore", "type": "Coaching center"},
                {"title": "No Website Tutor", "website": None, "phone": "+91 90000 00000"}]


@pytest.fixture(autouse=True)
def unread_posts(monkeypatch):
    """Job posts are never fetched here: each reads as a board that refuses robots (None)."""
    async def unread(url, state=None):
        return None
    monkeypatch.setattr(fetcher, "read_post", unread)


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


def test_a_bigger_daily_quota_gets_more_rounds(la_db, fakes):
    assert [discovery.round_limit(q) for q in (None, 5, 16, 17, 100, 1000)] == [8, 8, 8, 9, 50, 60]
    agent = make_world(la_db, plan=PLAN, quota=100)
    from app.services.lead_agent import pacing
    agent["cursor_json"] = {"day": pacing.agent_day(agent["window_json"]).isoformat(),
                            "rounds": discovery.MAX_ROUNDS_PER_DAY}
    out = asyncio.run(discovery.run_round(agent, agent["plan_json"], 5))
    assert "skipped" not in out and fakes.queries
    agent["cursor_json"]["rounds"] = 50
    assert asyncio.run(discovery.run_round(agent, agent["plan_json"], 5)) == {"skipped": "round limit for today"}


def test_a_rebuilt_plan_searches_from_the_first_results_page(la_db, fakes):
    agent = make_world(la_db, plan=PLAN)
    asyncio.run(discovery.run_round(agent, agent["plan_json"], 10))
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    assert agent["cursor_json"]["org_page"] == 2
    new_plan = {**PLAN, "search_queries": ["UPSC coaching Indore", "CA coaching Indore", "Bank PO coaching Indore"]}
    fakes.queries.clear()
    asyncio.run(discovery.run_round(agent, new_plan, 10))
    assert fakes.queries == [("UPSC coaching Indore", 1), ("CA coaching Indore", 1), ("Bank PO coaching Indore", 1)]
    # the same plan again: the cursor carries on (wrapped, so the next page)
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    fakes.queries.clear()
    asyncio.run(discovery.run_round(agent, new_plan, 10))
    assert {p for _q, p in fakes.queries} == {2}


def test_a_whole_country_is_searched_on_maps_city_by_city(la_db, fakes):
    agent = make_world(la_db, plan=PLAN)
    agent["markets_json"] = [{"country": "India"}]
    plan = {**PLAN, "places": ["India"], "match_places": None, "industries_detail": [
        {"name": "Coaching institutes", "search_term": "coaching institute"},
        {"name": "Tutoring centres", "search_term": "tutoring centre"}]}
    asyncio.run(discovery.run_round(agent, plan, 10))
    # one place at a time, every industry in it; more searches while the round still needs candidates
    assert fakes.maps_queries == [("coaching institute Delhi", 1), ("tutoring centre Delhi", 1),
                                  ("coaching institute Mumbai", 1)]
    city = _rows(la_db, "SELECT o.city FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id "
                        "WHERE c.source = 'maps'")
    assert city == [("Delhi",)]
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    assert agent["cursor_json"]["maps_idx"] == 3 and agent["cursor_json"]["maps_page"] == 1
    agent["markets_json"] = [{"country": "India"}]
    fakes.maps_queries.clear()
    asyncio.run(discovery.run_round(agent, plan, 10))
    assert fakes.maps_queries[0] == ("tutoring centre Mumbai", 1)


def test_maps_places_only_expand_a_whole_country_we_know():
    from app.services.lead_agent import places
    india = places.maps_places([{"country": "India"}], ["India"])
    assert india[:3] == ["Delhi", "Mumbai", "Bengaluru"] and len(india) == len(places.MAJOR_CITIES["india"])
    assert places.maps_places([{"country": "India", "city": "Indore"}], ["Indore"]) == ["Indore"]
    assert places.maps_places([{"country": "India", "state": "Kerala"}], ["Kerala"]) == ["Kerala"]
    assert places.maps_places([{"country": "Kenya"}], ["Kenya"]) == ["Kenya"]
    assert places.maps_places([], [""]) == [""]
    assert discovery.maps_combos([{"search_term": "a"}, {"name": "b"}], ["X", "", "Y"]) == [
        ("a", "X"), ("b", "X"), ("a", "Y"), ("b", "Y")]


# ------------------------------------------------------------------ validity (2026-10-29 audit of "Leads for Vacademy")

PATHFINDER_POST = ("https://www.glassdoor.co.in/job-listing/admission-counsellor-the-pathfinder-school-"
                   "JV_IC4477_KO0,20_KE21,42.htm?jl=1009512345")
PATHFINDER_SITES = [
    ("Pathfinder Academy | Best school in New Delhi", "https://pathfinderacademy.in/", "CBSE school in Dwarka, New Delhi"),
    ("Pathfinder Global School, Pataudi", "https://www.pathfinderglobalschool.com/", "Day boarding school in Pataudi, Haryana"),
    ("Pathfinder Boarding School", "https://pathfinderboarding.edu.in/", "Residential school near Haldwani, Uttarakhand"),
]


class FakeParallel:
    available = True

    def __init__(self, answer):
        self.queries, self.answer = [], answer

    async def search(self, query, *, objective=None, country=None, counter=None):
        self.queries.append(query)
        return self.answer(query)


def _pathfinder_answer(query):
    if query.startswith("The Pathfinder School"):
        rows = PATHFINDER_SITES
    elif "hiring" in query:
        rows = [("The Pathfinder School hiring Admission Counsellor Job in India | Glassdoor", PATHFINDER_POST,
                 "The Pathfinder School is hiring an Admission Counsellor in Kaladhungi, Uttarakhand.")]
    else:
        rows = []
    return [SearchResult(query=query, rank=i, title=t, url=u, snippet=sn) for i, (t, u, sn) in enumerate(rows, 1)]


def test_one_job_post_becomes_one_organisation_the_one_where_the_job_is(la_db, fakes, monkeypatch):
    """One Glassdoor post became pathfinderacademy.in (New Delhi), pathfinderglobalschool.com (Pataudi) and
    pathfinderboarding.edu.in (Haldwani, next to Kaladhungi) in three rounds."""
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    with la_db() as db:  # an earlier lead: a same-name school elsewhere must not block the right one
        org = store.upsert_org(db, domain="pathfinderacademy.in", name="Pathfinder Academy",
                               website="https://pathfinderacademy.in/", city="New Delhi")
        store.insert_candidate(db, agent_id=agent["id"], institute_id=INSTITUTE, org_id=org,
                               source="organisation_search", discovery={"query": "school India"})
        db.commit()
    agent["brief_json"] = {**BRIEF, "sources": ["hiring"]}
    agent["markets_json"] = [{"country": "India"}]
    plan = {**PLAN, "locations": ["India"], "places": ["India"], "match_places": None, "exclude": ["Hospitals"],
            "hiring_roles": ["hiring admission counsellor"],  # as briefs store it
            "industries_detail": [{"name": "Schools", "search_term": "school"}]}

    serper_answer = []

    async def serper_search(query, *, gl=None, location=None, num=10, page=1, counter=None):
        fakes.queries.append((query, page))
        serper_answer.append(query)
        return _pathfinder_answer(query)
    monkeypatch.setattr(fakes, "search", serper_search)
    parallel = FakeParallel(_pathfinder_answer)
    monkeypatch.setattr(search_mod, "parallel", lambda: parallel)
    asked = []

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        asked.append(output.__name__)
        if output.__name__ == "SignalSelection" and "Pathfinder" in user:
            return output.model_validate({"findings": [{
                "result_id": 1, "organisation_name": "The Pathfinder School", "signal": "hiring",
                "role_or_need": "Admission Counsellor", "quote": "The Pathfinder School is hiring an Admission Counsellor",
                "event_date": None, "location": "Kaladhungi, Uttarakhand"}]})
        return output.model_validate({"findings": []} if output.__name__ == "SignalSelection" else {"organisations": []})
    monkeypatch.setattr(llm, "ask", fake_ask)

    asyncio.run(discovery.run_round(agent, plan, 10))
    domains = {r[0] for r in _rows(la_db, "SELECT o.domain FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id")}
    assert domains == {"pathfinderacademy.in", "pathfinderboarding.edu.in"}
    # Signal searches went to Parallel (the routing set matched discover() exactly), without "hiring hiring";
    # the website lookup searched the post's place, not "India".
    assert parallel.queries and all("hiring hiring" not in q for q in parallel.queries)
    assert "school hiring admission counsellor India" in parallel.queries
    assert serper_answer == ["The Pathfinder School Kaladhungi Uttarakhand"]

    # Next round: other searches (a whole-country market walks its cities) bring the same post back, but
    # it is not read again, so no second Pathfinder is looked up.
    parallel.queries.clear()
    serper_answer.clear()
    asked.clear()
    out = asyncio.run(discovery.run_round(agent, plan, 10))
    assert out["created"] == 0 and serper_answer == [] and "SignalSelection" not in asked
    assert "school hiring admission counsellor Delhi" in parallel.queries
    assert all("India" not in q for q in parallel.queries)
    assert agent["cursor_json"]["sig_turn"] == 2


def test_maps_skips_a_second_website_of_an_organisation_in_the_same_city(la_db, fakes, monkeypatch):
    """"Centurion Defence Academy" at centurionacademy.in and centuriondefenceacademy.com, both Lucknow; a
    same-name institute in another city is another organisation."""
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    agent["brief_json"] = {**BRIEF, "sources": ["maps"]}
    agent["markets_json"] = [{"country": "India", "state": "Uttar Pradesh", "city": "Lucknow"}]
    plan = {**PLAN, "places": ["Lucknow"], "match_places": ["Lucknow"]}

    async def maps(query, *, gl=None, location=None, page=1, counter=None):
        fakes.maps_queries.append((query, page))
        return [
            {"title": "Centurion Defence Academy", "website": "https://centurionacademy.in/",
             "address": "Aliganj, Lucknow, Uttar Pradesh 226024"},
            {"title": "Centurion Defence Academy - Lucknow", "website": "https://www.centuriondefenceacademy.com/",
             "address": "Kapoorthala, Lucknow, Uttar Pradesh 226024"},
            {"title": "Quantum Coaching Institute", "website": "https://quantumcoaching.in/",
             "address": "Hazratganj, Lucknow, Uttar Pradesh 226001"},
            {"title": "Quantum Coaching Institute | NDA Coaching", "website": "https://quantumclasses.co.in/",
             "address": "Lalbagh, Lucknow, Uttar Pradesh 226001"},
            {"title": "Quantum Coaching Institute", "website": "https://quantumkanpur.in/",
             "address": "Kakadeo, Kanpur, Uttar Pradesh 208025"},
        ]
    monkeypatch.setattr(fakes, "maps", maps)
    asyncio.run(discovery.run_round(agent, plan, 10))
    domains = {r[0] for r in _rows(la_db, "SELECT o.domain FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id")}
    assert domains == {"centurionacademy.in", "quantumcoaching.in", "quantumkanpur.in"}

    # A later round knows them from the database: a third Centurion website in Lucknow is skipped.
    async def maps_again(query, *, gl=None, location=None, page=1, counter=None):
        return [{"title": "Centurion Defence Academy", "website": "https://centurion-lucknow.in/",
                 "address": "Gomti Nagar, Lucknow, Uttar Pradesh 226010"}]
    monkeypatch.setattr(fakes, "maps", maps_again)
    with la_db() as db:
        agent = {**store.get_agent(db, agent["id"]), "brief_json": agent["brief_json"],
                 "markets_json": agent["markets_json"]}
    assert asyncio.run(discovery.run_round(agent, plan, 10))["created"] == 0


def test_signal_places_walk_a_whole_country_one_city_a_round():
    india = [{"country": "India"}]
    assert discovery.signal_places(india, ["India"], 0) == ["India"]
    assert discovery.signal_places(india, ["India"], 1) == ["Delhi"]
    assert discovery.signal_places(india, ["India"], 2) == ["Mumbai"]
    indore = [{"country": "India", "city": "Indore"}]
    assert discovery.signal_places(indore, ["Indore"], 5) == ["Indore"]  # a city market never moves
    assert discovery.signal_places([], [""], 3) == [""]


# ------------------------------------------------------------- the job post itself (effort.open_job_post)

GLASSDOOR_PAGE = ('<html><head><script type="application/ld+json">{"@type": "JobPosting", '
                  '"hiringOrganization": {"@type": "Organization", "name": "The Pathfinder School"}, '
                  '"jobLocation": {"@type": "Place", "address": {"addressLocality": "Kaladhungi", '
                  '"addressRegion": "Uttarakhand"}}}</script></head><body></body></html>')


def _unplaced_pathfinder(la_db, fakes, monkeypatch, effort_level=None):
    """A Pathfinder post whose search result named no place: the lookup takes pathfinderacademy.in."""
    agent = make_world(la_db, mode="REMOTE", plan=PLAN)
    agent["brief_json"] = {**BRIEF, "sources": ["hiring"]}
    agent["markets_json"] = [{"country": "India"}]
    if effort_level:
        agent["gate_json"] = {**(agent.get("gate_json") or {}), "effort": effort_level}
    plan = {**PLAN, "locations": ["India"], "places": ["India"], "match_places": None, "exclude": ["Hospitals"],
            "hiring_roles": ["admission counsellor"], "industries_detail": [{"name": "Schools", "search_term": "school"}]}

    async def serper_search(query, *, gl=None, location=None, num=10, page=1, counter=None):
        return _pathfinder_answer(query)
    monkeypatch.setattr(fakes, "search", serper_search)
    monkeypatch.setattr(search_mod, "parallel", lambda: FakeParallel(_pathfinder_answer))

    async def fake_ask(system, user, output, *, purpose, ctx=None, max_tokens=4000):
        if output.__name__ == "SignalSelection" and "Pathfinder" in user:
            return output.model_validate({"findings": [{
                "result_id": 1, "organisation_name": "The Pathfinder School", "signal": "hiring",
                "role_or_need": "Admission Counsellor", "quote": "The Pathfinder School is hiring an Admission Counsellor",
                "event_date": None, "location": None}]})
        return output.model_validate({"findings": []} if output.__name__ == "SignalSelection" else {"organisations": []})
    monkeypatch.setattr(llm, "ask", fake_ask)
    reads = []

    async def read_post(url, state=None):
        reads.append(url)
        return GLASSDOOR_PAGE
    monkeypatch.setattr(fetcher, "read_post", read_post)
    out = asyncio.run(discovery.run_round(agent, plan, 10))
    domains = {r[0] for r in _rows(la_db, "SELECT o.domain FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id")}
    return out, reads, domains, agent, plan


def test_at_standard_effort_a_job_post_in_another_place_creates_no_candidate(la_db, fakes, monkeypatch):
    """The Pathfinder School's post is in Kaladhungi, Uttarakhand: not pathfinderacademy.in in New Delhi."""
    out, reads, domains, agent, plan = _unplaced_pathfinder(la_db, fakes, monkeypatch)  # no effort set: STANDARD
    assert reads == [PATHFINDER_POST] and out["created"] == 0 and domains == set()
    assert agent["cursor_json"]["ruled_out_posts"] == [PATHFINDER_POST]
    # The next round brings the post back: it is skipped like a used one (no lookup, no second read).
    reads.clear()
    looked_up = []

    async def serper_search(query, *, gl=None, location=None, num=10, page=1, counter=None):
        looked_up.append(query)
        return _pathfinder_answer(query)
    monkeypatch.setattr(fakes, "search", serper_search)
    assert asyncio.run(discovery.run_round(agent, plan, 10))["created"] == 0
    assert reads == [] and looked_up == []


def test_at_basic_effort_job_posts_are_never_opened(la_db, fakes, monkeypatch):
    out, reads, domains, agent, _ = _unplaced_pathfinder(la_db, fakes, monkeypatch, effort_level="BASIC")
    assert reads == [] and domains == {"pathfinderacademy.in"} and "ruled_out_posts" not in agent["cursor_json"]


def test_the_post_reader_reads_each_post_once_and_only_so_many_a_round(monkeypatch):
    import threading

    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    try:
        calls = []

        async def read_post(url, state=None):
            calls.append(url)
            state["seen"] = state.get("seen", 0) + 1  # the round's shared robots / pause state
            if "boom" in url:
                raise RuntimeError("board down")
            return f"<html>{url}</html>"
        monkeypatch.setattr(fetcher, "read_post", read_post)
        monkeypatch.setattr(discovery, "POST_READS_PER_ROUND", 3)
        reader = discovery._PostReader(loop)
        assert reader("https://a.example/1") == "<html>https://a.example/1</html>"
        assert reader("https://a.example/1") == "<html>https://a.example/1</html>"
        assert reader("https://boom.example/2") is None  # a failure reads as unread
        assert reader("https://a.example/3") == "<html>https://a.example/3</html>"
        assert reader("https://a.example/4") is None  # over the round's cap: not read
        assert calls == ["https://a.example/1", "https://boom.example/2", "https://a.example/3"]
        assert reader.state["seen"] == 3
    finally:
        loop.call_soon_threadsafe(loop.stop)
        thread.join(5)
        loop.close()
