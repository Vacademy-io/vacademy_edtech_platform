"""Course knowledge worker (CK-06), offline.

index_slide runs against in-memory fakes of the store, settings, budgets,
billing, extract and embeddings. Every fake that stands for a network call
(extract, embed) records whether a DB session was open at that moment: none
may be. The real SQL of the queue, budgets and sweep is exercised in
test_course_knowledge_worker_pg.py.
"""
from __future__ import annotations

import asyncio
import json
import math
import sys
from contextlib import contextmanager
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.course_knowledge import (  # noqa: E402
    billing, budget, embedding, flags, indexer, queue, settings_store, store, sweep, tree, worker,
)
from app.services.course_knowledge.extract import cache, describe, registry  # noqa: E402
from app.services.course_knowledge.extract.types import (  # noqa: E402
    TOOL_OCR_PAGE, TOOL_TRANSCRIBE_MINUTE, Extraction, PaidDelivered, PaidNeed, Segment, SlideRef,
)
from app.services.course_knowledge.settings_store import CourseKnowledgeSetting  # noqa: E402
from app.models.ai_token_usage import RequestType  # noqa: E402

INST = "inst-ck06"
SLIDE = "slide-1"
DIM = 768
HASH = "sha256:" + "a" * 64


def run(coro):
    return asyncio.run(coro)


def vec(i: int) -> List[float]:
    v = [0.01] * DIM
    v[i % DIM] = 1.0
    return v


def claimed(**kw) -> queue.ClaimedRow:
    base = dict(institute_id=INST, slide_id=SLIDE, generation=3, allow_paid=False, run_id=None,
                reason="SLIDE_UPDATED", attempts=1)
    base.update(kw)
    return queue.ClaimedRow(**base)


def ref_of(**kw) -> SlideRef:
    base = dict(slide_id=SLIDE, title="Heat engines", description="Carnot cycle basics", status="PUBLISHED",
                source_type="DOCUMENT", doc_type="PDF", pointer_kind="file", pointer_key="file-1",
                content_hash=HASH)
    base.update(kw)
    return SlideRef(**base)


def title_seg() -> Segment:
    return Segment(text="Heat engines\nCarnot cycle basics", label="Heat engines")


def page_segs(n: int) -> List[Segment]:
    return [Segment(text=f"Page {p} explains the second law of thermodynamics in detail. " * 4,
                    anchor="page", page=p) for p in range(1, n + 1)]


def ready(segments=None, **kw) -> Extraction:
    return Extraction(SLIDE, kw.pop("text_kind", "pdf"), segments=[title_seg()] + (segments or page_segs(2)),
                      status=kw.pop("status", "READY"), anchor_kind=kw.pop("anchor_kind", "page"),
                      content_hash=HASH, **kw)


OCR_NEED = PaidNeed(kind="ocr_pages", tool_key=TOOL_OCR_PAGE, unit_field="pages", units=3,
                    pointer_kind="file", pointer_key="file-1")
DELIVERED = PaidDelivered(tool_key=TOOL_OCR_PAGE, unit_field="pages", units=3, provider_cost_usd=0.012,
                          model="mathpix", idempotency_key=f"course_kb_ocr:{INST}:file-1")


# ── the fake world ───────────────────────────────────────────────────────────

class World:
    def __init__(self, monkeypatch):
        self.open_sessions = 0
        self.violations: List[str] = []
        self.calls: Dict[str, List[Any]] = {}
        self.available = True
        self.paid_enabled = False
        self.max_chunks = 200000
        self.setting = CourseKnowledgeSetting(enabled=True)
        self.visible = True
        self.ref: Optional[SlideRef] = ref_of()
        self.src: Optional[store.SourceRow] = None
        self.chunk_total = 0
        self.run_row = None
        self.free: Extraction = ready()
        self.paid: Optional[Extraction] = None
        self.embed_fail = False
        self.extract_error: Optional[Exception] = None
        self.budget_cap = Decimal("100")
        self.budget_held = Decimal("0")
        self.claim_token: Optional[str] = "2026-10-21 10:00:00.123456+00"
        self.row_hold = None
        self.charge_result: Optional[Decimal] = Decimal("3")
        self.cache_hit: Optional[cache.CacheHit] = None
        self.siblings: List[tuple] = []
        self.keep_row = None
        self.kb = store.CourseKb(id="kb-1", institute_id=INST, embedding_model="google/gemini-embedding-001",
                                 embedding_dim=DIM)
        mp = monkeypatch
        mp.setattr(indexer, "db_session", self._db_session)
        mp.setattr(flags, "available", lambda i: self.available)
        mp.setattr(flags, "paid_enabled", lambda: self.paid_enabled)
        mp.setattr(flags, "max_monthly_auto_cap", lambda: 5000)
        mp.setattr(flags, "max_chunks_per_institute", lambda: self.max_chunks)
        mp.setattr(settings_store, "get_setting", lambda db, i: self._db(db) or self.setting)
        mp.setattr(tree, "slide_visible_for_institute", lambda db, s, i: self._db(db) or self.visible)
        mp.setattr(describe, "describe_slides", lambda db, ids: self._db(db) or ([self.ref] if self.ref else []))
        mp.setattr(store, "get_course_kb", lambda db, i: self._db(db) or self.kb)
        mp.setattr(store, "ensure_course_kb", lambda db, i: self._db(db) or self.kb)
        mp.setattr(store, "get_source", lambda db, kb, s: self._db(db) or self.src)
        mp.setattr(store, "institute_chunk_total", lambda db, kb: self._db(db) or self.chunk_total)
        mp.setattr(store, "tombstone_slide", self._record("tombstone", True))
        mp.setattr(store, "write_slide_index", self._record("write", "src-1"))
        mp.setattr(store, "set_source_state", self._record("state", "src-1"))
        mp.setattr(indexer, "give_back_attempt", self._record("give_back", True))
        mp.setattr(indexer, "enqueue_slides", self._record("requeue", 1))
        mp.setattr(cache, "get", self._cache_get)
        mp.setattr(registry, "extract", self._extract)
        mp.setattr(embedding, "embed_texts", self._embed)
        mp.setattr(billing, "quote_credits", lambda db, i, tool, units: self._db(db) or Decimal(units))
        mp.setattr(billing, "charge", self._charge)
        mp.setattr(budget, "ensure_month_budget", lambda db, i, cap: self._db(db) or self._note("month_cap", cap)
                   or budget.month_budget_id(i))
        mp.setattr(budget, "reserve", self._reserve)
        mp.setattr(budget, "settle", self._record("settle", True))
        mp.setattr(budget, "release", self._record("release", True))

    # sessions
    @contextmanager
    def _db_session(self):
        self.open_sessions += 1
        try:
            yield SimpleNamespace(execute=self._execute, rollback=lambda: None, commit=lambda: None)
        finally:
            self.open_sessions -= 1

    def _execute(self, sql, params=None):
        if self.open_sessions <= 0:
            self.violations.append("execute without a session")
        self.calls.setdefault("execute", []).append((sql, params))
        if sql is indexer._KEEP_PAID_SQL:
            return SimpleNamespace(fetchone=lambda: self.keep_row)
        if sql is indexer._SIBLINGS_SQL:
            return SimpleNamespace(fetchall=lambda: list(self.siblings))
        # The queue row of this claim: its claimed_at token and the hold it records.
        if sql is indexer._CLAIM_TOKEN_SQL:
            return SimpleNamespace(fetchone=lambda: (self.claim_token,) if self.claim_token else None)
        if sql is indexer._MARK_HOLD_SQL:
            ok = self.claim_token is not None and params["t"] == self.claim_token and self.row_hold is None
            if ok:
                self.row_hold = (params["id"], Decimal(params["c"]))
            return SimpleNamespace(fetchone=lambda: ("ok",) if ok else None)
        if sql is indexer._TAKE_HOLD_SQL:
            held = self.row_hold if self.row_hold and params["t"] == self.claim_token \
                and params["id"] == self.row_hold[0] else None
            if held:
                self.row_hold = None
            return SimpleNamespace(fetchone=lambda: (held[1],) if held else None)
        if sql is indexer._HEARTBEAT_SQL:
            ok = self.claim_token is not None and params["t"] == self.claim_token
            if ok:
                self.claim_token = f"{self.claim_token}+"
            return SimpleNamespace(fetchone=lambda: (self.claim_token,) if ok else None)
        return SimpleNamespace(fetchone=lambda: self.run_row)

    def executed(self, sql) -> List[Any]:
        return [params for s, params in self.calls.get("execute", []) if s is sql]

    def _cache_get(self, pointer_kind, pointer_key):
        if self.open_sessions:
            self.violations.append("cache.get inside a session")   # it opens its own
        self._note("cache_get", (pointer_kind, pointer_key))
        return self.cache_hit

    def _db(self, db):
        assert db is not None
        if self.open_sessions <= 0:
            self.violations.append("DB call without a session")
        return None

    def _note(self, name, value):
        self.calls.setdefault(name, []).append(value)
        return None

    def _record(self, name, result):
        def fn(*args, **kwargs):
            if self.open_sessions <= 0:
                self.violations.append(f"{name} without a session")
            self.calls.setdefault(name, []).append((args, kwargs))
            return result
        return fn

    def _reserve(self, db, budget_id, credits, **kw):
        self._note("reserve", (budget_id, credits, kw))
        if self.budget_held + Decimal(credits) > self.budget_cap:
            return False
        self.budget_held += Decimal(credits)
        return True

    def _charge(self, delivered, **kw):
        if self.open_sessions:
            self.violations.append("charge inside a session")
        self._note("charge", (delivered, kw))
        return self.charge_result

    async def _extract(self, ref, *, paid_permit=None):
        if self.open_sessions:
            self.violations.append("extract with a DB session open")
        self._note("extract", paid_permit)
        if self.extract_error:
            raise self.extract_error
        if paid_permit is not None:
            return self.paid
        return replace(self.free, segments=list(self.free.segments))

    async def _embed(self, institute_id, model_id, texts):
        if self.open_sessions:
            self.violations.append("embed with a DB session open")
        self._note("embed", list(texts))
        if self.embed_fail:
            return None
        return [vec(i) for i, _t in enumerate(texts)]

    # helpers
    def written(self) -> Dict[str, Any]:
        assert self.calls.get("write"), "write_slide_index was not called"
        return self.calls["write"][-1][1]


@pytest.fixture
def world(monkeypatch):
    w = World(monkeypatch)
    yield w
    assert not w.violations, w.violations


def source(**kw) -> store.SourceRow:
    base = dict(id="src-1", slide_id=SLIDE, title="Heat engines", content_hash=HASH[:64], index_state="READY",
                status="READY", chunk_count=2, meta_json={}, credits_charged=Decimal("0"), is_active=True,
                updated_at=None)
    base.update(kw)
    return store.SourceRow(**base)


# ── free path ────────────────────────────────────────────────────────────────

def test_free_path_indexes_with_anchors(world):
    out = run(indexer.index_slide(claimed()))
    assert out == ("DONE", None, None)
    w = world.written()
    assert w["index_state"] == "READY" and w["kb"] is world.kb and w["slide_id"] == SLIDE
    chunks = w["chunks"]
    assert chunks and all(len(c.embedding) == DIM for c in chunks)
    assert all(c.meta_data["slide_id"] == SLIDE and c.meta_data["text_kind"] == "pdf" for c in chunks)
    assert chunks[0].page_start == 1 and chunks[-1].page_end == 2
    assert w["meta"]["text_kind"] == "pdf" and w["meta"]["anchor_kind"] == "page" and w["meta"]["paid"] is None
    assert w["fields"]["content_hash"] == HASH and w["fields"]["file_id"] == "file-1"
    assert w["fields"]["page_count"] == 2 and w["fields"]["credits_charged"] is None
    norm = math.sqrt(sum(x * x for x in w["centroid"]))
    assert abs(norm - 1.0) < 1e-9
    texts = world.calls["embed"][0]
    assert all(t.startswith("Heat engines\n") for t in texts)
    assert len(world.calls["extract"]) == 1 and world.calls["extract"][0] is None


def test_unsupported_lesson_still_gets_its_title_chunk(world):
    world.free = Extraction(SLIDE, "lesson", segments=[title_seg()], status="UNSUPPORTED",
                            note="External video link")
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    w = world.written()
    assert w["index_state"] == "UNSUPPORTED"
    assert len(w["chunks"]) == 1 and "Heat engines" in w["chunks"][0].content_text
    assert w["meta"]["note"] == "External video link"


def test_institute_not_available_or_disabled_is_skipped(world):
    world.available = False
    assert run(indexer.index_slide(claimed()))[0] == "SKIPPED"
    world.available = True
    world.setting = CourseKnowledgeSetting(enabled=False)
    assert run(indexer.index_slide(claimed()))[0] == "SKIPPED"
    assert "extract" not in world.calls and "write" not in world.calls


# ── tombstone / unchanged ────────────────────────────────────────────────────

@pytest.mark.parametrize("case", ["hidden", "draft", "assessment", "missing"])
def test_tombstone(world, case):
    if case == "hidden":
        world.visible = False
    elif case == "draft":
        world.ref = ref_of(status="DRAFT")
    elif case == "assessment":
        world.ref = ref_of(source_type="ASSESSMENT", learner_indexable=False)
    else:
        world.ref = None
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert world.calls["tombstone"][0][1] == {"kb_id": "kb-1", "slide_id": SLIDE}
    assert "extract" not in world.calls and "write" not in world.calls


@pytest.mark.parametrize("state", ["READY", "EMPTY", "UNSUPPORTED"])
def test_unchanged_hash_is_skipped(world, state):
    world.src = source(index_state=state)
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert "extract" not in world.calls and "write" not in world.calls


def test_unchanged_skip_touches_the_source(world):
    # A republish without changes bumps last_sync_date; the touch keeps the
    # drift sweep from re-queuing the lesson every 30 minutes.
    world.src = source(index_state="READY")
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert world.executed(indexer._TOUCH_SQL) == [{"id": "src-1"}]


def test_needs_processing_skipped_only_without_paid_permission(world):
    world.src = source(index_state="NEEDS_PROCESSING")
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert "extract" not in world.calls
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.paid = ready(paid_delivered=DELIVERED)
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert len(world.calls["extract"]) == 2


PAID_WAITING = {"kind": "ocr_pages", "tool_key": TOOL_OCR_PAGE, "units": 3, "pointer_kind": "file",
                "pointer_key": "file-1", "idempotency_key": None, "delivered_at": None, "charged": None}


def test_shared_file_sibling_reads_the_paid_cache_for_free(world):
    # Lesson 2 uses the file lesson 1 paid for; the quote showed it at 0, so it
    # never ran with paid permission. Unchanged and waiting: skipped until the
    # PAID cache holds the file, then re-extracted for free.
    world.src = source(index_state="NEEDS_PROCESSING", meta_json={"paid": dict(PAID_WAITING)})
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert world.calls["cache_get"] == [("file", "file-1")] and "extract" not in world.calls
    world.cache_hit = cache.CacheHit(tier="FREE", segments=page_segs(1))
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert "extract" not in world.calls                  # only a FREE tier: still waiting
    world.cache_hit = cache.CacheHit(tier="PAID", segments=page_segs(3))
    world.free = ready(segments=page_segs(3))            # the free pass reads the PAID cache
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert world.calls["extract"] == [None]              # no paid permit, no reservation, no charge
    assert "reserve" not in world.calls and "charge" not in world.calls
    assert world.written()["index_state"] == "READY"


def test_paid_delivery_requeues_lessons_sharing_the_file(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    world.siblings = [("slide-2",), ("slide-3",)]
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    (params,) = world.executed(indexer._SIBLINGS_SQL)
    assert params["kb"] == "kb-1" and params["s"] == SLIDE
    assert params["pk"] == "file" and params["pkey"] == "file-1"
    args, kw = world.calls["requeue"][0]
    assert args[1:] == (INST, ["slide-2", "slide-3"]) and kw == {"reason": indexer.SHARED_FILE_REASON}
    assert not world.executed(indexer._KEEP_PAID_SQL)    # the index write recorded the delivery


def test_free_index_does_not_requeue_siblings(world):
    world.siblings = [("slide-2",)]
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    assert not world.executed(indexer._SIBLINGS_SQL) and "requeue" not in world.calls


def test_unbilled_delivery_is_recorded_when_embedding_fails(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    world.charge_result = None
    world.embed_fail = True
    world.keep_row = ("src-1",)
    status, _delay, error = run(indexer.index_slide(claimed(attempts=1)))
    assert status == "PENDING" and "Embedding" in error
    assert "write" not in world.calls and "state" not in world.calls
    (params,) = world.executed(indexer._KEEP_PAID_SQL)
    paid = json.loads(params["paid"])
    assert paid["delivered_at"] and paid["idempotency_key"] == DELIVERED.idempotency_key
    assert paid["charged"] is None and params["c"] is None
    assert params["kb"] == "kb-1" and params["s"] == SLIDE


@pytest.mark.parametrize("cause", ["storage", "error"])
def test_delivery_without_a_source_row_gets_one(world, monkeypatch, cause):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(segments=page_segs(12), paid_delivered=DELIVERED)
    world.charge_result = None
    if cause == "storage":
        world.max_chunks = 1000
        world.chunk_total = 999
        assert run(indexer.index_slide(claimed())) == ("FAILED", None, "storage limit")
    else:
        async def broken_embed(*_a, **_k):
            raise RuntimeError("embedder down")
        monkeypatch.setattr(embedding, "embed_texts", broken_embed)
        status, _d, error = run(indexer.index_slide(claimed()))
        assert status == "PENDING" and "embedder down" in error
    assert world.executed(indexer._KEEP_PAID_SQL)
    (_args, kw), = world.calls["state"]
    expected = "FAILED" if cause == "storage" else "PENDING"
    assert kw["index_state"] == expected and kw["status"] == expected
    assert kw["meta"]["paid"]["delivered_at"] and kw["meta"]["paid"]["charged"] is None
    assert "content_hash" not in kw                       # no hash: the next attempt re-extracts


def test_changed_hash_reindexes(world):
    world.src = source(content_hash="sha256:" + "b" * 57)
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    assert world.calls["write"]


# ── paid ─────────────────────────────────────────────────────────────────────

def test_paid_auto_reservation_succeeds(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=8000)
    world.free = ready(segments=page_segs(1), status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(segments=page_segs(3), paid_delivered=DELIVERED)
    assert run(indexer.index_slide(claimed())) == ("DONE", None, None)
    permit = world.calls["extract"][1]
    assert permit.institute_id == INST and permit.max_units == 3
    assert world.calls["month_cap"] == [5000]       # min(institute cap, platform max)
    budget_id, credits, kw = world.calls["reserve"][0]
    assert budget_id == budget.month_budget_id(INST) and credits == Decimal(3)
    assert kw == {}                                 # the queue row is marked under this claim's token
    assert world.executed(indexer._MARK_HOLD_SQL)[0]["t"] == world.claim_token
    delivered, ckw = world.calls["charge"][0]
    assert delivered is DELIVERED
    assert ckw["institute_id"] == INST and ckw["run_id"] is None and ckw["requested_by"] is None
    settle_args = world.calls["settle"][0][0]
    assert settle_args[1:] == (budget.month_budget_id(INST), Decimal(3), Decimal(3))
    assert "release" not in world.calls
    w = world.written()
    assert w["index_state"] == "READY" and w["fields"]["credits_charged"] == Decimal(3)
    assert w["fields"]["ocr_pages"] == 3
    paid = w["meta"]["paid"]
    assert paid["idempotency_key"] == DELIVERED.idempotency_key and paid["charged"] == 3.0
    assert paid["delivered_at"] and paid["mode"] == "auto" and paid["units"] == 3


def test_paid_run_reservation_succeeds_with_run_budget(world):
    world.paid_enabled = True
    world.run_row = ("admin-1", "RUNNING")
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    assert run(indexer.index_slide(claimed(allow_paid=True, run_id="run-9"))) == ("DONE", None, None)
    assert world.calls["reserve"][0][0] == "run:run-9"
    assert "month_cap" not in world.calls          # runs never touch the monthly budget
    _d, ckw = world.calls["charge"][0]
    assert ckw["run_id"] == "run-9" and ckw["requested_by"] == "admin-1"
    assert world.written()["meta"]["paid"]["mode"] == "manual"


@pytest.mark.parametrize("mode", ["auto", "run"])
def test_paid_reservation_fails(world, mode):
    world.paid_enabled = True
    world.budget_cap = Decimal("2")
    world.free = ready(segments=page_segs(1), status="NEEDS_PAID", paid_need=OCR_NEED)
    if mode == "run":
        world.run_row = ("admin-1", "RUNNING")
        row = claimed(allow_paid=True, run_id="run-9")
    else:
        world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=2)
        row = claimed()
    assert run(indexer.index_slide(row)) == ("DONE", None, None)
    assert len(world.calls["extract"]) == 1          # no paid extraction
    assert "charge" not in world.calls and "settle" not in world.calls
    w = world.written()
    assert w["index_state"] == "NEEDS_PROCESSING"
    assert w["meta"]["note"] == ("Over the approved amount" if mode == "run" else "Monthly AI budget reached")
    assert w["meta"]["paid"]["units"] == 3 and w["meta"]["paid"]["delivered_at"] is None


def test_paid_not_attempted_without_permission(world):
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.run_row = ("admin-1", "CANCELLED")
    world.paid_enabled = True
    # A cancelled run's rows lose their paid permission; auto is off.
    assert run(indexer.index_slide(claimed(allow_paid=True, run_id="run-9")))[0] == "DONE"
    assert "reserve" not in world.calls and len(world.calls["extract"]) == 1
    # The institute allows auto paid work but not OCR.
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50,
                                           allow_ocr=False)
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    assert "reserve" not in world.calls
    assert world.written()["index_state"] == "NEEDS_PROCESSING"


def test_paid_without_delivery_releases_and_failed_paid_keeps_free_text(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(segments=page_segs(1), status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = Extraction(SLIDE, "pdf", segments=[title_seg()], status="FAILED", paid_need=OCR_NEED,
                            note="OCR could not read the pages")
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    assert world.calls["release"] and "settle" not in world.calls and "charge" not in world.calls
    w = world.written()
    assert w["index_state"] == "NEEDS_PROCESSING" and w["meta"]["note"] == "OCR could not read the pages"
    assert any("Page 1" in c.content_text for c in w["chunks"])


@pytest.mark.parametrize("note", [
    "Could not read this lesson: Transcription server at capacity (429)",
    "Could not read this lesson: chunk 1/1 failed: OpenRouter transcription HTTP 402: needs balance",
    "Could not read this lesson: Read timed out",
])
def test_transient_paid_failure_keeps_free_text_and_retries_without_charge(world, note):
    # Pilot 2026-10-21: a busy transcription server left lessons NEEDS_PROCESSING with no retry.
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(segments=page_segs(1), status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = Extraction(SLIDE, "pdf", segments=[title_seg()], status="FAILED", paid_need=OCR_NEED, note=note)
    status, delay, error = run(indexer.index_slide(claimed()))
    assert status == "PENDING" and delay == 120.0 and error == indexer.PAID_RETRY_NOTE
    assert world.calls["release"] and "settle" not in world.calls and "charge" not in world.calls
    w = world.written()
    assert w["index_state"] == "NEEDS_PROCESSING" and w["meta"]["note"] == indexer.PAID_RETRY_NOTE
    assert "_paid_transient" not in w["meta"]
    assert any("Page 1" in c.content_text for c in w["chunks"])


def test_transient_paid_failure_gives_up_after_the_last_attempt(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(segments=page_segs(1), status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = Extraction(SLIDE, "pdf", segments=[title_seg()], status="FAILED", paid_need=OCR_NEED,
                            note="Could not read this lesson: Transcription server at capacity (429)")
    row = claimed()
    row = type(row)(**{**row.__dict__, "attempts": indexer.MAX_ATTEMPTS})
    assert run(indexer.index_slide(row))[0] == "DONE"
    assert world.written()["meta"]["note"].endswith("(429)")


def test_paid_extract_error_releases_the_reservation(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = None                                  # paid extract "returns" garbage -> AttributeError
    status, delay, error = run(indexer.index_slide(claimed()))
    assert status == "PENDING" and delay == 120.0 and "AttributeError" in error
    assert world.calls["release"] and "settle" not in world.calls


def test_charge_not_in_ledger_leaves_charged_null_for_the_sweep(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    world.charge_result = None
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    w = world.written()
    assert w["meta"]["paid"]["charged"] is None and w["meta"]["paid"]["delivered_at"]
    assert w["fields"]["credits_charged"] is None
    # The hold stays counted at the quote, so its headroom cannot be spent
    # again before the sweep re-drives the charge and trues it up.
    assert world.calls["settle"][0][0][2:] == (Decimal(3), Decimal(3))
    assert w["meta"]["paid"]["budget_counted"] == 3.0


def test_paid_step_skipped_when_the_row_was_re_armed_before_it(world):
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    world.claim_token = None                          # no longer PROCESSING under this claim
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    assert len(world.calls["extract"]) == 1 and "charge" not in world.calls
    (args, _kw), = world.calls["release"]             # the budget hold is given back at once
    assert args[1:] == (budget.month_budget_id(INST), Decimal(3))
    assert world.written()["index_state"] == "NEEDS_PROCESSING"


def test_settle_after_a_re_arm_takes_nothing_off_reserved(world, monkeypatch):
    """Re-armed mid-run: rearm_stale already released the hold, so the late
    settle only adds the charge and never subtracts the hold a second time."""
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)

    def charge_after_rearm(delivered, **kw):
        world.row_hold = None                         # another replica re-armed the row
        world.claim_token = "re-claimed"
        return Decimal("3")

    monkeypatch.setattr(billing, "charge", charge_after_rearm)
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    settle_args = world.calls["settle"][0][0]
    assert settle_args[1:] == (budget.month_budget_id(INST), Decimal(0), Decimal(3))
    assert "release" not in world.calls


def test_heartbeat_refreshes_the_claim_during_a_paid_step(world, monkeypatch):
    monkeypatch.setattr(indexer, "HEARTBEAT_S", 0.01)
    world.paid_enabled = True
    world.setting = CourseKnowledgeSetting(enabled=True, auto_paid_enabled=True, monthly_auto_cap_credits=50)
    world.free = ready(status="NEEDS_PAID", paid_need=OCR_NEED)
    world.paid = ready(paid_delivered=DELIVERED)
    first = world.claim_token
    slow = world._extract

    async def slow_extract(ref, *, paid_permit=None):
        if paid_permit is not None:
            await asyncio.sleep(0.08)
        return await slow(ref, paid_permit=paid_permit)

    monkeypatch.setattr(registry, "extract", slow_extract)
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    beats = world.executed(indexer._HEARTBEAT_SQL)
    assert beats and beats[0]["t"] == first and world.claim_token != first
    # The settle used the refreshed token, so the hold was found and settled.
    assert world.executed(indexer._TAKE_HOLD_SQL)[-1]["t"] == world.claim_token
    assert world.calls["settle"][0][0][2:] == (Decimal(3), Decimal(3)) and world.row_hold is None


# ── pending / retries / limits ───────────────────────────────────────────────

def test_pending_transcription_requeues_in_ten_minutes_and_gives_back_the_attempt(world):
    world.free = Extraction(SLIDE, "transcript", segments=[title_seg()], status="PENDING",
                            note="Transcription is running")
    assert run(indexer.index_slide(claimed())) == ("PENDING", 600.0, None)
    state = world.calls["state"][0][1]
    assert state["index_state"] == "PENDING" and state["status"] == "PENDING"
    assert world.calls["give_back"][0][0][1:] == (INST, SLIDE, 3)
    assert "write" not in world.calls and "embed" not in world.calls


def test_exception_retries_with_backoff_then_fails(world):
    world.extract_error = RuntimeError("boom")
    assert run(indexer.index_slide(claimed(attempts=3))) == ("PENDING", 480.0, "RuntimeError: boom")
    status, delay, error = run(indexer.index_slide(claimed(attempts=5)))
    assert status == "FAILED" and delay is None and "boom" in error


def test_embedding_failure_keeps_old_index_and_retries(world):
    world.embed_fail = True
    status, delay, error = run(indexer.index_slide(claimed(attempts=2)))
    assert status == "PENDING" and delay == 240.0 and "Embedding" in error
    assert "write" not in world.calls


def test_failed_extraction_keeps_a_good_index_then_records_failure(world):
    world.src = source(content_hash="sha256:old", chunk_count=4)
    world.free = Extraction(SLIDE, "pdf", segments=[title_seg()], status="FAILED", note="Download failed")
    assert run(indexer.index_slide(claimed(attempts=1)))[0] == "PENDING"
    assert "write" not in world.calls and "state" not in world.calls
    assert run(indexer.index_slide(claimed(attempts=5))) == ("FAILED", None, "Download failed")
    assert world.calls["state"][0][1]["index_state"] == "FAILED"
    assert "write" not in world.calls


def test_failed_extraction_without_index_writes_title_chunk(world):
    world.free = Extraction(SLIDE, "pdf", segments=[title_seg()], status="FAILED", note="Download failed")
    assert run(indexer.index_slide(claimed(attempts=1)))[0] == "PENDING"
    w = world.written()
    assert w["index_state"] == "FAILED" and len(w["chunks"]) == 1


def test_storage_limit_fails_before_embedding(world):
    world.max_chunks = 1000
    world.chunk_total = 999
    world.free = ready(segments=page_segs(12))
    assert run(indexer.index_slide(claimed())) == ("FAILED", None, "storage limit")
    assert "embed" not in world.calls and "write" not in world.calls


# ── chunking ─────────────────────────────────────────────────────────────────

def test_chunk_anchors_map_back_to_segments():
    long = "The Carnot engine is the most efficient heat engine possible between two reservoirs. "
    segs = [title_seg()] + [
        Segment(text=long * 12, anchor="time", t_start_ms=i * 60000, t_end_ms=(i + 1) * 60000) for i in range(3)
    ] + [Segment(text=long * 2, anchor="question", question_no=4, label="Q4")]
    chunks, truncated = indexer.build_slide_chunks(segs, title="Heat engines", text_kind="transcript",
                                                   slide_id=SLIDE)
    assert not truncated and len(chunks) >= 2
    assert chunks[0].meta_data["t_start_ms"] == 0 and chunks[0].page_start is None
    assert chunks[-1].meta_data["question_no"] == 4 and chunks[-1].meta_data["label"] == "Q4"
    assert all(c.meta_data["slide_id"] == SLIDE and c.meta_data["text_kind"] == "transcript" for c in chunks)
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    steps = [title_seg(), Segment(text=long * 3, anchor="step", step=2, label="Slide 2")]
    chunks, _ = indexer.build_slide_chunks(steps, title="Deck", text_kind="deck", slide_id=SLIDE)
    assert chunks[0].meta_data["step"] == 2 and chunks[0].meta_data["label"] == "Slide 2"


def test_title_only_lesson_gets_one_chunk_and_long_lessons_are_capped():
    chunks, truncated = indexer.build_slide_chunks([title_seg()], title="Heat engines", text_kind="lesson",
                                                   slide_id=SLIDE)
    assert len(chunks) == 1 and not truncated and chunks[0].meta_data["label"] == "Heat engines"
    para = "Entropy never decreases in an isolated system, which is the second law. " * 30
    many = [Segment(text=para, anchor="page", page=p) for p in range(1, 460)]
    chunks, truncated = indexer.build_slide_chunks(many, title="Book", text_kind="pdf", slide_id=SLIDE)
    assert truncated and len(chunks) == store.MAX_CHUNKS_PER_SLIDE


def test_long_lesson_note(world):
    para = "Entropy never decreases in an isolated system, which is the second law. " * 30
    world.free = ready(segments=[Segment(text=para, anchor="page", page=p) for p in range(1, 460)])
    assert run(indexer.index_slide(claimed()))[0] == "DONE"
    w = world.written()
    assert w["meta"]["note"] == indexer.LONG_LESSON_NOTE and len(w["chunks"]) == store.MAX_CHUNKS_PER_SLIDE


def test_centroid_is_normalised_mean():
    c = indexer.centroid_of([[3.0, 0.0], [0.0, 4.0]])
    assert abs(math.hypot(*c) - 1.0) < 1e-12 and c[1] > c[0]
    assert indexer.centroid_of([[0.0, 0.0]]) is None


def test_gates_are_per_pointer_and_per_loop():
    async def scenario():
        gates = indexer._gates()
        assert indexer._gates() is gates
        order = []

        async def job(name, pointer):
            async with gates.hold("ocr_pages", pointer):
                order.append(f"{name}+")
                await asyncio.sleep(0.01)
                order.append(f"{name}-")

        await asyncio.gather(job("a", "file:1"), job("b", "file:1"))
        assert order in (["a+", "a-", "b+", "b-"], ["b+", "b-", "a+", "a-"])
        assert not gates.pointers                      # locks are dropped once unused
        return gates

    first = run(scenario())
    assert run(scenario()) is not first                # a new loop gets new primitives


# ── generation changed mid-run (worker + an in-memory queue) ─────────────────

class MemQueue:
    """content_index_queue semantics of claim / finalize, in memory."""

    def __init__(self):
        self.rows: Dict[tuple, Dict[str, Any]] = {}

    def add(self, slide_id, **kw):
        self.rows[(INST, slide_id)] = dict(status="PENDING", generation=1, attempts=0, allow_paid=False,
                                           run_id=None, reason="SLIDE_ADDED", not_before=0.0, error=None, **kw)

    def claim(self, n):
        out = []
        for (inst, sid), r in self.rows.items():
            if r["status"] == "PENDING" and len(out) < n:
                r["status"], r["attempts"] = "PROCESSING", r["attempts"] + 1
                out.append(queue.ClaimedRow(inst, sid, r["generation"], r["allow_paid"], r["run_id"],
                                            r["reason"], r["attempts"]))
        return out

    def bump(self, slide_id):
        r = self.rows[(INST, slide_id)]
        r["generation"] += 1
        r["attempts"] = 0

    def finalize(self, inst, sid, gen, final, not_before=None, error=None):
        r = self.rows.get((inst, sid))
        if r is None or r["status"] != "PROCESSING":
            return None
        if r["generation"] == gen:
            r["status"], r["not_before"] = final, not_before
        else:
            r["status"], r["not_before"] = "PENDING", 30.0
        r["error"] = error
        return r["status"]


def test_generation_changed_mid_run_ends_pending(monkeypatch):
    mq = MemQueue()
    mq.add("s-edited")
    mq.add("s-calm")

    async def fake_index(row):
        if row.slide_id == "s-edited":
            mq.bump("s-edited")                        # the marker fires while we index
        return "DONE", None, None

    monkeypatch.setattr(flags, "worker_batch", lambda: 4)
    monkeypatch.setattr(queue, "claim", mq.claim)
    monkeypatch.setattr(queue, "finalize", mq.finalize)
    monkeypatch.setattr(indexer, "index_slide", fake_index)
    assert run(worker.drain_once()) == (2, 4)
    assert mq.rows[(INST, "s-edited")]["status"] == "PENDING"
    assert mq.rows[(INST, "s-edited")]["not_before"] == 30.0
    assert mq.rows[(INST, "s-calm")]["status"] == "DONE"


def test_worker_turns_a_raised_index_into_a_retry(monkeypatch):
    mq = MemQueue()
    mq.add("s1")

    async def boom(row):
        raise ValueError("bad")

    monkeypatch.setattr(flags, "worker_batch", lambda: 4)
    monkeypatch.setattr(queue, "claim", mq.claim)
    monkeypatch.setattr(queue, "finalize", mq.finalize)
    monkeypatch.setattr(indexer, "index_slide", boom)
    assert run(worker.drain_once()) == (1, 4)
    row = mq.rows[(INST, "s1")]
    assert row["status"] == "PENDING" and row["not_before"] == 120.0 and "ValueError" in row["error"]



# ── worker loop with the feature off ─────────────────────────────────────────

def test_disabled_worker_makes_no_db_queries(monkeypatch):
    from app import db as app_db

    def no_db(*a, **k):
        raise AssertionError("the worker touched the database with the feature off")

    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= 3:
            raise asyncio.CancelledError()

    monkeypatch.setattr(flags, "platform_enabled", lambda: False)
    monkeypatch.setattr(app_db, "get_sessionmaker", no_db)
    monkeypatch.setattr(app_db, "get_engine", no_db)
    monkeypatch.setattr(queue, "claim", no_db)
    monkeypatch.setattr(sweep, "run_once", no_db)
    monkeypatch.setattr(worker.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        run(worker._loop())
    assert sleeps == [worker.DISABLED_SLEEP_S] * 3


def test_enabled_worker_sweeps_then_drains(monkeypatch):
    events = []

    async def fake_sleep(seconds):
        events.append(("sleep", seconds))
        if sum(1 for e in events if e[0] == "sleep") >= 2:
            raise asyncio.CancelledError()

    monkeypatch.setattr(flags, "platform_enabled", lambda: True)
    monkeypatch.setattr(flags, "worker_batch", lambda: 4)
    async def fake_canary():
        events.append(("canary",))
        return True

    monkeypatch.setattr(worker.caption_requeue, "captions_ok_for_sweep", fake_canary)
    monkeypatch.setattr(sweep, "run_once", lambda captions_ok=False: events.append(("sweep", captions_ok)))
    monkeypatch.setattr(queue, "claim", lambda n: events.append(("claim", n)) or [])
    monkeypatch.setattr(worker.asyncio, "sleep", fake_sleep)
    with pytest.raises(asyncio.CancelledError):
        run(worker._loop())
    # one caption canary then one sweep (the next is 30 min away), two claims, idle
    # sleeps after short batches
    assert events == [("canary",), ("sweep", True), ("claim", 4), ("sleep", worker.IDLE_SLEEP_S),
                      ("claim", 4), ("sleep", worker.IDLE_SLEEP_S)]


def test_caption_canary_failure_still_sweeps_without_requeue(monkeypatch):
    events = []

    async def broken_canary():
        raise RuntimeError("proxy down")

    monkeypatch.setattr(worker.caption_requeue, "captions_ok_for_sweep", broken_canary)
    monkeypatch.setattr(sweep, "run_once", lambda captions_ok=False: events.append(("sweep", captions_ok)))
    assert run(worker._maybe_sweep(0.0)) > 0 and events == [("sweep", False)]


def test_start_is_idempotent(monkeypatch):
    async def scenario():
        monkeypatch.setattr(flags, "platform_enabled", lambda: False)
        worker.start_course_knowledge_worker()
        first = worker._TASK
        worker.start_course_knowledge_worker()
        assert worker._TASK is first
        await worker.stop_course_knowledge_worker()
        assert worker._TASK is None

    run(scenario())


# ── billing ──────────────────────────────────────────────────────────────────

class FakeLedger:
    def __init__(self):
        self.rows: Dict[str, Decimal] = {}
        self.billed: List[Dict[str, Any]] = []

    def read(self, key):
        return (key in self.rows, self.rows.get(key, Decimal("0")))

    def bill(self, **kw):
        self.billed.append(kw)
        self.rows[kw["idempotency_key"]] = Decimal("3")


@pytest.fixture
def ledger(monkeypatch):
    led = FakeLedger()
    monkeypatch.setattr(billing, "_read_back", led.read)
    monkeypatch.setattr(billing, "record_tool_billing", led.bill)
    return led


def test_charge_bills_once_and_reads_back_the_ledger(ledger):
    got = billing.charge(DELIVERED, institute_id=INST, requested_by=None, run_id=None, slide_id=SLIDE,
                         pointer="file:file-1")
    assert got == Decimal("3")
    kw = ledger.billed[0]
    assert kw["tool_key"] == TOOL_OCR_PAGE and kw["tool_params"] == {"num_pages": 3}
    assert kw["request_type"] == RequestType.KNOWLEDGE_BASE and kw["model"] == "mathpix"
    assert kw["idempotency_key"] == f"course_kb_ocr:{INST}:file-1" and kw["use_case"] == "course_knowledge"
    assert kw["user_id"] is None and kw["user_role"] is None
    assert kw["usage_context"] == {"feature": "course_knowledge", "slide_id": SLIDE, "pointer": "file:file-1",
                                   "run_id": None, "mode": "auto"}
    # A replay (worker retry, sweep re-drive) never calls billing again.
    assert billing.charge(DELIVERED, institute_id=INST, requested_by=None, run_id=None, slide_id=SLIDE) == 3
    assert len(ledger.billed) == 1


def test_charge_for_a_run_is_attributed_to_the_admin(ledger, monkeypatch):
    seen = {}
    monkeypatch.setattr(billing, "metering_user", lambda uid, surface: seen.setdefault("user", (uid, surface)))
    minutes = PaidDelivered(tool_key=TOOL_TRANSCRIBE_MINUTE, unit_field="audio_minutes", units=7,
                            provider_cost_usd=0.04, model="openrouter:whisper",
                            idempotency_key=f"course_kb_transcribe:{INST}:file-2")
    billing.charge(minutes, institute_id=INST, requested_by="admin-1", run_id="run-9", slide_id=SLIDE)
    kw = ledger.billed[0]
    assert kw["request_type"] == RequestType.TRANSCRIPTION and kw["tool_params"] == {"audio_minutes": 7}
    assert kw["user_id"] == "admin-1" and kw["user_role"] == "ADMIN"
    assert seen["user"] == ("admin-1", "ADMIN_APP") and kw["usage_context"]["mode"] == "manual"


def test_charge_refuses_a_key_without_the_institute(ledger):
    bad = replace(DELIVERED, idempotency_key="course_kb_ocr:file-1")
    assert billing.charge(bad, institute_id=INST, requested_by=None, run_id=None, slide_id=SLIDE) is None
    assert not ledger.billed


def test_charge_that_never_lands_returns_none(monkeypatch):
    monkeypatch.setattr(billing, "_read_back", lambda key: (False, Decimal("0")))
    monkeypatch.setattr(billing, "record_tool_billing", lambda **kw: None)
    monkeypatch.setattr(billing, "_free_at_this_price", lambda inst, d: False)
    assert billing.charge(DELIVERED, institute_id=INST, requested_by=None, run_id=None, slide_id=SLIDE) is None
    monkeypatch.setattr(billing, "_free_at_this_price", lambda inst, d: True)
    assert billing.charge(DELIVERED, institute_id=INST, requested_by=None, run_id=None, slide_id=SLIDE) == 0


def test_quote_uses_one_estimator_call_per_lesson(monkeypatch):
    calls = []

    class FakeEstimator:
        def __init__(self, db):
            pass

        def estimate(self, tool_key, params, institute_id=None):
            calls.append((tool_key, params, institute_id))
            return {"estimated_credits": 2.0}

    monkeypatch.setattr(billing, "ToolCostEstimator", FakeEstimator)
    assert billing.quote_credits(object(), INST, TOOL_OCR_PAGE, 3) == Decimal("2.0")
    assert billing.quote_credits(object(), INST, TOOL_TRANSCRIBE_MINUTE, 11) == Decimal("2.0")
    assert billing.quote_credits(object(), INST, TOOL_OCR_PAGE, 0) == 0
    assert calls == [(TOOL_OCR_PAGE, {"num_pages": 3}, INST), (TOOL_TRANSCRIBE_MINUTE, {"audio_minutes": 11}, INST)]
    with pytest.raises(ValueError):
        billing.tool_params("kb_ingest_page", 1)


# ── budgets and queue helpers (pure parts) ───────────────────────────────────

def test_budget_ids():
    from datetime import datetime, timezone, timedelta
    when = datetime(2026, 11, 1, 2, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    assert budget.month_budget_id(INST, when) == f"month:{INST}:2026-10"     # UTC month
    assert budget.run_budget_id("abc") == "run:abc"


def test_queue_input_guards():
    assert queue.clip_reason(None) == "LESSON_CHANGED"
    assert len(queue.clip_reason("X" * 80)) == queue.REASON_MAX
    assert queue.enqueue_slides(object(), INST, [], reason="DRIFT") == 0
    with pytest.raises(ValueError):
        queue.finalize(INST, SLIDE, 1, "PROCESSING")
