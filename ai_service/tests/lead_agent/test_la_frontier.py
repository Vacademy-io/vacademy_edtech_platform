"""The search frontier (frontier.py) on a real Postgres: rings of cities once the plan's Maps lane is past its
first page, cells chosen by how their leads did and resting when a page brings nothing new, weak kinds retired,
new kinds kept inside the brief's industries, the supply check, revisits, and the frontier filling a round the
plan's lanes left short (discovery.run_round)."""
from __future__ import annotations

import asyncio
import json
from datetime import timedelta

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, PLAN, make_world
from app.services.lead_agent import discovery, fetcher, frontier, llm, pacing, places, store
from app.services.lead_agent import search as search_mod

INDIA = [{"country": "India"}]
WHOLE_PLAN = {**PLAN, "places": ["India"], "match_places": [], "search_queries": ["coaching institute India"]}


def _india_agent(la_db, *, maps_page=2, quota=10, plan=WHOLE_PLAN, **kw):
    agent = make_world(la_db, plan=plan, quota=quota, **kw)
    with la_db() as db:
        db.execute(text("UPDATE lead_agent SET markets_json = CAST(:m AS jsonb), cursor_json = CAST(:c AS jsonb) "
                        "WHERE id = :a"), {"m": json.dumps(INDIA), "c": json.dumps({"maps_page": maps_page}),
                                           "a": agent["id"]})
        db.commit()
        return store.get_agent(db, agent["id"])


def _q(la_db, sql, **p):
    with la_db() as db:
        return db.execute(text(sql), p).fetchall()


class FakeMaps:
    available = True

    def __init__(self, per_query=None, default=12):
        self.calls = []
        self.per_query = per_query or {}
        self.default = default

    async def maps(self, query, *, gl=None, location=None, page=1, counter=None):
        self.calls.append((query, page))
        n = self.per_query.get(query, self.default)
        slug = query.lower().replace(" ", "-")
        names = ("Apex", "Zenith", "Orbit", "Summit", "Vertex", "Pinnacle", "Nova", "Quest", "Stellar", "Vision",
                 "Prime", "Elite", "Ascent", "Beacon", "Crest", "Delta", "Eagle", "Falcon", "Galaxy", "Horizon")
        return [{"title": f"{names[i]} {slug.replace('-', '')[:12]}{page} Classes",
                 "website": f"https://{slug}-{i}-p{page}.in/",
                 "phone": f"+91 90000 {i:05d}", "address": query.split()[-1], "type": "Coaching center"}
                for i in range(n)]

    async def search(self, query, **kw):
        return []


@pytest.fixture
def maps(monkeypatch):
    fake = FakeMaps()
    monkeypatch.setattr(search_mod, "serper", lambda: fake)

    class NoParallel:
        available = False
    monkeypatch.setattr(search_mod, "parallel", lambda: NoParallel())

    async def no_post(url, state=None):
        return None
    monkeypatch.setattr(fetcher, "read_post", no_post)
    return fake


@pytest.fixture
def no_ai(monkeypatch):
    async def ask(system, user, output, **kw):
        raise llm.LLMUnavailable("no AI in this test")
    monkeypatch.setattr(llm, "ask", ask)


# ------------------------------------------------------------------------------------------------- rings
def test_the_frontier_waits_until_the_plans_maps_lane_is_past_its_first_page(la_db, no_ai):
    agent = _india_agent(la_db, maps_page=1)
    out = asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    assert "ring" not in out and _q(la_db, "SELECT count(*) FROM lead_search_cell")[0][0] == 0
    assert not frontier.has_ready(agent["id"])


def test_rings_of_cities_open_beyond_the_major_ones(la_db, no_ai):
    agent = _india_agent(la_db)
    out = asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    assert out["ring"] == 1 and out["cells_added"] == places.FRONTIER_RING
    cities = [r[0] for r in _q(la_db, "SELECT place FROM lead_search_cell ORDER BY place_rank")]
    assert cities[:3] == ["Faridabad", "Thane", "Navi Mumbai"]
    assert not set(cities) & set(places.MAJOR_CITIES["india"])  # the plan's own Maps lane searches those
    # enough cells ready: the next tick opens no ring
    assert "ring" not in asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    assert frontier.has_ready(agent["id"])


def test_a_city_market_has_no_rings(la_db, no_ai):
    agent = make_world(la_db, plan=PLAN)
    with la_db() as db:
        db.execute(text("UPDATE lead_agent SET cursor_json = '{\"maps_page\": 2}' WHERE id = :a"), {"a": agent["id"]})
        db.commit()
        agent = store.get_agent(db, agent["id"])
    out = asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    assert "ring" not in out and _q(la_db, "SELECT count(*) FROM lead_search_cell")[0][0] == 0


# ------------------------------------------------------------------------------------------------- searching
def test_cells_page_on_while_they_bring_new_organisations_and_rest_when_not(la_db, maps, no_ai):
    agent = _india_agent(la_db)
    asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    ids, searched = asyncio.run(frontier.run(agent, room=100, gl="in", counter=None, skip=set(), exclude=[],
                                             industries=WHOLE_PLAN["industries_detail"], market=INDIA[0],
                                             known_orgs={}))
    assert searched == frontier.FRONTIER_PER_ROUND and len(ids) == 12 * searched
    assert maps.calls[0] == ("coaching institute Faridabad", 1)
    row = _q(la_db, "SELECT next_page, searches, found, status FROM lead_search_cell WHERE place = 'Faridabad'")[0]
    assert tuple(row) == (2, 1, 12, "OPEN")
    cand = _q(la_db, "SELECT discovery_json FROM lead_candidate LIMIT 1")[0][0]
    assert cand["frontier"] is True and cand["term"] == "coaching institute" and cand["cell_id"]

    # a short page is the last one there is: the cell rests
    maps.per_query["coaching institute Faridabad"] = 4
    cell = dict(_q(la_db, "SELECT id, next_page FROM lead_search_cell WHERE place = 'Faridabad'")[0]._mapping)
    frontier.record_search(cell, listings=4, new=4, filled=False)
    row = _q(la_db, "SELECT next_page, status, rest_until > now() + interval '29 days' FROM lead_search_cell "
                    "WHERE place = 'Faridabad'")[0]
    assert tuple(row) == (1, "RESTING", True)


def test_a_full_round_does_not_rest_a_cell_that_had_no_room(la_db, no_ai):
    agent = _india_agent(la_db)
    asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    cell = dict(_q(la_db, "SELECT id, next_page FROM lead_search_cell WHERE place = 'Thane'")[0]._mapping)
    frontier.record_search(cell, listings=20, new=0, filled=True)
    assert tuple(_q(la_db, "SELECT next_page, status FROM lead_search_cell WHERE place = 'Thane'")[0]) == (2, "OPEN")


# ------------------------------------------------------------------------------------------------- learning
def _maps_candidate(la_db, agent, domain, query, status, phone=None, rid=None):
    with la_db() as db:
        org = store.upsert_org(db, domain=domain, name=domain, website=f"https://{domain}/")
        cid = store.insert_candidate(db, agent_id=agent["id"], institute_id=INSTITUTE, org_id=org, source="maps",
                                     discovery={"query": query})
        store.set_candidate(db, cid, status=status, delivered_response_id=rid)
        if rid:
            db.execute(text("INSERT INTO audience_response (id, parent_mobile) VALUES (:r, :p)"), {"r": rid, "p": phone})
        db.commit()


def test_stats_count_deliveries_and_conversations_by_kind_and_place(la_db):
    agent = _india_agent(la_db)
    _maps_candidate(la_db, agent, "a.in", "coaching institute Delhi", "DELIVERED", "+91 98765 43210", "r1")
    _maps_candidate(la_db, agent, "b.in", "coaching institute Delhi", "DELIVERED", "9876500000", "r2")
    _maps_candidate(la_db, agent, "c.in", "tuition centre Pune", "REJECTED")
    _maps_candidate(la_db, agent, "d.in", "tuition centre Pune", "RESEARCHING")  # no outcome yet: not counted
    with la_db() as db:
        db.execute(text("INSERT INTO ai_call_result (institute_id, phone_number, duration_seconds) "
                        "VALUES (:i, '919876543210', 95), (:i, '9876500000', 12)"), {"i": INSTITUTE})
        db.commit()
    stats = frontier.compute_stats(agent, ["coaching institute", "tuition centre"])
    assert stats["g"] == [3, 1 + frontier.TALK_WEIGHT + 1]
    assert stats["t"]["coaching institute"] == [2, 2 + frontier.TALK_WEIGHT]
    assert stats["t"]["tuition centre"] == [1, 0]
    assert stats["p"]["delhi"] == [2, 2 + frontier.TALK_WEIGHT]


def test_the_best_kind_and_place_are_searched_first(la_db, no_ai):
    agent = _india_agent(la_db)
    asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    frontier.add_cells(agent["id"], ["tuition centre"], ["Faridabad", "Thane"], origin="kind", rank0=0)
    stats = {"g": [100, 20], "t": {"tuition centre": [40, 30], "coaching institute": [60, 2]},
             "p": {"thane": [10, 8]}}
    picked = frontier.pick(agent["id"], 3, stats)
    assert [(c["term"], c["place"]) for c in picked[:2]] == [("tuition centre", "Thane"),
                                                             ("tuition centre", "Faridabad")]


def test_a_kind_far_below_the_rest_is_retired(la_db):
    agent = _india_agent(la_db)
    frontier.add_cells(agent["id"], ["hospital", "coaching institute"], ["Thane"], origin="city", rank0=0)
    stats = {"g": [200, 40], "t": {"hospital": [40, 0], "coaching institute": [160, 40]}, "p": {}}
    assert frontier.retire_weak(agent["id"], stats) == ["hospital"]
    rows = dict(_q(la_db, "SELECT term, status FROM lead_search_cell"))
    assert rows == {"hospital": "RETIRED", "coaching institute": "OPEN"}


# ------------------------------------------------------------------------------------------------- new kinds
def test_new_kinds_stay_inside_the_brief(la_db, monkeypatch):
    agent = make_world(la_db, plan=PLAN)  # Indore only: no rings, so new kinds are next
    with la_db() as db:
        db.execute(text("UPDATE lead_agent SET cursor_json = '{\"maps_page\": 2}' WHERE id = :a"), {"a": agent["id"]})
        db.commit()
        agent = store.get_agent(db, agent["id"])
    seen = {}

    async def ask(system, user, output, *, purpose, ctx=None, max_tokens=0):
        seen["user"], seen["purpose"] = user, purpose
        return output.model_validate({"kinds": [
            "NEET coaching", "Car dealership", "coaching institute", "Abacus classes in Indore 2024",
            "Spoken English classes", "Play school"]})
    monkeypatch.setattr(llm, "ask", ask)
    out = asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    # another market, already searched, not a short category, left out by the brief: dropped
    assert out["new_kinds"] == ["NEET coaching", "Spoken English classes"]
    assert seen["purpose"] == "frontier" and "Coaching institutes" in seen["user"]
    cells = {(r[0], r[1]) for r in _q(la_db, "SELECT term, place FROM lead_search_cell")}
    assert cells == {("NEET coaching", "Indore"), ("Spoken English classes", "Indore")}
    # once a day
    assert "new_kinds" not in asyncio.run(frontier.maintain(agent, agent["plan_json"]))


# ------------------------------------------------------------------------------------------------- supply, revisits
def _days(la_db, agent, delivered_by_offset):
    today = pacing.agent_day(agent["window_json"])
    with la_db() as db:
        db.execute(text("UPDATE lead_agent SET created_at = now() - interval '30 days' WHERE id = :a"),
                   {"a": agent["id"]})
        for offset, n in delivered_by_offset.items():
            store.bump_day(db, agent["id"], today - timedelta(days=offset), delivered=n)
        db.commit()


def test_supply_short_counts_the_last_two_working_days(la_db):
    agent = _india_agent(la_db, quota=10)
    _days(la_db, agent, {1: 3, 2: 4, 3: 10})
    assert frontier.supply_short(agent) == {"got": 7, "want": 20}
    _days(la_db, agent, {1: 9})
    assert frontier.supply_short(agent) is None  # 16 of 20


def test_a_new_agent_is_not_judged_short(la_db):
    agent = _india_agent(la_db, quota=10)
    assert frontier.supply_short(agent) is None


def test_short_supply_with_nothing_left_warns(la_db, no_ai):
    agent = make_world(la_db, plan=PLAN, quota=10)  # Indore: no rings; no AI: no kinds
    _days(la_db, agent, {1: 0, 2: 1})
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    out = asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    assert out["short"] == {"got": 1, "want": 20} and "widen its markets or industries" in out["warning"]


def test_revisits_bring_back_unreadable_sites_after_45_days(la_db):
    agent = _india_agent(la_db)
    with la_db() as db:
        rows = []
        for domain, reason, age in (("old-unreadable.in", "No readable page (website could not be read)", 50),
                                    ("old-nocontact.in", "No usable contact (only helplines)", 60),
                                    ("recent.in", "No readable page", 5),
                                    ("not-kind.in", "Not the kind of organisation the brief targets", 90)):
            org = store.upsert_org(db, domain=domain, name=domain, website=f"https://{domain}/")
            cid = store.insert_candidate(db, agent_id=agent["id"], institute_id=INSTITUTE, org_id=org,
                                         source="maps", discovery={"query": "q"})
            store.enqueue_task(db, institute_id=INSTITUTE, agent_id=agent["id"], candidate_id=cid, org_id=org,
                               url=f"https://{domain}/", page_type="home", mode="AUTO")
            db.execute(text("UPDATE lead_fetch_task SET status = 'FAILED' WHERE candidate_id = :c"), {"c": cid})
            db.execute(text("UPDATE lead_candidate SET status = 'REJECTED', decision = 'REJECT', score = 10, "
                            "reject_reason = :r, updated_at = now() - make_interval(days => :d) WHERE id = :c"),
                       {"r": reason, "d": age, "c": cid})
            rows.append(cid)
        db.commit()
    assert frontier.revisit(agent, 5) == 2
    got = {r[0]: (r[1], r[2], r[3]) for r in _q(la_db, """
        SELECT o.domain, c.status, c.discovery_json->>'revisits', c.reject_reason
          FROM lead_candidate c JOIN lead_org o ON o.id = c.org_id""")}
    assert got["old-unreadable.in"] == ("DISCOVERED", "1", None)
    assert got["old-nocontact.in"] == ("DISCOVERED", "1", None)
    assert got["recent.in"][0] == got["not-kind.in"][0] == "REJECTED"
    assert _q(la_db, "SELECT count(*) FROM lead_fetch_task")[0][0] == 2  # the revisited ones' old tasks dropped
    # scheduled like any new organisation: a home-page task again
    assert discovery.schedule_discovered(agent) == 2


# ------------------------------------------------------------------------------------------------- in a round
def test_the_frontier_fills_a_round_the_plans_lanes_leave_short(la_db, maps, no_ai):
    agent = _india_agent(la_db)
    asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    asyncio.run(discovery.run_round(agent, agent["plan_json"], 2))  # the plan's lists, as every day
    # ... until they are used up for today
    agent["cursor_json"]["lane_done"] = {"org": "wrapped", "maps": "wrapped"}
    maps.calls.clear()
    out = asyncio.run(discovery.run_round(agent, agent["plan_json"], 20))
    assert out["frontier"] == 20 and out["created"] == 20
    assert maps.calls and all(q.split()[-1] not in places.MAJOR_CITIES["india"] for q, _p in maps.calls)
    assert agent["cursor_json"]["rounds"] == 2


def test_no_frontier_search_when_the_plans_lanes_fill_the_round(la_db, maps, no_ai):
    agent = _india_agent(la_db)
    asyncio.run(frontier.maintain(agent, agent["plan_json"]))
    with la_db() as db:
        agent = store.get_agent(db, agent["id"])
    agent["cursor_json"] = {**(agent["cursor_json"] or {}), "lane_done": {"org": "wrapped"}}
    out = asyncio.run(discovery.run_round(agent, agent["plan_json"], 5))
    assert out["created"] == 5 and out["frontier"] == 0
    assert all(q.split()[-1] in places.MAJOR_CITIES["india"] for q, _p in maps.calls)


def test_a_missing_frontier_table_never_stops_the_plans_lanes(la_db, maps, no_ai):
    agent = _india_agent(la_db)
    with la_db() as db:
        db.execute(text("ALTER TABLE lead_search_frontier RENAME TO lead_search_frontier_gone"))
        db.commit()
    try:
        assert frontier.has_ready(agent["id"]) is False
        out = asyncio.run(discovery.run_round(agent, agent["plan_json"], 5))
        assert out["created"] == 5 and "frontier" not in out
    finally:
        with la_db() as db:
            db.execute(text("ALTER TABLE lead_search_frontier_gone RENAME TO lead_search_frontier"))
            db.commit()
