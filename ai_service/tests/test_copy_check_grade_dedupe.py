"""POST /copy-check/grade: cross-pod dedupe through copy_check_job and the
per-pod slot gate (spec 11.2, T0.22, gates G6/G11), plus institute_id being
required. No DB: the copy_check_job double below implements the same
INSERT ... ON CONFLICT / stale takeover rules the SQL does.
"""
import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.dependencies import require_internal_service_token
from app.repositories import copy_check_job_repository as jobs_repo
from app.repositories.copy_check_job_repository import (
    CLAIMED,
    DUPLICATE,
    TAKEN_OVER,
    CopyCheckJobRepository,
)
from app.routers import copy_check as router_module
from app.schemas.copy_check import CopyCheckGradeRequest
from app.services.copy_check import job_guard


# ── a copy_check_job table double, keyed on the SQL statement objects ───────

class _Result:
    def __init__(self, rows=(), rowcount=0):
        self._rows, self.rowcount = list(rows), rowcount

    def first(self):
        return self._rows[0] if self._rows else None


class JobTable:
    def __init__(self):
        self.rows = {}
        self.now = datetime(2026, 10, 1, 10, 0, 0)
        self.fail = None

    def session(self):
        table = self

        class _Session:
            def execute(self, stmt, params):
                if table.fail:
                    raise table.fail
                return table._execute(stmt, params)

            def commit(self):
                pass

            def rollback(self):
                pass

        return _Session()

    def _execute(self, stmt, p):
        rows, now = self.rows, self.now
        if stmt is jobs_repo._INSERT:
            if p["process_id"] in rows:
                return _Result()
            rows[p["process_id"]] = {"job_id": p["job_id"], "pod": p["pod"], "heartbeat_at": now,
                                     "status": p["running"]}
            return _Result([(p["job_id"],)])
        if stmt is jobs_repo._TAKE_OVER:
            row = rows.get(p["process_id"])
            # Spec 11.2: only a stale heartbeat allows a takeover, whatever the status.
            stale = row is not None and (
                row["heartbeat_at"] is None
                or row["heartbeat_at"] < now - timedelta(seconds=p["stale_seconds"]))
            if not stale:
                return _Result()
            row.update(job_id=p["job_id"], pod=p["pod"], heartbeat_at=now, status=p["running"])
            return _Result([(p["job_id"],)])
        if stmt is jobs_repo._CURRENT:
            row = rows.get(p["process_id"])
            return _Result([(row["job_id"],)] if row else [])
        if stmt is jobs_repo._HEARTBEAT:
            row = rows.get(p["process_id"])
            if row and row["job_id"] == p["job_id"] and row["status"] == p["running"]:
                row["heartbeat_at"] = now
                return _Result(rowcount=1)
            return _Result(rowcount=0)
        if stmt is jobs_repo._FINISH:
            row = rows.get(p["process_id"])
            if row and row["job_id"] == p["job_id"]:
                row.update(status=p["status"], heartbeat_at=now)
            return _Result()
        if stmt is jobs_repo._PURGE:
            cutoff = now - timedelta(days=p["purge_days"])
            gone = [k for k, r in rows.items()
                    if r["status"] in (p["completed"], p["failed"], p["no_charge"]) and r["heartbeat_at"] < cutoff]
            for k in gone:
                del rows[k]
            return _Result(rowcount=len(gone))
        if stmt is jobs_repo._RELEASE:
            row = rows.get(p["process_id"])
            if row and row["job_id"] == p["job_id"]:
                del rows[p["process_id"]]
            return _Result()
        raise AssertionError(f"unexpected statement {stmt!r}")

    def factory(self):
        @contextmanager
        def _cm():
            yield self.session()
        return _cm


# ── repository rules ────────────────────────────────────────────────────────

def test_first_claim_wins_and_a_live_duplicate_gets_the_running_job():
    table = JobTable()
    repo = CopyCheckJobRepository(table.session())
    assert repo.claim("p1", "job-a", "pod-1").outcome == CLAIMED
    dup = repo.claim("p1", "job-b", "pod-2")
    assert dup.outcome == DUPLICATE and dup.job_id == "job-a" and not dup.owns
    assert table.rows["p1"]["job_id"] == "job-a"


def test_a_claim_silent_for_two_minutes_is_taken_over():
    table = JobTable()
    repo = CopyCheckJobRepository(table.session())
    repo.claim("p1", "job-a", "pod-1")
    table.now += timedelta(seconds=119)
    assert repo.claim("p1", "job-b", "pod-2").outcome == DUPLICATE
    table.now += timedelta(seconds=2)
    taken = repo.claim("p1", "job-b", "pod-2")
    assert taken.outcome == TAKEN_OVER and taken.owns
    assert table.rows["p1"]["job_id"] == "job-b" and table.rows["p1"]["pod"] == "pod-2"
    # The stalled job's heartbeat now fails: the row is not its any more.
    assert repo.heartbeat("p1", "job-a") is False
    assert repo.heartbeat("p1", "job-b") is True


def test_a_just_finished_run_still_answers_duplicates_for_two_minutes():
    table = JobTable()
    repo = CopyCheckJobRepository(table.session())
    repo.claim("p1", "job-a", "pod-1")
    repo.finish("p1", "job-a")
    assert table.rows["p1"]["status"] == jobs_repo.STATUS_COMPLETED
    # A late duplicate POST right after a fast run must not grade the copy again.
    late = repo.claim("p1", "job-b", "pod-2")
    assert late.outcome == DUPLICATE and late.job_id == "job-a"
    table.now += timedelta(seconds=121)
    assert repo.claim("p1", "job-c", "pod-1").outcome == TAKEN_OVER


def test_status_vocabulary_matches_admin_core_v545():
    assert (jobs_repo.STATUS_RUNNING, jobs_repo.STATUS_COMPLETED, jobs_repo.STATUS_FAILED) == (
        "RUNNING", "COMPLETED", "FAILED")
    for stmt in (jobs_repo._INSERT, jobs_repo._TAKE_OVER, jobs_repo._HEARTBEAT, jobs_repo._FINISH):
        assert "updated_at" in str(getattr(stmt, "text", stmt))


def test_purge_deletes_only_old_finished_rows():
    table = JobTable()
    repo = CopyCheckJobRepository(table.session())
    for pid in ("old-done", "old-failed", "old-free", "old-running", "new-done"):
        repo.claim(pid, "j-" + pid, "pod-1")
    repo.finish("old-done", "j-old-done")
    repo.finish("old-failed", "j-old-failed", status=jobs_repo.STATUS_FAILED)
    repo.finish("old-free", "j-old-free", status=jobs_repo.STATUS_NO_CHARGE)
    table.now += timedelta(days=8)
    repo.finish("new-done", "j-new-done")
    assert repo.purge_finished(7) == 3
    assert set(table.rows) == {"old-running", "new-done"}


def test_heartbeat_keeps_the_claim_alive():
    table = JobTable()
    repo = CopyCheckJobRepository(table.session())
    repo.claim("p1", "job-a", "pod-1")
    for _ in range(10):
        table.now += timedelta(seconds=30)
        assert repo.heartbeat("p1", "job-a")
    assert repo.claim("p1", "job-b", "pod-2").outcome == DUPLICATE


def test_claim_degrades_to_none_when_the_table_is_missing():
    table = JobTable()
    table.fail = RuntimeError('relation "copy_check_job" does not exist')
    assert asyncio.run(job_guard.claim("p1", "job-a", table.factory())) is None


def test_heartbeat_loop_stops_when_the_claim_was_taken_over():
    table = JobTable()
    CopyCheckJobRepository(table.session()).claim("p1", "job-a", "pod-1")
    table.rows["p1"]["job_id"] = "job-other"
    # Returns on its own (no cancel needed) once the row is not ours.
    asyncio.run(asyncio.wait_for(job_guard.heartbeat_loop("p1", "job-a", table.factory(), interval=0), 2))


# ── slot gate ───────────────────────────────────────────────────────────────

def test_slot_gate_counts_and_zero_means_unlimited():
    gate = job_guard.SlotGate(2)
    assert gate.try_acquire("a") and gate.try_acquire("b")
    assert not gate.try_acquire("c")
    gate.start("a")
    gate.release("a")
    assert gate.try_acquire("c")
    for j in ("b", "c", "c", "zzz"):
        gate.release(j)
    assert gate.in_use == 0
    unlimited = job_guard.SlotGate(0)
    assert all(unlimited.try_acquire(f"j{i}") for i in range(50))


def test_a_reservation_whose_run_never_starts_is_reclaimed():
    clock = [1000.0]
    gate = job_guard.SlotGate(1, reserve_ttl=60, clock=lambda: clock[0])
    assert gate.try_acquire("leaked")          # background task never ran
    assert not gate.try_acquire("next")
    clock[0] += 61
    assert gate.try_acquire("next")            # the leaked slot came back
    gate.start("next")
    clock[0] += 3600                           # a started run is never reclaimed
    assert gate.in_use == 1 and not gate.try_acquire("third")


def test_gates_default_to_unlimited_and_typed_has_its_own_lane():
    assert job_guard.MAX_CONCURRENT_JOBS == 0 and job_guard.MAX_CONCURRENT_TYPED_JOBS == 0
    assert job_guard.gate_for("COPY") is job_guard.slots
    assert job_guard.gate_for(None) is job_guard.slots
    assert job_guard.gate_for("TYPED") is job_guard.typed_slots


def test_finish_sometimes_purges(monkeypatch):
    table = JobTable()
    CopyCheckJobRepository(table.session()).claim("old", "j-old", "pod-1")
    CopyCheckJobRepository(table.session()).finish("old", "j-old")
    table.now += timedelta(days=8)
    CopyCheckJobRepository(table.session()).claim("p1", "job-a", "pod-1")
    asyncio.run(job_guard.finish("p1", "job-a", table.factory(), purge_rate=0))
    assert "old" in table.rows
    asyncio.run(job_guard.finish("p1", "job-a", table.factory(), purge_rate=1))
    assert "old" not in table.rows and table.rows["p1"]["status"] == "COMPLETED"


# ── schema ──────────────────────────────────────────────────────────────────

def _body(**over):
    body = {"process_id": "p1", "attempt_id": "a1", "assessment_id": "asmt-1", "institute_id": "inst-1",
            "answer_mode": "TYPED", "callback_base_url": "http://cb",
            "questions": [{"question_id": "q1", "question_text": "Explain.", "question_type": "LONG_ANSWER",
                           "max_marks": 5, "student_answer": "An answer."}]}
    body.update(over)
    return body


def test_institute_id_is_required():
    body = _body()
    del body["institute_id"]
    with pytest.raises(ValidationError):
        CopyCheckGradeRequest(**body)
    with pytest.raises(ValidationError):
        CopyCheckGradeRequest(**_body(institute_id=""))
    assert CopyCheckGradeRequest(**_body()).institute_id == "inst-1"


def test_exam_context_is_optional_and_typed():
    req = CopyCheckGradeRequest(**_body(exam_context={"level": "CBSE Class X", "subject": "Science"}))
    assert req.exam_context.level == "CBSE Class X" and req.exam_context.instructions is None
    assert CopyCheckGradeRequest(**_body()).exam_context is None


# ── route ───────────────────────────────────────────────────────────────────

@pytest.fixture
def grade_app(monkeypatch):
    table = JobTable()
    runs = []
    ids = iter(f"job-{i}" for i in range(1, 100))

    async def fake_grade_copy(process_id=None, job_id=None):
        return job_id

    async def fake_run(payload, job_id, db):
        runs.append((payload["process_id"], job_id))
        if payload.get("pdf_url") == "https://b/explode.pdf":
            raise RuntimeError("run crashed")
        return payload.get("_outcome")

    @contextmanager
    def fake_db_session():
        yield object()

    gate = job_guard.SlotGate(1)
    typed_gate = job_guard.SlotGate(0)
    monkeypatch.setattr(router_module, "_new_job_id", lambda: next(ids))
    monkeypatch.setattr(router_module, "grade_copy", fake_grade_copy)
    monkeypatch.setattr(router_module, "run", fake_run)
    monkeypatch.setattr(router_module, "db_session", fake_db_session)
    monkeypatch.setattr(job_guard, "slots", gate)
    monkeypatch.setattr(job_guard, "typed_slots", typed_gate)
    monkeypatch.setattr(job_guard, "_default_session_factory", table.factory())

    app = FastAPI()
    app.include_router(router_module.router)
    app.dependency_overrides[require_internal_service_token] = lambda: None
    return TestClient(app), table, runs, gate


def test_route_runs_once_and_marks_the_claim_done(grade_app):
    client, table, runs, gate = grade_app
    resp = client.post("/copy-check/grade", json=_body())
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"job_id": "job-1", "status": "PROCESSING"}
    assert runs == [("p1", "job-1")]
    assert table.rows["p1"]["status"] == "COMPLETED" and gate.in_use == 0


def _copy_body(**over):
    return _body(**{"answer_mode": "COPY", "pdf_url": "https://b/copy.pdf", **over})


def test_route_marks_the_claim_failed_when_run_raises(grade_app):
    client, table, runs, gate = grade_app
    # TestClient re-raises the background task's exception; the claim and the
    # slot are settled in its finally before that.
    with pytest.raises(RuntimeError, match="run crashed"):
        client.post("/copy-check/grade", json=_copy_body(pdf_url="https://b/explode.pdf"))
    assert runs == [("p1", "job-1")]
    assert table.rows["p1"]["status"] == "FAILED" and gate.in_use == 0


def test_route_duplicate_of_a_live_job_returns_it_and_starts_nothing(grade_app):
    client, table, runs, gate = grade_app
    table.rows["p1"] = {"job_id": "job-live", "pod": "other-pod", "heartbeat_at": table.now, "status": "RUNNING"}
    resp = client.post("/copy-check/grade", json=_body())
    assert resp.status_code == 200
    assert resp.json()["job_id"] == "job-live"
    assert runs == [] and gate.in_use == 0


def test_route_429_when_the_pod_is_full_and_the_claim_is_released(grade_app):
    client, table, runs, gate = grade_app
    gate.try_acquire("busy")  # the one COPY slot is busy
    gate.start("busy")
    resp = client.post("/copy-check/grade", json=_copy_body())
    assert resp.status_code == 429
    assert resp.headers.get("Retry-After") == str(job_guard.RETRY_AFTER_SECONDS)
    assert "p1" not in table.rows and runs == []


def test_route_typed_jobs_are_not_held_back_by_the_copy_lane(grade_app):
    client, table, runs, gate = grade_app
    gate.try_acquire("busy")
    gate.start("busy")
    resp = client.post("/copy-check/grade", json=_body())   # TYPED
    assert resp.status_code == 200, resp.text
    assert runs == [("p1", "job-1")] and gate.in_use == 1


def test_route_still_grades_when_copy_check_job_is_unavailable(grade_app):
    client, table, runs, gate = grade_app
    table.fail = RuntimeError("no such table")
    resp = client.post("/copy-check/grade", json=_body())
    assert resp.status_code == 200
    assert runs == [("p1", "job-1")] and gate.in_use == 0


def test_route_rejects_a_request_without_institute(grade_app):
    client, _table, runs, _gate = grade_app
    body = _body()
    del body["institute_id"]
    assert client.post("/copy-check/grade", json=body).status_code == 422
    assert runs == []


@pytest.mark.parametrize("outcome,status", [
    ("COMPLETED", "COMPLETED"),   # graded, charge due: the reconciliation checks it
    ("NO_CHARGE", "NO_CHARGE"),   # graded, nothing to charge (all typed answers blank)
    ("FAILED", "FAILED"),         # failed copy / cancelled: never billed
    (None, "COMPLETED"),          # an older run() without an outcome: as before
])
def test_route_records_the_run_outcome_on_the_claim(grade_app, monkeypatch, outcome, status):
    client, table, runs, gate = grade_app
    real = router_module.run

    async def run_with_outcome(payload, job_id, db):
        await real(dict(payload, _outcome=outcome), job_id, db)
        return outcome

    monkeypatch.setattr(router_module, "run", run_with_outcome)
    assert client.post("/copy-check/grade", json=_body()).status_code == 200
    assert table.rows["p1"]["status"] == status and gate.in_use == 0
