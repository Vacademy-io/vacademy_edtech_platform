"""Diagram quality gate (engagement review, item 2).

A model-drawn SVG is checked for the things a learner notices: the canvas
size, labels that fall off the edge or overlap, shapes with no fill, and text
wider than the shape it sits in. Every problem goes back to the model once
(soft round); only STRUCTURAL problems — unparseable markup, no shapes, a
label with no position or off the canvas — cause the diagram to be replaced
by `auto_layout_svg`, a clean boxes-and-arrows drawing built from the op's
`parts`, so the board never shows a broken picture but a merely imperfect
one is kept.
"""
from __future__ import annotations

import hashlib
import html
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple
from xml.etree import ElementTree as ET

CANVAS_W, CANVAS_H = 640, 360
MARGIN = 24
# Average glyph width as a fraction of font size for the board's sans face.
CHAR_W = 0.56
DEFAULT_FONT = 16.0
MIN_LABEL_FONT = 15.0
MAX_ERRORS = 8
_XML_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}

_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def _f(v: Optional[str], default: float = 0.0) -> float:
    if v is None:
        return default
    m = _NUM.search(str(v))
    return float(m.group(0)) if m else default


def _tag(el: ET.Element) -> str:
    return el.tag.split("}")[-1]


def _normalise(body: str) -> str:
    """What browsers and nh3 accept but ElementTree does not: HTML entities
    (&rarr; &nbsp; &times;) and an undeclared xlink: prefix."""
    body = re.sub(r"&([a-zA-Z][a-zA-Z0-9]*);",
                  lambda m: m.group(0) if m.group(1) in _XML_ENTITIES else html.unescape(m.group(0)), body)
    body = re.sub(r"&(?![a-zA-Z#][a-zA-Z0-9]*;)", "&amp;", body)
    return body.replace("xlink:href", "href").replace(" xmlns:xlink=", " data-xlink=")


def _parse(svg: str) -> Optional[ET.Element]:
    body = (svg or "").strip()
    if not body:
        return None
    for candidate in (body, _normalise(body)):
        try:
            return ET.fromstring(candidate)
        except ET.ParseError:
            continue
    return None


def _font_size(el: ET.Element, inherited: float) -> float:
    fs = el.get("font-size")
    return _f(fs, inherited) if fs else inherited


def _svg_problems(svg: str) -> List[Tuple[bool, str]]:
    """(structural, message) pairs."""
    root = _parse(svg)
    if root is None or _tag(root) != "svg":
        return [(True, "svg is not well-formed XML")]
    out: List[Tuple[bool, str]] = []
    vb = root.get("viewBox") or root.get("viewbox") or ""
    nums = [float(x) for x in _NUM.findall(vb)]
    if len(nums) != 4:
        out.append((False, "svg needs viewBox='0 0 640 360'"))
        w, h = float(CANVAS_W), float(CANVAS_H)
    else:
        w, h = nums[2], nums[3]
        if w < 400 or h < 200 or not (1.2 <= w / max(h, 1) <= 2.4):
            out.append((False, f"svg viewBox is {int(w)}x{int(h)}; draw on 640x360 (a wide board), not a strip or a square"))

    # fill inherits from ancestors (a <g fill=...> paints its children)
    parent: Dict[ET.Element, ET.Element] = {c: p for p in root.iter() for c in p}

    def inherited(el: ET.Element, attr: str) -> Optional[str]:
        node: Optional[ET.Element] = el
        while node is not None:
            v = node.get(attr)
            if v:
                return v
            node = parent.get(node)
        return None

    texts: List[Tuple[float, float, float, float, str]] = []   # x0, y0, x1, y1, label
    shapes = 0
    unfilled = 0
    for el in root.iter():
        t = _tag(el)
        if t in ("rect", "circle", "ellipse", "polygon", "path"):
            shapes += 1
            fill = (inherited(el, "fill") or "").strip().lower()
            stroke = (inherited(el, "stroke") or "").strip().lower()
            if t in ("rect", "circle", "ellipse", "polygon") and (not fill or fill == "none") and not stroke:
                unfilled += 1
        if t == "text":
            label = "".join(el.itertext()).strip()
            if not label:
                continue
            spans = [c for c in el if _tag(c) == "tspan"]
            positioned = el.get("y") is not None or el.get("transform") or inherited(el, "transform") or any(s.get("y") is not None for s in spans)
            if not positioned:
                out.append((True, f"text '{label[:24]}' has no y coordinate (it lands on the top edge)"))
                continue
            if el.get("y") is None and (el.get("transform") or inherited(el, "transform")):
                continue   # placed by a transform: geometry unknown, leave it
            x = _f(el.get("x") or (spans[0].get("x") if spans else None))
            y = _f(el.get("y") or (spans[0].get("y") if spans else None))
            fs = _font_size(el, DEFAULT_FONT)
            lines = [(s.text or "").strip() for s in spans if (s.text or "").strip()]
            width = max([len(ln) for ln in lines] or [len(label)]) * fs * CHAR_W
            height = fs * max(1, len(lines))
            anchor = (inherited(el, "text-anchor") or "start").lower()
            x0 = x - width / 2 if anchor == "middle" else x - width if anchor == "end" else x
            x1 = x0 + width
            if fs < MIN_LABEL_FONT:
                out.append((False, f"label '{label[:24]}' is {fs:g}px; labels must be 16-22px to be readable"))
            if x0 < 0 or x1 > w or y - fs < 0 or y > h:
                out.append((True, f"label '{label[:24]}' runs outside the canvas (x {int(x0)}..{int(x1)}, y {int(y)})"))
            texts.append((x0, y - fs, x1, y - fs + height, label))
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            a, b = texts[i], texts[j]
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                out.append((False, f"labels '{a[4][:18]}' and '{b[4][:18]}' overlap; move one or shorten it"))
                break
    if shapes == 0:
        out.append((True, "svg has no shapes; a diagram needs boxes, circles or paths, not only text"))
    elif unfilled >= max(2, shapes // 2):
        out.append((False, "most shapes have no fill and no stroke; give shapes a soft fill and a darker stroke"))
    return out[:MAX_ERRORS]


def check_svg_geometry(svg: str, parts: Sequence[Dict[str, Any]] = ()) -> List[str]:
    """Every problem with a diagram (for the model's repair round)."""
    return [m for _s, m in _svg_problems(svg)]


def structural_svg_errors(svg: str) -> List[str]:
    """Only the problems that make a diagram unusable (for the fallback)."""
    return [m for s, m in _svg_problems(svg) if s]


# ── fallback drawing ─────────────────────────────────────────────────────────

_FILLS = ["#DBEAFE", "#DCFCE7", "#FEF3C7", "#FCE7F3", "#E0E7FF", "#D1FAE5"]
_STROKES = ["#1D4ED8", "#15803D", "#B45309", "#BE185D", "#4338CA", "#047857"]


def auto_layout_svg(title: str, parts: Sequence[Dict[str, Any]], *, flow: bool = True) -> Tuple[str, List[Dict[str, Any]]]:
    """A clean diagram from the parts a teacher would point at: labelled
    rounded boxes in a row (or a grid), joined by arrows when `flow`. Returns
    the svg and the parts list with the ids the drawing actually uses."""
    labels = [str(p.get("label") or p.get("id") or "").strip() for p in parts if isinstance(p, dict) and str(p.get("label") or p.get("id") or "").strip()]
    parts = [p for p in parts if isinstance(p, dict) and str(p.get("label") or p.get("id") or "").strip()]
    labels = labels[:6] or [title[:28] or "Idea"]
    n = len(labels)
    cols = n if n <= 3 else 3
    rows = (n + cols - 1) // cols
    gap = 40
    box_w = min(180, int((CANVAS_W - 2 * MARGIN - gap * (cols - 1)) / cols))
    box_h = 64 if rows > 1 else 80
    total_w = cols * box_w + (cols - 1) * gap
    x_start = (CANVAS_W - total_w) / 2
    total_h = rows * box_h + (rows - 1) * gap
    y_start = (CANVAS_H - total_h) / 2 + (14 if title else 0)
    marker = "al-" + hashlib.sha1(f"{title}|{'|'.join(labels)}".encode("utf-8")).hexdigest()[:8]
    out = [f"<svg viewBox='0 0 {CANVAS_W} {CANVAS_H}'>",
           f"<defs><marker id='{marker}' markerWidth='10' markerHeight='10' refX='9' refY='5' orient='auto'>"
           "<path d='M0,0 L10,5 L0,10 z' fill='#475569'/></marker></defs>"]
    if title:
        out.append(f"<text x='{CANVAS_W // 2}' y='34' text-anchor='middle' font-size='20' font-weight='bold' fill='#1E293B'>{html.escape(title[:40])}</text>")
    used: List[Dict[str, Any]] = []
    centers = []
    for i, label in enumerate(labels):
        r, c = divmod(i, cols)
        x = x_start + c * (box_w + gap)
        y = y_start + r * (box_h + gap)
        pid = re.sub(r"[^A-Za-z0-9_-]", "-", str(parts[i].get("id") if i < len(parts) and parts[i].get("id") else f"part-{i + 1}"))
        label = label[:30].strip()
        fs = 18 if len(label) * 18 * CHAR_W <= box_w - 16 else 16
        cx = x + box_w / 2
        words = label.split()
        if len(label) * fs * CHAR_W > box_w - 16 and len(words) > 1:
            # Two lines rather than a font too small to read.
            mid = min(range(1, len(words)), key=lambda k: abs(len(" ".join(words[:k])) - len(" ".join(words[k:]))))
            first, second = " ".join(words[:mid]), " ".join(words[mid:])
            text_el = (f"<text x='{cx:.0f}' y='{y + box_h / 2 - 3:.0f}' text-anchor='middle' font-size='{fs}' fill='#1E293B'>"
                       f"<tspan x='{cx:.0f}'>{html.escape(first)}</tspan><tspan x='{cx:.0f}' dy='{fs + 2}'>{html.escape(second)}</tspan></text>")
        else:
            text_el = f"<text x='{cx:.0f}' y='{y + box_h / 2 + fs / 3:.0f}' text-anchor='middle' font-size='{fs}' fill='#1E293B'>{html.escape(label)}</text>"
        out.append(f"<g id='{pid}'><rect x='{x:.0f}' y='{y:.0f}' width='{box_w}' height='{box_h}' rx='10' fill='{_FILLS[i % 6]}' stroke='{_STROKES[i % 6]}' stroke-width='2'/>{text_el}</g>")
        used.append({"id": pid, "label": label, "step": int(parts[i].get("step") or 0) if i < len(parts) else 0})
        centers.append((x, y, x + box_w, y + box_h))
    if flow:
        for i in range(1, n):
            a, b = centers[i - 1], centers[i]
            if divmod(i - 1, cols)[0] == divmod(i, cols)[0]:
                out.append(f"<line x1='{a[2]:.0f}' y1='{(a[1] + a[3]) / 2:.0f}' x2='{b[0] - 4:.0f}' y2='{(b[1] + b[3]) / 2:.0f}' stroke='#475569' stroke-width='2' marker-end='url(#{marker})'/>")
            else:
                out.append(f"<line x1='{(a[0] + a[2]) / 2:.0f}' y1='{a[3]:.0f}' x2='{(b[0] + b[2]) / 2:.0f}' y2='{b[1] - 4:.0f}' stroke='#475569' stroke-width='2' marker-end='url(#{marker})'/>")
    out.append("</svg>")
    return "".join(out), used
