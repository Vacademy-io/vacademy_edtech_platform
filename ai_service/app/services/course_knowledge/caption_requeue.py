"""Re-try YouTube lessons that were marked "no captions" while YouTube was
blocking us (the 30-minute sweep step, and POST /super-admin/v1/youtube-captions/requeue).

Selected, per institute (course KB only, lesson rows):
  * index_state EMPTY or FAILED, text kind 'captions' (meta_json.text_kind or
    the parser column, where write_slide_index stores text_kind);
  * and one of
      - the pre-service note (LEGACY_NO_CAPTIONS_NOTE: blocked and caption-less
        videos both got it),
      - a transient caption outcome (FAILED after MAX_ATTEMPTS while blocked),
        or caption_transient = true,
      - NO_CAPTIONS older than 14 days (the negative-cache lifetime);
      - a definitive answer only the direct route gave with no fallback
        configured (caption_unconfirmed = true);
  * and fewer than MAX_REQUEUES re-queues so far (meta_json.caption_requeues),
    the last one at least 24 h x 2^(n-1) ago (meta_json.caption_requeued_at):
    1, 2, 4, 8, 16 days, then the lesson is left alone (about a month of
    retries for a video that stays unreadable).
PRIVATE / AGE_RESTRICTED / UNAVAILABLE lessons are left alone.

Each selected row gets content_hash = NULL (the only way to make an EMPTY
row re-extract: EMPTY is in the indexer's skip-when-unchanged set), a
caption_requeued_at stamp and caption_requeues + 1, then the lesson is queued
with reason YT_CAPTIONS_RETRY and allow_paid = false. The re-index keeps both
keys (store.STICKY_META_KEYS) unless it ends READY, which clears them. An
EMPTY row has no chunks, so nothing is lost; a FAILED row keeps its last
chunks if the retry fails again.

The sweep runs this only when requeue is enabled AND the caption canary just
passed (captions_ok): the canary is a network call made by the worker BEFORE
the sweep opens its holder session. Only DB work happens in here.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from ...db import db_session
from ..youtube_captions import TRANSIENT
from . import flags, store
from .extract.media import LEGACY_NO_CAPTIONS_NOTE
from .queue import enqueue_slides

logger = logging.getLogger(__name__)

REASON = "YT_CAPTIONS_RETRY"
REQUEUE_EVERY_HOURS = 24
MAX_REQUEUES = 6
NO_CAPTIONS_RECHECK_DAYS = 14
MAX_ON_DEMAND = 2000
TRANSIENT_OUTCOMES: Tuple[str, ...] = tuple(sorted(o.value for o in TRANSIENT))

_PREDICATE = """
       kbs.slide_id IS NOT NULL
   AND kbs.index_state IN ('EMPTY', 'FAILED')
   AND (kbs.meta_json->>'text_kind' = 'captions' OR kbs.parser = 'captions')
   AND (    kbs.meta_json->>'note' = :legacy_note
         OR kbs.meta_json->>'caption_outcome' IN :transient
         OR kbs.meta_json->>'caption_transient' = 'true'
         OR kbs.meta_json->>'caption_unconfirmed' = 'true'
         OR (kbs.meta_json->>'caption_outcome' = 'NO_CAPTIONS'
             AND kbs.updated_at < now() - (CAST(:recheck_days AS integer) * interval '1 day')))
   AND COALESCE(CAST(kbs.meta_json->>'caption_requeues' AS integer), 0) < CAST(:max_requeues AS integer)
   AND COALESCE(CAST(kbs.meta_json->>'caption_requeued_at' AS timestamptz), CAST('epoch' AS timestamptz))
       < now() - (CAST(:every_hours AS integer) * interval '1 hour')
                 * power(2, GREATEST(COALESCE(CAST(kbs.meta_json->>'caption_requeues' AS integer), 0) - 1, 0))
"""

_SELECT_SQL = text(
    "SELECT kbs.id, kbs.slide_id FROM knowledge_base_source kbs"
    " WHERE kbs.institute_id = :inst AND kbs.knowledge_base_id = :kb AND" + _PREDICATE
    + " ORDER BY kbs.updated_at LIMIT :n"
).bindparams(bindparam("transient", expanding=True))

_ANY_SQL = text(
    "SELECT kbs.institute_id FROM knowledge_base_source kbs WHERE" + _PREDICATE + " LIMIT 1"
).bindparams(bindparam("transient", expanding=True))

_MARK_SQL = text(
    """
    UPDATE knowledge_base_source
       SET content_hash = NULL,
           meta_json = COALESCE(meta_json, CAST('{}' AS jsonb)) || jsonb_build_object(
               'caption_requeued_at', CAST(:now AS text),
               'caption_requeues', COALESCE(CAST(meta_json->>'caption_requeues' AS integer), 0) + 1)
     WHERE id IN :ids
    RETURNING slide_id
    """
).bindparams(bindparam("ids", expanding=True))

_ENABLED_SQL = text(
    "SELECT institute_id FROM course_knowledge_setting WHERE enabled = TRUE ORDER BY institute_id"
)


def _params(**kw: Any) -> Dict[str, Any]:
    base = {"legacy_note": LEGACY_NO_CAPTIONS_NOTE, "transient": list(TRANSIENT_OUTCOMES),
            "recheck_days": NO_CAPTIONS_RECHECK_DAYS, "every_hours": REQUEUE_EVERY_HOURS,
            "max_requeues": MAX_REQUEUES}
    base.update(kw)
    return base


def requeue_youtube_caption_lessons(db: Session, *, institute_id: str, limit: int,
                                    dry_run: bool = False, kb_id: Optional[str] = None) -> Dict[str, int]:
    """Select, stamp and queue one institute's caption lessons. Does not commit
    (the caller's transaction does). Returns {"selected", "queued"}."""
    out = {"selected": 0, "queued": 0}
    if limit <= 0 or not institute_id:
        return out
    if kb_id is None:
        kb = store.get_course_kb(db, institute_id)
        if kb is None:
            return out
        kb_id = kb.id
    rows = db.execute(_SELECT_SQL, _params(inst=institute_id, kb=kb_id, n=int(limit))).fetchall()
    out["selected"] = len(rows)
    if dry_run or not rows:
        return out
    now = datetime.now(timezone.utc).isoformat()
    slide_ids = [r[0] for r in db.execute(_MARK_SQL, {"ids": [r[0] for r in rows], "now": now}).fetchall()]
    out["queued"] = enqueue_slides(db, institute_id, slide_ids, reason=REASON, allow_paid=False) if slide_ids else 0
    if out["queued"]:
        logger.info("yt_captions requeue: %d YouTube lesson(s) of %s queued again (%s)",
                    out["queued"], institute_id, REASON)
    return out


def sweep_limit(captions_ok: bool) -> int:
    """How many lessons this sweep may re-queue (0 = skip, with the reason logged)."""
    from ..youtube_captions.service import load_config
    try:
        cfg = load_config()
    except Exception:  # noqa: BLE001
        return 0
    if not cfg.requeue_enabled:
        return 0
    if not captions_ok:
        logger.info("yt_captions requeue: skipped this sweep (the caption canary did not pass or was not run)")
        return 0
    return int(cfg.requeue_per_sweep)


def candidates_exist() -> bool:
    """Any lesson to re-queue at all (one short session). Blocking."""
    try:
        with db_session() as db:
            return db.execute(_ANY_SQL, _params()).first() is not None
    except Exception:  # noqa: BLE001
        logger.warning("yt_captions requeue: candidate check failed", exc_info=True)
        return False


_CANARY: Dict[str, Any] = {"at": None, "ok": False}
CANARY_PASS_TTL_S = 2 * 3600
CANARY_FAIL_TTL_S = 25 * 60
_last_skip_log = 0.0


async def captions_ok_for_sweep() -> bool:
    """Called by the worker BEFORE the sweep (network, no DB session open):
    requeue enabled, canary ids set, something to re-queue, canary passes.
    A pass is reused for 2 h and a failure for 25 min, so the two replicas'
    workers do not spend proxy traffic every 30 minutes."""
    global _last_skip_log
    import asyncio
    from ..youtube_captions import service as yt_service
    cfg = await asyncio.to_thread(yt_service.load_config)
    if not cfg.requeue_enabled:
        return False
    if not cfg.canary_video_ids:
        if time.monotonic() - _last_skip_log > 3600:
            _last_skip_log = time.monotonic()
            logger.info("yt_captions requeue: waiting for youtube_captions.canary_video_ids to be set")
        return False
    if not await asyncio.to_thread(candidates_exist):
        return False
    at = _CANARY["at"]
    if at is not None:
        ttl = CANARY_PASS_TTL_S if _CANARY["ok"] else CANARY_FAIL_TTL_S
        if time.monotonic() - at < ttl:
            return bool(_CANARY["ok"])
    ok = await yt_service.canary_ok(cfg)
    _CANARY.update(at=time.monotonic(), ok=ok)
    return ok


def run_on_demand(*, institute_id: Optional[str] = None, dry_run: bool = True,
                  limit: int = 300) -> Dict[str, Any]:
    """Staff endpoint: one short transaction per institute. Blocking."""
    limit = max(1, min(MAX_ON_DEMAND, int(limit)))
    summary: Dict[str, Any] = {"dry_run": dry_run, "institutes": 0, "selected": 0, "queued": 0, "errors": 0}
    if institute_id:
        institutes: List[str] = [institute_id]
    else:
        with db_session() as db:
            institutes = [r[0] for r in db.execute(_ENABLED_SQL).fetchall()]
    remaining = limit
    for inst in institutes:
        if remaining <= 0:
            break
        if not institute_id and not flags.available(inst):
            continue
        try:
            with db_session() as db:
                got = requeue_youtube_caption_lessons(db, institute_id=inst, limit=remaining, dry_run=dry_run)
                db.commit()
        except Exception:  # noqa: BLE001 - one institute never stops the run
            summary["errors"] += 1
            logger.exception("yt_captions requeue: institute %s failed", inst)
            continue
        summary["institutes"] += 1
        summary["selected"] += got["selected"]
        summary["queued"] += got["queued"]
        remaining -= got["selected"]
    return summary


__all__ = ["REASON", "requeue_youtube_caption_lessons", "sweep_limit", "candidates_exist",
           "captions_ok_for_sweep", "run_on_demand", "TRANSIENT_OUTCOMES"]
