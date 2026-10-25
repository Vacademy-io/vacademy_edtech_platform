"""Queues on real Postgres: candidate claims (SKIP LOCKED, attempts, lease
re-arm, cap -> FAILED), fetch-task claims (mode rules, one task per site, lease
re-arm), and the agent tick selection (advisory lock + last_tick_at stamp)."""
from __future__ import annotations

import pytest
from sqlalchemy import text

from conftest import INSTITUTE, make_candidate, make_world
from app.services.lead_agent import store


def _status(factory, cid):
    with factory() as db:
        return db.execute(text("SELECT status, attempts FROM lead_candidate WHERE id = :i"), {"i": cid}).first()


def test_claim_ready_skips_locked_rows_and_counts_attempts(la_db):
    agent = make_world(la_db)
    ids = {make_candidate(la_db, agent, f"org{i}.in", status="READY")["id"] for i in range(3)}
    a = la_db()
    first = store.claim_ready(a, 2)           # transaction still open: rows locked
    b = la_db()
    second = store.claim_ready(b, 5)
    b.commit()
    a.commit()
    a.close(), b.close()
    got = [r["id"] for r in first] + [r["id"] for r in second]
    assert len(first) == 2 and len(second) == 1
    assert set(got) == ids and len(set(got)) == 3
    assert all(r["attempts"] == 1 for r in first + second)
    assert all(_status(la_db, i)[0] == "RESEARCHING" for i in ids)


def test_paused_agents_are_not_claimed(la_db):
    agent = make_world(la_db, status="PAUSED")
    make_candidate(la_db, agent, status="READY")
    with la_db() as db:
        assert store.claim_ready(db, 5) == []


def test_stale_research_is_rearmed_then_failed_at_the_cap(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, status="READY")
    for attempt in range(1, store.RESEARCH_MAX_ATTEMPTS + 1):
        with la_db() as db:
            claimed = store.claim_ready(db, 1)
            assert [r["id"] for r in claimed] == [c["id"]]
            db.execute(text("UPDATE lead_candidate SET claimed_at = now() - interval '20 minutes' WHERE id = :i"),
                       {"i": c["id"]})
            out = store.rearm_stale_candidates(db)
            db.commit()
        expected = "FAILED" if attempt >= store.RESEARCH_MAX_ATTEMPTS else "READY"
        assert out == [{"id": c["id"], "status": expected}]
    assert _status(la_db, c["id"]) == ("FAILED", store.RESEARCH_MAX_ATTEMPTS)


def test_release_candidate_backs_off(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, status="READY")
    with la_db() as db:
        store.claim_ready(db, 1)
        assert store.release_candidate(db, c["id"], "LLM down", 600) == "READY"
        db.commit()
    with la_db() as db:
        assert store.claim_ready(db, 1) == []  # not before 10 minutes


def _task(factory, agent, cand, url, mode, page_type="home", age_s=0):
    with factory() as db:
        tid = store.enqueue_task(db, institute_id=INSTITUTE, agent_id=agent["id"], candidate_id=cand["id"],
                                 org_id=cand["org_id"], url=url, page_type=page_type, mode=mode)
        if age_s:
            db.execute(text("UPDATE lead_fetch_task SET created_at = now() - make_interval(secs => :s) WHERE id = :i"),
                       {"s": age_s, "i": tid})
        db.commit()
    return tid


def test_enqueue_is_once_per_candidate_url(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent)
    assert _task(la_db, agent, c, "https://a.in/", "AUTO")
    assert _task(la_db, agent, c, "https://a.in/", "AUTO") is None


def test_mode_rules_for_server_and_extension(la_db):
    agent = make_world(la_db)
    local = _task(la_db, agent, make_candidate(la_db, agent, "l.in"), "https://l.in/", "LOCAL")
    remote = _task(la_db, agent, make_candidate(la_db, agent, "r.in"), "https://r.in/", "REMOTE")
    auto_new = _task(la_db, agent, make_candidate(la_db, agent, "an.in"), "https://an.in/", "AUTO")
    auto_old = _task(la_db, agent, make_candidate(la_db, agent, "ao.in"), "https://ao.in/", "AUTO", age_s=400)
    with la_db() as db:
        server = {t["id"] for t in store.claim_server_tasks(db, 10, "server-1")}
        db.commit()
    assert server == {remote, auto_old}
    with la_db() as db:
        ext = {t["id"] for t in store.claim_extension_tasks(db, institute_id=INSTITUTE, n=4, worker_id="w1")}
        other = store.claim_extension_tasks(db, institute_id="someone-else", n=4, worker_id="w2")
    assert ext == {local, auto_new} and other == []


def test_one_task_per_site_at_a_time(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, "one.in")
    home = _task(la_db, agent, c, "https://one.in/", "REMOTE")
    contact = _task(la_db, agent, c, "https://one.in/contact", "REMOTE", page_type="contact")
    with la_db() as db:
        first = store.claim_server_tasks(db, 5, "s")
        db.commit()
    assert [t["id"] for t in first] == [home]   # home first, and only one per organisation
    with la_db() as db:
        assert store.claim_server_tasks(db, 5, "s") == []   # the site has a task out
        store.finish_task(db, home, "DONE", owner="s")
        db.commit()
    with la_db() as db:
        assert [t["id"] for t in store.claim_server_tasks(db, 5, "s")] == [contact]


def test_expired_task_leases_are_rearmed_and_capped(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, "x.in")
    tid = _task(la_db, agent, c, "https://x.in/", "REMOTE")
    for attempt in range(1, store.TASK_MAX_ATTEMPTS + 1):
        with la_db() as db:
            assert [t["id"] for t in store.claim_server_tasks(db, 1, "s")] == [tid]
            db.execute(text("UPDATE lead_fetch_task SET lease_until = now() - interval '1 second' WHERE id = :i"),
                       {"i": tid})
            out = store.rearm_stale_tasks(db)
            db.commit()
        assert out[0]["status"] == ("FAILED" if attempt >= store.TASK_MAX_ATTEMPTS else "PENDING")
    assert store.TASK_MAX_ATTEMPTS == 3


def test_only_the_lease_owner_finishes_a_task(la_db):
    agent = make_world(la_db)
    c = make_candidate(la_db, agent, "o.in")
    tid = _task(la_db, agent, c, "https://o.in/", "LOCAL")
    with la_db() as db:
        store.claim_extension_tasks(db, institute_id=INSTITUTE, n=1, worker_id="w1")
        assert store.finish_task(db, tid, "DONE", owner="w2") is None
        assert store.finish_task(db, tid, "DONE", owner="w1")["status"] == "DONE"


def test_tick_lease_one_agent_one_owner(la_db):
    a1 = make_world(la_db)
    with la_db() as db:
        first = store.claim_next_agent(db, institutes=None, owner="w1", min_interval_s=55)
        db.commit()
    assert first["id"] == a1["id"] and first["tick_owner"] == "w1"
    with la_db() as db:   # leased: not due for another worker, even after run-now nulled last_tick_at
        store.force_tick(db, a1["id"], INSTITUTE)
        assert store.claim_next_agent(db, institutes=None, owner="w2", min_interval_s=55) is None
        assert store.renew_tick(db, a1["id"], "w2") is False and store.renew_tick(db, a1["id"], "w1") is True
        db.commit()
    with la_db() as db:   # released: due again only after the interval, unless forced
        store.release_tick(db, a1["id"], "w1")
        assert store.claim_next_agent(db, institutes=None, owner="w2", min_interval_s=55) is None
        store.force_tick(db, a1["id"], INSTITUTE)
        assert store.claim_next_agent(db, institutes=["other"], owner="w2", min_interval_s=55) is None
        assert store.claim_next_agent(db, institutes=[INSTITUTE], owner="w2", min_interval_s=55)["id"] == a1["id"]
        db.commit()


def test_an_expired_tick_lease_can_be_taken_over(la_db):
    a1 = make_world(la_db)
    with la_db() as db:
        store.claim_next_agent(db, institutes=None, owner="w1", min_interval_s=55)
        db.execute(text("UPDATE lead_agent SET tick_until = now() - interval '1 second', last_tick_at = NULL"))
        db.commit()
    with la_db() as db:
        assert store.claim_next_agent(db, institutes=None, owner="w2", min_interval_s=55)["tick_owner"] == "w2"
        assert store.renew_tick(db, a1["id"], "w1") is False      # the old owner learns it lost the lease


def test_two_workers_never_hold_the_same_agent(la_db):
    make_world(la_db)
    a = la_db()
    got_a = store.claim_next_agent(a, institutes=None, owner="w1", min_interval_s=55)   # row locked, uncommitted
    b = la_db()
    got_b = store.claim_next_agent(b, institutes=None, owner="w2", min_interval_s=55)
    a.commit(), b.commit(), a.close(), b.close()
    assert got_a is not None and got_b is None


def test_quota_reservation_is_atomic(la_db):
    agent = make_world(la_db)
    from app.services.lead_agent import pacing
    day = pacing.agent_day(agent["window_json"])
    with la_db() as db:
        assert store.reserve_deliveries(db, agent["id"], day, 3, 5) == 3
        assert store.reserve_deliveries(db, agent["id"], day, 3, 5) == 2
        assert store.reserve_deliveries(db, agent["id"], day, 1, 5) == 0
        store.release_deliveries(db, agent["id"], day, 2)
        assert store.reserve_deliveries(db, agent["id"], day, 9, 5) == 2
        db.commit()


def test_decisions_skip_leads_under_delivery(la_db):
    agent = make_world(la_db)
    held = make_candidate(la_db, agent, "held.in", status="APPROVED")
    sent = make_candidate(la_db, agent, "sent.in", status="APPROVED")
    free = make_candidate(la_db, agent, "free.in", status="APPROVED")
    with la_db() as db:
        db.execute(text("UPDATE lead_candidate SET not_before = now() + interval '10 minutes' WHERE id = :i"),
                   {"i": held["id"]})
        db.execute(text("UPDATE lead_candidate SET intake_attempted_at = now() WHERE id = :i"), {"i": sent["id"]})
        changed = store.decide(db, ids=[held["id"], sent["id"], free["id"]], institute_id=INSTITUTE,
                               action="REJECT", reason="no", user_id="u")
    assert [c["id"] for c in changed] == [free["id"]]


def test_pages_are_scoped_server_shared_extension_private(la_db):
    agent = make_world(la_db)
    cand = make_candidate(la_db, agent, "scope.in")
    rec = {"access": "ok", "text": "x", "links": []}
    with la_db() as db:
        store.upsert_page(db, org_id=cand["org_id"], url="https://scope.in/", page_type="home", record=rec,
                          fetched_by="SERVER", institute_id=INSTITUTE)
        store.upsert_page(db, org_id=cand["org_id"], url="https://scope.in/contact", page_type="contact",
                          record=rec, fetched_by="EXTENSION", institute_id=INSTITUTE)
        store.upsert_page(db, org_id=cand["org_id"], url="https://scope.in/", page_type="home",
                          record={**rec, "text": "rendered"}, fetched_by="EXTENSION", institute_id="inst-other")
        mine = store.org_pages(db, cand["org_id"], institute_id=INSTITUTE)
        theirs = store.org_pages(db, cand["org_id"], institute_id="inst-other")
        rows = db.execute(text("SELECT count(*) FROM lead_org_page")).scalar()
    assert rows == 3                                    # the server copy and the other's copy coexist
    assert {(p["url"], p["fetched_by"]) for p in mine} == {("https://scope.in/", "SERVER"),
                                                          ("https://scope.in/contact", "EXTENSION")}
    assert [(p["url"], p["fetched_by"]) for p in theirs] == [("https://scope.in/", "EXTENSION")]  # own copy wins
    with pytest.raises(ValueError):
        with la_db() as db:
            store.upsert_page(db, org_id=cand["org_id"], url="https://scope.in/x", page_type="other", record=rec,
                              fetched_by="EXTENSION", institute_id=None)
