"""
Byte-level work for website_edit(import_image): what an imported file IS,
whether it is safe to host, and what we actually store.

Pure functions (no network, no S3) so they are testable on their own:

  * sniff_image_type   — the type from the bytes, not the sender's header
                         (Figma's asset links are served as octet-stream);
  * sanitize_svg_document — an SVG we will serve from our CDN must not carry
                         script, event handlers, foreignObject or external
                         references (opened directly, an SVG is a document);
  * prepare_image      — anything over the keep-as-is limit or wider than
                         2400 px is downscaled to WebP; a normal image is
                         stored exactly as sent (the behaviour before this).
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import math
import re
import threading
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any, Optional, Tuple

#: Largest download / upload we read at all.
MAX_SOURCE_BYTES = 25_000_000
#: Images up to this size AND edge are stored byte-for-byte (the old 6 MB cap).
KEEP_ORIGINAL_MAX_BYTES = 6_000_000
#: Longest edge we store; bigger rasters are downscaled to WebP.
MAX_EDGE_PX = 2400
#: Decoded pixel budget for an image we must SHRINK (a 25 MB PNG — or a 30 KB
#: flat one — can claim 50k x 50k; refuse before decoding). 32 MP is a 4x
#: export of a 1440 x 1400 frame; at 4 bytes/px that is ~128 MB while decoding.
MAX_PIXELS = 32_000_000
#: Shrinks running at once in this process (each holds one decoded source).
DECODE_SLOTS = 1
#: base64 input is meant for a local file or a design-tool export, not a bulk upload.
MAX_BASE64_BYTES = 10_000_000
#: SVGs are text; anything bigger than this is not an icon or illustration.
MAX_SVG_BYTES = 5_000_000
WEBP_QUALITY = 82

EXT_BY_TYPE = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
}


class ImageImportError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class PreparedImage:
    data: bytes
    content_type: str
    ext: str
    width: Optional[int]
    height: Optional[int]
    original_bytes: int
    sha256: str          # of the ORIGINAL bytes — the stable id of the source asset
    resized: bool


_SVG_HEAD_RE = re.compile(rb"^\s*(?:<\?xml[^>]*>\s*)?(?:<!--.*?-->\s*)*<svg[\s>]", re.S | re.I)


def sniff_image_type(raw: bytes) -> Optional[str]:
    head = raw[:16]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if head[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    text_head = raw[:2048].lstrip(b"\xef\xbb\xbf")
    if _SVG_HEAD_RE.match(text_head) or (b"<svg" in text_head[:2048] and text_head.lstrip().startswith(b"<")):
        return "image/svg+xml"
    return None


def decode_base64_image(data: str) -> bytes:
    """`data` is raw base64 or a data: URL. Size-capped before decoding."""
    s = (data or "").strip()
    if s.startswith("data:"):
        _, _, s = s.partition(",")
    s = re.sub(r"\s+", "", s)
    if not s:
        raise ImageImportError("bad_request", "data_base64 is empty.")
    if len(s) * 3 // 4 > MAX_BASE64_BYTES:
        raise ImageImportError("too_large", f"base64 images are limited to {MAX_BASE64_BYTES // 1_000_000} MB.")
    try:
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise ImageImportError("bad_request", "data_base64 is not valid base64.") from None


# ── SVG ─────────────────────────────────────────────────────────────────────
_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
ET.register_namespace("", _SVG_NS)
ET.register_namespace("xlink", _XLINK_NS)

_DROP_ELEMENTS = {"script", "foreignobject", "iframe", "object", "embed", "handler", "listener", "audio", "video"}
# Attributes that load or navigate somewhere on some element (HTML img/meta/
# form/object…). Inert on SVG elements, but never needed there either.
_URL_ATTRS = {"src", "srcset", "action", "formaction", "data", "content", "poster", "ping", "background", "codebase"}
_ANIMATION_ELEMENTS = {"set", "animate", "animatetransform", "animatemotion", "animatecolor"}
_SAFE_DATA_IMAGE_RE = re.compile(r"^data:image/(png|jpeg|jpg|gif|webp);base64,", re.I)
_CTRL_WS_RE = re.compile(r"[\x00-\x20]+")
_DANGEROUS_VALUE_RE = re.compile(r"(javascript:|vbscript:|data:text/html|expression\s*\()", re.I)
# url(...) that is not a same-document reference (#id), and the CSS functions
# that load a bare string with no url() at all.
_EXTERNAL_URL_RE = re.compile(r"url\s*\(\s*['\"]?\s*(?!#)", re.I)
_CSS_LOADER_RE = re.compile(r"(?:image-set|src)\s*\(|@import", re.I)
_CSS_ESCAPE_RE = re.compile(r"\\(?:([0-9a-fA-F]{1,6})[ \t\r\n\f]?|(.))", re.S)
_CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.S)
# A DOCTYPE with no internal subset (older Illustrator / Inkscape exports name
# the SVG 1.1 DTD); the parser never fetches it, so it is simply removed.
_PLAIN_DOCTYPE_RE = re.compile(r"<!DOCTYPE[^>\[]*>", re.I)


def _css_unescape(css: str) -> str:
    """CSS text as the browser reads it: escapes decoded (\\75rl( is url(),
    comments removed — so the filters below see what would actually run."""
    def one(m: "re.Match[str]") -> str:
        if m.group(1):
            try:
                return chr(int(m.group(1), 16))
            except (ValueError, OverflowError):
                return "\ufffd"
        return m.group(2)
    return _CSS_COMMENT_RE.sub("", _CSS_ESCAPE_RE.sub(one, css))


def _css_is_unsafe(css: str) -> bool:
    text = _css_unescape(css)
    return bool(_EXTERNAL_URL_RE.search(text) or _CSS_LOADER_RE.search(text) or _DANGEROUS_VALUE_RE.search(text))


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _ns(tag: str) -> str:
    return tag[1:].split("}", 1)[0] if isinstance(tag, str) and tag.startswith("{") else ""


def _href_ok(value: str) -> bool:
    v = _CTRL_WS_RE.sub("", value or "")
    return v.startswith("#") or bool(_SAFE_DATA_IMAGE_RE.match(v))


#: Deepest element nesting accepted in an SVG (real exports stay well under 50).
MAX_SVG_DEPTH = 256


def sanitize_svg_document(raw: bytes) -> bytes:
    """A safe, standalone SVG document, or ImageImportError.

    Deny-by-construction for the dangerous parts and keep everything else, so
    Figma exports (gradients, masks, filters, embedded PNG patterns) survive:
    no DTD/entities at all (billion-laughs / XXE; a plain public DOCTYPE is
    removed), only elements in the SVG namespace (an XHTML <img>/<meta> inside
    an SVG is a tracker / redirect when the file is opened directly), no
    script / foreignObject / embedded documents, no on* handlers, no href or
    src-like attribute that leaves the document (only #id or a data:image
    raster), no url(...) / image-set / @import to anything external in
    attributes or <style> (CSS escapes decoded first), no animation that
    rewrites an href."""
    if len(raw) > MAX_SVG_BYTES:
        raise ImageImportError("too_large", f"SVGs are limited to {MAX_SVG_BYTES // 1_000_000} MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ImageImportError("not_an_image", "The SVG is not UTF-8 text.") from None
    if re.search(r"<!ENTITY", text, re.I):
        raise ImageImportError("not_an_image", "SVGs with a DOCTYPE or entities are not accepted.")
    text = _PLAIN_DOCTYPE_RE.sub("", text, count=1)
    if re.search(r"<!DOCTYPE", text, re.I):  # an internal subset, or a second DOCTYPE
        raise ImageImportError("not_an_image", "SVGs with a DOCTYPE or entities are not accepted.")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise ImageImportError("not_an_image", "The SVG could not be parsed.") from None
    if _local(root.tag) != "svg" or _ns(root.tag) not in ("", _SVG_NS):
        raise ImageImportError("not_an_image", "The file is not an SVG image.")
    # Scrubbing and serialising recurse once per level: refuse absurd nesting up
    # front (measured iteratively) instead of hitting RecursionError mid-batch.
    stack = [(root, 1)]
    while stack:
        el, depth = stack.pop()
        if depth > MAX_SVG_DEPTH:
            raise ImageImportError("not_an_image", "The SVG is nested too deeply.")
        stack.extend((child, depth + 1) for child in el)
    # Children must share the root's namespace: SVG, or none on an SVG with no
    # xmlns (it gets the SVG namespace below).
    svg_ns = _ns(root.tag)

    def scrub(node: ET.Element) -> None:
        for child in list(node):
            name = _local(child.tag)
            if not name:  # comments / processing instructions
                node.remove(child)
                continue
            if _ns(child.tag) != svg_ns or name in _DROP_ELEMENTS:
                node.remove(child)
                continue
            if name in _ANIMATION_ELEMENTS:
                target = (child.get("attributeName") or "").lower()
                if "href" in target or name == "set" or _DANGEROUS_VALUE_RE.search(" ".join(child.attrib.values())):
                    node.remove(child)
                    continue
            if name == "style":
                if _css_is_unsafe("".join(child.itertext())):
                    node.remove(child)
                    continue
            scrub_attrs(child)
            scrub(child)

    def scrub_attrs(el: ET.Element) -> None:
        for attr in list(el.attrib):
            local = _local(attr)
            value = el.attrib[attr]
            if local.startswith("on"):
                del el.attrib[attr]
            elif local == "href" or local in _URL_ATTRS:
                if not _href_ok(value):
                    del el.attrib[attr]
            elif _DANGEROUS_VALUE_RE.search(_CTRL_WS_RE.sub("", value)):
                del el.attrib[attr]
            elif _css_is_unsafe(value):
                del el.attrib[attr]

    scrub_attrs(root)
    scrub(root)
    if root.tag == "svg":
        # No xmlns: a browser opening it as image/svg+xml would render nothing.
        root.set("xmlns", _SVG_NS)
    out = ET.tostring(root, encoding="utf-8", xml_declaration=False)
    return out


def _svg_size(svg: bytes) -> Tuple[Optional[int], Optional[int]]:
    try:
        root = ET.fromstring(svg)
    except ET.ParseError:
        return None, None

    def num(v: Optional[str]) -> Optional[int]:
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$", v or "")
        return int(float(m.group(1))) if m else None

    w, h = num(root.get("width")), num(root.get("height"))
    if (w is None or h is None) and root.get("viewBox"):
        parts = re.split(r"[\s,]+", root.get("viewBox").strip())
        if len(parts) == 4:
            try:
                w, h = int(float(parts[2])), int(float(parts[3]))
            except ValueError:
                pass
    return w, h


# ── Raster ──────────────────────────────────────────────────────────────────
#: Held while a source is decoded and shrunk (a worker thread, via to_thread):
#: bounds this process to DECODE_SLOTS decoded sources at once, whatever the
#: number of concurrent import requests.
_DECODE_SLOTS = threading.BoundedSemaphore(DECODE_SLOTS)
#: Pixels converted at once while shrinking (one horizontal band).
_BAND_PIXELS = 2_000_000


def prepare_image(raw: bytes, declared_type: str = "") -> PreparedImage:
    """Validate and (when needed) shrink one image. Raises ImageImportError."""
    if not raw:
        raise ImageImportError("not_an_image", "The file is empty.")
    if len(raw) > MAX_SOURCE_BYTES:
        raise ImageImportError("too_large", f"Images over {MAX_SOURCE_BYTES // 1_000_000} MB cannot be imported.")
    digest = hashlib.sha256(raw).hexdigest()
    ctype = sniff_image_type(raw)
    if ctype is None:
        shown = (declared_type or "unknown").split(";")[0].strip()
        raise ImageImportError("not_an_image", f"Unsupported content type '{shown}'.")

    if ctype == "image/svg+xml":
        clean = sanitize_svg_document(raw)
        w, h = _svg_size(clean)
        return PreparedImage(clean, ctype, "svg", w, h, len(raw), digest, resized=False)

    try:
        from PIL import Image
    except ImportError:  # pragma: no cover — Pillow ships with moviepy
        if len(raw) > KEEP_ORIGINAL_MAX_BYTES:
            raise ImageImportError("too_large", "Images over 6 MB cannot be imported.") from None
        return PreparedImage(raw, ctype, EXT_BY_TYPE[ctype], None, None, len(raw), digest, resized=False)

    try:
        img = Image.open(io.BytesIO(raw))  # header only — no pixels decoded yet
        width, height = img.size
    except Image.DecompressionBombError:
        raise ImageImportError("too_large", "The image has too many pixels to import.") from None
    except Exception:  # noqa: BLE001 — a header that lies about being an image
        raise ImageImportError("not_an_image", "The file could not be read as an image.") from None

    needs_shrink = len(raw) > KEEP_ORIGINAL_MAX_BYTES or max(width, height) > MAX_EDGE_PX
    if needs_shrink and getattr(img, "is_animated", False):
        # Re-encoding would keep only the first frame. Up to the old 6 MB cap an
        # animation is stored as sent (as before); bigger ones are refused.
        if len(raw) > KEEP_ORIGINAL_MAX_BYTES:
            raise ImageImportError("too_large", "Animated images must be at most 6 MB.")
        needs_shrink = False
    if not needs_shrink:
        try:
            img.verify()  # truncated / corrupt files fail here, before they reach a page
        except Exception:  # noqa: BLE001
            raise ImageImportError("not_an_image", "The image file is damaged.") from None
        return PreparedImage(raw, ctype, EXT_BY_TYPE[ctype], width, height, len(raw), digest, resized=False)

    with _DECODE_SLOTS:
        try:
            out = _shrink(img, Image)
            buf = io.BytesIO()
            out.save(buf, format="WEBP", quality=WEBP_QUALITY, method=4)
        except ImageImportError:
            raise
        except Exception:  # noqa: BLE001
            raise ImageImportError("not_an_image", "The image could not be converted.") from None
        finally:
            img.close()
    return PreparedImage(buf.getvalue(), "image/webp", "webp", out.size[0], out.size[1], len(raw), digest, resized=True)


def _shrink(img: Any, Image: Any) -> Any:
    """`img` (opened, not loaded) downscaled to fit MAX_EDGE_PX, upright.

    Memory is the decoded source plus one band plus the small result: a JPEG
    is decoded at a reduced scale (draft), and the colour conversion and the
    LANCZOS resize run one horizontal band at a time. (convert() then
    thumbnail() on a whole 9000 px palette PNG allocated two more full-size
    RGBA copies — ~650 MB — on top of the decode.) Each band is cropped with
    the filter's reach as margin and resized through `box`, so the result is
    the same pixels as one whole-image resize: no seams."""
    try:
        orientation = int(img.getexif().get(0x0112) or 1)
    except Exception:  # noqa: BLE001 — unreadable EXIF = no rotation
        orientation = 1
    w, h = img.size
    if img.format == "JPEG":
        scale = MAX_EDGE_PX / max(w, h)
        img.draft(None, (max(1, math.ceil(w * scale)), max(1, math.ceil(h * scale))))
        w, h = img.size
    if w * h > MAX_PIXELS:
        raise ImageImportError("too_large", "The image has too many pixels to import.")

    out_mode = "RGBA" if ("A" in img.mode or "transparency" in img.info) else "RGB"
    scale = min(1.0, MAX_EDGE_PX / max(w, h))
    tw, th = max(1, round(w * scale)), max(1, round(h * scale))
    step = h / th                      # source rows per output row
    reach = 3 * max(step, 1.0) + 2     # LANCZOS support (3) in source rows, plus rounding
    rows = max(1, int(_BAND_PIXELS / w / step))
    img.load()
    small = Image.new(out_mode, (tw, th))
    for top in range(0, th, rows):
        bottom = min(th, top + rows)
        y0, y1 = top * step, bottom * step
        c0, c1 = max(0, math.floor(y0 - reach)), min(h, math.ceil(y1 + reach))
        tile = img.crop((0, c0, w, c1)).convert(out_mode)
        part = tile.resize((tw, bottom - top), Image.LANCZOS, box=(0, y0 - c0, w, y1 - c0))
        small.paste(part, (0, top))
        del tile, part
    transpose = _EXIF_TRANSPOSE.get(orientation)
    if transpose is not None:
        small = small.transpose(getattr(Image.Transpose, transpose))
    return small


# ImageOps.exif_transpose's table (the EXIF is gone once the image is cropped).
_EXIF_TRANSPOSE = {
    2: "FLIP_LEFT_RIGHT", 3: "ROTATE_180", 4: "FLIP_TOP_BOTTOM", 5: "TRANSPOSE",
    6: "ROTATE_270", 7: "TRANSVERSE", 8: "ROTATE_90",
}
