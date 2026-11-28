"""Board operations: sanitize, validate structure, materialize to HTML.

The whiteboard is a list of whitelisted operations with stable element ids
(docs/ai-tutor/LIVE_TUTOR_DESIGN.md §4.4). The compiler stores both the ops
and the cumulative HTML render of each concept; the learner app renders the
ops with animation and highlights by id, the admin preview and the teaching-
off view show the stored HTML. This module is the single server-side source
of that HTML, so the two never disagree.

Security: text fields are HTML-escaped (never trusted as markup); SVG bodies
pass through nh3 with an SVG-only allowlist; image / video URLs must be https.
"""
from __future__ import annotations

import html
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from ...schemas.tutor import COLUMN_CHILD_OPS, ELEMENT_OPS, LIVE_ONLY_OPS, VISUAL_OPS

# ── SVG sanitizer ────────────────────────────────────────────────────────────

_SVG_TAGS = {
    "svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
    "text", "tspan", "defs", "marker", "title", "desc", "use", "symbol",
    "linearGradient", "radialGradient", "stop", "clipPath",
}
_SVG_COMMON_ATTRS = {
    "id", "class", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "transform",
    "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline",
    "marker-end", "marker-start", "clip-path",
    # no "style": presentation attributes cover every legitimate need and an
    # inline style is the one attribute whose value nh3 cannot vet.
}
_SVG_ATTRS: Dict[str, set] = {
    "*": _SVG_COMMON_ATTRS,
    "svg": {"viewBox", "viewbox", "width", "height", "xmlns", "preserveAspectRatio", "role", "aria-label"},
    "path": {"d"},
    "circle": {"cx", "cy", "r"},
    "ellipse": {"cx", "cy", "rx", "ry"},
    "rect": {"x", "y", "width", "height", "rx", "ry"},
    "line": {"x1", "y1", "x2", "y2"},
    "polyline": {"points"},
    "polygon": {"points"},
    "text": {"x", "y", "dx", "dy"},
    "tspan": {"x", "y", "dx", "dy"},
    "marker": {"markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "viewBox"},
    "use": {"href", "x", "y", "width", "height"},
    "symbol": {"viewBox"},
    "linearGradient": {"x1", "y1", "x2", "y2", "gradientUnits"},
    "radialGradient": {"cx", "cy", "r", "fx", "fy", "gradientUnits"},
    "stop": {"offset", "stop-color", "stop-opacity"},
}
_MAX_SVG_CHARS = 20_000
_DANGEROUS_STYLE = re.compile(r"(url\s*\(|expression\s*\(|javascript:|@import)", re.I)


def sanitize_svg(svg: str) -> str:
    """Return a safe inline SVG or '' when nothing safe remains."""
    if not svg or "<svg" not in svg:
        return ""
    svg = svg.strip()
    if len(svg) > _MAX_SVG_CHARS:
        # Never truncate mid-markup: a half diagram passes as a diagram.
        return ""
    try:
        import nh3
        cleaned = nh3.clean(
            svg,
            tags=_SVG_TAGS,
            attributes=_SVG_ATTRS,
            url_schemes={"https"},
            strip_comments=True,
        )
    except Exception:  # noqa: BLE001 — sanitizer unavailable: refuse the picture
        return ""
    # nh3 keeps style attributes we allowed; make sure none smuggles a URL.
    cleaned = re.sub(
        r'style="([^"]*)"',
        lambda m: "" if _DANGEROUS_STYLE.search(m.group(1)) else m.group(0),
        cleaned,
    )
    return cleaned if "<svg" in cleaned else ""


def svg_ids(svg: str) -> set:
    """Element ids inside an SVG, whichever quote style the model used."""
    return set(re.findall(r"""\sid=["']([^"']+)["']""", svg or ""))


# ── URL rules ────────────────────────────────────────────────────────────────

_HTTPS = re.compile(r"^https://[^\s\"'<>]+$", re.I)


def safe_url(url: Optional[str]) -> Optional[str]:
    if url and _HTTPS.match(url.strip()):
        return url.strip()
    return None


# ── Text helpers ─────────────────────────────────────────────────────────────

def esc(text: Any) -> str:
    return html.escape(str(text if text is not None else ""), quote=True)


def word_count(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def op_words(op: Dict[str, Any]) -> int:
    kind = op.get("op")
    if kind in ("text", "callout", "annotate"):
        return word_count(op.get("text", ""))
    if kind == "bullet":
        return sum(word_count(i) for i in op.get("items", []))
    if kind == "table":
        return sum(word_count(c) for row in op.get("rows", []) for c in row)
    if kind == "heading":
        return word_count(op.get("text", ""))
    if kind == "columns":
        return sum(op_words(child) for col in (op.get("columns") or []) for child in (col or []) if isinstance(child, dict))
    return 0


def iter_element_ops(ops: Iterable[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    """Every element op including the ones nested in columns."""
    for op in ops:
        yield op
        if op.get("op") == "columns":
            for col in op.get("columns") or []:
                for child in col or []:
                    if isinstance(child, dict):
                        yield child


# ── Structural validation (ids, targets) ─────────────────────────────────────

def validate_ops(ops: Sequence[Dict[str, Any]], known_ids: Optional[set] = None,
                 where: str = "", require_media_urls: bool = True) -> Tuple[List[str], set]:
    """Check ids are present/unique and targets exist. Returns (errors, ids).

    `require_media_urls=False` is for the compile loop, where a media_task's
    url is filled in by the system AFTER the model's draft is validated."""
    errors: List[str] = []
    ids = set(known_ids or set())
    for i, op in enumerate(ops):
        kind = op.get("op")
        loc = f"{where}ops[{i}]"
        if kind in LIVE_ONLY_OPS:
            errors.append(f"{loc}: '{kind}' is a live-session op and may not be compiled")
            continue
        if kind in ELEMENT_OPS:
            oid = op.get("id")
            if not oid or not isinstance(oid, str):
                errors.append(f"{loc}: '{kind}' needs a string id")
                continue
            if oid in ids:
                errors.append(f"{loc}: duplicate element id '{oid}'")
            ids.add(oid)
        if kind == "annotate" and op.get("target") not in ids:
            errors.append(f"{loc}: annotate target '{op.get('target')}' is not an element on this board")
        if kind == "arrow":
            for k in ("from", "to"):
                if op.get(k) not in ids:
                    errors.append(f"{loc}: arrow '{k}' '{op.get(k)}' is not an element on this board")
        if kind == "svg":
            if len(str(op.get("svg") or "")) > _MAX_SVG_CHARS:
                errors.append(f"{loc}: svg is too long ({len(str(op.get('svg')))} chars, max {_MAX_SVG_CHARS}); draw a simpler diagram")
            elif not sanitize_svg(op.get("svg", "")):
                errors.append(f"{loc}: svg is empty or unsafe after sanitizing")
            # Parts whose id is not in the svg are pruned by clean_ops, not
            # reported: a diagram that loses a pointer is still a diagram, and
            # bouncing the whole plan over it cost three model calls per slide.
        if kind == "columns":
            cols = op.get("columns") or []
            if not (2 <= len(cols) <= 3):
                errors.append(f"{loc}: columns needs 2 or 3 columns")
            for ci, col in enumerate(cols):
                if not isinstance(col, list) or not col:
                    errors.append(f"{loc}: column {ci + 1} is empty")
                    continue
                bad = [c.get("op") for c in col if not isinstance(c, dict) or c.get("op") not in COLUMN_CHILD_OPS]
                if bad:
                    errors.append(f"{loc}: column {ci + 1} may only hold heading/text/bullet/formula/table/callout, not {bad}")
                sub_errors, ids = validate_ops([c for c in col if isinstance(c, dict) and c.get("op") in COLUMN_CHILD_OPS],
                                               ids, where=f"{loc}.col{ci + 1}.", require_media_urls=require_media_urls)
                errors.extend(sub_errors)
        if kind in ("image", "video") and op.get("url") and not safe_url(op.get("url")):
            errors.append(f"{loc}: {kind} url must be https")
        if kind == "media_task":
            # Same rule clean_ops applies at store time, so a plan that would
            # lose its task on save is rejected here instead.
            if op.get("url") and not safe_url(op.get("url")) and not op.get("file_id"):
                errors.append(f"{loc}: media_task url must be https (or give a file_id)")
            elif require_media_urls and not (safe_url(op.get("url")) or op.get("file_id")):
                errors.append(f"{loc}: media_task needs a url or file_id")
    return errors, ids


# ── Materialization ──────────────────────────────────────────────────────────

def _render_op(op: Dict[str, Any]) -> str:
    kind = op.get("op")
    oid = esc(op.get("id", ""))
    attrs = f' data-op-id="{oid}"' if oid else ""
    if kind == "heading":
        level = max(1, min(4, int(op.get("level") or 2)))
        return f'<h{level} class="tb-heading"{attrs}>{esc(op.get("text"))}</h{level}>'
    if kind == "text":
        return f'<p class="tb-text"{attrs}>{esc(op.get("text"))}</p>'
    if kind == "bullet":
        items = "".join(f"<li>{esc(i)}</li>" for i in op.get("items", []))
        return f'<ul class="tb-bullets"{attrs}>{items}</ul>'
    if kind == "formula":
        cap = f'<figcaption>{esc(op["caption"])}</figcaption>' if op.get("caption") else ""
        return (f'<figure class="tb-formula"{attrs}><span class="tb-latex" '
                f'data-latex="{esc(op.get("latex"))}">{esc(op.get("latex"))}</span>{cap}</figure>')
    if kind == "svg":
        body = sanitize_svg(op.get("svg", ""))
        if not body:
            return ""
        return (f'<figure class="tb-svg"{attrs} aria-label="{esc(op.get("description"))}">{body}'
                f'<figcaption class="tb-visually-hidden">{esc(op.get("description"))}</figcaption></figure>')
    if kind == "image":
        url = safe_url(op.get("url"))
        if not url:
            return ""
        cap = f'<figcaption>{esc(op["caption"])}</figcaption>' if op.get("caption") else ""
        return (f'<figure class="tb-image"{attrs}><img src="{esc(url)}" alt="{esc(op.get("description"))}" '
                f'loading="lazy">{cap}</figure>')
    if kind == "video":
        url = safe_url(op.get("url"))
        if not url:
            return ""
        return (f'<figure class="tb-video"{attrs} data-src="{esc(url)}" data-start="{esc(op.get("start") or "")}" '
                f'data-end="{esc(op.get("end") or "")}" data-muted="{str(bool(op.get("muted", True))).lower()}">'
                f'<figcaption>{esc(op.get("description"))}</figcaption></figure>')
    if kind == "media_task":
        url = safe_url(op.get("url")) or ""
        return (f'<div class="tb-media-task"{attrs} data-kind="{esc(op.get("kind"))}" data-src="{esc(url)}" '
                f'data-file-id="{esc(op.get("file_id") or "")}"><p>{esc(op.get("description"))}</p></div>')
    if kind == "table":
        rows = op.get("rows", [])
        if not rows:
            return ""
        head = "".join(f"<th>{esc(c)}</th>" for c in rows[0])
        body = "".join("<tr>" + "".join(f"<td>{esc(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
        return f'<table class="tb-table"{attrs}><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'
    if kind == "callout":
        return f'<aside class="tb-callout tb-callout-{esc(op.get("kind") or "tip")}"{attrs}>{esc(op.get("text"))}</aside>'
    if kind == "annotate":
        return (f'<span class="tb-annotation tb-annotation-{esc(op.get("position") or "right")}"{attrs} '
                f'data-target="{esc(op.get("target"))}">{esc(op.get("text"))}</span>')
    if kind == "arrow":
        return (f'<span class="tb-arrow"{attrs} data-from="{esc(op.get("from"))}" data-to="{esc(op.get("to"))}">'
                f'{esc(op.get("text") or "")}</span>')
    if kind == "columns":
        cols = [c for c in (op.get("columns") or []) if isinstance(c, list)]
        inner = "".join(
            '<div class="tb-col">' + "".join(_render_op(child) for child in col if isinstance(child, dict)) + "</div>"
            for col in cols
        )
        return f'<div class="tb-columns tb-columns-{len(cols)}"{attrs}>{inner}</div>'
    # highlight / unhighlight / reveal / clear leave no mark on the board
    return ""


def materialize(ops: Iterable[Dict[str, Any]]) -> str:
    """Cumulative HTML for a list of ops (a topic's ops up to some concept)."""
    parts = [_render_op(op) for op in ops]
    return '<div class="tutor-board">' + "".join(p for p in parts if p) + "</div>"


def clean_ops(ops: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Sanitized copies fit for storage and for the learner app: SVG bodies
    replaced by their sanitized form (ops whose SVG has nothing safe left are
    dropped), image/video/media_task urls kept only when https."""
    out: List[Dict[str, Any]] = []
    for op in ops:
        op = dict(op)
        kind = op.get("op")
        if kind == "svg":
            cleaned = sanitize_svg(op.get("svg", ""))
            if not cleaned:
                continue
            op["svg"] = cleaned
            present = svg_ids(cleaned) | svg_ids(op.get("svg", ""))
            op["parts"] = [p for p in (op.get("parts") or []) if isinstance(p, dict) and p.get("id") in present]
        elif kind in ("image", "video"):
            url = safe_url(op.get("url"))
            if op.get("url") and not url:
                continue
            op["url"] = url
        elif kind == "media_task":
            op["url"] = safe_url(op.get("url"))
            if not (op["url"] or op.get("file_id")):
                continue
        elif kind == "columns":
            op["columns"] = [clean_ops([c for c in (col or []) if isinstance(c, dict)]) for col in (op.get("columns") or [])]
            if not any(op["columns"]):
                continue
        out.append(op)
    return out


def ops_to_dicts(ops: Sequence[Any]) -> List[Dict[str, Any]]:
    """Pydantic ops (or dicts) -> plain dicts using the wire names ('from')."""
    out: List[Dict[str, Any]] = []
    for op in ops:
        if hasattr(op, "model_dump"):
            out.append(op.model_dump(by_alias=True, exclude_none=True))
        else:
            out.append(dict(op))
    return out
