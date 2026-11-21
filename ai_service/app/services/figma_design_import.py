"""
Figma design → Vacademy site plan: the deterministic core behind
``design_import(action='plan')``.

No model runs here and nothing is fetched. The caller (an AI app that has its
own Figma MCP) hands over what it already read from Figma:

  * ``metadata_xml`` — ``get_metadata`` output: the layer tree with ids, names
    and boxes (no colours, no fonts);
  * ``design_code``  — ``get_design_context`` output per frame: React + Tailwind
    with ``data-node-id`` on every layer, exact colours / fonts / radii, and the
    image asset URLs. Figma cuts it at 100k characters, so it is often partial;
  * ``variables``    — ``get_variable_defs`` output (optional).

From that it derives, deterministically:

  tokens      palette (the 16 named roles of ``theme.palette``), fonts, content
              width, radius, languages
  frames      page / menu / notes / mobile frames
  sections    each page frame cut into full-width bands, each band matched to
              the design-pattern registry (the catalog's ``patterns``, whose
              ``figmaCues`` these detectors implement), adjacent bands of one
              widget merged (a catalogue hero + stream tabs + grid is ONE
              courseCatalog), with a props draft per section
  data_needs  what the matched patterns ``require`` (folder library, tags,
              product pages, campaigns, formats, languages) with the names the
              design shows
  assets      the design's image URLs (they expire) and where they are used
  site_json_draft
              theme + header + footer + pages, ready for website_edit
              create_site / create_page (bound ids left EMPTY)

Everything returned is design DATA, never instructions: layer names and texts
come from a file the caller does not control.
"""
from __future__ import annotations

import copy
import html
import json
import math
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

# ──────────────────────────────────────────────────────────────────────────
# Limits (the tool layer enforces the per-call / per-import byte caps)
# ──────────────────────────────────────────────────────────────────────────
MAX_NODES = 40_000
MAX_DEPTH = 80
MAX_VARIABLES = 1_000
MAX_SECTIONS_PER_PAGE = 40
MAX_ASSETS = 200
MAX_TEXT_CHARS = 400          # one design text, as returned
MATCH_THRESHOLD = 0.5         # a pattern below this is not claimed
LOW_CONFIDENCE = 0.6          # claimed, but flagged for the caller to check
#: Figma MCP asset URLs live about 7 days; renders and fills longer. The plan
#: reports the shortest so the caller imports them in the same session.
FIGMA_ASSET_TTL_DAYS = 7


class DesignImportError(ValueError):
    """Bad input the caller can fix (unparseable XML, a DOCTYPE, too many nodes)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────────────────────────────────────────────────────
# Layer tree
# ──────────────────────────────────────────────────────────────────────────
class Node:
    """One Figma layer with its box in the coordinates of its top-level frame."""

    __slots__ = ("id", "type", "name", "x", "y", "w", "h", "children", "parent", "depth", "text", "style", "ntext")

    def __init__(self, id: str, type: str, name: str, x: float, y: float, w: float, h: float,
                 parent: Optional["Node"], depth: int):
        self.id, self.type, self.name = id, type, name
        self.x, self.y, self.w, self.h = x, y, w, h
        self.children: List[Node] = []
        self.parent = parent
        self.depth = depth
        self.text: Optional[str] = name if type == "text" else None
        self.style: Dict[str, Any] = {}
        self.ntext = 1 if type == "text" else 0     # text layers in this subtree (set by the parser)

    # -- traversal -------------------------------------------------------
    def walk(self) -> Iterable["Node"]:
        stack = [self]
        while stack:
            n = stack.pop()
            yield n
            stack.extend(reversed(n.children))

    def descendants(self) -> Iterable["Node"]:
        it = self.walk()
        next(it)
        return it

    def texts(self) -> List["Node"]:
        """Text layers in reading order (top to bottom, then left to right)."""
        return sorted((n for n in self.walk() if n.type == "text" and (n.text or "").strip()),
                      key=lambda n: (round(n.y / 6), n.x))

    @property
    def lname(self) -> str:
        return (self.name or "").lower()

    @property
    def right(self) -> float:
        return self.x + self.w

    @property
    def bottom(self) -> float:
        return self.y + self.h

    def bbox(self) -> Dict[str, int]:
        return {"x": round(self.x), "y": round(self.y), "w": round(self.w), "h": round(self.h)}


def _num(value: Any) -> float:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    return f if math.isfinite(f) else 0.0


_DOCTYPE_RE = re.compile(r"<!\s*(DOCTYPE|ENTITY)", re.I)
_LAST_CLOSE_RE = re.compile(r"</[A-Za-z][\w.:-]*\s*>")
_XML_DECL_RE = re.compile(r"^\s*<\?xml[^>]*\?>")


def parse_metadata_xml(xml_text: str) -> List[Node]:
    """
    ``get_metadata`` XML → top-level frames (a ``<canvas>`` contributes its
    children). Tolerates prose the Figma MCP appends after the XML and several
    documents pasted one after the other. Refuses DOCTYPE / ENTITY declarations
    (entity expansion) and trees over ``MAX_NODES``.
    """
    text = str(xml_text or "").strip()
    if not text:
        return []
    if _DOCTYPE_RE.search(text):
        raise DesignImportError("bad_xml", "metadata_xml must not contain DOCTYPE or ENTITY declarations.")
    start = text.find("<")
    if start < 0:
        raise DesignImportError("bad_xml", "metadata_xml has no XML elements (send get_metadata's output as is).")
    body = _XML_DECL_RE.sub("", text[start:], count=1)
    root = None
    for candidate in (body, _cut_after_last_close(body)):
        if candidate is None:
            continue
        try:
            root = ET.fromstring(f"<root>{candidate}</root>")
            break
        except ET.ParseError:
            continue
    if root is None:
        raise DesignImportError("bad_xml", "metadata_xml could not be parsed as get_metadata XML.")

    frames: List[Node] = []
    budget = [MAX_NODES]
    for top in root:
        if top.tag == "canvas" or (top.tag in ("document", "page") and len(top)):
            for child in top:
                frames.append(_build(child, None, 0, 0.0, 0.0, budget))
        else:
            frames.append(_build(top, None, 0, 0.0, 0.0, budget))
    return frames


def _cut_after_last_close(body: str) -> Optional[str]:
    last = None
    for last in _LAST_CLOSE_RE.finditer(body):
        pass
    return body[: last.end()] if last else None


def _build(el: ET.Element, parent: Optional[Node], depth: int, ox: float, oy: float, budget: List[int]) -> Node:
    """Iterative-safe build with a depth and node budget. A top-level frame sits at (0, 0)."""
    budget[0] -= 1
    if budget[0] < 0:
        raise DesignImportError("too_many_nodes", f"The layer tree has more than {MAX_NODES} nodes; send fewer frames.")
    a = el.attrib
    if parent is None:
        x, y = 0.0, 0.0
    else:
        x, y = ox + _num(a.get("x")), oy + _num(a.get("y"))
    node = Node(str(a.get("id") or ""), el.tag, str(a.get("name") or ""), x, y,
                _num(a.get("width")), _num(a.get("height")), parent, depth)
    if depth >= MAX_DEPTH:
        return node
    for child in el:
        kid = _build(child, node, depth + 1, x, y, budget)
        node.children.append(kid)
        node.ntext += kid.ntext
    return node


# ──────────────────────────────────────────────────────────────────────────
# Design code (get_design_context: React + Tailwind)
# ──────────────────────────────────────────────────────────────────────────
_ASSET_PREFIX_RE = re.compile(r"""const\s+(\w+)\s*=\s*["'`](https://[^"'`\s]+)["'`]""")
_ASSET_TEMPLATE_RE = re.compile(r"""const\s+(\w+)\s*=\s*`\$\{(\w+)\}/?([^`\s]*)`""")
_TAG_START_RE = re.compile(r"<\s*([A-Za-z][\w.:-]*)")
_CLOSE_TAG_RE = re.compile(r"</\s*([A-Za-z][\w.:-]*)\s*>")
_ATTR_RE = re.compile(r"""([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})""")
_HEX_CLASS_RE = re.compile(r"^(bg|text|border(?:-[trblxy])?|from|via|to|fill|stroke|outline|decoration)-\[(#[0-9a-fA-F]{3,8})\]$")
_NAMED_COLOURS = {"white": "#FFFFFF", "black": "#000000"}
_FONT_CLASS_RE = re.compile(r"""^font-\['([^']+)'""")
_SIZE_CLASS_RE = re.compile(r"^text-\[(\d+(?:\.\d+)?)px\]$")
_RADIUS_CLASS_RE = re.compile(r"^rounded(?:-[a-z]{1,2})?-\[(\d+(?:\.\d+)?)px\]$")
_PX_CLASS_RE = re.compile(r"^px-\[(\d+(?:\.\d+)?)px\]$")
_JSX_EXPR_TEXT_RE = re.compile(r"""\{\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*\}""")
_SELF_CLOSING_HTML = frozenset({"img", "br", "hr", "input", "meta", "link", "source", "path", "circle", "rect", "line"})


class CodeIndex:
    """What the design code says, keyed by Figma node id."""

    def __init__(self) -> None:
        self.styles: Dict[str, Dict[str, Any]] = {}
        self.texts: Dict[str, List[str]] = defaultdict(list)       # node id → text runs inside it
        self.runs: List[Dict[str, Any]] = []                        # every text run with its effective style
        self.sizes: Dict[str, float] = {}                           # node id → font size of its first run
        # Figma reuses const names (imgArtwork, imgArtwork1…) in EVERY frame's code for
        # different files, so an asset's ref is its const name, scoped to its entry
        # ("imgArtwork@73:324") when another entry already used that name for another URL.
        self.assets: Dict[str, str] = {}                            # asset ref → url
        self.asset_nodes: Dict[str, List[str]] = defaultdict(list)  # asset ref → node ids that show it
        self.asset_ref_by_url: Dict[str, str] = {}
        self.bg = Counter()
        self.bg_area: Counter = Counter()
        self.border = Counter()
        self.radii: List[float] = []
        self.side_padding: Counter = Counter()
        self.truncated: List[str] = []                              # labels of truncated code entries
        self.node_ids: set = set()


def _class_style(classes: Sequence[str]) -> Dict[str, Any]:
    st: Dict[str, Any] = {}
    for c in classes:
        m = _HEX_CLASS_RE.match(c)
        if m:
            kind, hex_ = m.group(1), hex6(m.group(2))
            if not hex_:
                continue
            if kind == "bg":
                st["bg"] = hex_
            elif kind == "text":
                st["color"] = hex_
            elif kind.startswith("border"):
                st["border"] = hex_
            continue
        if c in ("bg-white", "bg-black"):
            st["bg"] = _NAMED_COLOURS[c[3:]]
        elif c in ("text-white", "text-black"):
            st["color"] = _NAMED_COLOURS[c[5:]]
        elif c == "border-dashed":
            st["dashed"] = True
        elif c == "rounded-full":
            st["radius"] = 9999.0
        elif (m := _FONT_CLASS_RE.match(c)):
            fam, _, weight = m.group(1).partition(":")
            st["font"] = fam.replace("_", " ").strip()
            if weight:
                st["weight"] = weight.replace("_", " ").strip()
        elif (m := _SIZE_CLASS_RE.match(c)):
            st["size"] = float(m.group(1))
        elif (m := _RADIUS_CLASS_RE.match(c)):
            st["radius"] = float(m.group(1))
        elif (m := _PX_CLASS_RE.match(c)):
            st["px"] = float(m.group(1))
    return st


def _clean_jsx_text(raw: str) -> str:
    s = _JSX_EXPR_TEXT_RE.sub(lambda m: next(g for g in m.groups() if g is not None), raw)
    s = re.sub(r"\{[^{}]*\}", " ", s)       # other expressions carry no copy
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def parse_design_code(entries: Sequence[Dict[str, Any]], index: Optional[CodeIndex] = None) -> CodeIndex:
    """Each entry: {code, node_id?, name?}. Several entries for one frame are read one after the other."""
    idx = index or CodeIndex()
    for entry in entries:
        code = str(entry.get("code") or "")
        if not code.strip():
            continue
        label = str(entry.get("node_id") or entry.get("name") or f"entry {len(idx.truncated) + 1}")
        prefixes = {m.group(1): m.group(2) for m in _ASSET_PREFIX_RE.finditer(code)}
        consts: Dict[str, str] = {}             # THIS entry's const name → url
        for m in _ASSET_TEMPLATE_RE.finditer(code):
            base = prefixes.get(m.group(2))
            if base:
                consts[m.group(1)] = f"{base.rstrip('/')}/{m.group(3)}"
        for name, url in prefixes.items():
            if name.startswith("img"):
                consts.setdefault(name, url)
        local = {name: ref for name, url in consts.items() if (ref := _asset_ref(idx, name, url, label))}
        if _scan_jsx(code, idx, local):
            idx.truncated.append(label)
    return idx


def _asset_ref(idx: CodeIndex, name: str, url: str, label: str) -> Optional[str]:
    """The ref this entry's ``name`` → ``url`` is listed under: one ref per URL (merged
    across entries); the bare name unless another URL already holds it."""
    if url in idx.asset_ref_by_url:
        return idx.asset_ref_by_url[url]
    if len(idx.assets) >= MAX_ASSETS:
        return None
    ref = name if name not in idx.assets else f"{name}@{label}"
    n = 2
    while ref in idx.assets:
        ref, n = f"{name}@{label}#{n}", n + 1
    idx.assets[ref] = url
    idx.asset_ref_by_url[url] = ref
    return ref


def _scan_jsx(code: str, idx: CodeIndex, local_assets: Optional[Dict[str, str]] = None) -> bool:
    """
    Walk the JSX once — every component in the file (Figma emits helper
    components before the page). Returns True when the code ends mid-tree
    (Figma's ~100k-character cut): the file does not end with its closing brace.
    """
    ret = code.find("return (")
    i = code.find("<", ret if ret >= 0 else 0)
    if i < 0:
        return False
    n = len(code)
    stack: List[Dict[str, Any]] = []
    while i < n:
        lt = code.find("<", i)
        chunk = code[i: lt if lt >= 0 else n]
        if stack and chunk.strip():
            _add_text(_clean_jsx_text(chunk), stack, idx)
        if lt < 0:
            break
        close = _CLOSE_TAG_RE.match(code, lt)
        if close:
            name = close.group(1)
            while stack:
                top = stack.pop()
                if top["tag"] == name:
                    break
            i = close.end()
            continue
        start = _TAG_START_RE.match(code, lt)
        if not start:
            i = lt + 1
            continue
        j, depth, quote = start.end(), 0, None
        while j < n:
            c = code[j]
            if quote:
                if c == quote:
                    quote = None
            elif c in "\"'`":
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == ">" and depth <= 0:
                break
            j += 1
        if j >= n:
            return True
        attrs_text = code[start.end(): j]
        tag = start.group(1)
        self_closing = attrs_text.rstrip().endswith("/") or tag.lower() in _SELF_CLOSING_HTML
        rec = _element(tag, attrs_text, stack, idx, local_assets or {})
        if not self_closing:
            stack.append(rec)
        i = j + 1
    return not code.rstrip().endswith(("}", ");", ")"))


def _element(tag: str, attrs_text: str, stack: List[Dict[str, Any]], idx: CodeIndex,
             local_assets: Dict[str, str]) -> Dict[str, Any]:
    attrs: Dict[str, str] = {}
    for m in _ATTR_RE.finditer(attrs_text):
        attrs[m.group(1)] = next(g for g in m.groups()[1:] if g is not None).strip().strip("`\"'")
    classes = attrs.get("className", "").split()
    st = _class_style(classes)
    node_id = attrs.get("data-node-id")
    rec = {"tag": tag, "id": node_id, "style": st}
    if node_id:
        idx.node_ids.add(node_id)
        if st:
            idx.styles.setdefault(node_id, {}).update(st)
    if st.get("bg"):
        idx.bg[st["bg"]] += 1
    if st.get("border"):
        idx.border[st["border"]] += 1
    if "radius" in st:
        idx.radii.append(st["radius"])
    if "px" in st and "w-full" in classes:
        idx.side_padding[st["px"]] += 1
    src = (attrs.get("src") or "").strip()
    ref = local_assets.get(src)                 # resolved against THIS entry's own consts
    if ref:
        owner = node_id or next((r["id"] for r in reversed(stack) if r.get("id")), None)
        if owner:
            idx.asset_nodes[ref].append(owner)
    return rec


def _add_text(text: str, stack: List[Dict[str, Any]], idx: CodeIndex) -> None:
    if not text:
        return
    owner = next((r["id"] for r in reversed(stack) if r.get("id")), None)
    eff: Dict[str, Any] = {}
    for r in stack:                         # CSS-like inheritance, closest wins
        for k in ("font", "weight", "size", "color"):
            if k in r["style"]:
                eff[k] = r["style"][k]
    if owner:
        idx.texts[owner].append(text)
        if eff.get("size"):
            idx.sizes.setdefault(owner, eff["size"])
    idx.runs.append({"text": text, "node": owner, **eff})


def attach_styles(frames: Sequence[Node], code: CodeIndex) -> None:
    """Give each layer its colours / font from the code, and its real text where the code has it."""
    for f in frames:
        for n in f.walk():
            st = code.styles.get(n.id)
            if st:
                n.style = st
            if n.type == "text" and code.texts.get(n.id):
                n.text = " ".join(code.texts[n.id])


# ──────────────────────────────────────────────────────────────────────────
# Colour maths
# ──────────────────────────────────────────────────────────────────────────
def hex6(value: Any) -> Optional[str]:
    """#rgb / #rrggbb / #rrggbbaa → #RRGGBB (alpha dropped); None otherwise."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", v):
        v = "#" + "".join(c * 2 for c in v[1:])
    elif re.fullmatch(r"#[0-9a-fA-F]{8}", v):
        v = v[:7]
    return v.upper() if re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None


def hex_to_lab(hex_: str) -> Tuple[float, float, float]:
    h = hex6(hex_) or "#000000"
    rgb = [int(h[i: i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    x = (lin[0] * 0.4124 + lin[1] * 0.3576 + lin[2] * 0.1805) / 0.95047
    y = lin[0] * 0.2126 + lin[1] * 0.7152 + lin[2] * 0.0722
    z = (lin[0] * 0.0193 + lin[1] * 0.1192 + lin[2] * 0.9505) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def delta_e(a: str, b: str) -> float:
    """CIE76 ΔE between two hex colours."""
    la, lb = hex_to_lab(a), hex_to_lab(b)
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(la, lb)))


def _lightness(hex_: str) -> float:
    return hex_to_lab(hex_)[0]


def _chroma(hex_: str) -> float:
    _, a, b = hex_to_lab(hex_)
    return math.hypot(a, b)


#: Below this Lab chroma a colour reads as a (warm or cool) neutral.
_NEUTRAL_CHROMA = 30.0


# ──────────────────────────────────────────────────────────────────────────
# Tokens
# ──────────────────────────────────────────────────────────────────────────
PALETTE_ROLES = (
    "text", "body", "muted", "muted2", "primary", "gold", "accent", "olive", "cream", "canvas",
    "sand", "border", "borderStrong", "accentOnDark", "bodyOnDark", "outline",
)

#: Words in a Figma variable name → palette role (first match wins, most specific first).
_VARIABLE_ROLE_WORDS: Tuple[Tuple[str, str], ...] = (
    ("borderstrong", "borderStrong"), ("border-strong", "borderStrong"), ("strongborder", "borderStrong"),
    ("accentondark", "accentOnDark"), ("bodyondark", "bodyOnDark"), ("muted2", "muted2"),
    ("outline", "outline"), ("border", "border"), ("stroke", "border"), ("divider", "border"),
    ("primary", "primary"), ("brand", "primary"), ("accent", "accent"), ("gold", "gold"), ("olive", "olive"),
    ("cream", "cream"), ("sand", "sand"), ("canvas", "canvas"), ("background", "canvas"), ("surface", "canvas"),
    ("muted", "muted"), ("body", "body"), ("ink", "text"), ("heading", "text"), ("foreground", "text"), ("text", "text"),
)
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_DEVANAGARI_FONTS = ("devanagari", "mukta", "hind", "tiro")


def parse_variables(raw: Any) -> Dict[str, str]:
    """``get_variable_defs`` output (an object, or its JSON text) → {name: value} strings."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return {}
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in list(raw.items())[:MAX_VARIABLES]:
        if isinstance(k, str) and isinstance(v, (str, int, float)):
            out[k[:120]] = str(v)[:200]
    return out


def _palette_from_variables(variables: Dict[str, str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for name, value in variables.items():
        hex_ = hex6(value)
        if not hex_:
            continue
        key = re.sub(r"[^a-z0-9-]", "", name.lower().replace("/", "-").replace(" ", "-"))
        flat = key.replace("-", "")
        for word, role in _VARIABLE_ROLE_WORDS:
            if word in flat or word in key:
                out.setdefault(role, hex_)
                break
    return out


def _palette_from_usage(code: CodeIndex) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Role → colour from how each colour is USED (text runs, fills, strokes). Returns (palette, why)."""
    text_use: Counter = Counter(r["color"] for r in code.runs if r.get("color"))
    bg_use, border_use = code.bg, code.border
    pal: Dict[str, str] = {}
    why: Dict[str, str] = {}
    taken: set = set()

    def pick(role: str, candidates: Iterable[str], reason: str) -> None:
        for c in candidates:
            if c not in taken:
                pal[role], why[role] = c, reason
                taken.add(c)
                return

    L = {c: _lightness(c) for c in set(text_use) | set(bg_use) | set(border_use)}
    C = {c: _chroma(c) for c in L}
    total_text = sum(text_use.values()) or 1
    frequent_text = [c for c, n in text_use.most_common() if n / total_text >= 0.05]
    neutral_text = sorted((c for c in frequent_text if C[c] < _NEUTRAL_CHROMA and L[c] < 65), key=lambda c: L[c])
    pick("text", neutral_text[:1], "darkest frequent text colour")
    pick("body", neutral_text[1:2], "next darker frequent text colour")
    pick("muted", neutral_text[2:3], "lighter frequent text colour")
    if "muted" in pal:
        pick("muted2", (c for c, _ in text_use.most_common()
                        if C[c] < _NEUTRAL_CHROMA and L[pal["muted"]] < L[c] < 75), "lightest muted text colour")

    def saturated_by(use: Counter) -> List[str]:
        return [c for c, _ in use.most_common() if C[c] >= _NEUTRAL_CHROMA]

    combined = text_use + bg_use
    pick("primary", (c for c in saturated_by(combined) if L[c] < 60), "most used saturated text/button colour")
    pick("gold", (c for c in saturated_by(text_use) if L[c] < 60), "second saturated text colour")
    pick("accent", (c for c in saturated_by(combined + border_use) if 45 <= L[c] <= 75), "mid-tone saturated highlight")
    pick("accentOnDark", (c for c in saturated_by(text_use) if L[c] > 65), "light saturated text (on dark bands)")
    pick("bodyOnDark", (c for c, _ in text_use.most_common() if C[c] < _NEUTRAL_CHROMA and 75 < L[c] < 97),
         "light neutral text (on dark bands)")
    pick("olive", (c for c, _ in bg_use.most_common() if 30 <= L[c] <= 62), "mid-tone fill (secondary buttons, icons)")
    near_white = sorted((c for c in bg_use if L[c] >= 97 and c != "#FFFFFF"), key=lambda c: -L[c])
    pick("canvas", near_white[:1] or (["#FFFFFF"] if "#FFFFFF" in bg_use else []), "lightest page fill")
    pick("cream", (c for c, _ in bg_use.most_common() if 90 <= L[c] < 99.9 and c != "#FFFFFF"), "most used light fill")
    pick("sand", (c for c, _ in bg_use.most_common()
                  if 82 <= L[c] < 96 and bg_use[c] >= border_use.get(c, 0)), "tinted band fill")
    pick("border", (c for c, _ in border_use.most_common() if L[c] >= 80), "most used light stroke")
    if "border" in pal:
        darker = sorted((c for c in border_use if L[pal["border"]] - 12 <= L[c] < L[pal["border"]] - 1),
                        key=lambda c: L[pal["border"]] - L[c])
        pick("borderStrong", darker, "stroke just darker than the border")
    pick("outline", (c for c, _ in border_use.most_common() if 40 <= L[c] < 80), "mid-tone stroke (outlined buttons)")
    return pal, why


def _font_tokens(code: CodeIndex, variables: Dict[str, str]) -> Optional[Dict[str, Any]]:
    families: Counter = Counter()
    weights: Dict[str, set] = defaultdict(set)
    sized: List[Tuple[float, str]] = []
    for r in code.runs:
        fam = r.get("font")
        if not fam:
            continue
        families[fam] += 1
        if r.get("weight"):
            weights[fam].add(r["weight"])
        if r.get("size"):
            sized.append((r["size"], fam))
    if not families:
        for name, value in variables.items():
            m = re.search(r"family:\s*\"?([A-Za-z][\w ]+?)\"?\s*[,)]", value)
            if m:
                families[m.group(1).strip()] += 1
    if not families:
        return None
    latin = [f for f, _ in families.most_common() if not any(w in f.lower() for w in _DEVANAGARI_FONTS)]
    scripts = [f for f, _ in families.most_common() if any(w in f.lower() for w in _DEVANAGARI_FONTS)]
    body = latin[0] if latin else None
    heading = None
    if sized:
        top = sorted(sized, reverse=True)[: max(1, len(sized) // 20)]
        fam = Counter(f for _, f in top).most_common(1)[0][0]
        if fam != body and fam in latin:
            heading = fam
    return {
        "body": body,
        "heading": heading,
        "scripts": {"hi": scripts[0]} if scripts else {},
        "weights": {f: sorted(w) for f, w in weights.items() if f in (body, heading)},
        "families": dict(families.most_common(6)),
    }


def _content_width(frames: Sequence[Node], code: CodeIndex) -> Tuple[Optional[int], str]:
    widths: Counter = Counter()
    for f in frames:
        W = f.w
        if W < 600:
            continue
        for n in f.walk():
            if n is f or n.depth > 4 or n.w < W * 0.5 or n.w > W - 16 or n.x < 8:
                continue
            if abs((n.x + n.w) - (W - n.x)) <= 2:
                widths[round(n.w)] += max(1, round(n.h / 40))   # tall content outweighs a thin bar
        for px, count in code.side_padding.items():
            inner = round(W - 2 * px)
            if W * 0.5 <= inner <= W - 16:
                widths[inner] += count * 4
    if not widths:
        return None, "no centred content column found"
    width, _ = widths.most_common(1)[0]
    return width, f"the most common centred content column (weighted by height) across {len(frames)} frame(s)"


def _radius_token(code: CodeIndex) -> Optional[str]:
    vals = sorted(r for r in code.radii if r < 999)
    if not vals:
        return None
    median = vals[len(vals) // 2]
    return "sharp" if median <= 2 else "rounded"


def extract_tokens(frames: Sequence[Node], code: CodeIndex, variables: Dict[str, str],
                   font_stacks: Dict[str, str]) -> Tuple[Dict[str, Any], List[str]]:
    warnings: List[str] = []
    pal, why = _palette_from_usage(code)
    var_pal = _palette_from_variables(variables)
    for role, hex_ in var_pal.items():
        pal[role], why[role] = hex_, "Figma variable"
    tokens: Dict[str, Any] = {}
    if pal:
        ordered = {k: pal[k] for k in PALETTE_ROLES if k in pal}
        canvas = ordered.get("canvas")
        tokens["palette"] = ordered
        tokens["palette_evidence"] = {k: why[k] for k in ordered}
        tokens["apply_palette_to_tokens"] = bool(canvas and canvas != "#FFFFFF")
        missing = [k for k in PALETTE_ROLES if k not in ordered]
        if missing:
            tokens["palette_missing"] = missing
    else:
        warnings.append("No colours found: send get_design_context code (or get_variable_defs) for the frames — "
                        "get_metadata has boxes and names only.")
    fonts = _font_tokens(code, variables)
    if fonts and fonts.get("body"):
        stack = font_stacks.get(fonts["body"])
        if stack is None:
            for label, s in font_stacks.items():
                if label.lower() == fonts["body"].lower():
                    stack = s
        fonts["stack"] = stack
        if stack is None:
            warnings.append(f"The design's font '{fonts['body']}' is not one the site offers; pick the closest from "
                            "website(action='schema').theme_choices.fonts.")
        tokens["fonts"] = fonts
    elif code.runs or code.styles:
        warnings.append("No font family found in the design code.")
    width, width_why = _content_width(frames, code)
    if width:
        tokens["content_max_width"] = width
        tokens["content_max_width_evidence"] = width_why
    radius = _radius_token(code)
    if radius:
        tokens["border_radius"] = radius
    texts = [n.text or "" for f in frames for n in f.walk() if n.type == "text"]
    deva = sum(1 for t in texts if _DEVANAGARI_RE.search(t))
    if texts and deva / len(texts) >= 0.10:
        tokens["languages"] = ["en", "hi"]
        if fonts and fonts.get("heading"):
            warnings.append("The design is bilingual (Devanagari text found): never set fonts.headingFamily — it drops "
                            "the Devanagari fallback. The heading font is left out of the theme.")
    else:
        tokens["languages"] = ["en"]
    return tokens, warnings


def theme_argument(tokens: Dict[str, Any]) -> Dict[str, Any]:
    """Tokens → the ``theme`` argument of website_edit create_site / set_theme."""
    theme: Dict[str, Any] = {}
    pal = tokens.get("palette") or {}
    if pal:
        theme["palette"] = {**pal, "apply_to_tokens": bool(tokens.get("apply_palette_to_tokens"))}
        if pal.get("primary"):
            theme["primary_color"] = pal["primary"]
    if tokens.get("content_max_width"):
        theme["content_max_width"] = tokens["content_max_width"]
    if tokens.get("border_radius"):
        theme["border_radius"] = tokens["border_radius"]
    fonts = tokens.get("fonts") or {}
    if fonts.get("stack"):
        theme["fonts"] = {"body": fonts["body"]}
        if fonts.get("heading") and "hi" not in (tokens.get("languages") or []):
            theme["fonts"]["heading"] = fonts["heading"]
    return theme


# ──────────────────────────────────────────────────────────────────────────
# Frames and bands
# ──────────────────────────────────────────────────────────────────────────
_NOTES_NAME_RE = re.compile(r"\b(notes?|dev|readme|annotations?|spec|handoff)\b", re.I)
_MENU_NAME_RE = re.compile(r"\b(mega ?menu|menu|dropdown|overlay|modal|popover|drawer)\b", re.I)
_DIM_NAME_RE = re.compile(r"\b(dim|overlay|scrim|backdrop)\b", re.I)


def classify_frame(f: Node) -> str:
    texts = sum(1 for n in f.descendants() if n.type == "text")
    total = sum(1 for _ in f.descendants()) or 1
    if _NOTES_NAME_RE.search(f.name) and texts / total >= 0.6:
        return "notes"
    if f.w and f.w <= 480:
        return "mobile"
    first = f.children[0] if f.children else None
    if _MENU_NAME_RE.search(f.name) or (first is not None and _is_dim(first, f)):
        return "menu"
    if f.w >= 600:
        return "page"
    return "other"


def _is_dim(n: Node, frame: Node) -> bool:
    """A page dim behind an overlay: named so, or a childless shape covering the whole frame."""
    covers = n.w >= frame.w * 0.95 and n.h >= frame.h * 0.95
    return covers and (bool(_DIM_NAME_RE.search(n.name)) or (not n.children and n.type != "text"
                                                            and n.type in ("rectangle", "rounded-rectangle", "vector")))


def bands_of(frame: Node) -> List[Node]:
    """Full-width horizontal bands, top to bottom. Single full-size wrappers are looked through."""
    node = frame
    for _ in range(3):
        kids = [c for c in node.children if c.w > 0 and c.h > 0]
        if len(kids) == 1 and kids[0].w >= frame.w * 0.95 and kids[0].h >= node.h * 0.9:
            node = kids[0]
            continue
        break
    kids = sorted((c for c in node.children if c.w > 0 and c.h > 0), key=lambda c: c.y)
    full = [c for c in kids if c.w >= frame.w * 0.9 and not _is_dim(c, frame)]
    return full or kids


_SPLIT_NAME_RE = re.compile(r"\s+[–—-]\s+|\s*:\s+|\s*\|\s*|\s*/\s*")
_GENERIC_FRAME_RE = re.compile(r"^(desktop|frame|page|screen|artboard|web|landing|untitled)\b", re.I)


def page_route_title(frame: Node, index: int) -> Tuple[str, str]:
    first = _SPLIT_NAME_RE.split(frame.name.strip())[0].strip() if frame.name else ""
    if not first or _GENERIC_FRAME_RE.match(first) or re.fullmatch(r"[\d\s.:-]+", first):
        return ("home", "Home") if index == 0 else (f"page-{index + 1}", f"Page {index + 1}")
    slug = re.sub(r"[^a-z0-9]+", "-", first.lower()).strip("-")[:60] or f"page-{index + 1}"
    return slug, first[:80]


# ──────────────────────────────────────────────────────────────────────────
# Band analysis helpers
# ──────────────────────────────────────────────────────────────────────────
_BREADCRUMB_RE = re.compile(r"^\s*home\s*[/›>»|]", re.I)
_PRICE_RE = re.compile(r"(₹|rs\.?\s?|inr\s?|\$|€|£)\s?\d", re.I)
_FREE_RE = re.compile(r"^\s*free\s*$", re.I)
_COUNT_SUFFIX_RE = re.compile(r"\s*[·•|]\s*\d+\s*$")
_NUMERAL_RE = re.compile(r"^\s*\d[\d,.]*\s*\+?\s*$")
_STEP_NUMBER_RE = re.compile(r"^\s*0?([1-9])\s*$")
_BUTTON_NAME_RE = re.compile(r"\b(button|btn|cta)\b", re.I)
_LANG_TOGGLE_RE = re.compile(r"^\s*(en|eng|english|हिन्दी|हिंदी|हिं|hi|hindi)\s*$", re.I)
_ARROW_RE = re.compile(r"[→›»]\s*$|->\s*$")
_EMAIL_RE = re.compile(r"\be-?mail\b", re.I)
_SUBSCRIBE_RE = re.compile(r"\b(subscribe|sign ?up|join|notify)\b", re.I)
_PHONE_NAME_RE = re.compile(r"\b(phone|mock(?:up)?|device|iphone|android|screen)\b", re.I)
_CHECK_RE = re.compile(r"^\s*[✓✔☑]\s*")
_DOT_NAME_RE = re.compile(r"\b(dots?|carousel|pager|pagination|slider)\b", re.I)
_CONTACT_RE = re.compile(r"\b(talk to us|contact|partner with us|enquir|inquir|get in touch|call ?back|book a call)", re.I)
_NOTIFY_RE = re.compile(r"\bnotify\b", re.I)
_BUNDLE_RE = re.compile(r"\b(add (the )?(whole|full) (path|bundle)|add to cart|bought (individually|together)|"
                        r"buy (the )?(whole|full|all)|bundle|save \d+\s?%)", re.I)
_STANDARD_FILTERS = ("price", "language", "category", "categories", "level", "stream", "streams", "topic", "sort")


def _t(n: Node) -> str:
    return (n.text if n.text is not None else n.name or "").strip()


def _words(s: str) -> int:
    return len(s.split())


def _is_upper_label(s: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", s)
    return len(letters) >= 2 and letters.isupper() and len(s) <= 48


def _strip_count(s: str) -> str:
    return _COUNT_SUFFIX_RE.sub("", s).strip()


def _dark(hex_: Optional[str]) -> Optional[bool]:
    return None if not hex_ else _lightness(hex_) < 35


def _centred(box: Node, text: Node) -> bool:
    """A short text centred in a box with padding on every side (a button drawn without a name or code)."""
    left, right = text.x - box.x, box.right - text.right
    top, bottom = text.y - box.y, box.bottom - text.bottom
    return box.type in ("frame", "instance", "group") and min(left, right) >= 8 and abs(left - right) <= 8 \
        and min(top, bottom) >= 4 and abs(top - bottom) <= 6


def _phone_like(n: Node) -> bool:
    """A drawn phone: named so, or a tall narrow box (about 1:2) whose child fills most of it (the screen)."""
    if n.type == "text":
        return False
    if _PHONE_NAME_RE.search(n.name):
        return True
    if n.w < 40 or n.h < 120 or not (1.5 <= n.h / n.w <= 2.6):
        return False
    return any(c.type != "text" and c.w >= n.w * 0.8 and c.h >= n.h * 0.75 for c in n.children)


def _imageish(n: Node) -> bool:
    return n.type in ("instance", "rounded-rectangle", "rectangle", "ellipse", "vector", "image", "frame", "group") and \
        n.ntext == 0


class Band:
    """One horizontal band of a frame and the facts the detectors read."""

    def __init__(self, node: Node, frame: Node, index: int, count: int, code: CodeIndex):
        self.node, self.frame, self.index, self.count, self.code = node, frame, index, count, code
        self.text_nodes = node.texts()
        self.texts = [_t(n) for n in self.text_nodes]
        self.lower = [t.lower() for t in self.texts]
        self.names = [n.lname for n in node.walk() if n.type != "text"]
        self._rows: Dict[Tuple[int, int], List[List[Node]]] = {}

    # -- simple facts ----------------------------------------------------
    def has(self, pattern: re.Pattern) -> bool:
        return any(pattern.search(t) for t in self.texts)

    def matching(self, pattern: re.Pattern) -> List[Node]:
        return [n for n, t in zip(self.text_nodes, self.texts) if pattern.search(t)]

    def name_has(self, pattern: re.Pattern) -> bool:
        return any(pattern.search(n) for n in self.names)

    def bg(self) -> Optional[str]:
        for n in [self.node] + self.node.children[:1]:
            if n.style.get("bg"):
                return n.style["bg"]
        return None

    def is_dark(self) -> Optional[bool]:
        d = _dark(self.bg())
        if d is None and self.name_has(re.compile(r"on dark|dark")):
            return True
        return d

    def buttons(self, within: Optional[Node] = None) -> List[Tuple[Node, str]]:
        """(node, label) of button-like layers: named like a button, or a small box holding one short text."""
        root = within or self.node
        out: List[Tuple[Node, str]] = []
        seen: set = set()
        for n in root.walk():
            if n.type == "text" or id(n) in seen or not 1 <= n.ntext <= 2:
                continue
            texts = [t for t in n.walk() if t.type == "text" and _t(t)]
            named = bool(_BUTTON_NAME_RE.search(n.name)) and n.h <= 72 and n.w <= 480 and len(texts) <= 2
            boxy = (len(texts) == 1 and 24 <= n.h <= 64 and n.w <= 420 and _words(_t(texts[0])) <= 5
                    and n.type != "text" and (n.style.get("bg") or n.style.get("border") or _centred(n, texts[0])))
            if (named and texts) or boxy:
                label = " ".join(_t(t) for t in texts[:2])
                out.append((n, label))
                seen.update(id(x) for x in n.walk())
        return out

    def heading(self, within: Optional[Node] = None) -> Optional[Node]:
        """The most prominent text: the largest font size (code) or the tallest single-line text box."""
        cands = [n for n in (within or self.node).texts() if _words(_t(n)) >= 1 and not _NUMERAL_RE.match(_t(n))]
        if not cands:
            return None

        def score(n: Node) -> float:
            size = n.style.get("size") or self._run_size(n)
            if size:
                return size
            # No code for this layer: a tall box of many words is a wrapped paragraph, not a heading.
            return 16.0 if _words(_t(n)) > 12 else min(n.h, 80) * 0.75
        return max(cands, key=score)

    def _run_size(self, n: Node) -> Optional[float]:
        return self.code.sizes.get(n.id)

    def rows(self, min_count: int = 3, within: Optional[Node] = None) -> List[List[Node]]:
        """Groups of >= min_count siblings in one row with near-equal size (tabs, chips, cards)."""
        root = within or self.node
        key = (min_count, id(root))
        if key in self._rows:
            return self._rows[key]
        out: List[List[Node]] = []
        self._rows[key] = out
        for n in root.walk():
            kids = [c for c in n.children if c.type != "text" and c.w > 0]
            if len(kids) < min_count:
                continue
            by_row: Dict[int, List[Node]] = defaultdict(list)
            for c in kids:
                by_row[round(c.y / 8)].append(c)
            for row in by_row.values():
                if len(row) < min_count:
                    continue
                hs = sorted(c.h for c in row)
                if hs[-1] - hs[0] <= max(6, hs[0] * 0.15):
                    out.append(sorted(row, key=lambda c: c.x))
        return out

    def near(self, levels: int = 6) -> Iterable[Node]:
        """Descendants at most ``levels`` below the band (candidate containers; keeps scans linear)."""
        limit = self.node.depth + levels
        stack = list(reversed(self.node.children))
        while stack:
            n = stack.pop()
            yield n
            if n.depth < limit:
                stack.extend(reversed(n.children))

    def repeated(self, min_count: int = 3) -> List[List[Node]]:
        """Layers repeated by name (component instances such as 'Course Card' ×12)."""
        groups: Dict[str, List[Node]] = defaultdict(list)
        for n in self.node.descendants():
            if n.type in ("instance", "frame") and n.name and not re.fullmatch(r"(frame|group|rectangle|vector)( \d+)?", n.lname):
                groups[n.lname].append(n)
        return [g for g in groups.values() if len(g) >= min_count]

    def code_texts_in(self, node: Node) -> List[str]:
        """Texts the design code shows inside a layer — incl. instance children the metadata leaves out."""
        out = list(self.code.texts.get(node.id, []))
        prefix = f"I{node.id};"
        for nid, runs in self.code.texts.items():
            if nid.startswith(prefix):
                out.extend(runs)
        return out


def _chip_rows(band: Band, within: Optional[Node] = None, min_count: int = 3) -> List[List[Node]]:
    rows = []
    for row in band.rows(min_count, within):
        if all(c.h <= 48 and c.ntext == 1 for c in row):
            rows.append(row)
    return rows


def _chip_label(chip: Node) -> str:
    t = next((t for t in chip.walk() if t.type == "text"), None)
    return _t(t) if t else ""


def _stepper(band: Band, within: Optional[Node] = None) -> Optional[List[Node]]:
    """A row of >= 3 step items, each with a step number, and a price / 'Free' on most."""
    root = within or band.node
    best: Optional[List[Node]] = None
    for row in band.rows(3, root):
        numbered = 0
        priced = 0
        for c in row:
            ts = [_t(t) for t in c.walk() if t.type == "text"]
            if any(_STEP_NUMBER_RE.match(t) for t in ts):
                numbered += 1
            if any(_PRICE_RE.search(t) or _FREE_RE.match(t) for t in ts):
                priced += 1
        if numbered >= 3 and numbered >= len(row) - 1 and priced >= len(row) // 2:
            if best is None or len(row) > len(best):
                best = row
    return best


# ──────────────────────────────────────────────────────────────────────────
# Detectors: one per registry pattern (its figmaCues, in code)
# Each returns (confidence 0..1, evidence[], facts{}) for one band.
# ──────────────────────────────────────────────────────────────────────────
Detection = Tuple[float, List[str], Dict[str, Any]]
_NONE: Detection = (0.0, [], {})


def _det_header(b: Band) -> Detection:
    if b.index != 0 or b.node.h > 140:
        return _NONE
    ev: List[str] = []
    nav = [n for n in b.text_nodes if _words(_t(n)) <= 3 and n.h <= 26]
    rows: Dict[int, int] = Counter(round(n.y / 8) for n in nav)
    if not rows or rows.most_common(1)[0][1] < 3:
        return _NONE
    conf = 0.55
    ev.append("a thin top bar with a row of short nav texts")
    if b.node.h <= 80:
        conf += 0.1
        ev.append(f"bar {round(b.node.h)}px tall")
    if sum(1 for t in b.texts if _LANG_TOGGLE_RE.match(t)) >= 2:
        conf += 0.15
        ev.append("a two-part language toggle")
    logo = next((n for n in b.node.descendants() if _imageish(n) and 24 <= n.w <= 72 and abs(n.w - n.h) <= 8
                 and n.x < b.frame.w * 0.25), None)
    if logo is not None:
        conf += 0.1
        ev.append("a logo mark on the left")
    if re.search(r"header|nav", b.node.lname):
        conf += 0.05
    return min(conf, 0.95), ev, {"logo": logo}


def _det_footer(b: Band) -> Detection:
    if b.index != b.count - 1 and not re.search(r"footer", b.node.lname):
        return _NONE
    columns = 0
    for n in b.node.descendants():
        ts = [c for c in n.children if c.type == "text" or (len(c.children) == 1 and c.children[0].type == "text")]
        if len(ts) >= 3 and len({round(c.x) for c in ts}) <= 2:
            columns += 1
    lists = [n for n in b.node.descendants() if re.search(r"\b(list|column|links?|group)\b", n.lname)]
    if columns < 3 and len(lists) < 3:
        return _NONE
    conf, ev = 0.6, [f"{max(columns, len(lists))} link columns at the bottom of the frame"]
    if re.search(r"footer", b.node.lname):
        conf += 0.15
    if b.has(_EMAIL_RE):
        conf += 0.1
        ev.append("an email field")
    big = b.heading()
    if big is not None:
        conf += 0.05
        ev.append(f"a large wordmark '{_t(big)[:40]}'")
    return min(conf, 0.95), ev, {}


def _det_footer_newsletter(b: Band) -> Detection:
    if _det_footer(b)[0] < MATCH_THRESHOLD:
        return _NONE
    if b.has(_EMAIL_RE) and (b.has(_SUBSCRIBE_RE) or any(_SUBSCRIBE_RE.search(lbl) for _, lbl in b.buttons())):
        return 0.85, ["an email input with a subscribe button inside the footer"], {}
    return _NONE


def _det_catalog_hero(b: Band) -> Detection:
    if b.index > 3:
        return _NONE
    cues: List[str] = []
    if b.has(_BREADCRUMB_RE):
        cues.append("breadcrumb 'Home / …'")
    search = [n for n in b.text_nodes if re.search(r"\bsearch\b", _t(n), re.I) and _words(_t(n)) >= 3]
    wide_box = any(n.w >= b.frame.w * 0.4 and 40 <= n.h <= 80 and re.search(r"search|input|field", n.lname)
                   for n in b.node.descendants())
    if search or wide_box:
        cues.append("a wide search box")
    stats = [n for n in b.text_nodes if _NUMERAL_RE.match(_t(n)) and n.h >= 20]
    if len(stats) >= 2:
        cues.append(f"{len(stats)} large numerals with captions")
    popular = [n for n in b.text_nodes if re.match(r"^\s*(popular|trending|top searches)\b.*:\s*$", _t(n), re.I)]
    if popular:
        cues.append("a 'Popular:' label with chips")
    if not (search or wide_box or len(stats) >= 2) or len(cues) < 2:
        return _NONE
    return min(0.35 + 0.17 * len(cues), 0.95), cues, {"stats": stats, "popular": popular}


def _det_results_header(b: Band) -> Detection:
    showing = b.matching(re.compile(r"^\s*showing\s+\d+\s+(courses|results|items)?\s*$", re.I))
    sort = b.matching(re.compile(r"^\s*(sort|sorted by)\b", re.I)) or [n for n in b.node.descendants()
                                                                       if re.search(r"\bsort\b", n.lname)]
    if showing:
        return (0.85 if sort else 0.7), ["'Showing N courses' above the results"] + (["a Sort control"] if sort else []), {}
    return _NONE


def _det_quick_filters(b: Band) -> Detection:
    for n in b.text_nodes:
        t = _t(n)
        if t.endswith(":") and _words(t) <= 3 and not re.match(r"^\s*(popular|trending)", t, re.I):
            parent = n.parent
            if parent is None:
                continue
            chips = [c for c in parent.children if c is not n and c.type != "text" and c.h <= 44
                     and abs(c.y - n.y) <= 12 and len([x for x in c.walk() if x.type == "text"]) == 1]
            if len(chips) >= 3:
                labels = [_chip_label(c) for c in chips]
                return 0.85, [f"'{t}' followed by {len(chips)} chips"], {"label": t, "chips": labels}
    return _NONE


def _det_streams_icons(b: Band) -> Detection:
    for row in b.rows(4):
        if len(row) > 10:
            continue
        ws = [c.w for c in row]
        if max(ws) - min(ws) > max(6, min(ws) * 0.1):
            continue
        ok = 0
        for c in row:
            icon = any(_imageish(x) and 28 <= x.w <= 128 and abs(x.w - x.h) <= 10 for x in c.descendants())
            texts = [x for x in c.walk() if x.type == "text"]
            if icon and len(texts) >= 2:
                ok += 1
        if ok >= len(row) - 1 and ok >= 4:
            ev = [f"{len(row)} equal tabs, each a round icon over two text lines"]
            conf = 0.75
            labels = [[_t(x) for x in c.texts()] for c in row]
            if sum(1 for ls in labels if any(_COUNT_SUFFIX_RE.search(t) for t in ls)) >= len(row) - 1:
                conf += 0.15
                ev.append("each tab ends with a '· N' count")
            return conf, ev, {"tabs": labels}
    return _NONE


def _det_streams_pills(b: Band) -> Detection:
    if b.node.h > 140 or b.has(re.compile(r"\?\s*$")):
        return _NONE
    rows = _chip_rows(b, min_count=3)
    if rows and sum(len(r) for r in rows) <= 12 and len(b.texts) <= len(rows[0]) + 2:
        return 0.6, [f"a row of {len(rows[0])} pill tabs"], {"labels": [_chip_label(c) for c in rows[0]]}
    return _NONE


def _sidebar(b: Band) -> Optional[Node]:
    """The filter column: the smallest left-hand column (180–360 px) holding >= 2 uppercase group labels."""
    W = b.frame.w
    best: Optional[Node] = None
    for n in b.near():
        if n.type == "text" or not (180 <= n.w <= 360) or n.h < 280 or n.x > W * 0.45 or n.ntext < 2:
            continue
        labels = [t for t in n.texts() if _is_upper_label(_t(t)) and _words(_t(t)) <= 4]
        if len(labels) >= 2 or any(re.fullmatch(r"\s*filters?\s*", _t(t), re.I) for t in n.texts()):
            if best is None or n.w * n.h < best.w * best.h:
                best = n
    return best


def _filter_groups(col: Node) -> List[Dict[str, Any]]:
    """[{label, options[]}] — an uppercase label and the rows under it (counts stripped)."""
    groups: List[Dict[str, Any]] = []
    texts = col.texts()
    current: Optional[Dict[str, Any]] = None
    for t in texts:
        s = _t(t)
        if _is_upper_label(s) and _words(s) <= 4:
            current = {"label": re.split(r"\s*[·|]\s*", s)[0].strip(), "options": []}
            groups.append(current)
        elif current is not None and s not in ("−", "-", "+") and not _NUMERAL_RE.match(s) \
                and not re.match(r"^\s*\+\s*show", s, re.I) and _words(s) <= 8:
            current["options"].append(_strip_count(s))
    return groups


def _det_filter_sidebar(b: Band) -> Detection:
    col = _sidebar(b)
    if col is None:
        return _NONE
    groups = _filter_groups(col)
    conf, ev = 0.6, [f"a {round(col.w)}px left column of filter groups"]
    if len(groups) >= 3:
        conf += 0.15
        ev.append("groups: " + ", ".join(g["label"] for g in groups[:6]))
    if any(re.search(r"clear all|reset", _t(t), re.I) for t in col.texts()):
        conf += 0.1
        ev.append("'Clear all'")
    if any(re.match(r"^\s*\+\s*show", _t(t), re.I) for t in col.texts()):
        conf += 0.05
        ev.append("'+ Show all' links")
    return min(conf, 0.95), ev, {"groups": groups, "column": col}


def _det_sidebar_promo(b: Band) -> Detection:
    col = _sidebar(b)
    if col is None or col.parent is None:
        return _NONE
    inside = {id(x) for x in col.walk()}
    for n in col.parent.descendants():
        if n.type == "text" or id(n) in inside or abs(n.x - col.x) > 40 or n.w > col.w + 40 \
                or n.y < col.bottom - 4 or n.h < 120:
            continue
        phone = any(_phone_like(x) for x in n.walk())
        dark = _dark(n.style.get("bg"))
        has_button = bool(b.buttons(n))
        if (phone or dark) and has_button:
            texts = [_t(t) for t in n.texts()]
            return (0.85 if phone else 0.7), ["a card below the filters with " + ("a phone mock-up" if phone else
                                                                                    "a dark fill") + " and a button"], \
                {"node": n, "texts": texts}
    return _NONE


def _det_custom_filters(b: Band) -> Detection:
    col = _sidebar(b)
    if col is None:
        return _NONE
    groups = _filter_groups(col)
    extra = [g for g in groups if g["label"].lower() not in _STANDARD_FILTERS]
    if extra:
        return 0.8, ["filter groups beyond price / language / category: " + ", ".join(g["label"] for g in extra)], \
            {"groups": extra}
    return _NONE


_PATH_NAME_RE = re.compile(r"\b(path|program|programme|track|journey)s?\b", re.I)


def _cards(b: Band) -> List[Node]:
    """Course cards: repeated card layers (not learning-path cards), else a row of >= 3 big equal boxes."""
    groups = [g for g in b.repeated(3) if re.search(r"card|course|tile|item", g[0].lname)
              and not _PATH_NAME_RE.search(g[0].lname)]
    if groups:
        return max(groups, key=len)
    # Unnamed layers: the largest family of same-width big boxes laid out in rows of >= 3.
    clusters: Dict[int, List[Node]] = defaultdict(list)
    for row in b.rows(3):
        if all(c.w >= 180 and c.h >= 200 for c in row):
            for c in row:
                clusters[round(c.w / 8)].append(c)
    best = max(clusters.values(), key=len, default=[])
    return best if len(best) >= 3 else []


def _det_cards_editorial(b: Band) -> Detection:
    cards = _cards(b)
    if len(cards) < 3:
        return _NONE
    inner: List[str] = []
    for c in cards[:12]:
        inner.extend(b.code_texts_in(c) or [_t(t) for t in c.texts()])
    if not inner:
        return 0.45, [f"{len(cards)} repeated cards (their insides are not in the design code)"], {"cards": cards}
    arrow_links = [t for t in inner if _ARROW_RE.search(t) and _words(t) <= 4]
    buttons = [t for t in inner if re.match(r"^\s*(enrol|enroll|buy|add to cart|register)\b", t, re.I)]
    if arrow_links and not buttons:
        return 0.85, [f"{len(cards)} cards with a text link ending in an arrow and no button"], \
            {"cards": cards, "link": arrow_links[0]}
    return 0.45, [f"{len(cards)} cards with buttons (default card style)"], {"cards": cards}


def _det_load_more(b: Band) -> Detection:
    more = b.matching(re.compile(r"^\s*(load|show|view) more\b", re.I)) or [
        n for n, lbl in b.buttons() if re.search(r"\bload more\b", lbl, re.I)]
    of = b.matching(re.compile(r"^\s*showing\s+\d+\s+of\s+\d+", re.I))
    if more or of:
        return (0.9 if more and of else 0.75), (["a 'Load more' button"] if more else []) + \
            (["'Showing N of M'"] if of else []), {}
    for _, lbl in b.buttons():
        if re.search(r"load more", lbl, re.I):
            return 0.8, ["a 'Load more' button"], {}
    return _NONE


def _det_language_versions(b: Band) -> Detection:
    col = _sidebar(b)
    langs: List[str] = []
    if col is not None:
        for g in _filter_groups(col):
            if re.search(r"language|भाषा", g["label"], re.I):
                langs = g["options"]
    cards = _cards(b)
    chips = []
    for c in cards[:6]:
        chips.extend(t for t in b.code_texts_in(c) if _LANG_TOGGLE_RE.match(t))
    if len(langs) >= 2 or len(set(x.lower() for x in chips)) >= 2:
        ev = []
        if langs:
            ev.append("a LANGUAGE filter group: " + ", ".join(langs[:4]))
        if chips:
            ev.append("language chips on the cards")
        return (0.8 if langs and chips else 0.7), ev, {"languages": langs or sorted(set(chips))}
    return _NONE


def _block(b: Band, title_re: re.Pattern, min_cards: int = 2) -> Optional[Node]:
    for n in b.near():
        if n.type == "text" or n.ntext < 2 or n.h < 150 or n.w >= b.frame.w * 0.9:
            continue
        head = next(iter(n.texts()), None)
        if head is None or not title_re.search(_t(head)):
            continue
        if head.y - n.y > 80:
            continue
        repeated = [c for c in n.descendants() if c.type in ("instance", "frame") and c.w >= 150 and c.h >= 150]
        if len(repeated) >= min_cards and n.w < b.frame.w * 0.9:
            return n
    return None


def _det_free_courses(b: Band) -> Detection:
    blk = _block(b, re.compile(r"\bfree\b", re.I))
    if blk is None:
        return _NONE
    texts = [_t(t) for t in blk.texts()]
    see_all = any(re.search(r"see all|view all", t, re.I) for t in texts)
    return (0.85 if see_all else 0.65), ["a 'start free' block of course cards inside the results column"] + \
        (["a 'See all … free' link"] if see_all else []), {"title": texts[0] if texts else ""}


def _det_spotlight(b: Band) -> Detection:
    if not _cards(b) and _sidebar(b) is None:
        return _NONE              # a stepper outside a catalogue is a learning path
    panels: List[Dict[str, Any]] = []
    taken: set = set()
    for n in b.near():
        if n.type == "text" or n.w < 400 or n.w > b.frame.w * 0.8 or id(n) in taken or n.ntext < 6:
            continue
        steps = _stepper(b, n)
        if not steps or len(_cards(Band(n, b.frame, 1, 3, b.code))) >= 3:
            continue
        taken.update(id(x) for x in n.walk())
        panels.append({"panel": n, "steps": steps, "dots": any(_DOT_NAME_RE.search(x.name) for x in n.descendants()),
                       "buttons": [lbl for _, lbl in b.buttons(n)]})
    if not panels:
        return _NONE
    dots = any(p["dots"] for p in panels)
    ev = [f"{len(panels)} tinted panel(s) with numbered, priced steps inside the results column"]
    if dots:
        ev.append("carousel dots")
    return (0.85 if dots or len(panels) > 1 else 0.7), ev, {"panels": panels, "panel": panels[0]["panel"]}


def _det_coming_soon(b: Band) -> Detection:
    notify = b.matching(_NOTIFY_RE)
    soon = b.matching(re.compile(r"coming soon|launching soon|opening soon", re.I))
    cards = [n for n in b.node.descendants() if re.search(r"coming soon|soon", n.lname) and n.type != "text"]
    dashed = [n for n in b.node.descendants() if n.style.get("dashed")]
    code_notify = any(_NOTIFY_RE.search(t) for c in cards for t in b.code_texts_in(c))
    if (soon or cards) and (len(notify) >= 2 or len(cards) >= 2 or code_notify):
        ev = ["a 'Coming soon' row of cards" + (" with 'Notify me'" if notify or code_notify else "")]
        if dashed:
            ev.append("dashed borders")
        return (0.9 if notify or code_notify else 0.7), ev, {"cards": len(cards) or len(notify)}
    return _NONE


def _det_hero_editorial(b: Band) -> Detection:
    if b.index > 2:
        return _NONE
    if _det_catalog_hero(b)[0] >= MATCH_THRESHOLD:
        return _NONE
    head = b.heading()
    if head is None:
        return _NONE
    cues: List[str] = []
    if b.has(_BREADCRUMB_RE):
        cues.append("breadcrumb")
    above = [n for n in b.text_nodes if _is_upper_label(_t(n)) and n.y < head.y and _words(_t(n)) <= 6
             and abs(n.x - head.x) <= 48]
    eyebrow = max(above, key=lambda n: n.y) if above else None
    if eyebrow is not None:
        cues.append(f"uppercase eyebrow '{_t(eyebrow)[:30]}'")
        rule = any(n.type != "text" and 12 <= n.w <= 64 and n.h <= 4 and abs(n.y - eyebrow.y) <= 16
                   for n in b.node.descendants())
        if rule:
            cues.append("a short rule before the eyebrow")
    short = [n for n in b.text_nodes if n.y > head.y and 1 <= _words(_t(n)) <= 7 and not _is_upper_label(_t(n))
             and n.x < b.frame.w * 0.5]
    checks = [n for n in short if _CHECK_RE.match(_t(n))] or (short if len(short) >= 3 else [])
    if len(checks) >= 2:
        cues.append(f"{len(checks)} short benefit lines")
    media = next((n for n in b.node.descendants() if n.type != "text" and n.x >= b.frame.w * 0.45
                  and n.w >= 240 and n.h >= 180), None)
    if media is not None:
        cues.append("an illustration on the right")
    btns = b.buttons()
    if btns:
        cues.append(f"{len(btns)} button(s)")
    if len(cues) < 3 or not btns:
        return _NONE
    return min(0.35 + 0.12 * len(cues), 0.95), cues, {"eyebrow": eyebrow, "heading": head, "media": media}


def _goal_chips(b: Band) -> Optional[Tuple[Node, List[Node]]]:
    q = next((n for n in b.text_nodes if _t(n).endswith("?")), None)
    if q is None:
        return None
    for row in _chip_rows(b, min_count=3):
        if row[0].y >= q.y - 4:
            return q, row
    return None


def _det_lp_featured(b: Band) -> Detection:
    if _cards(b) and _sidebar(b) is not None:
        return _NONE
    steps = _stepper(b)
    goals = _goal_chips(b)
    if steps:
        prices = [t for t in b.texts if _PRICE_RE.search(t)]
        ev = [f"a wide card with a {len(steps)}-step numbered stepper"]
        conf = 0.75
        if len(prices) > len(steps):
            conf += 0.1
            ev.append("a path total")
        if goals:
            ev.append("goal chips above it")
        return conf, ev, {"steps": steps, "goals": goals}
    if goals and b.node.h <= 200:
        return 0.6, [f"a question heading over {len(goals[1])} goal chips"], {"goals": goals, "goals_only": True}
    return _NONE


def _det_lp_more_grid(b: Band) -> Detection:
    if _sidebar(b) is not None or _stepper(b):
        return _NONE
    head = b.heading()
    big = lambda c: c.w >= b.frame.w * 0.25 and c.h >= 160  # noqa: E731
    groups = [g for g in b.repeated(2) if _PATH_NAME_RE.search(g[0].lname) and all(big(c) for c in g)]
    cards = max(groups, key=len) if groups else []
    if not cards:
        for row in b.rows(2):
            ws, hs = [c.w for c in row], [c.h for c in row]
            if len(row) == 2 and all(big(c) for c in row) and max(ws) - min(ws) <= min(ws) * 0.1 \
                    and max(hs) - min(hs) <= min(hs) * 0.1:
                cards = [c for r in b.rows(2) if len(r) == 2 and all(big(x) for x in r)
                         and abs(r[0].w - row[0].w) <= 8 and r[1].x >= r[0].right - 4 for c in r]
                break
    if len(cards) < 2:
        return _NONE
    pathy = bool(groups) or (head is not None and re.search(r"\bpaths?\b|programs?|tracks?", _t(head), re.I))
    if not pathy:
        return _NONE
    cols = len({round(c.x / 20) for c in cards})
    if cols < 2:
        return _NONE
    return (0.8 if cols == 2 else 0.65), [f"{len(cards)} path cards in {cols} columns under a heading"], \
        {"cards": len(cards)}


def _det_lp_path_extras(b: Band) -> Detection:
    if _det_lp_featured(b)[0] < 0.7:
        return _NONE
    two_langs = b.has(re.compile(r"(english|\ben\b)\s*(&|and|·|/)\s*(hindi|हिन्दी|हिंदी|हिं)", re.I))
    soon = b.has(re.compile(r"coming soon", re.I))
    if two_langs or soon:
        return 0.65, (["the path lists two language versions together"] if two_langs else []) + \
            (["a 'Coming soon' step"] if soon else []), {}
    return _NONE


def _cta_like(b: Band) -> Optional[Dict[str, Any]]:
    if b.index == 0 or b.index == b.count - 1 or not (100 <= b.node.h <= 420):
        return None
    if len(b.texts) > 8 or len(_cards(b)) >= 3 or _stepper(b) or _chip_rows(b, min_count=3):
        return None
    btns = b.buttons()
    if not btns or len(btns) > 3:
        return None
    head = b.heading()
    if head is None:
        return None
    return {"buttons": btns, "heading": head}


def _det_cta_band(b: Band) -> Detection:
    base = _cta_like(b)
    if base is None:
        return _NONE
    if any(_phone_like(n) for n in b.node.descendants()):
        return _NONE
    dark = b.is_dark()
    eyebrow = any(_is_upper_label(t) for t in b.texts)
    if dark is False and eyebrow:
        return _NONE                  # a light band with an eyebrow is cta.band.light
    conf = 0.6 + (0.25 if dark else 0.0)
    return conf, [f"a {round(b.node.h)}px band with a heading and {len(base['buttons'])} button(s)"] + \
        (["dark fill"] if dark else []), base


def _det_cta_band_light(b: Band) -> Detection:
    base = _cta_like(b)
    if base is None or any(_phone_like(n) for n in b.node.descendants()):
        return _NONE
    dark = b.is_dark()
    eyebrow = next((t for t in b.texts if _is_upper_label(t)), None)
    if dark or not eyebrow:
        return _NONE
    conf = 0.7 + (0.1 if dark is False else 0.0) + (0.05 if len(base["buttons"]) >= 2 else 0.0)
    return conf, [f"a light band with eyebrow '{eyebrow[:30]}' and {len(base['buttons'])} button(s)"], base


def _det_cta_band_app(b: Band) -> Detection:
    if b.index == 0 or b.index == b.count - 1 or b.node.h > 520:
        return _NONE
    phone = next((n for n in b.node.descendants() if _phone_like(n)), None)
    if phone is None:
        return _NONE
    btns = b.buttons()
    if not btns or len(_cards(b)) >= 3:
        return _NONE
    return 0.85, ["a band with a phone mock-up and a button"], {"buttons": btns, "heading": b.heading()}


def _det_steps_cards(b: Band) -> Detection:
    for row in b.rows(3):
        if len(row) > 5 or any(c.w < 160 for c in row):
            continue
        numbered = 0
        for c in row:
            ts = [_t(t) for t in c.texts()]
            if ts and any(_STEP_NUMBER_RE.match(t) for t in ts[:2]) and len(ts) >= 2:
                numbered += 1
        if numbered == len(row) and not any(_PRICE_RE.search(t) for c in row for t in (_t(x) for x in c.texts())):
            return 0.85, [f"{len(row)} equal cards, each with a number, a title and a line"], {"cards": row}
    return _NONE


#: pattern id → detector. A drift test checks these ids exist in the registry.
BAND_DETECTORS: Dict[str, Callable[[Band], Detection]] = {
    "header.editorial": _det_header,
    "footer.brand": _det_footer,
    "footer.newsletter": _det_footer_newsletter,
    "catalog.hero": _det_catalog_hero,
    "catalog.resultsHeader": _det_results_header,
    "catalog.quickFilters": _det_quick_filters,
    "catalog.streams.icons": _det_streams_icons,
    "catalog.streams.pills": _det_streams_pills,
    "catalog.filterSidebar.editorial": _det_filter_sidebar,
    "catalog.filterSidebar.promo": _det_sidebar_promo,
    "catalog.customFilters": _det_custom_filters,
    "catalog.cards.editorial": _det_cards_editorial,
    "catalog.pagination.loadMore": _det_load_more,
    "catalog.languageVersions": _det_language_versions,
    "catalog.sections.freeCourses": _det_free_courses,
    "catalog.sections.spotlight": _det_spotlight,
    "catalog.sections.comingSoon": _det_coming_soon,
    "hero.editorial": _det_hero_editorial,
    "learningPath.featured": _det_lp_featured,
    "learningPath.moreGrid": _det_lp_more_grid,
    "learningPath.pathExtras": _det_lp_path_extras,
    "cta.band": _det_cta_band,
    "cta.band.light": _det_cta_band_light,
    "cta.band.app": _det_cta_band_app,
    "steps.cards": _det_steps_cards,
}
#: Patterns that come from a whole frame (a menu frame), not a band.
FRAME_PATTERNS = ("header.megaMenu",)
#: Site-wide patterns the tokens / data detection decide.
SITE_PATTERNS = ("global.palette", "global.contentMaxWidth", "global.fonts", "global.courseFormats",
                 "global.courseLanguages", "global.i18n", "global.naming", "global.siteCart")
#: Within one band only the best of these is kept (they are variants of one block).
_EXCLUSIVE = (("cta.band", "cta.band.light", "cta.band.app"), ("catalog.streams.icons", "catalog.streams.pills"))


# ──────────────────────────────────────────────────────────────────────────
# Matching
# ──────────────────────────────────────────────────────────────────────────
def match_band(b: Band, registry: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    found: List[Dict[str, Any]] = []
    for pid, det in BAND_DETECTORS.items():
        if pid not in registry:
            continue
        try:
            conf, ev, facts = det(b)
        except (RecursionError, ValueError, ZeroDivisionError):
            continue
        if conf >= MATCH_THRESHOLD:
            found.append({"id": pid, "confidence": round(conf, 2), "evidence": ev, "_facts": facts})
    for group in _EXCLUSIVE:
        hits = [f for f in found if f["id"] in group]
        if len(hits) > 1:
            keep = max(hits, key=lambda f: (f["confidence"], -group.index(f["id"])))
            found = [f for f in found if f["id"] not in group or f is keep]
    # Chrome wins its band outright.
    for chrome in ("header.editorial", "footer.brand"):
        if any(f["id"] == chrome for f in found):
            comp = registry[chrome]["component"]
            found = [f for f in found if registry[f["id"]]["component"] == comp]
    return sorted(found, key=lambda f: -f["confidence"])


def _band_component(matches: List[Dict[str, Any]], registry: Dict[str, Dict[str, Any]]) -> Optional[str]:
    score: Counter = Counter()
    for m in matches:
        score[registry[m["id"]]["component"]] += m["confidence"]
    return score.most_common(1)[0][0] if score else None


def _menu_frame_patterns(frame: Node, code: CodeIndex, registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """A mega-menu frame: the panel's tiles and category list → header.megaMenu."""
    out: Dict[str, Any] = {"patterns": [], "facts": {}}
    bands = bands_of(frame)
    panel = max((n for n in bands if any(x.type == "text" for x in n.walk())), key=lambda n: n.h, default=None)
    if panel is None or "header.megaMenu" not in registry:
        return out
    pb = Band(panel, frame, 1, 3, code)
    tiles = []
    for row in pb.rows(4):
        if all(any(_imageish(x) and x.w >= 40 for x in c.descendants()) for c in row):
            tiles = row
            break
    conf, ev = 0.0, []
    if tiles:
        conf = 0.6
        ev.append(f"a panel of {len(tiles)} image tiles with captions")
    if _MENU_NAME_RE.search(frame.name) or re.search(r"mega", panel.lname):
        conf += 0.25
        ev.append(f"frame named '{frame.name[:40]}'")
    if any(_is_dim(c, frame) for c in frame.children):
        conf += 0.05
        ev.append("a page dim behind the panel")
    if conf >= MATCH_THRESHOLD:
        eyebrow = next((t for t in pb.texts if _is_upper_label(t)), "")
        tile_labels = [[_t(x) for x in t.texts()] for t in tiles]
        out["patterns"].append({"id": "header.megaMenu", "confidence": round(min(conf, 0.95), 2), "evidence": ev})
        out["facts"] = {"eyebrow": eyebrow, "tiles": tile_labels, "panel": panel}
    header = next((n for n in frame.descendants() if re.search(r"\bheader\b", n.lname) and n.h <= 140), None) or \
        next((n for n in bands if n.y <= 4 and n.h <= 140), None)
    if header is not None:
        hb = Band(header, frame, 0, 3, code)
        conf_h, ev_h, facts_h = _det_header(hb)
        if conf_h >= MATCH_THRESHOLD:
            out["header"] = {"band": hb, "match": {"id": "header.editorial", "confidence": round(conf_h, 2),
                                                   "evidence": ev_h, "_facts": facts_h}}
    return out


# ──────────────────────────────────────────────────────────────────────────
# Props drafts
# ──────────────────────────────────────────────────────────────────────────
_PLACEHOLDER_RE = re.compile(r"^<[^<>]{1,240}>$")


def deep_merge(base: Any, extra: Any) -> Any:
    """Patterns combine: nested objects merge key by key, arrays concatenate (items with an id de-duplicated)."""
    if isinstance(base, dict) and isinstance(extra, dict):
        out = dict(base)
        for k, v in extra.items():
            out[k] = deep_merge(out[k], v) if k in out else copy.deepcopy(v)
        return out
    if isinstance(base, list) and isinstance(extra, list):
        out_l = list(base)
        ids = {i.get("id") for i in base if isinstance(i, dict) and i.get("id")}
        for item in extra:
            if isinstance(item, dict) and item.get("id") and item["id"] in ids:
                continue
            out_l.append(copy.deepcopy(item))
        return out_l
    return copy.deepcopy(extra)


def _strip_placeholders(node: Any, path: str, todo: List[str], bound: List[str]) -> Any:
    """Registry placeholders ('<…>') → '' with the path listed: ids to wire, images to import, copy to write."""
    if isinstance(node, dict):
        return {k: _strip_placeholders(v, f"{path}.{k}" if path else k, todo, bound) for k, v in node.items()}
    if isinstance(node, list):
        return [_strip_placeholders(v, f"{path}[{i}]", todo, bound) for i, v in enumerate(node)]
    if isinstance(node, str) and _PLACEHOLDER_RE.match(node.strip()):
        low = node.lower()
        if re.search(r"libraryid|productpagecode|audienceid|course id|inviteid|leave empty", low):
            bound.append(path)
        else:
            todo.append(f"{path}: {node.strip('<>')[:120]}")
        return ""
    return node


def _set(d: Dict[str, Any], path: str, value: Any) -> None:
    if value in (None, "", []):
        return
    keys = path.split(".")
    cur = d
    for k in keys[:-1]:
        nxt = cur.get(k)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[k] = nxt
        cur = nxt
    cur[keys[-1]] = value


def _clip(s: Optional[str], n: int = MAX_TEXT_CHARS) -> str:
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s[:n]


def _lead(b: Band, head: Optional[Node], within: Optional[Node] = None) -> str:
    """The first paragraph under the heading, in the heading's own column."""
    cands = [n for n in (within or b.node).texts() if n is not head and _words(_t(n)) >= 6
             and (head is None or n.y >= head.y)]
    if head is not None:
        same_col = [n for n in cands if n.x < head.right and n.right > head.x]
        cands = sorted(same_col or cands, key=lambda n: (n.y - head.y, abs(n.x - head.x)))
    return _clip(_t(cands[0])) if cands else ""


def _split_script(text: str) -> Tuple[str, Optional[str]]:
    """'Rajaswala Paricharya रजस्वला परिचर्या' → ('Rajaswala Paricharya', 'रजस्वला परिचर्या')."""
    if not (_DEVANAGARI_RE.search(text) and _LATIN_RE.search(text)):
        return text, None
    latin = " ".join(w for w in text.split() if not _DEVANAGARI_RE.search(w)).strip(" ·|-")
    native = " ".join(w for w in text.split() if _DEVANAGARI_RE.search(w)).strip(" ·|-")
    return (latin or text), (native or None)


def _breadcrumb(b: Band) -> List[Dict[str, Any]]:
    crumb = next((t for t in b.texts if _BREADCRUMB_RE.search(t)), None)
    if not crumb:
        return []
    parts = [p.strip() for p in re.split(r"\s*[/›>»|]\s*", crumb) if p.strip()]
    out: List[Dict[str, Any]] = []
    for i, p in enumerate(parts):
        item: Dict[str, Any] = {"label": _clip(p, 60)}
        if i == 0:
            item["route"] = "homepage"
        out.append(item)
    return out


def _button_props(label: str, style: Optional[str] = None) -> Dict[str, Any]:
    text = _clip(_ARROW_RE.sub("", label).strip(), 60)
    btn: Dict[str, Any] = {"enabled": True, "text": text, "action": "navigate", "target": ""}
    if _ARROW_RE.search(label):
        btn["icon"] = "arrow"
    if _CONTACT_RE.search(label) or _NOTIFY_RE.search(label):
        btn.update({"action": "openForm", "audienceId": "", "formTitle": text})
    if style:
        btn["style"] = style
    return btn


def _fill_cta(props: Dict[str, Any], b: Band, facts: Dict[str, Any], pid: str) -> None:
    head = facts.get("heading") or b.heading()
    _set(props, "heading", _clip(_t(head)) if head else "")
    _set(props, "subheading", _lead(b, head))
    eyebrow = next((t for t in b.texts if _is_upper_label(t) and (head is None or t != _t(head))), None)
    if pid != "cta.band" and eyebrow:
        props["eyebrow"] = _clip(eyebrow.title() if eyebrow.isupper() else eyebrow, 60)
    bg = b.bg()
    if bg:
        props["backgroundColor"] = bg
        props["textColor"] = "#FFFFFF" if _dark(bg) else (props.get("textColor") or "")
        if not props["textColor"]:
            props.pop("textColor")
    btns = facts.get("buttons") or b.buttons()
    dark = b.is_dark()
    if btns:
        props["button"] = {**(props.get("button") or {}), **_button_props(btns[0][1])}
    if len(btns) > 1:
        style = "outline-light" if dark else "primary"
        props["secondaryButton"] = {**(props.get("secondaryButton") or {}), **_button_props(btns[1][1], style)}
    else:
        props.pop("secondaryButton", None)


def _fill_hero_editorial(props: Dict[str, Any], b: Band, facts: Dict[str, Any]) -> None:
    head = facts.get("heading")
    crumbs = _breadcrumb(b)
    if crumbs:
        props["breadcrumb"] = crumbs
    eyebrow = facts.get("eyebrow")
    if eyebrow is not None:
        props.setdefault("eyebrow", {})["text"] = _clip(_t(eyebrow).capitalize() if _t(eyebrow).isupper() else _t(eyebrow), 60)
    if head is not None:
        title = _t(head)
        parts = re.split(r"(?<=[?.!])\s+", title, maxsplit=1)
        left = props.setdefault("left", {})
        left["title"] = _clip(parts[0], 120)
        left["titleAccent"] = _clip(parts[1], 120) if len(parts) > 1 else ""
        desc = _lead(b, head)
        if desc:
            left["description"] = f"<p>{html.escape(desc)}</p>"
        btns = b.buttons()
        btn_ids = {id(n) for bn, _ in btns for n in bn.walk()}
        checklist = [_CHECK_RE.sub("", _t(n)) for n in b.text_nodes
                     if n.y > head.y and 1 <= _words(_t(n)) <= 7 and not _is_upper_label(_t(n))
                     and n.x < b.frame.w * 0.5 and id(n) not in btn_ids and _t(n) != desc]
        if checklist:
            left["checklist"] = [_clip(c, 80) for c in checklist[:6]]
        if btns:
            left["buttons"] = [{"text": _clip(_ARROW_RE.sub("", lbl).strip(), 60), "action": "navigate", "target": "",
                                "variant": "primary" if i == 0 else "secondary"} for i, (_, lbl) in enumerate(btns[:2])]
    bg = b.bg()
    if bg:
        props["backgroundColor"] = bg


def _fill_steps(props: Dict[str, Any], b: Band, facts: Dict[str, Any]) -> None:
    cards = facts.get("cards") or []
    head = b.heading()
    in_cards = {id(n) for c in cards for n in c.walk()}
    if head is not None and id(head) not in in_cards:
        props["headerText"] = _clip(_t(head), 120)
    steps = []
    for i, c in enumerate(cards):
        ts = [_t(t) for t in c.texts()]
        num = next((m.group(1) for t in ts if (m := _STEP_NUMBER_RE.match(t))), str(i + 1))
        rest = [t for t in ts if not _STEP_NUMBER_RE.match(t)]
        steps.append({"number": num, "title": _clip(rest[0] if rest else "", 80),
                      "description": _clip(" ".join(rest[1:]), 240)})
    if steps:
        props["steps"] = steps
    bg = b.bg()
    if bg:
        props["backgroundColor"] = bg


def _fill_catalog(props: Dict[str, Any], b: Band, pid: str, facts: Dict[str, Any]) -> None:
    if pid == "catalog.hero":
        head = b.heading()
        hero = props.setdefault("hero", {})
        if head is not None:
            hero["title"] = _clip(_t(head), 120)
            hero["lead"] = _lead(b, head) or hero.get("lead", "")
        crumbs = _breadcrumb(b)
        if crumbs:
            hero["breadcrumb"] = crumbs
        search = next((t for t in b.texts if re.search(r"\bsearch\b", t, re.I) and _words(t) >= 3), None)
        if search:
            hero.setdefault("search", {})["placeholder"] = _clip(search, 160)
        stats = facts.get("stats") or []
        labels = []
        for s in stats[:3]:
            cap = next((t for t in b.text_nodes if t is not s and abs(t.x - s.x) <= 4 and 0 < t.y - s.y <= 48), None)
            if cap is not None:
                labels.append(_t(cap))
        if labels:
            kinds = ["courses", "streams", "categories"]
            hero["stats"] = [{"kind": next((k for k in kinds if k[:-1] in lbl.lower()), kinds[min(i, 2)]),
                              "label": _clip(lbl, 60)} for i, lbl in enumerate(labels)]
        popular = facts.get("popular") or []
        if popular:
            p = popular[0]
            chips = [_chip_label(c) for c in (p.parent.children if p.parent else []) if c is not p and c.type != "text"]
            if chips:
                hero["popular"] = [{"label": _clip(c, 40)} for c in chips[:8] if c]
    elif pid == "catalog.quickFilters":
        chips = [c.lower() for c in facts.get("chips") or []]
        keep = []
        for qf in props.get("quickFilters") or []:
            kind = qf.get("kind")
            hit = next((c for c in facts.get("chips") or [] if _quick_kind(c) == (kind, qf.get("value"))), None)
            if hit:
                keep.append({**qf, "label": _clip(re.sub(r"^\s*[✓✔]\s*", "", hit), 40)})
        if keep or chips:
            props["quickFilters"] = keep
        if facts.get("label"):
            props.setdefault("hero", {}).setdefault("quickFilterBar", {})["label"] = _clip(facts["label"], 40)
    elif pid == "catalog.customFilters":
        out = []
        for g in facts.get("groups") or []:
            key = re.sub(r"[^a-z0-9]+", "-", g["label"].lower()).strip("-")[:32] or "filter"
            if key in ("format", "formats", "type", "media"):
                out.append({"id": key, "label": _clip(g["label"].title(), 40), "source": "courseFormats"})
            else:
                out.append({"id": key, "label": _clip(g["label"].title(), 40), "source": "options",
                            "options": [{"id": re.sub(r"[^a-z0-9]+", "-", o.lower()).strip("-")[:32] or "option",
                                         "label": _clip(o, 60), "tags": []} for o in g["options"][:12]]})
        if out:
            props["customFilters"] = out
    elif pid == "catalog.filterSidebar.promo":
        texts = [t for t in facts.get("texts") or [] if t]
        promo = props.setdefault("filterSidebar", {}).setdefault("promo", {})
        if texts:
            eyebrow = next((t for t in texts if _is_upper_label(t)), None)
            if eyebrow:
                promo["eyebrow"] = _clip(eyebrow.title(), 60)
            body = [t for t in texts if t != eyebrow]
            if body:
                promo["title"] = _clip(body[0], 120)
            if len(body) > 1 and not _ARROW_RE.search(body[1]):
                promo["text"] = _clip(body[1], 240)
            btn = next((t for t in reversed(texts) if _words(t) <= 5 and t not in (eyebrow,)), None)
            if btn:
                promo.setdefault("button", {})["text"] = _clip(_ARROW_RE.sub("", btn).strip(), 40)
    elif pid == "catalog.sections.spotlight" and facts.get("panels"):
        slides = [_spotlight_slide(b, p, i) for i, p in enumerate(facts["panels"][:6])]
        for sec in props.get("columnSections") or []:
            if sec.get("kind") == "spotlight":
                sec["slides"] = slides
    elif pid == "catalog.sections.freeCourses" and facts.get("title"):
        for sec in props.get("columnSections") or []:
            if sec.get("kind") == "free-courses":
                sec["title"] = _clip(facts["title"], 120)


#: Marks a step whose design price was left out (popped into a todo by _section_props).
_DESIGN_PRICE_KEY = "_designPrice"


def _price_digits(text: str) -> str:
    m = _PRICE_RE.search(text or "")
    if not m:
        return ""
    digits = re.match(r"[\d,]+", text[m.end() - 1:])
    return digits.group(0).replace(",", "") if digits else ""


def _pop_design_prices(node: Any, path: str, todo: List[str]) -> None:
    if isinstance(node, dict):
        price = node.pop(_DESIGN_PRICE_KEY, None)
        if price:
            todo.append(f"{path}.meta: the design shows {price} — never copy a price; write {{price}} only "
                        "when it is this slide's product page price, else leave it empty")
        for k, v in node.items():
            _pop_design_prices(v, f"{path}.{k}" if path else k, todo)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _pop_design_prices(v, f"{path}[{i}]", todo)


def _spotlight_slide(b: Band, panel: Dict[str, Any], i: int) -> Dict[str, Any]:
    node = panel["panel"]
    in_steps = {id(x) for st in panel["steps"] for x in st.walk()}
    texts = [t for t in node.texts() if id(t) not in in_steps and not re.fullmatch(r"\s*\d+\s*/\s*\d+\s*", _t(t))]
    head = b.heading(node)
    eyebrow = next((_t(t) for t in texts if _is_upper_label(_t(t)) and t is not head), "")
    slide: Dict[str, Any] = {"id": f"slide-{i + 1}"}
    if eyebrow:
        slide["eyebrow"] = _clip(re.split(r"\s*·\s*", eyebrow)[0].capitalize(), 60)
    native = None
    if head is not None:
        title, native = _split_script(_t(head))
        slide["title"] = _clip(title, 120)
    native = native or next((_t(t) for t in texts if _DEVANAGARI_RE.search(_t(t)) and not _LATIN_RE.search(_t(t))), None)
    if native:
        slide["titleNative"] = _clip(native, 120)
    desc = _lead(b, head, node)
    if desc:
        slide["description"] = desc
    btn = next((lbl for lbl in panel.get("buttons") or []), None)
    cta: Dict[str, Any] = {"action": "product-page", "productPageCode": ""}
    cta_price = _price_digits(btn or "")
    if btn:
        label = _ARROW_RE.sub("", btn).strip()
        cta["label"] = _clip(_PRICE_RE.sub("{price}", label) if _PRICE_RE.search(label) else label, 60)
        cta["label"] = re.sub(r"\{price\}[\d,.]*", "{price}", cta["label"])
    slide["cta"] = cta
    steps = []
    for st in panel["steps"]:
        ts = [_t(t) for t in st.texts() if not _STEP_NUMBER_RE.match(_t(t))]
        meta = next((t for t in ts if _PRICE_RE.search(t) or _FREE_RE.match(t)), None)
        title = next((t for t in ts if t != meta), "")
        step = {"title": _clip(title, 80)}
        rest = [t for t in ts if t not in (title, meta)]
        if meta and _PRICE_RE.search(meta) and not _FREE_RE.match(meta):
            # Never copy a design price: it would stay on the live site after the real price
            # changes. The slide's own price → {price}; any other price is left for the AI.
            if cta_price and _price_digits(meta) == cta_price:
                step["meta"] = _PRICE_RE.sub("{price}", meta, count=1)
                step["meta"] = _clip(re.sub(r"\{price\}[\d,.]*", "{price}", step["meta"]), 40)
            else:
                step["meta"] = ""
                step[_DESIGN_PRICE_KEY] = _clip(meta, 40)
        elif meta or rest:
            step["meta"] = _clip(meta or rest[0], 40)
        if meta and _FREE_RE.match(meta):
            step["tone"] = "accent"
        steps.append(step)
    slide["steps"] = steps
    return slide


def _quick_kind(label: str) -> Tuple[Optional[str], Any]:
    s = re.sub(r"^\s*[✓✔]\s*", "", label).strip().lower()
    if re.search(r"popular", s):
        return "popular", None
    if re.fullmatch(r"new( courses)?", s):
        return "new", None
    if s == "free":
        return "free", None
    if re.search(r"best ?sell", s):
        return "bestseller", None
    if re.search(r"hindi|हिन्दी", s):
        return "language", "hi"
    m = re.search(r"under\s*(?:₹|rs\.?|\$)?\s*([\d,]+)", s)
    if m:
        return "priceMax", int(m.group(1).replace(",", ""))
    return None, None


def _fill_learning_path(props: Dict[str, Any], b: Band, pid: str, facts: Dict[str, Any]) -> None:
    if pid == "learningPath.featured":
        goals = facts.get("goals")
        if goals:
            q, row = goals
            props["title"] = _clip(_t(q), 120)
            labels = [_strip_count(_chip_label(c)) for c in row]
            if labels and re.match(r"^\s*all\b", labels[0], re.I):
                props["allGoalsLabel"] = _clip(labels[0], 40)
                labels = labels[1:]
            props["goals"] = [{"key": re.sub(r"[^a-z0-9]+", "-", lb.lower()).strip("-")[:40] or f"goal-{i + 1}",
                               "label": _clip(lb, 60), "tags": []} for i, lb in enumerate(labels[:8])]
    elif pid == "learningPath.pathExtras":
        soon = b.matching(re.compile(r"coming soon", re.I))
        for extra in props.get("pathExtras") or []:
            extra["mergeSteps"] = []
            if not soon:
                extra.pop("comingSoon", None)
    elif pid == "learningPath.moreGrid":
        head = b.heading()
        if head is not None:
            props["moreTitle"] = _clip(_t(head), 120)
            note = next((t for t in b.texts if t != _t(head) and _words(t) >= 3), None)
            if note:
                props["moreNote"] = _clip(note, 160)


def _nav_container(b: Band) -> Optional[Node]:
    """The deepest layer that holds >= 3 of the bar's short texts (the nav list)."""
    short = [n for n in b.text_nodes if _words(_t(n)) <= 3 and n.h <= 26 and not _LANG_TOGGLE_RE.match(_t(n))]
    best: Optional[Node] = None
    short = short[:60]
    for n in b.near():
        if n.type == "text" or n.ntext < 3:
            continue
        inside = sum(1 for t in short if _is_ancestor(n, t))
        if inside >= 3 and (best is None or n.depth > best.depth):
            best = n
    return best


def _is_ancestor(a: Node, n: Node) -> bool:
    p = n.parent
    while p is not None:
        if p is a:
            return True
        p = p.parent
    return False


def _fill_header(props: Dict[str, Any], b: Band, routes: Dict[str, str], menu: Dict[str, Any]) -> None:
    container = _nav_container(b)
    btns = b.buttons()
    btn_nodes = {id(x) for bn, _ in btns for x in bn.walk()}
    nav = [n for n in (container.texts() if container is not None else [])
           if _words(_t(n)) <= 3 and not _LANG_TOGGLE_RE.match(_t(n))]
    if container is None:
        # A flat bar (the nav texts sit straight in the band, no list layer):
        # its short texts minus the buttons and a wordmark at the far left.
        flat = sorted((n for n in b.text_nodes if id(n) not in btn_nodes and _words(_t(n)) <= 3 and n.h <= 26
                       and not _LANG_TOGGLE_RE.match(_t(n))), key=lambda n: n.x)
        if flat and flat[0].x < b.frame.w * 0.2:
            flat = flat[1:]
        nav = flat[:12] if len(flat) >= 2 else []
    nav_ids = {id(n) for n in nav}
    items = []
    for n in nav:
        label = _t(n)
        items.append({"label": _clip(label, 40), "route": routes.get(label.lower(), "")})
    extra = [n for n in b.text_nodes if id(n) not in nav_ids and id(n) not in btn_nodes
             and _words(_t(n)) <= 3 and not _LANG_TOGGLE_RE.match(_t(n))]
    if menu.get("patterns") and items:
        tiles = menu.get("facts", {}).get("tiles") or []
        first_unrouted = next((i for i in items if not i["route"]), items[0])
        first_unrouted.update({"type": "megaMenu", "megaMenu": {
            "libraryId": "", "eyebrow": _clip(menu.get("facts", {}).get("eyebrow") or "", 60).title(),
            "showLegend": True}})
        if tiles:
            first_unrouted["route"] = first_unrouted["route"] or ""
        props["megaMenuStyle"] = "editorial"
    if items:
        props["navigation"] = items
    langs = [t for t in b.texts if _LANG_TOGGLE_RE.match(t)]
    if len(langs) >= 2:
        props["showLanguageSwitcher"] = True
        props["languageSwitcherStyle"] = "segmented"
    auth = [{"label": _clip(_t(n), 40), "route": "", "style": "text"} for n in extra
            if n.x > b.frame.w * 0.5][:2]
    auth += [{"label": _clip(lbl, 40), "route": "", "style": "primary"} for _, lbl in btns
             if lbl and not _LANG_TOGGLE_RE.match(lbl) and lbl.lower() not in routes][:2]
    if auth:
        props["authLinks"] = auth[:3]


def _chrome_unsure(props: Dict[str, Any], confidence: Any, kind: str) -> Optional[str]:
    """Why a detected header / footer should NOT replace the site's default one, else None."""
    try:
        conf = float(confidence or 0)
    except (TypeError, ValueError):
        conf = 0.0
    if conf < LOW_CONFIDENCE:
        return f"Low confidence ({conf:.2f}) that this band is the site {kind}: compare with the frame, then set it " \
               "with website_edit(action='set_layout')."
    if kind == "header" and not [i for i in props.get("navigation") or [] if isinstance(i, dict) and i.get("label")]:
        return "No navigation was read from the bar, so the site's default header is kept: add the menu items and " \
               "set it with website_edit(action='set_layout')."
    if kind == "footer":
        left = props.get("leftSection") if isinstance(props.get("leftSection"), dict) else {}
        links = [ln for k, v in props.items() if k.startswith("rightSection") and isinstance(v, dict)
                 for ln in v.get("links") or [] if isinstance(ln, dict) and ln.get("label")]
        if not (left.get("title") or left.get("text") or links or props.get("bottomNote")):
            return "No text or links were read from the footer, so the site's default footer is kept: fill it and " \
                   "set it with website_edit(action='set_layout')."
    return None


def _fill_footer(props: Dict[str, Any], b: Band) -> None:
    head = b.heading()
    left = props.setdefault("leftSection", {})
    if head is not None:
        left["title"] = _clip(_t(head), 80)
        desc = _lead(b, head)
        if desc:
            left["text"] = desc
    tagline = next((t for t in b.texts if re.search(r"[•·]", t) and 2 <= _words(t) <= 10 and not _COUNT_SUFFIX_RE.search(t)), None)
    if tagline:
        left["tagline"] = _clip(tagline, 120)
    if b.has(_EMAIL_RE):
        nl = props.setdefault("newsletter", {"enabled": True})
        field = next((n for n in b.text_nodes if _EMAIL_RE.search(_t(n)) and _words(_t(n)) <= 5), None)
        if field is not None:
            nl["placeholder"] = _clip(_t(field), 60)
            col = [n for n in b.text_nodes if abs(n.x - field.x) <= 60]
            before = [_t(n) for n in col if n.y < field.y][-3:]
            heads = [t for t in before if _words(t) <= 4]
            if heads:
                nl["heading"] = _clip(heads[-1], 80)
            subs = [t for t in before if _words(t) > 4]
            if subs:
                nl["subheading"] = _clip(subs[-1], 200)
            sub = next((lbl for _, lbl in b.buttons() if _SUBSCRIBE_RE.search(lbl)), None) or \
                next((_t(n) for n in b.text_nodes if _SUBSCRIBE_RE.search(_t(n)) and _words(_t(n)) <= 3), None)
            if sub:
                nl["buttonText"] = _clip(sub, 30)
            after = [_t(n) for n in col if n.y > field.y + field.h and _words(_t(n)) >= 4]
            if after:
                nl["note"] = _clip(after[0], 200)
        nl.setdefault("audienceId", "")
    note = next((t for t in b.texts if t.startswith("©") or re.search(r"all rights reserved", t, re.I)), None)
    if note:
        props["bottomNote"] = _clip(note, 160)
    last = next((t for t in reversed(b.texts) if not _LANG_TOGGLE_RE.match(t) and t != note), None)
    if last and last != tagline and _words(last) <= 10 and re.search(r"[→•·]", last):
        props["bottomTagline"] = _clip(last, 120)
    columns = []
    for n in b.near():
        if not 3 <= n.ntext <= 12:
            continue
        kids = n.texts()
        if 3 <= len(kids) <= 12 and len({round(k.x) for k in kids}) == 1 and n.w <= b.frame.w * 0.3 \
                and all(_words(_t(k)) <= 5 for k in kids):
            columns.append(kids)
    seen: set = set()
    k = 1
    for col in columns:
        key = tuple(_t(c) for c in col)
        if key in seen or any(set(key) < set(s) for s in seen):
            continue
        seen.add(key)
        if k > 4:
            break
        props[f"rightSection{k}"] = {"title": _clip(_t(col[0]), 60),
                                     "links": [{"label": _clip(_t(c), 60), "route": ""} for c in col[1:8]]}
        k += 1
    bg = b.bg()
    if bg:
        props["backgroundColor"] = bg


# ──────────────────────────────────────────────────────────────────────────
# Data needs, assets, notes
# ──────────────────────────────────────────────────────────────────────────
def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]


def _pair_label(lines: List[str]) -> Dict[str, str]:
    """['शिक्षा', 'Education · 7'] → {'en': 'Education', 'hi': 'शिक्षा', 'count': '7'}."""
    out: Dict[str, str] = {}
    for line in lines:
        m = _COUNT_SUFFIX_RE.search(line)
        if m:
            out["count"] = re.sub(r"\D", "", m.group(0))
        clean = _strip_count(line)
        if _DEVANAGARI_RE.search(clean):
            out.setdefault("hi", clean)
        elif _LATIN_RE.search(clean):
            out.setdefault("en", clean)
    return out


def build_data_needs(sections: List[Dict[str, Any]], chrome: Dict[str, Any], tokens: Dict[str, Any],
                     registry: Dict[str, Dict[str, Any]], all_bands: List[Tuple[Band, List[Dict[str, Any]]]],
                     menu_facts: Dict[str, Any]) -> List[Dict[str, Any]]:
    needs: Dict[str, Dict[str, Any]] = {}

    def need(key: str, kind: str, what: str, **extra: Any) -> Dict[str, Any]:
        n = needs.setdefault(key, {"kind": kind, "what": what, "patterns": [], "design": {}})
        for k, v in extra.items():
            n[k] = v
        return n

    matched_ids = [m["id"] for s in sections for m in s["patterns"]] + [m["id"] for m in chrome.get("patterns", [])]
    for pid in matched_ids:
        for req in registry.get(pid, {}).get("requires") or []:
            kind = req.get("kind")
            if kind in ("asset",):
                continue
            n = need(kind, kind, _NEED_TEXT.get(kind, kind))
            if pid not in n["patterns"]:
                n["patterns"].append(pid)
            n.setdefault("details", [])
            if req.get("detail") and req["detail"] not in n["details"]:
                n["details"].append(req["detail"])

    streams: List[Dict[str, str]] = []
    categories: List[str] = []
    formats: List[str] = []
    audiences: List[str] = []
    languages: List[str] = []
    forms: Dict[str, List[str]] = defaultdict(list)
    paths: List[str] = []
    path_cards = 0
    prices: List[str] = []
    bundle: List[str] = []
    for b, matches in all_bands:
        for m in matches:
            f = m.get("_facts") or {}
            if m["id"] == "catalog.streams.icons":
                for tab in f.get("tabs") or []:
                    pair = _pair_label(tab)
                    if pair and not re.match(r"^\s*all\b", pair.get("en", ""), re.I) and pair.get("hi") != "सभी":
                        streams.append(pair)
            if m["id"] == "catalog.filterSidebar.editorial":
                for g in f.get("groups") or []:
                    lab = g["label"].lower()
                    if lab.startswith("categor"):
                        categories.extend(g["options"])
                    elif lab.startswith("format"):
                        formats.extend(g["options"])
                    elif lab.startswith("language"):
                        languages.extend(g["options"])
                    elif lab not in _STANDARD_FILTERS:
                        audiences.extend(f"{g['label'].title()}: {o}" for o in g["options"])
            if m["id"] == "learningPath.featured" and not f.get("goals_only"):
                head = b.heading()
                if head is not None:
                    paths.append(_split_script(_t(head))[0])
            if m["id"] == "learningPath.moreGrid":
                path_cards = max(path_cards, int(f.get("cards") or 0))
            if m["id"] == "catalog.sections.spotlight":
                for panel in f.get("panels") or []:
                    head = b.heading(panel["panel"])
                    if head is not None:
                        paths.append(_split_script(_t(head))[0])
        for node, lbl in b.buttons():
            if _CONTACT_RE.search(lbl):
                forms["contact"].append(_clip(_ARROW_RE.sub("", lbl).strip(), 40))
            elif _NOTIFY_RE.search(lbl):
                forms["notify"].append(_clip(lbl, 40))
        if any(_NOTIFY_RE.search(t) for t in b.texts) or any(m["id"] == "catalog.sections.comingSoon" for m in matches):
            forms["notify"].append("Notify me")
        if any(m["id"] == "footer.newsletter" for m in matches):
            forms["newsletter"].append("Subscribe")
        prices.extend(t for t in b.texts if _PRICE_RE.search(t))
        bundle.extend(t for t in b.texts if _BUNDLE_RE.search(t))

    if streams or menu_facts.get("tiles"):
        n = need("folderLibrary", "folderLibrary", _NEED_TEXT["folderLibrary"])
        if streams:
            n["design"]["streams"] = streams[:12]
        elif menu_facts.get("tiles"):
            n["design"]["streams"] = [_pair_label(t) for t in menu_facts["tiles"][:12]]
        if categories:
            n["design"]["categories"] = [_clip(c, 80) for c in categories[:40]]
    tag_families: Dict[str, Any] = {}
    if streams:
        tag_families["stream"] = [s.get("en") or s.get("hi") for s in streams]
    if formats:
        tag_families["format"] = [f"format-{_slug(f)}" for f in formats]
    if audiences:
        tag_families["audience"] = audiences[:20]
    if languages:
        tag_families["language"] = languages
    if tag_families:
        n = need("courseTags", "courseTags", _NEED_TEXT["courseTags"])
        n["design"]["tag_families"] = tag_families
    if formats:
        n = need("courseFormats", "courseFormats", _NEED_TEXT["courseFormats"])
        n["design"]["formats"] = [{"key": _slug(f) or f"format-{i + 1}", "label": _clip(f, 60)}
                                  for i, f in enumerate(formats[:20])]
    langs = languages or (["English", "Hindi"] if "hi" in (tokens.get("languages") or []) else [])
    if langs and ("courseLanguages" in needs or len(langs) >= 2):
        n = need("courseLanguages", "courseLanguages", _NEED_TEXT["courseLanguages"])
        n["design"]["languages"] = langs[:8]
    if paths or path_cards:
        n = need("productPage", "productPage", _NEED_TEXT["productPage"])
        n["design"]["paths_named"] = list(dict.fromkeys(_clip(p, 80) for p in paths))[:12]
        n["design"]["path_cards"] = path_cards
        n["design"]["at_least"] = max(len(set(paths)), path_cards)
        if bundle:
            n["design"]["store"] = {"needed": True, "why": "the design sells several courses together: "
                                                          + "; ".join(_clip(t, 80) for t in bundle[:2]),
                                    "how": "a store product page for the site cart (globalSettings.siteCart)"}
    for kind, labels in forms.items():
        n = need(f"campaign:{kind}", "campaign", _FORM_TEXT[kind])
        n["design"]["buttons"] = list(dict.fromkeys(labels))[:8]
    camp = needs.pop("campaign", None)
    if camp and not any(k.startswith("campaign:") for k in needs):
        needs["campaign"] = camp
    elif camp:
        for k, v in needs.items():
            if k.startswith("campaign:"):
                own = _FORM_PATTERNS[k.split(":", 1)[1]]
                v["patterns"] = [p for p in camp["patterns"] if p in own]
    if "hi" in (tokens.get("languages") or []):
        need("i18n", "i18n", _NEED_TEXT["i18n"])
    if prices:
        need("prices", "prices", "Prices come from the live courses / invites; the design's prices are examples.",
             design={"prices_shown": list(dict.fromkeys(prices))[:12]})
    out = []
    for key, n in needs.items():
        n["check"] = _NEED_CHECK.get(n["kind"], "website(action='data_inventory')")
        if not n["design"]:
            n.pop("design")
        out.append(n)
    return out


_NEED_TEXT = {
    "folderLibrary": "A folder library: streams as top-level folders (image, title, subtitle, course_tag), categories as their children.",
    "courseTags": "Course tags the widgets filter by (one per stream, format-<key>, audience tags).",
    "courseFormats": "globalSettings.courseFormats: the format taxonomy shown on card pills and the FORMAT filter.",
    "courseLanguages": "globalSettings.courseLanguages: fold language versions of a course into one card.",
    "productPage": "One product page per learning path (and a store page if the site has a cart).",
    "campaign": "ACTIVE lead campaigns for the design's forms.",
    "i18n": "A second language: translations keyed by the exact base-language text (website(action='strings')).",
}
_FORM_TEXT = {
    "contact": "A lead campaign for 'Talk to us' / contact buttons (openForm).",
    "notify": "A lead campaign for 'Notify me' on coming-soon items.",
    "newsletter": "A lead campaign for the footer newsletter.",
}
_FORM_PATTERNS = {
    "contact": ("cta.band", "cta.band.light", "cta.band.app", "catalog.sections.spotlight"),
    "notify": ("catalog.sections.comingSoon", "learningPath.pathExtras", "catalog.sections.spotlight"),
    "newsletter": ("footer.newsletter",),
}
_NEED_CHECK = {
    "folderLibrary": "website(action='data_inventory') → folder_libraries; bind with website_edit(bind_data)",
    "courseTags": "website(action='data_inventory') → tags; website(action='data_audit')",
    "courseFormats": "website_edit(action='set_catalog_settings', catalog_settings={course_formats: …})",
    "courseLanguages": "website_edit(action='set_catalog_settings', catalog_settings={course_languages: …})",
    "productPage": "website(action='data_inventory') → product_pages; bind with website_edit(bind_data)",
    "campaign": "audience_forms(action='list'); wire with website_edit(link_lead_form)",
    "i18n": "website(action='strings', locale='hi') then website_edit(action='set_translations')",
    "prices": "website(action='context', detail=true) → course prices",
}


def build_assets(frames: Sequence[Node], code: CodeIndex, expires_iso: Optional[str]) -> List[Dict[str, Any]]:
    """The design's image URLs (Figma asset links expire), with where and how big each is used."""
    by_id = {n.id: n for f in frames for n in f.walk()}
    out = []
    for name, url in list(code.assets.items())[:MAX_ASSETS]:
        nodes = code.asset_nodes.get(name, [])
        sizes = []
        kinds = set()
        for nid in nodes[:20]:
            n = by_id.get(nid) or by_id.get(nid.split(";")[0].lstrip("I"))
            if n is None:
                continue
            sizes.append({"w": round(n.w), "h": round(n.h)})
            low = n.lname + " " + (n.parent.lname if n.parent else "")
            if re.search(r"logo|brand", low) or (n.y < 80 and n.w <= 72):
                kinds.add("logo")
            elif re.search(r"icon|stream", low) or n.w <= 128:
                kinds.add("icon")
            elif _PHONE_NAME_RE.search(low):
                kinds.add("screen")
            else:
                kinds.add("illustration")
        ext = url.rsplit(".", 1)[-1].lower() if "." in url.rsplit("/", 1)[-1] else ""
        kind = next((k for k in ("logo", "screen", "illustration", "icon") if k in kinds), None)
        item: Dict[str, Any] = {"figma_ref": name, "url": url, "format": ext or None,
                                "used_by": nodes[:10], "size": sizes[0] if sizes else None,
                                "kind": kind or ("icon" if ext == "svg" else "image")}
        if expires_iso:
            item["url_expires_at"] = expires_iso
        out.append(item)
    return out


def designer_notes(frames: Sequence[Node]) -> List[Dict[str, Any]]:
    out = []
    for f in frames:
        if classify_frame(f) != "notes":
            continue
        out.append({"frame": f.id, "name": _clip(f.name, 80),
                    "lines": [_clip(_t(t), 300) for t in f.texts()][:30]})
    return out


def translation_candidates(frames: Sequence[Node]) -> Dict[str, str]:
    """English → Hindi pairs the design shows side by side (a bilingual label, or two lines in one box)."""
    pairs: Dict[str, str] = {}
    for f in frames:
        for n in f.walk():
            if n.type == "text":
                s = _t(n)
                parts = [p.strip() for p in re.split(r"\s+[·|]\s+", _strip_count(s)) if p.strip()]
                if len(parts) == 2:
                    hi = next((p for p in parts if _DEVANAGARI_RE.search(p) and not _LATIN_RE.search(p)), None)
                    en = next((p for p in parts if _LATIN_RE.search(p) and not _DEVANAGARI_RE.search(p)), None)
                    if hi and en:
                        pairs.setdefault(en, hi)
                continue
            texts = [c for c in n.children if c.type == "text"]
            if len(texts) == 2:
                p = _pair_label([_t(t) for t in texts])
                if p.get("en") and p.get("hi") and not _DEVANAGARI_RE.search(p["en"]) \
                        and _words(p["en"]) <= 2 * _words(p["hi"]) + 1:
                    pairs.setdefault(p["en"], p["hi"])
            if len(pairs) >= 200:
                return pairs
    return pairs


# ──────────────────────────────────────────────────────────────────────────
# The plan
# ──────────────────────────────────────────────────────────────────────────
def _registry_index(patterns: Sequence[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {p["id"]: p for p in patterns if isinstance(p, dict) and p.get("id") and p.get("component")}


def _section_props(component: str, matches: List[Dict[str, Any]], bands: List[Band],
                   registry: Dict[str, Dict[str, Any]]) -> Tuple[Dict[str, Any], List[str], List[str]]:
    props: Dict[str, Any] = {}
    for m in sorted(matches, key=lambda m: list(registry).index(m["id"])):
        props = deep_merge(props, registry[m["id"]].get("minimal") or {})
    todo: List[str] = []
    bound: List[str] = []
    props = _strip_placeholders(props, "", todo, bound)
    for m in matches:
        pid, facts = m["id"], m.get("_facts") or {}
        b = m["_band"]
        if component == "ctaBanner":
            _fill_cta(props, b, facts, pid)
        elif component == "heroSection":
            _fill_hero_editorial(props, b, facts)
        elif component == "stepsProcess":
            _fill_steps(props, b, facts)
        elif component == "courseCatalog":
            _fill_catalog(props, b, pid, facts)
        elif component == "learningPath":
            _fill_learning_path(props, b, pid, facts)
    bound, todo = _final_bound_and_todo(props, bound, todo)
    _pop_design_prices(props, "", todo)
    if component == "learningPath" and props.get("goals"):
        todo.append("goals[].tags: the stream folder slugs each goal shows")
    todo.extend(f"{p}: where it links (a page route or URL)" for p in _empty_links(props, ""))
    return props, todo, bound


def _empty_links(node: Any, path: str) -> List[str]:
    """Paths of link targets left empty (the design shows the button, not where it goes)."""
    out: List[str] = []
    if isinstance(node, dict):
        if node.get("action", "navigate") == "navigate":
            for key in ("target", "route"):
                if key in node and node[key] == "":
                    out.append(f"{path}.{key}" if path else key)
        for k, v in node.items():
            out.extend(_empty_links(v, f"{path}.{k}" if path else k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(_empty_links(v, f"{path}[{i}]"))
    return out


_GONE = object()

#: Props that hold an id the admin wires (bind_data / link_lead_form), never the design.
_BOUND_ID_KEYS = frozenset({"libraryId", "productPageCode", "storeProductPageCode", "audienceId"})
_LP_CODE_PARENT_RE = re.compile(r"(?:^|\.)(featured|pathExtras\[\d+\])$")


def _empty_bound_paths(node: Any, path: str = "") -> List[str]:
    """Every id path left EMPTY in the FINAL props (after the fills rebuilt lists), in order."""
    out: List[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            here = f"{path}.{k}" if path else k
            if v == "" and (k in _BOUND_ID_KEYS or (k == "code" and _LP_CODE_PARENT_RE.search(path or ""))):
                out.append(here)
            else:
                out.extend(_empty_bound_paths(v, here))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out.extend(_empty_bound_paths(v, f"{path}[{i}]"))
    return out


def _final_bound_and_todo(props: Dict[str, Any], bound: List[str], todo: List[str]) -> Tuple[List[str], List[str]]:
    """The registry's bound / todo paths still TRUE of the filled props (a fill may rebuild a list, so
    'navigation[1]' can be another item now), plus every other empty id path the filled props have."""
    todo = [t for t in todo if _get_path(props, t.split(":")[0], missing=False) is None
            and _get_path(props, t.split(":")[0], missing=True) is not _GONE]
    still = [b for b in bound if _get_path(props, b, missing=True) == ""]
    return list(dict.fromkeys(still + _empty_bound_paths(props))), todo


def _get_path(d: Any, path: str, missing: bool = False) -> Any:
    """Value at a 'a.b[0].c' path; a path that no longer exists → None (or _GONE with missing=True).
    With missing=False an empty value also reads as None."""
    cur = d
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path):
        if part.startswith("["):
            i = int(part[1:-1])
            if not isinstance(cur, list) or i >= len(cur):
                return _GONE if missing else None
            cur = cur[i]
        else:
            if not isinstance(cur, dict) or part not in cur:
                return _GONE if missing else None
            cur = cur[part]
    return cur if (missing or cur not in ("", [], {})) else None


_MERGE_INTO_ONE = ("courseCatalog",)


def _styled(b: Band) -> int:
    """How many of the band's layers the design code describes (the better copy of repeated chrome)."""
    return sum(1 for n in b.node.walk() if n.style)


def plan_design(*, metadata_xml: Sequence[str], design_code: Sequence[Dict[str, Any]], variables: Any,
                frame_ids: Optional[Sequence[str]], patterns: Sequence[Dict[str, Any]],
                font_stacks: Dict[str, str], expires_iso: Optional[str] = None) -> Dict[str, Any]:
    registry = _registry_index(patterns)
    warnings: List[str] = []
    frames: List[Node] = []
    for xml_text in metadata_xml:
        frames.extend(parse_metadata_xml(xml_text))
    code = parse_design_code(design_code)
    vars_ = parse_variables(variables)
    attach_styles(frames, code)
    for label in code.truncated:
        warnings.append(f"The design code for {label} ends mid-tree (Figma cuts get_design_context at about 100k "
                        "characters): colours and texts after the cut are missing. Call get_design_context on the "
                        "child frames after the cut and send them as more design_code entries.")
    if not frames:
        warnings.append("No layer tree: send get_metadata's XML as metadata_xml — sections are cut from it.")

    wanted = {str(f).replace("-", ":") for f in frame_ids or [] if str(f).strip()}
    if wanted:
        frames_sel = [f for f in frames if f.id in wanted or any(n.id in wanted for n in f.children)]
        if not frames_sel:
            warnings.append("None of frame_ids is a top-level frame of metadata_xml; every frame was planned.")
            frames_sel = frames
    else:
        frames_sel = frames

    tokens, tw = extract_tokens(frames_sel, code, vars_, font_stacks)
    warnings.extend(tw)

    frame_out: List[Dict[str, Any]] = []
    sections: List[Dict[str, Any]] = []
    chrome: Dict[str, Any] = {"patterns": []}
    header_band: Optional[Tuple[Band, Dict[str, Any]]] = None
    footer_band: Optional[Tuple[Band, Dict[str, Any]]] = None
    menu: Dict[str, Any] = {}
    all_bands: List[Tuple[Band, List[Dict[str, Any]]]] = []
    pages: List[Dict[str, Any]] = []
    page_frames = [f for f in frames_sel if classify_frame(f) == "page"]
    for f in frames_sel:
        kind = classify_frame(f)
        entry: Dict[str, Any] = {"id": f.id, "name": _clip(f.name, 120), "kind": kind, "w": round(f.w), "h": round(f.h)}
        if kind == "menu":
            m = _menu_frame_patterns(f, code, registry)
            if m.get("patterns"):
                menu = m
                chrome["patterns"].extend(m["patterns"])
            if m.get("header") and header_band is None:
                header_band = (m["header"]["band"], m["header"]["match"])
        frame_out.append(entry)
    if any(classify_frame(f) == "mobile" for f in frames_sel) is False and page_frames:
        warnings.append("No mobile frame (≤480 px wide): the 390 px layout is judged by the widgets' own rules.")

    for pi, f in enumerate(page_frames):
        route, title = page_route_title(f, pi)
        if any(p["route"] == route for p in pages):
            route = f"{route}-{pi + 1}"
        band_nodes = bands_of(f)
        page_sections: List[Dict[str, Any]] = []
        for bi, node in enumerate(band_nodes):
            b = Band(node, f, bi, len(band_nodes), code)
            matches = match_band(b, registry)
            for m in matches:
                m["_band"] = b
            all_bands.append((b, matches))
            comp = _band_component(matches, registry)
            if comp == "header":
                if header_band is None or _styled(b) > _styled(header_band[0]):
                    header_band = (b, matches[0])
                continue
            if comp == "footer":
                if footer_band is None or _styled(b) > _styled(footer_band[0]):
                    footer_band = (b, matches)
                continue
            if comp is None:
                page_sections.append({"component": None, "bands": [b], "matches": []})
                warnings.append(f"'{_clip(node.name, 60)}' ({route}, y {round(node.y)}) matches no pattern: compose it "
                                "from website(action='schema') or report it as a gap.")
                continue
            prev = page_sections[-1] if page_sections else None
            goals_only = any((m.get("_facts") or {}).get("goals_only") for m in matches)
            prev_goals_only = prev is not None and any((m.get("_facts") or {}).get("goals_only") for m in prev["matches"])
            if prev is not None and prev["component"] == comp and (comp in _MERGE_INTO_ONE or prev_goals_only):
                prev["bands"].append(b)
                have = {x["id"]: x for x in prev["matches"]}
                for m in matches:
                    if m["id"] not in have:
                        prev["matches"].append(m)
                    elif m["confidence"] > have[m["id"]]["confidence"]:
                        old = have[m["id"]]
                        if (old.get("_facts") or {}).get("goals") and not (m.get("_facts") or {}).get("goals"):
                            m["_facts"] = {**(m.get("_facts") or {}), "goals": old["_facts"]["goals"]}
                        prev["matches"][prev["matches"].index(old)] = m
                prev["matches"].sort(key=lambda x: -x["confidence"])
                continue
            page_sections.append({"component": comp, "bands": [b], "matches": list(matches),
                                  "_goals_only": goals_only})
        components = []
        used_ids: set = set()
        for si, ps in enumerate(page_sections[:MAX_SECTIONS_PER_PAGE]):
            bands = ps["bands"]
            box = {"x": 0, "y": round(bands[0].node.y), "w": round(f.w),
                   "h": round(bands[-1].node.bottom - bands[0].node.y)}
            comp = ps["component"]
            matches = [m for m in ps["matches"] if registry[m["id"]]["component"] == comp]
            others = [m for m in ps["matches"] if registry[m["id"]]["component"] != comp]
            sid = f"{route}-{re.sub(r'(?<!^)(?=[A-Z])', '-', comp or 'unmatched').lower()}"
            while sid in used_ids:
                sid = f"{sid}-{si + 1}"
            used_ids.add(sid)
            sec: Dict[str, Any] = {
                "id": sid, "page_route": route, "frame": f.id, "nodes": [b.node.id for b in bands],
                "names": [_clip(b.node.name, 60) for b in bands], "bbox": box, "component": comp,
                "pattern_id": matches[0]["id"] if matches else None,
                "patterns": [{k: v for k, v in m.items() if not k.startswith("_")} for m in matches],
                "confidence": round(max((m["confidence"] for m in matches), default=0.0), 2),
            }
            if others:
                sec["also_resembles"] = [{"id": m["id"], "confidence": m["confidence"]} for m in others]
            if comp:
                props, todo, bound = _section_props(comp, matches, bands, registry)
                sec["props_draft"] = props
                if todo:
                    sec["todo"] = todo[:20]
                if bound:
                    sec["bound_paths_left_empty"] = bound[:20]
                components.append({"id": sid, "type": comp, "enabled": True, "props": props})
            if sec["confidence"] and sec["confidence"] < LOW_CONFIDENCE:
                sec["check"] = "Low confidence: compare with the frame before keeping it."
            sections.append(sec)
        pages.append({"route": route, "title": title, "frame": f.id, "frame_name": _clip(f.name, 120),
                      "components": components})
        entry = next(e for e in frame_out if e["id"] == f.id)
        entry.update({"route": route, "bands": len(band_nodes)})

    routes = {p["title"].lower(): f"/{p['route']}" for p in pages}
    header = footer = None
    if header_band is not None:
        b, m = header_band
        m = dict(m)
        m["_band"] = b
        chrome["patterns"].insert(0, {k: v for k, v in m.items() if not k.startswith("_")})
        props = deep_merge(registry["header.editorial"].get("minimal") or {},
                           registry["header.megaMenu"].get("minimal") or {} if menu.get("patterns") else {})
        todo: List[str] = []
        bound: List[str] = []
        props = _strip_placeholders(props, "", todo, bound)
        props["navigation"] = []
        _fill_header(props, b, routes, menu)
        # _fill_header rebuilt navigation: report the paths of the FINAL menu, not the registry's.
        bound, todo = _final_bound_and_todo(props, bound, todo)
        mega = [i for i, n in enumerate(props.get("navigation") or []) if isinstance(n, dict) and n.get("type") == "megaMenu"]
        logo = (m.get("_facts") or {}).get("logo")
        header = {"id": "site-header", "type": "header", "enabled": True, "props": props}
        chrome["header"] = {"frame": b.frame.id, "node": b.node.id, "bbox": b.node.bbox(), "props_draft": props,
                            "bound_paths_left_empty": bound, "todo": (todo + [f"{p}: where it links" for p in
                                                                             _empty_links(props, "")])[:20],
                            **({"mega_menu_nav_index": mega[0]} if mega else {}),
                            **({"logo_node": logo.id} if logo is not None else {})}
    if footer_band is not None:
        b, matches = footer_band
        chrome["patterns"].extend({k: v for k, v in m.items() if not k.startswith("_")} for m in matches)
        props = {}
        for mm in matches:
            props = deep_merge(props, registry[mm["id"]].get("minimal") or {})
        todo = []
        bound = []
        props = _strip_placeholders(props, "", todo, bound)
        for k in [k for k in props if k.startswith("rightSection")]:
            props.pop(k)
        _fill_footer(props, b)
        bound, todo = _final_bound_and_todo(props, bound, todo)
        footer = {"id": "site-footer", "type": "footer", "enabled": True, "props": props}
        chrome["footer"] = {"frame": b.frame.id, "node": b.node.id, "bbox": b.node.bbox(), "props_draft": props,
                            "bound_paths_left_empty": bound, "todo": (todo + [f"{p}: where it links" for p in
                                                                             _empty_links(props, "")])[:20]}

    site_patterns = _site_patterns(tokens, all_bands, registry)
    data_needs = build_data_needs(sections, chrome, tokens, registry, all_bands, menu.get("facts") or {})
    assets = build_assets(frames, code, expires_iso)
    pairs = translation_candidates(frames_sel)

    site_json_draft: Dict[str, Any] = {"theme": theme_argument(tokens), "pages": [
        {"route": p["route"], "title": p["title"], "components": p["components"],
         "design_source": {"kind": "figma", "node_id": p["frame"], "frame": p["frame_name"]}} for p in pages]}
    # The draft's header / footer REPLACE the site's defaults on create_site, so
    # an unsure or empty one (no navigation, no links or text) stays out of it:
    # the plan still reports it under chrome for the caller to finish by hand.
    if header:
        why = _chrome_unsure(header["props"], (header_band[1] or {}).get("confidence"), "header")
        if why:
            chrome["header"]["not_in_draft"] = why
        else:
            site_json_draft["header"] = header
    if footer:
        why = _chrome_unsure(footer["props"], max((mm.get("confidence") or 0 for mm in footer_band[1]), default=0),
                             "footer")
        if why:
            chrome["footer"]["not_in_draft"] = why
        else:
            site_json_draft["footer"] = footer
    site_settings_calls = _settings_calls(data_needs, tokens)

    return {
        "tokens": tokens,
        "frames": frame_out,
        "sections": sections,
        "chrome": chrome,
        "site_patterns": site_patterns,
        "data_needs": data_needs,
        "assets": assets,
        "designer_notes": designer_notes(frames),
        "translation_candidates": dict(list(pairs.items())[:120]),
        "site_json_draft": site_json_draft,
        "settings_calls": site_settings_calls,
        "warnings": warnings,
        "stats": {"frames": len(frames), "nodes": sum(1 for f in frames for _ in f.walk()),
                  "design_code_nodes": len(code.node_ids), "text_runs": len(code.runs)},
    }


def _site_patterns(tokens: Dict[str, Any], all_bands: List[Tuple[Band, List[Dict[str, Any]]]],
                   registry: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []

    def add(pid: str, conf: float, ev: str) -> None:
        if pid in registry:
            out.append({"id": pid, "confidence": conf, "evidence": [ev]})

    if len(tokens.get("palette") or {}) >= 5:
        add("global.palette", 0.9, f"{len(tokens['palette'])} palette roles from fills, strokes and text")
    if tokens.get("content_max_width"):
        add("global.contentMaxWidth", 0.85, tokens.get("content_max_width_evidence") or "")
    if (tokens.get("fonts") or {}).get("stack"):
        add("global.fonts", 0.9, f"body font {tokens['fonts']['body']}")
    if "hi" in (tokens.get("languages") or []):
        add("global.i18n", 0.8, "Devanagari text beside English")
    ids = {m["id"] for _, ms in all_bands for m in ms}
    if "catalog.customFilters" in ids and any(
            g["label"].lower().startswith("format") for _, ms in all_bands for m in ms
            if m["id"] == "catalog.customFilters" for g in (m.get("_facts") or {}).get("groups") or []):
        add("global.courseFormats", 0.8, "a FORMAT filter group")
    if "catalog.languageVersions" in ids:
        add("global.courseLanguages", 0.75, "language chips / a LANGUAGE filter")
    if any(re.search(r"\b(add (whole )?.*to cart|cart)\b", t, re.I) for b, _ in all_bands for t in b.texts) or \
            any(re.search(r"\bcart\b", n) for b, _ in all_bands for n in b.names):
        add("global.siteCart", 0.6, "a cart icon or 'add to cart'")
    return out


#: settings_calls target the site the draft was saved to. plan cannot know it yet:
#: save_draft fills it in; anyone running a plan's calls by hand replaces it. Never
#: left out — a call without tag_name would change the institute's DEFAULT (live) site.
SETTINGS_TAG_PLACEHOLDER = "<tag_name of the site you saved the draft to>"


def _settings_calls(data_needs: List[Dict[str, Any]], tokens: Dict[str, Any]) -> List[Dict[str, Any]]:
    """website_edit calls that apply the site settings the design implies (after the draft exists)."""
    calls: List[Dict[str, Any]] = []
    cs: Dict[str, Any] = {}
    for n in data_needs:
        d = n.get("design") or {}
        if n["kind"] == "courseFormats" and d.get("formats"):
            cs["course_formats"] = {f["key"]: {"label": f["label"]} for f in d["formats"]}
            cs["course_format_order"] = [f["key"] for f in d["formats"]]
        if n["kind"] == "courseLanguages" and d.get("languages"):
            langs = []
            for lab in d["languages"]:
                code = "hi" if re.search(r"hindi|हिन्दी|हिंदी", lab, re.I) else "en" if re.search(r"english", lab, re.I) \
                    else _slug(lab)[:12]
                chip = {"hi": "हिं", "en": "EN"}.get(code, lab[:3].upper())
                langs.append({"code": code, "label": _clip(lab, 40), "chip": chip, "match": [lab.lower(), code]})
            cs["course_languages"] = {"enabled": True, "languages": langs}
    if cs:
        calls.append({"tool": "website_edit", "action": "set_catalog_settings",
                      "args": {"tag_name": SETTINGS_TAG_PLACEHOLDER, "catalog_settings": cs},
                      "why": "the design's format taxonomy and language versions",
                      "note": "Add `levels` / `tags` to each format so courses get their pill."})
    if "hi" in (tokens.get("languages") or []):
        calls.append({"tool": "website_edit", "action": "set_translations",
                      "args": {"tag_name": SETTINGS_TAG_PLACEHOLDER, "locale": "hi", "enable": True},
                      "why": "the design is bilingual (Devanagari beside English)",
                      "note": "Then website(action='strings', locale='hi') lists the exact page texts to translate; "
                              "translation_candidates holds the design's own side-by-side labels as a glossary "
                              "(layer pairs — check each before using it)."})
    return calls


__all__ = [
    "SETTINGS_TAG_PLACEHOLDER", "BAND_DETECTORS", "FRAME_PATTERNS", "SITE_PATTERNS", "PALETTE_ROLES", "DesignImportError",
    "Node", "CodeIndex", "parse_metadata_xml", "parse_design_code", "parse_variables", "attach_styles",
    "extract_tokens", "theme_argument", "classify_frame", "bands_of", "plan_design", "delta_e", "hex6",
    "deep_merge",
]
