"""Repository for the copy_check_job table: one cross-pod claim per grade run.

Spec 11.2 / gate G6. Before this table the only record of a running job was
the per-pod `_jobs` dict, so a retried POST /copy-check/grade (Java retries on
timeout) or a stale-sweeper requeue that landed on the other pod started a
second run of the same copy: duplicate callbacks, duplicate question rows and
twice the LLM cost.

All statements use the database clock (`now()`), so pods with skewed clocks
still agree on whether a heartbeat is stale.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

# A running job refreshes its heartbeat this often…
HEARTBEAT_SECONDS = 30
# …and a claim whose heartbeat is older than this is presumed dead.
STALE_AFTER_SECONDS = 120

# Same vocabulary as the admin_core V546 column comment: RUNNING | COMPLETED | FAILED,
# plus NO_CHARGE. COMPLETED = the copy was graded and a charge is due (the
# nightly billing reconciliation looks for a credit transaction keyed on the
# process id); NO_CHARGE = graded with nothing to charge (every typed answer
# blank); FAILED = not graded (failed copy, cancelled, or the run crashed).
STATUS_RUNNING = "RUNNING"
STATUS_COMPLETED = "COMPLETED"
STATUS_FAILED = "FAILED"
STATUS_NO_CHARGE = "NO_CHARGE"
FINISHED_STATUSES = (STATUS_COMPLETED, STATUS_FAILED, STATUS_NO_CHARGE)

# Finished rows are deleted this many days after their last heartbeat.
PURGE_AFTER_DAYS = 7

# Outcomes of claim().
CLAIMED = "claimed"          # no row existed; this job owns the process now
TAKEN_OVER = "taken_over"    # a stale claim existed; this job owns it now
DUPLICATE = "duplicate"      # a claim with a fresh heartbeat exists; job_id is that job

_INSERT = text(
    "INSERT INTO copy_check_job (process_id, job_id, pod, heartbeat_at, status, created_at, updated_at) "
    "VALUES (:process_id, :job_id, :pod, now(), :running, now(), now()) "
    "ON CONFLICT (process_id) DO NOTHING "
    "RETURNING job_id"
)

_TAKE_OVER = text(
    "UPDATE copy_check_job "
    "SET job_id = :job_id, pod = :pod, heartbeat_at = now(), status = :running, updated_at = now() "
    "WHERE process_id = :process_id "
    "  AND (heartbeat_at IS NULL "
    "       OR heartbeat_at < now() - (CAST(:stale_seconds AS double precision) * interval '1 second')) "
    "RETURNING job_id"
)

_CURRENT = text("SELECT job_id FROM copy_check_job WHERE process_id = :process_id")

_HEARTBEAT = text(
    "UPDATE copy_check_job SET heartbeat_at = now(), updated_at = now() "
    "WHERE process_id = :process_id AND job_id = :job_id AND status = :running"
)

_FINISH = text(
    "UPDATE copy_check_job SET status = :status, heartbeat_at = now(), updated_at = now() "
    "WHERE process_id = :process_id AND job_id = :job_id"
)

_RELEASE = text("DELETE FROM copy_check_job WHERE process_id = :process_id AND job_id = :job_id")

# Housekeeping: finished rows are only needed for the 2-minute duplicate window
# (and a little forensics); idx_copy_check_job_status_heartbeat serves this.
_PURGE = text(
    "DELETE FROM copy_check_job "
    "WHERE status IN (:completed, :failed, :no_charge) "
    "  AND heartbeat_at < now() - (CAST(:purge_days AS double precision) * interval '1 day')"
)


@dataclass(frozen=True)
class ClaimResult:
    outcome: str
    job_id: str

    @property
    def owns(self) -> bool:
        return self.outcome in (CLAIMED, TAKEN_OVER)


class CopyCheckJobRepository:
    def __init__(self, db: Session):
        self.db = db

    def _one(self, stmt, **params) -> Optional[str]:
        row = self.db.execute(stmt, params).first()
        return None if row is None else str(row[0])

    def claim(
        self,
        process_id: str,
        job_id: str,
        pod: Optional[str],
        stale_after_seconds: int = STALE_AFTER_SECONDS,
    ) -> ClaimResult:
        """Claim `process_id` for `job_id` (one commit per statement).

        INSERT … ON CONFLICT DO NOTHING; on conflict take the row over only when
        its heartbeat is older than `stale_after_seconds` (spec 11.2), whatever
        its status; otherwise answer with the job that holds it. A run that
        finished moments ago therefore still answers a late duplicate POST with
        its job instead of grading the copy a second time. (assessment_service
        re-dispatches the same process only after 30 silent minutes - the stale
        sweeper - so no legitimate re-run lands inside that window.) Raises whatever the driver raises (e.g. the table does
        not exist yet) after rolling back - the caller decides how to degrade.
        """
        try:
            for _ in range(2):
                if self._one(_INSERT, process_id=process_id, job_id=job_id, pod=pod,
                             running=STATUS_RUNNING) is not None:
                    self.db.commit()
                    return ClaimResult(CLAIMED, job_id)
                if self._one(_TAKE_OVER, process_id=process_id, job_id=job_id, pod=pod,
                             running=STATUS_RUNNING,
                             stale_seconds=int(stale_after_seconds)) is not None:
                    self.db.commit()
                    return ClaimResult(TAKEN_OVER, job_id)
                existing = self._one(_CURRENT, process_id=process_id)
                self.db.commit()
                if existing is not None:
                    return ClaimResult(DUPLICATE, existing)
                # The holder released its row between our statements; try again.
            # The row appeared and vanished twice under us; let the caller degrade.
            raise RuntimeError(f"could not claim copy_check_job for process {process_id}")
        except Exception:
            self.db.rollback()
            raise

    def heartbeat(self, process_id: str, job_id: str) -> bool:
        """Refresh this job's heartbeat. False = the row is no longer ours
        (taken over after a stall) or no longer running."""
        result = self.db.execute(_HEARTBEAT, {"process_id": process_id, "job_id": job_id,
                                              "running": STATUS_RUNNING})
        self.db.commit()
        return (result.rowcount or 0) > 0

    def finish(self, process_id: str, job_id: str, status: str = STATUS_COMPLETED) -> None:
        """Mark the run ended (COMPLETED or FAILED). A later /grade for the
        same process may take the row over once 2 minutes have passed."""
        self.db.execute(_FINISH, {"process_id": process_id, "job_id": job_id, "status": status})
        self.db.commit()

    def release(self, process_id: str, job_id: str) -> None:
        """Drop this job's claim without having run it (the pod was full)."""
        self.db.execute(_RELEASE, {"process_id": process_id, "job_id": job_id})
        self.db.commit()

    def purge_finished(self, older_than_days: int = PURGE_AFTER_DAYS) -> int:
        """Delete finished rows whose last heartbeat is older than
        `older_than_days`. Returns the number of rows deleted."""
        result = self.db.execute(_PURGE, {"completed": STATUS_COMPLETED, "failed": STATUS_FAILED,
                                          "no_charge": STATUS_NO_CHARGE,
                                          "purge_days": int(older_than_days)})
        self.db.commit()
        return int(result.rowcount or 0)
