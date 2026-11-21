"""Startup sweeper for orphaned ai_gen_video rows.

The AI-video pipeline runs stages as in-process asyncio tasks (the course-flow
HTML continuation is fire-and-forget); a deploy/crash kills them silently and
the row stays PENDING/IN_PROGRESS forever — the slide viewer then spins
"generating" indefinitely and the charged credits are never refunded.

Mirrors sweep_stale_tasks (ai_task) / the reels reaper: on startup, rows stuck
in a non-terminal status past the TTL are marked FAILED and their credits
refunded (institute recovered from the charge transactions, batch_id=video_id).
Best-effort — a sweeper failure must never block boot.
"""
from __future__ import annotations

import logging
from typing import Dict, Optional
from datetime import datetime, timedelta

from sqlalchemy import text

from ..db import db_session
from ..models.ai_gen_video import AiGenVideo
from .token_usage_service import TokenUsageService

logger = logging.getLogger(__name__)

# Generous TTL: the longest legitimate runs (ultra-tier HTML with images) take
# well under an hour; anything older than this is orphaned.
STALE_AFTER_HOURS = 6


def _claim_for_sweep(video, repo=None, claimed: Optional[Dict[str, str]] = None) -> bool:
    """Take a leased run away from any resumer before failing it: a
    compare-and-set to lease state ``sweeping`` on the leg we observed. Rows
    without a lease (legacy) are swept as before.

    An ``interrupted`` lease is swept too: the sweeper only sees rows untouched
    for STALE_AFTER_HOURS, and the resumer only looks at rows created within
    the last 6 h — an interrupted row this old will never be resumed, and
    skipping it would leave it IN_PROGRESS and unrefunded forever."""
    meta = video.extra_metadata if isinstance(getattr(video, "extra_metadata", None), dict) else {}
    lease = meta.get("run_lease") if isinstance(meta.get("run_lease"), dict) else None
    if not lease or not lease.get("leg_id"):
        return True
    try:
        from . import ai_video_run_lease

        if repo is None:
            from ..repositories.ai_video_repository import AiVideoRepository
            repo = AiVideoRepository()
        claim = ai_video_run_lease.new_lease(origin="sweeper", state="sweeping", prev=lease)
        ok = bool(repo.claim_for_resume(video.video_id, lease["leg_id"], claim))
        if ok and claimed is not None:
            claimed[video.video_id] = claim["leg_id"]
        return ok
    except Exception as exc:  # noqa: BLE001 — never block the backstop on the lease
        logger.warning("Sweeper lease claim failed for %s: %s", video.video_id, exc)
        return False


def sweep_stale_ai_videos() -> int:
    """Refund credits for orphaned PENDING/IN_PROGRESS ai_gen_video rows and
    mark them FAILED. Returns the number of rows swept.

    Order matters: refund FIRST, then flip the status. refund_video_credits is
    idempotent (it nets prior REFUND rows against USAGE_DEDUCTION), so a crash
    between the two just re-nets to zero on the next sweep — whereas marking
    FAILED first would permanently skip the refund (FAILED rows are never
    revisited)."""
    swept = 0
    try:
        cutoff = datetime.utcnow() - timedelta(hours=STALE_AFTER_HOURS)
        with db_session() as db:
            stale = (
                db.query(AiGenVideo)
                .filter(
                    AiGenVideo.status.in_(("PENDING", "IN_PROGRESS")),
                    AiGenVideo.updated_at < cutoff,
                )
                .all()
            )
            token_service = TokenUsageService(db)
            claimed: Dict[str, str] = {}
            for video in stale:
                if not _claim_for_sweep(video, claimed=claimed):
                    continue
                try:
                    row = db.execute(
                        text(
                            "SELECT institute_id FROM credit_transactions "
                            "WHERE batch_id = :vid AND transaction_type = 'USAGE_DEDUCTION' "
                            "AND institute_id IS NOT NULL LIMIT 1"
                        ),
                        {"vid": video.video_id},
                    ).fetchone()
                    if row and row.institute_id:
                        token_service.refund_video_credits(video.video_id, row.institute_id)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "Sweeper refund failed for %s: %s", video.video_id, exc
                    )
                video.status = "FAILED"
                video.error_message = (
                    f"Marked failed by sweeper: stuck in "
                    f"{video.current_stage or 'UNKNOWN'} for over {STALE_AFTER_HOURS}h "
                    f"(process likely restarted mid-generation)"
                )
                swept += 1
            db.commit()
        # The swept rows are FAILED now: release the sweeper's lease so a
        # user /retry is not refused with 409 while it would read as live.
        if claimed:
            try:
                from ..repositories.ai_video_repository import AiVideoRepository
                _repo = AiVideoRepository()
                for _vid, _leg in claimed.items():
                    _repo.release_lease(_vid, _leg, "released", interrupt_reason="swept")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Sweeper lease release failed: %s", exc)
        if swept:
            logger.warning("ai_gen_video sweeper: marked %d orphaned run(s) FAILED", swept)
    except Exception as exc:  # noqa: BLE001
        logger.warning("ai_gen_video sweeper skipped: %s", exc)
    return swept


# Re-sweep interval: a crash orphans rows that are younger than the TTL when
# the replacement pod boots — a startup-only sweep would miss them until some
# future restart. 30 min keeps the worst-case wait at TTL + 30 min.
SWEEP_INTERVAL_SECONDS = 30 * 60


def start_ai_video_sweeper() -> None:
    """Run one sweep now, then re-sweep periodically (mirrors the reels reaper)."""
    import asyncio

    async def _loop() -> None:
        while True:
            await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
            await asyncio.to_thread(sweep_stale_ai_videos)

    sweep_stale_ai_videos()
    asyncio.get_event_loop().create_task(_loop())


__all__ = [
    "sweep_stale_ai_videos",
    "start_ai_video_sweeper",
    "STALE_AFTER_HOURS",
    "SWEEP_INTERVAL_SECONDS",
]
