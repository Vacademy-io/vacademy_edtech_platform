#!/usr/bin/env python
"""Scan Station replay + calibration harness (plan task T6).

Runs the real analyse-load code (app/services/copy_check/scan/analyse.py) in
this process on a local two-pass folder, then prints what a clerk's load would
look like and how much room the thresholds leave:

  - layout: fronts pass and rotation, backs order and rotation, order margin,
    the four hypothesis means;
  - per sheet: pair score, runner-up (best neighbour within +-2), margin;
  - per page: DPI, ink per 10k, largest blob, blank class;
  - flags and timing;
  - calibration: darkest BLANK vs faintest WRITTEN against SCAN_BLANK_INK /
    SCAN_UNSURE_INK / SCAN_BLOB_MM2, show-through margins (optionally the full
    n x n matrix, which production never builds), label-template similarities;
  - the copies a tiny Python port of ScanPlanner would make (one load only);
  - optionally a local scan_build run (downloads and the media upload served by
    an httpx MockTransport) that writes one PDF per copy to disk.

The vision model is never called unless --model is given:
  - --expected FILE  answers from the fixture's truth (labels on the upright
                     fronts; NONE everywhere else). This tests everything but
                     the model.
  - --reads FILE     replays model answers recorded earlier with --record.
  - --model NAME     the real model, through ChatLLMClient + ApiKeyResolver on
                     the ai_service database (needs the service's env). Use
                     --record FILE to keep its answers for later replays.

Faults can be planted on real scans: --swap p2.0=p1.5 (a sheet turned over in
the pile), --drop p2.1 --drop p1.1 (a double-feed in both passes), --turn 2 (a
pass fed upside-down), --grey 1 --grey 2 (the scanner set to Grey). Turned or
grey copies are written next to --json (else under $TMPDIR).

Calibration extras: --matrix (full n x n show-through scores), --dpi-sweep
100,150,200 (ink as if scanned at each DPI), --fade (the faintest written page
faded toward the paper: how much lighter can pencil be?), --cuts (ink with the
neutral luma cut moved from 170 to 220).

Never uploads anything; writes only --build-out, --json, --record and the
planted variants.

Usage (from ai_service/):
  python tools/scan_replay.py --pass1 DIR --pass2 DIR [--expected F] [--json OUT]
  python tools/scan_replay.py --fixtures-dir ~/Desktop/scan-test \
      --expected tests/fixtures/scan/expected_11_18.json --matrix --dpi-sweep 100,150,200 --fade
  add --build-out DIR to write the copy PDFs.

Images are private student work: keep them out of git (see
tests/fixtures/scan/README.md).
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import multiprocessing
import os
import re
import statistics
import sys
import time
from concurrent.futures import Executor, Future, ProcessPoolExecutor
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

from app.services.copy_check.scan import (  # noqa: E402
    analyse, config, fetch, headers_guard, ink, pages, showthrough,
)
from app.services.copy_check.scan.header_read import (  # noqa: E402
    NONE, PRINTED_FIELD, parse_reply,
)

URL_BASE = "http://scan-replay.local"
IMAGE_EXT = (".jpg", ".jpeg", ".png")
PDF_EXT = (".pdf",)
SWEEP_JPEG_QUALITY = 85
FADE_FACTORS = (1.0, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5)
LUMA_CUTS = (170, 180, 190, 200, 210, 220)

# ── files and order ───────────────────────────────────────────────────────────

_SUFFIX = re.compile(r"^(?P<stem>.*?)(?: (?P<n>\d+))?\.(?P<ext>[A-Za-z0-9]+)$")


def order_key_suffix(name: str) -> tuple:
    """macOS Image Capture names a run "Scan.jpeg", "Scan 1.jpeg", ... "Scan 12.jpeg":
    the bare name is the FIRST page (it sorts last by name)."""
    m = _SUFFIX.match(name)
    if not m:
        return (name, 0)
    return (m.group("stem"), int(m.group("n") or 0))


def _natural(name: str) -> list:
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", name)]


def list_pass(folder: Path, order: str = "suffix") -> list[Path]:
    files = [p for p in folder.iterdir()
             if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in IMAGE_EXT + PDF_EXT]
    if order == "suffix":
        files.sort(key=lambda p: order_key_suffix(p.name))
    elif order == "mtime":
        files.sort(key=lambda p: (p.stat().st_mtime, p.name))
    else:
        files.sort(key=lambda p: _natural(p.name))
    return files


def kind_of(path: Path) -> str:
    return "PDF" if path.suffix.lower() in PDF_EXT else "IMAGE"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def url_of(pass_no: int, idx: int) -> str:
    return f"{URL_BASE}/{pass_no}/{idx}"


def build_request(pass_files: dict[int, list[Path]], load_no: int = 1) -> dict[str, Any]:
    return {
        "institute_id": "scan-replay",
        "session_id": "scan-replay",
        "load_no": load_no,
        "preferred_model": None,
        "passes": [{"pass_no": pn, "files": [
            {"file_id": f"{pn}-{i}", "url": url_of(pn, i), "kind": kind_of(p), "name": p.name}
            for i, p in enumerate(files)]} for pn, files in sorted(pass_files.items())],
    }


# ── page features, computed once ──────────────────────────────────────────────

def compute_features(pass_files: dict[int, list[Path]], workers: int) -> dict[str, pages.FileResult]:
    """{local path: FileResult}, through the spawned pool like production."""
    paths = [str(p) for files in pass_files.values() for p in files]
    out: dict[str, pages.FileResult] = {}
    if workers <= 1:
        for p in paths:
            out[p] = pages.extract_file(p, kind_of(Path(p)), config.MAX_PAGES_PER_PASS)
        return out
    with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn"),
                             initializer=pages.init_worker) as pool:
        futs = {p: pool.submit(pages.extract_file, p, kind_of(Path(p)), config.MAX_PAGES_PER_PASS) for p in paths}
        for p, f in futs.items():
            out[p] = f.result()
    return out


class MemoExecutor(Executor):
    """Hands analyse the features computed up front and keeps choose_layout's
    full result (hypothesis means, row offsets) for the printout."""

    def __init__(self, features: dict[str, pages.FileResult]):
        self.features = features
        self.layout: Optional[showthrough.Layout] = None
        self.layout_seconds = 0.0

    def submit(self, fn, /, *args, **kwargs):  # type: ignore[override]
        fut: Future = Future()
        try:
            if fn is pages.extract_file and args[0] in self.features:
                fut.set_result(self.features[args[0]])
            elif fn is showthrough.choose_layout:
                t0 = time.perf_counter()
                self.layout = fn(*args, **kwargs)
                self.layout_seconds = time.perf_counter() - t0
                fut.set_result(self.layout)
            else:
                fut.set_result(fn(*args, **kwargs))
        except BaseException as e:  # noqa: BLE001
            fut.set_exception(e)
        return fut


def local_fetcher(pass_files: dict[int, list[Path]]):
    by_url = {url_of(pn, i): p for pn, files in pass_files.items() for i, p in enumerate(files)}

    async def fetcher(specs, _tmp):
        got = {}
        for sp in specs:
            p = by_url.get(sp.url)
            got[sp.key] = (fetch.Fetched(path=str(p), size=p.stat().st_size) if p
                           else fetch.Fetched(error=fetch.ERR_FETCH))
        return got, False
    return fetcher


def strip_index(pass_files: dict[int, list[Path]], features: dict[str, pages.FileResult]) -> dict[bytes, str]:
    """strip bytes -> 'p{pass}.{page idx in pass}.{up|down}' (the C1 ref + way up)."""
    out: dict[bytes, str] = {}
    for pn, files in pass_files.items():
        i = 0
        for p in files:
            res = features[str(p)]
            if res.error or not res.pages:
                i += 1
                continue
            for f in res.pages:
                out[f.strip_up] = f"p{pn}.{i}.up"
                out[f.strip_down] = f"p{pn}.{i}.down"
                i += 1
    return out


# ── the vision model: truth, replay, or real ─────────────────────────────────

def reads_from_expected(exp: dict[str, Any]) -> dict[str, dict[str, Any]]:
    lay = exp["layout"]
    way = "up" if int(lay["fronts_rotation"]) == 0 else "down"
    return {f"p{lay['fronts_pass']}.{int(i)}.{way}": {
        "label_kind": PRINTED_FIELD, "name_value": name, "name_legible": bool(name), "roll_value": None,
        "confidence": 0.95} for i, name in exp["labels"].items()}


def _images(messages: list[dict[str, Any]]) -> list[bytes]:
    parts = messages[-1]["content"]
    return [base64.b64decode(p["image_url"]["url"].split(",", 1)[1]) for p in parts if p.get("type") == "image_url"]


class ReplayLLM:
    """Answers each strip from a {key: read} table (default NONE)."""

    def __init__(self, table: dict[str, dict[str, Any]], index: dict[bytes, str]):
        self.table = table
        self.index = index
        self.calls: list[int] = []
        self.unknown = 0

    async def chat_completion(self, messages, **_kw):
        imgs = _images(messages)
        self.calls.append(len(imgs))
        out = []
        for k, data in enumerate(imgs, start=1):
            key = self.index.get(data)
            if key is None:
                self.unknown += 1
            read = self.table.get(key or "", {"label_kind": NONE})
            out.append({"i": k, **read})
        return {"content": json.dumps(out), "usage": {"prompt_tokens": 0, "completion_tokens": 0}}


class RecordingLLM:
    """The real model; every answer is kept by strip key for --record."""

    def __init__(self, inner: Any, index: dict[bytes, str]):
        self.inner = inner
        self.index = index
        self.recorded: dict[str, dict[str, Any]] = {}
        self.calls: list[int] = []
        self.unknown = 0

    async def chat_completion(self, messages, **kw):
        imgs = _images(messages)
        self.calls.append(len(imgs))
        resp = await self.inner.chat_completion(messages=messages, **kw)
        try:
            reads = parse_reply((resp or {}).get("content") or "", len(imgs))
            for data, r in zip(imgs, reads):
                key = self.index.get(data)
                if key:
                    self.recorded[key] = {"label_kind": r.label_kind, "name_value": r.name_value,
                                          "name_legible": r.name_legible, "roll_value": r.roll_value,
                                          "confidence": r.confidence}
        except Exception:  # noqa: BLE001 - analyse handles a bad reply itself
            pass
        return resp


# ── a tiny port of ScanPlanner (one load, no clerk decisions; printout only) ──

def plan_copies(result: dict[str, Any], direction: Optional[str] = None) -> dict[str, Any]:
    """ScanPlanner.plan for a single live load 1 with no decisions:
    direction (CLERK > LOAD1 > DEFAULT), split on PRINTED_FIELD fronts, front
    then back unless the back is BLANK (WRITTEN when blank_rule_suspect),
    FIRST_SHEET_NO_LABEL, COPY_UNUSUALLY_LONG, FRONT_ORDER_UNCERTAIN.
    SAME_NAME's fuzzy match, accepts and multi-load chaining are not ported."""
    sheets = sorted(result.get("sheets") or [], key=lambda s: s["sheet_no"])
    layout = result.get("layout") or {}
    pages_by_ref = {p["ref"]: p for p in result.get("pages") or []}
    labelled = [bool(s.get("label_present")) and s.get("label_kind") == PRINTED_FIELD for s in sheets]
    if direction in ("FORWARD", "REVERSED"):
        source = "CLERK"
    elif sheets and labelled[0] != labelled[-1]:
        direction, source = ("FORWARD" if labelled[0] else "REVERSED"), "LOAD1"
    else:
        direction, source = "FORWARD", "DEFAULT"
    seq = list(zip(sheets, labelled))
    if direction == "REVERSED":
        seq.reverse()
    suspect = bool(layout.get("blank_rule_suspect"))
    front_rot = int(layout.get("fronts_rotation") or 0)
    back_rot = int(layout.get("backs_rotation") or 0)
    copies: list[dict[str, Any]] = []
    for s, lab in seq:
        if not copies or lab:
            copies.append({"first_sheet_no": s["sheet_no"], "name_text": s.get("name_text"), "sheets": [],
                           "pages": [], "left_out": [], "flags": []})
            if len(copies) == 1 and not lab:
                copies[0]["flags"].append("FIRST_SHEET_NO_LABEL")
        c = copies[-1]
        c["sheets"].append(s["sheet_no"])
        c["pages"].append({"ref": s["front"], "rotation": front_rot, "side": "FRONT"})
        back = pages_by_ref.get(s["back"]) or {}
        cls = "WRITTEN" if suspect else back.get("blank_class", "WRITTEN")
        (c["left_out"] if cls == "BLANK" else c["pages"]).append(
            {"ref": s["back"], "rotation": back_rot, "side": "BACK"})
    if copies:
        median = statistics.median(len(c["sheets"]) for c in copies)
        for c in copies:
            if len(c["sheets"]) > max(3, 2.0 * median):
                c["flags"].append("COPY_UNUSUALLY_LONG")
    for n, c in enumerate(copies, start=1):
        c["copy_key"] = f"L1-S{c['first_sheet_no']}"
        c["file_name"] = f"scan_l1_c{n}.pdf"
    session_flags = []
    if source == "DEFAULT" and any(len(c["sheets"]) >= 2 for c in copies):
        session_flags.append("FRONT_ORDER_UNCERTAIN")
    return {"direction": direction, "direction_source": source, "session_flags": session_flags, "copies": copies}


# ── calibration ───────────────────────────────────────────────────────────────

def _feat_by_ref(pass_files, features) -> dict[str, pages.PageFeatures]:
    out = {}
    for pn, files in pass_files.items():
        i = 0
        for p in files:
            res = features[str(p)]
            if res.error or not res.pages:
                i += 1
                continue
            for f in res.pages:
                out[f"p{pn}.{i}"] = f
                i += 1
    return out


def full_matrix(result: dict[str, Any], feats: dict[str, pages.PageFeatures]) -> Optional[dict[str, Any]]:
    """Every front x every back at the chosen back rotation (calibration only:
    production scores the diagonals and a +-2 band)."""
    lay = result.get("layout")
    if not lay:
        return None
    fp, bp = lay["fronts_pass"], 3 - lay["fronts_pass"]
    n = len(result["sheets"])
    fronts = [feats.get(f"p{fp}.{i}") for i in range(n)]
    backs = [feats.get(f"p{bp}.{j}") for j in range(n)]
    fmaps = [None if f is None else (showthrough.rot180(f.dark) if lay["fronts_rotation"] == 180 else f.dark)
             for f in fronts]
    bmaps = [None if b is None else showthrough.back_hypothesis(b.dark, lay["backs_rotation"]) for b in backs]
    m = np.zeros((n, n), np.float32)
    for i in range(n):
        for j in range(n):
            if fmaps[i] is not None and bmaps[j] is not None:
                m[i, j] = showthrough.pair_score(fmaps[i], bmaps[j])
    part = [showthrough.partner(i, n, lay["backs_order"]) for i in range(n)]
    row_lead, col_lead = [], []
    for i in range(n):
        others = [m[i, j] for j in range(n) if j != part[i]]
        row_lead.append(float(m[i, part[i]] - max(others)) if others else None)
        col = [m[k, part[i]] for k in range(n) if k != i]
        col_lead.append(float(m[i, part[i]] - max(col)) if col else None)
    diag = [float(m[i, part[i]]) for i in range(n)]
    off = [float(m[i, j]) for i in range(n) for j in range(n) if j != part[i]]
    return {"matrix": [[round(float(x), 4) for x in row] for row in m], "partner": part,
            "pair_scores": [round(x, 4) for x in diag],
            "row_lead": [None if x is None else round(x, 4) for x in row_lead],
            "col_lead": [None if x is None else round(x, 4) for x in col_lead],
            "min_pair": round(min(diag), 4) if diag else None,
            "max_off": round(max(off), 4) if off else None}


def label_sims(result: dict[str, Any], feats: dict[str, pages.PageFeatures]) -> Optional[dict[str, Any]]:
    lay = result.get("layout")
    if not lay:
        return None
    fp, bp, rot = lay["fronts_pass"], 3 - lay["fronts_pass"], lay["fronts_rotation"]

    def up(f, r):
        return f.header_down if r == 180 else f.header_up
    sheets = result["sheets"]
    lab = [s["sheet_no"] for s in sheets if s["label_present"]]
    maps = {s["sheet_no"]: up(feats[s["front"]], rot) for s in sheets if s["front"] in feats}
    templ = headers_guard.template([maps[i] for i in lab if i in maps])
    loo = {}
    for i in lab:
        others = [maps[k] for k in lab if k != i and k in maps]
        if others:
            loo[i] = headers_guard.similarity(headers_guard.template(others), maps[i])
    backs = {}
    for s in sheets:
        b = feats.get(s["back"])
        if b is not None and templ is not None:
            backs[s["back"]] = max(headers_guard.similarity(templ, b.header_up) or 0.0,
                                   headers_guard.similarity(templ, b.header_down) or 0.0)
    return {
        "label_fronts": {i: s for i, s in ((s["sheet_no"], s["label_template_sim"]) for s in sheets) if i in lab},
        "label_fronts_leave_one_out": loo,
        "other_fronts": {s["sheet_no"]: s["label_template_sim"] for s in sheets if s["sheet_no"] not in lab},
        "backs_best_of_both_ways": {k: round(v, 4) for k, v in backs.items()},
    }


def blank_calibration(result: dict[str, Any], feats: dict[str, pages.PageFeatures],
                      truth_blank: Optional[set[str]], s: config.ScanSettings) -> dict[str, Any]:
    rows = [p for p in result["pages"] if p["ref"] in feats]
    if truth_blank is not None:
        blank = [p for p in rows if p["ref"] in truth_blank]
        written = [p for p in rows if p["ref"] not in truth_blank]
        basis = "truth"
    else:
        blank = [p for p in rows if p["blank_class"] == ink.BLANK]
        written = [p for p in rows if p["blank_class"] == ink.WRITTEN]
        basis = "classes"
    out: dict[str, Any] = {"basis": basis, "blank_ink": s.blank_ink, "unsure_ink": s.unsure_ink,
                           "blob_mm2": s.blob_mm2}
    if blank:
        db = max(blank, key=lambda p: feats[p["ref"]].ink_per_10k)
        out["darkest_blank"] = {"ref": db["ref"], "ink": round(feats[db["ref"]].ink_per_10k, 3),
                                "class": db["blank_class"]}
        out["largest_blank_blob_mm2"] = round(max(feats[p["ref"]].blob_mm2 for p in blank), 3)
        out["blank_ink_headroom_x"] = round(s.blank_ink / max(1e-6, feats[db["ref"]].ink_per_10k), 2)
        out["blob_headroom_x"] = round(s.blob_mm2 / max(1e-6, out["largest_blank_blob_mm2"]), 2)
    if written:
        fw = min(written, key=lambda p: feats[p["ref"]].ink_per_10k)
        out["faintest_written"] = {"ref": fw["ref"], "ink": round(feats[fw["ref"]].ink_per_10k, 3),
                                   "blob_mm2": round(feats[fw["ref"]].blob_mm2, 2), "class": fw["blank_class"]}
        out["written_over_unsure_x"] = round(feats[fw["ref"]].ink_per_10k / max(1e-6, s.unsure_ink), 2)
    if blank and written:
        out["gap_x"] = round(out["faintest_written"]["ink"] / max(1e-6, out["darkest_blank"]["ink"]), 1)
    out["misclassified"] = (
        [p["ref"] for p in blank if p["blank_class"] != ink.BLANK]
        + [p["ref"] for p in written if p["blank_class"] == ink.BLANK]) if truth_blank is not None else None
    return out


def _decode(data: bytes) -> np.ndarray:
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    return cv2.cvtColor(arr, cv2.COLOR_BGR2RGB)


def _native_rgb(path: Path) -> tuple[np.ndarray, float]:
    from PIL import Image, ImageOps
    with Image.open(path) as im:
        dpi, _src = pages.image_dpi(im)
        im = ImageOps.exif_transpose(im) or im
        return np.asarray(im.convert("RGB")), dpi


def _measure_at(rgb: np.ndarray, native: float, dpi: float) -> tuple[float, float]:
    """As if scanned at `dpi`: area-resample, JPEG q85 round trip, then pages.py's
    ink path (ink at min(dpi, 300))."""
    img = pages._resize_to(rgb, dpi / native)
    ok, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_JPEG_QUALITY), SWEEP_JPEG_QUALITY])
    img = _decode(buf.tobytes())
    at = pages.ink_dpi(dpi)
    img = pages._resize_to(img, at / dpi)
    return ink.measure(img, at)


def dpi_sweep(pass_files, dpis: list[float], s: config.ScanSettings) -> list[dict[str, Any]]:
    """Ink/blob/class of every image page re-sampled to each DPI (a simulation of
    scanning at that setting; real scanner optics differ)."""
    out = []
    for pn, files in sorted(pass_files.items()):
        for i, p in enumerate(files):
            if kind_of(p) != "IMAGE":
                continue
            rgb, native = _native_rgb(p)
            row = {"ref": f"p{pn}.{i}", "native_dpi": native, "at": {}}
            for d in dpis:
                if d > native:
                    continue
                v, b = _measure_at(rgb, native, d)
                row["at"][str(int(d))] = {"ink": round(v, 3), "blob_mm2": round(b, 2),
                                          "class": ink.classify(v, b, s.blank_ink, s.unsure_ink, s.blob_mm2)}
            out.append(row)
    return out


def fade_sweep(path: Path, dpis: list[float], s: config.ScanSettings,
               factors=FADE_FACTORS) -> list[dict[str, Any]]:
    """The page with its writing faded toward the paper (factor 1 = as scanned,
    0.5 = half as dark against the paper): how much lighter than this page can
    a pencil answer be before it turns UNSURE / BLANK? Paper = per-channel median."""
    rgb, native = _native_rgb(path)
    paper = np.median(rgb.reshape(-1, 3), axis=0).astype(np.float32)
    out = []
    for f in factors:
        faded = np.clip(paper + f * (rgb.astype(np.float32) - paper), 0, 255).astype(np.uint8)
        row = {"factor": f, "darkest_luma": int(ink.luma(faded[::4, ::4]).min()), "at": {}}
        for d in dpis:
            if d > native:
                continue
            v, b = _measure_at(faded, native, d)
            row["at"][str(int(d))] = {"ink": round(v, 3), "blob_mm2": round(b, 2),
                                      "class": ink.classify(v, b, s.blank_ink, s.unsure_ink, s.blob_mm2)}
        out.append(row)
    return out


def cut_profile(pass_files, cuts=LUMA_CUTS) -> list[dict[str, Any]]:
    """Ink per 10k of every image page with the NEUTRAL luma cut (ink.NEUTRAL_INK_Y,
    180) moved, the tinted cut kept: where do blank pages start to pick up
    show-through, and how much more of a faint page counts? Calibration only."""
    out = []
    for pn, files in sorted(pass_files.items()):
        for i, p in enumerate(files):
            if kind_of(p) != "IMAGE":
                continue
            rgb, native = _native_rgb(p)
            rgb = pages._resize_to(rgb, pages.ink_dpi(native) / native)
            y, t = ink.luma(rgb), ink.tinted(rgb)
            h, w = y.shape
            by, bx = int(round(h * ink.BORDER_FRAC)), int(round(w * ink.BORDER_FRAC))
            inner = np.zeros((h, w), bool)
            inner[by:h - by, bx:w - bx] = True
            tinted_ink = t & (y < ink.TINTED_INK_Y) & inner
            row = {"ref": f"p{pn}.{i}", "at": {}}
            for c in cuts:
                m = ((~t & (y < c) & inner) | tinted_ink)
                row["at"][str(c)] = {"ink": round(ink.ink_per_10k(m), 3),
                                     "blob_mm2": round(ink.largest_blob_mm2(m, pages.ink_dpi(native)), 2)}
            out.append(row)
    return out


# ── local build (scan_build with the network served by a MockTransport) ─────

async def build_local(result: dict[str, Any], plan: dict[str, Any], pass_files: dict[int, list[Path]],
                      out_dir: Path) -> list[dict[str, Any]]:
    import httpx
    from app.services.copy_check.scan_build import media_upload, service

    pages_by_ref = {p["ref"]: p for p in result["pages"]}
    by_url = {url_of(pn, i): p for pn, files in pass_files.items() for i, p in enumerate(files)}
    url_of_file = {f"{pn}-{i}": url_of(pn, i) for pn, files in pass_files.items() for i in range(len(files))}
    copies = []
    for c in plan["copies"]:
        pg = []
        for pick in c["pages"]:
            p = pages_by_ref[pick["ref"]]
            pg.append({"url": url_of_file[p["file_id"]], "kind": p["kind"], "page_index": p["page_index"],
                       "rotation": pick["rotation"], "dpi": p["dpi"]})
        copies.append({"copy_key": c["copy_key"], "file_name": c["file_name"], "pages": pg})
    out_dir.mkdir(parents=True, exist_ok=True)
    names: dict[str, str] = {}
    counter = [0]

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.method == "GET" and url in by_url:
            return httpx.Response(200, content=by_url[url].read_bytes())
        if request.method == "POST" and media_upload.SIGNED_URL_PATH in url:
            counter[0] += 1
            fid = f"replay-{counter[0]}"
            names[fid] = request.url.params.get("fileName") or f"{fid}.pdf"
            return httpx.Response(200, json={"id": fid, "url": f"{URL_BASE}/put/{fid}"})
        if request.method == "PUT" and "/put/" in url:
            fid = url.rsplit("/", 1)[-1]
            (out_dir / names.get(fid, f"{fid}.pdf")).write_bytes(request.content)
            return httpx.Response(200)
        return httpx.Response(404)

    async def no_headers():
        return {}
    real_headers = media_upload.internal_auth_headers
    media_upload.internal_auth_headers = no_headers  # never read the DB for a stubbed upload
    try:
        return await service.build_copies(copies, institute_id="scan-replay", source_id="ASSESSMENT_SCAN_STATION",
                                          session_id="scan-replay", transport=httpx.MockTransport(handler))
    finally:
        media_upload.internal_auth_headers = real_headers


# ── the run ───────────────────────────────────────────────────────────────────

def _ref(ref: str) -> tuple[int, int]:
    pn, idx = ref.strip().lstrip("p").split(".")
    return int(pn), int(idx)


def _variant_copy(path: Path, out_dir: Path, turn: bool = False, grey: bool = False) -> Path:
    """The image turned 180 degrees (a pass fed upside-down) and/or in grey (the
    scanner set to Grey instead of Colour), JPEG q95, same DPI."""
    from PIL import Image, ImageOps
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / f"{'turned_' if turn else ''}{'grey_' if grey else ''}{path.parent.name}_{path.name}"
    with Image.open(path) as im:
        dpi, _src = pages.image_dpi(im)
        im = (ImageOps.exif_transpose(im) or im).convert("RGB")
        if turn:
            im = im.rotate(180)
        if grey:
            im = im.convert("L").convert("RGB")
        im.save(dest, "JPEG", quality=95, dpi=(dpi, dpi))
    return dest


def plant_faults(pass_files: dict[int, list[Path]], swaps: list[str], drops: list[str],
                 turn: Optional[list[int]] = None, work_dir: Optional[Path] = None,
                 grey: Optional[list[int]] = None,
                 ) -> tuple[dict[int, list[Path]], dict[str, str]]:
    """Fault planting on real scans (image files only, one page each):
    --swap p2.0=p1.5 trades two pages between or within the passes (a sheet
    turned over in the pile: its front lands in the backs pass);
    --drop p2.1 removes a page (a double-feed or a skipped sheet; drop one
    page from each pass to keep the counts equal); --turn 2 feeds a whole pass
    upside-down and --grey 2 scans it in grey (applied first). Returns the new lists and {new ref: original
    ref}, the original ref ending in '^' when the page was turned."""
    tagged = {pn: [(p, f"p{pn}.{i}") for i, p in enumerate(files)] for pn, files in pass_files.items()}
    for pn in sorted(set(turn or []) | set(grey or [])):
        if any(kind_of(p) != "IMAGE" for p, _o in tagged[pn]):
            raise SystemExit("--turn / --grey work on image passes only")
        wd = work_dir or Path(os.getenv("TMPDIR", "/tmp")) / "scan_replay_variants"
        t, g = pn in (turn or []), pn in (grey or [])
        tagged[pn] = [(_variant_copy(p, wd, t, g), o + ("^" if t else "")) for p, o in tagged[pn]]
    for sw in swaps:
        a, b = sw.split("=")
        (pa, ia), (pb, ib) = _ref(a), _ref(b)
        tagged[pa][ia], tagged[pb][ib] = tagged[pb][ib], tagged[pa][ia]
    gone = {_ref(d) for d in drops}
    for pn in tagged:
        tagged[pn] = [t for i, t in enumerate(tagged[pn]) if (pn, i) not in gone]
    files = {pn: [p for p, _o in items] for pn, items in tagged.items()}
    origin = {f"p{pn}.{i}": o for pn, items in tagged.items() for i, (_p, o) in enumerate(items)}
    return files, origin


def resolve_pass_dirs(args, exp: Optional[dict[str, Any]]) -> dict[int, Path]:
    if args.pass1 and args.pass2:
        return {1: Path(args.pass1), 2: Path(args.pass2)}
    if exp and args.fixtures_dir:
        return {int(k): Path(args.fixtures_dir) / v for k, v in exp["pass_dirs"].items()}
    raise SystemExit("give --pass1 and --pass2, or --fixtures-dir with --expected")


def check_fixture_files(pass_files: dict[int, list[Path]], exp: dict[str, Any]) -> list[str]:
    problems = []
    for pn, want in exp.get("files", {}).items():
        got = pass_files.get(int(pn), [])
        if [p.name for p in got] != [w["name"] for w in want]:
            problems.append(f"pass {pn}: files {[p.name for p in got]} != {[w['name'] for w in want]}")
            continue
        for p, w in zip(got, want):
            if w.get("sha256") and sha256_file(p) != w["sha256"]:
                problems.append(f"pass {pn}: {p.name} is not the recorded file (sha256 differs)")
    return problems


def run(pass_files: dict[int, list[Path]], *, llm_mode: str = "expected", exp: Optional[dict[str, Any]] = None,
        reads: Optional[dict[str, dict[str, Any]]] = None, real_llm: Any = None, model: str = "replay",
        workers: int = 2, matrix: bool = False, origin: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """Analyse one load in-process and gather the calibration report."""
    s = config.settings()
    t0 = time.perf_counter()
    features = compute_features(pass_files, workers)
    t_feat = time.perf_counter() - t0
    index = strip_index(pass_files, features)
    if origin:
        # answer each strip as the model would have for the page it really is
        def remap(k: str) -> str:
            ref, way = k.rsplit(".", 1)
            org = origin.get(ref, ref)
            if org.endswith("^"):        # a turned page: its 'down' strip is the real top
                org, way = org[:-1], ("down" if way == "up" else "up")
            return f"{org}.{way}"
        index = {b: remap(k) for b, k in index.items()}
    if llm_mode == "model":
        llm = RecordingLLM(real_llm, index)
    else:
        table = reads if llm_mode == "reads" else (reads_from_expected(exp) if exp else {})
        llm = ReplayLLM(table or {}, index)
    memo = MemoExecutor(features)
    req = build_request(pass_files)
    t1 = time.perf_counter()
    result = asyncio.run(analyse.analyse_load(req, llm=llm, model=model, executor=memo,
                                              fetcher=local_fetcher(pass_files)))
    t_an = time.perf_counter() - t1
    from app.schemas.copy_check_scan import AnalyseLoadResponse
    AnalyseLoadResponse.model_validate(result)

    feats = _feat_by_ref(pass_files, features)
    truth_blank = set(exp["blank_pages"]) if exp and "blank_pages" in exp else None
    if truth_blank is not None and origin:
        truth_blank = {cur for cur, org in origin.items() if org.rstrip("^") in truth_blank}
    lay = memo.layout
    report: dict[str, Any] = {
        "settings": s.__dict__,
        "result": result,
        "features": {ref: {"ink": round(f.ink_per_10k, 3), "blob_mm2": round(f.blob_mm2, 3), "dpi": f.dpi}
                     for ref, f in feats.items()},
        "layout_detail": None if lay is None else {
            "hypothesis_scores": lay.hypothesis_scores,
            "rows": [{"pair_score": round(r.pair_score, 4),
                      "runner_up": None if r.runner_up is None else round(r.runner_up, 4),
                      "is_row_max": r.is_row_max, "row_max_offset": r.row_max_offset,
                      "margin": None if r.runner_up is None or r.pair_score <= 0
                      else round((r.pair_score - r.runner_up) / r.pair_score, 4)} for r in lay.rows],
            "min_row_margin": None if not lay.rows else min(
                (round((r.pair_score - r.runner_up) / r.pair_score, 4)
                 for r in lay.rows if r.runner_up is not None and r.pair_score > 0), default=None),
        },
        "blank_calibration": blank_calibration(result, feats, truth_blank, s),
        "label_sims": label_sims(result, feats),
        "plan": plan_copies(result),
        "llm": {"mode": llm_mode, "calls": llm.calls, "unknown_strips": llm.unknown},
        "timing_s": {"features": round(t_feat, 2), "analyse": round(t_an, 2),
                     "choose_layout": round(memo.layout_seconds, 2)},
    }
    if matrix:
        report["matrix"] = full_matrix(result, feats)
    if llm_mode == "model":
        report["recorded_reads"] = llm.recorded
    return report


def compare_expected(report: dict[str, Any], exp: dict[str, Any]) -> list[str]:
    """Differences between a run and the fixture's truth (empty = reproduced)."""
    bad: list[str] = []
    r = report["result"]
    lay = r.get("layout") or {}
    for k, v in exp["layout"].items():
        if lay.get(k) != v:
            bad.append(f"layout.{k}: {lay.get(k)!r} != {v!r}")
    sheets = {s["sheet_no"]: s for s in r.get("sheets") or []}
    for front, back in exp["pairs"].items():
        s = sheets.get(int(front))
        if s is None or s["back"] != back:
            bad.append(f"sheet {front}: back {None if s is None else s['back']} != {back}")
        elif not s["pair_is_row_max"]:
            bad.append(f"sheet {front}: pair is not its row max")
    labels = {str(i) for i, s in sheets.items() if s["label_present"]}
    if labels != set(exp["labels"]):
        bad.append(f"labelled fronts {sorted(labels)} != {sorted(exp['labels'])}")
    cls = {p["ref"]: p["blank_class"] for p in r["pages"]}
    for ref, want in exp["page_classes"].items():
        if cls.get(ref) != want:
            bad.append(f"{ref}: class {cls.get(ref)} != {want}")
    codes = {f["code"] for f in r["flags"]}
    for c in exp.get("flags_absent", []):
        if c in codes:
            bad.append(f"flag {c} raised")
    if r["status"] not in exp.get("status_any_of", [r["status"]]):
        bad.append(f"status {r['status']} not in {exp['status_any_of']}")
    plan = report["plan"]
    got = [{"name": c["name_text"], "pages": [p["ref"] for p in c["pages"]],
            "left_out": [p["ref"] for p in c["left_out"]]} for c in plan["copies"]]
    want = [{"name": c["name"], "pages": c["pages"], "left_out": c["left_out"]} for c in exp["copies"]]
    if got != want:
        bad.append(f"copies {got} != {want}")
    pe = exp.get("planner", {})
    for k in ("direction", "direction_source"):
        if k in pe and plan[k] != pe[k]:
            bad.append(f"planner {k}: {plan[k]} != {pe[k]}")
    if "session_flags" in pe and plan["session_flags"] != pe["session_flags"]:
        bad.append(f"planner session flags {plan['session_flags']} != {pe['session_flags']}")
    return bad


def _fmt(v: Any, w: int = 7) -> str:
    if v is None:
        return "-".rjust(w)
    if isinstance(v, float):
        return f"{v:{w}.3f}"
    return str(v).rjust(w)


def print_report(rep: dict[str, Any], out=sys.stdout) -> None:
    p = lambda *a: print(*a, file=out)  # noqa: E731
    r = rep["result"]
    s = rep["settings"]
    p(f"status {r['status']}  model calls {rep['llm']['calls']}  timing {rep['timing_s']}")
    p(f"thresholds: blank_ink {s['blank_ink']}  unsure_ink {s['unsure_ink']}  blob_mm2 {s['blob_mm2']}  "
      f"order_min_margin {s['order_min_margin']}  label_sim_min {s['label_sim_min']}  back_label_sim {s['back_label_sim']}")
    lay = r.get("layout")
    p(f"layout {lay}")
    ld = rep.get("layout_detail")
    if ld:
        p(f"hypotheses {ld['hypothesis_scores']}")
    p("\npages: ref       dpi  src      ink/10k  blob mm2  class")
    for pg in r["pages"]:
        f = rep["features"].get(pg["ref"], {})
        p(f"  {pg['ref']:<8}{pg['dpi']:>5}  {pg['dpi_source']:<7}{_fmt(f.get('ink'), 9)}{_fmt(f.get('blob_mm2'), 10)}  "
          f"{pg['blank_class']}{'  ERR ' + pg['error'] if pg['error'] else ''}")
    if r["sheets"]:
        p("\nsheets: no front  back   pair   runner  margin  rowmax  label  name            tmpl_sim back_like")
        rows = (ld or {}).get("rows") or [{}] * len(r["sheets"])
        for sh, row in zip(r["sheets"], rows):
            p(f"  {sh['sheet_no']:>3} {sh['front']:<6}{sh['back']:<6}{_fmt(sh['pair_score'])}{_fmt(sh['pair_runner_up'])}"
              f"{_fmt(row.get('margin'))}  {str(sh['pair_is_row_max']):<6}  {str(sh['label_present']):<5}  "
              f"{(sh['name_text'] or '-')[:15]:<15}{_fmt(sh['label_template_sim'])}  {sh['back_label_like']}")
    p("\nflags:")
    for f in r["flags"]:
        p(f"  {f['severity']:<6} {f['code']:<20} sheet {f['sheet_no']}  {f['detail']}")
    bc = rep["blank_calibration"]
    p(f"\nblank calibration ({bc['basis']}): {json.dumps({k: v for k, v in bc.items() if k != 'basis'})}")
    if rep.get("label_sims"):
        p(f"label sims: {json.dumps(rep['label_sims'])}")
    if rep.get("matrix"):
        m = rep["matrix"]
        p("\nfull show-through matrix (rows = fronts, cols = backs in scan order; * = chosen partner):")
        for i, row in enumerate(m["matrix"]):
            p("  F%-2d " % i + " ".join(f"{v:6.3f}{'*' if j == m['partner'][i] else ' '}" for j, v in enumerate(row)))
        p(f"  row lead {m['row_lead']}\n  col lead {m['col_lead']}\n  min pair {m['min_pair']}  max off {m['max_off']}")
    pl = rep["plan"]
    p(f"\nplanner port: direction {pl['direction']} ({pl['direction_source']})  session flags {pl['session_flags']}")
    for c in pl["copies"]:
        p(f"  {c['copy_key']:<7} {(c['name_text'] or '-'):<15} sheets {c['sheets']}  pages {[x['ref'] for x in c['pages']]}"
          f"  left out {[x['ref'] for x in c['left_out']]}  {c['flags'] or ''}")
    if rep.get("cut_profile"):
        p("\nneutral luma cut profile (ink/10k, largest blob mm2; production cut = %d):" % ink.NEUTRAL_INK_Y)
        for row in rep["cut_profile"]:
            p(f"  {row['ref']:<8} " + "  ".join(f"Y<{c} {v['ink']:8.2f}/{v['blob_mm2']:6.1f}" for c, v in row["at"].items()))
    for key in ("dpi_sweep", "fade_sweep"):
        if rep.get(key):
            p(f"\n{key}:")
            for row in rep[key]:
                head = row.get("ref") or f"factor {row['factor']} (darkest Y {row['darkest_luma']})"
                p(f"  {head:<28} " + "  ".join(f"{d}dpi {v['ink']:.2f}/{v['blob_mm2']:.1f}mm2 {v['class']}"
                                               for d, v in row["at"].items()))
    if rep.get("build"):
        p(f"\nbuild: {rep['build']}")
    if "expected_problems" in rep:
        probs = rep["expected_problems"]
        p("\nexpected: " + ("REPRODUCED" if not probs else "DIFFERS:\n  " + "\n  ".join(probs)))


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pass1"), ap.add_argument("--pass2")
    ap.add_argument("--fixtures-dir", default=os.getenv("SCAN_FIXTURES_DIR"))
    ap.add_argument("--expected", help="fixture truth JSON (also the default model answers)")
    ap.add_argument("--order", choices=("suffix", "name", "mtime"), default="suffix")
    ap.add_argument("--reads", help="replay recorded model answers from this JSON")
    ap.add_argument("--model", help="call the REAL vision model (needs the ai_service env and database)")
    ap.add_argument("--record", help="with --model: save the answers here for later --reads")
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--matrix", action="store_true", help="also score the full n x n show-through matrix")
    ap.add_argument("--dpi-sweep", default="", help="e.g. 100,150,200: ink re-measured as if scanned at each DPI")
    ap.add_argument("--fade", action="store_true", help="fade the faintest written page toward the paper")
    ap.add_argument("--cuts", action="store_true", help="ink per page with the neutral luma cut moved (170..220)")
    ap.add_argument("--swap", action="append", default=[], help="plant a fault: trade two pages, e.g. p2.0=p1.5")
    ap.add_argument("--drop", action="append", default=[], help="plant a fault: remove a page, e.g. p2.1")
    ap.add_argument("--turn", action="append", type=int, default=[], help="plant a fault: feed pass N upside-down")
    ap.add_argument("--grey", action="append", type=int, default=[], help="plant a fault: pass N scanned in grey")
    ap.add_argument("--build-out", help="build the copy PDFs here (uploads stubbed)")
    ap.add_argument("--json", help="write the full report here")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)

    exp = json.loads(Path(args.expected).read_text()) if args.expected else None
    dirs = resolve_pass_dirs(args, exp)
    pass_files = {pn: list_pass(d, args.order) for pn, d in dirs.items()}
    if exp:
        problems = check_fixture_files(pass_files, exp)
        if problems:
            print("fixture files differ from the expected file:\n  " + "\n  ".join(problems), file=sys.stderr)
            return 2

    origin = None
    if args.swap or args.drop or args.turn or args.grey:
        out_dir = Path(args.json).parent if args.json else None
        pass_files, origin = plant_faults(pass_files, args.swap, args.drop, args.turn, grey=args.grey,
                                          work_dir=None if out_dir is None else out_dir / "variants")
        print(f"planted: swap {args.swap} drop {args.drop} turn {args.turn} grey {args.grey}; now pass 1 = "
              f"{[p.name for p in pass_files[1]]}, pass 2 = {[p.name for p in pass_files[2]]}")

    real_llm, model, mode, reads = None, "replay", "expected" if exp else "none", None
    if args.reads:
        mode, reads = "reads", json.loads(Path(args.reads).read_text()).get("reads", {})
    if args.model:
        from app.db import db_session
        from app.services.copy_check.scan.header_read import make_llm
        mode, model = "model", args.model
        ctx = db_session()
        real_llm = make_llm(ctx.__enter__())

    rep = run(pass_files, llm_mode=mode, exp=exp, reads=reads, real_llm=real_llm, model=model,
              workers=args.workers, matrix=args.matrix, origin=origin)
    s = config.settings()
    dpis = [float(x) for x in args.dpi_sweep.split(",") if x.strip()]
    if dpis:
        rep["dpi_sweep"] = dpi_sweep(pass_files, dpis, s)
    if args.fade:
        fw = (rep["blank_calibration"].get("faintest_written") or {}).get("ref")
        if fw:
            pn, idx = (int(x) for x in fw[1:].split("."))
            path = pass_files[pn][idx]
            if kind_of(path) == "IMAGE":
                rep["fade_sweep"] = fade_sweep(path, sorted(set(dpis + [300.0])), s)
                rep["fade_ref"] = fw
    if args.cuts:
        rep["cut_profile"] = cut_profile(pass_files)
    if args.build_out and rep["plan"]["copies"]:
        t = time.perf_counter()
        rep["build"] = asyncio.run(build_local(rep["result"], rep["plan"], pass_files, Path(args.build_out)))
        rep["timing_s"]["build"] = round(time.perf_counter() - t, 2)
    if exp and origin is None:
        rep["expected_problems"] = compare_expected(rep, exp)
    if args.record and mode == "model":
        Path(args.record).write_text(json.dumps({"reads": rep.get("recorded_reads", {})}, indent=1))
    print_report(rep)
    if args.json:
        Path(args.json).write_text(json.dumps(rep, indent=1, default=str))
    return 1 if rep.get("expected_problems") else 0


if __name__ == "__main__":
    sys.exit(main())
