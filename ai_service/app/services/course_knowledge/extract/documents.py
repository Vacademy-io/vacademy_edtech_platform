"""Document lessons that need no paid work: HTML bodies, code, external
projects (Jupyter / Scratch), and Excalidraw drawings (PRESENTATION).

The inline builders are pure (describe.py calls them while it reads the
lesson rows). The drawing fetch and the bounded HTTPS GET used by the deck
and SCORM extractors live here too; neither ever runs with a DB session open.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import httpx

from ...tutor.slide_source import html_to_text
from .types import Extraction, Segment, SlideRef

logger = logging.getLogger(__name__)

MAX_DRAWING_BYTES = 5 * 1024 * 1024
EXTERNAL_PROJECT_NOTE = "External project: only the title is used"
_HEADING_RE = re.compile(r"<h[1-6][^>]*>(.*?)</h[1-6]>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r"<[^>]+>")


# ── inline builders ──────────────────────────────────────────────────────────

def first_heading(html_body: str) -> Optional[str]:
    m = _HEADING_RE.search(html_body or "")
    if not m:
        return None
    label = re.sub(r"\s+", " ", _TAG_RE.sub(" ", m.group(1))).strip()
    return label[:200] or None


def html_segments(html_body: str) -> List[Segment]:
    """One segment for an inline HTML / DOC body, labelled with its first heading."""
    body = html_to_text(html_body or "")
    if not body:
        return []
    return [Segment(text=body, anchor="none", label=first_heading(html_body))]


def _json_obj(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(raw or "")
    except Exception:  # noqa: BLE001
        return None
    return data if isinstance(data, dict) else None


def code_segments(raw: Optional[str]) -> List[Segment]:
    """A CODE lesson (or a video's embedded CODE) stores {language, code, …}."""
    data = _json_obj(raw)
    if data is None:
        code = (raw or "").strip()
        return [Segment(text=code[:40_000], label="Code")] if code else []
    code = str(data.get("code") or "").strip()
    if not code:
        return []
    language = str(data.get("language") or "").strip()
    head = f"Code ({language})" if language else "Code"
    return [Segment(text=f"{head}:\n{code}"[:40_000], label=head)]


def project_segments(raw: Optional[str], doc_type: str) -> List[Segment]:
    """JUPYTER / SCRATCH: only the project's name is readable."""
    data = _json_obj(raw) or {}
    name = str(data.get("projectName") or "").strip()
    if not name:
        return []
    kind = "Jupyter notebook" if doc_type == "JUPYTER" else "Scratch project"
    return [Segment(text=f"{kind}: {name}", label=kind)]


def drawing_segments(scene: Any) -> List[Segment]:
    """Excalidraw text elements in reading order (top to bottom, then left to right)."""
    elements = scene.get("elements") if isinstance(scene, dict) else None
    if not isinstance(elements, list):
        return []
    items: List[Tuple[float, float, str]] = []
    for el in elements:
        if not isinstance(el, dict) or el.get("type") != "text" or el.get("isDeleted"):
            continue
        body = str(el.get("text") or el.get("originalText") or "").strip()
        if not body:
            continue
        try:
            y, x = float(el.get("y") or 0.0), float(el.get("x") or 0.0)
        except (TypeError, ValueError):
            y, x = 0.0, 0.0
        items.append((y, x, body))
    items.sort(key=lambda t: (t[0], t[1]))
    return [Segment(text=body, anchor="element", label=None) for _y, _x, body in items]


# ── bounded HTTPS fetch ──────────────────────────────────────────────────────

async def fetch_https(url: str, *, max_bytes: int, timeout: float = 10.0,
                      allow_prefix: Optional[str] = None) -> Optional[bytes]:
    """GET an https URL with a byte cap and NO redirects (a redirect could
    leave the allowed host). With allow_prefix, the URL must share its scheme,
    host and path prefix. Returns None when refused, too large or not 200."""
    parts = urlsplit(url or "")
    if parts.scheme != "https" or not parts.netloc:
        return None
    if allow_prefix is not None and not within_prefix(url, allow_prefix):
        return None
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        async with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                return None
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    return None
            return bytes(buf)


def within_prefix(url: str, prefix: str) -> bool:
    """Same scheme (https), same host and port, path under the prefix's path."""
    a, b = urlsplit(url or ""), urlsplit(prefix or "")
    if a.scheme != "https" or b.scheme != "https":
        return False
    if a.netloc.lower() != b.netloc.lower():
        return False
    base_path = b.path if b.path.endswith("/") else b.path + "/"
    path = a.path
    if "/../" in path + "/" or "/./" in path + "/" or "%2e" in path.lower() or "\\" in path:
        return False
    return path.startswith(base_path)


# ── Excalidraw (PRESENTATION) ────────────────────────────────────────────────

async def extract_drawing(ref: SlideRef) -> Extraction:
    """A drawing stored as a media file: public URL, 5 MB cap, text elements."""
    from ...media_file_client import get_public_file_url
    from ...tutor import source_text

    url = await get_public_file_url(ref.pointer_key or "")
    if not url:
        return Extraction(ref.slide_id, "drawing", status="FAILED", note="The drawing file could not be resolved")
    data = await source_text._download(url, max_bytes=MAX_DRAWING_BYTES, timeout=30.0)
    if data is None:
        return Extraction(ref.slide_id, "drawing", status="UNSUPPORTED", note="The drawing is larger than 5 MB")
    try:
        scene = json.loads(data.decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001
        return Extraction(ref.slide_id, "drawing", status="UNSUPPORTED", note="The drawing file is not readable")
    segs = drawing_segments(scene)
    return Extraction(ref.slide_id, "drawing", segments=segs, status="READY" if segs else "EMPTY",
                      note=None if segs else "The drawing has no text")


__all__ = [
    "first_heading", "html_segments", "code_segments", "project_segments", "drawing_segments",
    "fetch_https", "within_prefix", "extract_drawing", "EXTERNAL_PROJECT_NOTE", "MAX_DRAWING_BYTES",
]
