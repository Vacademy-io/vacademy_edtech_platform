"""Rank and fill (2026-10-30), on real Postgres: the scheduler keeps POOL_DAYS days of the quota ready to
send (or on its way) instead of searching while leads pile up in REVIEW, and the leads the old two-bar
gate parked in REVIEW are judged again with the agent's current gate (no AI). Prod that day: about 820
researched leads waited in REVIEW, which nobody works on (Voomsales: 14 delivered, 214 in REVIEW)."""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, PLAN, make_candidate, make_world
from app.services.lead_agent import billing, discovery, pacing, scheduler, store

LEAD = {"organisation": {"name": "A", "city": "Indore"},
        "contacts": [{"kind": "institute_phone", "value": "+91 98765 12345", "quality": "likely"}],
        "contact_quality": {"level": "likely", "label": "Desk mobile"}}


def _scored(score, flags=()):
    """A score_json as research stores it (engine scoring.score_lead + the gate's reasons then)."""
    return {"score": score, "base_score": score, "fit": 60, "intent": 0, "reach": 70, "risk": 0,
            "has_intent": False, "reach_level": "likely", "flags": list(flags), "reasons": ["Fit 60/100"],
            "gate_reasons": [f"Score {score} is below the auto-deliver bar (70)"]}


def _waiting(la_db, agent, domain, score, flags=(), *, score_json="default", lead=None, **fields):
    return make_candidate(la_db, agent, domain, status="REVIEW", decision="REVIEW", score=score,
                          score_json=_scored(score, flags) if score_json == "default" else score_json,
                          lead_json=lead or LEAD, **fields)


def _row(la_db, cid):
    with la_db() as db:
        return store.get_candidate(db, cid)


def _set_gate(la_db, agent, **gate):
    with la_db() as db:
        row = store.update_agent(db, agent["id"], INSTITUTE,
                                 {"gate_json": {**store.DEFAULT_GATE_JSON, **gate}})
        db.commit()
    return row


def _due_again(la_db):
    with la_db() as db:
        db.execute(text("UPDATE lead_agent SET last_tick_at = now() - interval '1 hour'"))
        db.commit()


@pytest.fixture
def tick(monkeypatch):
    """scheduler.tick_once with the plan, discovery round and delivery faked: records each round's need
    and the leads the wallet was asked to cover."""
    from app.services.lead_agent import delivery, planner

    seen = {"rounds": [], "wallet": []}

    async def fake_plan(a, ctx=None):
        return PLAN

    async def fake_round(a, plan, need):
        seen["rounds"].append(need)
        return {"created": 0}

    async def fake_deliver(a, now=None):
        return {}

    def fake_affordable(a, n):
        seen["wallet"].append(n)
        return True, ""
    monkeypatch.setattr(planner, "ensure_plan", fake_plan)
    monkeypatch.setattr(discovery, "run_round", fake_round)
    monkeypatch.setattr(delivery, "deliver", fake_deliver)
    monkeypatch.setattr(billing, "affordable", fake_affordable)

    def run():
        out = asyncio.run(scheduler.tick_once())
        return out[0] if out else None
    run.seen = seen
    return run


# ----------------------------------------------------------------------------------------------- pacing

def test_pool_counts_take_approved_review_and_in_flight_apart(la_db):
    agent = make_world(la_db)
    statuses = ["APPROVED", "APPROVED", "REVIEW", "DISCOVERED", "FETCHING", "READY", "RESEARCHING", "DELIVERED",
                "REJECTED", "SKIPPED", "FAILED"]
    for i, status in enumerate(statuses):
        make_candidate(la_db, agent, f"c{i}.in", status=status)
    with la_db() as db:
        assert store.pool_counts(db, agent["id"]) == {"approved": 2, "review": 1, "in_flight": 4}
        assert store.pool_counts(db, "no-such-agent") == {"approved": 0, "review": 0, "in_flight": 0}


@pytest.mark.parametrize("quota, counts, approval, need", [
    (100, {"approved": 0, "review": 0, "in_flight": 0}, False, 200),
    (100, {"approved": 150, "review": 80, "in_flight": 40}, False, 10),   # REVIEW is not ready to send
    (100, {"approved": 150, "review": 80, "in_flight": 40}, True, 0),     # unless a person approves every lead
    (5, {"approved": 12, "review": 0, "in_flight": 0}, False, 0),         # never below 0
])
def test_pool_need(quota, counts, approval, need):
    agent = {"daily_quota": quota, "gate_json": {"require_approval": approval}}
    out = scheduler.pool_need(agent, counts)
    assert out["need"] == need and out["target"] == scheduler.POOL_DAYS * quota


def test_a_full_pool_stops_discovery(la_db, tick):
    agent = make_world(la_db, quota=3, plan=PLAN)
    for i in range(scheduler.POOL_DAYS * 3):
        make_candidate(la_db, agent, f"ok{i}.in", status="APPROVED", score=60)
    summary = tick()
    assert (summary["pool"], summary["in_flight"], summary["target"], summary["need"]) == (6, 0, 6, 0)
    assert summary["discovery"] == {"skipped": "pool full"} and tick.seen["rounds"] == []


def test_a_short_pool_asks_discovery_for_what_is_missing(la_db, tick):
    agent = make_world(la_db, quota=5, plan=PLAN)
    for i in range(2):
        make_candidate(la_db, agent, f"ok{i}.in", status="APPROVED", score=60)
    for i in range(3):
        make_candidate(la_db, agent, f"r{i}.in", status="READY")
    summary = tick()
    assert (summary["pool"], summary["in_flight"], summary["target"], summary["need"]) == (2, 3, 10, 5)
    assert tick.seen["rounds"] == [5] and tick.seen["wallet"] == [5]


def test_a_big_quota_is_filled_one_round_at_a_time(la_db, tick):
    make_world(la_db, quota=100, plan=PLAN)
    assert tick()["need"] == 200
    assert tick.seen["rounds"] == [discovery.MAX_CANDIDATES_PER_ROUND]
    assert tick.seen["wallet"] == [discovery.MAX_CANDIDATES_PER_ROUND]


def test_the_pool_is_filled_even_after_todays_quota_went_out(la_db, tick):
    # the pool feeds the coming days; the wallet is asked for at most one day's quota
    agent = make_world(la_db, quota=4, plan=PLAN)
    with la_db() as db:
        store.bump_day(db, agent["id"], pacing.agent_day(agent["window_json"]), delivered=4)
        db.commit()
    tick()
    assert tick.seen["rounds"] == [8] and tick.seen["wallet"] == [4]


def test_a_review_queue_counts_toward_the_pool_only_when_the_agent_needs_approval(la_db, tick):
    agent = make_world(la_db, quota=3, plan=PLAN)
    for i in range(6):  # Maps-only leads at the send bar: the re-judge leaves them for a person
        _waiting(la_db, agent, f"m{i}.in", 60, ["maps_only"])
    summary = tick()
    assert (summary["pool"], summary["need"]) == (0, 6) and tick.seen["rounds"] == [6]
    _set_gate(la_db, agent, require_approval=True)
    _due_again(la_db)
    summary = tick()
    assert (summary["pool"], summary["need"]) == (6, 0) and summary["discovery"] == {"skipped": "pool full"}
    assert "rejudged" not in summary and tick.seen["rounds"] == [6]


def test_a_short_wallet_still_stops_discovery(la_db, tick, monkeypatch):
    agent = make_world(la_db, quota=4, plan=PLAN)
    monkeypatch.setattr(billing, "affordable", lambda a, n: (False, "Not enough credits"))
    summary = tick()
    assert summary["discovery"] == {"skipped": "Not enough credits"} and tick.seen["rounds"] == []
    with la_db() as db:
        assert store.get_agent(db, agent["id"])["last_error"] == "Not enough credits"


# ---------------------------------------------------------------------------- re-judging the REVIEW queue

def test_waiting_leads_are_judged_again_with_the_current_gate(la_db):
    agent = make_world(la_db)  # send_score 50, no approval
    good = _waiting(la_db, agent, "good.in", 62)
    weak = _waiting(la_db, agent, "weak.in", 40)
    # validity holds (2026-10-30): a person sees them only at or above the bar; nobody reviews the rest
    maps_low = _waiting(la_db, agent, "maps-low.in", 30, ["maps_only"])
    dup_low = _waiting(la_db, agent, "dup-low.in", 40, ["possible_duplicate:other.in"])
    listing_low = _waiting(la_db, agent, "listing-low.in", 20, lead={**LEAD, "maps_only": True})
    maps = _waiting(la_db, agent, "maps.in", 60, ["maps_only"])
    dup = _waiting(la_db, agent, "dup.in", 80, ["possible_duplicate:other.in"])
    listing = _waiting(la_db, agent, "listing.in", 70, lead={**LEAD, "maps_only": True})
    decided = _waiting(la_db, agent, "decided.in", 70, reviewed_by="user-2", reviewed_at="now()")
    decided_low = _waiting(la_db, agent, "decided-low.in", 10, ["maps_only"], reviewed_by="user-2",
                           reviewed_at="now()")
    old = _waiting(la_db, agent, "old.in", 70, score_json={k: v for k, v in _scored(70).items() if k != "has_intent"})
    bare = _waiting(la_db, agent, "bare.in", 70, score_json=None)
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"])) == {"approved": 1, "rejected": 4}
        db.commit()

    row = _row(la_db, good["id"])
    assert (row["status"], row["decision"], row["reviewed_by"], row["reject_reason"]) == ("APPROVED", "AUTO", None, None)
    assert row["score_json"]["gate_reasons"] == ["Score 62 meets the send bar (50) with a likely contact"]
    assert row["score_json"]["rejudged_at"] and row["score_json"]["reasons"] == ["Fit 60/100"]
    rejected = {c["id"]: why for c, why in (
        (weak, "Score 40 is below the send bar (50)"),
        (maps_low, "Judged from its Google Maps listing only: score 30 is below the send bar (50)"),
        (dup_low, "Score 40 is below the send bar (50)"),
        (listing_low, "Judged from its Google Maps listing only: score 20 is below the send bar (50)"))}
    for cid, why in rejected.items():
        row = _row(la_db, cid)
        assert (row["status"], row["decision"], row["reviewed_by"], row["reject_reason"]) == (
            "REJECTED", "REJECT", None, why)
    for left in (maps, dup, listing, decided, decided_low, old, bare):
        row = _row(la_db, left["id"])
        assert row["status"] == "REVIEW" and "rejudged_at" not in (row["score_json"] or {}), left["org_domain"]
    with la_db() as db:  # the day's counters keep what research decided that day
        assert store.get_day(db, agent["id"], pacing.agent_day(agent["window_json"])) == {
            c: 0 for c in store.DAY_COUNTERS}
        # nothing more to do on a second run, and the held leads kept for a person are not read again
        assert scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"])) == {"approved": 0, "rejected": 0}
        assert store.review_to_rejudge(db, agent["id"], limit=200, held_flags=("maps_only", "possible_duplicate"),
                                       send_score=50) == []


def test_a_higher_send_bar_rejects_held_leads_it_no_longer_reaches(la_db):
    agent = make_world(la_db)
    maps = _waiting(la_db, agent, "maps.in", 60, ["maps_only"])
    dup = _waiting(la_db, agent, "dup.in", 80, ["possible_duplicate:other.in"])
    agent = _set_gate(la_db, agent, send_score=70)
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, agent) == {"approved": 0, "rejected": 1}
        db.commit()
    assert _row(la_db, maps["id"])["reject_reason"] == (
        "Judged from its Google Maps listing only: score 60 is below the send bar (70)")
    assert _row(la_db, dup["id"])["status"] == "REVIEW"


def test_the_rejudge_takes_a_bounded_batch_best_score_first(la_db):
    agent = make_world(la_db)
    rows = {score: _waiting(la_db, agent, f"s{score}.in", score) for score in (20, 90, 30, 80, 70)}

    def batch():
        with la_db() as db:
            out = scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"]), limit=2)
            db.commit()
        return out

    assert batch() == {"approved": 2, "rejected": 0}
    assert [_row(la_db, rows[s]["id"])["status"] for s in (90, 80, 70)] == ["APPROVED", "APPROVED", "REVIEW"]
    assert batch() == {"approved": 1, "rejected": 1}
    assert batch() == {"approved": 0, "rejected": 1}
    assert batch() == {"approved": 0, "rejected": 0}
    assert scheduler.REJUDGE_BATCH == 200


def test_an_agent_that_needs_approval_keeps_its_queue_for_a_person(la_db):
    agent = make_world(la_db)
    agent = _set_gate(la_db, agent, require_approval=True)
    good = _waiting(la_db, agent, "good.in", 90)
    weak = _waiting(la_db, agent, "weak.in", 10)
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, agent) == {"approved": 0, "rejected": 0}
    assert [_row(la_db, c["id"])["status"] for c in (good, weak)] == ["REVIEW", "REVIEW"]


def test_a_person_deciding_at_the_same_moment_wins(la_db, monkeypatch):
    agent = make_world(la_db)
    weak = _waiting(la_db, agent, "weak.in", 30)
    read = store.review_to_rejudge

    def read_then_a_person_approves(db, agent_id, **kw):
        rows = read(db, agent_id, **kw)
        with la_db() as other:  # the reviewer's request commits between the read and the move
            store.decide(other, ids=[weak["id"]], institute_id=INSTITUTE, action="APPROVE", reason=None,
                         user_id="user-2")
            other.commit()
        return rows
    monkeypatch.setattr(store, "review_to_rejudge", read_then_a_person_approves)
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"])) == {"approved": 0, "rejected": 0}
        db.commit()
    row = _row(la_db, weak["id"])
    assert (row["status"], row["reviewed_by"], row["reject_reason"]) == ("APPROVED", "user-2", None)


def test_a_tick_rejudges_before_it_paces_so_the_moved_leads_fill_the_pool(la_db, tick):
    agent = make_world(la_db, quota=1, plan=PLAN)
    _waiting(la_db, agent, "good.in", 70)
    _waiting(la_db, agent, "weak.in", 20)
    summary = tick()
    assert summary["rejudged"] == {"approved": 1, "rejected": 1}
    assert (summary["pool"], summary["need"]) == (1, 1) and tick.seen["rounds"] == [1]


def test_a_row_the_gate_cannot_read_stays_for_a_person(la_db):
    agent = make_world(la_db)
    odd = _waiting(la_db, agent, "odd.in", 70, score_json={**_scored(70), "flags": [7]})  # not a flag string
    good = _waiting(la_db, agent, "good.in", 60)
    with la_db() as db:
        assert scheduler.rejudge_waiting(db, store.get_agent(db, agent["id"])) == {"approved": 1, "rejected": 0}
        db.commit()
    assert [_row(la_db, c["id"])["status"] for c in (odd, good)] == ["REVIEW", "APPROVED"]


def test_a_failing_rejudge_never_stops_discovery_or_delivery(la_db, tick, monkeypatch):
    make_world(la_db, quota=2, plan=PLAN)

    def boom(db, agent, limit=scheduler.REJUDGE_BATCH):
        raise RuntimeError("bad row")
    monkeypatch.setattr(scheduler, "rejudge_waiting", boom)
    summary = tick()
    assert summary["rejudged"] == {"error": "RuntimeError: bad row"}
    assert tick.seen["rounds"] == [4] and summary["delivery"] == {}
