"""index_slide: index ONE claimed lesson (spec §6.3).

    snapshot (short session) -> tombstone? -> unchanged? -> free extract (no session)
    -> [paid: quote + reserve (short session) -> paid extract -> charge -> settle]
    -> chunk -> embed (no session) -> write source + chunks (one short transaction)
    -> [after a paid delivery: re-queue, free, the lessons waiting for the same file]

An unchanged lesson is skipped (its source only touched), except one waiting
for paid text that another lesson's run has since put in the PAID cache. A
delivery whose index is not written (embedding failure, storage limit, error)
still records meta.paid, so the sweep can re-drive an unbilled charge.

No DB session is ever open across a network call (download, OCR,
transcription, embeddings): the 2026-08-19 pool exhaustion was a session held
across slow calls, and kb/ingest.ingest_source still does exactly that, which
is why it is not reused here.

Returns (final_status, not_before, error) for queue.finalize: not_before is a
delay in seconds (None keeps the row's). Never raises except CancelledError:
an unexpected error retries with exponential backoff (2^attempts minutes) and
gives up as FAILED after queue.MAX_ATTEMPTS claims.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import weakref
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text

from ...db import db_session
from ..kb.chunking import CHUNK_SIZE, build_chunks
from ..kb.parsing import ParsedPage
from . import billing, budget, embedding, flags, settings_store, store, tree
from .extract import cache, describe, registry
from .extract.media import collapse_repeats
from .extract.types import Extraction, PaidPermit, Segment, SlideRef
from .queue import MAX_ATTEMPTS, ClaimedRow, enqueue_slides, give_back_attempt
from .settings_store import CourseKnowledgeSetting

logger = logging.getLogger(__name__)

Outcome = Tuple[str, Optional[float], Optional[str]]

PENDING_RECHECK_S = 600                # a transcription job is still running
LONG_LESSON_NOTE = "Long lesson: only the first part is used"
STORAGE_LIMIT_NOTE = "storage limit"
MONTH_BUDGET_NOTE = "Monthly AI budget reached"
RUN_BUDGET_NOTE = "Over the approved amount"
EMBED_RETRY_NOTE = "Embedding failed; the lesson will be retried"
_SPOKEN_KINDS = frozenset({"captions", "transcript", "script"})
PAID_RETRY_NOTE = "The transcription or reading service is busy: retrying automatically (nothing charged yet)"
# A paid provider that is busy, out of credit or briefly down: worth retrying later,
# unlike a file it cannot read. Matched on the extractor's note (registry wraps the error).
_TRANSIENT_PAID_RE = re.compile(
    r"\b(?:402|408|429|5\d\d)\b|at capacity|timed? ?out|timeout|temporar|connection|"
    r"unavailable|overloaded|rate.?limit|try again",
    re.IGNORECASE,
)

SHARED_FILE_REASON = "SHARED_FILE_READY"
MAX_SIBLINGS = 500                     # lessons re-queued when a shared file's paid text lands

OCR_CONCURRENCY = 2                    # paid OCR extractions per pod
TRANSCRIBE_CONCURRENCY = 1             # paid transcriptions per pod
HEARTBEAT_S = 300                      # refresh claimed_at during a paid step (re-arm: queue.STALE_MINUTES)

_STATE_FOR = {
    "READY": "READY", "NEEDS_PAID": "NEEDS_PROCESSING", "EMPTY": "EMPTY",
    "UNSUPPORTED": "UNSUPPORTED", "FAILED": "FAILED",
}
_SKIP_WHEN_UNCHANGED = ("READY", "EMPTY", "UNSUPPORTED")
_OCR_KINDS = ("ocr_pages", "deck_images")


# ----------------------------------------------------------------------
# per-pod concurrency for paid work
# ----------------------------------------------------------------------
class _Gates:
    """Semaphores per paid kind plus one lock per pointer, so two lessons that
    share a file never both call the provider: the second waits, then finds
    the first one's text in the PAID cache. Per process only; across replicas
    the ledger keys keep the charge single."""

    def __init__(self) -> None:
        self.ocr = asyncio.Semaphore(OCR_CONCURRENCY)
        self.transcribe = asyncio.Semaphore(TRANSCRIBE_CONCURRENCY)
        self.pointers: Dict[str, asyncio.Lock] = {}
        self.users: Dict[str, int] = {}

    @asynccontextmanager
    async def hold(self, kind: str, pointer: str):
        sem = self.transcribe if kind == "transcribe_minutes" else self.ocr
        lock = self.pointers.setdefault(pointer, asyncio.Lock())
        self.users[pointer] = self.users.get(pointer, 0) + 1
        try:
            async with lock:
                async with sem:
                    yield
        finally:
            self.users[pointer] -= 1
            if self.users[pointer] <= 0:
                self.users.pop(pointer, None)
                self.pointers.pop(pointer, None)


# asyncio primitives belong to one event loop; keep one set per loop.
_GATES: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, _Gates]" = weakref.WeakKeyDictionary()


def _gates() -> _Gates:
    loop = asyncio.get_running_loop()
    gates = _GATES.get(loop)
    if gates is None:
        gates = _GATES[loop] = _Gates()
    return gates


# ----------------------------------------------------------------------
# outcomes
# ----------------------------------------------------------------------
def retry_outcome(claimed: ClaimedRow, error: str) -> Outcome:
    """PENDING after 2^attempts minutes while attempts remain, else FAILED."""
    error = (error or "Indexing failed")[:2000]
    if claimed.attempts < MAX_ATTEMPTS:
        return "PENDING", float(60 * (2 ** max(0, claimed.attempts))), error
    return "FAILED", None, error


def _same_hash(stored: Optional[str], current: str) -> bool:
    # knowledge_base_source.content_hash is VARCHAR(64); store.py clips to it.
    return bool(stored) and bool(current) and stored == current[:64]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------
# 1. snapshot
# ----------------------------------------------------------------------
@dataclass
class _Snapshot:
    outcome: Optional[Outcome] = None
    setting: Optional[CourseKnowledgeSetting] = None
    kb: Optional[store.CourseKb] = None
    ref: Optional[SlideRef] = None
    src: Optional[store.SourceRow] = None
    run_paid: bool = False
    requested_by: Optional[str] = None
    # claimed_at (as text) of THIS claim: generation and attempts change when the
    # lesson is re-enqueued mid-run, claimed_at only when a claim (or our own
    # heartbeat) writes it, so it tells this claim from a re-armed re-claim.
    claim_token: Optional[str] = None


_RUN_SQL = text(
    "SELECT requested_by, status FROM course_knowledge_run WHERE id = :r AND institute_id = :i"
)

_CLAIM_TOKEN_SQL = text(
    """
    SELECT CAST(claimed_at AS TEXT) FROM content_index_queue
     WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
    """
)


def _snapshot(claimed: ClaimedRow) -> _Snapshot:
    inst, slide_id = claimed.institute_id, claimed.slide_id
    if not flags.available(inst):
        return _Snapshot(outcome=("SKIPPED", None, "Course knowledge is not available for this institute"))
    with db_session() as db:
        setting = settings_store.get_setting(db, inst)
        if not setting.enabled:
            return _Snapshot(outcome=("SKIPPED", None, "Course knowledge is off for this institute"))
        visible = tree.slide_visible_for_institute(db, slide_id, inst)
        refs = describe.describe_slides(db, [slide_id]) if visible else []
        ref = refs[0] if refs else None
        if (ref is None or ref.status not in tree.VISIBLE_SLIDE_STATUSES or not ref.learner_indexable):
            kb = store.get_course_kb(db, inst)
            if kb is not None:
                store.tombstone_slide(db, kb_id=kb.id, slide_id=slide_id)
            return _Snapshot(outcome=("DONE", None, None))
        kb = store.ensure_course_kb(db, inst)
        src = store.get_source(db, kb.id, slide_id)
        run_paid, requested_by = False, None
        if claimed.allow_paid and claimed.run_id:
            run = db.execute(_RUN_SQL, {"r": claimed.run_id, "i": inst}).fetchone()
            if run is not None:
                requested_by = run[0]
                run_paid = (run[1] or "") == "RUNNING"
        token = db.execute(_CLAIM_TOKEN_SQL, {"i": inst, "s": slide_id}).fetchone()
    return _Snapshot(setting=setting, kb=kb, ref=ref, src=src, run_paid=run_paid, requested_by=requested_by,
                     claim_token=(str(token[0]) if token and token[0] is not None else None))


# ----------------------------------------------------------------------
# 5. paid step
# ----------------------------------------------------------------------
def _kind_allowed(kind: str, setting: CourseKnowledgeSetting) -> bool:
    if kind in _OCR_KINDS:
        return bool(setting.allow_ocr)
    if kind == "transcribe_minutes":
        return bool(setting.allow_transcription)
    return False


class _ClaimLost(Exception):
    """This worker no longer owns the queue row (another replica re-armed it)."""


# The queue row records the hold only while THIS claim owns it: status
# PROCESSING with our claimed_at, and no hold yet.
_MARK_HOLD_SQL = text(
    """
    UPDATE content_index_queue
       SET budget_id = :id, reserved_credits = CAST(:c AS NUMERIC), updated_at = now()
     WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
       AND CAST(claimed_at AS TEXT) = :t AND budget_id IS NULL
    RETURNING slide_id
    """
)

# Take the hold off the queue row and return what it held, in one locked
# statement. Nothing when the row was re-armed (queue.rearm_stale released the
# hold already) or re-claimed by another worker (the hold on it is theirs), so
# a hold is only ever given back or settled once.
_TAKE_HOLD_SQL = text(
    """
    UPDATE content_index_queue q
       SET budget_id = NULL, reserved_credits = 0, updated_at = now()
      FROM (SELECT institute_id, slide_id, reserved_credits
              FROM content_index_queue
             WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
               AND CAST(claimed_at AS TEXT) = :t AND budget_id = :id
             FOR UPDATE) old
     WHERE q.institute_id = old.institute_id AND q.slide_id = old.slide_id
    RETURNING old.reserved_credits
    """
)

_HEARTBEAT_SQL = text(
    """
    UPDATE content_index_queue
       SET claimed_at = now()
     WHERE institute_id = :i AND slide_id = :s AND status = 'PROCESSING'
       AND CAST(claimed_at AS TEXT) = :t
    RETURNING CAST(claimed_at AS TEXT)
    """
)


def _mark_hold(db, claimed: ClaimedRow, token: Optional[str], budget_id: str, credits: Decimal) -> bool:
    if not token:
        return False
    row = db.execute(_MARK_HOLD_SQL, {
        "id": budget_id, "c": str(credits), "i": claimed.institute_id, "s": claimed.slide_id, "t": token,
    }).fetchone()
    return row is not None


def _take_hold(db, claimed: ClaimedRow, token: Optional[str], budget_id: str) -> Decimal:
    if not token:
        return Decimal("0")
    row = db.execute(_TAKE_HOLD_SQL, {
        "id": budget_id, "i": claimed.institute_id, "s": claimed.slide_id, "t": token,
    }).fetchone()
    if row is None or row[0] is None:
        return Decimal("0")
    return Decimal(str(row[0]))


def _reserve(claimed: ClaimedRow, snap: _Snapshot, need) -> Optional[Tuple[str, Decimal]]:
    """Quote the need and hold it on the run or month budget: (budget_id,
    credits), or None when it does not fit. Raises _ClaimLost (nothing held)
    when this worker no longer owns the queue row."""
    setting = snap.setting
    with db_session() as db:
        credits = billing.quote_credits(db, claimed.institute_id, need.tool_key, need.units)
        if snap.run_paid:
            budget_id = budget.run_budget_id(claimed.run_id)
        else:
            cap = min(int(setting.monthly_auto_cap_credits or 0), flags.max_monthly_auto_cap())
            budget_id = budget.ensure_month_budget(db, claimed.institute_id, cap)
        if not budget.reserve(db, budget_id, credits):
            return None
        if credits > 0 and not _mark_hold(db, claimed, snap.claim_token, budget_id, credits):
            # Re-armed while the free pass ran: give the hold back in this same
            # transaction rather than leave one no queue row records.
            budget.release(db, budget_id, credits)
            raise _ClaimLost()
    return budget_id, credits


def _settle(claimed: ClaimedRow, snap: _Snapshot, budget_id: str, credits: Decimal,
            charged: Optional[Decimal]) -> Decimal:
    """Settle the delivery on the budget; returns what was added to
    charged_credits. Only the hold this claim still has on its queue row is
    taken off reserved. An unconfirmed charge (None) stays counted at the quote,
    so its headroom is not spent twice; the sweep's re-drive trues it up to the
    ledger amount (meta.paid.budget_counted)."""
    counted = charged if charged is not None else credits
    with db_session() as db:
        held = _take_hold(db, claimed, snap.claim_token, budget_id)
        budget.settle(db, budget_id, held, counted)
    return counted


def _release(claimed: ClaimedRow, snap: _Snapshot, budget_id: str) -> None:
    with db_session() as db:
        held = _take_hold(db, claimed, snap.claim_token, budget_id)
        if held > 0:
            budget.release(db, budget_id, held)


def _heartbeat(claimed: ClaimedRow, token: Optional[str]) -> Optional[str]:
    if not token:
        return None
    with db_session() as db:
        row = db.execute(_HEARTBEAT_SQL, {"i": claimed.institute_id, "s": claimed.slide_id, "t": token}).fetchone()
    return str(row[0]) if row and row[0] is not None else None


async def _keep_claim(claimed: ClaimedRow, snap: _Snapshot, stop: asyncio.Event) -> None:
    """Refresh claimed_at while a paid step waits for its gate and runs, so a
    long transcription is not re-armed (and paid for twice) by another replica.
    A heartbeat in flight always finishes before this returns, so the token the
    settle uses is the one stored on the row."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=HEARTBEAT_S)
            return
        except asyncio.TimeoutError:
            pass
        try:
            token = await asyncio.to_thread(_heartbeat, claimed, snap.claim_token)
        except Exception:  # noqa: BLE001 - the next beat retries
            logger.warning("course knowledge: heartbeat failed for slide %s", claimed.slide_id, exc_info=True)
            continue
        if token is None:
            logger.warning("course knowledge: slide %s of %s was re-armed during its paid step",
                           claimed.slide_id, claimed.institute_id)
            return
        snap.claim_token = token


async def _end_heartbeat(beat: "asyncio.Task[None]", stop: asyncio.Event) -> None:
    stop.set()
    await beat


def _need_meta(need) -> Dict[str, Any]:
    return {
        "kind": need.kind, "tool_key": need.tool_key, "units": int(need.units), "approx": bool(need.approx),
        "pointer_kind": need.pointer_kind, "pointer_key": need.pointer_key,
        "idempotency_key": None, "delivered_at": None, "charged": None,
    }


async def _paid_step(
    claimed: ClaimedRow, snap: _Snapshot, ext: Extraction,
) -> Tuple[Extraction, Optional[Dict[str, Any]], Optional[Decimal]]:
    """Run the paid extraction under a reservation. Returns (extraction,
    meta.paid, charged credits or None)."""
    need = ext.paid_need
    try:
        reserved = await asyncio.to_thread(_reserve, claimed, snap, need)
    except _ClaimLost:
        logger.warning("course knowledge: slide %s of %s was re-armed before its paid step; skipped",
                       claimed.slide_id, claimed.institute_id)
        return ext, _need_meta(need), None
    if reserved is None:
        ext.note = RUN_BUDGET_NOTE if snap.run_paid else MONTH_BUDGET_NOTE
        return ext, _need_meta(need), None
    budget_id, credits = reserved
    settled = False
    stop = asyncio.Event()
    beat = asyncio.create_task(_keep_claim(claimed, snap, stop))
    try:
        setting = snap.setting
        permit = PaidPermit(
            institute_id=claimed.institute_id, allow_ocr=bool(setting.allow_ocr),
            allow_transcription=bool(setting.allow_transcription), max_units=int(need.units),
        )
        pointer = f"{need.pointer_kind or snap.ref.pointer_kind}:{need.pointer_key or snap.ref.pointer_key}"
        async with _gates().hold(need.kind, pointer):
            paid = await registry.extract(snap.ref, paid_permit=permit)
        delivered = paid.paid_delivered
        if delivered is None:
            if paid.status == "FAILED":
                # Keep the free pass (a PDF's text pages); the paid part is still owed.
                if _TRANSIENT_PAID_RE.search(paid.note or "") and claimed.attempts < MAX_ATTEMPTS:
                    logger.info("course knowledge: paid step for slide %s will retry: %s",
                                claimed.slide_id, paid.note)
                    ext.note = PAID_RETRY_NOTE
                    ext.detail["_paid_transient"] = True
                else:
                    ext.note = paid.note or ext.note
                return ext, _need_meta(need), None
            meta = _need_meta(paid.paid_need) if paid.paid_need is not None else None
            return paid, meta, None
        charged = await asyncio.to_thread(
            billing.charge, delivered,
            institute_id=claimed.institute_id,
            requested_by=snap.requested_by if snap.run_paid else None,
            run_id=claimed.run_id if snap.run_paid else None,
            slide_id=claimed.slide_id, pointer=pointer,
        )
        await _end_heartbeat(beat, stop)
        counted = await asyncio.to_thread(_settle, claimed, snap, budget_id, credits, charged)
        settled = True
        meta = {
            "kind": need.kind, "tool_key": delivered.tool_key, "units": int(delivered.units),
            "approx": bool(need.approx), "pointer_kind": need.pointer_kind, "pointer_key": need.pointer_key,
            "idempotency_key": delivered.idempotency_key, "delivered_at": _now_iso(),
            "charged": float(charged) if charged is not None else None,
            "quoted": float(credits), "budget_id": budget_id, "budget_counted": float(counted),
            "model": delivered.model,
            "provider_cost_usd": float(delivered.provider_cost_usd or 0.0),
            "run_id": claimed.run_id if snap.run_paid else None,
            "requested_by": snap.requested_by if snap.run_paid else None,
            "mode": "manual" if snap.run_paid else "auto",
        }
        return paid, meta, charged
    finally:
        await _end_heartbeat(beat, stop)
        if not settled:
            try:
                await asyncio.to_thread(_release, claimed, snap, budget_id)
            except Exception:  # noqa: BLE001 - a re-arm or the run close releases it later
                logger.warning("course knowledge: could not release %s on %s", credits, budget_id, exc_info=True)


# ----------------------------------------------------------------------
# 7. chunking
# ----------------------------------------------------------------------
def build_slide_chunks(
    segments: List[Segment], *, title: str, text_kind: str, slide_id: str,
) -> Tuple[List[store.CourseChunk], bool]:
    """Segments -> chunks with their citation anchors. Each segment is one
    ParsedPage (page_number = its 1-based ordinal), so a chunk's page range
    maps back to the segments it covers. Returns (chunks, truncated)."""
    segs = [s for s in segments if (s.text or "").strip()]
    if not segs:
        return [], False
    pages = [ParsedPage(page_number=i + 1, text=s.text, parser=text_kind) for i, s in enumerate(segs)]
    built = build_chunks(pages, source_title=title)
    spans: List[Tuple[str, int, int, Optional[str]]] = [
        (c.content_text, int(c.page_start or 1), int(c.page_end or c.page_start or 1), c.lang) for c in built
    ]
    if not spans:
        # Below the chunker's noise floor (a title-only lesson): one chunk anyway,
        # so the lesson is still findable as a link.
        body = "\n\n".join(s.text.strip() for s in segs)[:CHUNK_SIZE]
        spans = [(body, 1, len(segs), None)]
    truncated = len(spans) > store.MAX_CHUNKS_PER_SLIDE
    chunks: List[store.CourseChunk] = []
    for index, (body, first, last, lang) in enumerate(spans[:store.MAX_CHUNKS_PER_SLIDE]):
        covered = segs[max(0, first - 1):max(first, last)]
        chunks.append(_anchored(body, index, covered, title=title, text_kind=text_kind,
                                slide_id=slide_id, lang=lang))
    return chunks, truncated


def _anchored(body: str, index: int, covered: List[Segment], *, title: str, text_kind: str,
              slide_id: str, lang: Optional[str]) -> store.CourseChunk:
    page_nums = [s.page for s in covered if s.anchor == "page" and s.page is not None]
    times = [s for s in covered if s.anchor == "time" and s.t_start_ms is not None]
    step = next((s.step for s in covered if s.anchor == "step" and s.step is not None), None)
    question = next((s.question_no for s in covered if s.anchor == "question" and s.question_no is not None), None)
    labelled = [s.label for s in covered if s.label and s.anchor != "none"]
    label = labelled[0] if labelled else next((s.label for s in covered if s.label), None) or title
    meta: Dict[str, Any] = {"slide_id": slide_id, "text_kind": text_kind, "label": label}
    if times:
        meta["t_start_ms"] = min(int(s.t_start_ms) for s in times)
        meta["t_end_ms"] = max(int(s.t_end_ms if s.t_end_ms is not None else s.t_start_ms) for s in times)
    if step is not None:
        meta["step"] = int(step)
    if question is not None:
        meta["question_no"] = int(question)
    return store.CourseChunk(
        content_text=body, chunk_index=index,
        page_start=min(page_nums) if page_nums else None,
        page_end=max(page_nums) if page_nums else None,
        lang=lang, meta_data=meta,
    )


def centroid_of(vectors: List[List[float]]) -> Optional[List[float]]:
    """Normalised mean of the chunk vectors (None if degenerate)."""
    if not vectors:
        return None
    dim = len(vectors[0])
    mean = [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]
    norm = math.sqrt(sum(x * x for x in mean))
    if norm <= 0 or not math.isfinite(norm):
        return None
    return [x / norm for x in mean]


# ----------------------------------------------------------------------
# the pipeline
# ----------------------------------------------------------------------
def _chunk_budget_ok(kb: store.CourseKb, src: Optional[store.SourceRow], new_chunks: int) -> bool:
    with db_session() as db:
        total = store.institute_chunk_total(db, kb.id)
    own = src.chunk_count if src is not None else 0
    return total - own + new_chunks <= flags.max_chunks_per_institute()


def _write(snap: _Snapshot, ext: Extraction, chunks: List[store.CourseChunk],
           centroid: Optional[List[float]], index_state: str, meta: Dict[str, Any],
           charged: Optional[Decimal], ocr_pages: int) -> str:
    ref = snap.ref
    page_count = len({s.page for s in ext.segments if s.anchor == "page" and s.page is not None})
    fields = {
        "file_id": ref.pointer_key if ref.pointer_kind == "file" else None,
        "source_url": ref.extras.get("url") or ref.extras.get("launch_url"),
        "text_kind": ext.text_kind,
        "page_count": page_count,
        "ocr_pages": ocr_pages,
        "credits_charged": charged,
        "content_hash": ref.content_hash,
        "status": "FAILED" if index_state == "FAILED" else "PENDING",
    }
    with db_session() as db:
        return store.write_slide_index(
            db, kb=snap.kb, slide_id=ref.slide_id, title=ref.title, fields=fields, chunks=chunks,
            centroid=centroid, index_state=index_state, meta=meta,
        )


def _set_state(snap: _Snapshot, index_state: str, status: str, meta: Dict[str, Any]) -> None:
    with db_session() as db:
        store.set_source_state(
            db, kb=snap.kb, slide_id=snap.ref.slide_id, title=snap.ref.title,
            index_state=index_state, status=status, meta=meta,
        )


def _mark_pending(claimed: ClaimedRow, snap: _Snapshot, meta: Dict[str, Any]) -> None:
    with db_session() as db:
        store.set_source_state(
            db, kb=snap.kb, slide_id=snap.ref.slide_id, title=snap.ref.title,
            index_state="PENDING", status="PENDING", meta=meta,
        )
        give_back_attempt(db, claimed.institute_id, claimed.slide_id, claimed.generation)


# Unchanged republishes still bump slide.last_sync_date; touching the source
# keeps the drift sweep from re-queuing the lesson every 30 minutes.
_TOUCH_SQL = text("UPDATE knowledge_base_source SET updated_at = now() WHERE id = :id RETURNING id")


def _touch_source(source_id: str) -> None:
    try:
        with db_session() as db:
            db.execute(_TOUCH_SQL, {"id": source_id}).fetchone()
    except Exception:  # noqa: BLE001 - only costs a re-queue by the sweep
        logger.warning("course knowledge: could not touch source %s", source_id, exc_info=True)


def _paid_text_cached(src: store.SourceRow) -> bool:
    """True when the paid text this lesson is waiting for is already in the
    PAID tier of course_extract_cache (another lesson using the same file paid
    for it), so a free pass can read it. cache.get opens its own session."""
    paid = src.meta_json.get("paid") if isinstance(src.meta_json, dict) else None
    if not isinstance(paid, dict) or not paid.get("pointer_key") or not paid.get("pointer_kind"):
        return False
    hit = cache.get(str(paid["pointer_kind"]), str(paid["pointer_key"]))
    return hit is not None and hit.tier == "PAID" and bool(hit.segments)


_SIBLINGS_SQL = text(
    """
    SELECT slide_id FROM knowledge_base_source
     WHERE knowledge_base_id = :kb
       AND slide_id IS NOT NULL AND slide_id <> :s
       AND index_state = 'NEEDS_PROCESSING'
       AND meta_json -> 'paid' ->> 'pointer_kind' = :pk
       AND meta_json -> 'paid' ->> 'pointer_key' = :pkey
     LIMIT :lim
    """
)


def _requeue_siblings(claimed: ClaimedRow, snap: _Snapshot, paid_meta: Dict[str, Any]) -> int:
    """After a paid delivery, queue (free) the institute's other lessons that
    wait for the same file: the quote charged the file once, so only the first
    lesson ran with paid permission, and the rest now read its text from the
    PAID cache for 0."""
    pk, pkey = paid_meta.get("pointer_kind"), paid_meta.get("pointer_key")
    if not pk or not pkey:
        return 0
    try:
        with db_session() as db:
            ids = [r[0] for r in db.execute(
                _SIBLINGS_SQL,
                {"kb": snap.kb.id, "s": claimed.slide_id, "pk": pk, "pkey": pkey, "lim": MAX_SIBLINGS},
            ).fetchall()]
            return enqueue_slides(db, claimed.institute_id, ids, reason=SHARED_FILE_REASON) if ids else 0
    except Exception:  # noqa: BLE001 - a scan or retry still picks them up from the cache
        logger.warning("course knowledge: could not re-queue lessons sharing %s:%s", pk, pkey, exc_info=True)
        return 0


# A delivered charge must stay findable by the sweep's re-drive even when the
# lesson's index is not written this time (embedding failure, storage limit).
_KEEP_PAID_SQL = text(
    """
    UPDATE knowledge_base_source
       SET meta_json = jsonb_set(COALESCE(meta_json, CAST('{}' AS jsonb)), '{paid}', CAST(:paid AS jsonb), true),
           credits_charged = COALESCE(CAST(:c AS NUMERIC), credits_charged),
           updated_at = now()
     WHERE knowledge_base_id = :kb AND slide_id = :s
    RETURNING id
    """
)


def _keep_delivery(claimed: ClaimedRow, snap: _Snapshot, paid_meta: Dict[str, Any],
                   charged: Optional[Decimal], final_status: str) -> None:
    """Record meta.paid of a delivery that _write did not store. An existing
    source keeps its index and state; a new lesson gets a chunk-less row with
    no content hash, so the next attempt re-extracts (from the PAID cache)."""
    try:
        with db_session() as db:
            row = db.execute(_KEEP_PAID_SQL, {
                "kb": snap.kb.id, "s": claimed.slide_id, "paid": json.dumps(paid_meta, default=str),
                "c": str(charged) if charged is not None else None,
            }).fetchone()
            if row is None:
                state = "FAILED" if final_status == "FAILED" else "PENDING"
                store.set_source_state(
                    db, kb=snap.kb, slide_id=snap.ref.slide_id, title=snap.ref.title,
                    index_state=state, status=state, meta={"paid": paid_meta},
                )
    except Exception:  # noqa: BLE001 - the ledger key still makes a later charge single
        logger.error("course knowledge: could not record the paid delivery for slide %s of %s",
                     claimed.slide_id, claimed.institute_id, exc_info=True)


async def _unchanged(snap: _Snapshot, paid_possible: bool) -> bool:
    """True when the stored index already matches the lesson."""
    src, ref = snap.src, snap.ref
    if src is None or not _same_hash(src.content_hash, ref.content_hash):
        return False
    if src.index_state in _SKIP_WHEN_UNCHANGED:
        return True
    if src.index_state == "NEEDS_PROCESSING" and not paid_possible:
        return not await asyncio.to_thread(_paid_text_cached, src)
    return False


async def _index(claimed: ClaimedRow, keep: Dict[str, Any]) -> Outcome:
    """`keep` receives a fresh paid delivery until the index that records it
    is written, so index_slide can store it on any other exit."""
    snap = await asyncio.to_thread(_snapshot, claimed)
    if snap.outcome is not None:
        return snap.outcome
    ref, src, setting = snap.ref, snap.src, snap.setting

    run_ok = snap.run_paid
    paid_possible = flags.paid_enabled() and (run_ok or bool(setting.auto_paid_enabled))
    if await _unchanged(snap, paid_possible):
        await asyncio.to_thread(_touch_source, src.id)
        return "DONE", None, None

    ext = await registry.extract(ref)               # free pass, no session open

    paid_meta: Optional[Dict[str, Any]] = None
    charged: Optional[Decimal] = None
    ocr_pages = 0
    if ext.status == "NEEDS_PAID" and ext.paid_need is not None:
        need = ext.paid_need
        if paid_possible and _kind_allowed(need.kind, setting):
            ext, paid_meta, charged = await _paid_step(claimed, snap, ext)
            if paid_meta and paid_meta.get("delivered_at"):
                keep.update(snap=snap, paid=paid_meta, charged=charged)
                if paid_meta.get("kind") in _OCR_KINDS:
                    ocr_pages = int(paid_meta.get("units") or 0)
        else:
            paid_meta = _need_meta(need)
    if paid_meta is None and src is not None:
        # Paid text re-read from the cache: keep the record of the earlier charge.
        old = src.meta_json.get("paid") if isinstance(src.meta_json, dict) else None
        if isinstance(old, dict) and old.get("delivered_at") and ext.status == "READY":
            paid_meta = old

    paid_transient = bool(ext.detail.pop("_paid_transient", False)) if ext.detail else False
    meta: Dict[str, Any] = {
        "text_kind": ext.text_kind, "anchor_kind": ext.anchor_kind, "note": ext.note, "paid": paid_meta,
    }
    if ext.detail:
        meta.update({k: v for k, v in ext.detail.items() if k not in meta})

    if ext.status == "PENDING":
        await asyncio.to_thread(_mark_pending, claimed, snap, meta)
        keep.clear()
        return "PENDING", float(PENDING_RECHECK_S), None

    failed = ext.status == "FAILED"
    if failed and src is not None and src.chunk_count > 0:
        # Keep the lesson's last good index while a transient failure retries.
        if claimed.attempts < MAX_ATTEMPTS:
            return retry_outcome(claimed, ext.note or "Could not read this lesson")
        await asyncio.to_thread(_set_state, snap, "FAILED", "FAILED", meta)
        keep.clear()
        return "FAILED", None, ext.note or "Could not read this lesson"

    if ext.text_kind in _SPOKEN_KINDS:
        # Cached transcripts predate the loop clean-up in media.time_windows.
        for seg in ext.segments:
            seg.text = collapse_repeats(seg.text)
    chunks, truncated = build_slide_chunks(ext.segments, title=ref.title, text_kind=ext.text_kind,
                                           slide_id=ref.slide_id)
    if truncated:
        meta["note"] = LONG_LESSON_NOTE if not meta["note"] else f"{meta['note']}; {LONG_LESSON_NOTE}"
    if chunks and not await asyncio.to_thread(_chunk_budget_ok, snap.kb, src, len(chunks)):
        logger.error(
            "course knowledge: institute %s is over max_chunks_per_institute (%d); slide %s not indexed",
            claimed.institute_id, flags.max_chunks_per_institute(), claimed.slide_id,
        )
        return "FAILED", None, STORAGE_LIMIT_NOTE

    centroid = None
    if chunks:
        title = (ref.title or "").strip()
        texts = [f"{title}\n{c.content_text}" if title else c.content_text for c in chunks]
        vectors = await embedding.embed_texts(claimed.institute_id, snap.kb.embedding_model, texts)
        if not vectors or len(vectors) != len(chunks) or any(v is None for v in vectors):
            return retry_outcome(claimed, EMBED_RETRY_NOTE)
        for chunk, vector in zip(chunks, vectors):
            chunk.embedding = vector
        centroid = centroid_of(vectors)
        if centroid is None:
            return retry_outcome(claimed, EMBED_RETRY_NOTE)

    index_state = _STATE_FOR.get(ext.status, "FAILED")
    await asyncio.to_thread(_write, snap, ext, chunks, centroid, index_state, meta, charged, ocr_pages)
    if keep:
        keep.clear()
        await asyncio.to_thread(_requeue_siblings, claimed, snap, paid_meta)
    if failed:
        return retry_outcome(claimed, ext.note or "Could not read this lesson")
    if paid_transient:
        # Indexed with what the free pass gave; the queue row comes back for the paid part.
        return retry_outcome(claimed, PAID_RETRY_NOTE)
    return "DONE", None, None


async def index_slide(claimed: ClaimedRow) -> Outcome:
    """Index one claimed lesson; returns (final_status, not_before, error)."""
    keep: Dict[str, Any] = {}
    try:
        outcome = await _index(claimed, keep)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 - the queue row records it and retries
        logger.exception("course knowledge: indexing slide %s for %s failed",
                         claimed.slide_id, claimed.institute_id)
        outcome = retry_outcome(claimed, f"{type(exc).__name__}: {str(exc)[:300]}")
    if keep:
        # Delivered (and maybe charged) but the index was not written: keep the
        # record, so the sweep can re-drive an unbilled charge.
        await asyncio.to_thread(_keep_delivery, claimed, keep["snap"], keep["paid"], keep["charged"], outcome[0])
    return outcome


__all__ = [
    "Outcome", "index_slide", "retry_outcome", "build_slide_chunks", "centroid_of",
    "LONG_LESSON_NOTE", "STORAGE_LIMIT_NOTE", "MONTH_BUDGET_NOTE", "RUN_BUDGET_NOTE", "PAID_RETRY_NOTE",
    "PENDING_RECHECK_S", "OCR_CONCURRENCY", "TRANSCRIBE_CONCURRENCY", "SHARED_FILE_REASON",
]
