"""The evaluation table printed on an answer sheet, filled in by the checker.

A sheet that marks by a deduction scheme (see deduction_scheme.py) usually
prints a table on its first page for the examiner: per part of the paper, how
many mistakes of each symbol, marks deducted, marks obtained, percentage,
remarks. The checked copy fills it in, in the same red pen.

Finding the cells: the OCR rows cannot do it - it merges a table's printed
header into one row ("S.N. Code Part 1/2 Marks 1/2 Marks 5 Marks deducted
obtained"). The ruled lines can: the page image gives the table's horizontal
and vertical rules, hence its cells, and one look by the language model at the
table tells which column is which ("count of X", "marks obtained") and the
part label of each row. When the table cannot be found the figures go in a
small table of their own in the largest blank stretch of the last page.
"""
from __future__ import annotations

import io
import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# A printed row that belongs to an evaluation table.
_TABLE_WORDS = re.compile(r"marks\s+deducted|deducted|obtained|no\.?\s*of\s+mistakes|evaluation\s+sheet", re.I)
# Ink: this much darker (0-255) than the paper around it.
_CONTRAST = 28
# A horizontal rule covers this share of the search box's width; a vertical
# rule this share of a part row's height. A full-width rule covers this share
# of the widest rule's width.
_H_RULE = 0.45
_V_RULE = 0.75
_FULL_SHARE = 0.6
# Rules are thin; a run thicker than this is a line of writing.
_MAX_RULE_PX = 16
# Rows / columns of slack for a rule that is not quite level.
_SLACK = 4
ROLES = ("sn", "code", "part", "count", "deducted", "obtained", "percent", "remarks", "other")

TABLE_PROMPT = """This image is a printed evaluation table from an answer sheet, with columns separated by
vertical rules. List its columns from left to right as they are ruled on the page, and the label of
each part row that the examiner fills in (top to bottom, e.g. "A", "B").

Column roles: sn (serial number), code, part (the part label), count (number of mistakes of one kind -
give the mark symbol printed in that column, e.g. "X", "/", "#"), deducted (marks deducted), obtained
(marks obtained), percent, remarks, other.

Return STRICT JSON only:
{"columns": [{"role": "sn"}, {"role": "count", "symbol": "/"}, ...], "parts": ["A", "B"]}"""


# --------------------------------------------------------------- geometry

def _runs(flags: list[bool], min_len: int = 1) -> list[tuple[int, int]]:
    out, start = [], None
    for i, f in enumerate(list(flags) + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                out.append((start, i))
            start = None
    return out


def dark_mask(gray: Any) -> Any:
    """Ink and printed rules as a boolean array. Against the page's own local
    background, not a fixed grey: a phone photo of a sheet is grey and shaded,
    and its printed rules are a faint grey on it."""
    import numpy as np
    from PIL import ImageFilter

    bg = np.asarray(gray.filter(ImageFilter.GaussianBlur(15)), dtype=np.int16)
    return np.asarray(gray, dtype=np.int16) < bg - _CONTRAST


def _thin_runs(cover: Any, threshold: float) -> list[tuple[float, float]]:
    """(centre, cover) of each run above `threshold` no thicker than a ruled
    line - a line of writing is a thick run and is not a rule."""
    out = []
    for a, b in _runs([c >= threshold for c in cover]):
        if b - a <= _MAX_RULE_PX:
            out.append(((a + b - 1) / 2.0, float(max(cover[a:b]))))
    return out


def h_rules(dark: Any) -> list[tuple[float, float]]:
    """(y, share of the width covered) of every horizontal rule."""
    import numpy as np

    h = dark.shape[0]
    if h <= _SLACK:
        return []
    # A rule on a photographed page is not quite level: a few rows of slack.
    band = np.logical_or.reduce([dark[i:h - _SLACK + i] for i in range(_SLACK + 1)])
    cover = band.mean(axis=1)
    return [(y + _SLACK / 2.0, c) for y, c in _thin_runs(list(cover), _H_RULE)]


def v_rules(dark: Any, top: int, bottom: int) -> list[float]:
    """x of every vertical rule that runs from `top` to `bottom`."""
    import numpy as np

    region = dark[max(0, top):bottom]
    w = region.shape[1] if region.ndim == 2 else 0
    if region.size == 0 or w <= _SLACK:
        return []
    band = np.logical_or.reduce([region[:, i:w - _SLACK + i] for i in range(_SLACK + 1)])
    cover = band.mean(axis=0)
    return [x + _SLACK / 2.0 for x, _c in _thin_runs(list(cover), _V_RULE)]


def grid(dark: Any) -> tuple[list[tuple[float, float]], list[float]]:
    """(the table's row bands top to bottom, the vertical rules of its last
    row) in the mask's pixels. A row band lies between two full-width rules
    and is crossed by column rules; the band between a table and the page's
    own border is not, which is how the table's foot is told from that
    border. The short rule under a grouped header ("No. of Mistakes made") is
    not full width and is left out."""
    hs = h_rules(dark)
    if len(hs) < 2:
        return [], []
    widest = max(c for _y, c in hs)
    full = sorted(y for y, c in hs if c >= _FULL_SHARE * widest)
    runs: list[list[tuple[float, float, list[float]]]] = [[]]
    for y0, y1 in zip(full[:-1], full[1:]):
        vs = v_rules(dark, int(y0) + _SLACK, int(y1) - _SLACK) if y1 - y0 > 3 * _SLACK else []
        if len(vs) >= 3:
            runs[-1].append((y0, y1, vs))
        elif runs[-1]:
            runs.append([])
    table = max(runs, key=len)
    if not table:
        return [], []
    # Column rules: those of every row merged - a rounded corner or a cell
    # spanning two rows hides one in some rows - and only within the reach of
    # the table's own horizontal rules (the page's border is ruled too).
    left, right = _reach(dark, [y for y0, y1, _vs in table for y in (y0, y1)])
    merged: list[float] = []
    for x in sorted(x for _y0, _y1, vs in table for x in vs):
        if not left - 2 * _SLACK <= x <= right + 2 * _SLACK:
            continue
        if merged and x - merged[-1] <= 2 * _SLACK:
            continue
        merged.append(x)
    return [(y0, y1) for y0, y1, _vs in table], merged


def _reach(dark: Any, ys: list[float]) -> tuple[float, float]:
    """The left and right end of the horizontal rules at `ys`."""
    import numpy as np

    h = dark.shape[0]
    lo, hi = None, None
    for y in ys:
        rows = dark[max(0, int(y) - _SLACK):min(h, int(y) + _SLACK + 1)]
        xs = np.where(rows.any(axis=0))[0]
        if xs.size == 0:
            continue
        # The run of the rule, not stray ink: the longest stretch with gaps
        # under 3 * _SLACK.
        gaps = np.where(np.diff(xs) > 3 * _SLACK)[0]
        starts = np.concatenate(([0], gaps + 1))
        ends = np.concatenate((gaps, [xs.size - 1]))
        k = int(np.argmax(xs[ends] - xs[starts]))
        a, b = float(xs[starts[k]]), float(xs[ends[k]])
        lo = a if lo is None else min(lo, a)
        hi = b if hi is None else max(hi, b)
    return (lo or 0.0), (hi or float(dark.shape[1]))


def table_box(page: dict[str, Any]) -> Optional[tuple[int, int, int, int]]:
    """Where to look for the table: around the printed rows that name it, in
    layout pixels (left, top, right, bottom)."""
    hits = [ln for ln in page.get("lines") or [] if ln.get("printed") and isinstance(ln.get("box"), (list, tuple))
            and len(ln["box"]) == 4 and _TABLE_WORDS.search(str(ln.get("text") or ""))]
    if not hits:
        return None
    w, h = float(page.get("width") or 0), float(page.get("height") or 0)
    if w <= 0 or h <= 0:
        return None
    top = min(float(ln["box"][1]) for ln in hits)
    # The table runs down from its title over a few part rows; it never
    # spans more than ~35% of the page.
    return 0, max(0, int(top - 0.03 * h)), int(w), min(int(h), int(top + 0.35 * h))


def cells(bands: list[tuple[float, float]], vs: list[float], n_parts: int) -> list[list[tuple[float, float, float, float]]]:
    """Per part row (the last n_parts row bands), its cells left to right."""
    xs = sorted(vs)
    if len(bands) < n_parts or len(xs) < 2 or n_parts < 1:
        return []
    return [[(a, top, b, bottom) for a, b in zip(xs[:-1], xs[1:])] for top, bottom in bands[-n_parts:]]


def parse_layout(content: str) -> tuple[list[dict[str, Any]], list[str]]:
    text = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", (content or "").strip())
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return [], []
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return [], []
    cols = [c for c in data.get("columns") or [] if isinstance(c, dict)]
    parts = [str(p).strip() for p in data.get("parts") or [] if str(p).strip()]
    return cols, parts


def assign(columns: list[dict[str, Any]], row_cells: list[tuple], row: dict[str, Any]) -> list[tuple[tuple, str]]:
    """(cell, text) for one part row of the table data (deduction_scheme.table_rows)."""
    if len(columns) != len(row_cells):
        return []
    out = []
    for col, cell in zip(columns, row_cells):
        role = str(col.get("role") or "").strip().lower()
        text = None
        if role == "count":
            sym = str(col.get("symbol") or "").strip()
            if row.get("paragraph_wise"):
                text = "-"
            elif sym in row["counts"]:
                text = str(row["counts"][sym])
        elif role == "deducted":
            text = _fmt(row["deducted"])
        elif role == "obtained":
            text = _fmt(row["obtained"])
        elif role == "percent":
            text = f"{_fmt(row['percent'])}%"
        elif role == "remarks" and row.get("remarks"):
            text = str(row["remarks"])
        if text is not None:
            out.append((cell, text))
    return out


def _fmt(x: Any) -> str:
    x = float(x or 0)
    return str(int(x)) if x.is_integer() else f"{x:g}"


async def locate(llm: Any, model: str, image: Any, page: dict[str, Any], n_parts: int,
                 institute_id: Optional[str] = None, token_sink: Any = None) -> Optional[dict[str, Any]]:
    """The table's part-row cells (layout pixels) and column roles, or None."""
    import base64

    box = table_box(page)
    if box is None or image is None:
        return None
    try:
        sx = image.size[0] / float(page.get("width") or image.size[0])
        sy = image.size[1] / float(page.get("height") or image.size[1])
        ibox = (int(box[0] * sx), int(box[1] * sy), int(box[2] * sx), int(box[3] * sy))
        dark = dark_mask(image.crop(ibox).convert("L"))
        bands, vs = grid(dark)
        if len(bands) < n_parts or len(vs) < 3:
            logger.info("Evaluation table: %d ruled row(s), %d column rule(s); not found", len(bands), len(vs))
            return None
        bands = [(ibox[1] + a, ibox[1] + b) for a, b in bands]
        vs = [ibox[0] + x for x in vs]
        # The whole table, header included, for the model to name the columns:
        # from a header's height above the first ruled row.
        head = max(bands[0][0] - (bands[-1][1] - bands[0][0]), ibox[1])
        crop = image.crop((int(min(vs)) - 6, int(head), int(max(vs)) + 6, int(bands[-1][1]) + 6))
        buf = io.BytesIO()
        crop.convert("RGB").save(buf, format="JPEG", quality=90)
        response = await llm.chat_completion(
            messages=[{"role": "system", "content": TABLE_PROMPT},
                      {"role": "user", "content": "The table:",
                       "attachments": [{"type": "image", "url": "data:image/jpeg;base64,"
                                        + base64.b64encode(buf.getvalue()).decode("ascii")}]}],
            temperature=0.0, max_tokens=1500, institute_id=institute_id, model=model, fallback_models=[],
        )
        if token_sink is not None:
            try:
                token_sink.add_usage(response.get("usage"))
            except Exception:
                pass
        columns, parts = parse_layout(response.get("content") or "")
        n = len(parts) or n_parts
        found = cells(bands, vs, n)
        if not found or len(columns) != len(found[0]):
            logger.info("Evaluation table: %d ruled column(s) but %d named; not filled in place",
                        len(found[0]) if found else 0, len(columns))
            return None
        # Back to layout pixels.
        found = [[(a / sx, t / sy, b / sx, d / sy) for a, t, b, d in row] for row in found]
        return {"page_id": page.get("page_id"), "columns": columns, "parts": parts[:n], "cells": found}
    except Exception:
        logger.warning("Evaluation table could not be located", exc_info=True)
        return None


# --------------------------------------------------------------- drawing

def _font():
    try:
        from .annotator import _handwriting_fontfile
        return _handwriting_fontfile()
    except Exception:
        return None


_RED = (0.78, 0.12, 0.14)


def _write(page: Any, rect: Any, text: str, size: float) -> None:
    import fitz

    fontfile = _font()
    kw = {"fontfile": fontfile, "fontname": "evalpen"} if fontfile else {"fontname": "tiro"}
    font = fitz.Font(fontfile=fontfile) if fontfile else fitz.Font("tiro")
    size = min(size, rect.height * 0.7)
    while size > 6 and font.text_length(text, fontsize=size) > rect.width - 4:
        size -= 0.5
    w = font.text_length(text, fontsize=size)
    x = rect.x0 + (rect.width - w) / 2.0
    y = rect.y0 + (rect.height + size * 0.7) / 2.0
    page.insert_text(fitz.Point(x, y), text, fontsize=size, color=_RED, **kw)


def fill(pdf_bytes: bytes, layout_map: dict[str, Any], table: dict[str, Any],
         printed_only: bool = False) -> Optional[bytes]:
    """Write the table's figures onto the checked copy: into the printed
    table when it was located, else as a small table on the last page.
    `printed_only`: None instead of the fallback when the printed table could
    not be filled."""
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages = {p.get("page_id"): (i, p) for i, p in enumerate(layout_map.get("pages") or [])}
        loc = table.get("located")
        placed = False
        if loc and loc.get("page_id") in pages:
            idx, lp = pages[loc["page_id"]]
            page = doc[idx]
            sx = page.rect.width / float(lp.get("width") or page.rect.width)
            sy = page.rect.height / float(lp.get("height") or page.rect.height)
            by_label = {str(r["part"]).strip().upper(): r for r in table["rows"]}
            labels = loc.get("parts") or [r["part"] for r in table["rows"]]
            for label, row_cells in zip(labels, loc["cells"]):
                row = by_label.get(str(label).strip().upper()[:1]) or by_label.get(str(label).strip().upper())
                if row is None:
                    continue
                for (a, t, b, d), text in assign(loc["columns"], row_cells, row):
                    _write(page, fitz.Rect(a * sx, t * sy, b * sx, d * sy), text, 14.0)
                    placed = True
        if not placed:
            if printed_only:
                return None
            placed = _compact(doc, table)
        return doc.tobytes(deflate=True, garbage=3) if placed else pdf_bytes
    finally:
        doc.close()


def _compact(doc: Any, table: dict[str, Any]) -> bool:
    """A small ruled table in the largest blank stretch of the last page."""
    import fitz
    import numpy as np

    page = doc[-1]
    syms = table["symbols"]
    header = ["Part"] + [f"No. of {s}" for s in syms] + ["Deducted", "Obtained", "%"]
    body = [[r["part"]] + ["-" if r.get("paragraph_wise") else str(r["counts"].get(s, 0)) for s in syms]
            + [_fmt(r["deducted"]), f"{_fmt(r['obtained'])}/{_fmt(r['max'])}", f"{_fmt(r['percent'])}%"]
            for r in table["rows"]]
    tot = table["total"]
    body.append(["Total"] + [str(sum(r["counts"].get(s, 0) for r in table["rows"] if not r.get("paragraph_wise")))
                             for s in syms]
                + [_fmt(sum(r["deducted"] for r in table["rows"])), f"{_fmt(tot['obtained'])}/{_fmt(tot['max'])}",
                   f"{_fmt(tot['percent'])}%"])
    row_h = 20.0
    need = row_h * (len(body) + 1) + 8
    pix = page.get_pixmap(dpi=36, colorspace=fitz.csGRAY)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    blank = (img < 150).mean(axis=1) < 0.004
    scale = page.rect.height / pix.height
    best = max(_runs(list(blank)), key=lambda r: r[1] - r[0], default=None)
    if best is None or (best[1] - best[0]) * scale < need:
        logger.info("Evaluation table: no blank space for the compact table")
        return False
    top = best[0] * scale + ((best[1] - best[0]) * scale - need) / 2.0
    width = page.rect.width * 0.8
    left = (page.rect.width - width) / 2.0
    col_w = width / len(header)
    for r, cells_ in enumerate([header] + body):
        for c, text in enumerate(cells_):
            rect = fitz.Rect(left + c * col_w, top + r * row_h, left + (c + 1) * col_w, top + (r + 1) * row_h)
            page.draw_rect(rect, color=_RED, width=0.6)
            _write(page, rect, text, 10.0 if r == 0 else 12.0)
    return True
