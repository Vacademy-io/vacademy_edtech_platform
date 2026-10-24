"""Burn the AI's corrections onto the answer sheet and upload it as a file.

Until this existed, a graded copy left no artifact: marks and feedback landed
in Postgres and the annotations stayed as JSON coordinates, drawn live in the
browser by the admin dashboard's PdfAnnotationOverlay. Every other admin screen
resolves the checked copy through student_attempt.evaluated_file_id, so those
screens showed "No evaluated copy found" on an evaluation that had in fact
completed.

This module composites the annotations onto the student's PDF and uploads the
result to media-service, returning a fileId the Java side can store on the
attempt.

Coordinates: layout_map boxes are [x, y, w, h] in PIXELS at the map's own dpi
(see render_worker/pdf_ocr/layout_ocr.py). PDF user space is points. Rather
than assuming 72/dpi, scale by the ratio of the real page rect to the layout
page's recorded width/height — that stays correct if a page was rasterized at
a different dpi than the map claims, or if pages differ in size.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import logging
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# A checked script has to read at a glance, so the mark must carry the verdict:
# green tick = credited, red cross = wrong, amber ring = partial/attention.
# Drawing one neutral box for every style would make "correct" and "wrong"
# indistinguishable, which is worse than not marking at all.
_CORRECT = (0.13, 0.55, 0.24)
# Sampled from the reference teacher hand: #903e48, a muted maroon gel, not the
# bright pillar-box red I had been using.
# Coral red, sampled off the reference: ~#D9564A.
_WRONG = (0.702, 0.239, 0.278)
_ATTENTION = (0.85, 0.45, 0.05)
_HIGHLIGHT = (0.90, 0.26, 0.21)
# Deliberately identical to _WRONG. A marker uses one pen: a second red that
# appears only under the typeset comments is what made them read as printed.
_NOTE_TEXT = (0.702, 0.239, 0.278)
_SUMMARY_HEADING = (0.11, 0.11, 0.11)

# Percentage -> grade. Ordered high to low; the first band a percentage clears
# wins. Institutes grade on different scales, so this is the fallback and any
# caller that knows the institute's own bands should pass them in.
_GRADE_BANDS = ((90.0, "A+"), (75.0, "A"), (60.0, "B"), (50.0, "C"), (40.0, "D"), (0.0, "F"))


def grade_for(percentage: float, bands=_GRADE_BANDS) -> str:
    for floor, letter in bands:
        if percentage >= floor:
            return letter
    return bands[-1][1]

# Width of the right-hand column reserved for circled per-question marks.
# Margin notes stop short of it so a comment never runs under a score.
_SCORE_GUTTER = 52.0

# Pen notes are set in italic so they read as the marker's hand, distinct from
# both the student's writing and any printed text on the sheet.
_NOTE_FONT = "tiit"  # Times-Italic (PyMuPDF base-14 alias)

# PyMuPDF's base-14 fonts are Latin-1 only. Anything outside that — an em dash,
# a rupee sign, curly quotes, the ellipsis the grading prompt asks for on long
# answers — is written as "?" in the burned PDF. Feedback about Indian contract
# law is full of exactly those characters, so a teacher was reading
# "s. 16 never appears ? and the exceptions", which looks like corrupted output.
# Transliterate to the nearest Latin-1 spelling instead of shipping "?".
_LATIN1_SUBSTITUTIONS = {
    "\u2014": " - ", "\u2013": "-", "\u2012": "-", "\u2212": "-",
    "\u2018": "'", "\u2019": "'", "\u201a": ",",
    "\u201c": '"', "\u201d": '"', "\u201e": '"',
    "\u2026": "...", "\u2022": "-", "\u00a0": " ",
    "\u20b9": "Rs.", "\u2192": "->", "\u2190": "<-",
    "\u2264": "<=", "\u2265": ">=", "\u00d7": "x",
    "\u2713": "(tick)", "\u2717": "(x)", "\u00bd": "1/2",
}


# Hand-written spacing wanders, so a drawn line is always a little wider than
# _text_width says. Every wrap calculation multiplies by this and the writer
# never exceeds it - when the two disagreed, notes were wrapped for a column
# they then overran, and long ones ran clean off the paper onto the scanner's
# white canvas. One constant keeps them honest.
_ADVANCE_SLACK = 1.12
# Faces whose letters connect. They must be written a whole word at a time or
# the joins pull apart; every other hand looks more natural set letter by
# letter, where the baseline, size and angle can vary within a word.
# Draw the marker's prose as PEN STROKES rather than setting a font. A font
# reuses one outline per character at one constant width, which is why every
# review returned "still looks typeset" however well the face was chosen and
# however the baseline was tilted: stroke-width variation measured 0.055-0.087
# against the reference hand's 0.274-0.333. Strokes carry the pressure rule -
# heavy on the pull, light on the push - and no two instances of a letter come
# out identical. Set COPY_CHECK_PEN_STROKES=0 to go back to the font.
_PEN_STROKES = os.getenv("COPY_CHECK_PEN_STROKES", "1") != "0"
# hand_render: the marking guide's own pen. Text in a handwriting face with
# per-glyph jitter, ticks and crosses as wobbly Bezier strokes, the total in
# a hand-thrown loop - drawn on a transparent raster layer and composited
# over the page, so the student's copy underneath is never touched. Every
# placement decision and every paper-boundary test above still applies; only
# the ink changes. COPY_CHECK_HAND_RENDER=0 reverts to the vector pen.
_HAND_RENDER = os.getenv("COPY_CHECK_HAND_RENDER", "1") != "0"
_PEN: list = [None]            # one hand_render.Pen per copy, seeded from it
_LINE_H: list = [None]         # the current page's typical row height, in points
_PEN_SCALE = 4.0               # raster px per PDF point on the overlay layers
_JOINED_FACES = ("snell", "savoye", "chancery", "brush", "zapfino", "roundhand")
_HW_FONTNAME = "hwnote"
# x-height/em of the print hand every size in this module was tuned against.
_REFERENCE_X_HEIGHT = 0.528
_HW_FONTSIZE = 12.5
# A pen note that does not fit beside its line stops looking like a pen note.
# Terse on purpose. A long note has to be shrunk to fit an interline gap, and
# a note written at a third of the height of the surrounding hand stops looking
# written and starts looking captioned. Real margin notes are abbreviations -
# "cite s.69", "why?", "incomplete" - so the note is kept short enough to be
# written LARGE. The full reasoning is on the summary page, where it belongs.
# A deduction now carries a 1-2 sentence explanation, not a phrase: "Partially
# correct. The final point is missing." is 46 characters on its own. Capping at
# 46 truncated exactly the notes that explain why a mark was lost. Praise stays
# short because the model writes it short, not because this forces it.
# Slack allowed when testing a mark against the paper boundary, in points.
# Matches the tolerance the row-span test has always used; the mask is
# measured at 40dpi so a cell is ~1.8pt and sub-cell overshoot is noise.
_PAPER_TOL = 1.0
_MAX_NOTE_CHARS = 110
# Below this the mark is not trustworthy enough to release unreviewed.
_REVIEW_CONFIDENCE = 0.60
_NOTE_SEARCH_RADIUS = 130.0

# A marked script should look marked BY SOMEONE. Base-14 Times-Italic reads as
# a machine caption sitting on the page; a pen font reads as a teacher. The
# font is looked up at runtime rather than bundled, so a deployment can point
# at whatever it is licensed to ship via COPY_CHECK_HANDWRITING_FONT. Falling
# back to Times-Italic keeps the render working where none is installed.
_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
# Digits only. Kalam's "1" is a bare vertical stroke - 16px against its own "l"
# at 15px - so a mark of "10" or "1.5" reads as "l0". Patrick Hand flags its 1.
_DIGIT_FONT = os.path.join(_FONT_DIR, "PatrickHand.ttf")
_HANDWRITING_FONT_CANDIDATES = (
    os.getenv("COPY_CHECK_HANDWRITING_FONT", ""),
    # Bundled and OFL-licensed, so a deployment gets the intended hand instead
    # of silently falling back to a typeset face.
    os.path.join(_FONT_DIR, "ArchitectsDaughter.ttf"),
    os.path.join(_FONT_DIR, "Kalam.ttf"),
    "/usr/share/fonts/truetype/copycheck/handwriting.ttf",
    "/usr/share/fonts/truetype/caveat/Caveat-Regular.ttf",
    # Neat, deliberate hands first. A scrawled font (Bradley Hand, Chalkduster)
    # reads as sloppy rather than as a teacher's pen, and it is the note the
    # student has to ACT on — legibility outranks character.
    "/System/Library/Fonts/Supplemental/SnellRoundhand.ttc",
    "/System/Library/Fonts/Supplemental/Apple Chancery.ttf",
    "/System/Library/Fonts/Supplemental/ChalkboardSE.ttc",
    "/System/Library/Fonts/Supplemental/Chalkboard.ttc",
    "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
)


@lru_cache(maxsize=1)
def _handwriting_fontfile() -> Optional[str]:
    for path in _HANDWRITING_FONT_CANDIDATES:
        if path and os.path.isfile(path):
            return path
    logger.info("copy-check: no handwriting font found; pen notes fall back to Times-Italic")
    return None


@lru_cache(maxsize=1)
def _handwriting_font() -> Optional[Any]:
    """A fitz.Font for measuring — get_text_length only knows the base-14 names."""
    path = _handwriting_fontfile()
    if not path:
        return None
    try:
        import fitz
        return fitz.Font(fontfile=path)
    except Exception:
        logger.warning("copy-check: handwriting font %s could not be loaded", path, exc_info=True)
        return None


@lru_cache(maxsize=8)
def _pen_scale(path: Optional[str]) -> float:
    """Hold the *apparent* size of a note steady when the pen font changes.

    Point size is an em measure, but what a reader actually sees is the
    x-height, and a joined cursive carries far less of its em there than a
    print hand does: Snell Roundhand measures 0.36 against Chalkboard's 0.53.
    Set both at 12pt and the cursive looks two-thirds the size - the difference
    between a note the student can act on and a smudge in the margin. Every
    size in this module was tuned against the print hand, so normalise to it.
    """
    if not path:
        return 1.0
    try:
        import fitz
        import numpy as np

        doc = fitz.open()
        page = doc.new_page(width=300, height=200)
        page.insert_font(fontname="scale", fontfile=path)
        page.insert_text(fitz.Point(20, 140), "xnou", fontname="scale", fontsize=60)
        pix = page.get_pixmap(dpi=150)
        arr = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        rows = np.nonzero((arr[:, :, 0] < 128).any(axis=1))[0]
        doc.close()
        if rows.size < 2:
            return 1.0
        x_height = (rows.max() - rows.min()) / (150.0 / 72.0) / 60.0
        if x_height <= 0.05:
            return 1.0
        return max(1.0, min(1.6, _REFERENCE_X_HEIGHT / x_height))
    except Exception:  # a missing numpy or an odd font must not stop marking
        logger.debug("could not measure x-height for %s", path, exc_info=True)
        return 1.0


def _page_k(page: Any) -> float:
    """How much larger than A4 this page is, for scaling the pen's size caps.

    Every cap on a mark's size (a score at most 24pt, a note at most 20, ...)
    was tuned on A4 scans, 595pt wide. A phone photo converted to PDF is often
    1500pt wide or more with handwriting to match - 54pt rows on one copy -
    and there the capped marks came out a third of the student's writing,
    too small to read. The caps grow with the page; on A4 nothing changes.
    """
    try:
        width = (_SCAN_W[0] or {}).get(page.number, page.rect.width)
        return max(1.0, min(4.0, float(width) / 595.0))
    except Exception:
        return 1.0


def _note_k(page: Any) -> float:
    """_page_k for written REMARKS: they grow with the page more slowly than
    marks. A remark as large as the student's writing needs a gap two ruled
    lines tall, which a written page does not have - scaled fully, the notes
    on a 1500pt page found no room and were sent to other pages."""
    return math.sqrt(_page_k(page))


def _pen(page: Any) -> tuple[str, float, Optional[Any]]:
    """(fontname, fontsize, font-for-measuring) for pen notes on this page.

    The font has to be registered on each page before it can be named in an
    insert_text call, so this is called per note rather than once per document.
    """
    path = _handwriting_fontfile()
    font = _handwriting_font()
    if path and font is not None:
        try:
            page.insert_font(fontname=_HW_FONTNAME, fontfile=path)
            return _HW_FONTNAME, _HW_FONTSIZE, font
        except Exception:
            logger.debug("handwriting font registration failed on page", exc_info=True)
    return _NOTE_FONT, _NOTE_FONTSIZE, None


def _text_width(text: str, fontname: str, size: float, font: Optional[Any]) -> float:
    """Width of drawn text. Measured from the pen alphabet, not the TTF, so
    placement matches what actually gets inked."""
    from . import penfont
    return penfont.text_width(text, size)


# Openers that turn a teacher's remark into an editor's instruction. The
# grading prompt asks for the correction itself, but a third of the notes on a
# real script still arrived as orders - "Add residue divided in profit-sharing
# ratio", "Cite s. 59". A teacher writes what is TRUE, not what to do, so the
# order is stripped and the statement underneath is kept.
# Words a remark must never end on - a cut there reads as a broken sentence
# rather than a short one.
_DANGLING = frozenset((
    "is", "are", "was", "were", "the", "a", "an", "and", "or", "but", "to",
    "of", "in", "on", "for", "with", "at", "by", "from", "that", "this",
    "his", "her", "their", "its", "as", "if", "not", "be", "been",
))
_ORDER_OPENERS = (
    "also state that", "also state", "also mention", "also cite", "also add",
    "state that", "state the", "state", "cite", "add that", "add", "anchor",
    "mention that", "mention", "name the", "name", "include", "note that",
    "note", "write", "specify",
)


def _teacher_voice(note: str) -> str:
    """Turn an instruction to the student into the remark a marker would write."""
    stripped = note.lstrip()
    low = stripped.lower()
    for opener in _ORDER_OPENERS:
        if not low.startswith(opener):
            continue
        rest = stripped[len(opener):].lstrip(" :,-—")
        # Keep the order if nothing useful survives it - a bare "Add" says
        # less than nothing, but so does an empty note.
        if len(rest) < 4:
            return note
        # A section reference keeps its lower-case "s."; ordinary prose gets
        # its sentence capital back.
        if not rest.startswith(("s.", "ss.", "s ")):
            rest = rest[0].upper() + rest[1:]
        return rest
    return note


def _latin1(text: str) -> str:
    """Make `text` safe for a base-14 font, without silently losing characters."""
    if not text:
        return ""
    for bad, good in _LATIN1_SUBSTITUTIONS.items():
        text = text.replace(bad, good)
    # Drop anything still outside Latin-1. Filtering per character rather than
    # encode(..., "replace") keeps the student's real question marks intact —
    # "replace" would make an unmapped glyph indistinguishable from one.
    return "".join(ch if ord(ch) < 256 else " " for ch in text)

_NOTE_FONTSIZE = 8.5

# Three inks, each meaning one thing. A critic counted four inks doing
# overlapping jobs - red rules and green rules underlining sentences on the
# same page - and called it "a four-ink system with no readable meaning".
# Green means credit. Red means fault, correction, or a mark. Blue is the
# occasional explanatory aside. Orange is gone.
# ONE PEN, one colour. A teacher picks up a pen and marks the whole script with
# it; the reference has no second ink anywhere. Green ticks against red
# corrections was my invention and both critics called it fatal on sight.
_STYLE_COLOR = {
    "tick": _WRONG,
    "cross": _WRONG,
    "circle": _WRONG,
    "strike": _WRONG,
    "strikethrough": _WRONG,
    "underline": _WRONG,
    "margin_note": _WRONG,
    "region_note": _WRONG,
    "brace": _WRONG,
    "summary": _WRONG,
    "score": _WRONG,
    "feedback": _WRONG,
    "deduction_reason": _WRONG,
    "language": _WRONG,
}


def _media_base_url() -> str:
    return os.getenv("MEDIA_SERVER_BASE_URL", "http://media-service:8075").rstrip("/")


def _target_index(layout_map: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """target id -> {page_id, box}. Mirrors the overlay's index so the burned-in
    copy and the on-screen overlay can never disagree about what a target means."""
    idx: dict[str, dict[str, Any]] = {}
    for page in layout_map.get("pages") or []:
        page_id = page.get("page_id")
        for key in ("lines", "regions"):
            for item in page.get(key) or []:
                item_id = item.get("line_id") or item.get("region_id")
                box = item.get("box")
                if item_id and box and len(box) == 4:
                    idx[item_id] = {"page_id": page_id, "box": box}
    return idx


def _page_dims(layout_map: dict[str, Any]) -> dict[str, tuple[float, float]]:
    dims: dict[str, tuple[float, float]] = {}
    for page in layout_map.get("pages") or []:
        pid, w, h = page.get("page_id"), page.get("width"), page.get("height")
        if pid and w and h:
            dims[pid] = (float(w), float(h))
    return dims


def _page_order(layout_map: dict[str, Any]) -> dict[str, int]:
    """page_id -> zero-based index in the PDF. Falls back to declaration order
    when page_index is absent."""
    order: dict[str, int] = {}
    for i, page in enumerate(layout_map.get("pages") or []):
        pid = page.get("page_id")
        if pid:
            idx = page.get("page_index")
            # A negative index would silently resolve via Python's doc[-1] to
            # the LAST page and burn marks onto the wrong sheet — treat it as
            # absent and fall back to declaration order.
            order[pid] = int(idx) if isinstance(idx, int) and idx >= 0 else i
    return order


# The sheet currently being marked. Every pen stroke is clipped to it: the
# clamps on mark POSITION were not enough, because a hand-drawn stroke
# deliberately overshoots its endpoints and a ring wobbles outward, so marks
# placed legally still spilled a few points onto the desk. Set per page.
_CLIP: list = [None]
# Slope of the line currently being marked, in degrees. A pen follows the words
# it underlines; drawing horizontally in image space made every rule cross its
# own text line at 2.5-4.4 degrees on a photographed page - hugging the baseline
# at one end and detached 20-35px at the other. Measured per row, not per page,
# because adjacent lines on a curled page do not share an angle.
_ROW_SLOPE: list = [0.0]
# Ink extent of the row being marked, so a rule stops at the words.
_INK_SPAN: list = [None]
# The measured ink map for the page being drawn, so a mark can ask about the
# rows it will actually cover rather than only the row it belongs to.
_INK_MAP: list = [None]
# Comments already written on the page being drawn. The ink map is measured
# before any marking, so a mark cannot see them there - and a cross stamped
# through the marker's own note ("Bu[X]yer m[X]st be insolv[X]nt") is worse
# than one on the student's words.
_PLACED: list = [None]
# Per-row paper boundary for the page being drawn (see _paper_rows).
_PAPER: list = [None]
# Where the added marking strip begins, when there is one. A note belongs
# there by preference: it is blank paper beside the answer, which is exactly
# where a teacher writes when the notebook gives them the room.
_MARGIN_X: list = [None]
# page_no -> width of the scan, when a comment panel has widened the page.
# The pen is sized from the scan, so a mark is the same size with or without
# the panel beside it.
_SCAN_W: list = [None]


# Per-page paper luminance, 0..1, sampled where the mark is going down. Real
# ink photographs darker in a shadowed corner and lighter where the page is
# lit; a constant RGB across six differently-lit photographs is not a pen.
_SHADE: list = [None]


def _ink(colour, rng, x: float = None, y: float = None):
    """The pen colour as it would photograph at this spot on this page."""
    r, g, b = colour
    # Ballpoint is never one flat value: the same pen varies stroke to stroke.
    jitter = rng.uniform(-0.045, 0.045)
    lum = 1.0
    shade = _SHADE[0]
    if shade is not None and x is not None and y is not None:
        lum = shade(x, y)
    # Darker where the paper is darker, and never a perfectly neutral G=B.
    k = max(0.55, min(1.12, (0.72 + 0.42 * lum) + jitter))
    return (max(0.0, min(1.0, r * k)),
            max(0.0, min(1.0, g * k * rng.uniform(0.97, 1.03))),
            max(0.0, min(1.0, b * k * rng.uniform(0.94, 1.02))))


def _point_on_paper(x: float, y: float) -> bool:
    """Is this exact point physically on the student's notebook page?

    The last line of defence for the marking guide's first rule. Placement
    decides WHERE a mark goes, but eighteen call sites draw strokes and any one
    of them can run past the sheet - on a copy photographed on a bedsheet that
    put 98% of the ink on the bedsheet. Checking here means no primitive can
    write off the paper whatever the caller intended.
    """
    paper = _PAPER[0]
    if not paper:
        return True
    r = int(y / paper["sy"])
    if r < 0 or r >= paper["rows"]:
        return False
    mask = paper.get("mask")
    if mask is not None:
        # Test the paper itself. The row span is one horizontal interval, so on
        # a sheet photographed at an angle it reaches past the corners and over
        # the bedsheet beside them; the mask does not.
        sx, sy = paper["sx"], paper["sy"]
        for dx, dy in ((0.0, 0.0), (-_PAPER_TOL, 0.0), (_PAPER_TOL, 0.0),
                       (0.0, -_PAPER_TOL), (0.0, _PAPER_TOL)):
            cc, rr = int((x + dx) / sx), int((y + dy) / sy)
            if 0 <= rr < paper["rows"] and 0 <= cc < paper["cols"] and mask[rr, cc]:
                return True                    # within 1pt of paper, as before
        return False
    hi = paper["hi"][r]
    return hi > 0 and (paper["lo"][r] - 1.0) <= x <= (hi + 1.0)


def _clip_point(x: float, y: float) -> tuple:
    r = _CLIP[0]
    if r is None:
        return x, y
    return (min(max(x, r.x0 + 1.0), r.x1 - 1.0),
            min(max(y, r.y0 + 1.0), r.y1 - 1.0))


def _hand_rng(*seed: Any):
    """Deterministic per-mark randomness.

    Seeded from the mark's own identity, so a copy re-rendered from the same
    verdicts is byte-identical - a teacher's marks do not move between two
    prints of the same script - while every individual mark still gets its own
    wobble instead of every stroke on the page sharing one shape.

    It must NOT use hash(): Python salts string hashing per process, so the
    same copy came out differently on every run, and on an unlucky seed a
    comment that fits one render is dropped from the next. A stable digest is
    what makes the promise above actually true.
    """
    import hashlib
    import random

    key = "\x1f".join(repr(part) for part in seed).encode("utf-8", "replace")
    return random.Random(int.from_bytes(hashlib.blake2b(key, digest_size=8).digest(), "big"))


def _fit_words(text: str, fontname: str, size: float, font: Optional[Any],
               room: float) -> str:
    """The longest whole-word prefix of `text` that fits in `room`.

    Clipping per character - which is what a naive edge guard does - stops
    mid-word and leaves the student reading "Also stat Rs. 85,0". A comment cut
    at a word boundary is merely short; one cut mid-word looks broken and
    hides the very reason a mark was lost.
    """
    if room <= 0:
        return ""
    words = text.split()
    kept: list = []
    for w in words:
        trial = " ".join(kept + [w])
        if _text_width(trial, fontname, size, font) * _ADVANCE_SLACK > room:
            break
        kept.append(w)
    return " ".join(kept)


def _cursive_text(page: Any, origin: Any, text: str, fontname: str, size: float,
                  colour, rng, font: Optional[Any] = None,
                  slant: float = 0.0, max_x: Optional[float] = None) -> None:
    """Write a joined script, varying the hand a WORD at a time.

    A cursive face joins its letters by butting one outline exactly against the
    next. Placing each character separately - the right way to break up the
    repetition of a print hand - pulls those joins apart and the writing falls
    into a row of disconnected marks, which is what made a cursive pen still
    read as typeset sans-serif. So a word is drawn in one call and stays
    joined; the baseline, the tilt and the size wander between words instead.
    """
    import fitz
    import re as _re

    if max_x is not None:
        text = _fit_words(text, fontname, size, font, max_x - origin.x)
        if not text:
            return
    x = origin.x
    drift = 0.0
    space_w = _text_width(" ", fontname, size, font) or size * 0.3
    for token in _re.split(r"(\s+)", text):
        if not token:
            continue
        if token.isspace():
            x += space_w * len(token) * rng.uniform(1.0, _ADVANCE_SLACK)
            continue
        # A hand wanders off the ruled line gradually and corrects, so the
        # baseline is a slow walk rather than per-word noise.
        drift = max(-2.2, min(2.2, drift + rng.uniform(-0.7, 0.7)))
        wsize = size * rng.uniform(0.96, 1.05)
        pt = fitz.Point(x, origin.y + drift)
        # The face is already oblique; the caller's slant is for the monoline
        # alphabet, so take only a hint of it as a baseline tilt.
        angle = (slant - 10.0) * 0.2 + rng.uniform(-2.2, 2.2)
        page.insert_text(pt, token, fontsize=wsize, fontname=fontname,
                         color=colour,
                         morph=(pt, fitz.Matrix(1, 0, 0, 1, 0, 0).prerotate(angle)))
        x += _text_width(token, fontname, wsize, font)


def _pen_for(pdf_bytes: bytes) -> Any:
    """The copy's pen: one hand for the whole script, seeded from the file."""
    if not _HAND_RENDER:
        return None
    try:
        from . import hand_render
        seed = int.from_bytes(hashlib.blake2b(pdf_bytes[:1 << 20], digest_size=8).digest(), "big")
        return hand_render.Pen(seed)
    except Exception:
        logger.debug("hand_render unavailable; using the vector pen", exc_info=True)
        return None


def _composite_layer(page: Any, layer: Any, ox_px: float, oy_px: float,
                     nudge: float = 0.0) -> Optional[Any]:
    """Crop a drawn RGBA layer to its ink and place it on the page.

    (ox_px, oy_px) is where the layer's top-left sits, in page pixels at
    _PEN_SCALE. Returns the rect covered in points, or None if the ink would
    leave the paper - the caller then falls back to the vector pen, whose
    per-stroke gate can still draw the part that fits. `nudge` is how far
    (points) the ink may be moved back inside the sheet first: a tick's tail
    overshoots the box it was placed by, and on the top row of a page that
    put its tip 3pt above the sheet - so the pen refused the whole tick and
    the thin vector one was drawn instead, a different hand from its
    neighbours.
    """
    import io
    import fitz

    bbox = layer.getbbox()
    if not bbox:
        return None
    x0, y0, x1, y1 = bbox
    S = _PEN_SCALE
    rect = fitz.Rect((ox_px + x0) / S, (oy_px + y0) / S, (ox_px + x1) / S, (oy_px + y1) / S)
    if nudge > 0.0 and (not _on_paper(_PAPER[0], rect) or
                        (_CLIP[0] is not None and not _CLIP[0].contains(rect))):
        # The sheet rect, narrowed to the paper the mask measured on these
        # rows (a scan's paper edge sits inside the sheet rect).
        c = _CLIP[0] if _CLIP[0] is not None else page.rect
        lo, hi = _paper_span(_PAPER[0], rect.y0, rect.y1)
        x_lo = max(c.x0, lo) if lo is not None else c.x0
        x_hi = min(c.x1, hi) if hi is not None else c.x1
        dx = (x_lo + 1.0 - rect.x0 if rect.x0 < x_lo + 1.0
              else (x_hi - 1.0 - rect.x1 if rect.x1 > x_hi - 1.0 else 0.0))
        dy = (c.y0 + 1.0 - rect.y0 if rect.y0 < c.y0 + 1.0
              else (c.y1 - 1.0 - rect.y1 if rect.y1 > c.y1 - 1.0 else 0.0))
        if abs(dx) <= nudge and abs(dy) <= nudge:
            rect = fitz.Rect(rect.x0 + dx, rect.y0 + dy, rect.x1 + dx, rect.y1 + dy)
            logger.debug("pen layer nudged by (%.1f, %.1f) to stay on the sheet", dx, dy)
    if not _on_paper(_PAPER[0], rect):
        logger.debug("pen layer at %s refused: off paper; vector pen instead", rect)
        return None
    if _CLIP[0] is not None and not _CLIP[0].contains(rect):
        logger.debug("pen layer at %s refused: outside clip %s; vector pen instead",
                     rect, _CLIP[0])
        return None
    buf = io.BytesIO()
    layer.crop(bbox).save(buf, format="PNG")
    page.insert_image(rect, stream=buf.getvalue(), overlay=True)
    return rect


def _pen_text_overlay(page: Any, origin: Any, text: str, size: float,
                      max_x: Optional[float] = None) -> Optional[Any]:
    """Write `text` with the copy's pen, baseline-left at `origin` (points)."""
    pen = _PEN[0]
    if pen is None or not text:
        return None
    try:
        from PIL import Image, ImageFont
        S = _PEN_SCALE
        # Kalam carries a small x-height, so at the size the placement ladder
        # chose for the old face it reads a shade too small beside the
        # student's hand. The guide asks for notes ~1.1x the line height.
        px = max(6, int(round(size * S * 1.18)))
        font = ImageFont.truetype(pen.font_path, px)
        # Shrink until the line fits before the limit the caller set; the
        # caller has already wrapped, so this rarely runs more than once.
        for _ in range(6):
            est_pt = font.getlength(text) * 1.12 / S
            if max_x is None or origin.x + est_pt <= max_x or px <= 8:
                break
            px = int(px * 0.92)
            font = ImageFont.truetype(pen.font_path, px)
        est_w = int(font.getlength(text) * 1.3) + 4 * px
        est_h = 4 * px
        layer = Image.new("RGBA", (est_w, est_h), (0, 0, 0, 0))
        # Pen.text takes the TOP-left of the text (PIL's convention), not the
        # baseline its docstring names. Placing the baseline there put every
        # score and note one text-height below its row. The font's ascent is
        # the distance from top to baseline; draw that much higher.
        ascent = font.getmetrics()[0]
        ax, ay = 2 * px, int(2.4 * px)          # baseline-left inside the layer
        pen.text(layer, (ax, ay - ascent), text, px)
        return _composite_layer(page, layer, origin.x * S - ax, origin.y * S - ay)
    except Exception:
        logger.debug("hand_render text failed; using the vector pen", exc_info=True)
        return None


def _pen_mark_overlay(page: Any, style: str, cx: float, cy: float, size: float) -> Optional[Any]:
    """A tick or cross with the copy's pen. (cx, cy) is the top-left of the
    size x size box the vector pen would have used."""
    pen = _PEN[0]
    if pen is None:
        return None
    try:
        from PIL import Image
        S = _PEN_SCALE
        h = size * S
        layer = Image.new("RGBA", (int(h * 4), int(h * 4)), (0, 0, 0, 0))
        if style == "tick":
            # vertex sits low-left in the box, the tail climbs to the right
            pen.tick(layer, (h * 1.4, h * 2.6), h * 0.95)
        else:
            pen.cross(layer, (h * 2.0, h * 2.0), h * 0.85)
        # layer (h*1.4, h*2.6) / (h*2, h*2) correspond to the box's own
        # anchor points; map the layer origin so they coincide.
        if style == "tick":
            ox = cx * S + h * 0.30 - h * 1.4
            oy = cy * S + h * 0.85 - h * 2.6
        else:
            ox = cx * S + h * 0.5 - h * 2.0
            oy = cy * S + h * 0.5 - h * 2.0
        return _composite_layer(page, layer, ox, oy, nudge=8.0)
    except Exception:
        logger.debug("hand_render mark failed; using the vector pen", exc_info=True)
        return None


def _pen_total_layer(text: str, size: float) -> tuple[Any, float, float]:
    """The circled total drawn on its own layer with the copy's pen.

    Returns (layer, cx, cy): the digits' centre in layer pixels, which is
    the point the caller pins to the page.
    """
    from PIL import Image, ImageFont
    pen = _PEN[0]
    S = _PEN_SCALE
    px = int(round(size * S))
    font = ImageFont.truetype(pen.font_path, px)
    w = font.getlength(text)
    layer = Image.new("RGBA", (int(w * 2.2) + 6 * px, 6 * px), (0, 0, 0, 0))
    ax, ay = int(w * 0.6) + 3 * px, int(2.2 * px)      # top-left of the digits
    pen.circled_total(layer, (ax, ay), text, px)
    # Pen draws from the top-left; the digits' centre is about half an
    # ascent below that.
    ascent = font.getmetrics()[0]
    return layer, ax + w * 0.5, ay + ascent * 0.5


def _pen_total_overlay(page: Any, centre: Any, text: str, size: float) -> Optional[Any]:
    """The circled total with the copy's pen; `size` is the digit height in points."""
    if _PEN[0] is None:
        return None
    try:
        S = _PEN_SCALE
        layer, cx, cy = _pen_total_layer(text, size)
        return _composite_layer(page, layer, centre.x * S - cx, centre.y * S - cy)
    except Exception:
        logger.debug("hand_render total failed; using the vector pen", exc_info=True)
        return None


def _grand_total_reach(page: Any, text: str, line_h: float) -> tuple[float, float, float, float]:
    """How far the circled total's ink runs (left, right, up, down) of its centre, in points.

    Measured from the mark as it will actually be drawn. The old fixed
    estimate assumed a "24/30"-sized figure; "29.5/45" ran 17pt past the
    paper's edge, the pen refused it, and the vector fallback drew the ring
    gated at the edge - the most prominent mark on the script, cramped.
    """
    size = line_h * 1.45
    if _PEN[0] is not None:
        try:
            S = _PEN_SCALE
            layer, cx, cy = _pen_total_layer(text, size)
            bbox = layer.getbbox()
            if bbox:
                return ((cx - bbox[0]) / S, (bbox[2] - cx) / S,
                        (cy - bbox[1]) / S, (bbox[3] - cy) / S)
        except Exception:
            logger.debug("could not measure the pen total", exc_info=True)
    font, measure = _digit_pen(page)
    width = _text_width(text, font, size, measure)
    rx = width / 2.0 + size * 0.42 + 2.0
    ry = size * 0.80 + 2.0
    return rx, rx, ry, ry


def _pen_text(page: Any, origin: Any, text: str, size: float, colour, rng,
              slant: float = 0.0, max_x: Optional[float] = None,
              rise: Optional[float] = None, tilt: Optional[float] = None) -> None:
    """Write `text` by drawing the letters, not by setting a font.

    A TTF - even a handwriting TTF - reuses one outline per character, so every
    'e' in a comment is pixel-identical. Three critics independently named that
    as the fastest tell on the marked script. penfont supplies each letter as
    pen strokes, and inking them through _hand_line means every instance comes
    out slightly different, in the same pen as the ticks and rules.
    """
    import fitz
    from . import penfont

    if _PEN[0] is not None and _pen_text_overlay(page, origin, text, size, max_x) is not None:
        return

    # A joined hand, when one is installed. penfont draws each letter as
    # separate strokes on a unit box, so nothing ever connects and every
    # stroke is the same weight - which reads as a monoline print alphabet,
    # not as the cursive on a marked script.
    fontname, _, measure_font = _pen(page)
    if fontname != _NOTE_FONT and not _PEN_STROKES:
        path = (_handwriting_fontfile() or "").lower()
        if any(j in path for j in _JOINED_FACES):
            _cursive_text(page, origin, text, fontname, size, colour, rng,
                          measure_font, slant, max_x=max_x)
        else:
            # A print hand. The reference marker's own comments measure ~0.5
            # degrees off vertical, so the italic slant meant for the monoline
            # alphabet is simply wrong here.
            # The reference hand stands upright on the page and gets ALL of
            # its apparent lean from a baseline that climbs 10-22 degrees.
            # Shearing the glyphs as well double-counted it - measured +21 to
            # +27 degrees of bowl tilt against the reference's 0-3, which is
            # exactly what still read as italic type. Keep the letters
            # vertical and let the climb do the work, varying the climb widely
            # because the reference's own comments range 10.2 to 22.0.
            _hand_text(page, origin, text, fontname, size, colour, rng,
                       measure_font, slant=0.0, max_x=max_x,
                       rise=(rise if rise is not None
                             else rng.uniform(8.0, 14.0)),
                       tilt=(tilt if tilt is not None
                             else rng.uniform(-3.0, 1.0)))
        return

    # The climb has to be applied HERE too. It was only ever wired into the
    # font path, so routing prose through the pen silently lost it and the
    # comments came out running about a degree DOWNHILL against a page whose
    # own ruling climbs - the reference hand climbs 12-20.
    climb_rad = math.radians(rise if rise is not None else 11.0)
    ox, oy = origin.x, origin.y

    def stroke(points, width_scale):
        for i in range(len(points) - 1):
            ax, ay = points[i]
            bx, by = points[i + 1]
            a = fitz.Point(ax, ay - (ax - ox) * math.tan(climb_rad))
            b = fitz.Point(bx, by - (bx - ox) * math.tan(climb_rad))
            # Weight measured against the reference: their pen lays 0.229-0.554
            # of the x-height, this was drawing 0.134 - a hairline ballpoint
            # where the teacher used a fat red pen.
            # 2.6, not more. At 3.1 the stroke/x-height ratio reaches the
            # reference's 0.229 but the letters fill in - ink density 0.289
            # against their 0.078-0.156, right at the edge of legible. Their
            # hand gets a fat stroke AND open counters because its letterforms
            # are roomier than this alphabet's; with these glyphs it is one or
            # the other, and a readable comment matters more than the ratio.
            _hand_line(page, a, b, colour, 2.6 * width_scale, rng,
                       wobble=max(0.25, size * 0.035), overshoot=size * 0.045)

    penfont.draw_text(stroke, ox, oy, text, size, rng, slant=slant)


def _hand_text(page: Any, origin: Any, text: str, fontname: str, size: float,
               colour, rng, font: Optional[Any] = None, slant: float = 0.0,
               max_x: Optional[float] = None, rise: float = 0.0,
               tilt: Optional[float] = None) -> None:
    """Write a string the way a hand writes it, glyph by glyph.

    A font is the last thing that gives a "handwritten" note away: every 'a' on
    the page is the identical shape at the identical baseline, which no hand
    manages. Setting each character separately - with its own baseline drift,
    a fraction of a degree of rotation, and a slightly different size - breaks
    that repetition. The drift is a slow random walk rather than per-character
    noise, because a hand wanders off the line gradually and then corrects,
    it does not jitter letter to letter.
    """
    import fitz

    if max_x is not None:
        text = _fit_words(text, fontname, size, font, max_x - origin.x)
        if not text:
            logger.debug("no room on the paper for this note line")
            return
    x = origin.x
    drift = 0.0
    # A comment written in a margin runs uphill; the reference teacher's own
    # block measures about 10.5 degrees off level. A dead-flat baseline was
    # measured at -0.3px/100px against the student's own -2.0 on the same
    # photograph, and that flatness reads as type however good the face is.
    climb = math.tan(math.radians(rise))
    for ch in text:
        w = _text_width(ch, fontname, size, font)
        if ch != " " and not _point_on_paper(x, origin.y + drift):
            x += w
            continue
        if ch == " ":
            x += w * rng.uniform(1.0, _ADVANCE_SLACK)
            continue

        # +-1.1 degrees is real in the PDF and invisible on the page: a critic
        # reported "no per-letter rotation" while the morph matrices were in
        # fact being applied. Handwriting varies several degrees letter to
        # letter, and the baseline wanders further than a point.
        # Measured 0.3-1.8px rms of baseline bounce against the reference
        # hand's 4.3-8.7px on the same photograph. A ruler-straight baseline
        # reads as type however good the letterforms are.
        drift = max(-3.4, min(3.4, drift + rng.uniform(-1.05, 1.05)))
        csize = size * rng.uniform(0.93, 1.08)
        pt = fitz.Point(x, origin.y + drift - (x - origin.x) * climb)
        # The glyphs ride the climb WITH the baseline. Offsetting only the
        # baseline left every stem plumb, so the writing measured 0 to -3
        # degrees - slightly backslanted - while the reference hand measures
        # +7 to +10 in the image. That reference block is simply rotated: its
        # letters are upright against their OWN baseline and tilted against
        # the page. Rotating them here reproduces both facts at once.
        # The letters' lean and the baseline's rise are separate knobs. Coupling
        # them exactly (one rotated block, as the reference is) is truer, but a
        # long line then has to rise as far as it leans, which costs the
        # vertical space a dense page does not have - flattening the climb also
        # flattened the lean and the writing came out backslanted. So the hand
        # keeps its lean whatever the line length; only the baseline gives way.
        lean = rise if tilt is None else tilt
        angle = slant - lean + rng.uniform(-3.8, 3.8)
        # Fill only. Stroking the glyph to thicken the pen looked right on
        # paper but PyMuPDF's border_width is a FRACTION OF FONTSIZE, not a
        # width in points: the value used worked out at ~78% of the font size
        # and welded every comment into a solid red slab - 89% ink inside the
        # bounding box, not one letter readable. A slightly thin pen beats an
        # unreadable one; if the weight is ever raised again, border_width
        # 0.01-0.02 is the whole usable range.
        page.insert_text(pt, ch, fontsize=csize, fontname=fontname, color=colour,
                         morph=(pt, fitz.Matrix(1, 0, 0, 1, 0, 0).prerotate(angle)))
        # Letter spacing wanders slightly too, so words do not sit on a grid.
        x += w * rng.uniform(0.97, _ADVANCE_SLACK)


def _hand_line(page: Any, p0: Any, p1: Any, colour, width: float, rng,
               wobble: float = 2.1, overshoot: float = 2.6) -> None:
    """A pen stroke, not a vector line.

    Three things separate a drawn line from a computed one, and all three are
    what made the marked copy read as machine output: a hand does not start or
    stop exactly on the mark (so the stroke overshoots slightly at both ends),
    it does not travel perfectly straight (so the path bows and wavers), and it
    does not hold constant pressure (so the width varies along the stroke).
    """
    import fitz

    # A hand-ruled line on a photographed, skewed page drifts several points
    # over its length and follows the slope of the writing, not the image axis.
    # Measured on the machine-marked version: under 1px of drift over 900px,
    # against 3-8 degrees of page skew - the single clearest giveaway.
    slope = math.tan(math.radians(_ROW_SLOPE[0])) + rng.uniform(-0.004, 0.004)
    p1 = fitz.Point(p1.x, p1.y + (p1.x - p0.x) * slope)

    dx, dy = p1.x - p0.x, p1.y - p0.y
    length = max((dx * dx + dy * dy) ** 0.5, 0.001)
    ux, uy = dx / length, dy / length
    nx, ny = -uy, ux  # unit normal, for sideways wobble

    a = fitz.Point(p0.x - ux * overshoot * rng.uniform(0.3, 1.0),
                   p0.y - uy * overshoot * rng.uniform(0.3, 1.0))
    b = fitz.Point(p1.x + ux * overshoot * rng.uniform(0.3, 1.0),
                   p1.y + uy * overshoot * rng.uniform(0.3, 1.0))

    # A gentle bow across the whole stroke plus small local waver, sampled at a
    # handful of points - enough to read as drawn, not enough to look shaky.
    steps = max(4, min(9, int(length / 26) + 4))
    bow = rng.uniform(-wobble, wobble)
    pts = []
    for i in range(steps + 1):
        t = i / steps
        off = bow * (t * (1 - t) * 4) + rng.uniform(-wobble * 0.35, wobble * 0.35)
        pts.append(fitz.Point(a.x + (b.x - a.x) * t + nx * off,
                              a.y + (b.y - a.y) * t + ny * off))
    # Pressure profile: light at the entry, heaviest around two-thirds through,
    # light again as the pen lifts. Plus a little noise, because a hand is not
    # a plotter. Without this every stroke is a constant-width bar, which is
    # what made ticks, rules and letters all read as vector art.
    # Monoline. The reference teacher hand measures a flat ~0.6mm stroke with no
    # thick/thin contrast and one constant ink value - it is a gel pen written
    # fast, and imitating ballpoint pressure physics moved AWAY from it.
    # Monoline through the body, but a pen still lands and lifts: the first and
    # last touch lay down less ink than the middle of the stroke. Drawing every
    # segment at one width gave square butt ends and a measured width spread of
    # 2.85 against the reference hand's 5.33-12.50 - the strokes read as vector
    # art with no beginning and no end. This is taper, not pressure physics.
    # Taper at the ends, and PRESSURE along the length. A hand presses on the
    # pull and lifts on the push, so a downstroke lays more ink than an
    # upstroke - that is where a pen's thick/thin actually comes from, and its
    # absence is what every review called out: stroke-width variation measured
    # 0.055-0.087 against the reference hand's 0.274-0.333, with square-cut
    # terminals everywhere. Modulating by stroke DIRECTION is the physical
    # rule, not decoration.
    n = len(pts) - 1
    for i in range(n):
        a = fitz.Point(*_clip_point(pts[i].x, pts[i].y))
        b = fitz.Point(*_clip_point(pts[i + 1].x, pts[i + 1].y))
        if not (_point_on_paper(a.x, a.y) and _point_on_paper(b.x, b.y)):
            continue                     # a pen cannot reach past the paper
        t = (i + 0.5) / n
        taper = min(1.0, min(t, 1.0 - t) / 0.18)
        dx, dy = b.x - a.x, b.y - a.y
        seg = max((dx * dx + dy * dy) ** 0.5, 1e-6)
        # +1 travelling down the page (heavy), -1 travelling up (light).
        press = 0.78 + 0.34 * ((dy / seg) * 0.5 + 0.5)
        w = width * (0.68 + 0.32 * taper) * press
        page.draw_line(a, b, color=colour, width=max(0.35, w))


def _hand_oval(page: Any, r: Any, colour, width: float, rng) -> None:
    """A looped ring, the way a teacher rings a phrase.

    draw_oval gives a flawless ellipse, which nothing drawn by hand ever is.
    This walks the ellipse with a per-point radius wobble and deliberately
    overshoots the start, so the loop closes past itself the way a pen does.
    """
    import fitz
    import math

    cx, cy = (r.x0 + r.x1) / 2.0, (r.y0 + r.y1) / 2.0
    rx, ry = max(r.width / 2.0, 3.0), max(r.height / 2.0, 3.0)
    start = rng.uniform(0, math.tau)
    # Sometimes past the start, sometimes short of it. A ring that always closes
    # to exactly the same point reads as a stamped badge; a critic noted the
    # rings had "no overshoot or closure gap".
    sweep = math.tau + (rng.uniform(0.14, 0.46) if rng.random() < 0.6
                        else -rng.uniform(0.10, 0.30))
    steps = 46
    squash = rng.uniform(0.94, 1.06)
    tilt = rng.uniform(-0.05, 0.05)
    pts = []
    for i in range(steps + 1):
        t = start + sweep * (i / steps)
        wob = 1.0 + rng.uniform(-0.045, 0.045)
        x = cx + math.cos(t) * rx * wob
        y = cy + math.sin(t) * ry * wob * squash
        x, y = (cx + (x - cx) - (y - cy) * tilt, cy + (y - cy) + (x - cx) * tilt * 0.15)
        pts.append(fitz.Point(x, y))
    n = len(pts) - 1
    for i in range(n):
        a = fitz.Point(*_clip_point(pts[i].x, pts[i].y))
        b = fitz.Point(*_clip_point(pts[i + 1].x, pts[i + 1].y))
        page.draw_line(a, b, color=colour, width=max(0.5, width))


_LAST_TICK: list = [None]

def _draw_tick_or_cross(page, style, cx, cy, size, colour, rng, rect,
                        line_x0, line_x1) -> None:
    """The tick / cross gesture, shared by both anchor positions."""
    import fitz
    import math

    # A drawn mark is an obstacle for whatever is written after it, the same
    # as a note: crosses go down before the comments, and a comment wrapped
    # under a row used to run through the cross at the end of it. Only the
    # part on the row is reserved: a mark taller than its row hangs a few
    # points into the band below, and reserving that too squeezed the next
    # comment to a third of the width and then out of the gap entirely.
    if _PLACED[0] is not None:
        _PLACED[0].append(fitz.Rect(cx, max(cy, rect.y0 - 0.5),
                                    cx + size, min(cy + size, rect.y1 + 0.5)))

    if _PEN[0] is not None and _pen_mark_overlay(page, style, cx, cy, size) is not None:
        return

    if style == "tick":
        # Drawn as a real pen tick: a short down-stroke into a long, higher
        # up-stroke, at a stroke width that survives being printed.
        # A tick is two strokes of one gesture, so the join is drawn as a
        # real corner and the long stroke flicks up past the turn.
        # Limb ratio, opening angle and entry height all vary. One hand's
        # ticks share a character but are never the same twice; a critic
        # measured these as 0.034-0.09 apart, i.e. a stamp.
        # Redraw the gesture from scratch each time and rotate the whole thing.
        # Scaling one shape is what made the ticks read as "one glyph rescaled";
        # the previous tick on the page is remembered so no two come out alike.
        # Geometry measured off the reference teacher's ticks: short arm
        # descending 53-61 degrees, long arm rising at almost exactly 41 every
        # time, long:short ratio ~3.5, rounded vertex, long arm tapering at the
        # tip. The consistency IS the character - this hand draws the same tick
        # each time and only the size varies, so the wide random spread I had
        # was wrong for this style.
        # A real check mark, not a slash: a head you can see, then a tail about
        # twice its length climbing ~50 degrees. At the old 3.5:1 ratio the head
        # vanished and critics read the whole thing as a single diagonal.
        short_len = rng.uniform(0.42, 0.55)
        long_len = short_len * rng.uniform(1.9, 2.3)
        down_ang = rng.uniform(50.0, 60.0)
        up_ang = rng.uniform(47.0, 53.0)
        lean = rng.uniform(-3.0, 3.0)
        weight = rng.uniform(1.35, 1.65)
        _LAST_TICK[0] = None

        th = math.radians(lean)

        def place(dx, dy):
            rx = dx * math.cos(th) - dy * math.sin(th)
            ry = dx * math.sin(th) + dy * math.cos(th)
            return fitz.Point(cx + rx * size, cy + ry * size)

        da = math.radians(down_ang)
        ua = math.radians(up_ang)
        knee = place(0.30, 0.92)
        start = place(0.30 - short_len * math.cos(da), 0.92 - short_len * math.sin(da))
        end = place(0.30 + long_len * math.cos(ua), 0.92 - long_len * math.sin(ua))
        # A rounded turn, not a sharp V: the reference vertex is a 2-3px curve.
        pre = place(0.30 - 0.05 * math.cos(da), 0.92 - 0.05 * math.sin(da))
        post = place(0.30 + 0.06 * math.cos(ua), 0.92 - 0.06 * math.sin(ua))
        _hand_line(page, start, pre, colour, weight, rng, wobble=0.3, overshoot=0.4)
        _hand_line(page, pre, post, colour, weight, rng, wobble=0.15, overshoot=0.0)
        _hand_line(page, post, end, colour, weight * 0.9, rng, wobble=0.45, overshoot=0.6)
        # Underline the credited statement as well as ticking it — the way a
        # teacher marks a script, and it shows WHAT earned the tick rather
        # than just that something on the line did.
        # Underline the credited line only sometimes, and never starting at
        # the tick's own vertex. Critics found all six ticks "fused to the
        # start of a long green rule at exactly its vertex" - one gesture
        # doing two jobs, which no hand does.
        if rng.random() < 0.45:
            u_x0 = line_x0 + rng.uniform(0.0, 10.0)
            u_y = rect.y1 + rng.uniform(2.0, 4.5)
            _hand_line(page, fitz.Point(u_x0, u_y), fitz.Point(line_x1, u_y),
                       colour, 1.1, rng)
    else:
        _hand_line(page, fitz.Point(cx, cy),
                   fitz.Point(cx + size, cy + size), colour, 1.9, rng, wobble=0.6)
        _hand_line(page, fitz.Point(cx + size, cy),
                   fitz.Point(cx, cy + size), colour, 1.9, rng, wobble=0.6)
    return


def _draw_brace(page: Any, top: float, bottom: float, x: float, colour,
                rng, height_scale: float = 1.0) -> None:
    """A curly brace down the side of a block of the answer.

    This is how a teacher shows WHICH lines earned a block of marks: one
    stroke bracketing the paragraph, with the comment and the figure beside
    it. Drawn as four arcs meeting at a centre cusp, the way a hand draws it -
    top hook, upper sweep, cusp, lower sweep, bottom hook.
    """
    import fitz

    span = max(bottom - top, 8.0)
    mid = (top + bottom) / 2.0
    depth = max(4.0, min(11.0, span * 0.10)) * height_scale
    w = 1.3

    def sweep(y0: float, y1: float, d0: float, d1: float) -> None:
        """One half of the brace, ramping from d0 at y0 to d1 at y1."""
        steps = 9
        prev = None
        for i in range(steps + 1):
            t = i / steps
            # ease so the stroke leaves the end flat and arrives at the cusp
            # steeply, which is what makes it read as a brace rather than a bow
            e = math.sin(math.pi / 2.0 * t)
            pt = fitz.Point(x + d0 + (d1 - d0) * e + rng.uniform(-0.3, 0.3),
                            y0 + (y1 - y0) * t)
            if prev is not None:
                _hand_line(page, prev, pt, colour, w, rng, wobble=0.2,
                           overshoot=0.0)
            prev = pt

    # Each half must ramp MONOTONICALLY to the cusp. Bulging at each half's own
    # midpoint gave a two-lobe shape whose furthest point sat a quarter of the
    # way down, which is a bow, not a brace.
    sweep(top, mid, 0.0, -depth)
    sweep(bottom, mid, 0.0, -depth)
    # The little hooks at the very ends, curling back toward the writing.
    hook = depth * 0.45
    _hand_line(page, fitz.Point(x, top), fitz.Point(x + hook, top - hook * 0.7),
               colour, w, rng, wobble=0.15, overshoot=0.0)
    _hand_line(page, fitz.Point(x, bottom),
               fitz.Point(x + hook, bottom + hook * 0.7),
               colour, w, rng, wobble=0.15, overshoot=0.0)


def _draw_language(page: Any, rect: Any, ann: dict[str, Any], line_h: float,
                   page_boxes: list, write_correction: bool = True) -> None:
    """One language correction: a short rule under the wrong words and, when
    `write_correction`, the right words written small just above them.

    The layout has row boxes, not word boxes, so the words are found along the
    row's measured ink by where they sit in the row's text (`span`, fractions
    of the text). The correction goes where it touches no writing and no other
    remark - above the words, else below them; with room for neither the rule
    stands alone and the answer's feedback carries the correction.
    """
    import fitz

    try:
        f0, f1 = (float(v) for v in (ann.get("span") or [0.0, 1.0])[:2])
    except (TypeError, ValueError):
        return
    f0 = max(0.0, min(1.0, f0))
    f1 = max(f0, min(1.0, f1))
    ink = _INK_SPAN[0]
    a = max(ink[0], rect.x0) if ink else rect.x0
    b = min(ink[1], rect.x1) if ink else rect.x1
    if b - a < 20.0:
        a, b = rect.x0, rect.x1
    x0 = a + (b - a) * f0
    x1 = a + (b - a) * f1
    if x1 - x0 < 10.0:
        x1 = min(b, x0 + 10.0)
        x0 = max(a, x1 - 10.0)
    rng = _hand_rng("language", round(x0, 1), round(rect.y0, 1), round(x1 - x0, 1))
    drop = rect.y1 + rng.uniform(1.5, 3.0)
    saved = _ROW_SLOPE[0]
    _ROW_SLOPE[0] = 0.0
    _hand_line(page, fitz.Point(x0, drop), fitz.Point(x1, drop), _STYLE_COLOR["language"], 1.2, rng,
               wobble=0.4, overshoot=1.0)
    _ROW_SLOPE[0] = saved

    text = _latin1(" ".join(str(ann.get("text") or "").split()))
    if not write_correction or not text:
        return
    size = max(6.0, min(11.0, line_h * 0.5))
    width = _pen_text_width(text, size)
    height = size * 1.15
    sheet = _CLIP[0]
    left = x0
    if sheet is not None and left + width > sheet.x1 - 4.0:
        left = max(sheet.x0 + 4.0, sheet.x1 - 4.0 - width)
    for top in (rect.y0 - height - 0.5, drop + 1.5):
        box = fitz.Rect(left, top, left + width, top + height)
        if sheet is not None and not sheet.contains(box):
            continue
        if _ink_under(_INK_MAP[0], box) > 0.06:
            continue
        if any(box.intersects(o) for o in page_boxes):
            continue
        _pen_text(page, fitz.Point(box.x0, box.y1 - size * 0.25), text, size,
                  _STYLE_COLOR["language"], rng, max_x=box.x1 + size, rise=0.0, tilt=0.0)
        page_boxes.append(box)
        return


def _draw_mark(page: Any, rect: Any, style: str, bounds: Any = None,
               has_note: bool = False) -> None:
    """Draw the teacher's mark for one annotation.

    Ticks and crosses go in the gutter beside the line rather than over it —
    handwriting is already hard enough to read without a glyph on top of it.
    Circles ring the text itself, which is the point of a circle.
    """
    import fitz

    colour = _STYLE_COLOR.get(style, _HIGHLIGHT)
    # Seeded on the mark itself: same script, same marks, every time.
    rng = _hand_rng(style, round(rect.x0, 1), round(rect.y0, 1), round(rect.width, 1))

    # OCR on cursive hands back fragment-width boxes; a line drawn at that
    # width renders as a meaningless dash. Floor the drawn span so the mark
    # reads as an underline/strike, not a speck.
    # Stop where the writing stops, and stop somewhere slightly different every
    # time. This used to clamp to `width - _SCORE_GUTTER - 4`, a constant - so
    # every rule on every page ended at the identical x, across six separate
    # photographs of a hand-held notebook. A critic spotted it in seconds and
    # called it fatal: "no hand can do that". The end is now the end of the
    # marked words, over- or under-shot by a few points.
    # A rule marks a PHRASE, not a line. Spanning the row's full text width was
    # the single dominant defect a critic found: "long straight full-width
    # lines, 1-3 per page on ALL SIX pages", scoring the script 2/10 on its own.
    # A teacher underlines the handful of words that matter and lifts the pen.
    right_edge = (bounds.x1 - 3.0) if bounds else (page.rect.width - 8.0)
    # Start at the first letter, stop at the last. Critics found underlines
    # beginning "left of the pink margin rule in blank paper" and trailing past
    # the final word - a pen starts and stops where the words do.
    # Where the words actually are. The layout's own span is preferred; when
    # it carries none (a scanned copy reached the renderer with no ink_x0/x1
    # on any row) measure the page itself. Without this the span was the ROW
    # BOX, which is pinned to the sheet edges - and every underline ran the
    # full width of the page, which the marking guide forbids outright.
    ink_span = _INK_SPAN[0] or _row_ink_span(_INK_MAP[0], rect)
    ink_a = max(ink_span[0] if ink_span else rect.x0, rect.x0)
    ink_b = min(ink_span[1] if ink_span else rect.x1, rect.x1)
    if ink_b - ink_a < 30.0:
        ink_a, ink_b = rect.x0, rect.x1
    span = max(ink_b - ink_a, 40.0)
    frac = rng.uniform(0.30, 0.62)
    start_at = ink_a + span * rng.uniform(0.0, max(0.0, 0.90 - frac))
    line_x0 = max(ink_a - rng.uniform(0.0, 3.0), start_at - 2.0)
    line_x1 = min(right_edge, ink_b + rng.uniform(0.0, 4.0),
                  start_at + max(38.0, span * frac))

    if style == "circle" and rect.width > 120.0 and not has_note:
        # No comment to anchor: a bare bracket in the margin tells the student
        # nothing. Eight of them stacked down the margins - one 200px from any
        # text - was called the clearest repeated-pattern signal left. Mark the
        # phrase instead.
        drop = rect.y1 + rng.uniform(2.5, 5.0)
        _hand_line(page, fitz.Point(line_x0, drop), fitz.Point(line_x1, drop),
                   colour, 1.4, rng)
        return

    if style == "circle" and rect.width > 120.0:
        # A ring is only honest around a short phrase. Around a whole line it
        # encloses blank margin and lands on a sentence opener - critics found
        # loops round "The loss of", "a partner," and "months after". At line
        # granularity a teacher draws a bracket in the margin instead.
        bx = max((bounds.x0 + 3.0) if bounds else 3.0, rect.x0 - rng.uniform(8.0, 22.0))
        top = rect.y0 - rng.uniform(0.5, 2.0)
        bot = rect.y1 + rng.uniform(0.5, 2.0)
        _hand_line(page, fitz.Point(bx, top), fitz.Point(bx, bot), colour, 1.5, rng,
                   wobble=1.0, overshoot=1.2)
        serif = rng.uniform(2.5, 8.0)
        _hand_line(page, fitz.Point(bx, top), fitz.Point(bx + serif, top - 0.5),
                   colour, 1.4, rng, wobble=0.5, overshoot=0.6)
        _hand_line(page, fitz.Point(bx, bot), fitz.Point(bx + serif, bot + 0.5),
                   colour, 1.4, rng, wobble=0.5, overshoot=0.6)
        return

    if style == "circle":
        # Ring a phrase, not the whole line. Row boxes span the full width of
        # the writing, so circling rect outright drew a page-wide ellipse -
        # the clearest single tell that a machine marked the script. A real
        # teacher loops a few words, so cap the ring at the line's start.
        # Sized to what it rings. The old cap meant every loop came out 297-308px
        # wide whatever was inside it, and on rows starting at the page margin
        # most of the loop enclosed blank paper with a word or two clipped at
        # the edge. A loop is now a fraction of the actual span, and starts at
        # the writing rather than at the row's left edge.
        span = max(rect.width, 40.0)
        ring_w = span * rng.uniform(0.30, 0.62)
        ring_w = max(46.0, min(ring_w, span))
        x0 = rect.x0 + span * rng.uniform(0.0, 0.10)
        oval = fitz.Rect(x0 - 3, rect.y0 - rng.uniform(1.0, 3.5),
                         x0 + ring_w, rect.y1 + rng.uniform(1.0, 3.5))
        _hand_oval(page, oval, colour, 1.6, rng)
        return

    if style in ("strike", "strikethrough"):
        # The reference never strikes the student's words out - a wrong point
        # gets marked beside it and corrected in the margin, and the student's
        # writing is left readable. Drawing through it reads as an editor on a
        # draft, not a teacher marking a script.
        drop = rect.y1 + rng.uniform(2.0, 4.0)
        saved = _ROW_SLOPE[0]
        _ROW_SLOPE[0] = 0.0
        _hand_line(page, fitz.Point(line_x0, drop), fitz.Point(line_x1, drop),
                   colour, 1.3, rng, wobble=0.5)
        _ROW_SLOPE[0] = saved
        return

    if style == "underline":
        # The reference's underlines are the one mark drawn DEAD FLAT - every
        # other stroke follows the page, but a quick drag under a word does
        # not - and they are noticeably lighter than the rest of the ink.
        drop = rect.y1 + rng.uniform(2.0, 4.0)
        saved = _ROW_SLOPE[0]
        _ROW_SLOPE[0] = 0.0
        # A shade lighter, as a quick drag from the same pen would be - not 40%,
        # which reads as a second colour rather than lighter pressure.
        light = tuple(min(1.0, c + (1.0 - c) * 0.18) for c in colour)
        _hand_line(page, fitz.Point(line_x0, drop), fitz.Point(line_x1, drop),
                   light, 1.1, rng, wobble=0.5)
        _ROW_SLOPE[0] = saved
        return

    if style == "brace":
        # Down the margin beside the block, on whichever side has room.
        sheet_x0 = (bounds.x0 + 2.0) if bounds else 2.0
        ink_a = _INK_SPAN[0][0] if _INK_SPAN[0] else rect.x0
        x = ink_a - rng.uniform(7.0, 14.0)
        if x < sheet_x0 + 3.0:
            x = (_INK_SPAN[0][1] if _INK_SPAN[0] else rect.x1) + rng.uniform(7.0, 14.0)
        _draw_brace(page, rect.y0 + 1.0, rect.y1 - 1.0, x, colour, rng)
        return

    if style in ("feedback", "deduction_reason", "score"):
        # The written text IS the mark for these. Adding a rule or a ring on
        # top reads as two marks for one comment.
        return

    if style == "summary":
        # The closing remark carries no stroke of its own - the note and the
        # circled total ARE the mark. Drawing a rule under it as well read as
        # two marks for one comment.
        return

    if style in ("tick", "cross"):
        # A tick is the mark a student looks for first, so it has to be visible
        # at a glance on a photographed page. The old 7-13pt range disappeared
        # against dense handwriting; this is roughly a pen tick's real size.
        # Six ticks measured 56/55/53/56/52/43px with identical arm angles - a
        # critic called them clones. One hand varies its tick a lot more than
        # that while keeping a recognisable style.
        # Size varies 2-3x across a script, not 1.5x, and gets scrappier as the
        # marker works down the page.
        # Never small. Varying size is right, but the low end produced ticks a
        # student would miss - "the green tick is small" was the first thing
        # the person who actually has to use this said about it.
        # Sized to sit BETWEEN the ruled lines. At 1.35-2.4x the row height a
        # tick necessarily hangs into the line above and the line below, and
        # those lines' writing runs further right - which is why nine of them
        # landed on the student's words however carefully the row itself was
        # cleared. The reference marker's ticks are about 1.2x the student's
        # x-height, i.e. roughly one row tall, and still perfectly visible.
        # v3 asks for 1.5-2.5x the height of the nearby handwriting: a tick is
        # the mark a student looks for first. It can be this big only because
        # the probe below measures the ink across the tick's WHOLE vertical
        # extent, so a tick that hangs into its neighbours still clears their
        # writing rather than landing on it.
        size = max(20.0, min(40.0, rect.height * rng.uniform(1.5, 2.2)))
        # Prefer the left margin, the way a script is normally marked. A tick
        # big enough to see rarely fits the margin outright, so squeeze it to
        # the page edge before giving up; only writing that genuinely starts at
        # the edge sends the mark right. The right-hand fallback must clear
        # _SCORE_GUTTER or it lands under the circled mark for that question.
        sheet_x0 = (bounds.x0 + 2.0) if bounds else 2.0
        sheet_x1 = (bounds.x1 - 2.0) if bounds else (page.rect.width - 4.0)
        # The paper as the mask measured it on this row, which on a scan sits
        # inside the sheet rect: a tick parked at "the right margin" of the
        # sheet rect overhung the paper and was drawn gated to a bar.
        _lo, _hi = _paper_span(_PAPER[0], rect.y0, rect.y1)
        if _lo is not None:
            sheet_x0 = max(sheet_x0, _lo + 2.0)
        if _hi is not None:
            sheet_x1 = min(sheet_x1, _hi - 2.0)
        # A third of the time the tick goes at the END of the words, the way a
        # marker flicks one down as they finish reading a point, instead of
        # every single tick being parked in the same margin column.
        # Just past the last word is where the reference puts its ticks, and it
        # keeps them well inside the sheet. Prefer that strongly.
        cy = rect.y0 + (rect.height - size) / 2.0 + rng.uniform(-3.0, 3.0)
        # A tick runs 1.35-2.4x the height of its own row, so it hangs into the
        # lines above and below - and those lines' writing may run further
        # right. Clearing only its own row put six ticks through the student's
        # words. Ask about the band the tick will really occupy.
        # Start from where THIS line's writing ends, so the tick tracks each
        # answer the way a marker's hand does. Taking the widest ink across the
        # tick's whole (tall) band instead collapsed every tick on a page into
        # one rigid column within 2px - and any line running past that column
        # got ticked through its last word.
        own = _row_ink_span(_INK_MAP[0], rect)
        own_end = (own[1] if own
                   else (_INK_SPAN[0][1] if _INK_SPAN[0] else rect.x1))
        end_x = own_end + rng.uniform(8.0, 26.0)
        # Then step clear of anything the tick's own height reaches into.
        probe_h = fitz.Rect(rect.x0, cy, rect.x1, cy + size)
        covered = _row_ink_span(_INK_MAP[0], probe_h)
        if covered is not None:
            for _ in range(12):
                if end_x > covered[1] + 6.0 or end_x + size > sheet_x1 - 12.0:
                    break
                end_x += 6.0
        notes = _PLACED[0] or []

        def _above_notes(x: float, y: float, sz: float) -> tuple[float, float]:
            # A comment written under this row starts a point or two below
            # it, so a tick centred on the row and taller than the row hangs
            # into that comment whatever x it is given. Stand the tick on
            # the row's base instead - its foot just above the comment - and
            # let it be as small as a tick is allowed to be. That, not a
            # shift along the row, is how the mark stays beside its words.
            below = [n for n in notes
                     if rect.y1 - 3.0 <= n.y0 < y + sz + 1.0 and n.y1 > rect.y1
                     and n.x1 > x - 4.0 and n.x0 < x + sz + 4.0]
            if not below:
                return y, sz
            limit = min(n.y0 for n in below) - 1.0
            sz = max(20.0, min(sz, limit - rect.y0 + 2.0))
            return limit - sz, sz

        def _mark_box(x: float, y: float, sz: float) -> Any:
            # A hand's width clear of writing along the row; the comment
            # boxes already carry their own ink margin above and below.
            return fitz.Rect(x - 4, y - 1, x + sz + 4, y + sz + 1)

        def _inked(x: float, y: float, sz: float) -> bool:
            return _ink_under(_INK_MAP[0], fitz.Rect(x, y, x + sz, y + sz)) > 0.03

        def _settle(x: float) -> Optional[tuple[float, float, float]]:
            # The spot a tick takes at x, or None. Just past the note, or
            # not on this side at all: one red mark drawn through another
            # is worse than one on the student. The shifted spot is tested
            # again - stepping past the comment under a row put the tick
            # straight through that row's score, which sat next along the
            # same line. And the tick's whole box is asked about ink, not
            # just its own row: the probe above only looks between the
            # row's own ends, so a short row like "Li = Lr" had its tick
            # drawn up into the "(Lr)" that the line above ran on to.
            for _ in range(10):
                y, sz = _above_notes(x, cy, size)
                hits = [n for n in notes if _mark_box(x, y, sz).intersects(n)]
                if hits:
                    x = max(n.x1 for n in hits) + rng.uniform(6.0, 14.0)
                    if x + sz > sheet_x1 - 12.0:
                        return None
                    continue
                if _inked(x, y, sz):
                    # A row-tall tick first - it stays beside its words -
                    # then a step to the right.
                    small = max(20.0, min(sz, rect.height + 2.0))
                    ys = rect.y0 + (rect.height - small) / 2.0
                    if small < sz - 1.0 and not _inked(x, ys, small) and not any(
                            _mark_box(x, ys, small).intersects(n) for n in notes):
                        return x, ys, small
                    x += 6.0
                    if x + sz > sheet_x1 - 12.0:
                        return None
                    continue
                return x, y, sz
            return None

        if end_x + size <= sheet_x1 - 12.0:
            spot = _settle(end_x)
            cx = None
            if spot is not None:
                cx, cy, size = spot
            if cx is not None:
                box = _mark_box(cx, cy, size)
                if _on_paper(_PAPER[0], box):
                    logger.debug("TICKPLACE site=right style=%s cx=%.1f cy=%.1f size=%.1f "
                                 "own=%s end_x=%.1f sheet=(%.1f,%.1f) rect=%s",
                                 style, cx, cy, size, own, end_x, sheet_x0, sheet_x1, rect)
                    _draw_tick_or_cross(page, style, cx, cy, size, colour, rng,
                                        rect, line_x0, line_x1)
                    return
                logger.debug("tick would fall off the paper; trying the margin")
        # Fallback placement. Prefer just past the row's MEASURED ink: a tick
        # belongs beside the words it approves. The row BOX is no guide here -
        # the layout pins it to the sheet edge on most rows, so the right-hand
        # test above fails and this fallback used to drop straight to the
        # sheet's left edge. Measured on one copy that parked 17 of 49 marks
        # in a single column on the printed margin rule, where a tick renders
        # as a 3pt vertical bar - the clearest possible tell that no teacher
        # held the pen, and the MCQ answers beside it got nothing at all.
        ink_end = own[1] if own else (_INK_SPAN[0][1] if _INK_SPAN[0] else None)
        cx = None
        if ink_end is not None and ink_end + 6.0 + size <= sheet_x1 - 12.0:
            cx = ink_end + rng.uniform(6.0, 14.0)
        if cx is None:
            left_x = rect.x0 - size - 3
            if left_x >= sheet_x0:
                cx = left_x
            elif rect.x0 > sheet_x0 + 6:
                cx = sheet_x0
            else:
                cx = min(rect.x1 + 4, sheet_x1 - size)
        cx = max(sheet_x0 + 2.0, min(cx, sheet_x1 - size - 12.0))
        cy = rect.y0 + (rect.height - size) / 2.0

        # A mark is never drawn narrower than its own gesture. When the chosen
        # spot is not wholly on the paper the strokes are gated away one
        # segment at a time and what survives is a 2-4pt vertical sliver
        # against the printed margin rule - measured at 17 of 49 marks on one
        # copy, with the MCQ answers beside them left unticked. Try the places
        # a marker would actually use, and if none of them fits, write nothing
        # here rather than leave a bar.
        def _free(x: float) -> Optional[tuple[float, float]]:
            # On the paper, and not through a comment or score already
            # written there - the fallback used to test only the paper.
            # Returns the (cy, size) the tick takes at that x, or None.
            y, sz = _above_notes(x, cy, size)
            probe = fitz.Rect(x, y, x + sz, y + sz)
            if not _on_paper(_PAPER[0], probe):
                return None
            if any(_mark_box(x, y, sz).intersects(n) for n in notes):
                return None
            if _inked(x, y, sz):
                small = max(20.0, min(sz, rect.height + 2.0))
                ys = rect.y0 + (rect.height - small) / 2.0
                if small < sz - 1.0 and not _inked(x, ys, small) and not any(
                        _mark_box(x, ys, small).intersects(n) for n in notes):
                    return ys, small
                return None
            return y, sz

        fit = _free(cx)
        if fit is None:
            spots = []
            if ink_end is not None:
                spots.append(ink_end + 6.0)          # just after the words
            spots.append(rect.x0 - size - 3.0)       # before the first word
            spots.append(sheet_x0 + 2.0)             # the left margin itself
            spots.append(sheet_x1 - size - 12.0)     # the right margin
            placed = False
            for trial in spots:
                trial = max(sheet_x0 + 2.0, min(trial, sheet_x1 - size - 12.0))
                fit = _free(trial)
                if fit is not None:
                    cx, placed = trial, True
                    break
            if not placed:
                logger.debug("no room for a whole %s on row %s; skipped rather "
                             "than drawing a sliver", style, rect)
                return
        cy, size = fit

        logger.debug("TICKPLACE site=fallback style=%s cx=%.1f cy=%.1f size=%.1f "
                     "own=%s ink_end=%s sheet=(%.1f,%.1f) rect=%s",
                     style, cx, cy, size, own, ink_end, sheet_x0, sheet_x1, rect)
        _draw_tick_or_cross(page, style, cx, cy, size, colour, rng, rect,
                            line_x0, line_x1)
        return

    # margin_note / region_note / anything unrecognised: underline the span so
    # the note in the margin has something to point at - but only a SHORT one.
    # The marking guide forbids a rule across a whole line, and on a scanned
    # copy the printed ruling is read as ink, so the measured span can run
    # the full width of the sheet. A pointer that long is a full-width line by
    # another name: measured at five per copy. Beyond a third of the sheet, a
    # comment sits under its row well enough with no pointer at all.
    sheet_w = (bounds.width if bounds else page.rect.width)
    if (line_x1 - line_x0) <= sheet_w * 0.34:
        _hand_line(page, fitz.Point(line_x0, rect.y1 + 1),
                   fitz.Point(line_x1, rect.y1 + 1), colour, 1.0, rng)


def _note_rect(slot, width: float, height: float):
    """The rectangle a written note occupies, so later notes treat it as taken."""
    import fitz
    x, y_top = slot
    return fitz.Rect(x, y_top, x + width, y_top + height)


def _free_slot(candidates, occupied, width: float, height: float, page: Any,
               sheet: Any = None, lift: float = 0.0, imap: Optional[dict] = None):
    """First candidate (x, y_top) whose text box clears every occupied rect.

    `sheet` is the detected paper. A note written past its edge lands on the
    desk or the scanner's white padding, which is the one place a teacher's pen
    never reaches.
    """
    import fitz

    limit = sheet if sheet is not None else page.rect
    # Test against slightly grown obstacles. Glyphs are drawn with baseline
    # drift and per-letter rotation, so the ink they actually cover is a little
    # larger than the box reserved for them; without the margin a note can
    # clip the tops of the student's letters.
    grown = [fitz.Rect(o.x0 - 1.5, o.y0 - 1.5, o.x1 + 1.5, o.y1 + 1.5) for o in occupied]
    for x, y_top in candidates:
        # The block is drawn a `lift` ABOVE its anchor, because a climbing line
        # ends higher than it starts. Reserving the rect at the anchor while
        # recording it at the true top meant the space checked was not the
        # space used, and notes were cleared into each other.
        top = y_top - lift
        if top < limit.y0 + 2 or top + height > limit.y1 - 2:
            continue
        box = fitz.Rect(x, top, x + width, top + height)
        if box.x1 > limit.x1 - 2 or box.x0 < limit.x0 + 1:
            continue
        if any(box.intersects(o) for o in grown):
            continue
        # And the writing itself. The layout's row boxes miss ink that never
        # became a row, which is how a comment ended up laid across five
        # consecutive lines of the answer.
        if imap is not None and _ink_under(imap, box) > 0.02:
            continue
        # The paper is the only canvas. A slot that runs off the sheet onto a
        # bedsheet, a desk or the scanner's white ground is not somewhere a
        # teacher's pen could have reached.
        if not _on_paper(_PAPER[0], box):
            continue
        return x, y_top
    return None


def _ink_map(page: Any, sheet: Any) -> Optional[dict]:
    """Where the student's ink actually is, measured off the page image.

    The layout map's per-row ``ink_x1`` came back pinned to the sheet's right
    edge on every row of all 13 pages of a real copy, so nothing downstream
    could tell where a line of writing ends. Marks were placed as if every row
    ran the full width: ticks landed on top of words, notes found no column to
    sit in, and the mark figure fell inside a sentence.

    The picture knows. Dark pixels on a light page are writing, measured
    against a per-row background so a dark scan does not read as solid ink,
    and inside the sheet so the desk around the photograph cannot pollute it.
    Must be called before any mark is drawn.
    """
    try:
        import fitz
        import numpy as np

        pix = page.get_pixmap(dpi=100)
        arr = np.frombuffer(pix.samples, np.uint8).reshape(
            pix.height, pix.width, pix.n)[:, :, :3].astype("int16")
        grey = arr.mean(axis=2)
        sx, sy = page.rect.width / pix.width, page.rect.height / pix.height
        x0 = max(0, min(pix.width - 1, int((sheet.x0 if sheet else 0) / sx)))
        x1 = max(x0 + 1, min(pix.width, int((sheet.x1 if sheet else page.rect.width) / sx)))
        band = grey[:, x0:x1]
        if band.size == 0:
            return None
        # Per-row background: page 7 of the copy is a dark scan whose median
        # sits below any fixed threshold, which collapsed it to solid ink.
        bg = np.median(band, axis=1, keepdims=True)
        ink = band < (bg - 45.0)
        # The notebook's own printed ruling is dark too, and on a scan it
        # reads as ink running edge to edge on every ruled row. Then nothing
        # downstream can find a blank band or the end of a line: comments
        # reported "no free band" on every page, ticks were pushed off the
        # right and parked in the left margin, and a pointer underline ran
        # the full width of the sheet. A rule is 1-3px tall at this
        # resolution; the pen is not. A vertical opening keeps only ink at
        # least a few pixels tall, which drops every rule however it wanders
        # and keeps the handwriting.
        try:
            import cv2
            kh = max(3, int(round(pix.height / 1170.0 * 4)))
            ink = cv2.morphologyEx(ink.astype(np.uint8), cv2.MORPH_OPEN,
                                   np.ones((kh, 1), np.uint8)).astype(bool)
        except Exception:
            logger.debug("ruling not removed from the ink map", exc_info=True)
        # Vertical lines are not writing either: the printed margin rule, and
        # on a phone scan the dark strip where the page edge meets the
        # scanner's shadow. That strip read as ink on EVERY row, so each
        # row's writing appeared to run to the sheet edge, every right-margin
        # score was pushed off the paper, and every note reported no room.
        # A column inked down more than 40% of the page is a line, not text.
        col_cov = ink.mean(axis=0)
        ink[:, col_cov > 0.40] = False
        return {"ink": ink, "sx": sx, "sy": sy, "x0": x0}
    except Exception:
        logger.debug("could not measure the ink map", exc_info=True)
        return None


def _words_end(imap: Optional[dict], rect: Any, max_gap: float) -> Optional[float]:
    """Where the row's WORDS end, in points: the right end of the run of ink
    that starts at the row and has no blank stretch wider than `max_gap`.

    _row_ink_span reports the right-most ink on the row, which on a phone
    photo is often not writing at all - the dark sheet edge or a shadow at the
    far side put one row's "end" at x=1451 when its words stopped at 602, and
    a remark that had half the page to sit in was refused for want of room.
    """
    if not imap:
        return None
    try:
        import numpy as np

        ink, sy, sx, off = imap["ink"], imap["sy"], imap["sx"], imap["x0"]
        y0 = max(0, min(ink.shape[0] - 1, int(rect.y0 / sy)))
        y1 = max(y0 + 1, min(ink.shape[0], int(rect.y1 / sy)))
        cols = np.nonzero(ink[y0:y1].sum(axis=0) > 2)[0]
        if cols.size == 0:
            return None
        first = int(max(0, rect.x0 / sx - off))
        cols = cols[cols >= first - int(max_gap / sx)]
        if cols.size == 0:
            return None
        end = int(cols[0])
        for c in cols[1:].tolist():
            if (c - end) * sx > max_gap:
                break
            end = c
        return (off + end) * sx
    except Exception:
        return None


def _row_ink_span(imap: Optional[dict], rect: Any) -> Optional[tuple]:
    """(left, right) of the writing on the rows this rect covers, in points."""
    if not imap:
        return None
    try:
        import numpy as np

        ink = imap["ink"]
        sy = imap["sy"]
        y0 = max(0, min(ink.shape[0] - 1, int(rect.y0 / sy)))
        y1 = max(y0 + 1, min(ink.shape[0], int(rect.y1 / sy)))
        rows = ink[y0:y1]
        if rows.size == 0:
            return None
        # A printed rule inks a column on one or two scanlines; handwriting
        # inks several. Requiring depth keeps the notebook's own ruling from
        # reading as writing that runs to the page edge.
        cols = np.nonzero(rows.sum(axis=0) > 2)[0]
        if cols.size == 0:
            return None
        sx, off = imap["sx"], imap["x0"]
        # Two pixels of ink at the page edge are not where the line ends. On a
        # phone scan the printed rule curls where it meets the edge, leaving a
        # 2pt speck on every row; taking cols.max() then said every line ran
        # to x=570 and pushed every right-margin score off the paper. Walk the
        # runs and drop a narrow run that sits far from its nearest neighbour.
        runs: list[list[int]] = []
        for c in cols.tolist():
            if runs and c - runs[-1][1] <= 3:
                runs[-1][1] = c
            else:
                runs.append([c, c])
        min_w = max(3.0, 5.0 / sx)              # narrower than ~5pt
        far = 40.0 / sx                          # further than ~40pt away
        keep = []
        for i, (a, b) in enumerate(runs):
            narrow = (b - a + 1) < min_w
            prev_gap = a - runs[i - 1][1] if i > 0 else float("inf")
            next_gap = runs[i + 1][0] - b if i + 1 < len(runs) else float("inf")
            if narrow and min(prev_gap, next_gap) > far:
                continue
            keep.append((a, b))
        if not keep:
            keep = [(runs[0][0], runs[-1][1])]
        return ((off + keep[0][0]) * sx, (off + keep[-1][1]) * sx)
    except Exception:
        return None


def _paper_quad(rgb: Any) -> Any:
    """Boolean mask of the notebook paper in a page raster. True = paper.

    Replaces a brightness-and-largest-blob rule that was measured admitting
    only 14% of the students' OWN handwriting - on three pages of thirteen it
    admitted nothing at all, so those pages came back unmarked. Two kinds of
    picture, detected rather than assumed:

      PHOTO  a phone photograph of an open notebook on a bedsheet. Paper is
             bright AND achromatic; the bedsheet, the cartoon blanket and the
             hand holding the page are all strongly coloured, so score by
             lightness minus chroma rather than lightness alone - that is what
             the old rule got wrong, because a lit patch of blanket outscored
             a shadowed half of the page. Then fit a convex quadrilateral to
             the blob and FILL it: an open spread is two quads hinged at the
             gutter, not one, so a single 4-gon either clips a leaf or swallows
             a wedge of bedsheet.

      SCAN   a sheet pasted on a white PDF canvas. The sheet's own background
             is the same pure white as the canvas, so brightness cannot outline
             it - keeping the non-white pixels returned the handwriting only,
             which is exactly why the scanned copy came back nearly blank. Take
             the extent of its content instead.

    The mask must be the whole sheet - gutter, fingers, blank rows between
    lines - because a blank row with no paper admits no mark on that row.
    """
    import numpy as np
    import cv2

    a = np.clip(np.asarray(rgb), 0, 255).astype(np.uint8)
    H, W = a.shape[:2]

    # Everything that is not the flat white PDF canvas.
    v_all = a.mean(axis=2)
    s_all = a.max(axis=2).astype(int) - a.min(axis=2).astype(int)
    nw = ~((v_all > 250) & (s_all < 8))
    ys = np.nonzero(nw.any(axis=1))[0]
    xs = np.nonzero(nw.any(axis=0))[0]
    if not ys.size or not xs.size:
        return np.zeros((H, W), bool)
    y0, y1, x0, x1 = ys[0], ys[-1] + 1, xs[0], xs[-1] + 1
    sub = a[y0:y1, x0:x1]
    if sub.size == 0:
        return np.zeros((H, W), bool)

    h, w = sub.shape[:2]
    v = sub.mean(axis=2)
    s = sub.max(axis=2).astype(int) - sub.min(axis=2).astype(int)
    out = np.zeros((H, W), bool)

    if float(((v > 250) & (s < 8)).mean()) > 0.35:
        # SCAN: the sheet is the extent of its own content.
        #
        # Restricted to ACHROMATIC content. A scan is grey ruling and blue or
        # black ink on white, all low-saturation, so this costs nothing here -
        # but it is what stops the branch handing back the whole frame if a
        # brightly lit photograph is ever misrouted into it. Taking every
        # non-white pixel would make a patterned bedsheet part of the sheet
        # and switch the boundary rule off altogether, silently.
        content = (v < 250) & (s < 60)
        # By COVERAGE, never by any(). One stray pixel decides a bounding box:
        # a single pale anti-aliasing pixel where the sheet meets the
        # background - measured at RGB(238,180,217), just inside the
        # achromatic test - stretched this box to the whole frame and made the
        # bedsheet paper. The same trap caught the "Scanned with ... Scanner"
        # caption in _photo_bounds. Take the first and last row and column
        # that carry real content, then fill everything between them, so the
        # blank paper between two written lines is still paper.
        rows_ok = np.nonzero(content.mean(axis=1) > 0.01)[0]
        cols_ok = np.nonzero(content.mean(axis=0) > 0.01)[0]
        m = np.zeros((h, w), bool)
        if rows_ok.size and cols_ok.size:
            m[rows_ok[0]:rows_ok[-1] + 1, cols_ok[0]:cols_ok[-1] + 1] = True
        out[y0:y1, x0:x1] = m
        return out

    # PHOTO: paperness = bright and achromatic.
    lab = cv2.cvtColor(sub, cv2.COLOR_RGB2LAB)
    L = lab[:, :, 0].astype(np.float32)
    A = lab[:, :, 1].astype(np.float32) - 128.0
    B = lab[:, :, 2].astype(np.float32) - 128.0
    chroma = np.sqrt(A * A + B * B)
    score = np.clip(L - 2.0 * chroma, -60.0, 255.0)
    rng = max(1e-6, float(score.max() - score.min()))
    score = ((score - score.min()) / rng * 255.0).astype(np.uint8)

    thr, _ = cv2.threshold(score, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # Loosen Otsu: paper in shadow is dim, and losing it costs a whole leaf.
    bw = (score >= max(1.0, thr - 10)).astype(np.uint8)
    k = max(3, int(round(min(h, w) * 0.012)) | 1)
    se = np.ones((k, k), np.uint8)
    bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, se)
    bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, se)

    nlab, lbl, stats, _ = cv2.connectedComponentsWithStats(bw, 8)
    if nlab <= 1:
        return out
    areas = stats[1:, cv2.CC_STAT_AREA]
    big = int(np.argmax(areas)) + 1
    keep = (lbl == big)
    for i in range(1, nlab):        # the far leaf of a spread, a lit corner
        if i != big and stats[i, cv2.CC_STAT_AREA] > 0.08 * areas.max():
            keep |= (lbl == i)

    def quad(points: Any) -> Any:
        hull = cv2.convexHull(points)
        peri = cv2.arcLength(hull, True)
        for f in np.linspace(0.005, 0.15, 60):
            ap = cv2.approxPolyDP(hull, f * peri, True)
            if len(ap) <= 4:
                if len(ap) == 4:
                    return ap.reshape(-1, 2).astype(np.int32)
                break
        return cv2.boxPoints(cv2.minAreaRect(hull)).astype(np.int32)

    def fill(poly: Any) -> Any:
        o = np.zeros((h, w), np.uint8)
        cv2.fillConvexPoly(o, poly, 1)
        return o

    yy, xx = np.nonzero(keep)
    if xx.size < 50:
        return out
    pts = np.stack([xx, yy], 1).astype(np.int32).reshape(-1, 1, 2)
    total = float(keep.sum())

    def merit(f: Any) -> float:
        return float((f & keep).sum() - 0.35 * (f & ~keep).sum()) / total

    best_fill = fill(quad(pts))
    best = merit(best_fill.astype(bool))
    # Sweep the gutter: two quads beat one whenever the picture is a spread.
    for c in np.linspace(0.12 * w, 0.88 * w, 35):
        left = pts[pts[:, 0, 0] < c].reshape(-1, 1, 2)
        right = pts[pts[:, 0, 0] >= c].reshape(-1, 1, 2)
        if len(left) < 80 or len(right) < 80:
            continue
        f = fill(quad(left)) | fill(quad(right))
        m = merit(f.astype(bool))
        if m > best:
            best, best_fill = m, f

    grown = best_fill.astype(bool) | keep
    d = max(1, int(round(6 * min(h, w) / 264.0)))
    grown = cv2.dilate(grown.astype(np.uint8),
                       np.ones((2 * d + 1, 2 * d + 1), np.uint8)).astype(bool)

    # A page that runs off the picture is cut by the frame, not by its edge.
    snap = int(round(0.03 * max(h, w)))
    if snap > 0:
        for r in range(h):
            c = np.nonzero(grown[r])[0]
            if not c.size:
                continue
            if c[-1] >= w - 1 - snap:
                grown[r, c[-1]:] = True
            if c[0] <= snap:
                grown[r, :c[0]] = True
        for c in np.nonzero(grown.any(axis=0))[0]:
            rr = np.nonzero(grown[:, c])[0]
            if rr[0] <= snap:
                grown[:rr[0], c] = True
            if rr[-1] >= h - 1 - snap:
                grown[rr[-1]:, c] = True

    out[y0:y1, x0:x1] = grown
    return out


def _writing_hull(writing: list, sx: float, sy: float, H: int, W: int) -> Any:
    """Raster mask (H x W) of the convex hull around the student's rows."""
    import numpy as np
    import cv2

    pts = []
    for r in writing:
        for x, y in ((r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)):
            pts.append([min(W - 1, max(0, int(x / sx))), min(H - 1, max(0, int(y / sy)))])
    out = np.zeros((H, W), np.uint8)
    if len(pts) >= 3:
        hull = cv2.convexHull(np.array(pts, np.int32).reshape(-1, 1, 2))
        cv2.fillConvexPoly(out, hull, 1)
    return out.astype(bool)


def _paper_rows(page: Any, writing: Optional[list] = None) -> Optional[dict]:
    """The notebook page's own boundary for this page.

    Returns the paper MASK plus, for callers that still want them, the
    per-raster-row spans. The mask is what the gate should test: a span is one
    horizontal interval per row, which cannot describe a page photographed at
    an angle - at the top and bottom of a tilted sheet the interval reaches
    past the corners and over the bedsheet beside them.

    `writing` - the student's rows in points, as confirmed by the vision read -
    is paper by definition, and so is everything between them. The photo rule
    alone reads a strong shadow's edge as the sheet's edge: on 2026-09-30 it
    called 40% of a lit, fully written page "off paper", and every deduction
    note aimed there (Q23, Q27, Q37 and four "Correct: ..." notes on one copy)
    was dropped.
    """
    try:
        import numpy as np

        pix = page.get_pixmap(dpi=40)
        a = np.frombuffer(pix.samples, np.uint8).reshape(
            pix.height, pix.width, pix.n)[:, :, :3].astype(int)
        H, W = a.shape[:2]
        mask = _paper_quad(a)
        sx, sy = page.rect.width / W, page.rect.height / H
        if writing:
            mask = mask | _writing_hull(writing, sx, sy, H, W)
        if not mask.any():
            return None

        lo = np.full(H, -1.0); hi = np.full(H, -1.0)
        for r in range(H):
            cols = np.nonzero(mask[r])[0]
            if cols.size:
                lo[r], hi[r] = cols.min() * sx, (cols.max() + 1) * sx
        if not (hi > 0).any():
            return None
        return {"lo": lo, "hi": hi, "sy": sy, "sx": sx,
                "rows": H, "cols": W, "mask": mask}
    except Exception:
        logger.debug("could not measure the paper boundary", exc_info=True)
        return None
def _on_paper(paper: Optional[dict], box: Any) -> bool:
    """True only if every row the box covers is paper for its full width."""
    if not paper:
        return True
    lo, hi, sy = paper["lo"], paper["hi"], paper["sy"]
    r0 = max(0, min(paper["rows"] - 1, int(box.y0 / sy)))
    r1 = max(r0 + 1, min(paper["rows"], int(box.y1 / sy) + 1))
    mask = paper.get("mask")
    if mask is not None:
        # The same 1pt slack the span test below allows. The mask is measured
        # at 40dpi, so one cell is ~1.8pt: without slack a row box pinned 0.3pt
        # past the sheet edge - a third of one cell, and far less than the
        # width of the pen - is called off-paper, which rejected nine of the
        # twenty-four lines on one scanned page.
        sx, sy = paper["sx"], paper["sy"]
        r0 = max(0, min(paper["rows"] - 1, int((box.y0 + _PAPER_TOL) / sy)))
        r1 = max(r0 + 1, min(paper["rows"], int((box.y1 - _PAPER_TOL) / sy) + 1))
        c0 = max(0, min(paper["cols"] - 1, int((box.x0 + _PAPER_TOL) / sx)))
        c1 = max(c0 + 1, min(paper["cols"], int((box.x1 - _PAPER_TOL) / sx) + 1))
        return bool(mask[r0:r1, c0:c1].all())
    for r in range(r0, r1):
        if hi[r] <= 0:
            return False                       # no paper at all on this row
        if box.x0 < lo[r] - 1.0 or box.x1 > hi[r] + 1.0:
            return False
    return True


def _paper_span(paper: Optional[dict], y0: float, y1: float
                ) -> tuple[Optional[float], Optional[float]]:
    """(leftmost, rightmost) paper x in points common to every row y0..y1."""
    if not paper or paper.get("mask") is None:
        return None, None
    mask, sx, sy = paper["mask"], paper["sx"], paper["sy"]
    r0 = max(0, min(paper["rows"] - 1, int(y0 / sy)))
    r1 = max(r0 + 1, min(paper["rows"], int(y1 / sy) + 1))
    los, his = [], []
    for r in range(r0, r1):
        cols = mask[r].nonzero()[0]
        if cols.size:
            los.append(cols.min() * sx)
            his.append((cols.max() + 1) * sx)
    if not los:
        return None, None
    return max(los), min(his)


def _paper_right_edge(paper: Optional[dict], y0: float, y1: float) -> Optional[float]:
    """Rightmost paper x (pt) over rows y0..y1, from the paper mask; None if unknown."""
    if not paper or paper.get("mask") is None:
        return None
    mask, sx, sy = paper["mask"], paper["sx"], paper["sy"]
    r0 = max(0, min(paper["rows"] - 1, int(y0 / sy)))
    r1 = max(r0 + 1, min(paper["rows"], int(y1 / sy) + 1))
    edges = []
    for r in range(r0, r1):
        cols = mask[r].nonzero()[0]
        if cols.size:
            edges.append((cols.max() + 1) * sx)
    return min(edges) if edges else None


def _photo_bounds(page: Any) -> Optional[Any]:
    """The extent of the scanned photograph on this page.

    A scan sits on a white PDF canvas, and that canvas is not paper. Ink drawn
    there floats on flat 255-white beside the scanner's own watermark, with no
    grain under a single letter - the loudest possible tell. Neither the
    detected paper box nor the ink boxes can be trusted to say where the paper
    ends: on a failed detection BOTH span the whole frame. The photograph's own
    bound can, because the canvas around it is pure white by construction.

    Must be measured before anything is drawn, or our own marks widen it.
    """
    try:
        import fitz
        import numpy as np

        pix = page.get_pixmap(dpi=36)
        arr = np.frombuffer(pix.samples, np.uint8).reshape(
            pix.height, pix.width, pix.n)[:, :, :3]
        nonwhite = arr.min(axis=2) < 246
        # By COVERAGE, not by any single dark pixel. The scanner prints its own
        # watermark ("Scanned with ... Scanner") on the white canvas below the
        # photograph; a bare any() call reads that line as content and runs the
        # bound to the foot of the page, which is the very strip we must keep
        # ink out of. A photograph fills its rows; a caption does not.
        row_cov = nonwhite.mean(axis=1)
        col_cov = nonwhite.mean(axis=0)
        # Half the width. A photograph fills its rows; the scanner's caption
        # line covers about a third, and at a 0.25 cut it still passed - which
        # ran the bound to the foot of the page, handing the placer a strip of
        # bare canvas to write on. At 0.5 this bound lands within 5pt of the
        # independently detected paper box on all 13 pages of a real copy.
        rows = np.nonzero(row_cov > 0.5)[0]
        cols = np.nonzero(col_cov > 0.5)[0]
        if rows.size == 0 or cols.size == 0:
            return None
        # A page is never a sliver. On a SCAN the sheet is the same white as
        # the canvas, so the only column more than half non-white is the
        # printed pink margin rule - and this returned a 3pt-wide "photograph"
        # at x=84. Intersected with the sheet, that gave every mark on the
        # page a zero-width home: 17 of 49 ticks were clamped onto the rule and
        # rendered as vertical bars, while the MCQ answers beside them got
        # nothing. The validation above was on photographs only. When the
        # bound is narrower than a quarter of the frame it has found a rule,
        # not a page; say so and let the caller fall back to the ink box.
        if (cols.max() + 1 - cols.min()) < 0.25 * pix.width:
            logger.debug("photo bound %.0f-%.0fpx is a rule, not a page; ignoring",
                         float(cols.min()), float(cols.max()))
            return None
        sx, sy = page.rect.width / pix.width, page.rect.height / pix.height
        return fitz.Rect(float(cols.min()) * sx, float(rows.min()) * sy,
                         float(cols.max() + 1) * sx, float(rows.max() + 1) * sy)
    except Exception:
        logger.debug("could not measure the photograph bound", exc_info=True)
        return None


# The scanner app's own caption below the photograph ("Scanned with OKEN
# Scanner", "Scanned by CamScanner"). The vision read transcribes it like any
# other line, but it sits on the white canvas, not on the paper.
_SCANNER_CAPTION = re.compile(r"\bscanned\s+(?:with|by|using)\b|\bcam\s*scanner\b", re.I)


def _reach_written_rows(photo: Any, lpage: dict[str, Any], psx: float, psy: float,
                        limit: Any) -> Any:
    """The photograph's bound, stretched down to the lowest written row.

    A scanner app whitens the paper. On a last page that is only half
    written, the blank lower half is as white as the canvas, so
    _photo_bounds ends the photograph where the coverage drops - above the
    last lines of the answer. Every mark below that line was then off paper:
    the last question's score and remark were refused, and the copy went out
    with no mark for it. Writing is on paper by definition, so the bound never
    stops above a row the vision read confirmed, plus two rows' room for the
    score and remark a teacher writes under the last line. The scanner's
    caption does not count, nor does a row outside the photograph's width.
    """
    import fitz

    if not lpage.get("vision_ocr"):
        return photo
    bottoms, heights = [], []
    for ln in lpage.get("lines") or []:
        b, text = ln.get("box"), (ln.get("text") or "").strip()
        if not b or len(b) != 4 or not text or _SCANNER_CAPTION.search(text):
            continue
        bx, by, bw, bh = (float(v) for v in b)
        cx = (bx + bw / 2.0) * psx
        if not photo.x0 <= cx <= photo.x1 or by * psy < photo.y0:
            continue
        bottoms.append((by + bh) * psy)
        heights.append(bh * psy)
    if not bottoms:
        return photo
    pitch = sorted(heights)[len(heights) // 2]
    # A last line whose box dips a few points past a correct bound is normal;
    # stretching for it pushed the bound onto the canvas. Only a bound that
    # cuts off at least a full row of writing is wrong.
    if max(bottoms) <= photo.y1 + pitch:
        return photo
    y1 = min(limit.y1 - 2.0, max(bottoms) + 2.0 * pitch)
    logger.debug("photo bound %.0f stretched to %.0f to cover the written rows", photo.y1, y1)
    return fitz.Rect(photo.x0, photo.y0, photo.x1, max(photo.y1, y1))


def _band_rect(ink, sheet: Any, imap: dict, y0: int, y1: int):
    """One ink band, with its TRUE horizontal extent.

    The width matters: the notebook's printed DATE / PAGE NO. box is ink too,
    and it sits above every written line. Treating it as "the first writing"
    let comments be placed under it but still above the student's answer.
    A written line runs most of the way across; that box does not.
    """
    import fitz
    import numpy as np

    sx, sy = imap["sx"], imap["sy"]
    cols = np.nonzero(ink[y0:y1].sum(axis=0) > 0)[0]
    off = imap["x0"]
    x0 = (off + int(cols.min())) * sx if cols.size else sheet.x0
    x1 = (off + int(cols.max())) * sx if cols.size else sheet.x1
    return fitz.Rect(x0, y0 * sy, x1, y1 * sy)


def _ink_under(imap: Optional[dict], box: Any) -> float:
    """Fraction of `box` that is actually the student's writing.

    Merged ink BANDS are a bounding box over many rows, so they claim the
    space past a short line because some other line in the block runs further
    right. Using them as obstacles refused nine perfectly clear placements and
    left three comments on a thirteen-page script. The pixels do not
    generalise like that - ask them directly.
    """
    if not imap:
        return 0.0
    try:
        import numpy as np

        ink = imap["ink"]
        sx, sy = imap["sx"], imap["sy"]
        off = imap["x0"]
        x0 = max(0, min(ink.shape[1] - 1, int(box.x0 / sx) - off))
        x1 = max(x0 + 1, min(ink.shape[1], int(box.x1 / sx) - off))
        y0 = max(0, min(ink.shape[0] - 1, int(box.y0 / sy)))
        y1 = max(y0 + 1, min(ink.shape[0], int(box.y1 / sy)))
        patch = ink[y0:y1, x0:x1]
        return float(patch.mean()) if patch.size else 0.0
    except Exception:
        return 0.0


def _ink_bands(imap: Optional[dict], sheet: Any) -> Optional[list]:
    """Y-intervals of the sheet that actually carry writing.

    The layout's row boxes are what the placer used to decide a band was free,
    and they miss writing that never became a row - which is how comments ended
    up printed across the student's words. The measured ink map does not miss
    it: it is the picture.
    """
    if not imap:
        return None
    try:
        import fitz
        import numpy as np

        ink = imap["ink"]
        sy = imap["sy"]
        per_row = ink.sum(axis=1)
        # A printed rule inks a handful of pixels; a written line inks many.
        busy = per_row > max(4, int(ink.shape[1] * 0.012))
        bands, start = [], None
        for i, b in enumerate(busy):
            if b and start is None:
                start = i
            elif not b and start is not None:
                bands.append(_band_rect(ink, sheet, imap, start, i))
                start = None
        if start is not None:
            bands.append(_band_rect(ink, sheet, imap, start, len(busy)))
        return bands
    except Exception:
        logger.debug("could not derive ink bands", exc_info=True)
        return None


def _free_band(sheet: Any, obstacles: list, need_h: float,
               near_y: float, floor_y: Optional[float] = None,
               max_dist: Optional[float] = None) -> Optional[tuple]:
    """The nearest horizontal strip of the sheet that carries no writing.

    On a densely written script the detected rows span the full width of the
    paper, so there is no right-hand column to write a note in at all. There
    is still blank paper: the gap under the end of an answer, the space before
    the next question starts, the foot of the page. That is where a teacher
    writes when the margins are full, and it is the difference between a
    student seeing why a mark was cut and seeing a bare underline.

    Strips below the marked line are preferred over strips above it, because a
    comment about an answer belongs after it, not before it.
    """
    top, bot = sheet.y0 + 4.0, sheet.y1 - 4.0
    spans = sorted((max(o.y0, top), min(o.y1, bot)) for o in obstacles
                   if o.y1 > top and o.y0 < bot)
    merged: list[list[float]] = []
    for a, b in spans:
        if merged and a <= merged[-1][1] + 1.0:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    gaps, cursor = [], top
    for a, b in merged:
        if a - cursor >= need_h:
            gaps.append((cursor, a))
        cursor = max(cursor, b)
    if bot - cursor >= need_h:
        gaps.append((cursor, bot))
    if not gaps:
        return None
    # A gap that opens just above the marked line but runs well below it is
    # the space directly under the answer - the best spot there is. Selecting
    # on the gap's START excluded it and exiled the note to the foot of the
    # page instead.
    # Never above the first written line. Falling back to "any gap" put a
    # comment in the page header, above the DATE / PAGE NO. box and above any
    # answer it could refer to - and the header is narrow, so it was trimmed
    # to a fragment ("s.18 partner is") on the way.
    if floor_y is not None:
        gaps = [(max(g[0], floor_y), g[1]) for g in gaps if g[1] > floor_y]
        gaps = [g for g in gaps if g[1] - g[0] >= need_h]
    if not gaps:
        return None
    below = [g for g in gaps if g[1] - need_h >= near_y - 2.0]
    pool = below or gaps
    if max_dist is not None:
        # A remark half a page from the work it judges is not that work's
        # remark. Better to say nothing there than to mislead.
        pool = [g for g in pool if abs(max(g[0], near_y) - near_y) <= max_dist]
    if not pool:
        return None
    return min(pool, key=lambda g: abs(max(g[0], near_y) - near_y))


def _write_in_free_band(page: Any, rect: Any, note: str, occupied: Optional[list],
                        sheet: Any, fontname: str, base_size: float,
                        measure_font: Optional[Any], allow_cut: bool = True,
                        anywhere: bool = False):
    """Write the note in blank paper near the line it belongs to.

    `anywhere` searches the whole sheet from the start instead of only near
    `rect`. `allow_cut=False` returns None rather than shortening the remark -
    for a caller that still has other pages to try it on whole.
    """
    import fitz

    sheet = sheet or page.rect
    scale = _pen_scale(_handwriting_fontfile())
    obstacles = list(occupied or [])

    def wrap(size: float, max_w: float, text: Optional[str] = None) -> list:
        words, lines, cur = (note if text is None else text).split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if _text_width(trial, fontname, size, measure_font) * _ADVANCE_SLACK <= max_w:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    # A gap in a densely written page is rarely three lines tall. Rather than
    # give up — which lost 22 of 36 comments and left three pages with no
    # written reason for their deductions at all — negotiate: run the note
    # wider and smaller, and accept fewer lines, until it fits a real gap.
    climb_deg = _hand_rng("climb", note[:24]).uniform(8.0, 14.0)
    # Calibrated: 11-13 degrees of glyph tilt renders as the +7 to +10 lean
    # measured on the reference teacher's own comments.
    note_tilt = _hand_rng("tilt", note[:24]).uniform(0.0, 4.0)
    ideal = max(11.0 * scale, min(base_size, 15.0 * scale * _note_k(page)))
    floor = 9.0 * scale
    attempt = 0
    # The ladder above keeps a remark whole and keeps it near its answer, and
    # refuses a placement that would cost either. That is right until refusing
    # means writing nothing: a comment that never reaches the page takes the
    # reason for the deduction with it, and the student is left holding a mark
    # with no explanation - measured here as a 90-character note silently
    # dropped while 428pt of blank paper sat below it. So when the ladder is
    # exhausted, drop both conditions - one short line, anywhere blank on the
    # sheet - and give up only if the page truly has no room.
    desperate = False
    while True:
        size = max(floor, ideal - attempt * 0.75)
        # Widening the column is cheaper than shrinking the hand: it costs
        # lines, not legibility.
        max_w = max(120.0, sheet.width * min(0.86, 0.62 + 0.06 * attempt))
        # A climbing line must not rise further than the gap below it, or its
        # tail prints over the next line and the comment reads out of order.
        # Capping the WIDTH by the climb was the wrong way round: the cap
        # shrinks with the text, so going smaller stopped winning any words
        # and placement collapsed. A hand does the opposite - a short remark
        # climbs steeply, a long one is written flatter - so let the climb
        # adapt to the line instead.
        # The reference hand climbs 10-19 degrees and its comments are three or
        # four words to a line - the two go together. Flattening the climb to
        # afford a long line delivered neither: the lines came out level and
        # the writing read as a printed caption. Keep the climb, shorten the
        # line. Both size and the width cap scale together, so the ladder's
        # smaller rungs still shrink the block enough to fit tighter gaps.
        climb = climb_deg
        max_w = min(max_w, (size * 2.1) / max(math.tan(math.radians(climb)), 1e-3))
        # Fewer lines as the search gets desperate: a gap two lines tall is
        # far commoner than one three lines tall, and a one-line note that is
        # actually on the page beats a three-line note that is not.
        cap = 1 if desperate else (3 if attempt < 2 else (2 if attempt < 5 else 1))
        wrapped_all = wrap(size, max_w)
        # Taking the first `cap` lines and discarding the rest is how
        # "s.18: partner is agent of the firm" reached the page as
        # "s.18 partner is" - a fragment that means nothing and hides the very
        # reason a mark was cut. A marker short of space writes a SHORTER
        # remark, not half a sentence, so keep a cut only when most of the
        # remark survives it and it does not end on a dangling connective.
        if len(wrapped_all) > cap and not allow_cut:
            # Not even the mostly-whole cut below: "Wrong answer." survived
            # as the 55% of "Wrong answer. Correct: Mohenjo-daro" and landed
            # under the NEXT answer, which it then called wrong.
            attempt += 1
            if attempt > 8:
                return None
            continue
        if len(wrapped_all) > cap:
            kept = " ".join(wrapped_all[:cap]).rstrip(" ,;:-")
            while " " in kept and kept.rsplit(" ", 1)[-1].lower() in _DANGLING:
                kept = kept.rsplit(" ", 1)[0].rstrip(" ,;:-")
            if len(kept) < len(note) * 0.55 and not desperate:
                attempt += 1
                if attempt > 8:
                    if not allow_cut:
                        return None
                    logger.debug("nowhere to write a whole remark near %s"
                                 " - shortening it instead of dropping it", rect)
                    desperate, attempt = True, 0
                continue
            # Re-wrap the SHORTENED remark rather than slicing the full one:
            # slicing is what turned "s.18: partner is agent of the firm" into
            # "s.18 partner is".
            lines = wrap(size, max_w, kept)[:cap]
        else:
            lines = wrapped_all
        if not lines:
            attempt += 1
            if attempt > 8:
                if desperate or not allow_cut:
                    return None
                desperate, attempt = True, 0
            continue
        widest = max(_text_width(l, fontname, size, measure_font) for l in lines)
        # Reserve what will actually be drawn. The block reaches a `lift` above
        # its anchor because every line ends higher than it starts; searching
        # for the smaller box and then recording the larger one meant a note
        # was cleared into space it did not fit, and landed on the writing.
        # Bind the LIFT, not the angle. The reference hand climbs 10-20 degrees
        # on comments two to four words wide, where that costs a few points of
        # height. Applying the same angle to a 24-word line lifts its tail more
        # than 200pt, and a block that size fits nowhere on a written page - it
        # either gets refused or lands on the answer. Short lines still climb
        # steeply; long ones flatten, exactly as a hand does.
        band_lift = min(widest * math.tan(math.radians(climb)), size * 0.6)
        # The pen's Kalam is ~1.9 sizes tall from ascender to descender; the
        # vector face this ladder was tuned for was 1.3. Reserve what will be
        # inked, or the band search clears a strip the note then overruns.
        line_h = size * (1.9 if _PEN[0] is not None else 1.3) + band_lift
        height = line_h * len(lines) + 4.0 + band_lift
        # Prefer what the page itself says is written over what the layout
        # map guessed; fall back to the boxes when no map was measured.
        measured_bands = _ink_bands(_INK_MAP[0], sheet)
        # The first written line on the page: nothing goes above it.
        floor_y = None
        if measured_bands:
            # The first band wide enough to be a line of writing, not the
            # printed header box.
            wide = [b for b in measured_bands if b.width > sheet.width * 0.30]
            floor_y = min(b.y0 for b in (wide or measured_bands))
        elif obstacles:
            floor_y = min(o.y0 for o in obstacles)
        # The measured bands replace the layout's ROW BOXES - those span the
        # full sheet and cover the interline space too, so counting both
        # blocked every real gap. They must NOT replace the comments already
        # written on this page: dropping those made every comment choose the
        # same best gap and print on top of the last one, which is how a page
        # ended up with "Riskraiehddes fadmerobbilipbeitySPBskeasivpedge".
        blockers = list(measured_bands or obstacles) + list(_PLACED[0] or [])
        band = _free_band(sheet, blockers, height, rect.y1, floor_y=floor_y,
                          max_dist=None if (desperate or anywhere) else sheet.height * 0.30)
        if band is not None:
            break
        attempt += 1
        if size <= floor and attempt > 6:
            if not desperate and not allow_cut:
                return None
            if not desperate:
                # Near the answer is a preference. On the page at all is not.
                logger.debug("no free band near %s - searching the whole sheet", rect)
                desperate, attempt = True, 0
                continue
            logger.debug("no free band on page for pen note near %s", rect)
            return None

    width = max(_text_width(l, fontname, size, measure_font) for l in lines) * _ADVANCE_SLACK
    # Indent inside the paper's own margin rule - starting hard at the sheet
    # edge was read by a critic as overrunning the printed margin.
    x0 = max(sheet.x0 + 6.0, min(sheet.x0 + sheet.width * 0.09,
                                 sheet.x1 - width - 6.0))
    # Sit at the top of the gap, or level with the answer's end when the gap
    # opens above it.
    # A climbing line ends higher than it starts, so the block needs that much
    # headroom or its tail lifts clean off the top of the sheet - "well
    # applied!" was drawn on the white canvas above the photograph.
    # Only the part of the rise that clears the first baseline needs extra
    # room - each line's own climb is already inside line_h, so demanding the
    # whole lift again refused placements that fit perfectly well.
    y0 = max(band[0] + band_lift, min(rect.y1, band[1] - height + band_lift)) + 2.0
    y0 = max(y0, sheet.y0 + band_lift + 4.0)
    # Recorded exactly as reserved: anchor minus the lift, for the full height.
    # Tested BEFORE the pen moves: checked after drawing, a note off the paper
    # was reported as not placed while its ink stayed on the page - so no
    # later remark treated it as taken, and the next one could print over it.
    placed_box = _note_rect((x0, y0 - band_lift), width, height)
    if not _on_paper(_PAPER[0], placed_box):
        logger.debug("free band lies off the paper; leaving the note out")
        return None
    rng = _hand_rng("band", note[:24], round(x0, 1), round(y0, 1))
    slant = rng.uniform(8.0, 12.0)
    for i, line in enumerate(lines):
        _pen_text(page,
                  fitz.Point(x0 + rng.uniform(-0.6, 0.6), y0 + size * 0.95 + line_h * i),
                  line, size, _NOTE_TEXT, rng, slant=slant,
                  max_x=(sheet.x1 - 3.0),
                  rise=math.degrees(math.atan(band_lift / max(widest, 1.0))),
                  tilt=note_tilt)
    return placed_box


def _strip_note(page: Any, rect: Any, note: str, occupied: Optional[list],
                sheet: Any, strip_x: float, fontname: str, base_size: float,
                measure_font: Optional[Any]):
    """Write the note in the marking strip, level with the line it judges."""
    import fitz

    left = strip_x + 6.0
    right = (sheet.x1 if sheet else page.rect.width) - 6.0
    if right - left < 40.0:
        return None
    scale = _pen_scale(_handwriting_fontfile())
    climb = _hand_rng("climb", note[:24]).uniform(8.0, 14.0)
    tilt = _hand_rng("tilt", note[:24]).uniform(0.0, 4.0)
    for attempt in range(6):
        size = max(10.0 * scale, min(base_size, (15.0 - attempt) * scale))
        words, lines, cur = note.split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if _text_width(trial, fontname, size, measure_font) * _ADVANCE_SLACK <= right - left:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        if not lines:
            return None
        widest = max(_text_width(l, fontname, size, measure_font) for l in lines)
        lift = min(widest * math.tan(math.radians(climb)), size * 0.6)
        gap = size * 1.3 + lift
        height = gap * len(lines) + 4.0
        top = max(sheet.y0 + 6.0, min(rect.y0 - size * 0.3,
                                      sheet.y1 - height - 6.0))
        box = fitz.Rect(left, top, left + widest * _ADVANCE_SLACK, top + height)
        # Slide down until genuinely clear. Sliding once past the FIRST
        # collision is not enough: the strip fills top-down, so one step often
        # lands straight on the next comment - five of them ended up
        # overlapping that way.
        clash = True
        for _ in range(24):
            hits = [o for o in (_PLACED[0] or []) if box.intersects(o)]
            if not hits:
                clash = False
                break
            top = max(o.y1 for o in hits) + 5.0
            if top + height > sheet.y1 - 6.0:
                break
            box = fitz.Rect(left, top, left + widest * _ADVANCE_SLACK, top + height)
        if clash:
            continue
        rng = _hand_rng("strip", note[:24], round(top, 1))
        for i, line in enumerate(lines):
            _pen_text(page, fitz.Point(left + rng.uniform(-0.5, 0.5),
                                       top + size * 0.95 + gap * i),
                      line, size, _NOTE_TEXT, rng, max_x=right,
                      rise=math.degrees(math.atan(lift / max(widest, 1.0))),
                      tilt=tilt)
        logger.debug("pen note written in the marking strip")
        return box
    return None


def _pen_text_width(text: str, size: float) -> float:
    """Width in points of `text` as the copy's pen will write it."""
    pen = _PEN[0]
    if pen is not None:
        try:
            from PIL import ImageFont
            px = max(6, int(round(size * _PEN_SCALE * 1.18)))
            return ImageFont.truetype(pen.font_path, px).getlength(text) * 1.08 / _PEN_SCALE
        except Exception:
            pass
    return 0.55 * size * max(1, len(text))


def _place_by_contract(page: Any, rect: Any, style: str, note: str, position: Optional[str],
                       sheet: Any, occupied: Optional[list]) -> Optional[Any]:
    """Write `note` where the marking guide's placement says, or return None.

    The renderer contract, in points:
      right_margin  x = sheet right edge - 7% of the page width, level with the row
      left_margin   right-aligned just before the row's first ink
      below_line    x = row's first ink, one line below, wrapped at the right margin
      right_of_line just past the row's last ink, level with it
    enforce.py guarantees every score is right_margin on the answer's last row
    and every deduction note is below_line; the free-space search that placed
    them before put scores in whichever margin had room, which on one copy was
    the left one for every question. A spot the contract names is used only
    if it is on the paper and clear of the student's writing; otherwise the
    caller falls back to the search, so nothing is dropped for being tidy.
    """
    import fitz

    from .validator import VALID_POSITIONS

    if not note or position not in VALID_POSITIONS:
        return None
    sheet = sheet or page.rect
    page_w = page.rect.width
    # Size from the PAGE's line height, never the target row's: a merged
    # "Q16. Ans. (c)" row was twice as tall as its neighbours, and the note
    # hung on it came out twice the size of the note two lines above and
    # wrapped onto a second line. One hand writes at one size.
    h = _LINE_H[0] or max(rect.height, 12.0)
    own = _row_ink_span(_INK_MAP[0], rect)
    ink_a = own[0] if own else rect.x0
    ink_b = own[1] if own else min(rect.x1, ink_a + 0.6 * sheet.width)
    is_score = style in ("score", "total")
    k = _page_k(page) if style in ("score", "total") else _note_k(page)
    size = max(11.0, min(24.0 * k, h * (1.4 if is_score else 1.1)))
    base_y = rect.y0 + rect.height * 0.5 + size * 0.35
    notes = list(_PLACED[0] or [])

    def clear(box: Any) -> bool:
        why = None
        if not _on_paper(_PAPER[0], box):
            why = "off paper"
        elif _CLIP[0] is not None and not _CLIP[0].contains(box):
            why = f"outside clip {_CLIP[0]}"
        elif _ink_under(_INK_MAP[0], box) > 0.03:
            why = f"ink under {_ink_under(_INK_MAP[0], box):.2f}"
        elif any(box.intersects(n) for n in notes):
            why = "collides with a placed note"
        if why:
            logger.debug("CONTRACT %s %r at %s refused: %s", position, note[:20], box, why)
            return False
        return True

    lines: list[tuple[str, float, float]] = []      # (text, x0, baseline)
    if position in ("right_margin_same_line", "right_of_line"):
        width = _pen_text_width(note, size)
        # The paper's edge as the mask measured it on these rows, which on a
        # scan sits inside the sheet rect (573pt against 591 on one copy).
        # Measuring from the sheet rect put every score's spot 1-12pt past
        # the paper, so all of them went to the fallback.
        edge = sheet.x1
        pe = _paper_right_edge(_PAPER[0], rect.y0, rect.y1)
        if pe is not None:
            edge = min(edge, pe)
        if not is_score and own:
            # Where the words end, not the right-most ink on the row - that
            # is often the photo's dark edge, which left no room at all.
            words_b = _words_end(_INK_MAP[0], rect, max(3.0 * h, 60.0))
            if words_b is not None and words_b < ink_b:
                ink_b = words_b
        start = ink_b + 6.0
        if not is_score:
            # Write between what is already on this row: after the cross or
            # tick that hugs the last word, and stop short of the row's score.
            # Measured to the paper's edge instead, the remark ran through
            # both and was refused for colliding - on the one row with half a
            # page of blank paper beside the answer.
            on_row = sorted((n for n in notes if n.y1 > rect.y0 - 2.0 and n.y0 < rect.y1 + 2.0
                             and n.x1 > ink_b), key=lambda n: n.x0)
            for n in on_row:
                if n.x0 <= start + 60.0:
                    start = max(start, n.x1 + 6.0)
            ahead = [n.x0 for n in on_row if n.x0 > start]
            if ahead:
                edge = min(edge, min(ahead) - 6.0)
        if position == "right_margin_same_line":
            x0 = edge - page_w * 0.07 - width
        else:
            x0 = start
        # Keep clear of the row's writing - but only when that writing was
        # actually measured. The layout's row box is pinned to the sheet edge
        # on merged rows, and trusting it pushed scores off the paper.
        if own:
            x0 = max(x0, start)
        lines = [(note, x0, base_y)]
        if x0 + width > edge - 3.0:
            avail = edge - 3.0 - x0
            fitted = max(10.0, size * avail / max(width, 1.0))
            # A remark may be written smaller to stay on its answer's line -
            # refused here it went to another page. Not below 11pt.
            floor_sz = size * 0.75 if is_score else max(11.0, size * 0.45)
            if fitted >= floor_sz:
                size = fitted
                width = _pen_text_width(note, size)
                lines = [(note, x0, base_y)]
            elif not is_score and position == "right_of_line" and avail > 0:
                # Two short lines beside the answer, as a hand does when the
                # remark is longer than the room after the words. Each line
                # is still tested against the writing and the notes below.
                two = None
                sz = size
                while sz >= floor_sz and two is None:
                    words, cur, out = note.split(), "", []
                    for w in words:
                        trial = (cur + " " + w).strip()
                        if _pen_text_width(trial, sz) <= avail or not cur:
                            cur = trial
                        else:
                            out.append(cur)
                            cur = w
                    if cur:
                        out.append(cur)
                    if len(out) <= 2 and all(_pen_text_width(t, sz) <= avail for t in out):
                        two = (out, sz)
                    sz -= 0.5
                if two is None:
                    logger.debug("CONTRACT %s %r refused: only %.0fpt of room at the edge",
                                 position, note[:20], avail)
                    return None
                size = two[1]
                mid = rect.y0 + rect.height * 0.5 + size * 0.35
                off = size * 0.75 if len(two[0]) == 2 else 0.0
                lines = [(t, x0, mid - off + i * size * 1.5) for i, t in enumerate(two[0])]
            else:
                # Squeezing the figure into what is left of the row wrote
                # one score at half the size of every other on the page.
                # The row below has the room; let the fallback use it.
                logger.debug("CONTRACT %s %r refused: only %.0fpt of room at the edge",
                             position, note[:20], avail)
                return None
    elif position == "left_margin_same_line":
        width = _pen_text_width(note, size)
        x0 = max(sheet.x0 + 3.0, ink_a - 6.0 - width)
        if x0 + width > ink_a - 3.0:
            size = max(9.0, size * (ink_a - 3.0 - x0) / max(width, 1.0))
            width = _pen_text_width(note, size)
        lines = [(note, x0, base_y)]
    elif position == "below_line_left":
        size = max(10.0, min(20.0 * k, h * 1.1))
        # Fit the note to the GAP under the row, not to the row. A 20pt note
        # dropped into a 20pt gap fills it edge to edge and the pen's own
        # wobble lands on the next line - "Wrong option. Correct: (c)" was
        # written across the student's Q3. Measure the gap from the page's
        # ink; if there is not room for a legible line, say so and let the
        # caller find another spot.
        gap = None
        try:
            bands = _ink_bands(_INK_MAP[0], sheet) or []
            below = [b.y0 for b in bands if b.y0 > rect.y1 + 2.0 and b.width > sheet.width * 0.15]
            if below:
                gap = min(below) - rect.y1
        except Exception:
            gap = None
        # Geometry, not statistics: the note's inked footprint runs from
        # ~1.05 sizes above its baseline to ~0.45 below (Kalam, 1.18x, with
        # wobble). Every line of it must end above the next line of writing.
        # The ink-fraction test let a note graze the ascenders of the row
        # below because ascenders are sparse; a teacher's eye does not.
        # Measured on the pen itself: Kalam inks ~0.95 sizes above the
        # baseline and up to ~0.95 below (deep descenders plus the pen's own
        # jitter) - a footprint 1.9x the nominal size, not the 1.5x of a
        # print face.
        # The smallest hand that still reads beside this page's writing: 9pt
        # on A4, larger on a big photographed page, where a 9pt remark beside
        # 54pt rows was a smudge. Below it the remark goes where it fits whole.
        legible = max(9.0, h * 0.3)
        if gap is not None:
            if gap < 14.0:
                return None
            size = max(legible, min(size, (gap - 3.0) / 1.9))
        x0 = max(sheet.x0 + 6.0, ink_a)
        max_w = (sheet.x1 - page_w * 0.05) - x0
        # Stop short of anything already written in this band - typically the
        # question's own score in the right margin. Wrapping around it keeps
        # the note under the answer it is about instead of bouncing it a line
        # down under the next question.
        # A box that only grazes the band's top edge - the reserved part of
        # a tick or cross on the row above - does not count.
        band_top, band_bot = rect.y1 + 2.0, rect.y1 + 2.0 + size * 1.9 * 2
        for n in notes:
            if n.y1 > band_top and n.y0 < band_bot and n.x0 > x0 + 40.0:
                max_w = min(max_w, n.x0 - 6.0 - x0)
        def wrap(sz: float) -> list[str]:
            words, cur, out = note.split(), "", []
            for w in words:
                trial = (cur + " " + w).strip()
                if _pen_text_width(trial, sz) <= max_w or not cur:
                    cur = trial
                else:
                    out.append(cur); cur = w
            if cur:
                out.append(cur)
            return out

        def two_lines_fit(sz: float) -> bool:
            # second baseline 1.5 sizes under the first, ink to 0.95 below it
            return gap is None or gap >= sz * 3.4 + 3.0

        wrapped = wrap(size)
        if len(wrapped) > 1 and not (len(wrapped) <= 2 and two_lines_fit(size)):
            # The comment does not fit at this pen. A teacher writes smaller
            # rather than stopping mid-sentence - cutting to whatever fitted
            # left "Image distance sign wrong; image nature not" on a copy,
            # with the point of the remark in the dropped word. One line at
            # a smaller pen first (it stays under the answer), then two
            # lines small enough for the gap; below 9pt neither is legible,
            # so refuse and let the caller find another spot.
            fitted = None
            sz = size - 0.5
            while sz >= max(legible, size * 0.65):
                if _pen_text_width(note, sz) <= max_w:
                    fitted = ([note], sz)
                    break
                sz -= 0.5
            if fitted is None:
                sz = size - 0.5
                while sz >= legible:
                    two = wrap(sz)
                    if len(two) <= 2 and two_lines_fit(sz):
                        fitted = (two, sz)
                        break
                    sz -= 0.5
            if fitted is None:
                logger.debug("CONTRACT below_line_left %r refused: no pen size fits "
                             "gap %s width %.0f", note[:20], gap, max_w)
                return None
            wrapped, size = fitted
        y = rect.y1 + 2.0 + size * 0.95    # top of the ink just under the row
        if gap is not None and y + size * 0.95 > rect.y1 + gap - 1.0:
            return None
        for i, t in enumerate(wrapped):
            lines.append((t, x0, y + i * size * 1.5))
    else:
        return None

    boxes = []
    for t, x0, by in lines:
        w = _pen_text_width(t, size)
        # the pen writes Kalam at 1.18x the nominal size with a little
        # baseline wobble; test the footprint that is actually inked
        # Digits have no descenders: a score's ink is ~0.85 above the
        # baseline to ~0.35 below. Reserving a full text footprint for it
        # made every score two rows tall and "collide" with its neighbour.
        up, down = (0.85, 0.35) if is_score else (1.0, 1.0)
        boxes.append(fitz.Rect(x0 - 1.0, by - size * up, x0 + w + 1.0, by + size * down))
    if not boxes or not all(clear(b) for b in boxes):
        return None
    rng = _hand_rng("contract", style, note[:24], round(rect.y0, 1))
    for t, x0, by in lines:
        _pen_text(page, fitz.Point(x0, by), t, size, _NOTE_TEXT, rng,
                  slant=rng.uniform(-3.0, 3.0), max_x=sheet.x1 - 2.0)
    placed = boxes[0]
    for b in boxes[1:]:
        placed = placed | b
    logger.debug("CONTRACT %s %r placed at %s size %.1f lines %d",
                 position, note[:20], placed, size, len(lines))
    return placed


# The first words of a new answer or section. A score looking further down
# for room stops here, or it is written beside the next question - which is
# how a "3/3" came to sit on the "ans 30" heading of a question worth 0.
_ANSWER_START = re.compile(
    r"^\s*(ans(wer)?\s*[.:]?\s*\d+|q(uestion)?\s*[.:]?\s*\d+|section\b|\d+\s*[.)]\s*[A-Z])", re.I)


def _place_score_right(page: Any, rect: Any, note: str, sheet: Any,
                       occupied: Optional[list], following: Optional[list] = None) -> Optional[Any]:
    """Right-side-only fallback for a question score.

    Order: the same row, flush against the paper's measured right edge; the
    row below and the row above (a score beside the next line still reads as
    this answer's); then `following` - the answer's next rows, whose last line
    is where the answer really ends when the grader named an earlier row as
    its last; then the same spots at a smaller pen. Returns the drawn box or
    None.
    """
    import fitz
    if sheet is None:
        return None
    line_h = float(_LINE_H[0] or rect.height or 14.0)
    row_h = _LINE_H[0] if _LINE_H[0] else rect.height
    base = max(13.0, min(26.0 * _page_k(page), row_h)) * _pen_scale(_handwriting_fontfile())
    candidates = [rect,
                  fitz.Rect(rect.x0, rect.y0 + line_h, rect.x1, rect.y1 + line_h),
                  fitz.Rect(rect.x0, rect.y0 - line_h, rect.x1, rect.y1 - line_h)]
    candidates += list(following or [])
    for size in (base, base * 0.8):
        width = _pen_text_width(note, size)
        for cand in candidates:
            if cand.y0 < sheet.y0 + 2.0 or cand.y1 > sheet.y1 - 2.0:
                continue
            right = _paper_right_edge(_PAPER[0], cand.y0, cand.y1) or sheet.x1
            right = min(right, sheet.x1) - 4.0
            x0 = right - width
            ink = _row_ink_span(_INK_MAP[0], cand)
            if ink is not None:
                # Where the words end - not the photo's dark edge beyond them.
                words_b = _words_end(_INK_MAP[0], cand, max(3.0 * line_h, 60.0))
                if words_b is not None and words_b < ink[1]:
                    ink = (ink[0], words_b)
            if ink is not None and x0 < ink[1] + 4.0:
                logger.debug("SCORE %r: row %s runs under the margin (ink to %.0f)", note, cand, ink[1])
                continue                      # the writing runs under it
            base_y = cand.y0 + cand.height * 0.72
            box = fitz.Rect(x0 - 1.0, base_y - size * 0.85, x0 + width + 1.0, base_y + size * 0.35)
            why = None
            if not _on_paper(_PAPER[0], box):
                why = "off paper"
            elif _CLIP[0] is not None and not _CLIP[0].contains(box):
                why = "outside clip"
            elif _ink_under(_INK_MAP[0], box) > 0.03:
                why = f"ink under {_ink_under(_INK_MAP[0], box):.2f}"
            elif any(box.intersects(o) for o in (occupied or [])):
                why = "collides"
            if why:
                logger.debug("SCORE %r at %s refused: %s", note, box, why)
                continue
            rng = _hand_rng("score-right", note, round(cand.y0, 1))
            _pen_text(page, fitz.Point(x0, base_y), note, size, _NOTE_TEXT, rng,
                      slant=rng.uniform(-3.0, 3.0), max_x=sheet.x1 - 2.0)
            logger.debug("SCORE %r placed right by fallback at %s", note, box)
            return box
    return None


def _place_note(page: Any, rect: Any, style: str, note: str,
                occupied: Optional[list] = None, sheet: Any = None,
                allow_cut: bool = True) -> None:
    """Write the pen note somewhere it can actually be read.

    The note is the part the student has to act on, so the one thing it must
    never do is land on top of the handwriting it is about — which is exactly
    what happened when placement only considered the target line: a 14-word
    note centred over a struck line ran straight through the words underneath
    and neither could be read.

    So every candidate position is tested against the real occupied boxes of
    the page (every row the layout map knows about), and the note goes in the
    first genuinely clear gap: after the student's text on the same line, then
    the interline gap below, then above, then any free band on the page — with
    a leader line back to the marked row when it ends up somewhere non-obvious.
    """
    import fitz

    note_right = (sheet.x1 - 4.0) if sheet else (page.rect.width - _SCORE_GUTTER)
    note = _teacher_voice(_latin1(note).strip())
    if not note:
        return None
    # A pen note is short by nature, and a long one cannot fit an interline gap
    # near the line it marks - it gets pushed to the far side of the page,
    # where it reads as a machine caption rather than a teacher's margin note.
    # The grading prompt asks for <=10 words; when the model overruns, trim for
    # the page. Nothing is lost: the full reasoning is in
    # criteria_breakdown[].reason and on the summary page.
    if len(note) > _MAX_NOTE_CHARS:
        # A teacher never writes a sentence that trails off in an ellipsis.
        # Critics quoted "State residue stage, losses rule and Section..." as a
        # fatal tell. Cut at the last clause boundary that fits and stop there -
        # a short complete instruction beats a truncated long one.
        head = note[:_MAX_NOTE_CHARS]
        for sep in (";", " - ", ",", ":"):
            if sep in head:
                head = head.rsplit(sep, 1)[0]
                break
        else:
            head = head.rsplit(" ", 1)[0]
        note = (head or note[:_MAX_NOTE_CHARS]).rstrip(" ,;:-")
    fontname, base_size, measure_font = _pen(page)
    # The marking strip first, level with the line being marked. Creating the
    # strip without preferring it left the notes still fighting for gaps inside
    # the answer - 3.1% of the pen still landing on the student's words, no
    # better than having no margin at all.
    if _MARGIN_X[0] is not None and sheet is not None:
        strip = _strip_note(page, rect, note, occupied, sheet, _MARGIN_X[0],
                            fontname, base_size, measure_font)
        if strip is not None:
            return strip
    # Scale the hand to the student's. A fixed point size came out roughly a
    # third of the height of the surrounding handwriting, which reads as a
    # caption laid over the page rather than something written on it. The
    # marked row's own height is the best available proxy for how big this
    # student writes, and a teacher's margin note runs a little smaller than
    # the script it comments on.
    scale = _pen_scale(_handwriting_fontfile())
    # Sized against the student's own writing. The row band is taller than the
    # letters in it (roughly 2x), so a note at ~1.0 of the band lands near the
    # 1.2-1.8x of the HANDWRITING the marking guide asks for.
    # ...but against the PAGE's line height when that is known, never the one
    # row this note happens to hang on: a merged two-line row made one note
    # twice the size of its neighbours, wrapped over two lines.
    row_h = _LINE_H[0] if _LINE_H[0] else rect.height
    base_size = max(13.0, min(26.0 * _note_k(page), row_h * 1.0)) * scale
    occupied = occupied or []
    # The marked row itself is not an obstacle for a note that sits beside it.
    obstacles = [o for o in occupied if not o.intersects(rect) or o != rect]
    # The measured ink is an obstacle for EVERY placement path, not just the
    # free-band one. Without it here the slot search only knew about the
    # layout's row boxes, and comments were written straight across the
    # student's paragraph - a five-line block on one page buried five
    # consecutive lines of blue. The bands carry their true x-extent, so a
    # note that sits past the end of a line still clears them.
    _bands = _ink_bands(_INK_MAP[0], sheet) if sheet is not None else None

    # A densely written page has interline gaps only a few points tall, so a
    # note at one fixed size gets exiled away from the line it marks.
    # Shrinking it a couple of points keeps it next to the line it marks, which
    # is worth far more than the two points of height.
    size = base_size
    climb = _hand_rng("climb", note[:24]).uniform(8.0, 14.0)

    def _extent(n_lines: int, w: float) -> tuple:
        """(height, lift) of the block as write() will really draw it.

        write() spaces lines by size*1.25 PLUS the climb's rise, and every line
        ends higher than its own baseline start. Measuring the block as a flat
        stack of baselines understated a three-line note by 143pt - ink 50pt
        above the recorded box and 80pt below it. Everything downstream trusts
        this number: the free-slot search reserves it, and the returned rect is
        what stops the NEXT note printing through this one.
        """
        lift = min(w * math.tan(math.radians(climb)), size * 0.6)
        gap = size * 1.25 + lift
        return gap * max(0, n_lines - 1) + size * 1.65 + lift, lift

    width = _text_width(note, fontname, size, measure_font) * _ADVANCE_SLACK
    height, note_lift = _extent(1, width)

    # A note wider than the usable column has to wrap; measure the widest line.
    max_width = note_right - 8
    wrapped = None
    if width > max_width:
        words, lines, cur = note.split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if _text_width(trial, fontname, size, measure_font) * _ADVANCE_SLACK <= max_width:
                cur = trial
            else:
                if cur:
                    lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        wrapped = lines[:3]
        width = max(_text_width(l, fontname, size, measure_font) for l in wrapped) * _ADVANCE_SLACK
        height, note_lift = _extent(len(wrapped), width)

    # Nobody writes a margin note on a perfectly level baseline. A degree or two
    # of slant, consistent within one note and different between notes, is most
    # of what separates a written note from a caption laid on by software.
    note_rng = _hand_rng("note", note[:24], round(rect.x0, 1), round(rect.y0, 1))
    # Forward italic, measured at roughly 10 degrees on the reference.
    slant = note_rng.uniform(8.0, 12.0)

    note_tilt = _hand_rng("tilt", note[:24]).uniform(0.0, 4.0)

    def write(x: float, y_top: float) -> None:
        lines = wrapped if wrapped else [note]
        widest = max(_text_width(l, fontname, size, measure_font) for l in lines)
        # The pen is given the angle that yields the BOUNDED lift, not the raw
        # one: otherwise the ink climbs past the box reserved for it.
        lift = min(widest * math.tan(math.radians(climb)), size * 0.6)
        eff = math.degrees(math.atan(lift / max(widest, 1.0)))
        gap = size * 1.25 + lift
        for i, line in enumerate(lines):
            base = fitz.Point(x + note_rng.uniform(-0.6, 0.6),
                              y_top + size * 0.95 + gap * i)
            _pen_text(page, base, line, size, _NOTE_TEXT, note_rng, slant=slant,
                      max_x=((sheet.x1 - 3.0) if sheet else page.rect.width - 3.0),
                      rise=eff, tilt=note_tilt)

    gap = 4.0
    for trial in (base_size, base_size - 1.0, base_size - 2.0, base_size - 3.0):
        if trial < 9.5 * scale:
            break
        size = trial
        if wrapped:
            width = max(_text_width(l, fontname, size, measure_font) for l in wrapped) * _ADVANCE_SLACK * _ADVANCE_SLACK
            height, note_lift = _extent(len(wrapped), width)
        else:
            width = _text_width(note, fontname, size, measure_font) * _ADVANCE_SLACK
            height, note_lift = _extent(1, width)
        edge = (sheet.x0 + 3.0) if sheet else 2.0
        # The outer margin level with the line comes first: that is where a
        # marker's comment actually goes.
        # The reference's comments sit in the right margin, each vertically
        # LEVEL with the answer it judges. Mine were landing at the top of the
        # page, so a reader could not tell which answer a note belonged to.
        outer = None
        if occupied:
            block_r = max((o.x1 for o in occupied), default=None)
            if block_r is not None and block_r + 6 + width <= note_right:
                outer = (block_r + 6.0, rect.y0 + (rect.height - height) / 2.0)
            elif block_r is not None:
                # Not enough room at full width - the margin still wins, the
                # note just wraps narrower rather than moving away from its line.
                outer = None
        candidates = ([outer] if outer else []) + [
            (rect.x1 + gap, rect.y0 + (rect.height - height) / 2.0),  # same line, to the right
            (max(edge, rect.x0), rect.y1 + 2),                        # gap below
            (max(edge, rect.x0), rect.y0 - height - 2),               # gap above
            (edge, rect.y1 + 2),                                      # below, from the margin
            (edge, rect.y0 - height - 2),                             # above, from the margin
        ]
        slot = _free_slot(candidates, obstacles, width, height, page, sheet,
                          lift=note_lift, imap=_INK_MAP[0])
        if slot is not None:
            write(*slot)
            return _note_rect((slot[0], slot[1] - note_lift), width, height)

    # Nothing beside the line is free. Scan the page for the nearest clear band
    # and point at the row from there, rather than writing over the answer.
    # Search only NEAR the line. Scanning the whole page found a gap, but a
    # note about line 4 printed at the foot of the sheet belongs to nothing a
    # reader can see - better to keep it close, or fall through to a sticky.
    step = 6.0
    scan = []
    # Tight. A note is only a note if it sits by the line it marks; at the old
    # radius one drifted into the page header, two-thirds of a page away from
    # the answer it was about.
    # A note more than about a line and a half from its target stops being
    # a note about that line.
    radius = min(_NOTE_SEARCH_RADIUS, max(26.0, rect.height * 1.6))
    y = max(2.0, rect.y0 - radius)
    limit = min(page.rect.height - height - 2, rect.y1 + radius)
    while y <= limit:
        scan.append((max((sheet.x0 + 3.0) if sheet else 2.0, rect.x0), y))
        scan.append(((sheet.x0 + 3.0) if sheet else 2.0, y))
        y += step
    scan.sort(key=lambda c: abs(c[1] - rect.y0))
    slot = _free_slot(scan, obstacles, width, height, page, sheet,
                      lift=note_lift, imap=_INK_MAP[0])
    if slot is not None:
        x, y_top = slot
        write(x, y_top)
        placed = _note_rect((x, y_top - note_lift), width, height)
        # Deliberately NO leader line. A dashed rule drawn across a script is
        # the second clearest tell that a machine marked it; a teacher just
        # writes the note near the line and moves on.
        return placed

    # No room near the line. Drop the note from the PAGE rather than fall back
    # to a sticky annot: a yellow icon floating over the writing is unmistakably
    # a PDF tool, not a teacher, and it covers the work underneath. The mark
    # itself is still drawn, and the note survives in criteria_breakdown and on
    # the summary page, so nothing is lost - it just is not written on the copy.
    # Last resort: write it small in the outer margin on this line. Dropping
    # the note was leaving bare underlines with nothing to explain them -
    # "not added feedback, just teacher added why they cut their mark".
    # A cramped note the student can read beats a silent deduction.
    # Last resort: down the outer margin, wrapped to the width that is actually
    # free there. Writing it at full width just pushed a long correction left
    # into the answer - which is worse than dropping it, and measured as 74% of
    # strokes landing on the student's words.
    sheet_r = sheet.x1 if sheet else page.rect.width
    # Where this line's writing actually ENDS, not where its detected box does.
    # The box spans the sheet on a banded layout, and only obstacles that share
    # the line matter - taking the widest box anywhere on the page pushed the
    # column off the paper every time.
    row_end = (_INK_SPAN[0][1] if _INK_SPAN[0] else rect.x1)
    near = [o.x1 for o in occupied if o.y1 > rect.y0 and o.y0 < rect.y1
            and o.x1 <= row_end + 2.0]
    col_x0 = max(max(near, default=row_end), row_end) + 6.0
    col_w = sheet_r - 3.0 - col_x0
    if col_w < 26.0:
        # No right-hand column at all — every row spans the full width of the
        # sheet. Write in the blank paper instead of saying nothing: silently
        # dropping the note discarded ALL 36 comments on a 13-page copy, and
        # the marks were left with no stated reason anywhere on the page.
        return _write_in_free_band(page, rect, note, occupied, sheet,
                                   fontname, base_size, measure_font,
                                   allow_cut=allow_cut)

    # The last-resort note is the one the student most needs to read - it is
    # the reason a mark was cut. Never let it fall below legibility.
    small = max(9.5 * scale, base_size * 0.72)
    words, lines, cur = note.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if _text_width(trial, fontname, small, measure_font) * _ADVANCE_SLACK <= col_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    # A column this narrow shreds the note into one word per line and then
    # silently drops the overflow - the student is left reading
    # "Also / stat / Rs. / 85,0". Blank paper elsewhere on the page carries
    # the whole sentence, so prefer that over a mangled column.
    if len(lines) > 3:
        logger.debug("margin column too narrow for %d lines; using blank paper", len(lines))
        return _write_in_free_band(page, rect, note, occupied, sheet,
                                   fontname, base_size, measure_font,
                                   allow_cut=allow_cut)
    tw = max(_text_width(l, fontname, small, measure_font) for l in lines) * _ADVANCE_SLACK
    # The recorded height must match what write() actually draws. It spaces
    # lines by size*1.25 PLUS the climb's rise, so a box measured at 1.22 alone
    # understated a climbing note badly - collisions with it went undetected
    # and two comments printed through each other into an unreadable mash.
    _col_gap = small * 1.25 + min(tw * math.tan(math.radians(climb)), small * 0.6)
    # A climbing line ends HIGHER than its baseline start, so the block reaches
    # above the point it is anchored at as well as below it. Counting only the
    # downward stack left the recorded box 143pt short on a three-line note -
    # ink 50pt above the box and 80pt below - so overlaps with it stayed
    # invisible and "no collisions" was measuring the wrong rectangle.
    _col_lift = min(tw * math.tan(math.radians(climb)), small * 0.6)
    th = small * 0.95 + _col_gap * max(0, len(lines) - 1) + small * 0.4 + _col_lift
    fy = min(max(rect.y0 - th * 0.25, (sheet.y0 + 2) if sheet else 2.0),
             ((sheet.y1 if sheet else page.rect.height) - th - 3.0))
    size = small
    wrapped = lines if len(lines) > 1 else None
    note = lines[0]
    # A comment already on this page is an obstacle too. Only the free-band
    # path was checking for them, so on a crowded script two column notes
    # could land on each other.
    box = _note_rect((col_x0, fy - _col_lift), tw, th)
    # The column writer never goes through _free_slot, so adding the measured
    # ink to `obstacles` did not reach it - and this is the path that was
    # laying comments straight across the student's paragraph. Check the
    # writing here as well as the comments already placed.
    if _ink_under(_INK_MAP[0], box) > 0.02 or not _on_paper(_PAPER[0], box):
        logger.debug("column slot is on the writing or off the paper; using blank paper")
        return _write_in_free_band(page, rect, note, occupied, sheet,
                                   fontname, base_size, measure_font,
                                   allow_cut=allow_cut)
    for other in (_PLACED[0] or []):
        if box.intersects(other):
            shifted = other.y1 + 4.0
            if shifted + th > ((sheet.y1 - 3.0) if sheet else page.rect.height):
                logger.debug("column note collides and cannot move; leaving it out")
                return None
            fy = shifted
            box = _note_rect((col_x0, fy - _col_lift), tw, th)
            if _ink_under(_INK_MAP[0], box) > 0.02 or any(
                    box.intersects(o) for o in (_PLACED[0] or [])):
                logger.debug("column note still clashes after moving; leaving it out")
                return None
    write(col_x0, fy)
    logger.debug("pen note wrapped into the margin column near %s", rect)
    return box


def _fmt_marks(value: float) -> str:
    """4.5 not 4.50, 6 not 6.0 — a marked script is written the short way."""
    return f"{value:g}"


# ---- "Teacher comments outside the copy" template --------------------------

COMMENTS_INSIDE = "INSIDE"
COMMENTS_OUTSIDE = "OUTSIDE"
# Width of the comment panel as a share of the scan's width.
_PANEL_RATIO = 0.45
_PANEL_HEADING = (0.55, 0.16, 0.20)
_PANEL_TEXT = (0.20, 0.20, 0.20)
_PANEL_RULE = (0.80, 0.80, 0.80)
# The longest stretch of a verdict's feedback used when the grader wrote no
# remark for that answer - the panel is a margin, not the review screen.
_PANEL_FEEDBACK_CHARS = 180


# Where language_feedback.py starts the "Language:" paragraph of a feedback.
_LANGUAGE_PARAGRAPH = "\n\nLanguage: "


def _panel_status(verdict: dict[str, Any]) -> str:
    if (verdict.get("status") or "").upper() == "FAILED":
        return "Needs review"
    got = float(verdict.get("marks_awarded") or 0)
    out_of = float(verdict.get("max_marks") or 0)
    if out_of > 0 and got >= out_of:
        return "Correct"
    if got <= 0:
        return "Incorrect"
    return "Partial"


def _panel_label(verdict: dict[str, Any], labels: dict[str, str]) -> str:
    label = (labels.get(str(verdict.get("question_id"))) or "").strip()
    if not label:
        number = verdict.get("question_number")
        return f"Q{number}" if number is not None else "Q"
    return f"Q{label}" if label[0].isdigit() else label


def _short_feedback(text: str) -> str:
    """The first sentence or two of the grader's feedback, never cut mid-word."""
    text = " ".join((text or "").split())
    if len(text) <= _PANEL_FEEDBACK_CHARS:
        return text
    cut = text[:_PANEL_FEEDBACK_CHARS]
    stop = cut.rfind(". ")
    if stop >= 60:
        return cut[:stop + 1]
    return cut[:cut.rfind(" ")].rstrip(",;:") + "..."


def _wrap_plain(text: str, fontname: str, size: float, width: float) -> list[str]:
    import fitz

    lines: list[str] = []
    for para in text.split("\n"):
        line = ""
        for word in para.split():
            trial = f"{line} {word}".strip()
            if line and fitz.get_text_length(trial, fontname=fontname, fontsize=size) > width:
                lines.append(line)
                line = word
            else:
                line = trial
        if line:
            lines.append(line)
    return lines


def _draw_comment_panels(doc: Any, panels: dict[int, Any],
                         anchors: dict[tuple[int, int], float],
                         notes: dict[tuple[int, int], list[str]],
                         verdicts: list[dict[str, Any]],
                         labels: dict[str, str],
                         language: Optional[dict[tuple[int, int], list[str]]] = None) -> None:
    """Type each page's remarks into the panel beside it, level with the answer
    they are about: "Q4(iv): Partial" and the remark below it.

    A question's status is given once, on the first page it is marked on; a
    later page lists it again only when it carries a remark of its own there.
    When the remarks do not fit at their answers' heights they are set smaller,
    then stacked from the top, so nothing is dropped off the foot of the page.
    """
    import fitz

    first_page: dict[int, int] = {}
    for (pno, v_idx) in sorted(anchors):
        first_page.setdefault(v_idx, pno)

    for pno, panel in panels.items():
        entries = []
        for (p, v_idx), y in anchors.items():
            if p != pno:
                continue
            verdict = verdicts[v_idx]
            said = notes.get((p, v_idx)) or []
            fixes = (language or {}).get((p, v_idx)) or []
            first = first_page.get(v_idx) == pno
            if not first and not said and not fixes:
                continue
            if first and not said and verdict.get("feedback"):
                # The grader's own words; the language list is typed below.
                said = [_short_feedback(str(verdict["feedback"]).split(_LANGUAGE_PARAGRAPH)[0])]
            if fixes:
                said = list(said) + ["Language: " + "; ".join(fixes)]
            label = _panel_label(verdict, labels)
            heading = f"{label}: {_panel_status(verdict)}" if first else f"{label} (contd.)"
            entries.append((y, v_idx, _latin1(heading), [_latin1(s) for s in said if s]))
        page = doc[pno]
        k = max(1.0, min(4.0, panel.width / (595.0 * _PANEL_RATIO)))
        pad = 14.0 * k
        x0, x1 = panel.x0 + pad, panel.x1 - pad
        top = panel.y0 + pad
        bottom = panel.y1 - pad
        page.draw_line(fitz.Point(panel.x0 + 1, panel.y0), fitz.Point(panel.x0 + 1, panel.y1),
                       color=_PANEL_RULE, width=0.8 * k)
        head_size = 13.0 * k
        page.insert_text(fitz.Point(x0, top + head_size), "TEACHER COMMENTS",
                         fontname="hebo", fontsize=head_size, color=_PANEL_HEADING)
        first_y = top + head_size * 2.2
        if not entries:
            continue
        entries.sort(key=lambda e: (e[0], e[1]))

        def layout(scale: float, anchored: bool):
            label_size, body_size = 11.0 * k * scale, 10.0 * k * scale
            placed, y = [], first_y
            for anchor, _v, heading, said in entries:
                body = [ln for s in said
                        for ln in _wrap_plain(s, "helv", body_size, x1 - x0)]
                height = label_size * 1.35 + len(body) * body_size * 1.3 + label_size * 0.9
                if anchored:
                    y = max(y, anchor)
                placed.append((y, heading, body, label_size, body_size))
                y += height
            return placed, y

        plan = None
        for anchored in (True, False):
            for scale in (1.0, 0.9, 0.8, 0.7, 0.6):
                placed, end = layout(scale, anchored)
                if end <= bottom:
                    plan = placed
                    break
            if plan is not None:
                break
        if plan is None:
            plan, _ = layout(0.6, False)

        for y, heading, body, label_size, body_size in plan:
            if y + label_size > bottom:
                break
            y += label_size
            page.insert_text(fitz.Point(x0, y), heading, fontname="hebo",
                             fontsize=label_size, color=_PANEL_HEADING)
            y += label_size * 0.35
            for line in body:
                if y + body_size * 1.3 > bottom:
                    break
                y += body_size * 1.3
                page.insert_text(fitz.Point(x0, y), line, fontname="helv",
                                 fontsize=body_size, color=_PANEL_TEXT)


_DIGIT_FONTNAME = "hwdigit"


@lru_cache(maxsize=1)
def _digit_font() -> Optional[Any]:
    try:
        import fitz

        return fitz.Font(fontfile=_DIGIT_FONT) if os.path.exists(_DIGIT_FONT) else None
    except Exception:
        logger.debug("digit font unavailable", exc_info=True)
        return None


def _digit_pen(page: Any) -> tuple:
    """(fontname, font) for writing a MARK, which must never be ambiguous.

    The prose hand's "1" is a bare vertical stroke, so "10/10" reads as
    "l0/l0". A mark is the one thing on the page a student will argue about;
    it gets a face whose 1 is flagged.
    """
    font = _digit_font()
    if font is not None:
        try:
            page.insert_font(fontname=_DIGIT_FONTNAME, fontfile=_DIGIT_FONT)
            return _DIGIT_FONTNAME, font
        except Exception:
            logger.debug("digit font registration failed", exc_info=True)
    return _pen(page)[0], _pen(page)[2]


def _draw_score_badge(page: Any, centre: Any, awarded: float, out_of: Optional[float] = None,
                      radius: float = 15.0) -> None:
    """A circled mark, the way it is written on a real script.

    out_of given -> the "34/60" total; omitted -> a bare per-question "4.5".
    """
    import fitz

    # insert_text, not insert_textbox: a box only as tall as the glyphs is
    # rejected for want of line-height headroom and silently writes nothing,
    # which leaves an empty circle where the mark should be.
    # The circled mark is written in the same hand as the notes, so the whole
    # script reads as one person's marking rather than a form overlay.
    badge_font, badge_measure = _digit_pen(page)
    awarded_text = _fmt_marks(awarded)
    badge_rng = _hand_rng("badge", round(centre.x, 1), round(centre.y, 1), awarded_text)

    def centred(text: str, baseline_y: float, size: float) -> None:
        text = _latin1(text)
        width = _text_width(text, badge_font, size, badge_measure)
        _hand_text(page, fitz.Point(centre.x - width / 2.0, baseline_y), text,
                   badge_font, size, _WRONG, badge_rng, font=badge_measure,
                   slant=badge_rng.uniform(-4.0, 4.0))


    # Most marks are just written. A minority get a loose loop thrown round
    # them - and a thrown loop never closes cleanly. A neat closed ring with a
    # fraction inside was what both critics called the most machine-looking
    # thing on the page.
    if badge_rng.random() < 0.35:
        _hand_oval(page, fitz.Rect(centre.x - radius, centre.y - radius * 0.92,
                                   centre.x + radius, centre.y + radius * 0.92),
                   _WRONG, 1.7, badge_rng)


    if out_of is None:
        centred(awarded_text, centre.y + radius * 0.32, radius * 0.78)
        return

    # Written inline as "8/10", not stacked over a ruled bar. A critic called
    # the stacked form out directly: perfectly straight fraction rule inside a
    # hand-wobbled loop, which reads as a UI badge dropped on the page.
    # Bare number, no denominator: "drop the '/10' fraction" was the one fix
    # both critics named independently.
    inline = awarded_text
    # Fit the ring to the text, not the other way round. With a fixed radius the
    # digits spilled through the stroke - "58/100 has its final 0 cut by the
    # circle" - which reads as text dropped onto a graphic.
    size = radius * 0.78
    while size > radius * 0.46 and _text_width(inline, badge_font, size, badge_measure) > radius * 1.55:
        size -= 0.5
    centred(inline, centre.y + radius * 0.30, size)


def _draw_grand_total(page: Any, centre: Any, awarded: float, out_of: float,
                      line_h: float) -> Optional[Any]:
    """The copy's total, the way the marking guide asks for it.

    "awarded/max", large, with a hand-thrown loop round it, below the Page No
    box on page one. Unlike the per-question badge this ALWAYS shows the
    denominator and ALWAYS carries a ring: the guide is explicit, and a bare
    "24" in the corner of a 30-mark paper read as a page number.

    The ring is sized to the digits, not the digits to the ring: fitting text
    into a fixed circle shrank "24/30" to 16pt inside a 50pt loop, and the
    loop, not the mark, was what the eye landed on.
    """
    import fitz

    text = _latin1(f"{_fmt_marks(awarded)}/{_fmt_marks(out_of)}")
    if _PEN[0] is not None:
        drawn = _pen_total_overlay(page, centre, text, line_h * 1.45)
        if drawn is not None:
            return drawn
    font, measure = _digit_pen(page)
    rng = _hand_rng("grand-total", round(centre.x, 1), round(centre.y, 1), text)
    size = line_h * 1.45                          # digits ~1.5 lines tall
    width = _text_width(text, font, size, measure)
    rx = width / 2.0 + size * 0.42
    ry = size * 0.80                              # overall ~2.3 lines tall
    oval = fitz.Rect(centre.x - rx, centre.y - ry, centre.x + rx, centre.y + ry)
    _hand_oval(page, oval, _WRONG, 1.9, rng)
    _hand_text(page, fitz.Point(centre.x - width / 2.0, centre.y + size * 0.34),
               text, font, size, _WRONG, rng, font=measure,
               slant=rng.uniform(-3.0, 3.0))
    return fitz.Rect(oval.x0 - 2.0, oval.y0 - 2.0, oval.x1 + 2.0, oval.y1 + 2.0)


def page_id_for(order: Optional[dict], page_no: int) -> Optional[str]:
    for pid, idx in (order or {}).items():
        if idx == page_no:
            return pid
    return None


def _place_question_scores(doc: Any, placements: dict[int, tuple],
                           verdicts: list[dict[str, Any]],
                           paper: Optional[dict[str, Any]] = None,
                           order: Optional[dict[str, int]] = None,
                           occupied: Optional[dict[str, list]] = None,
                           drawn: Optional[dict[str, list]] = None,
                           written: Optional[set] = None) -> None:
    """Circle each question's mark in the right margin beside its answer.

    placements maps question_number -> (page_no, y). Built from where that
    question's annotations actually landed, so the mark sits next to the work
    it refers to. A question we could not locate on the page is left to the
    summary rather than being circled in an arbitrary spot.

    written: the questions whose own score was actually drawn on the page.
    None (a caller that does not track it) treats every score annotation as
    drawn, as before.
    """
    import fitz

    by_number = {v.get("question_number"): v for v in verdicts}
    # A question whose marking already carries its own score must not get a
    # second one from here. The marking guide asks the model for a `score`
    # annotation, and drawing the badge as well put the grade on the sheet
    # twice - once properly in the margin, once dropped inside the student's
    # sentence ("...the goods are handed 8 5/10 over").
    # Carrying one is not the same as drawing it: a score with no room on the
    # paper was refused, and skipping the badge too left the question with no
    # mark on the copy at all.
    already = set(written) if written is not None else set()
    for v in (verdicts if written is None else []):
        for ann in (v.get("annotations") or []):
            if ann.get("style") == "score" or (
                    ann.get("marks") is not None and ann.get("style") == "summary"):
                already.add(v.get("question_number"))
    for q_no, placed in placements.items():
        if q_no in already:
            logger.debug("question %s already carries its own score; not adding a badge", q_no)
            continue
        page_no, y = placed[0], placed[1]
        x_end = placed[2] if len(placed) > 2 else None
        verdict = by_number.get(q_no)
        if verdict is None or page_no < 0 or page_no >= doc.page_count:
            continue
        page = doc[page_no]
        # A teacher writes the mark where the answer FINISHES - just past the
        # end of the last line, or under it if that line runs to the margin.
        # Pinning every mark to a fixed gutter x produced a tidy column of
        # circled numbers down the page edge, which is the thing no human does
        # and the clearest remaining sign the script was machine-marked.
        rng = _hand_rng("score", q_no, page_no, round(y, 1))
        sheet = None
        if paper and order:
            for pid, idx in order.items():
                if idx == page_no:
                    sheet = paper.get(pid)
                    break
        # Sized to the writing, not to a constant. Rings measured 62-86px
        # against a ~40px line height, which is what made them read as badges
        # rather than a figure ringed with a pen.
        line_h = max(10.0, min(26.0 * _page_k(page), (sheet.height / 34.0) if sheet else 16.0))
        # A mark is written larger than the prose around it - it is the thing
        # the student looks for first. At 0.62-0.80 of a line it came out at
        # about 11pt against ~20pt handwriting and read as a footnote.
        radius = line_h * rng.uniform(0.95, 1.20)
        right_limit = ((sheet.x1 - radius - 4) if sheet
                       else (page.rect.width - radius - 6))
        top_limit = (sheet.y0 + radius + 4) if sheet else 30.0
        bot_limit = (sheet.y1 - radius - 4) if sheet else (page.rect.height - 30)
        # The outer margin first, level with where the answer ends. A mark
        # inside the text block lands on words however hard the collision
        # search works - both critics said the same thing: keep it out of the
        # block entirely.
        page_ink = (occupied or {}).get(page_id_for(order, page_no), [])
        block_right = max((o.x1 for o in page_ink), default=None)
        margin_x = (block_right + radius + rng.uniform(7.0, 16.0)
                    if block_right is not None else None)
        if margin_x is not None and margin_x <= right_limit:
            cx = margin_x
            cy = y - rng.uniform(1.0, 7.0)
        elif x_end is not None and x_end + radius + 10 <= right_limit:
            cx = x_end + radius + rng.uniform(6.0, 14.0)
            cy = y - rng.uniform(2.0, 8.0)
        else:
            # No margin at all - every row runs the full width of the sheet.
            # Scaling the answer's end by a fraction dropped the figure INSIDE
            # the sentence ("...settlement of accounts25 & his share"), which
            # reads as a typo rather than a mark. Put it in blank paper below
            # the answer, the way a teacher does when the margin is full.
            # Measured ink, plus the comments already written - the same
            # blockers the notes use. Falling back to the layout's row boxes
            # here left orphan digits inside the student's sentences
            # ("...settlement 7.5 of accounts"), which read as typos.
            measured = _ink_bands(_INK_MAP[0], sheet) if sheet else None
            blockers = list(measured or page_ink) + list(_PLACED[0] or [])
            # Never above the first written line: a score at the top of the
            # page reads as a page total, which is the one thing a
            # question-level mark must never look like.
            score_floor = (min(b.y0 for b in measured) if measured else None)
            band = (_free_band(sheet, blockers, radius * 2.2 + 4.0, y,
                               floor_y=score_floor,
                               max_dist=sheet.height * 0.30) if sheet else None)
            if band is not None:
                cy = min(band[0] + radius + 2.0, band[1] - radius - 2.0)
                cx = min(right_limit, (sheet.x0 + sheet.width * rng.uniform(0.62, 0.80)))
            else:
                # Nowhere clear for it. A mark written across the student's
                # own words is worse than a mark only on the summary, so drop
                # it rather than drop a digit into a sentence.
                logger.debug("no clear spot for the mark on question %s", q_no)
                continue
        left_limit = (sheet.x0 + radius + 4) if sheet else (radius + 4)
        cx = min(max(cx, left_limit), max(left_limit, right_limit))
        cy = min(max(cy, top_limit), max(top_limit, bot_limit))

        # A mark must not be stamped over the student's words. Both critics led
        # with this: "8/10 sits inside 1932", "7.5/10 on accounts". A teacher
        # writes the mark in whitespace - the blank end of a short line, the
        # margin, the gap under the answer - so search outward from the ideal
        # spot for somewhere actually clear before falling back.
        pid_here = page_id_for(order, page_no)
        # The student's writing AND the marks already on the page: a ring that
        # touches an existing rule fuses with it into one shape.
        ink = list((occupied or {}).get(pid_here, [])) + list((drawn or {}).get(pid_here, []))
        def clear(px, py):
            probe = fitz.Rect(px - radius, py - radius, px + radius, py + radius)
            if sheet and not sheet.contains(probe):
                return False
            return not any(probe.intersects(o) for o in ink)

        if ink and not clear(cx, cy):
            found = False
            # The right margin first: on a ruled page the strip past the end of
            # the longest line is genuinely empty, and it is where a marker's
            # running marks go. Then widen the search around the answer's end.
            right_margin = (max(o.x1 for o in ink) + radius + 6) if ink else cx
            left_margin = (min(o.x0 for o in ink) - radius - 6) if ink else cx
            # A critic measured 160 blue pixels inside one ring while the left
            # margin on that very row sat completely empty and unused.
            for margin_x in (right_margin, left_margin):
                for cand_y in (cy, cy - 12, cy + 12, cy - 26, cy + 26, cy - 40, cy + 40):
                    if left_limit <= margin_x <= right_limit and top_limit <= cand_y <= bot_limit \
                            and clear(margin_x, cand_y):
                        cx, cy, found = margin_x, cand_y, True
                        break
                if found:
                    break
            if not found:
                for dy in (0, 10, -10, 20, -20, 32, -32, 46, -46, 60, -60, 78, -78):
                    for dx in (0, 16, 32, -16, 48, -32, 64, -48, 80):
                        nx, ny = cx + dx, cy + dy
                        if (left_limit <= nx <= right_limit and top_limit <= ny <= bot_limit
                                and clear(nx, ny)):
                            cx, cy, found = nx, ny, True
                            break
                    if found:
                        break
            if not found:
                # Still nowhere clear at this size. A smaller mark squeezed into
                # a gap is what a teacher actually does on a full page; stamping
                # the ring over the answer - which is what happened on four of
                # seven marks - is the one thing they never do.
                for shrink in (0.82, 0.66, 0.52):
                    r2 = radius * shrink
                    def clear_small(px, py, rr=r2):
                        probe = fitz.Rect(px - rr, py - rr, px + rr, py + rr)
                        if sheet and not sheet.contains(probe):
                            return False
                        return not any(probe.intersects(o) for o in ink)
                    for dy in (0, 8, -8, 16, -16, 26, -26, 38, -38, 52, -52):
                        for dx in (0, 12, -12, 24, -24, 40, -40, 56, -56):
                            nx, ny = cx + dx, cy + dy
                            if clear_small(nx, ny):
                                cx, cy, radius, found = nx, ny, r2, True
                                break
                        if found:
                            break
                    if found:
                        break
        _CLIP[0] = sheet
        awarded = float(verdict.get("marks_awarded") or 0)
        out_of = verdict.get("max_marks")
        # Show the mark as "n/max", not a bare number: 3.5 alone tells a student
        # nothing about how far off they were. The question number goes just
        # above it, because a circled figure floating in the margin of a copy
        # answered out of order is otherwise anyone's guess.
        _draw_score_badge(page, fitz.Point(cx, cy), awarded,
                          out_of=float(out_of) if out_of else None, radius=radius)


def _extend_paper(page: Any, scan: Any, strip: Any) -> None:
    """Carry the sheet's own paper and ruling across the marking strip.

    A blank white strip is not a margin - it is the scanner's backdrop, and a
    comment written on it reads exactly like ink floating on nothing (a
    reviewer measured 38-43% of the pen as "off the page, no paper under it").
    Sampling the scan's paper colour and continuing its ruled lines at the same
    spacing makes the strip part of the same sheet, which is the whole point.
    """
    try:
        import fitz
        import numpy as np

        pix = page.get_pixmap(dpi=100, clip=scan)
        arr = np.frombuffer(pix.samples, np.uint8).reshape(
            pix.height, pix.width, pix.n)[:, :, :3].astype(int)
        grey = arr.mean(axis=2)
        lit = arr[grey > np.percentile(grey, 60)]
        if lit.size == 0:
            return
        paper = tuple(float(v) / 255.0 for v in lit.mean(axis=0))
        page.draw_rect(strip, color=paper, fill=paper, width=0)

        # The ruling: rows darker than their local neighbourhood, right across
        # the sheet. Continue each one into the strip at the tone it already
        # has, so the lines meet the page edge instead of stopping at it.
        rows = grey.mean(axis=1)
        smooth = np.convolve(rows, np.ones(25) / 25.0, mode="same")
        ruled = np.nonzero(rows < smooth - 3.0)[0]
        if ruled.size == 0:
            return
        rule_rgb = arr[ruled].reshape(-1, 3).mean(axis=0) / 255.0
        rule = tuple(float(v) for v in rule_rgb)
        sy = scan.height / pix.height
        drawn = -99.0
        for r in ruled:
            y = scan.y0 + float(r) * sy
            if y - drawn < 4.0:          # one line, not every dark scanline
                continue
            drawn = y
            page.draw_line(fitz.Point(strip.x0, y), fitz.Point(strip.x1 - 2, y),
                           color=rule, width=0.7)
    except Exception:
        logger.debug("could not extend the paper into the margin", exc_info=True)


# The styles that carry the reason a mark was cut.
_REASON_STYLES = frozenset(("margin_note", "region_note", "deduction_reason", "feedback"))


def _mask_rect(paper: Optional[dict]) -> Optional[Any]:
    """Bounding rect, in points, of a _paper_rows mask; None if there is none."""
    if not paper or paper.get("mask") is None:
        return None
    import fitz
    import numpy as np

    mask = paper["mask"]
    rows = np.nonzero(mask.any(axis=1))[0]
    cols = np.nonzero(mask.any(axis=0))[0]
    if not rows.size or not cols.size:
        return None
    sx, sy = paper["sx"], paper["sy"]
    return fitz.Rect(cols[0] * sx, rows[0] * sy, (cols[-1] + 1) * sx, (rows[-1] + 1) * sy)


def _write_reason_whole(page: Any, sheet: Any, text: str, near_y: float,
                        max_dist: Optional[float]) -> Optional[Any]:
    """Write a deduction reason WHOLE in the nearest blank band that holds it.

    Not _write_in_free_band: that one writes three or four words to a line to
    match the reference hand's climb, so a ten-word reason needs a gap three
    lines tall - rarer than hen's teeth on ruled paper written edge to edge -
    and when there is none it shortens the remark until it fits. A reason cut
    to "Wrong answer." or "Q21" tells the student nothing. Here the remark
    runs wide and nearly flat, one or two lines at a legible size, and is
    written whole or not at all. Uses the current page's module state
    (_INK_MAP, _PAPER, _PLACED, _LINE_H), as every placer here does.
    """
    import fitz

    line_h = float(_LINE_H[0] or 14.0)
    ideal = max(11.0, min(16.0 * _note_k(page), line_h * 0.9))
    # Never so small beside the student's writing that it reads as a footnote.
    floor = max(10.0, line_h * 0.30)
    max_w = sheet.width * 0.80

    def wrap(size: float) -> list:
        words, out, cur = text.split(), [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if _pen_text_width(trial, size) <= max_w or not cur:
                cur = trial
            else:
                out.append(cur)
                cur = w
        if cur:
            out.append(cur)
        return out

    size = ideal
    lines = wrap(size)
    while len(lines) > 2 and size > floor:
        size = max(floor, size - 0.5)
        lines = wrap(size)
    if not lines or len(lines) > 2:
        return None
    widest = max(_pen_text_width(l, size) for l in lines)
    # A long remark is written flatter than a short one, as a hand does.
    lift = min(widest * math.tan(math.radians(3.0)), size * 0.35)
    step = size * 1.9
    height = step * len(lines) + lift + 4.0

    bands = _ink_bands(_INK_MAP[0], sheet) or []
    wide = [b for b in bands if b.width > sheet.width * 0.30]
    # Never above the first written line - that is the page header.
    floor_y = min(b.y0 for b in (wide or bands)) if bands else None
    blockers = list(bands) + list(_PLACED[0] or [])
    x0 = max(sheet.x0 + 6.0, min(sheet.x0 + sheet.width * 0.09, sheet.x1 - widest - 6.0))
    for _ in range(8):
        band = _free_band(sheet, blockers, height, near_y, floor_y=floor_y, max_dist=max_dist)
        if band is None:
            return None
        y0 = max(band[0] + lift, min(near_y, band[1] - height + lift)) + 2.0
        box = _note_rect((x0 - 1.0, y0 - lift), widest + 2.0, height)
        if (_on_paper(_PAPER[0], box) and _ink_under(_INK_MAP[0], box) <= 0.03
                and not any(box.intersects(n) for n in (_PLACED[0] or []))):
            rng = _hand_rng("reason", text[:24], round(x0, 1), round(y0, 1))
            slant = rng.uniform(8.0, 12.0)
            tilt = _hand_rng("tilt", text[:24]).uniform(0.0, 4.0)
            rise = math.degrees(math.atan(lift / max(widest, 1.0)))
            for i, line in enumerate(lines):
                _pen_text(page, fitz.Point(x0 + rng.uniform(-0.6, 0.6), y0 + size * 0.95 + step * i),
                          line, size, _NOTE_TEXT, rng, slant=slant,
                          max_x=sheet.x1 - 3.0, rise=rise, tilt=tilt)
            return box
        # That gap is not usable here (off the paper, or ink the bands
        # missed); rule it out and take the next nearest.
        blockers.append(fitz.Rect(sheet.x0, band[0], sheet.x1, band[1]))
    return None


def _write_unwritten_reasons(doc: Any, unwritten: list, order: dict, paper: dict,
                             content: dict, occupied: dict, use_page: Any) -> int:
    """Write every deduction reason that found no room beside its answer.

    The score says a mark was cut; only the note says why. Every placement in
    build_annotated_pdf keeps a remark beside its answer and refuses anything
    else, so on a densely written page the reason was simply never written -
    7 of 16 on one 2026-09-30 copy, among them a 1/3 and a 2.5/5 with nothing
    beside them. Here it goes, WHOLE (_write_reason_whole), to the nearest
    blank paper that holds it: near its answer, anywhere on its own page, then
    the nearest other page - labelled with its question so it reads from
    wherever it lands.

    Returns how many were written.
    """
    import fitz

    by_no = {n: p for p, n in order.items() if 0 <= n < doc.page_count}
    written = 0

    def sheet_for(pid: str, pno: int) -> Any:
        # The whole sheet the paper mask found, not only `paper`, which is
        # the box around the writing when the layout has no paper_box: on a
        # page whose answer ends a quarter of the way down, that box leaves
        # out the blank paper below - the one place with room. Each spot is
        # still tested against the mask itself before anything is written.
        base = paper.get(pid) or content.get(pno, doc[pno].rect)
        found = _mask_rect(_PAPER[0])
        if found is None:
            return base
        whole = (base | found) & content.get(pno, doc[pno].rect)
        return base if whole.is_empty else whole

    for verdict, note, page_no, rect in unwritten:
        text = _teacher_voice(_latin1(note).strip())
        q_no = verdict.get("question_number")
        if q_no is not None:
            text = f"Q{q_no}: {text}"
        # (page, where to look from, how far from there it may land)
        plan = [(page_no, "answer", 0.30), (page_no, "answer", None)]
        # Nearest page first, the next one before the previous at equal
        # distance: an answer that ran on from the page before has its start
        # there, which is a better home for its remark than three pages on.
        others = sorted((n for n in by_no if n != page_no),
                        key=lambda n: (abs(n - page_no), n < page_no))
        plan += [(n, "top" if n > page_no else "bottom", None) for n in others]
        placed = None
        for pno, anchor, reach in plan:
            pid = by_no.get(pno)
            if pid is None:
                continue
            page = doc[pno]
            use_page(pid, pno)
            sheet = sheet_for(pid, pno)
            _CLIP[0] = sheet
            near_y = {"answer": rect.y1, "top": sheet.y0, "bottom": sheet.y1}[anchor]
            placed = _write_reason_whole(page, sheet, text, near_y,
                                         None if reach is None else sheet.height * reach)
            if placed is not None:
                occupied.setdefault(pid, []).append(placed)
                occupied.setdefault(pid + ":notes", []).append(placed)
                written += 1
                logger.debug("deduction reason %r written on page %d (%s)", text[:30], pno + 1,
                             "beside its answer" if reach else anchor)
                break
        if placed is None:
            logger.warning("copy-check annotator: no blank paper anywhere for the reason of Q%s: %r",
                           q_no, text[:60])
    return written


def build_annotated_pdf(
    pdf_bytes: bytes,
    layout_map: dict[str, Any],
    verdicts: list[dict[str, Any]],
    overall: Optional[dict[str, Any]] = None,
    append_summary: bool = False,
    margin_ratio: float = 0.0,
    comment_placement: Optional[str] = None,
    question_labels: Optional[dict[str, str]] = None,
) -> bytes:
    """Draw every verdict's annotations onto the student's copy.

    `comment_placement` OUTSIDE is the "Teacher comments" template: the marks
    (ticks, crosses, rules, scores) stay on the scan, but every written remark
    moves to a typed panel to the right of it, beside the answer it is about.
    Anything else (the default, INSIDE) writes the remarks on the copy in pen.
    `question_labels` maps question_id to the number printed on the paper, for
    the panel's headings.

    `append_summary` is OFF by default. A typed "Evaluation Summary" sheet -
    heading, Total / Percentage / Grade, then an analytical paragraph per
    question - stapled to the back of a marked script is a machine report, and
    it undoes the whole point of marking the paper by hand. The person this is
    built for looked at exactly that page and said "we don't want this UI".
    The per-criterion detail belongs in the teacher's review screen, which is
    what the feature spec asked for: available to the teacher, never cluttering
    the student's copy. Callers that genuinely want the sheet can opt in.


    Annotations whose target is missing from the layout map are skipped rather
    than guessed at — a box in the wrong place on a graded script is worse than
    no box. They still appear in the summary page, so nothing is silently lost.
    """
    import fitz  # PyMuPDF, already a dependency (see requirements.txt)

    # This module keeps per-page drawing state in module globals so the drawing
    # helpers can reach it without threading it through every signature. That
    # state belongs to ONE document: left over from a previous call it silently
    # mis-places marks - an ink map measured on another page reports writing
    # where there is none. Clear it on the way in.
    _CLIP[0] = None
    _INK_SPAN[0] = None
    _INK_MAP[0] = None
    _PLACED[0] = None
    _ROW_SLOPE[0] = 0.0
    _SCAN_W[0] = None
    _PEN[0] = _pen_for(pdf_bytes)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    outside = (comment_placement or "").strip().upper() == COMMENTS_OUTSIDE
    content: dict[int, Any] = {}
    # page_no -> the blank panel the remarks are typed into (OUTSIDE only).
    panels: dict[int, Any] = {}
    # (page_no, verdict index) -> top of its first mark / its remarks, in order.
    panel_anchor: dict[tuple[int, int], float] = {}
    panel_notes: dict[tuple[int, int], list[str]] = {}
    # (page, verdict) -> its language corrections, "wrong -> right" (OUTSIDE only).
    panel_language: dict[tuple[int, int], list[str]] = {}
    verdict_index = {id(v): i for i, v in enumerate(verdicts)}
    if outside:
        # The panel is plain white paper of its own, not a continuation of the
        # sheet: it is the teacher's comment sheet clipped beside the copy, so
        # the pen-margin strip below (and its ruled-paper extension) is not used.
        margin_ratio = 0.0
        widened = fitz.open()
        scan_w: dict[int, float] = {}
        for i in range(doc.page_count):
            src = doc[i].rect
            page = widened.new_page(width=src.width * (1.0 + _PANEL_RATIO), height=src.height)
            page.show_pdf_page(fitz.Rect(0, 0, src.width, src.height), doc, i)
            content[i] = fitz.Rect(0, 0, src.width, src.height)
            panels[i] = fitz.Rect(src.width, 0, page.rect.width, src.height)
            scan_w[i] = src.width
        doc.close()
        doc = widened
        _SCAN_W[0] = scan_w

    # A marking margin, when the scan has none of its own. This script is
    # written edge to edge - measured free margin is 1-16pt across the page -
    # so most of the teacher's feedback has physically nowhere to go: about
    # three quarters of it could not be placed at all. Widening the sheet and
    # putting the scan on the left gives the pen somewhere to write, at full
    # size, without covering a word of the student's answer. The scan itself is
    # untouched and unscaled; only the canvas around it grows.
    #
    # OFF by default: it changes the page geometry, so the copy is no longer
    # pixel-identical to what the student handed in. That is a product call.
    if outside:
        pass
    elif margin_ratio > 0.0:
        widened = fitz.open()
        for i in range(doc.page_count):
            src = doc[i].rect
            page = widened.new_page(width=src.width * (1.0 + margin_ratio),
                                    height=src.height)
            page.show_pdf_page(fitz.Rect(0, 0, src.width, src.height), doc, i)
            content[i] = fitz.Rect(0, 0, src.width, src.height)
            _extend_paper(page, content[i],
                          fitz.Rect(src.width, 0, page.rect.width, src.height))
        doc.close()
        doc = widened
    else:
        for i in range(doc.page_count):
            content[i] = doc[i].rect

    targets = _target_index(layout_map)
    rows_in_order = {
        lp.get("page_id"): sorted((r for r in (lp.get("lines") or [])
                                   if r.get("box") and len(r["box"]) == 4),
                                  key=lambda r: float(r["box"][1]))
        for lp in (layout_map.get("pages") or [])}
    rows_by_id = {r.get("line_id"): r
                  for lp in (layout_map.get("pages") or [])
                  for r in (lp.get("lines") or []) if r.get("line_id")}
    dims = _page_dims(layout_map)
    order = _page_order(layout_map)

    # A coarse luminance map per page, so ink photographs darker where the sheet
    # is shadowed. Stored on the layout by the pipeline; absent is fine.
    shade_by_page = {}
    for lp in (layout_map.get("pages") or []):
        grid = lp.get("shade_grid")
        pid = lp.get("page_id")
        if not grid or not pid:
            continue
        gh = len(grid); gw = len(grid[0]) if gh else 0
        wh = dims.get(pid)
        pno = order.get(pid)
        if not gw or not wh or pno is None or pno >= doc.page_count:
            continue
        prect = doc[pno].rect

        def make(grid=grid, gw=gw, gh=gh, prect=prect):
            def sample(x, y):
                gx = min(gw - 1, max(0, int(x / max(1.0, prect.width) * gw)))
                gy = min(gh - 1, max(0, int(y / max(1.0, prect.height) * gh)))
                return grid[gy][gx]
            return sample
        shade_by_page[pid] = make()


    # Every row the layout map knows about, in PDF points, per page. A pen note
    # is placed around these so it never lands on the student's writing.
    # Where the SHEET is, as opposed to where the PDF page is. These scans are
    # phone photos: the notebook occupies part of the frame and the rest is
    # desk. Marks placed by page geometry landed on the background - a critic
    # found the total written on the desk beside the page, and ticks clipped by
    # the image border. Everything is now kept inside the written area.
    paper: dict[str, Any] = {}
    occupied: dict[str, list[Any]] = {}
    writing: dict[str, list[Any]] = {}
    for lpage in layout_map.get("pages") or []:
        pid = lpage.get("page_id")
        page_no = order.get(pid)
        wh = dims.get(pid)
        if pid is None or page_no is None or not wh or page_no >= doc.page_count:
            continue
        prect = content.get(page_no, doc[page_no].rect)
        psx, psy = prect.width / wh[0], prect.height / wh[1]
        boxes = []
        raw_boxes = [i.get("box") for i in
                     (list(lpage.get("lines") or []) + list(lpage.get("regions") or []))]
        # ink_boxes covers writing that has no annotatable row of its own (rows
        # merged together, or blank-of-text rows that still carry ink). Without
        # it the placer sees a hole where there is writing and puts a note on it.
        raw_boxes += list(lpage.get("ink_boxes") or [])
        # The notebook's own printed rules run the full width of the sheet and
        # are picked up as ink. Treating them as obstacles meant every page
        # looked completely occupied - there was no right margin left to write
        # a mark in, so marks fell back onto the student's words. A teacher
        # writes across a printed rule without a thought; only the student's
        # handwriting is something to avoid.
        sheet_w = float(wh[0]) * psx
        for b in raw_boxes:
            if not b or len(b) != 4:
                continue
            bx, by, bw, bh = (float(v) for v in b)
            r = fitz.Rect(bx * psx, by * psy, (bx + bw) * psx, (by + bh) * psy)
            if r.width > sheet_w * 0.86 and r.height < 6.0:
                continue        # a ruled line, not writing
            boxes.append(r)
        occupied[pid] = boxes
        # The rows the vision read confirmed hold writing - only those: an
        # OCR box it blanked may be a pattern on the bedsheet, and a page it
        # never read keeps raw detections that are just as unverified.
        if lpage.get("vision_ocr"):
            writing[pid] = [
                fitz.Rect(float(b[0]) * psx, float(b[1]) * psy,
                          (float(b[0]) + float(b[2])) * psx, (float(b[1]) + float(b[3])) * psy)
                for b in (ln.get("box") for ln in (lpage.get("lines") or []))
                if b and len(b) == 4
            ]
        # A detected sheet is far better than the ink's bounding box: the box
        # excludes the paper's own margins, which is where a teacher writes,
        # while the sheet excludes the desk and the scanner's white padding,
        # where nobody writes. Fall back to the ink box when no sheet is known.
        photo = _photo_bounds(doc[page_no])
        if photo is not None:
            photo = _reach_written_rows(photo, lpage, psx, psy, prect)
        pbox = lpage.get("paper_box")
        if pbox and len(pbox) == 4:
            bx, by, bw, bh = (float(v) for v in pbox)
            paper[pid] = fitz.Rect(
                max(prect.x0 + 2, bx * psx), max(prect.y0 + 2, by * psy),
                min(prect.x1 - 2, (bx + bw) * psx), min(prect.y1 - 2, (by + bh) * psy),
            )
        elif boxes:
            pad = 10.0
            paper[pid] = fitz.Rect(
                max(prect.x0 + 4, min(b.x0 for b in boxes) - pad),
                max(prect.y0 + 4, min(b.y0 for b in boxes) - pad),
                min(prect.x1 - 4, max(b.x1 for b in boxes) + pad),
                min(prect.y1 - 4, max(b.y1 for b in boxes) + pad),
            )
        elif photo is not None:
            paper[pid] = fitz.Rect(photo)
        # Whatever the sheet was derived from, no mark may leave the paper in
        # the picture: the ink bound is drawn from boxes that can themselves
        # span the frame, which put comments on the scanner canvas.
        if photo is not None and pid in paper:
            clipped = paper[pid] & photo
            if not clipped.is_empty:
                paper[pid] = fitz.Rect(clipped.x0 + 2, clipped.y0 + 2,
                                       clipped.x1 - 2, clipped.y1 - 2)
        # The added marking strip is paper as far as the pen is concerned: it
        # is blank, it is beside the answer, and it is the whole reason the
        # canvas was widened. Without this the placer never looks there.
        if margin_ratio > 0.0 and pid in paper:
            # Widen to the strip, but keep the sheet's own TOP and BOTTOM: a
            # score written below the photograph landed in the scanner's footer
            # beside the "Scanned with ... Scanner" watermark, which is not
            # paper at any width.
            page_w = doc[page_no].rect.width
            paper[pid] = fitz.Rect(paper[pid].x0, paper[pid].y0,
                                   page_w - 6.0, paper[pid].y1)

    if outside:
        # Every mark stays on the scan. The fallbacks that place a mark "near
        # the page's right edge" when no sheet was detected would otherwise
        # put it in the comment panel.
        for pid, pno in (order or {}).items():
            if not 0 <= pno < doc.page_count:
                continue
            c = content[pno]
            scan = fitz.Rect(c.x0 + 2, c.y0 + 2, c.x1 - 2, c.y1 - 2)
            clipped = (paper[pid] & scan) if pid in paper else None
            paper[pid] = clipped if clipped is not None and not clipped.is_empty else scan

    # Measured once per page, before a single mark is drawn: our own ink would
    # otherwise widen every span we then try to avoid.
    ink_maps: dict[str, Any] = {}
    paper_rows: dict[str, Any] = {}
    for pid, page_no in (order or {}).items():
        if 0 <= page_no < doc.page_count:
            ink_maps[pid] = _ink_map(doc[page_no], paper.get(pid))
            paper_rows[pid] = _paper_rows(doc[page_no], writing.get(pid))

    drawn = 0
    # question_number -> (page_no, y) of its lowest annotation, so the circled
    # mark lands beside the end of that answer.
    placements: dict[int, tuple[int, float, float]] = {}
    # question_number of every question whose own score reached the page.
    scores_written: set[int] = set()
    # Deduction reasons no spot near their answer could hold - written after
    # every mark is down, see _write_unwritten_reasons.
    unwritten: list = []
    # One line, one stroke. Two questions whose answers meet mid-page both
    # marked the shared line, producing a green rule and a red rule 16px apart
    # under the same words - a critic flagged the pair directly. A marker rules
    # a line once.
    ruled: set = set()
    # Rects of the rules actually drawn, per page, so a score ring placed later
    # does not fuse with one.
    drawn_rules: dict = {}
    # Scarce space goes to the marks the student most needs. A richer marking
    # scheme asks for far more ink than a densely written page can hold - 98
    # comments wanted, 31 places for them - and first-come order meant praise
    # could take the gap a deduction's reason needed. Order by what a student
    # cannot do without: the total, then why marks were lost, then the block
    # marks, then praise.
    _PRIORITY = {"score": 0, "summary": 0, "deduction_reason": 1,
                 "strike": 2, "strikethrough": 2, "cross": 2, "circle": 2,
                 "brace": 3, "underline": 4, "feedback": 5, "margin_note": 5,
                 "region_note": 5, "tick": 6, "language": 7}
    ordered: list = []
    total_override: list = [None]      # a 'total' annotation, if enforce.py sent one
    # A page's typical line height: the median of its row boxes, in points.
    # Notes and scores are sized from this so one page is written in one hand.
    line_h_by_page: dict[str, float] = {}
    for lp in layout_map.get("pages") or []:
        pid_ = lp.get("page_id"); wh_ = dims.get(pid_); pn_ = order.get(pid_)
        if not wh_ or pn_ is None or pn_ >= doc.page_count:
            continue
        sy_ = content.get(pn_, doc[pn_].rect).height / wh_[1]
        hs_ = sorted(float(l["box"][3]) * sy_ for l in (lp.get("lines") or [])
                     if l.get("box") and len(l["box"]) == 4 and float(l["box"][3]) > 0)
        if hs_:
            line_h_by_page[pid_] = max(10.0, min(30.0 * _page_k(doc[pn_]), hs_[len(hs_) // 2]))
    for verdict in verdicts:
        for ann in verdict.get("annotations") or []:
            ordered.append((verdict, ann))
    ordered.sort(key=lambda va: _PRIORITY.get(
        (va[1].get("style") or "margin_note").strip().lower(), 4))

    def draw_total() -> None:
        # The total, circled top-right of page one - the first thing anyone
        # looks for on a returned script. Drawn FIRST, so every score and
        # comment placed after it keeps clear: drawn last, it went through
        # Q1's "1/1" in the margin, the one spot the placer had already used.
        if not doc.page_count:
            return
        for _v, _a in ordered:
            if (_a.get("style") or "").strip().lower() == "total" and _a.get("text"):
                total_override[0] = str(_a["text"])
                break
        import fitz
        total = sum(float(v.get("marks_awarded") or 0) for v in verdicts)
        out_of = sum(float(v.get("max_marks") or 0) for v in verdicts)
        if total_override[0] and "/" in total_override[0]:
            # enforce.py computes the total against the PAPER's maximum, not
            # the sum of the questions that happened to be graded.
            try:
                a_txt, m_txt = total_override[0].split("/", 1)
                total, out_of = float(a_txt), float(m_txt)
            except ValueError:
                pass
        first = doc[0]
        # Inside the SHEET's top-right corner, not the PDF page's. Hard-coding
        # page.width - 46 put the most prominent mark on the whole script -
        # the total - out on the scanner's white padding, 38pt past the paper
        # edge, which a critic called out by measurement.
        first_id = next((pid for pid, idx in order.items() if idx == 0), None)
        sheet0 = paper.get(first_id)
        _CLIP[0] = sheet0
        _PAPER[0] = paper_rows.get(first_id)
        # The marking guide's total: "awarded/max", hand-circled, about 2.3x
        # the line height, just below the Page No box. The earlier badge sat
        # 34pt from the sheet edge with a 22pt ring, so on a scan the ring and
        # the "/30" fell past the paper and were gated away, leaving a bare
        # "24" - the most prominent mark on the script, and it read as a
        # page number. Size it from the page's own rows and keep the whole
        # thing inside the sheet.
        line_h = 22.0
        try:
            lp0 = next((p for p in layout_map.get("pages") or []
                        if p.get("page_id") == first_id), None)
            if lp0 and lp0.get("lines"):
                wh0 = dims.get(first_id)
                pr0 = content.get(0, first.rect)
                sy0 = pr0.height / wh0[1] if wh0 else 1.0
                hs = sorted(float(l["box"][3]) * sy0 for l in lp0["lines"]
                            if l.get("box") and len(l["box"]) == 4 and float(l["box"][3]) > 0)
                if hs:
                    line_h = max(14.0, min(40.0 * _page_k(first), hs[len(hs) // 2]))
        except Exception:
            logger.debug("could not size the total from the rows", exc_info=True)
        # Keep the whole mark inside the sheet: measure the ring as it will
        # be drawn, and write the figure smaller when the sheet is narrow.
        text = _latin1(f"{_fmt_marks(total)}/{_fmt_marks(out_of)}")
        sheet_w = sheet0.width if sheet0 is not None else content.get(0, first.rect).width
        reach = _grand_total_reach(first, text, line_h)
        while reach[0] + reach[1] > sheet_w * 0.45 and line_h > 14.0:
            line_h = max(14.0, line_h * 0.9)
            reach = _grand_total_reach(first, text, line_h)
        reach_l, reach_r, reach_u, reach_d = reach
        if sheet0 is not None:
            by = sheet0.y0 + 62.0 + line_h * 1.2    # below the Page No / Date box
            edge = sheet0.x1
        else:
            by, edge = 62.0 + line_h * 1.2, content.get(0, first.rect).x1 - 10.0
        # The paper's measured edge, not the sheet rect: on a scan the mask
        # ends a few points inside it, and the ring was gated there.
        pe = _paper_right_edge(_PAPER[0], by - reach_u, by + reach_d)
        if pe is not None:
            edge = min(edge, pe)
        bx = edge - reach_r - 12.0
        # The guide's spot is under the Page No box, but a student who wrote
        # the day there ("Saturday") gets the ring through it. Of the spots
        # within a line or so of the guide's, take the one with the least
        # writing under it - the ring stays top-right either way.
        _INK_MAP[0] = ink_maps.get(first_id)
        best_y, best_ink = by, None
        for dy in (0.0, line_h * 0.5, line_h, -line_h * 0.5, line_h * 1.5):
            y = by + dy
            ring = fitz.Rect(bx - reach_l, y - reach_u, bx + reach_r, y + reach_d)
            if ring.y0 < (sheet0.y0 if sheet0 is not None else 0.0) + 6.0:
                continue
            ink = _ink_under(_INK_MAP[0], ring)
            if best_ink is None or ink < best_ink - 0.002:
                best_y, best_ink = y, ink
            if ink <= 0.005:
                break
        ring = _draw_grand_total(first, fitz.Point(bx, best_y), total, out_of, line_h)
        if ring is not None and first_id is not None:
            occupied.setdefault(first_id + ":notes", []).append(ring)
        _CLIP[0] = None
        _PAPER[0] = None
        _INK_MAP[0] = None

    draw_total()

    for verdict, ann in ordered:
        q_no = verdict.get("question_number")
        if True:
            target = targets.get(ann.get("target"))
            if not target:
                continue
            page_id = ann.get("page_id") or target["page_id"]
            page_no = order.get(page_id)
            if page_no is None or page_no < 0 or page_no >= doc.page_count:
                continue
            layout_wh = dims.get(page_id)
            if not layout_wh:
                continue

            page = doc[page_no]
            crect = content.get(page_no, page.rect)
            sx = crect.width / layout_wh[0]
            sy = crect.height / layout_wh[1]
            x, y, w, h = (float(v) for v in target["box"])
            rect = fitz.Rect(x * sx, y * sy, (x + w) * sx, (y + h) * sy)
            # A mark is never drawn narrower than 0.8x the row height. Some
            # rows are slivers - a label-only row like "Q15", or a stray OCR
            # box - and a tick sized to one renders as a vertical bar sitting
            # against the printed margin rule, which is the single clearest
            # tell that no teacher held the pen. Widen about the centre and
            # keep it inside the page content.
            min_w = rect.height * 0.8
            if 0 < rect.width < min_w:
                grow = (min_w - rect.width) / 2.0
                rect = fitz.Rect(max(crect.x0, rect.x0 - grow), rect.y0,
                                 min(crect.x1, rect.x1 + grow), rect.y1)

            _CLIP[0] = paper.get(page_id)
            _SHADE[0] = shade_by_page.get(page_id)
            row_meta = rows_by_id.get(ann.get("target")) or {}
            _ROW_SLOPE[0] = float(row_meta.get("slope_deg") or 0.0)
            ix0, ix1 = row_meta.get("ink_x0"), row_meta.get("ink_x1")
            _INK_SPAN[0] = ((ix0 * sx, ix1 * sx) if ix0 is not None and ix1 is not None
                            else None)
            # The layout's own ink_x1 was pinned to the sheet edge on every row
            # of every page, so it reported no free space anywhere. Measure it.
            _INK_MAP[0] = ink_maps.get(page_id)
            _PLACED[0] = occupied.setdefault(page_id + ":notes", [])
            _PAPER[0] = paper_rows.get(page_id)
            _LINE_H[0] = line_h_by_page.get(page_id)
            _MARGIN_X[0] = (content.get(page_no, page.rect).x1
                            if margin_ratio > 0.0 else None)
            measured = _row_ink_span(_INK_MAP[0], rect)
            if measured is not None:
                _INK_SPAN[0] = measured
            ink_bottom = row_meta.get("ink_bottom")
            if ink_bottom is not None:
                # Sit below the letters. Using the row band's bottom edge put
                # four of eight rules through the letter bodies, so a credit
                # underline read as a strikethrough.
                rect = fitz.Rect(rect.x0, rect.y0, rect.x1,
                                 max(rect.y1, float(ink_bottom) * sy))
            style = (ann.get("style") or "margin_note").strip().lower()
            if style == "language":
                # A language correction: the wrong words underlined where they
                # sit, the correction written above them - or, on the comments-
                # outside template, listed in the panel beside the answer.
                _draw_language(page, rect, ann, float(_LINE_H[0] or rect.height or 14.0),
                               occupied.setdefault(page_id, []), write_correction=not outside)
                if outside and ann.get("text") and ann.get("anchor_text"):
                    key = (page_no, verdict_index[id(verdict)])
                    panel_anchor[key] = min(panel_anchor.get(key, rect.y0), rect.y0)
                    fix = f"{ann['anchor_text']} \u2192 {ann['text']}"
                    said = panel_language.setdefault(key, [])
                    if fix not in said:
                        said.append(fix)
                drawn += 1
                continue
            if style == "total":
                # enforce.py's grand total: drawn once, below the Page No box,
                # by the block after this loop - never as a row annotation.
                if ann.get("text"):
                    total_override[0] = str(ann["text"])
                continue
            if style in ("underline", "strike", "strikethrough"):
                # Band the y so two row ids on the same visual line collapse.
                key = (page_no, round(rect.y0 / 9.0))
                if key in ruled:
                    # Already ruled by another question whose answer shares this
                    # line. A marker rules a line once; drawing it twice put a
                    # green rule and a red rule 16px apart under the same words.
                    continue
                ruled.add(key)
            # The note goes down FIRST, because whether it found room decides
            # what mark to draw. A bracket says "see my comment"; when the note
            # was silently dropped for want of space the bracket was left
            # pointing at nothing - which is exactly what a critic found, eight
            # times, "none with a word beside it".
            note = (ann.get("text") or "").strip()
            is_reason = (style in _REASON_STYLES
                         and float(verdict.get("marks_awarded") or 0)
                         < float(verdict.get("max_marks") or 0))
            # A brace bracket spans a BLOCK of the answer, so it needs the row
            # its closing target sits on, not just its opening one.
            if style == "brace":
                end_t = targets.get(ann.get("target_end"))
                if end_t:
                    er = end_t.get("box")
                    if er and len(er) == 4:
                        ey = (float(er[1]) + float(er[3])) * sy
                        rect = fitz.Rect(rect.x0, rect.y0, rect.x1,
                                         max(rect.y1, ey))
            # The figure a brace or a summary carries is written beside its
            # comment, the way a teacher writes "Good explanation  3".
            ann_marks = ann.get("marks")
            if style in ("brace", "summary") and ann_marks is not None:
                note = f"{note}  {_fmt_marks(float(ann_marks))}".strip()
            if outside:
                # The remark goes to the panel beside this answer; only the
                # mark itself, and a written score, stay on the copy.
                v_idx = verdict_index[id(verdict)]
                key = (page_no, v_idx)
                panel_anchor[key] = min(panel_anchor.get(key, rect.y0), rect.y0)
                if note and style != "score":
                    said = panel_notes.setdefault(key, [])
                    if note not in said:
                        said.append(note)
                    note = ""

            placed = None
            if note:
                page_boxes = occupied.setdefault(page_id, [])
                sheet_r = paper.get(page_id)
                # The guide's placement first; the free-space search only when
                # that spot is off the paper or on the student's writing.
                placed = _place_by_contract(page, rect, style, note,
                                            ann.get("position"), sheet_r, page_boxes)
                if placed is None and style != "score":
                    # The guide's spot is taken or on the writing. The gaps
                    # under this row and the next two still read as "about
                    # this answer", and so does the right margin; the
                    # free-space search does not - it squeezed "No balanced
                    # chemical equation written" into a two-word sliver and
                    # split "Mechanisms and examples" across a table rule.
                    line_h = float(_LINE_H[0] or rect.height or 14.0)
                    tries = []
                    if ann.get("position") != "below_line_left":
                        tries.append(("below_line_left", rect, note))
                    # Just past the student's last word, on the same line - where
                    # a teacher writes "Correct: Indus" after a one-word answer.
                    # Tried before the lines further down: on a page of one-line
                    # answers those are the NEXT answers, and "Wrong answer.
                    # Correct: Mohenjo-daro" written under Q16 read as Q16's.
                    if ann.get("position") != "right_of_line":
                        tries.append(("right_of_line", rect, note))
                    # A remark one or two lines down may sit under another
                    # answer, so it says which question it is about.
                    far_note = f"Q{q_no}: {note}" if q_no is not None else note
                    for shift in (1, 2):
                        tries.append(("below_line_left",
                                      fitz.Rect(rect.x0, rect.y0 + line_h * shift,
                                                rect.x1, rect.y1 + line_h * shift),
                                      far_note))
                    if ann.get("position") != "right_margin_same_line":
                        tries.append(("right_margin_same_line", rect, note))
                    for pos, where, text in tries:
                        placed = _place_by_contract(page, where, style, text, pos,
                                                    sheet_r, page_boxes)
                        if placed is not None:
                            break
                if placed is None and style == "score":
                    # A score lives in the right margin, full stop. When the
                    # guide's spot is refused (the scan's paper edge sits
                    # inside the page, or the line runs to the edge) try the
                    # right side of the neighbouring rows, then flush against
                    # the paper's real edge - never the free-space search,
                    # which put "2.5/3" in the left margin across the words.
                    # Obstacles are the notes already written, as in the contract
                    # path - not the layout's row boxes, which run to the edge of
                    # every line and would veto the whole margin.
                    following = []
                    order_ids = [r.get("line_id") for r in rows_in_order.get(page_id, [])]
                    if ann.get("target") in order_ids:
                        nxt = rows_in_order[page_id][order_ids.index(ann["target"]) + 1:]
                        for r in nxt[:4]:
                            if _ANSWER_START.match(r.get("text") or ""):
                                break
                            bx = [float(v) for v in r["box"]]
                            following.append(fitz.Rect(bx[0] * sx, bx[1] * sy,
                                                       (bx[0] + bx[2]) * sx, (bx[1] + bx[3]) * sy))
                    placed = _place_score_right(page, rect, note, sheet_r, _PLACED[0], following)
                if placed is None:
                    # A deduction's reason is never shortened here: one that
                    # cannot be written whole beside its answer goes to
                    # _write_unwritten_reasons, which finds room for all of it.
                    placed = _place_note(page, rect, style, note, page_boxes, sheet_r,
                                         allow_cut=not is_reason)

            _draw_mark(page, rect, style, paper.get(page_id),
                       has_note=placed is not None)
            if note and placed is None and is_reason:
                unwritten.append((verdict, note, page_no, rect))
            if style in ("underline", "strike", "strikethrough", "circle", "tick", "cross"):
                drawn_rules.setdefault(page_id, []).append(
                    fitz.Rect(rect.x0 - 4, rect.y0 - 6, rect.x1 + 4, rect.y1 + 8))

            if note:
                page_boxes = occupied.setdefault(page_id, [])
                if placed is not None:
                    occupied.setdefault(page_id + ":notes", []).append(placed)
                    # A written note is itself an obstacle: without this, two
                    # notes exiled to the same bottom margin print on top of
                    # each other and neither can be read.
                    page_boxes.append(placed)
            drawn += 1

            written_mark = style == "score" or (style == "summary" and ann_marks is not None)
            if q_no is not None and written_mark and placed is not None:
                scores_written.add(q_no)
            # A score or remark that found no room put no ink on the page, so
            # it says nothing about where the answer ends: its row may be the
            # very spot that refused it.
            if q_no is not None and not (style in ("score", "margin_note") and placed is None):
                prev = placements.get(q_no)
                if prev is None or (page_no, rect.y1) > (prev[0], prev[1]):
                    # keep the END of the line too: the mark belongs beside where
                    # the answer finishes, not in a column at the page edge.
                    placements[q_no] = (page_no, rect.y1, rect.x1)

    _place_question_scores(doc, placements, verdicts, paper, order, occupied, drawn_rules,
                           written=scores_written)

    if unwritten:
        def use_page(pid: str, pno: int) -> None:
            _CLIP[0] = paper.get(pid)
            _SHADE[0] = shade_by_page.get(pid)
            _INK_MAP[0] = ink_maps.get(pid)
            _PAPER[0] = paper_rows.get(pid)
            _PLACED[0] = occupied.setdefault(pid + ":notes", [])
            _LINE_H[0] = line_h_by_page.get(pid)
            _INK_SPAN[0] = None
            _ROW_SLOPE[0] = 0.0
            _MARGIN_X[0] = (content.get(pno, doc[pno].rect).x1
                            if margin_ratio > 0.0 else None)
        drawn += _write_unwritten_reasons(doc, unwritten, order, paper, content,
                                          occupied, use_page)

    _CLIP[0] = None
    if outside:
        _draw_comment_panels(doc, panels, panel_anchor, panel_notes, verdicts,
                             question_labels or {}, panel_language)
    _SCAN_W[0] = None
    if append_summary:
        _append_summary(doc, verdicts, overall)
    out = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    logger.info(
        "copy-check annotator: drew %d annotation(s) over %d page(s), %d question score(s) placed",
        drawn, len(order), len(placements),
    )
    return out


def _append_summary(doc: Any, verdicts: list[dict[str, Any]],
                    overall: Optional[dict[str, Any]] = None) -> None:
    """A plain marks + feedback page at the end.

    This is the part that is guaranteed legible: box placement depends on OCR
    quality, but the summary always carries the full verdict, so a teacher can
    always see what was awarded and why.
    """
    import fitz

    # Internal choice: a question outside its group's `attempt` is listed but
    # not added up (T1.36). Without choice groups every question counts.
    counted = [v for v in verdicts if v.get("counted", True)]
    total = sum(float(v.get("marks_awarded") or 0) for v in counted)
    out_of = sum(float(v.get("max_marks") or 0) for v in counted)

    page = doc.new_page()
    y = 56.0
    page.insert_text((48, y), "Evaluation Summary", fontsize=16, color=_SUMMARY_HEADING)
    y += 24

    # The result line a student actually looks for: mark, percentage, grade.
    pct = (total / out_of * 100.0) if out_of else 0.0
    page.insert_text((48, y), f"Total: {_fmt_marks(total)} / {_fmt_marks(out_of)}",
                     fontsize=13, color=_SUMMARY_HEADING)
    page.insert_text((190, y), f"Percentage: {pct:.1f}%", fontsize=13, color=_SUMMARY_HEADING)
    page.insert_text((330, y), f"Grade: {grade_for(pct)}", fontsize=13, color=_WRONG)
    y += 22

    # Any question the model was unsure of is named here rather than buried, so
    # a teacher knows which marks to look at before releasing the result.
    unsure = [v for v in verdicts
              if float(v.get("confidence") or 1.0) < _REVIEW_CONFIDENCE
              or v.get("status") == "FAILED"]
    if unsure:
        names = ", ".join(f"Q{v.get('question_number') or '?'}" for v in unsure)
        page.insert_text((48, y), f"Teacher review required: {names}",
                         fontsize=10, color=_WRONG)
        y += 18

    remarks = (overall or {}).get("teacher_remarks") if overall else None
    if remarks:
        page.insert_text((48, y), "Teacher's Remarks", fontsize=11, color=_SUMMARY_HEADING)
        y += 15
        box = fitz.Rect(48, y, page.rect.width - 48, y + 62)
        page.insert_textbox(box, _latin1(remarks), fontsize=9.5, color=_SUMMARY_HEADING)
        y += 68
    y += 8

    for v in verdicts:
        if y > page.rect.height - 90:
            page = doc.new_page()
            y = 56.0
        head = (f"Q{v.get('question_number') or '?'}  "
                f"{round(float(v.get('marks_awarded') or 0), 2)} / "
                f"{round(float(v.get('max_marks') or 0), 2)}")
        if str(v.get("status") or "").upper() == "FAILED":
            head += "   (needs manual review)"
        elif not v.get("counted", True):
            head += "   (not counted: internal choice)"
        page.insert_text((48, y), _latin1(head), fontsize=10, color=_HIGHLIGHT)
        y += 14

        feedback = (v.get("feedback") or "").strip()
        if feedback:
            box = fitz.Rect(48, y, page.rect.width - 48, y + 88)
            # Negative return = text did not fit; the DB verdict remains the
            # complete record, so truncation here is cosmetic.
            page.insert_textbox(box, _latin1(feedback), fontsize=8, color=_SUMMARY_HEADING)
            y += 92
        else:
            y += 6


async def _fetch_pdf(pdf_url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        resp = await client.get(pdf_url)
        resp.raise_for_status()
        return resp.content


async def _upload(content: bytes, filename: str) -> Optional[str]:
    """POST the PDF to media-service and return its fileId.

    upload-file-v2 (not upload-file) because only the v2 response carries the
    id — plain upload-file returns a CDN URL, and evaluated_file_id must hold
    an id the admin dashboard can pass to getPublicUrl.

    Auth: media_service gates every URI containing "internal" with the shared
    InternalAuthFilter, which reads clientName + Signature — NOT the
    X-Internal-Service-Token that assessment_service's callback endpoints use.
    Sending the wrong header 401s every upload and the feature silently renders
    for nothing, so this reuses internal_auth_headers() exactly like
    media_file_client does for the sibling /internal/get-url/id call.
    """
    # Lazy import, same as fitz: keeps the pure rendering functions loadable
    # standalone (tests) without dragging in the DB-backed auth stack.
    from ..internal_auth import internal_auth_headers

    url = f"{_media_base_url()}/media-service/internal/upload-file-v2"
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            url,
            files={"file": (filename, content, "application/pdf")},
            headers=await internal_auth_headers(),
        )
        resp.raise_for_status()
        file_id = (resp.json() or {}).get("id")
        return file_id or None


# media-service refuses multipart bodies over 20 MB (spring.servlet.multipart.
# max-file-size). A phone scan of seven pages stored as PNG is ~29 MB before a
# single mark is drawn, so the checked copy of every such sheet was silently
# dropped (511 MaxUploadSizeExceeded, 2026-09-20). Stay well under the cap.
UPLOAD_CAP_BYTES = 18 * 1024 * 1024
_JPEG_QUALITY = 78
_MAX_SCAN_SIDE_PX = 2000
_MIN_SCAN_BYTES = 300 * 1024  # below this it is a mark layer or a logo, not a page scan


def shrink_scans(pdf_bytes: bytes, cap_bytes: int = UPLOAD_CAP_BYTES) -> bytes:
    """Re-encode the page scans so the PDF fits under `cap_bytes`; the vector
    annotations drawn on top are untouched.

    Each pass converts every raster image to JPEG (capping the longer side at
    _MAX_SCAN_SIDE_PX, then 75% of that, then 56%) and stops as soon as the file
    is small enough. Already-small files are returned as they are; a file that
    cannot be shrunk is returned as its smallest attempt so the caller still
    tries the upload rather than giving up here.
    """
    if len(pdf_bytes) <= cap_bytes:
        return pdf_bytes
    import fitz  # noqa: PLC0415  (lazy, as elsewhere in this module)

    best = pdf_bytes
    for scale in (1.0, 0.75, 0.56):
        max_side = int(_MAX_SCAN_SIDE_PX * scale)
        doc = fitz.open(stream=best, filetype="pdf")
        try:
            seen: set[int] = set()
            for page in doc:
                for img in page.get_images(full=True):
                    xref, smask = img[0], img[1]
                    if xref in seen:
                        continue
                    seen.add(xref)
                    # Only the page scans. The pen marks are small transparent
                    # PNG layers laid over the scan; JPEG has no alpha, so
                    # re-encoding them paints their background black (seen on
                    # every tick and note, 2026-09-21). Anything with a soft
                    # mask, an alpha channel, or under ~300 KB is left as it is.
                    if smask:
                        continue
                    try:
                        raw_len = doc.xref_stream_raw(xref)
                        if raw_len is not None and len(raw_len) < _MIN_SCAN_BYTES:
                            continue
                    except Exception:  # noqa: BLE001
                        pass
                    try:
                        pix = fitz.Pixmap(doc, xref)
                        if pix.alpha:
                            continue
                        if pix.n >= 4:
                            pix = fitz.Pixmap(fitz.csRGB, pix)
                        longest = max(pix.width, pix.height)
                        if longest > max_side:
                            factor = max_side / longest
                            pix = _resize(pix, factor)
                        page.replace_image(xref, stream=pix.tobytes("jpeg", jpg_quality=_JPEG_QUALITY))
                    except Exception as exc:  # noqa: BLE001 — one odd image must not stop the rest
                        logger.debug("shrink_scans: xref %s left as is: %s", xref, exc)
            out = doc.tobytes(garbage=3, deflate=True)
        finally:
            doc.close()
        if len(out) < len(best):
            best = out
        if len(best) <= cap_bytes:
            break
    logger.info("copy-check annotator: checked copy %.1f MB -> %.1f MB for upload",
                len(pdf_bytes) / 1e6, len(best) / 1e6)
    return best


def _resize(pix: "fitz.Pixmap", factor: float) -> "fitz.Pixmap":
    """Downscale a pixmap by rendering it through a matrix (PyMuPDF has no direct resize)."""
    import fitz  # noqa: PLC0415

    doc = fitz.open()
    try:
        page = doc.new_page(width=pix.width, height=pix.height)
        page.insert_image(page.rect, pixmap=pix)
        return page.get_pixmap(matrix=fitz.Matrix(factor, factor), alpha=False)
    finally:
        doc.close()


# PyMuPDF does not promise thread safety, so one checked copy is drawn at a
# time per pod. It runs off the event loop (T0.27): drawing and shrinking a
# 40-page copy is seconds of CPU, which on the loop froze every other copy's
# callbacks and heartbeats, and the /grade and /inspect endpoints. The pool is
# its own single worker, never the default asyncio executor: copies queued for
# a render must not hold the threads job_guard's claim/heartbeat calls use.
_RENDER_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="copy-check-render")


def _render_sync(pdf_bytes: bytes, layout_map: dict[str, Any], verdicts: list[dict[str, Any]],
                 comment_placement: Optional[str] = None,
                 question_labels: Optional[dict[str, str]] = None) -> bytes:
    annotated = None
    if (comment_placement or "").strip().upper() == COMMENTS_OUTSIDE:
        # The panel template must never cost a student the checked copy: if it
        # fails, the usual copy is rendered instead. It works on a copy of the
        # verdicts so that fallback starts from exactly what the grader sent.
        try:
            annotated = build_annotated_pdf(pdf_bytes, layout_map, copy.deepcopy(verdicts),
                                            comment_placement=COMMENTS_OUTSIDE,
                                            question_labels=question_labels)
        except Exception:
            logger.warning("copy-check annotator: comment-panel template failed; rendering the usual copy",
                           exc_info=True)
    if annotated is None:
        annotated = build_annotated_pdf(pdf_bytes, layout_map, verdicts)
    return shrink_scans(annotated)


async def render_and_upload(
    pdf_url: str,
    layout_map: dict[str, Any],
    verdicts: list[dict[str, Any]],
    attempt_id: str,
    comment_placement: Optional[str] = None,
    question_labels: Optional[dict[str, str]] = None,
) -> Optional[str]:
    """Produce the checked copy and return its media-service fileId.

    Returns None on any failure. Grading has already succeeded and been
    reported by the time this runs, so a rendering or upload problem must
    degrade to "no annotated copy" and never fail the evaluation.
    """
    try:
        pdf_bytes = await _fetch_pdf(pdf_url)
        annotated = await asyncio.get_running_loop().run_in_executor(
            _RENDER_POOL, _render_sync, pdf_bytes, layout_map, verdicts,
            comment_placement, question_labels)
        file_id = await _upload(annotated, f"evaluated-copy-{attempt_id}.pdf")
        if not file_id:
            logger.warning("copy-check annotator: media-service returned no id for attempt %s", attempt_id)
            return None
        logger.info("copy-check annotator: uploaded checked copy %s for attempt %s", file_id, attempt_id)
        return file_id
    except httpx.HTTPStatusError as e:
        logger.warning("copy-check annotator: upload refused for attempt %s: %s %s", attempt_id,
                       e.response.status_code, e.response.text[:200])
        return None
    except Exception as e:
        logger.warning("copy-check annotator failed for attempt %s: %s: %s", attempt_id, type(e).__name__, e)
        return None
