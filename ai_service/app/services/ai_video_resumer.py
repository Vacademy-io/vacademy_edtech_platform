"""Auto-resume of AI-video runs whose leg died (deploy, OOM, node loss).

Runs on every replica: first scan 30 s after boot, then every 90 s ± 20 s.
A scan reads ``AiVideoRepository.find_resumable`` (a live-looking status, a
recorded ``run_request``, a lease that is ``interrupted`` from before this
process booted or whose heartbeat is > 180 s old, created < 6 h ago), then
for each row:

  1. decides: a crash (stale heartbeat) may be resumed at most
     ``MAX_CRASH_RESUMES`` times, the n-th one no sooner than n × 5 min after
     the stale heartbeat; a drain (``interrupted``) at most
     ``MAX_DRAIN_RESUMES`` times. Over a cap → ``fail_and_refund``;
  2. claims the run with a compare-and-set on the observed ``leg_id``
     (exactly one pod wins), bumping the matching counter;
  3. starts the next leg through the shared runner
     (external_video_generation.start_video_generation) with
     ``resume=True, resume_from_stage=<from checkpoint.completed_stages>,
     resume_mode="auto"`` and the run request's kwargs (rehydrated). LMS runs
     get hooks that notify the creator only on the final COMPLETED / FAILED.

Per-pod capacity: ``AI_VIDEO_RESUME_MAX_CONCURRENT`` (default 2) auto-resumed
legs. No credit pre-flight (the run was pre-flighted; in-run billing allows a
negative balance). Rows without a run request (legacy) are never resumed —
the 6 h sweeper still covers them.
"""
from __future__ import annotations

import asyncio
import logging
import os
import random
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from . import ai_video_run_lease as run_lease

logger = logging.getLogger(__name__)

FIRST_SCAN_DELAY_S = 30.0
SCAN_INTERVAL_S = 90.0
SCAN_JITTER_S = 20.0
# Until the graceful drain ships, a deploy kill looks like a crash (30 s grace,
# no preStop), and deploys land several times a day — so allow a few more
# resumes than a true crash loop needs. The backoff still spaces them out.
MAX_CRASH_RESUMES = int(os.environ.get("AI_VIDEO_RESUME_MAX_CRASH", "4"))
MAX_DRAIN_RESUMES = 8
CRASH_BACKOFF_S = 300
SCAN_LIMIT = 20


def max_concurrent() -> int:
    try:
        return max(0, int(os.environ.get("AI_VIDEO_RESUME_MAX_CONCURRENT", "2")))
    except ValueError:
        return 2


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        try:  # Postgres now()::text — "2026-10-22 10:11:12.123+00"
            txt = str(value)
            if len(txt) > 3 and txt[-3] in "+-" and ":" not in txt[-3:]:
                txt += ":00"
            dt = datetime.fromisoformat(txt)
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def decide(lease: Dict[str, Any], now: Optional[datetime] = None) -> Tuple[str, str, Dict[str, int]]:
    """(action, kind, counters) for a resumable row's lease.

    action: ``resume`` | ``wait`` (crash backoff) | ``give_up`` (cap hit).
    kind:   ``drain`` (state interrupted) | ``crash``.
    counters: the crash/drain counters the NEW lease carries."""
    now = now or datetime.now(timezone.utc)
    lease = lease or {}
    crash = int(lease.get("crash_resumes") or 0)
    drain = int(lease.get("drain_resumes") or 0)
    if lease.get("state") == "interrupted":
        if drain >= MAX_DRAIN_RESUMES:
            return "give_up", "drain", {"crash_resumes": crash, "drain_resumes": drain}
        return "resume", "drain", {"crash_resumes": crash, "drain_resumes": drain + 1}
    if crash >= MAX_CRASH_RESUMES:
        return "give_up", "crash", {"crash_resumes": crash, "drain_resumes": drain}
    hb = _parse_ts(lease.get("heartbeat_at"))
    if crash > 0 and hb is not None and (now - hb).total_seconds() < run_lease.LEASE_STALE_S + crash * CRASH_BACKOFF_S:
        return "wait", "crash", {"crash_resumes": crash, "drain_resumes": drain}
    return "resume", "crash", {"crash_resumes": crash + 1, "drain_resumes": drain}


def _default_repo():
    from ..repositories.ai_video_repository import AiVideoRepository
    return AiVideoRepository()


def _institute_of(meta: Dict[str, Any]) -> Optional[str]:
    rr = meta.get("run_request") if isinstance(meta.get("run_request"), dict) else {}
    return meta.get("institute_id") or rr.get("institute_id")


def _refund(video_id: str, institute_id: Optional[str]) -> None:
    from ..db import db_session
    from .token_usage_service import TokenUsageService

    if not institute_id:
        return
    with db_session() as db:
        TokenUsageService(db).refund_video_credits(video_id, institute_id)


async def fail_and_refund(
    video_id: str,
    reason: str,
    lease: Dict[str, Any],
    *,
    repo: Any = None,
    refund=_refund,
) -> bool:
    """Give up on a run: claim it (CAS, state ``failing``) so only one pod
    does this, refund FIRST, then mark FAILED, release the lease, and tell an
    LMS creator. False when another pod won the claim."""
    repo = repo or _default_repo()
    claim = run_lease.new_lease(origin="auto_resume", state="failing", prev=lease)
    if not await asyncio.to_thread(repo.claim_for_resume, video_id, str(lease.get("leg_id") or ""), claim):
        return False
    rec = await asyncio.to_thread(repo.get_by_video_id, video_id)
    meta = (getattr(rec, "extra_metadata", None) or {}) if rec is not None else {}
    try:
        await asyncio.to_thread(refund, video_id, _institute_of(meta))
    except Exception as exc:  # noqa: BLE001 — the sweeper re-nets refunds later
        logger.error("[Resumer] refund failed for %s: %s", video_id, exc)
    msg = f"Generation stopped after repeated interruptions ({reason}); credits refunded."
    await asyncio.to_thread(repo.mark_failed, video_id, msg)
    await asyncio.to_thread(
        repo.release_lease, video_id, claim["leg_id"], "released",
        history={"leg_id": claim["leg_id"], "owner_pod": claim["owner_pod"], "origin": "auto_resume",
                 "started_at": claim["started_at"], "ended_at": run_lease.now_iso(),
                 "outcome": "gave_up", "reason": reason},
    )
    if meta.get("source") == "lms":
        try:
            from ..routers import lms_video

            await lms_video.notify_creator(
                str(_institute_of(meta) or ""), meta.get("created_by_user_id"), video_id,
                str(meta.get("lms_topic") or ""), meta.get("context") or {}, "FAILED",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Resumer] LMS notify failed for %s: %s", video_id, exc)
    logger.warning("[Resumer] gave up on %s (%s): refunded + FAILED", video_id, reason)
    return True


class _DiscardQueue(asyncio.Queue):
    """Nobody streams a course-builder leg's events."""

    async def put(self, item):  # noqa: D401
        return None

    def put_nowait(self, item):
        return None


def dispatch(video_id: str, rec: Any, run_request: Dict[str, Any], lease: Dict[str, Any],
             start_stage: str, *, start=None) -> Any:
    """Start the resumed leg through the shared runner."""
    from ..routers import external_video_generation as ext
    from .video_run_request import rehydrate

    start = start or ext.start_video_generation
    meta = (getattr(rec, "extra_metadata", None) or {}) if rec is not None else {}
    kwargs = rehydrate(run_request, rec)
    kind = run_request.get("kind") or "external"
    target = kwargs.get("target_stage") or "HTML"
    inst = str(kwargs.get("institute_id") or _institute_of(meta) or "")
    common = dict(
        user_id=kwargs.get("user_id"),
        track_concurrency=False,
        run_request_kind=kind,
        generate_kwargs=kwargs,
        resume=True,
        resume_from_stage=start_stage,
        resume_mode="auto",
        lease=lease,
    )
    if kind == "lms":
        from ..routers import lms_video

        hooks = lms_video.resume_hooks(video_id, meta)
        return start(None, video_id, target, inst, queue=_DiscardQueue(),
                     on_event=hooks.on_event, on_finished=hooks.on_finished, **common)
    if kind in ("course_builder", "storybook_builder"):
        return start(None, video_id, target, inst, queue=_DiscardQueue(), **common)
    # external: a real queue, registered in _generation_queues, so /cancel and
    # an SSE re-connect (POST /generate with this video_id) reach the leg.
    return start(None, video_id, target, inst, **common)


async def scan_once(*, repo: Any = None, start=None, now: Optional[datetime] = None) -> Dict[str, List[str]]:
    """One resumer pass. Returns {resumed, gave_up, waiting, skipped} ids."""
    from .video_generation_service import VideoGenerationService

    repo = repo or _default_repo()
    out: Dict[str, List[str]] = {"resumed": [], "gave_up": [], "waiting": [], "skipped": []}
    cap = max_concurrent()
    if cap <= 0:
        return out
    try:
        rows = await asyncio.to_thread(repo.find_resumable, SCAN_LIMIT, run_lease.BOOT_AT)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Resumer] scan failed: %s", exc)
        return out
    for row in rows:
        vid = row.get("video_id")
        lease = row.get("lease") or {}
        if not vid or not lease.get("leg_id"):
            out["skipped"].append(str(vid))
            continue
        if run_lease.active_leg(vid) is not None:
            out["skipped"].append(vid)  # running on this very pod
            continue
        action, kind, counters = decide(lease, now)
        if action == "wait":
            out["waiting"].append(vid)
            continue
        if action == "give_up":
            reason = f"{kind} resume cap reached ({counters})"
            if await fail_and_refund(vid, reason, lease, repo=repo):
                out["gave_up"].append(vid)
            continue
        # Legs dispatched in this scan register only once their task runs, so
        # count them too.
        _busy = {h.video_id for h in run_lease.active_legs() if h.origin == "auto_resume"} | set(out["resumed"])
        if len(_busy) >= cap:
            out["skipped"].append(vid)
            break
        rec = await asyncio.to_thread(repo.get_by_video_id, vid)
        meta = (getattr(rec, "extra_metadata", None) or {}) if rec is not None else {}
        rr = meta.get("run_request") if isinstance(meta, dict) else None
        if not isinstance(rr, dict):
            out["skipped"].append(vid)  # legacy row — the sweeper's job
            continue
        new = run_lease.new_lease(origin="auto_resume", prev=lease, **counters)
        try:
            claimed = await asyncio.to_thread(repo.claim_for_resume, vid, lease["leg_id"], new)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Resumer] claim failed for %s: %s", vid, exc)
            claimed = False
        if not claimed:
            out["skipped"].append(vid)  # another pod won
            continue
        start_stage = VideoGenerationService.resume_start_stage(rec)
        final = str(rr.get("final_target_stage") or "HTML").upper()
        stages = VideoGenerationService.STAGES
        if start_stage is None or stages.index(start_stage) > stages.index(final):
            # Every stage it asked for is done: nothing to run.
            await asyncio.to_thread(repo.release_lease, vid, new["leg_id"], "released")
            out["skipped"].append(vid)
            continue
        logger.warning("[Resumer] claimed %s (%s resume #%s) — restarting at %s",
                       vid, kind, counters[f"{kind}_resumes"], start_stage)
        try:
            dispatch(vid, rec, rr, new, start_stage, start=start)
            out["resumed"].append(vid)
        except Exception as exc:  # noqa: BLE001
            logger.error("[Resumer] dispatch failed for %s: %s", vid, exc, exc_info=True)
            # Leave the claimed lease to go stale: the next scan retries it
            # (counted), and the caps still bound it.
    return out


_task: Optional[asyncio.Task] = None


def start_ai_video_resumer() -> None:
    """Start the periodic resumer on the running event loop (idempotent)."""
    global _task
    if _task is not None and not _task.done():
        return

    async def _loop() -> None:
        await asyncio.sleep(FIRST_SCAN_DELAY_S)
        while True:
            try:
                res = await scan_once()
                if any(res.values()):
                    logger.info("[Resumer] scan: %s", {k: v for k, v in res.items() if v})
            except Exception as exc:  # noqa: BLE001
                logger.warning("[Resumer] scan crashed: %s", exc)
            await asyncio.sleep(SCAN_INTERVAL_S + random.uniform(-SCAN_JITTER_S, SCAN_JITTER_S))

    _task = asyncio.get_event_loop().create_task(_loop())


__all__ = [
    "CRASH_BACKOFF_S", "MAX_CRASH_RESUMES", "MAX_DRAIN_RESUMES", "decide", "dispatch",
    "fail_and_refund", "max_concurrent", "scan_once", "start_ai_video_resumer",
]
