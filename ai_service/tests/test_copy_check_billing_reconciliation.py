"""Nightly copy-check billing reconciliation (spec 10.5, T1.16): a graded,
chargeable copy (copy_check_job COMPLETED) of the last 48 h with no credit
transaction keyed on its process id is alerted; the job runs on one replica.

No DB: a fake session answers the advisory lock and the unbilled query.
"""
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.copy_check import billing_reconciliation as recon


class _Res:
    def __init__(self, rows=(), scalar=None):
        self._rows, self._scalar = list(rows), scalar

    def fetchall(self):
        return list(self._rows)

    def scalar(self):
        return self._scalar


class ReconDB:
    """copy_check_job rows (process_id, job_id, status, age in minutes) and the
    set of credit_transactions.external_reference_id values."""

    def __init__(self, jobs, billed, locked=True):
        self.jobs, self.billed, self.locked = jobs, set(billed), locked
        self.params = None

    def execute(self, stmt, params=None):
        sql = getattr(stmt, "text", str(stmt))
        if "pg_try_advisory_xact_lock" in sql:
            return _Res(scalar=self.locked)
        assert "FROM copy_check_job" in sql and "external_reference_id = j.process_id" in sql
        self.params = params
        rows = [SimpleNamespace(process_id=pid, job_id=jid, updated_at=datetime(2026, 10, 1, 0, 0) )
                for pid, jid, status, age in self.jobs
                if status == params["completed"]
                and params["grace_minutes"] < age <= params["window_hours"] * 60
                and pid not in self.billed]
        return _Res(rows[: params["max_rows"]])


JOBS = [
    ("p-billed", "j1", "COMPLETED", 120),
    ("p-unbilled", "j2", "COMPLETED", 300),
    ("p-failed", "j3", "FAILED", 300),          # failed copy: free, never flagged
    ("p-free", "j4", "NO_CHARGE", 300),         # all-blank typed copy: nothing due
    ("p-fresh", "j5", "COMPLETED", 5),          # charge may still be in flight
    ("p-old", "j6", "COMPLETED", 49 * 60),      # outside the 48 h window
]


def test_flags_only_completed_unbilled_copies_in_the_window(caplog):
    db = ReconDB(JOBS, billed={"p-billed"})
    with caplog.at_level(logging.ERROR):
        out = recon.reconcile(db, window_hours=48, grace_minutes=15, max_rows=100)
    assert [r["process_id"] for r in out] == ["p-unbilled"]
    assert db.params["completed"] == "COMPLETED"
    alerts = [r.getMessage() for r in caplog.records if recon.ALERT_TAG in r.getMessage()]
    assert any("process_id=p-unbilled" in m for m in alerts)
    assert any("1 copy(ies)" in m for m in alerts)


def test_nothing_unbilled_logs_no_alert(caplog):
    db = ReconDB([("p1", "j1", "COMPLETED", 60)], billed={"p1"})
    with caplog.at_level(logging.INFO):
        assert recon.reconcile(db) == []
    assert not any(recon.ALERT_TAG in r.getMessage() for r in caplog.records)


def test_another_replica_holding_the_lock_skips():
    db = ReconDB(JOBS, billed=set(), locked=False)
    assert recon.reconcile(db) is None and db.params is None


def test_run_reconciliation_never_raises(monkeypatch):
    import sys
    from contextlib import contextmanager

    @contextmanager
    def broken_session():
        raise RuntimeError("relation copy_check_job does not exist")
        yield  # pragma: no cover

    monkeypatch.setattr(sys.modules["app.db"], "db_session", broken_session, raising=False)
    assert recon.run_reconciliation() is None


def test_next_run_is_the_next_configured_utc_time():
    before = datetime(2026, 10, 1, 21, 0, tzinfo=timezone.utc)
    assert recon.seconds_until_next_run(before, hour=21, minute=30) == 30 * 60
    after = datetime(2026, 10, 1, 21, 30, tzinfo=timezone.utc)
    assert recon.seconds_until_next_run(after, hour=21, minute=30) == 24 * 3600
    naive = datetime(2026, 10, 1, 22, 0)
    assert recon.seconds_until_next_run(naive, hour=21, minute=30) == 23.5 * 3600
