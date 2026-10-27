"""Smaller units: flags (JSON strings), pacing (window, day), search clients
(request shape, key rotation, cache, counters) with a mock transport, the
pricing fallback mirroring V612, the scheduler tick wiring, the LLM repair."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal

import httpx
import pytest
from pydantic import BaseModel
from sqlalchemy import text

from conftest import INSTITUTE, PLAN, make_candidate, make_world
from app.services.lead_agent import billing, flags, llm, pacing, scheduler, store
from app.services.lead_agent import search as search_mod


def test_allowlist_parsing():
    assert flags.parse_allowlist(json.dumps(["a", " b ", ""])) == frozenset({"a", "b"})
    assert flags.parse_allowlist('["*"]') == flags.ALL_INSTITUTES
    assert flags.parse_allowlist("['a']") == frozenset()        # str(list) is not JSON -> nobody
    assert flags.parse_allowlist(None) == frozenset()


def test_window_and_day():
    w = {"tz": "Asia/Kolkata", "start": "09:30", "end": "19:00", "days": [1, 2, 3, 4, 5, 6]}
    mon_10 = datetime(2026, 10, 26, 4, 30, tzinfo=timezone.utc)      # Monday 10:00 IST
    sun_10 = datetime(2026, 10, 25, 4, 30, tzinfo=timezone.utc)
    mon_20 = datetime(2026, 10, 26, 14, 30, tzinfo=timezone.utc)
    assert pacing.in_window(w, mon_10) and not pacing.in_window(w, sun_10) and not pacing.in_window(w, mon_20)
    late = datetime(2026, 10, 25, 19, 0, tzinfo=timezone.utc)        # Mon 00:30 IST, still Sunday in UTC
    assert pacing.agent_day(w, late).isoformat() == "2026-10-26"
    night = {"tz": "Asia/Kolkata", "start": "22:00", "end": "02:00", "days": [1]}
    assert pacing.in_window(night, datetime(2026, 10, 26, 17, 0, tzinfo=timezone.utc))   # Mon 22:30
    assert pacing.in_window(night, datetime(2026, 10, 26, 19, 0, tzinfo=timezone.utc))   # Tue 00:30 (Mon's night)
    assert not pacing.in_window(night, datetime(2026, 10, 27, 19, 0, tzinfo=timezone.utc))


def test_pricing_fallback_mirrors_v612():
    from la_pg import v612_pricing_rows

    from app.services.tool_cost_estimator import DEFAULT_TOOL_PRICING

    rows = v612_pricing_rows()
    assert {r[0] for r in rows} == {billing.TOOL_LOCAL, billing.TOOL_REMOTE}
    for key, rtype, flat, per_unit, unit, params in rows:
        d = DEFAULT_TOOL_PRICING[key]
        assert (d["request_type"], d["flat_base_credits"], d["per_unit_credits"], d["unit_field"]) == \
            (rtype, Decimal(flat), Decimal(per_unit), unit)
        assert d["params"] == json.loads(params)


def test_estimator_charges_one_flat_price_per_lead(la_db):
    from app.services.tool_cost_estimator import ToolCostEstimator

    with la_db() as db:   # the V612 rows, not the fallback
        local = ToolCostEstimator(db).estimate(billing.TOOL_LOCAL, {}, institute_id=INSTITUTE)
        remote = ToolCostEstimator(db).estimate(billing.TOOL_REMOTE, {})
    assert (local["estimated_credits"], local["fixed_price"], local["rate_source"]) == (2.0, True, "global")
    assert remote["estimated_credits"] == 4.0 and remote["request_type"] == "agent"


def _transport(log, responder):
    def handler(request: httpx.Request):
        log.append(request)
        return responder(request)
    return httpx.MockTransport(handler)


def test_serper_rotates_refused_keys_caches_and_counts(la_db):
    agent = make_world(la_db)
    log = []

    def respond(req):
        if req.headers["X-API-KEY"] == "bad":
            return httpx.Response(403, json={"message": "nope"})
        return httpx.Response(200, json={"organic": [{"title": "A", "link": "https://a.in/", "snippet": "s",
                                                      "position": 1, "date": "2 days ago"}], "credits": 1})
    client = search_mod.SerperClient("bad,good", transport=_transport(log, respond))
    counter = search_mod.SearchCounter(agent["id"], pacing.agent_day(agent["window_json"]))
    res = asyncio.run(client.search("coaching Indore", gl="in", page=2, counter=counter))
    assert [(r.title, r.url, r.snippet) for r in res] == [("A", "https://a.in/", "2 days ago - s")]
    sent = json.loads(log[-1].content)
    assert sent == {"q": "coaching Indore", "num": 10, "hl": "en", "gl": "in", "page": 2}
    again = asyncio.run(client.search("coaching  indore", gl="in", page=2, counter=counter))
    assert [r.url for r in again] == ["https://a.in/"] and len(log) == 2   # cached; the 403 rotated once
    with la_db() as db:
        assert db.execute(text("SELECT searches FROM lead_agent_day")).scalar() == 1


def test_parallel_request_and_excerpts(la_db):
    log = []

    def respond(req):
        assert req.headers["x-api-key"] == "pk" and req.url.path == "/v1/search"
        return httpx.Response(200, json={"search_id": "s", "results": [
            {"url": "https://x.in/jobs", "title": "Hiring telecaller", "publish_date": "2026-10-20",
             "excerpts": ["Hiring telecaller at X Classes", "Call Rahul 98765 00000"]}]})
    client = search_mod.ParallelClient("pk", transport=_transport(log, respond))
    [r] = asyncio.run(client.search("hiring telecaller coaching Indore", country="in"))
    body = json.loads(log[0].content)
    assert body["mode"] == "fast" and body["search_queries"] == ["hiring telecaller coaching Indore"]
    assert body["advanced_settings"]["location"] == "in" and body["advanced_settings"]["max_results"] == 8
    assert r.snippet == "2026-10-20 - Hiring telecaller at X Classes … Call Rahul 98765 00000"


def test_parallel_without_key_is_unavailable(la_db):
    with pytest.raises(search_mod.SearchUnavailable):
        asyncio.run(search_mod.ParallelClient("").search("q"))


class Tiny(BaseModel):
    n: int


def test_llm_repairs_once_then_gives_up(monkeypatch):
    from types import SimpleNamespace

    replies = iter(['{"n": "x"}', '{"n": 3}', '{"n": "y"}', 'nope'])
    seen = []

    async def fake_chat(messages, max_tokens, purpose):
        seen.append(purpose)
        return SimpleNamespace(content=next(replies), model="z-ai/glm-5.3-flash", usage={"cost": 0.0001})
    monkeypatch.setattr(llm, "_chat", fake_chat)
    monkeypatch.setattr(llm, "_account", lambda *a, **k: 0.0)
    assert asyncio.run(llm.ask("s", "u", Tiny, purpose="t")).n == 3
    with pytest.raises(llm.InvalidOutput):
        asyncio.run(llm.ask("s", "u", Tiny, purpose="t"))
    assert seen == ["t", "t.repair", "t", "t.repair"]


def test_a_reply_slightly_off_the_schema_keeps_what_fits():
    from app.services.lead_agent.engine.schemas import AccountExtraction

    cite = {"page": 1, "quote": "Indore"}
    reply = {"organisation_name": "Kesar", "is_target_segment": True, "what_they_do": "Warehousing.", "city": None,
             "branches": [{"name": "Indore", "city": "Indore", "cite": cite, "cite2": cite}],   # an extra key
             "signals": [{"signal": "fit_1", "observation": "Warehouse.", "event_date": None, "cite": cite},
                         {"signal": "big_roof", "observation": "Roof.", "event_date": None, "cite": cite}],  # unknown key
             "people": [{"name": "A. Jain", "role": None, "cite": cite}],                      # a null text
             "current_software": [], "unknowns": [], "discovery_question": "", "summary": ""}
    out = llm._parse(AccountExtraction, json.dumps(reply))
    assert [b.name for b in out.branches] == ["Indore"] and [s.signal for s in out.signals] == ["fit_1"]
    assert out.people[0].role == ""
    with pytest.raises(ValueError):
        llm._parse(AccountExtraction, json.dumps({"organisation_name": "Kesar"}))  # missing fields: not salvaged
    quoted = json.dumps({**reply, "summary": "QUOTE"}).replace("QUOTE", 'The "best" warehouse')  # unescaped quotes
    assert llm._parse(AccountExtraction, quoted).summary == 'The "best" warehouse'
    with pytest.raises(ValueError):
        llm._parse(AccountExtraction, "not json at all")


def test_llm_asks_afresh_when_a_reply_runs_to_the_token_cap(monkeypatch):
    from types import SimpleNamespace

    replies = iter([('{"n": "nnnnnnnnnnnn', 1000), ('{"n": 4}', 40)])
    seen = []

    async def fake_chat(messages, max_tokens, purpose):
        seen.append((purpose, len(messages)))
        content, used = next(replies)
        return SimpleNamespace(content=content, model="z-ai/glm-5.3-flash", usage={"completion_tokens": used})
    monkeypatch.setattr(llm, "_chat", fake_chat)
    monkeypatch.setattr(llm, "_account", lambda *a, **k: 0.0)
    assert asyncio.run(llm.ask("s", "u", Tiny, purpose="t", max_tokens=1000)).n == 4
    assert seen == [("t", 2), ("t.retry", 2)]  # the run-on text is not sent back


def test_tick_plans_discovers_and_delivers(la_db, monkeypatch):
    from app.services.lead_agent import delivery, discovery, planner

    agent = make_world(la_db, quota=4, plan=PLAN)
    make_candidate(la_db, agent, "a.in", status="READY")
    calls = {}

    async def fake_plan(a, ctx=None):
        calls["plan"] = a["id"]
        return PLAN

    async def fake_round(a, plan, need):
        calls["need"] = need
        return {"created": 0}

    async def fake_deliver(a, now=None):
        calls["deliver"] = True
        return {"delivered": 0, "skipped": 0, "failed": 0}
    monkeypatch.setattr(planner, "ensure_plan", fake_plan)
    monkeypatch.setattr(discovery, "run_round", fake_round)
    monkeypatch.setattr(delivery, "deliver", fake_deliver)
    monkeypatch.setattr(billing, "affordable", lambda a, n: (True, ""))
    out = asyncio.run(scheduler.tick_once())
    assert len(out) == 1 and calls["plan"] == agent["id"] and calls["deliver"]
    assert calls["need"] == 3 * 4 - 1               # backlog of one READY candidate
    assert asyncio.run(scheduler.tick_once()) == []  # ticked a moment ago
    with la_db() as db:   # the tick lease was released at the end
        assert db.execute(text("SELECT tick_owner, tick_until FROM lead_agent")).first() == (None, None)


def test_a_tick_that_lost_its_lease_stops_before_delivering(la_db, monkeypatch):
    from app.services.lead_agent import delivery, discovery, planner

    make_world(la_db, plan=PLAN)

    async def stolen_plan(a, ctx=None):
        with la_db() as db:   # another worker took the agent over meanwhile
            db.execute(text("UPDATE lead_agent SET tick_owner = 'someone-else'"))
            db.commit()
        return PLAN

    async def must_not(*a, **k):
        raise AssertionError("delivered without the lease")
    monkeypatch.setattr(planner, "ensure_plan", stolen_plan)
    monkeypatch.setattr(discovery, "run_round", must_not)
    monkeypatch.setattr(delivery, "deliver", must_not)
    assert asyncio.run(scheduler.tick_once()) == []


def test_tick_skips_discovery_when_the_wallet_is_short(la_db, monkeypatch):
    from app.services.lead_agent import delivery, discovery, planner

    agent = make_world(la_db, quota=4, plan=PLAN)

    async def fake_plan(a, ctx=None):
        return PLAN

    async def boom(*a, **k):
        raise AssertionError("must not discover")

    async def fake_deliver(a, now=None):
        return {}
    monkeypatch.setattr(planner, "ensure_plan", fake_plan)
    monkeypatch.setattr(discovery, "run_round", boom)
    monkeypatch.setattr(delivery, "deliver", fake_deliver)
    monkeypatch.setattr(billing, "affordable", lambda a, n: (False, "Not enough credits"))
    [summary] = asyncio.run(scheduler.tick_once())
    assert summary["discovery"] == {"skipped": "Not enough credits"}
    with la_db() as db:
        assert store.get_agent(db, agent["id"])["last_error"] == "Not enough credits"


def test_tick_skips_discovery_while_the_review_queue_covers_today(la_db, monkeypatch):
    from app.services.lead_agent import delivery, discovery, planner

    agent = make_world(la_db, quota=3, plan=PLAN)
    for domain in ("a.in", "b.in", "c.in"):
        make_candidate(la_db, agent, domain, status="REVIEW")
    needs = []

    async def fake_plan(a, ctx=None):
        return PLAN

    async def fake_round(a, plan, need):
        needs.append(need)
        return {"created": 0}

    async def fake_deliver(a, now=None):
        return {}
    monkeypatch.setattr(planner, "ensure_plan", fake_plan)
    monkeypatch.setattr(discovery, "run_round", fake_round)
    monkeypatch.setattr(delivery, "deliver", fake_deliver)
    monkeypatch.setattr(billing, "affordable", lambda a, n: (True, ""))
    [summary] = asyncio.run(scheduler.tick_once())
    assert summary["discovery"] == {"skipped": "review queue covers today"} and summary["review"] == 3
    assert needs == []
    with la_db() as db:   # a person rejected one: the queue no longer covers the rest of today
        db.execute(text("UPDATE lead_candidate c SET status = 'REJECTED' FROM lead_org o "
                        "WHERE o.id = c.org_id AND o.domain = 'a.in'"))
        db.execute(text("UPDATE lead_agent SET last_tick_at = now() - interval '1 hour'"))
        db.commit()
    asyncio.run(scheduler.tick_once())
    assert needs == [3 * 3]


def test_nothing_runs_while_switched_off(la_db, monkeypatch):
    make_world(la_db)
    monkeypatch.setattr(flags, "platform_enabled", lambda: False)
    assert asyncio.run(scheduler.tick_once()) == []
    monkeypatch.setattr(flags, "platform_enabled", lambda: True)
    monkeypatch.setattr(flags, "allowed_institutes", lambda: frozenset())
    assert scheduler.active() is False


def test_research_pool_respects_concurrency(la_db, monkeypatch):
    from app.services.lead_agent import research

    agent = make_world(la_db)
    for i in range(4):
        make_candidate(la_db, agent, f"r{i}.in", status="READY")
    started = []

    async def slow(cid):
        started.append(cid)
        await asyncio.sleep(0.05)
        return "REVIEW"
    monkeypatch.setattr(research, "research_candidate", slow)

    async def go():
        n1 = await scheduler.drain_research_once()
        n2 = await scheduler.drain_research_once()     # both slots busy
        await asyncio.sleep(0.1)
        return n1, n2
    assert asyncio.run(go()) == (2, 0)


def test_mx_cache_is_bounded(monkeypatch):
    from app.services.lead_agent import mx

    monkeypatch.setattr(mx, "CACHE_MAX", 3)
    mx._cache.clear()
    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(params["name"])
        return httpx.Response(200, json={"Status": 0, "Answer": [{"type": 15}]})
    monkeypatch.setattr(mx.httpx, "get", fake_get)
    for d in ("a.in", "b.in", "c.in", "a.in", "d.in"):
        assert mx.mx_lookup(d) is True
    assert list(mx._cache) == ["c.in", "a.in", "d.in"]   # b.in, least recently used, dropped
    assert calls == ["a.in", "b.in", "c.in", "d.in"]
    mx._cache.clear()
