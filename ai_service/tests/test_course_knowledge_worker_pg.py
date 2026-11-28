"""Course knowledge queue, budgets, sweep and index_slide on a REAL Postgres 16
+ pgvector with the real V600 schema and psycopg 3 (course_knowledge_pg_helpers).

What must hold:
  * two concurrent claimers never claim the same row;
  * 20 concurrent reserve() calls never push a budget past its cap;
  * finalize with a stale generation leaves the row PENDING;
  * re-arming a stuck row releases its reservation;
  * enqueue / document enqueue / drift sweep / run close / purge SQL works;
  * index_slide end to end (real describe + inline extract, fake embeddings);
    an unchanged republish touches the source, so the sweep does not churn;
  * shared-file re-queue, the PAID-cache check and the kept delivery SQL;
  * a CANCELLED run's leftover rows are detached and its budget closed.

Skipped unless AI_LIMITS_PG_URL or AI_LIMITS_PGDATA is set:
  AI_LIMITS_PGDATA=<dir> <venv>/bin/python -m pytest ai_service/tests/test_course_knowledge_worker_pg.py -q
"""
from __future__ import annotations

import asyncio
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from sqlalchemy import text  # noqa: E402

from app import db as app_db  # noqa: E402
from app.services.course_knowledge import (  # noqa: E402
    budget, embedding, flags, indexer, queue, store, sweep,
)
from app.services.course_knowledge.extract import cache  # noqa: E402
from app.services.course_knowledge.extract.types import Segment, SlideRef  # noqa: E402
from course_knowledge_pg_helpers import make_course, pg_session_factory  # noqa: E402

DIM = 768


@pytest.fixture(scope="module")
def Session():
    factory = pg_session_factory(pool_size=30)
    yield factory
    factory.close()


@pytest.fixture(autouse=True)
def wired(Session, monkeypatch):
    """Every db_session() in the app opens a session on the scratch database."""
    monkeypatch.setattr(app_db, "get_sessionmaker", lambda: Session)
    monkeypatch.setattr(flags, "available", lambda i: True)
    monkeypatch.setattr(flags, "paid_enabled", lambda: False)
    monkeypatch.setattr(flags, "max_monthly_auto_cap", lambda: 5000)
    monkeypatch.setattr(flags, "max_chunks_per_institute", lambda: 200000)


def _inst() -> str:
    return f"inst-{uuid.uuid4().hex[:8]}"


def _enable(db, inst, enabled_at="now() - interval '1 day'"):
    db.execute(text(f"INSERT INTO course_knowledge_setting (institute_id, enabled, enabled_at) "
                    f"VALUES (:i, TRUE, {enabled_at}) ON CONFLICT (institute_id) DO UPDATE SET enabled = TRUE"),
               {"i": inst})
    db.commit()


def _row(db, inst, slide):
    return db.execute(text("SELECT status, generation, attempts, budget_id, reserved_credits, allow_paid, run_id, "
                           "reason, not_before > now() FROM content_index_queue "
                           "WHERE institute_id = :i AND slide_id = :s"), {"i": inst, "s": slide}).fetchone()


def _budget(db, budget_id):
    return db.execute(text("SELECT cap_credits, reserved_credits, charged_credits FROM course_knowledge_budget "
                           "WHERE id = :id"), {"id": budget_id}).fetchone()


# ── claim ────────────────────────────────────────────────────────────────────

def test_concurrent_claimers_never_share_a_row(Session):
    inst = _inst()
    slides = [f"s-{i}" for i in range(60)]
    with Session() as db:
        assert queue.enqueue_slides(db, inst, slides, reason="TEST") == 60
        db.commit()
    seen, lock = [], threading.Lock()
    barrier = threading.Barrier(8)

    def claimer():
        barrier.wait()
        mine = []
        while True:
            got = [r for r in queue.claim(4) if r.institute_id == inst]
            if not got:
                return mine
            mine.extend(r.slide_id for r in got)

    with ThreadPoolExecutor(8) as pool:
        for mine in pool.map(lambda _: claimer(), range(8)):
            with lock:
                seen.extend(mine)
    assert sorted(seen) == sorted(slides)          # all claimed, none twice
    with Session() as db:
        st = db.execute(text("SELECT DISTINCT status, attempts FROM content_index_queue WHERE institute_id = :i"),
                        {"i": inst}).fetchall()
    assert st == [("PROCESSING", 1)]


def test_claim_prefers_runs_and_skips_rows_not_due(Session):
    inst = _inst()
    with Session() as db:
        queue.enqueue_slides(db, inst, ["auto"], reason="TEST")
        queue.enqueue_slides(db, inst, ["later"], reason="TEST")
        db.execute(text("UPDATE content_index_queue SET not_before = now() + interval '1 hour' "
                        "WHERE institute_id = :i AND slide_id = 'later'"), {"i": inst})
        queue.enqueue_slides(db, inst, ["paid"], reason="TEST", run_id=str(uuid.uuid4()), allow_paid=True)
        db.commit()
    got = []
    while True:
        rows = [r for r in queue.claim(1) if r.institute_id == inst]
        if not rows:
            break
        got.extend(rows)
    assert [r.slide_id for r in got] == ["paid", "auto"]
    assert got[0].allow_paid and got[0].run_id


# ── finalize ─────────────────────────────────────────────────────────────────

def test_finalize_with_stale_generation_returns_pending(Session):
    inst = _inst()
    with Session() as db:
        queue.enqueue_slides(db, inst, ["a", "b"], reason="TEST")
        db.commit()
    rows = {r.slide_id: r for r in queue.claim(10) if r.institute_id == inst}
    with Session() as db:
        # an edit lands while "a" is being indexed: it stays PROCESSING, generation moves on
        assert queue.enqueue_slides(db, inst, ["a"], reason="SLIDE_UPDATED") == 1
        db.commit()
        assert _row(db, inst, "a")[0] == "PROCESSING"
    a, b = rows["a"], rows["b"]
    assert queue.finalize(inst, "a", a.generation, "DONE") == "PENDING"
    assert queue.finalize(inst, "b", b.generation, "PENDING", 600, "waiting") == "PENDING"
    with Session() as db:
        ra, rb = _row(db, inst, "a"), _row(db, inst, "b")
    assert ra[0] == "PENDING" and ra[8] is True       # debounced 30 s
    assert rb[0] == "PENDING" and rb[8] is True
    # no longer PROCESSING: nothing to finalize
    assert queue.finalize(inst, "a", a.generation + 1, "DONE") is None
    got = [r for r in queue.claim(10) if r.institute_id == inst]
    assert got == []                                   # neither is due yet


def test_finalize_same_generation_and_give_back(Session):
    inst = _inst()
    with Session() as db:
        queue.enqueue_slides(db, inst, ["x"], reason="TEST")
        db.commit()
    (row,) = [r for r in queue.claim(5) if r.institute_id == inst]
    with Session() as db:
        assert queue.give_back_attempt(db, inst, "x", row.generation)
        assert not queue.give_back_attempt(db, inst, "x", row.generation + 7)
        db.commit()
        assert _row(db, inst, "x")[2] == 0
    assert queue.finalize(inst, "x", row.generation, "DONE") == "DONE"


# ── enqueue semantics ────────────────────────────────────────────────────────

def test_enqueue_widens_paid_and_keeps_paid_run(Session):
    inst, run_id = _inst(), str(uuid.uuid4())
    with Session() as db:
        queue.enqueue_slides(db, inst, ["p", "p"], reason="SCAN")          # duplicate ids are fine
        queue.enqueue_slides(db, inst, ["p"], reason="PROCESS", run_id=run_id, allow_paid=True)
        queue.enqueue_slides(db, inst, ["p"], reason="DRIFT")
        db.commit()
        status, gen, attempts, _b, _r, allow_paid, rid, reason, _nb = _row(db, inst, "p")
        assert (status, gen, allow_paid, rid, reason) == ("PENDING", 3, True, run_id, "DRIFT")
        assert queue.run_progress(db, run_id) == {"total": 1, "pending": 1, "processing": 0, "done": 0,
                                                  "failed": 0, "skipped": 0}


def test_enqueue_document_lessons_only_for_enabled_institutes(Session):
    on, off = _inst(), _inst()
    with Session() as db:
        c_on = make_course(db, on, 2)
        c_off = make_course(db, off, 1)
        _enable(db, on)
        assert queue.enqueue_document_lessons(db, c_on.document_ids[0], "PPT_ANIM_BACKFILL") == 1
        assert queue.enqueue_document_lessons(db, c_off.document_ids[0], "PPT_ANIM_BACKFILL") == 0
        assert queue.enqueue_document_lessons(db, c_on.document_ids[0], "PPT_ANIM_BACKFILL") == 1
        db.commit()
        row = _row(db, on, c_on.slide_ids[0])
        assert row[0] == "PENDING" and row[1] == 2 and row[7] == "PPT_ANIM_BACKFILL" and row[8] is True
        assert _row(db, off, c_off.slide_ids[0]) is None


def test_ppt_anim_backfill_update_enqueues_in_the_same_transaction(Session, monkeypatch):
    from app.services import ppt_anim_backfill

    # The module binds get_sessionmaker at import; when another test imported it first,
    # patching app.db alone would not reach it.
    monkeypatch.setattr(ppt_anim_backfill, "get_sessionmaker", lambda: Session)
    inst = _inst()
    with Session() as db:
        course = make_course(db, inst, 1)
        _enable(db, inst)
        db.execute(text("UPDATE document_slide SET type = 'PDF' WHERE id = :d"), {"d": course.document_ids[0]})
        db.commit()
    assert ppt_anim_backfill._update_slide(course.document_ids[0], "https://cdn.example/deck/") == 1
    with Session() as db:
        assert _row(db, inst, course.slide_ids[0])[7] == "PPT_ANIM_BACKFILL"
    assert ppt_anim_backfill._update_slide(course.document_ids[0], "https://cdn.example/deck/") == 0


# ── budgets ──────────────────────────────────────────────────────────────────

def test_twenty_concurrent_reservations_never_exceed_the_cap(Session):
    inst, run_id = _inst(), str(uuid.uuid4())
    with Session() as db:
        budget_id = budget.create_run_budget(db, run_id, inst, Decimal("10.5"))
        db.commit()
    barrier = threading.Barrier(20)

    def one(_):
        barrier.wait()
        with Session() as db:
            ok = budget.reserve(db, budget_id, Decimal("1"))
            db.commit()
            return ok

    with ThreadPoolExecutor(20) as pool:
        results = list(pool.map(one, range(20)))
    assert results.count(True) == 10
    with Session() as db:
        cap, reserved, charged = _budget(db, budget_id)
        assert reserved == Decimal("10") and reserved + charged <= cap
        assert budget.settle(db, budget_id, Decimal("3"), Decimal("2.5"))
        assert budget.release(db, budget_id, Decimal("50"))           # never below zero
        assert budget.close_run_budget(db, run_id)
        db.commit()
        assert _budget(db, budget_id) == (Decimal("2.50"), Decimal("0"), Decimal("2.50"))
        assert not budget.reserve(db, budget_id, Decimal("0.01"))


def test_month_budget_and_spend(Session):
    inst = _inst()
    with Session() as db:
        bid = budget.ensure_month_budget(db, inst, 5)
        assert bid == budget.month_budget_id(inst)
        assert budget.ensure_month_budget(db, inst, 8) == bid          # re-capped, not duplicated
        assert budget.reserve(db, bid, 6) and not budget.reserve(db, bid, 3)
        budget.settle(db, bid, 6, 4)
        assert budget.month_spent(db, inst) == Decimal("4")
        assert budget.month_spent(db, _inst()) == 0
        db.commit()


def test_rearm_releases_reservations(Session):
    inst = _inst()
    with Session() as db:
        queue.enqueue_slides(db, inst, ["stuck", "dead"], reason="TEST")
        bid = budget.ensure_month_budget(db, inst, 100)
        db.commit()
    claimed = {r.slide_id: r for r in queue.claim(10) if r.institute_id == inst}
    assert set(claimed) == {"stuck", "dead"}
    with Session() as db:
        assert budget.reserve(db, bid, 7, institute_id=inst, slide_id="stuck")
        assert budget.reserve(db, bid, 5, institute_id=inst, slide_id="dead")
        db.execute(text("UPDATE content_index_queue SET claimed_at = now() - interval '31 minutes', "
                        "attempts = CASE WHEN slide_id = 'dead' THEN 5 ELSE attempts END "
                        "WHERE institute_id = :i"), {"i": inst})
        db.commit()
        assert _row(db, inst, "stuck")[3:5] == (bid, Decimal("7"))
        assert _budget(db, bid)[1] == Decimal("12")
    again = [r for r in queue.claim(10) if r.institute_id == inst]
    assert [r.slide_id for r in again] == ["stuck"]                   # re-armed and claimed again
    assert again[0].attempts == 2
    with Session() as db:
        assert _budget(db, bid)[1] == Decimal("0")
        stuck, dead = _row(db, inst, "stuck"), _row(db, inst, "dead")
        assert stuck[0] == "PROCESSING" and stuck[3] is None and stuck[4] == 0
        assert dead[0] == "FAILED" and dead[3] is None


def test_finalize_releases_a_hold_left_on_the_row(Session):
    """A hold the indexer could not give back, or one a re-armed replica's
    late finalize finds on the row, goes back to the budget instead of being
    wiped from the row and leaked."""
    inst = _inst()
    with Session() as db:
        queue.enqueue_slides(db, inst, ["left"], reason="TEST")
        bid = budget.ensure_month_budget(db, inst, 100)
        db.commit()
    (row,) = [r for r in queue.claim(5) if r.institute_id == inst]
    with Session() as db:
        assert budget.reserve(db, bid, 9)
        db.execute(text("UPDATE content_index_queue SET budget_id = :b, reserved_credits = 9 "
                        "WHERE institute_id = :i AND slide_id = 'left'"), {"b": bid, "i": inst})
        db.commit()
        assert _budget(db, bid)[1] == Decimal("9")
    assert queue.finalize(inst, "left", row.generation, "DONE") == "DONE"
    with Session() as db:
        assert _budget(db, bid)[1] == Decimal("0")
        assert _row(db, inst, "left")[3:5] == (None, Decimal("0"))
    assert queue.finalize(inst, "left", row.generation, "DONE") is None    # not PROCESSING: nothing released
    with Session() as db:
        assert _budget(db, bid)[1] == Decimal("0")


def _claim_row(inst, slide):
    return queue.ClaimedRow(institute_id=inst, slide_id=slide, generation=1, allow_paid=False, run_id=None,
                            reason="TEST", attempts=1)


def _token(db, inst, slide):
    row = db.execute(indexer._CLAIM_TOKEN_SQL, {"i": inst, "s": slide}).fetchone()
    return row[0] if row else None


def test_re_armed_hold_is_never_released_twice(Session):
    """A lesson re-armed while its paid step ran: rearm_stale gives its hold
    back, so the late settle must not take it off reserved again (that ate
    another lesson's live hold and let a new lesson past the cap)."""
    inst = _inst()
    a, b = _claim_row(inst, "A"), _claim_row(inst, "B")
    with Session() as db:
        bid = budget.ensure_month_budget(db, inst, 10)
        queue.enqueue_slides(db, inst, ["A", "B"], reason="TEST")
        db.execute(text("UPDATE content_index_queue SET status = 'PROCESSING', claimed_at = now() "
                        "WHERE institute_id = :i"), {"i": inst})
        db.commit()
        tok_a, tok_b = _token(db, inst, "A"), _token(db, inst, "B")
        for row, tok in ((a, tok_a), (b, tok_b)):
            assert budget.reserve(db, bid, 5) and indexer._mark_hold(db, row, tok, bid, Decimal(5))
        db.commit()
        # A outlives STALE_MINUTES; another replica re-arms it and releases its hold.
        db.execute(text("UPDATE content_index_queue SET claimed_at = now() - interval '31 minutes' "
                        "WHERE institute_id = :i AND slide_id = 'A'"), {"i": inst})
        queue.rearm_stale(db)
        db.commit()
        assert _budget(db, bid)[1:] == (Decimal("5"), Decimal("0"))
        # ...and re-claims it, holding 4 under its own claim.
        db.execute(text("UPDATE content_index_queue SET status = 'PROCESSING', claimed_at = now() "
                        "WHERE institute_id = :i AND slide_id = 'A'"), {"i": inst})
        tok_a2 = _token(db, inst, "A")
        assert tok_a2 != tok_a
        assert budget.reserve(db, bid, 1) and indexer._mark_hold(db, a, tok_a2, bid, Decimal(1))
        assert not indexer._mark_hold(db, a, tok_a, bid, Decimal(1))          # the old claim cannot mark
        db.commit()
        # The original A worker delivers late: nothing held any more, only the charge counts.
        assert indexer._take_hold(db, a, tok_a, bid) == 0
        budget.settle(db, bid, 0, 5)
        db.commit()
        assert _row(db, inst, "A")[3:5] == (bid, Decimal("1"))                # the new claim's hold survives
        assert _budget(db, bid)[1:] == (Decimal("6"), Decimal("5"))
        assert not budget.reserve(db, bid, 5)                                  # C no longer fits
        assert indexer._take_hold(db, b, tok_b, bid) == Decimal("5")
        assert indexer._take_hold(db, b, tok_b, bid) == 0                     # taken once only
        db.rollback()


def test_heartbeat_keeps_a_long_paid_step_from_being_re_armed(Session):
    inst = _inst()
    a = _claim_row(inst, "A")
    with Session() as db:
        queue.enqueue_slides(db, inst, ["A"], reason="TEST")
        db.execute(text("UPDATE content_index_queue SET status = 'PROCESSING', "
                        "claimed_at = now() - interval '29 minutes' WHERE institute_id = :i"), {"i": inst})
        db.commit()
        tok = _token(db, inst, "A")
    fresh = indexer._heartbeat(a, tok)
    assert fresh and fresh != tok
    assert indexer._heartbeat(a, tok) is None                                  # the old token is gone
    with Session() as db:
        # Two more minutes of work would have crossed STALE_MINUTES without the beat.
        db.execute(text("UPDATE content_index_queue SET claimed_at = claimed_at - interval '2 minutes' "
                        "WHERE institute_id = :i"), {"i": inst})
        queue.rearm_stale(db)
        db.commit()
        assert _row(db, inst, "A")[0] == "PROCESSING"


def test_sweep_trues_up_a_charge_counted_at_its_quote(Session, monkeypatch):
    inst = _inst()
    key = f"course_kb_ocr:{inst}:file-8"
    monkeypatch.setattr(sweep.billing, "charge", lambda delivered, **kw: Decimal("2"))
    with Session() as db:
        _enable(db, inst)
        kb = store.ensure_course_kb(db, inst)
        bid = budget.ensure_month_budget(db, inst, 10)
        # The worker could not confirm the charge: the 3-credit quote stayed counted.
        assert budget.reserve(db, bid, 3)
        budget.settle(db, bid, 3, 3)
        paid = {"kind": "ocr_pages", "tool_key": "course_kb_ocr_page", "units": 4, "idempotency_key": key,
                "delivered_at": "2026-01-01T00:00:00+00:00", "charged": None, "budget_id": bid,
                "budget_counted": 3.0, "pointer_kind": "file", "pointer_key": "file-8"}
        store.set_source_state(db, kb=kb, slide_id="paid-slide-2", title="t", index_state="READY",
                               status="READY", meta={"paid": paid})
        db.execute(text("UPDATE knowledge_base_source SET meta_json = jsonb_set(meta_json, '{paid,delivered_at}', "
                        "to_jsonb(CAST(now() - interval '1 hour' AS text))) WHERE knowledge_base_id = :kb"),
                   {"kb": kb.id})
        db.commit()
    monkeypatch.setattr(sweep, "_gone", lambda db, i, kb: 0)
    sweep.run_once()
    with Session() as db:
        assert store.get_source(db, kb.id, "paid-slide-2").meta_json["paid"]["charged"] == 2
        assert _budget(db, bid)[1:] == (Decimal("0"), Decimal("2"))           # 3 counted -> 2 in the ledger


# ── sweep ────────────────────────────────────────────────────────────────────

def test_sweep_drift_gone_runs_and_purge(Session):
    inst = _inst()
    with Session() as db:
        course = make_course(db, inst, 3)
        _enable(db, inst)
        kb = store.ensure_course_kb(db, inst)
        # lesson 2 is indexed and current, lesson 3 republished after its index
        for sid in course.slide_ids[1:]:
            store.set_source_state(db, kb=kb, slide_id=sid, title="t", index_state="READY", status="READY",
                                   meta={}, content_hash="h")
        db.execute(text("UPDATE knowledge_base_source SET updated_at = now() - interval '2 hours' "
                        "WHERE knowledge_base_id = :kb AND slide_id = :s"), {"kb": kb.id, "s": course.slide_ids[2]})
        db.execute(text("UPDATE slide SET last_sync_date = now() - interval '3 hours' WHERE id = :s"),
                   {"s": course.slide_ids[1]})
        # a source whose lesson is gone
        store.set_source_state(db, kb=kb, slide_id="gone-slide", title="t", index_state="READY",
                               status="READY", meta={})
        # a finished run with one row
        run_id = str(uuid.uuid4())
        db.execute(text("INSERT INTO course_knowledge_run (id, institute_id, package_id, kind, created_at) "
                        "VALUES (:r, :i, :p, 'PROCESS', now() - interval '10 minutes')"),
                   {"r": run_id, "i": inst, "p": course.package_id})
        budget.create_run_budget(db, run_id, inst, 20)
        budget.reserve(db, budget.run_budget_id(run_id), 4)
        budget.settle(db, budget.run_budget_id(run_id), 4, 3)
        queue.enqueue_slides(db, inst, ["run-row"], reason="PROCESS", run_id=run_id, allow_paid=True)
        db.execute(text("UPDATE content_index_queue SET status = 'DONE' WHERE slide_id = 'run-row'"))
        # an old DONE row to purge
        queue.enqueue_slides(db, inst, ["old-done"], reason="TEST")
        db.execute(text("UPDATE content_index_queue SET status = 'DONE', updated_at = now() - interval '8 days' "
                        "WHERE slide_id = 'old-done'"))
        db.commit()

    summary = sweep.run_once()
    assert summary["locked"] and summary["errors"] == 0
    with Session() as db:
        queued = {r[0]: r[1] for r in db.execute(text(
            "SELECT slide_id, reason FROM content_index_queue WHERE institute_id = :i AND status = 'PENDING'"),
            {"i": inst}).fetchall()}
        assert queued == {course.slide_ids[0]: "DRIFT", course.slide_ids[2]: "DRIFT", "gone-slide": "DRIFT"}
        assert db.execute(text("SELECT status, finished_at IS NOT NULL FROM course_knowledge_run WHERE id = :r"),
                          {"r": run_id}).fetchone() == ("DONE", True)
        assert _budget(db, budget.run_budget_id(run_id))[0] == Decimal("3.00")
        run_row = _row(db, inst, "run-row")
        assert run_row[5] is False and run_row[6] is None
        assert _row(db, inst, "old-done") is None
    # nothing new the second time: everything drifted is already queued
    again = sweep.run_once()
    assert again["drift"] == 0 and again["gone"] == 0


def test_sweep_redrives_uncharged_deliveries(Session, monkeypatch):
    inst = _inst()
    key = f"course_kb_ocr:{inst}:file-9"
    charged_calls = []

    def fake_charge(delivered, **kw):
        charged_calls.append((delivered.idempotency_key, delivered.units, kw))
        return Decimal("2")

    monkeypatch.setattr(sweep.billing, "charge", fake_charge)
    with Session() as db:
        _enable(db, inst)
        kb = store.ensure_course_kb(db, inst)
        bid = budget.ensure_month_budget(db, inst, 50)
        paid = {"kind": "ocr_pages", "tool_key": "course_kb_ocr_page", "units": 4, "idempotency_key": key,
                "delivered_at": "2026-01-01T00:00:00+00:00", "charged": None, "budget_id": bid,
                "pointer_kind": "file", "pointer_key": "file-9"}
        store.set_source_state(db, kb=kb, slide_id="paid-slide", title="t", index_state="READY", status="READY",
                               meta={"paid": paid})
        db.execute(text("UPDATE knowledge_base_source SET meta_json = jsonb_set(meta_json, '{paid,delivered_at}', "
                        "to_jsonb(CAST(now() - interval '1 hour' AS text))) WHERE knowledge_base_id = :kb"),
                   {"kb": kb.id})
        db.commit()
    monkeypatch.setattr(sweep, "_gone", lambda db, i, kb: 0)    # the stub slide is not a real lesson
    assert sweep.run_once()["charges"] == 1
    assert charged_calls[0][0] == key and charged_calls[0][1] == 4
    with Session() as db:
        src = store.get_source(db, kb.id, "paid-slide")
        assert src.meta_json["paid"]["charged"] == 2 and src.credits_charged == Decimal("2")
        assert _budget(db, bid)[2] == Decimal("2")
    assert sweep.run_once()["charges"] == 0                     # charged is no longer null


def test_sweep_skips_when_another_replica_holds_the_lock(Session):
    with Session() as holder:
        assert holder.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"),
                              {"k": sweep.LOCK_KEY}).scalar()
        assert sweep.run_once() == {"locked": False, "institutes": 0, "drift": 0, "gone": 0, "charges": 0,
                                    "captions": 0, "runs_closed": 0, "purged": 0, "shadow_purged": 0, "errors": 0}
        holder.rollback()


# ── index_slide end to end ───────────────────────────────────────────────────

def test_index_slide_end_to_end(Session, monkeypatch):
    async def fake_embed(institute_id, model_id, texts):
        out = []
        for i, _t in enumerate(texts):
            v = [0.01] * DIM
            v[i] = 1.0
            out.append(v)
        return out

    monkeypatch.setattr(embedding, "embed_texts", fake_embed)
    inst = _inst()
    with Session() as db:
        course = make_course(db, inst, 1)
        _enable(db, inst)
        queue.enqueue_slides(db, inst, course.slide_ids, reason="TEST")
        db.commit()
    slide = course.slide_ids[0]

    def index_once():
        with Session() as db:   # the sweep below re-queues other tests' lessons; keep them out of claim()
            db.execute(text("UPDATE content_index_queue SET status = 'DONE' "
                            "WHERE status = 'PENDING' AND institute_id <> :i"), {"i": inst})
            db.commit()
        (row,) = [r for r in queue.claim(5) if r.institute_id == inst]
        outcome = asyncio.run(indexer.index_slide(row))
        return outcome, queue.finalize(inst, slide, row.generation, *outcome)

    outcome, stored = index_once()
    assert outcome == ("DONE", None, None) and stored == "DONE"
    with Session() as db:
        kb = store.get_course_kb(db, inst)
        src = store.get_source(db, kb.id, slide)
        assert src.index_state == "READY" and src.status == "READY" and src.chunk_count == 1
        assert src.meta_json["text_kind"] and src.content_hash.startswith("sha256:")
        chunk = db.execute(text("SELECT content_text, embedding_768 IS NULL, meta_data FROM kb_chunk "
                                "WHERE source_id = :s"), {"s": src.id}).fetchone()
        assert "Body of lesson 1" in chunk[0] and chunk[1] is True
        assert chunk[2]["slide_id"] == slide
        updated = src.updated_at

    # republished unchanged: skipped without rewriting, but the source is
    # touched so the drift sweep does not re-queue it every 30 minutes
    with Session() as db:
        db.execute(text("UPDATE slide SET last_sync_date = now() WHERE id = :s"), {"s": slide})
        queue.enqueue_slides(db, inst, [slide], reason="TEST")
        db.commit()
    assert index_once()[0] == ("DONE", None, None)
    with Session() as db:
        again = store.get_source(db, kb.id, slide)
        assert again.updated_at > updated and again.chunk_count == 1 and again.id == src.id
    sweep.run_once()
    with Session() as db:
        assert _row(db, inst, slide)[0] == "DONE"

    # unpublished: tombstoned
    with Session() as db:
        db.execute(text("UPDATE slide SET status = 'DRAFT' WHERE id = :s"), {"s": slide})
        queue.enqueue_slides(db, inst, [slide], reason="TEST")
        db.commit()
    assert index_once()[0] == ("DONE", None, None)
    with Session() as db:
        assert store.get_source(db, kb.id, slide) is None


# ── shared files / kept deliveries ───────────────────────────────────────────

def _ref(slide_id: str) -> SlideRef:
    return SlideRef(slide_id=slide_id, title="t", description="", status="PUBLISHED", source_type="DOCUMENT",
                    doc_type="PDF", pointer_kind="file", pointer_key="file-k")


def test_shared_file_requeue_and_paid_cache_check(Session):
    inst = _inst()
    pointer = f"file-{uuid.uuid4().hex[:8]}"
    waiting = {"kind": "ocr_pages", "tool_key": "course_kb_ocr_page", "units": 3, "pointer_kind": "file",
               "pointer_key": pointer, "delivered_at": None, "idempotency_key": None, "charged": None}
    with Session() as db:
        _enable(db, inst)
        kb = store.ensure_course_kb(db, inst)
        store.set_source_state(db, kb=kb, slide_id="payer", title="t", index_state="READY", status="READY",
                               meta={"paid": dict(waiting, delivered_at="2026-10-21T00:00:00+00:00")})
        for sid in ("sibling-a", "sibling-b"):
            store.set_source_state(db, kb=kb, slide_id=sid, title="t", index_state="NEEDS_PROCESSING",
                                   status="PENDING", meta={"paid": waiting}, content_hash="h")
        store.set_source_state(db, kb=kb, slide_id="other-file", title="t", index_state="NEEDS_PROCESSING",
                               status="PENDING", meta={"paid": dict(waiting, pointer_key="file-x")})
        db.commit()
    snap = indexer._Snapshot(kb=kb, ref=_ref("payer"))
    row = queue.ClaimedRow(institute_id=inst, slide_id="payer", generation=1, allow_paid=True, run_id=None,
                           reason="PROCESS", attempts=1)
    assert indexer._requeue_siblings(row, snap, {"pointer_kind": "file", "pointer_key": pointer}) == 2
    with Session() as db:
        for sid in ("sibling-a", "sibling-b"):
            q = _row(db, inst, sid)
            assert q[0] == "PENDING" and q[5] is False and q[7] == indexer.SHARED_FILE_REASON
        assert _row(db, inst, "other-file") is None and _row(db, inst, "payer") is None
        sibling = store.get_source(db, kb.id, "sibling-a")

    # the sibling's unchanged-hash skip holds until the PAID tier exists
    assert indexer._paid_text_cached(sibling) is False
    assert cache.put("file", pointer, "FREE", [Segment(text="free page")])
    assert indexer._paid_text_cached(sibling) is False
    assert cache.put("file", pointer, "PAID", [Segment(text="ocr page", anchor="page", page=1)])
    assert indexer._paid_text_cached(sibling) is True


def test_kept_delivery_is_found_by_the_sweep(Session, monkeypatch):
    inst = _inst()
    delivered = {"kind": "ocr_pages", "tool_key": "course_kb_ocr_page", "units": 4, "pointer_kind": "file",
                 "pointer_key": "file-k", "idempotency_key": f"course_kb_ocr:{inst}:file-k",
                 "delivered_at": "2026-01-01T00:00:00+00:00", "charged": None, "budget_id": None}
    with Session() as db:
        _enable(db, inst)
        kb = store.ensure_course_kb(db, inst)
        store.set_source_state(db, kb=kb, slide_id="old", title="t", index_state="READY", status="READY",
                               meta={"text_kind": "pdf", "note": None, "paid": None}, content_hash="h")
        db.commit()
    for sid in ("old", "new"):
        snap = indexer._Snapshot(kb=kb, ref=_ref(sid))
        row = queue.ClaimedRow(institute_id=inst, slide_id=sid, generation=1, allow_paid=False, run_id=None,
                               reason="TEST", attempts=1)
        indexer._keep_delivery(row, snap, delivered, None, "FAILED" if sid == "new" else "PENDING")
    with Session() as db:
        old, new = store.get_source(db, kb.id, "old"), store.get_source(db, kb.id, "new")
        # the existing lesson keeps its index, state and hash; only meta.paid changes
        assert old.index_state == "READY" and old.content_hash == "h" and old.meta_json["text_kind"] == "pdf"
        assert old.meta_json["paid"]["idempotency_key"] == delivered["idempotency_key"]
        assert new.index_state == "FAILED" and new.content_hash is None and new.chunk_count == 0
        db.execute(text("UPDATE knowledge_base_source SET meta_json = jsonb_set(meta_json, '{paid,delivered_at}', "
                        "to_jsonb(CAST(now() - interval '1 hour' AS text))) WHERE knowledge_base_id = :kb"),
                   {"kb": kb.id})
        db.commit()
    calls = []
    monkeypatch.setattr(sweep.billing, "charge", lambda d, **kw: calls.append(kw["slide_id"]) or Decimal("2"))
    monkeypatch.setattr(sweep, "_gone", lambda db, i, kb: 0)
    monkeypatch.setattr(sweep, "_drift", lambda db, i, kb, e: 0)
    sweep.run_once()
    assert sorted(calls) == ["new", "old"]
    with Session() as db:
        assert store.get_source(db, kb.id, "old").credits_charged == Decimal("2")


def test_sweep_detaches_rows_of_a_cancelled_run(Session):
    inst = _inst()
    run_id = str(uuid.uuid4())
    with Session() as db:
        db.execute(text("INSERT INTO course_knowledge_run (id, institute_id, package_id, kind, status, created_at) "
                        "VALUES (:r, :i, 'pkg', 'PROCESS', 'CANCELLED', now() - interval '10 minutes')"),
                   {"r": run_id, "i": inst})
        budget.create_run_budget(db, run_id, inst, 20)
        budget.reserve(db, budget.run_budget_id(run_id), 4)
        budget.settle(db, budget.run_budget_id(run_id), 4, 3)
        queue.enqueue_slides(db, inst, ["c-done", "c-failed", "c-busy"], reason="PROCESS", run_id=run_id,
                             allow_paid=True)
        db.execute(text("UPDATE content_index_queue SET status = CASE slide_id WHEN 'c-done' THEN 'DONE' "
                        "WHEN 'c-failed' THEN 'FAILED' ELSE 'PROCESSING' END WHERE run_id = :r"), {"r": run_id})
        db.commit()

    sweep.run_once()
    with Session() as db:
        for sid in ("c-done", "c-failed"):
            q = _row(db, inst, sid)
            assert q[5] is False and q[6] is None
        busy = _row(db, inst, "c-busy")
        assert busy[0] == "PROCESSING" and busy[6] == run_id      # its worker still owns it
        assert _budget(db, budget.run_budget_id(run_id))[0] == Decimal("20.00")   # in flight: not closed
        db.execute(text("UPDATE content_index_queue SET status = 'DONE' WHERE slide_id = 'c-busy' "
                        "AND institute_id = :i"), {"i": inst})
        db.commit()

    sweep.run_once()
    with Session() as db:
        busy = _row(db, inst, "c-busy")
        assert busy[5] is False and busy[6] is None
        assert _budget(db, budget.run_budget_id(run_id))[0] == Decimal("3.00")
        assert db.execute(text("SELECT status FROM course_knowledge_run WHERE id = :r"),
                          {"r": run_id}).scalar() == "CANCELLED"
