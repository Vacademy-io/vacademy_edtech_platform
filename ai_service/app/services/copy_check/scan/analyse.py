"""Analyse one Scan Station load: two passes of one pile (or one pass of one-sided
copies) -> per-sheet facts + flags.

Contract C1 (POST /copy-check/scan/analyse-load). In order:
  fetch -> page features in the worker pool -> header probe (fronts pass and
  rotation) -> count check -> header read of every front -> label-template
  guard -> show-through pairing -> blank classes -> sheets + flags.

It does NOT group sheets into copies, and it does not decide whether the fronts
pass was scanned forwards or backwards: assessment_service's planner does both
for the whole session. Stateless: nothing is stored, the temp dir is removed,
and logs carry counts only (never a name, never a signed URL).
"""
from __future__ import annotations

import asyncio
import logging
import multiprocessing
import shutil
import tempfile
import threading
import time
from concurrent.futures import Executor, Future, ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

from . import config, fetch, headers_guard, ink, pages, showthrough
from .header_read import PRINTED_FIELD, HeaderRead, HeaderReader, ScanRetryable, probe

logger = logging.getLogger(__name__)

ANALYSER_VERSION = "scan-1"
BLOCK, REVIEW, INFO = "BLOCK", "REVIEW", "INFO"
OK, STATUS_REVIEW, BLOCKED = "OK", "REVIEW", "BLOCKED"
DPI_LOW_BELOW = 150.0
BLANK_FRONTS_SUSPECT = 0.25

SEVERITY = {
    "COUNT_MISMATCH": BLOCK, "FILE_UNREADABLE": BLOCK, "NO_NAME_BOX_FOUND": BLOCK,
    "LOAD_TOO_LARGE": BLOCK, "PAIR_SHIFT_DETECTED": BLOCK, "BACK_HAS_LABEL": BLOCK,
    "LABEL_NO_VALUE": REVIEW, "LABEL_UNUSUAL": REVIEW, "PAIR_NOT_ROW_MAX": REVIEW,
    "ORDER_UNCERTAIN": REVIEW, "FRONT_BLANK": REVIEW, "DPI_LOW": REVIEW,
    "BLANK_RULE_SUSPECT": INFO, "DPI_ASSUMED": INFO, "UNSURE_KEPT": INFO,
}


# ── per-pod admission and the worker pool ─────────────────────────────────────

class ScanBusy(Exception):
    """Every analyse slot on this pod is taken; the caller retries later (429)."""


class _Slots:
    """Thread-safe and loop-agnostic; the limit is read from the env each time."""

    def __init__(self) -> None:
        self.in_use = 0
        self._lock = threading.Lock()

    def try_acquire(self) -> bool:
        with self._lock:
            if self.in_use >= config.settings().max_calls:
                return False
            self.in_use += 1
            return True

    def release(self) -> None:
        with self._lock:
            self.in_use = max(0, self.in_use - 1)

    async def acquire(self, wait_seconds: float = config.ADMIT_WAIT_SECONDS) -> None:
        deadline = time.monotonic() + max(0.0, wait_seconds)
        while not self.try_acquire():
            if time.monotonic() >= deadline:
                raise ScanBusy()
            await asyncio.sleep(0.05)


slots = _Slots()
_pool: Optional[ProcessPoolExecutor] = None
_pool_lock = threading.Lock()


def _get_pool() -> ProcessPoolExecutor:
    """Dedicated spawned workers (never the default executor, which job_guard's
    claim/heartbeat calls share), like omr.service._get_pool."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(
                max_workers=config.settings().workers,
                mp_context=multiprocessing.get_context("spawn"),
                initializer=pages.init_worker,
            )
        return _pool


def _reset_pool(expected: Optional[ProcessPoolExecutor] = None, terminate: bool = False) -> None:
    """Drop the pool (only if it is still `expected`, when given, so a late
    caller never drops a fresh pool). terminate=True also kills the workers:
    a running job cannot be cancelled any other way."""
    global _pool
    with _pool_lock:
        if expected is not None and _pool is not expected:
            return
        old, _pool = _pool, None
    if old is None:
        return
    procs = list((getattr(old, "_processes", None) or {}).values())
    old.shutdown(wait=False, cancel_futures=True)
    if terminate:
        for proc in procs:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001 - already gone
                pass


# A budget timeout cancels the awaits, but a job a worker already runs goes on.
# The call's slot is held until its jobs end, so the next call is told 429
# instead of queuing behind orphaned work and timing out in turn. Jobs still
# running after this long are stuck: the workers are killed.
ORPHAN_WAIT_SECONDS = 180.0
_holders: set["asyncio.Task[None]"] = set()


class Jobs:
    """The pool jobs one analyse call submitted."""

    def __init__(self) -> None:
        self.futures: list[Future] = []
        self.pool: Optional[Executor] = None

    def submit(self, pool: Executor, fn: Callable[..., Any], *args: Any) -> "asyncio.Future[Any]":
        cf = pool.submit(fn, *args)
        self.pool = pool
        self.futures.append(cf)
        return asyncio.wrap_future(cf)

    def outstanding(self) -> list[Future]:
        """Cancels jobs not started yet; returns the ones still running."""
        for f in self.futures:
            f.cancel()
        return [f for f in self.futures if not f.done()]


async def release_after_jobs(jobs: Jobs, wait_seconds: Optional[float] = None) -> None:
    """Give the call's slot back once none of its jobs is running."""
    try:
        running = jobs.outstanding()
        if not running:
            return
        logger.info("scan analyse: holding the slot for %d running job(s)", len(running))
        _done, stuck = await asyncio.wait([asyncio.wrap_future(f) for f in running],
                                          timeout=ORPHAN_WAIT_SECONDS if wait_seconds is None else wait_seconds)
        if stuck:
            logger.warning("scan analyse: %d job(s) still running after the wait; killing the workers", len(stuck))
            if isinstance(jobs.pool, ProcessPoolExecutor):
                _reset_pool(expected=jobs.pool, terminate=True)
    finally:
        slots.release()


def release_slot(jobs: Jobs) -> None:
    """Release the slot now if the call left no job running, else once they end."""
    if not jobs.outstanding():
        slots.release()
        return
    task = asyncio.get_running_loop().create_task(release_after_jobs(jobs))
    _holders.add(task)                       # the loop keeps only a weak reference
    task.add_done_callback(_holders.discard)


# ── records ───────────────────────────────────────────────────────────────────

@dataclass
class PageRec:
    ref: str
    pass_no: int
    file_id: str
    page_index: int
    kind: str
    name: str
    feat: Optional[pages.PageFeatures] = None
    error: Optional[str] = None
    blank_class: str = ink.WRITTEN

    def as_dict(self) -> dict[str, Any]:
        f = self.feat
        return {
            "ref": self.ref,
            "pass_no": self.pass_no,
            "file_id": self.file_id,
            "page_index": self.page_index,
            "kind": self.kind,
            "dpi": int(round(f.dpi)) if f else int(pages.DEFAULT_DPI),
            "dpi_source": f.dpi_source if f else pages.SRC_ASSUMED,
            "width_px": f.width_px if f else 0,
            "height_px": f.height_px if f else 0,
            "ink_per_10k": round(f.ink_per_10k, 3) if f else 0.0,
            "blank_class": self.blank_class,
            "error": self.error,
        }


class _Flags:
    def __init__(self) -> None:
        self.items: list[dict[str, Any]] = []

    def add(self, code: str, detail: str, sheet_no: Optional[int] = None) -> None:
        self.items.append({"code": code, "severity": SEVERITY[code], "sheet_no": sheet_no, "detail": detail})

    def has(self, severity: str) -> bool:
        return any(f["severity"] == severity for f in self.items)

    def status(self) -> str:
        if self.has(BLOCK):
            return BLOCKED
        if self.has(REVIEW):
            return STATUS_REVIEW
        return OK


Fetcher = Callable[..., Awaitable[tuple[dict[str, fetch.Fetched], bool]]]


# ── the analysis ──────────────────────────────────────────────────────────────

async def _features(executor: Optional[Executor], specs: list[tuple[str, str, str]],
                    fetched: dict[str, fetch.Fetched], jobs: Jobs) -> dict[str, pages.FileResult]:
    """specs: (key, kind, _). Runs pages.extract_file for every fetched file."""
    pool = executor if executor is not None else _get_pool()
    out: dict[str, pages.FileResult] = {}

    async def one(key: str, kind: str) -> None:
        got = fetched.get(key)
        if got is None or got.path is None:
            return
        out[key] = await jobs.submit(pool, pages.extract_file, got.path, kind, config.MAX_PAGES_PER_PASS)

    try:
        await asyncio.gather(*(one(k, kind) for k, kind, _n in specs))
    except BrokenProcessPool as e:
        if executor is None:
            _reset_pool(expected=pool)
        raise ScanRetryable("the scan worker pool broke") from e
    return out


def _upright_header(f: Optional[pages.PageFeatures], rotation: int):
    if f is None:
        return None
    return f.header_down if rotation == 180 else f.header_up


async def _one_sided(reader: HeaderReader, by_pass: dict[int, list[PageRec]], found: Any,
                     flags: _Flags, result: Callable[..., dict[str, Any]], s: Any) -> dict[str, Any]:
    """One pass of one-sided copies: each page is a sheet of its own with no back.
    Same header read and label guard as two passes; no show-through pairing."""
    fp, rot = found.fronts_pass, found.fronts_rotation
    fronts = by_pass[fp]
    n = len(fronts)

    reads: dict[int, HeaderRead] = dict(found.reads)
    todo = [i for i in range(n) if i not in reads and fronts[i].feat is not None]
    strip_of = (lambda f: f.strip_down) if rot == 180 else (lambda f: f.strip_up)
    got = await reader.read([strip_of(fronts[i].feat) for i in todo])
    reads.update(zip(todo, got))
    for i in range(n):
        reads.setdefault(i, HeaderRead())

    label_idx = [i for i in range(n) if reads[i].label_kind == PRINTED_FIELD and fronts[i].feat is not None]
    templ = headers_guard.template([_upright_header(fronts[i].feat, rot) for i in label_idx])
    front_sim = {i: headers_guard.similarity(templ, _upright_header(fronts[i].feat, rot)) for i in range(n)}

    sheets: list[dict[str, Any]] = []
    for i in range(n):
        front = fronts[i]
        hr = reads[i]
        sim = front_sim.get(i)
        is_label = hr.label_kind == PRINTED_FIELD
        sheets.append({
            "sheet_no": i,
            "front": front.ref,
            "back": None,
            "pair_score": None,
            "pair_runner_up": None,
            "pair_is_row_max": True,
            "label_kind": hr.label_kind,
            "label_present": is_label,
            "name_text": hr.name_value,
            "name_readable": bool(hr.name_value) and hr.name_legible,
            "roll_text": hr.roll_value,
            "label_template_sim": sim,
            "back_label_like": False,
            "front_blank_class": front.blank_class,
            "back_blank_class": None,
        })
        if is_label and not (hr.name_value and hr.name_legible):
            flags.add("LABEL_NO_VALUE", "the printed name field has no readable name", i)
        if is_label and len(label_idx) >= 3 and sim is not None and sim < s.label_sim_min:
            flags.add("LABEL_UNUSUAL", f"this name field looks unlike the others (similarity {sim:.2f})", i)
        if front.feat is not None and front.blank_class == ink.BLANK:
            flags.add("FRONT_BLANK", "the page looks blank", i)

    layout_out = {
        "fronts_pass": fp,
        "fronts_rotation": rot,
        "backs_order": None,
        "backs_rotation": None,
        "order_margin": None,
        "shift": None,
        "blank_rule_suspect": False,
    }
    evidence = {"first_front_label": sheets[0]["label_present"], "last_front_label": sheets[-1]["label_present"]}
    return result(layout_out, sheets, evidence)


async def analyse_load(
    req: dict[str, Any],
    *,
    llm: Any,
    model: str,
    executor: Optional[Executor] = None,
    fetcher: Optional[Fetcher] = None,
    jobs: Optional[Jobs] = None,
) -> dict[str, Any]:
    """Analyse one load. `req` is the C1 request body as a dict. Raises
    ScanRetryable (model outage / broken pool); every problem with the
    files themselves is a flag in the 200 response. Pool work is submitted
    through `jobs`, so a caller that gives up can see what still runs."""
    jobs = jobs if jobs is not None else Jobs()
    s = config.settings()
    flags = _Flags()
    reader = HeaderReader(llm, model, req.get("institute_id"), concurrency=s.header_concurrency)
    fetcher = fetcher or fetch.fetch_all
    load_no = req.get("load_no")

    passes = sorted(req.get("passes") or [], key=lambda p: p["pass_no"])
    # One-sided copies: one pass, every page is a front with nothing on the back.
    one_sided = bool(req.get("one_sided")) and len(passes) == 1
    specs: list[fetch.FetchSpec] = []
    file_specs: list[tuple[str, str, str]] = []
    for p in passes:
        for idx, f in enumerate(p["files"]):
            key = f"{p['pass_no']}:{idx}"
            specs.append(fetch.FetchSpec(key=key, url=f["url"], suffix=".pdf" if f["kind"] == "PDF" else ".img"))
            file_specs.append((key, f["kind"], f.get("name") or ""))

    tmp = Path(tempfile.mkdtemp(prefix="scan-analyse-"))
    try:
        fetched, load_too_large = await fetcher(specs, tmp)
        results = await _features(executor, file_specs, fetched, jobs)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # ── pages, per pass, in clerk order ──
    by_pass: dict[int, list[PageRec]] = {}
    too_many_pages = False
    for p in passes:
        recs: list[PageRec] = []
        for idx, f in enumerate(p["files"]):
            key = f"{p['pass_no']}:{idx}"
            got = fetched.get(key) or fetch.Fetched(error=fetch.ERR_FETCH)
            res = results.get(key)
            base = dict(pass_no=p["pass_no"], file_id=f["file_id"], kind=f["kind"], name=f.get("name") or "")
            if res is None or res.error or not res.pages:
                why = got.error or (res.error if res else None) or pages.ERR_UNREADABLE
                rec = PageRec(ref="", page_index=0, error=why, **base)
                recs.append(rec)
                if why != fetch.ERR_LOAD_TOO_LARGE:
                    flags.add("FILE_UNREADABLE", f"{rec.name or 'file'} ({rec.file_id}): {why}")
                continue
            if res.total_pages > len(res.pages):
                too_many_pages = True
            for feat in res.pages:
                recs.append(PageRec(ref="", page_index=feat.page_index, feat=feat, **base))
        if len(recs) > config.MAX_PAGES_PER_PASS:
            too_many_pages = True
            recs = recs[: config.MAX_PAGES_PER_PASS]
        for i, r in enumerate(recs):
            r.ref = f"p{p['pass_no']}.{i}"
        by_pass[p["pass_no"]] = recs
    if load_too_large:
        flags.add("LOAD_TOO_LARGE", f"the load is over {config.MAX_LOAD_BYTES // (1024 * 1024)} MB")
    if too_many_pages:
        flags.add("LOAD_TOO_LARGE", f"a pass has more than {config.MAX_PAGES_PER_PASS} pages")

    all_pages = [r for recs in by_pass.values() for r in recs]
    for r in all_pages:
        if r.feat is not None:
            r.blank_class = ink.classify(r.feat.ink_per_10k, r.feat.blob_mm2, s.blank_ink, s.unsure_ink, s.blob_mm2)
    assumed = sum(1 for r in all_pages if r.feat is not None and r.feat.dpi_source == pages.SRC_ASSUMED)
    low = sum(1 for r in all_pages if r.feat is not None and r.feat.dpi < DPI_LOW_BELOW)
    if assumed:
        flags.add("DPI_ASSUMED", f"{assumed} page(s) carry no resolution; {int(pages.DEFAULT_DPI)} DPI assumed")
    if low:
        flags.add("DPI_LOW", f"{low} page(s) scanned below {int(DPI_LOW_BELOW)} DPI")

    def result(layout: Optional[dict], sheets: list[dict], evidence: dict) -> dict[str, Any]:
        logger.info("scan analyse: load %s, %d pages, %d sheets, %d flags, %d model calls",
                    load_no, len(all_pages), len(sheets), len(flags.items), reader.usage.model_calls)
        return {
            "analyser_version": ANALYSER_VERSION,
            "load_no": load_no,
            "status": flags.status(),
            "layout": layout,
            "evidence": evidence,
            "pages": [r.as_dict() for r in all_pages],
            "sheets": sheets,
            "flags": flags.items,
            "usage": reader.usage.as_dict(),
        }

    # ── probe: which pass is the fronts, which way up ──
    strips = {pn: [(r.feat.strip_up, r.feat.strip_down) if r.feat else None for r in recs]
              for pn, recs in by_pass.items()}
    found = await probe(reader, strips)
    if not found.found:
        flags.add("NO_NAME_BOX_FOUND", "no printed name field was found on the first pages of either pass")

    if one_sided:
        if not found.found:
            return result(None, [], {"first_front_label": False, "last_front_label": False})
        return await _one_sided(reader, by_pass, found, flags, result, s)

    counts = {pn: len(recs) for pn, recs in by_pass.items()}
    if len(counts) != 2 or len(set(counts.values())) != 1:
        flags.add("COUNT_MISMATCH", ", ".join(f"pass {pn}: {c} pages" for pn, c in sorted(counts.items())))
        first = bool(found.found and found.reads.get(0) and found.reads[0].label_kind == PRINTED_FIELD)
        return result(None, [], {"first_front_label": first, "last_front_label": False})
    if not found.found:
        return result(None, [], {"first_front_label": False, "last_front_label": False})

    fp, rot = found.fronts_pass, found.fronts_rotation
    bp = next(pn for pn in by_pass if pn != fp)
    fronts, backs = by_pass[fp], by_pass[bp]
    n = len(fronts)

    # ── read every front's header not read by the probe ──
    reads: dict[int, HeaderRead] = dict(found.reads)
    todo = [i for i in range(n) if i not in reads and fronts[i].feat is not None]
    strip_of = (lambda f: f.strip_down) if rot == 180 else (lambda f: f.strip_up)
    got = await reader.read([strip_of(fronts[i].feat) for i in todo])
    reads.update(zip(todo, got))
    for i in range(n):
        reads.setdefault(i, HeaderRead())

    # ── show-through pairing (CPU: worker pool) ──
    front_maps = [None if r.feat is None else (showthrough.rot180(r.feat.dark) if rot == 180 else r.feat.dark)
                  for r in fronts]
    back_maps = [None if r.feat is None else r.feat.dark for r in backs]
    pool = executor if executor is not None else _get_pool()
    try:
        layout = await jobs.submit(pool, showthrough.choose_layout, front_maps, back_maps, s.order_min_margin)
    except BrokenProcessPool as e:
        if executor is None:
            _reset_pool(expected=pool)
        raise ScanRetryable("the scan worker pool broke") from e

    # ── label-template guard ──
    label_idx = [i for i in range(n) if reads[i].label_kind == PRINTED_FIELD and fronts[i].feat is not None]
    templ = headers_guard.template([_upright_header(fronts[i].feat, rot) for i in label_idx])
    front_sim = {i: headers_guard.similarity(templ, _upright_header(fronts[i].feat, rot)) for i in range(n)}

    # ── blank rule sanity ──
    fronts_ok = [r for r in fronts if r.feat is not None]
    blank_fronts = sum(1 for r in fronts_ok if r.blank_class == ink.BLANK)
    blank_rule_suspect = bool(fronts_ok) and blank_fronts > BLANK_FRONTS_SUSPECT * len(fronts_ok)
    if blank_rule_suspect:
        flags.add("BLANK_RULE_SUSPECT", f"{blank_fronts} of {len(fronts_ok)} fronts look blank; no back will be left out")

    # ── load-level pairing flags ──
    if layout.order_uncertain:
        flags.add("ORDER_UNCERTAIN", f"the backs' order is weakly determined (margin {layout.order_margin:.2f})")
    if layout.shift:
        flags.add("PAIR_SHIFT_DETECTED",
                  f"from sheet {layout.shift['from_sheet']} the backs match the sheet {layout.shift['offset']:+d} away",
                  sheet_no=layout.shift["from_sheet"])

    # ── sheets ──
    not_row_max = set(layout.not_row_max)
    sheets: list[dict[str, Any]] = []
    for i in range(n):
        front = fronts[i]
        back = backs[showthrough.partner(i, n, layout.backs_order)]
        hr = reads[i]
        row = layout.rows[i]
        sim = front_sim.get(i)
        back_sim = None
        if templ is not None and back.feat is not None:
            b_up = headers_guard.similarity(templ, _upright_header(back.feat, layout.backs_rotation))
            b_turn = headers_guard.similarity(templ, _upright_header(back.feat, (layout.backs_rotation + 180) % 360))
            back_sim = max(b_up or 0.0, b_turn or 0.0)
        back_label_like = back_sim is not None and back_sim >= s.back_label_sim
        is_label = hr.label_kind == PRINTED_FIELD
        sheets.append({
            "sheet_no": i,
            "front": front.ref,
            "back": back.ref,
            "pair_score": round(row.pair_score, 4),
            "pair_runner_up": None if row.runner_up is None else round(row.runner_up, 4),
            "pair_is_row_max": row.is_row_max,
            "label_kind": hr.label_kind,
            "label_present": is_label,
            "name_text": hr.name_value,
            "name_readable": bool(hr.name_value) and hr.name_legible,
            "roll_text": hr.roll_value,
            "label_template_sim": sim,
            "back_label_like": back_label_like,
            "front_blank_class": front.blank_class,
            "back_blank_class": back.blank_class,
        })
        if is_label and not (hr.name_value and hr.name_legible):
            flags.add("LABEL_NO_VALUE", "the printed name field has no readable name", i)
        if is_label and len(label_idx) >= 3 and sim is not None and sim < s.label_sim_min:
            flags.add("LABEL_UNUSUAL", f"this name field looks unlike the others (similarity {sim:.2f})", i)
        if back_label_like:
            flags.add("BACK_HAS_LABEL", "a back page carries the printed name field: a sheet was turned over", i)
        if i in not_row_max:
            flags.add("PAIR_NOT_ROW_MAX", "a neighbouring back matches this front better", i)
        if front.feat is not None and front.blank_class == ink.BLANK:
            flags.add("FRONT_BLANK", "the front side looks blank", i)
        if back.feat is not None and back.blank_class == ink.UNSURE:
            flags.add("UNSURE_KEPT", "the back has very little writing; it is kept", i)

    layout_out = {
        "fronts_pass": fp,
        "fronts_rotation": rot,
        "backs_order": layout.backs_order,
        "backs_rotation": layout.backs_rotation,
        "order_margin": layout.order_margin,
        "shift": layout.shift,
        "blank_rule_suspect": blank_rule_suspect,
    }
    evidence = {"first_front_label": sheets[0]["label_present"], "last_front_label": sheets[-1]["label_present"]}
    return result(layout_out, sheets, evidence)
