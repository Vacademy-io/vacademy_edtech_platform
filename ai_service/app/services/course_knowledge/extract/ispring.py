"""iSpring exports inside SCORM packages: their text, and their slides as images.

Pure functions (no network, no DB): scorm.py fetches, these parse.

iSpring Suite (a PowerPoint export) ships one res/data/slideN.js per slide.
Each calls a load handler with the slide as an HTML string:

    loadHandler(0, '<div id="spr0_…"><img src="data/img9.png" width="960px"
        height="540px" style="left:0px;top:0px;"/><div style="top:210px;">
        <img src="data/img0.png" width="318" height="330" style="left:0px;"/>
        …<span>Unit I: Introduction</span>…</div></div>', '{"s":[]}')

Text iSpring could keep as text is in <span>s (free). Text it rasterised (a
font it could not embed, effects, Devanagari on some exports) is pixels inside
the absolutely positioned PNGs; nested divs add their left/top to their
children. compose_slide paints a slide's images (and its solid SVG shapes,
as boxes) in document order onto one white canvas, so a slide costs ONE OCR
call however many images it has.

iSpring Page (a web course) ships res/data-1.json instead: every character is
a {"t": "x"} entry in a "c" list, sections in content.c.B ordered by
content.c.o, each with a header h.t / h.s. All of it is free text.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple, Union

from .types import Segment

CANVAS = (960, 540)                  # iSpring's default slide size
MAX_CANVAS = (1920, 1440)
COMPOSE_SCALE = 2                    # OCR reads small slide text better at 2x
MAX_IMAGE_PIXELS = 16_000_000        # per source image; larger is skipped (decompression bombs)
MAX_OPS_PER_SLIDE = 60               # images + shapes painted per slide
FLAT_MAX_COLORS = 3                  # a downscaled image with this few colours carries no text
_JPEG_ABOVE_BYTES = 4 * 1024 * 1024  # a composed PNG larger than this is sent as JPEG

_SLIDE_JS_RE = re.compile(r"(?:^|/)data/slide(\d+)\.js$", re.IGNORECASE)
_DATA_JSON_RE = re.compile(r"(?:^|/)data-\d+\.json$", re.IGNORECASE)
_LOAD_RE = re.compile(r"loadHandler\s*\(\s*\d+\s*,\s*(['\"])")
_HEX_ID_RE = re.compile(r"[0-9a-f]{6,12}")
_COLOR_RE = re.compile(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")
_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")

_VOID = {"img", "br", "hr", "input", "meta", "link", "source", "wbr", "path", "rect", "circle", "ellipse",
         "line", "polyline", "polygon", "use", "stop", "image"}
_SHAPES = {"path", "rect", "circle", "ellipse", "polygon"}
_INLINE = {"span", "a", "b", "i", "u", "em", "strong", "sup", "sub", "font", "small", "label"}
_BREAKS = {"div", "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section"}


# ── iSpring Suite: slideN.js ─────────────────────────────────────────────────

def slide_scripts(hrefs: Sequence[str]) -> List[Tuple[int, str]]:
    """(slide number, href) of every res/data/slideN.js the manifest lists, in slide order."""
    found: Dict[int, str] = {}
    for href in hrefs:
        m = _SLIDE_JS_RE.search((href or "").strip().split("?", 1)[0])
        if m:
            found.setdefault(int(m.group(1)), href.strip())
    return sorted(found.items())


def data_json_hrefs(hrefs: Sequence[str]) -> List[str]:
    """iSpring Page content files (res/data-1.json …), deduped, in manifest order."""
    out: List[str] = []
    for href in hrefs:
        h = (href or "").strip()
        if _DATA_JSON_RE.search(h.split("?", 1)[0]) and h not in out:
            out.append(h)
    return out


def slide_markup(js: str) -> Optional[str]:
    """The HTML string a slideN.js hands its load handler (a JS string literal, unescaped)."""
    m = _LOAD_RE.search(js or "")
    if not m:
        return None
    quote, i, out = m.group(1), m.end(), []
    n = len(js)
    while i < n:
        ch = js[i]
        if ch == "\\" and i + 1 < n:
            nxt = js[i + 1]
            if nxt == "u" and i + 6 <= n:
                try:
                    out.append(chr(int(js[i + 2:i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            if nxt == "x" and i + 4 <= n:
                try:
                    out.append(chr(int(js[i + 2:i + 4], 16)))
                    i += 4
                    continue
                except ValueError:
                    pass
            out.append({"n": "\n", "t": "\t", "r": "\r"}.get(nxt, nxt))
            i += 2
            continue
        if ch == quote:
            return "".join(out)
        out.append(ch)
        i += 1
    return None


@dataclass
class ImageOp:
    src: str
    x: float
    y: float
    w: float
    h: float


@dataclass
class FillOp:
    x: float
    y: float
    w: float
    h: float
    color: Tuple[int, int, int]


@dataclass
class SlideLayout:
    text: str = ""
    ops: List[Union[ImageOp, FillOp]] = field(default_factory=list)

    @property
    def images(self) -> List[ImageOp]:
        return [op for op in self.ops if isinstance(op, ImageOp)]


def _px(style: str, prop: str) -> float:
    m = re.search(rf"(?:^|[;\s]){prop}\s*:\s*(-?\d+(?:\.\d+)?)px", style or "", re.IGNORECASE)
    return float(m.group(1)) if m else 0.0


def _num(raw: Optional[str]) -> float:
    m = _NUM_RE.search(raw or "")
    return float(m.group(0)) if m else 0.0


def _color(raw: Optional[str]) -> Optional[Tuple[int, int, int]]:
    m = _COLOR_RE.match((raw or "").strip())
    if not m:
        return None
    hx = m.group(1)
    if len(hx) == 3:
        hx = "".join(c * 2 for c in hx)
    return int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)


class _SlideParser(HTMLParser):
    """Absolute boxes of a slide's images and solid shapes, plus its span text.

    Every element's style left/top is relative to its parent's box (iSpring
    positions everything absolutely). Whitespace BETWEEN spans is the
    export's formatting, not text: "RAJASW</span> <span>A" reads RAJASWA."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: List[Tuple[str, float, float]] = [("#root", 0.0, 0.0)]
        self.layout = SlideLayout()
        self.lines: List[str] = []
        self.current: List[str] = []
        self.svg: Optional[Dict[str, Any]] = None
        self.skip = 0

    def _place(self, attrs: Dict[str, Optional[str]]) -> Tuple[float, float]:
        _tag, px, py = self.stack[-1]
        style = attrs.get("style") or ""
        return px + _px(style, "left"), py + _px(style, "top")

    def _element(self, tag: str, attrs: Dict[str, Optional[str]]) -> Tuple[float, float]:
        x, y = self._place(attrs)
        if tag == "img":
            src = (attrs.get("src") or "").strip()
            w, h = _num(attrs.get("width")), _num(attrs.get("height"))
            if src and not src.lower().startswith(("data:", "javascript:")) and w > 0 and h > 0:
                self.layout.ops.append(ImageOp(src=src, x=x, y=y, w=w, h=h))
        elif tag == "svg":
            self.svg = {"x": x, "y": y, "w": _num(attrs.get("width")), "h": _num(attrs.get("height")),
                        "painted": False}
        elif tag in _SHAPES and self.svg is not None and not self.svg["painted"]:
            color = _color(attrs.get("fill"))
            if color is not None and self.svg["w"] > 0 and self.svg["h"] > 0:
                s = self.svg
                self.layout.ops.append(FillOp(x=s["x"], y=s["y"], w=s["w"], h=s["h"], color=color))
                s["painted"] = True
        return x, y

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        a = dict(attrs)
        x, y = self._element(tag, a)
        if tag in _VOID:
            return
        if tag in ("script", "style"):
            self.skip += 1
        self.stack.append((tag, x, y))

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self._element(tag, dict(attrs))
        if tag == "svg":
            self.svg = None

    def handle_endtag(self, tag: str) -> None:
        if tag in _VOID:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag == "svg":
            self.svg = None
        elif tag in _BREAKS:
            self._newline()

    def handle_data(self, data: str) -> None:
        if self.skip or not data:
            return
        if not data.strip() and self.stack[-1][0] not in _INLINE:
            return
        self.current.append(data)

    def _newline(self) -> None:
        line = re.sub(r"\s+", " ", "".join(self.current)).strip()
        if line:
            self.lines.append(line)
        self.current = []

    def result(self) -> SlideLayout:
        self._newline()
        self.layout.text = "\n".join(self.lines)
        return self.layout


def parse_slide(markup: str) -> SlideLayout:
    parser = _SlideParser()
    try:
        parser.feed(markup or "")
        parser.close()
    except Exception:  # noqa: BLE001 - a malformed slide keeps what was parsed
        pass
    return parser.result()


def parse_slide_js(js: str) -> Optional[SlideLayout]:
    markup = slide_markup(js)
    return parse_slide(markup) if markup is not None else None


# ── composition ──────────────────────────────────────────────────────────────

def _open(data: bytes):
    from PIL import Image
    img = Image.open(io.BytesIO(data))
    w, h = img.size
    if w <= 0 or h <= 0 or w * h > MAX_IMAGE_PIXELS:
        raise ValueError("image too large")
    return img


def is_flat(data: bytes) -> bool:
    """True for an image that cannot carry text: fully transparent, or a few
    flat colours (iSpring's solid 1-bit slide backgrounds). Anti-aliased
    glyphs always add many colours. An unreadable image counts as flat."""
    try:
        img = _open(data).convert("RGBA")
    except Exception:  # noqa: BLE001
        return True
    if img.getextrema()[3][1] < 16:
        return True
    img.thumbnail((128, 128))
    colors = img.getcolors(maxcolors=FLAT_MAX_COLORS)
    return colors is not None


def canvas_size(layout: SlideLayout) -> Tuple[int, int]:
    """The slide canvas: iSpring's 960x540 unless the slide's own boxes reach
    further (a 4:3 or larger export), capped."""
    w, h = CANVAS
    for op in layout.ops:
        w = max(w, int(op.x + op.w + 0.5))
        h = max(h, int(op.y + op.h + 0.5))
    return min(w, MAX_CANVAS[0]), min(h, MAX_CANVAS[1])


def compose_slide(layout: SlideLayout, images: Dict[str, bytes], *,
                  scale: int = COMPOSE_SCALE) -> Tuple[Optional[bytes], str, int]:
    """One picture of the slide: white canvas, then every shape and image in
    document order (later ones on top) at its box, scaled. Returns (bytes,
    mime type, images painted); (None, "", 0) when nothing could be painted."""
    from PIL import Image, ImageDraw

    cw, ch = canvas_size(layout)
    canvas = Image.new("RGBA", (cw * scale, ch * scale), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    painted = 0
    for op in layout.ops[:MAX_OPS_PER_SLIDE]:
        box = (int(round(op.x * scale)), int(round(op.y * scale)),
               int(round((op.x + op.w) * scale)), int(round((op.y + op.h) * scale)))
        if box[2] <= 0 or box[3] <= 0 or box[0] >= canvas.width or box[1] >= canvas.height:
            continue
        if isinstance(op, FillOp):
            draw.rectangle(box, fill=op.color + (255,))
            continue
        data = images.get(op.src)
        if not data:
            continue
        try:
            img = _open(data).convert("RGBA")
        except Exception:  # noqa: BLE001 - one broken image must not lose the slide
            continue
        size = (max(1, box[2] - box[0]), max(1, box[3] - box[1]))
        if img.size != size:
            img = img.resize(size, Image.LANCZOS)
        layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
        layer.paste(img, (box[0], box[1]))
        canvas = Image.alpha_composite(canvas, layer)
        draw = ImageDraw.Draw(canvas)
        painted += 1
    if painted == 0:
        return None, "", 0
    rgb = canvas.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, format="PNG", optimize=True)
    if buf.tell() <= _JPEG_ABOVE_BYTES:
        return buf.getvalue(), "image/png", painted
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=88)
    return buf.getvalue(), "image/jpeg", painted


# ── iSpring Page: data-1.json ────────────────────────────────────────────────

def _runs(node: Any) -> Iterator[str]:
    """Text runs in reading order: "c" character lists, "B" maps walked in their "o" order."""
    if isinstance(node, list):
        for item in node:
            yield from _runs(item)
        return
    if not isinstance(node, dict):
        return
    chars = node.get("c")
    if isinstance(chars, list) and chars and all(isinstance(x, dict) and "t" in x for x in chars):
        run = "".join(str(x.get("t") or "") for x in chars)
        run = re.sub(r"[ \t]+", " ", run).strip()
        if run and not _HEX_ID_RE.fullmatch(run):
            yield run
    blocks, order = node.get("B"), node.get("o")
    for key, value in node.items():
        if key in ("c", "h", "atl", "o", "m"):
            continue
        if key == "B" and isinstance(blocks, dict):
            keys = [k for k in order if k in blocks] if isinstance(order, list) else []
            keys += [k for k in blocks if k not in keys]
            for k in keys:
                yield from _runs(blocks[k])
            continue
        if isinstance(value, (dict, list)):
            yield from _runs(value)


def page_sections(data: Any) -> List[Segment]:
    """One segment per iSpring Page section: its header and its text, in course order."""
    content = data.get("content") if isinstance(data, dict) else None
    root = content.get("c") if isinstance(content, dict) else None
    blocks = root.get("B") if isinstance(root, dict) else None
    if not isinstance(blocks, dict):
        return []
    order = root.get("o") if isinstance(root.get("o"), list) else []
    keys = [k for k in order if k in blocks] + [k for k in blocks if k not in order]
    out: List[Segment] = []
    for idx, key in enumerate(keys, start=1):
        sec = blocks.get(key)
        if not isinstance(sec, dict):
            continue
        head = sec.get("h") if isinstance(sec.get("h"), dict) else {}
        title = re.sub(r"\s+", " ", str(head.get("t") or "")).strip()
        subtitle = re.sub(r"\s+", " ", str(head.get("s") or "")).strip()
        parts = [p for p in (title, subtitle) if p]
        parts += [r for r in _runs(sec) if r not in parts]
        body = "\n".join(parts).strip()
        if body:
            out.append(Segment(text=body, anchor="none", label=title or f"Section {idx}"))
    return out


__all__ = [
    "CANVAS", "COMPOSE_SCALE", "ImageOp", "FillOp", "SlideLayout",
    "slide_scripts", "data_json_hrefs", "slide_markup", "parse_slide", "parse_slide_js",
    "is_flat", "canvas_size", "compose_slide", "page_sections",
]
