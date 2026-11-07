"""
Section-by-section comparison of a rendered page against a design image.

``website(action='compare')`` renders the DRAFT page with ``page_preview``
(full height, one box per top-level ``[data-cid]`` section, each with its
text) and hands that render, plus a reference image of the design (a Figma
frame export the admin or the AI imported as an institute asset), to
``compare_page``. The answer is structured, so a model can act on it:

    {overall, sections: [{section_id, ssim, height_ratio, color_delta,
     missing_text[], extra_text[], hints[{prop_path, suggestion}]}],
     missing_sections[], extra_sections[]}

Pure functions over decoded images (numpy / opencv, both already in
requirements.txt); nothing here touches the network, the database or the
model. The tool layer decides where the reference bytes may come from (only
the institute's own media; never an arbitrary URL).

How sections are paired. The two pages rarely have the same height (live
course lists, real copy, different fonts), so pairing by y would drift after
the first section. Instead every pixel row of both images becomes a small
colour signature and a monotone alignment (dynamic programming, cheap to skip
a few rows, dearer to skip many) maps each rendered row to a design row. A
rendered section's box then maps to a design interval; design sections that
no rendered section covers are *missing*, rendered sections that map onto
(almost) nothing are *extra*. The design's own section boxes (Figma frame
children, in frame units) can be passed; without them the design image is cut
into bands where its background colour changes.

The pass thresholds are provisional until the Brahm Varchas eval sets them.
"""
from __future__ import annotations

import asyncio
import math
import struct
import unicodedata
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

#: Largest reference file accepted (a 1440 × 16000 PNG export is ~10 MB).
MAX_IMAGE_BYTES = 25 * 1024 * 1024
#: Decoded size guards, checked from the file header BEFORE decoding. At most
#: MAX_IMAGE_PIXELS are ever held (75 MB as BGR); a larger image, up to
#: MAX_SOURCE_PIXELS (a 2880 × 16000 Figma @2x export is 46M), is decoded
#: colour-only and reduced while decoding. Alpha is kept only while the
#: decoded image with it fits _ALPHA_DECODE_BYTES; it is composited a band of
#: rows at a time, never as whole-image float copies.
MAX_IMAGE_PIXELS = 25_000_000
MAX_SOURCE_PIXELS = 50_000_000
MAX_IMAGE_SIDE = 40_000
_ALPHA_DECODE_BYTES = 100 * 1024 * 1024
_COMPOSITE_ROWS = 256
#: Tallest design compared, at the comparison width (twice the tallest render).
MAX_STITCHED_HEIGHT = 32_000
#: The page's own capture: at most 1920 wide × 16000 tall (page_preview's limits).
MAX_RENDER_PIXELS = 1920 * 16_000
#: Decoding plus comparing holds a few hundred MB at most; one at a time per
#: process (the caller acquires it around the worker thread).
COMPARE_SLOTS = asyncio.Semaphore(1)

#: Provisional pass bar (§3.7 of the plan): every paired section at least this
#: similar, and no design section missing.
SECTION_SSIM_BAR = 0.80

# Alignment costs, in units of "mean ΔE76 per column bin / 10" (a matching
# row costs ~0.1–0.4, an unrelated one 2–3).
_STAY_COST = 0.25        # a rendered row maps to the same design row as the previous one
_SKIP_ONE_COST = 0.05    # one design row skipped (the render is up to 2× shorter here)
_SKIP_BASE_COST = 0.15   # a run of design rows skipped (a missing band) …
_SKIP_ROW_COST = 0.25    # … plus this per row skipped
_MAX_ROW_COST = 3.0
_FEATURE_COLUMNS = 16
_ALIGN_MAX_ROWS = 700

_BAND_TOLERANCE = 4.0    # ΔE76 between margin colours that starts a new band (cream vs white is ~6)
_BAND_MIN_HEIGHT = 40    # px at the comparison width

_SSIM_WIDTH = 256
_DOMINANT_MIN_SHARE = 0.30
_COLOR_HINT_DELTA = 10.0
_SHORT_RATIO = 0.80
_TALL_RATIO = 1.25
_LOW_SSIM = 0.45
_COVERED = 0.5
_EXTRA_MAPPED_SHARE = 0.15
_MAX_TEXTS = 12


class CompareError(ValueError):
    """A reference or render that cannot be compared; ``code`` is the tool error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


# ── images ──────────────────────────────────────────────────────────────
def image_size(data: bytes) -> Optional[Tuple[int, int]]:
    """(width, height) from a PNG / JPEG / WebP header, without decoding; None if unknown."""
    if len(data) >= 24 and data[:8] == b"\x89PNG\r\n\x1a\n":
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    if data[:2] == b"\xff\xd8":
        i, n = 2, len(data)
        while i + 9 < n:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker == 0xFF:
                i += 1
                continue
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return int(w), int(h)
            i += 2 + seg
        return None
    if len(data) >= 30 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if chunk == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def image_info(data: bytes) -> Optional[Dict[str, Any]]:
    """{width, height, alpha, depth} from a PNG / JPEG / WebP header, without decoding; None if unknown.

    ``alpha`` is whether the file can carry transparency (PNG colour types 4 / 6
    or a tRNS chunk, WebP's alpha flag); ``depth`` is bits per sample (16 for a
    16-bit PNG, else 8).
    """
    size = image_size(data)
    if size is None:
        return None
    alpha, depth = False, 8
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 26:
        depth, colour_type = data[24], data[25]
        alpha = colour_type in (4, 6)
        i = 8
        # tRNS sits before the first IDAT; walk chunk headers only.
        while not alpha and i + 8 <= len(data):
            length = struct.unpack(">I", data[i:i + 4])[0]
            kind = data[i + 4:i + 8]
            if kind in (b"IDAT", b"IEND"):
                break
            alpha = kind == b"tRNS"
            i += 12 + length
    elif data[:4] == b"RIFF" and len(data) >= 30:
        chunk = data[12:16]
        alpha = (chunk == b"VP8X" and bool(data[20] & 0x10)) or (
            chunk == b"VP8L" and bool((int.from_bytes(data[21:25], "little") >> 28) & 1))
    return {"width": size[0], "height": size[1], "alpha": alpha, "depth": 16 if depth == 16 else 8}


def _checked_info(data: bytes, max_pixels: int) -> Dict[str, Any]:
    if not data:
        raise CompareError("bad_image", "The image is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise CompareError("too_large", f"Images over {MAX_IMAGE_BYTES // (1024 * 1024)} MB cannot be compared.")
    info = image_info(data)
    if info is None:
        raise CompareError("bad_image", "Only PNG, JPEG or WebP images can be compared.")
    w, h = info["width"], info["height"]
    if w <= 0 or h <= 0 or w > MAX_IMAGE_SIDE or h > MAX_IMAGE_SIDE or w * h > max(max_pixels, MAX_SOURCE_PIXELS):
        raise CompareError("too_large", f"The image is {w}×{h}; that is too large to compare. Export it at 1x, "
                                        "or in pieces passed as reference.tiles.")
    return info


def _reduction(w: int, h: int, target_width: Optional[int], max_pixels: int) -> int:
    """The decode-time reduction (1, 2, 4 or 8): enough to fit ``max_pixels``, and as much as
    ``target_width`` allows (never below it), so a 2x export is never held at full size."""
    k = 1
    while k < 8 and (w // k) * (h // k) > max_pixels:
        k *= 2
    if (w // k) * (h // k) > max_pixels:
        raise CompareError("too_large", f"The image is {w}×{h}; that is too large to compare. Export it at 1x, "
                                        "or in pieces passed as reference.tiles.")
    if target_width:
        while k < 8 and w // (k * 2) >= target_width:
            k *= 2
    return k


def _over_white(img: np.ndarray) -> np.ndarray:
    """Composite a uint8 BGRA (or grey + alpha) image onto white, a band of rows at a time
    (no whole-image float copies)."""
    if img.shape[2] == 2:
        colour, alpha = cv2.cvtColor(img[:, :, 0], cv2.COLOR_GRAY2BGR), img[:, :, 1]
    else:
        colour, alpha = img[:, :, :3], img[:, :, 3]
    if int(alpha.min()) == 255:
        return np.ascontiguousarray(colour)
    out = np.empty(colour.shape, dtype=np.uint8)
    for top in range(0, colour.shape[0], _COMPOSITE_ROWS):
        a = alpha[top:top + _COMPOSITE_ROWS, :, None].astype(np.float32) * (1.0 / 255.0)
        part = colour[top:top + _COMPOSITE_ROWS].astype(np.float32)
        out[top:top + _COMPOSITE_ROWS] = np.rint(part * a + 255.0 * (1.0 - a)).astype(np.uint8)
    return out


def decode_image(data: bytes, *, target_width: Optional[int] = None,
                 max_pixels: int = MAX_IMAGE_PIXELS) -> np.ndarray:
    """BGR uint8 image; transparent areas are composited onto white.

    Memory is bounded from the header before anything is decoded: at most
    ``max_pixels`` are kept (a larger image up to ``MAX_SOURCE_PIXELS`` is
    decoded colour-only and reduced 2/4/8x), 16-bit samples become 8-bit, and
    with ``target_width`` the image comes back no wider than that.
    """
    info = _checked_info(data, max_pixels)
    w, h = info["width"], info["height"]
    k = _reduction(w, h, target_width, max_pixels)
    buf = np.frombuffer(data, dtype=np.uint8)
    bytes_with_alpha = w * h * 4 * (2 if info["depth"] == 16 else 1)
    if info["alpha"] and bytes_with_alpha <= _ALPHA_DECODE_BYTES:
        img = cv2.imdecode(buf, cv2.IMREAD_UNCHANGED)
        if img is not None:
            if img.dtype != np.uint8:
                img = cv2.convertScaleAbs(img, alpha=1.0 / 257.0)
            if img.ndim == 2:
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            elif img.shape[2] in (2, 4):
                img = _over_white(img)
    else:
        # No transparency to keep, or too large to hold with it (a 2x Figma
        # export is RGBA but opaque): colour only, reduced while decoding.
        flag = {1: cv2.IMREAD_COLOR, 2: cv2.IMREAD_REDUCED_COLOR_2,
                4: cv2.IMREAD_REDUCED_COLOR_4, 8: cv2.IMREAD_REDUCED_COLOR_8}[k]
        img = cv2.imdecode(buf, flag)
    if img is None:
        raise CompareError("bad_image", "The image could not be decoded.")
    if target_width and img.shape[1] > target_width:
        img = resize_to_width(img, target_width)
    return img


def resize_to_width(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w == width:
        return img
    height = max(1, int(round(h * width / w)))
    interp = cv2.INTER_AREA if width < w else cv2.INTER_LINEAR
    return cv2.resize(img, (width, height), interpolation=interp)


def check_reference(blobs: Sequence[bytes], width: int) -> None:
    """Refuse a reference before anything is rendered or decoded: each tile must be a PNG /
    JPEG / WebP within the size limits, and the tiles stitched at ``width`` at most
    ``MAX_STITCHED_HEIGHT`` tall (so twelve copies of a tall export cannot add up)."""
    if not blobs:
        raise CompareError("bad_image", "No image to compare.")
    total = 0
    for data in blobs:
        info = _checked_info(data, MAX_IMAGE_PIXELS)
        _reduction(info["width"], info["height"], width, MAX_IMAGE_PIXELS)
        total += int(round(info["height"] * width / float(info["width"])))
    if total > MAX_STITCHED_HEIGHT:
        raise CompareError("too_large", f"The design is {total}px tall at {width}px wide; at most "
                                        f"{MAX_STITCHED_HEIGHT}px can be compared.")


def decode_reference(blobs: Sequence[bytes], width: int) -> np.ndarray:
    """The design: its tiles decoded one at a time, each straight to ``width``, stacked top to
    bottom into one preallocated image (``check_reference`` bounds its height)."""
    check_reference(blobs, width)
    if len(blobs) == 1:
        return resize_to_width(decode_image(blobs[0], target_width=width), width)
    infos = [image_info(b) for b in blobs]
    capacity = sum(int(round(i["height"] * width / float(i["width"]))) + 2 for i in infos)
    out = np.empty((capacity, width, 3), dtype=np.uint8)
    top = 0
    for data in blobs:
        tile = resize_to_width(decode_image(data, target_width=width), width)
        rows = min(tile.shape[0], capacity - top)
        out[top:top + rows] = tile[:rows]
        top += rows
        del tile
    return out[:top]


def stitch_vertical(images: Sequence[np.ndarray], width: Optional[int] = None) -> np.ndarray:
    """Tiles of one tall export, top to bottom, at ``width`` (default: the first tile's)."""
    if not images:
        raise CompareError("bad_image", "No image to compare.")
    width = width or images[0].shape[1]
    out = np.vstack([resize_to_width(i, width) for i in images])
    if out.shape[0] > MAX_STITCHED_HEIGHT:
        raise CompareError("too_large", f"The design is {out.shape[0]}px tall; at most {MAX_STITCHED_HEIGHT}px "
                                        "can be compared.")
    return out


def encode_jpeg(img: np.ndarray, quality: int = 80) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not ok:
        raise CompareError("encode_failed", "The image could not be encoded.")
    return buf.tobytes()


# ── colour ──────────────────────────────────────────────────────────────
def _lab(bgr: np.ndarray) -> np.ndarray:
    """CIE Lab (L 0–100) of a BGR uint8 array of any shape (…, 3)."""
    flat = bgr.reshape(-1, 1, 3).astype(np.float32) / 255.0
    return cv2.cvtColor(flat, cv2.COLOR_BGR2Lab).reshape(bgr.shape[:-1] + (3,))


def delta_e2000(lab1: Sequence[float], lab2: Sequence[float]) -> float:
    """CIEDE2000 colour difference (Sharma, Wu & Dalal 2005)."""
    L1, a1, b1 = (float(v) for v in lab1)
    L2, a2, b2 = (float(v) for v in lab2)
    c_bar = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2.0
    g = 0.5 * (1.0 - math.sqrt(c_bar ** 7 / (c_bar ** 7 + 25.0 ** 7))) if c_bar else 0.0
    a1p, a2p = (1.0 + g) * a1, (1.0 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360.0 if c1p else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360.0 if c2p else 0.0
    d_lp, d_cp = L2 - L1, c2p - c1p
    if c1p * c2p == 0:
        dh = 0.0
    else:
        dh = h2p - h1p
        if dh > 180.0:
            dh -= 360.0
        elif dh < -180.0:
            dh += 360.0
    d_hp = 2.0 * math.sqrt(c1p * c2p) * math.sin(math.radians(dh / 2.0))
    l_bar, c_bar_p = (L1 + L2) / 2.0, (c1p + c2p) / 2.0
    if c1p * c2p == 0:
        h_bar = h1p + h2p
    elif abs(h1p - h2p) > 180.0:
        h_bar = (h1p + h2p + 360.0) / 2.0 if h1p + h2p < 360.0 else (h1p + h2p - 360.0) / 2.0
    else:
        h_bar = (h1p + h2p) / 2.0
    t = (1.0 - 0.17 * math.cos(math.radians(h_bar - 30.0)) + 0.24 * math.cos(math.radians(2.0 * h_bar))
         + 0.32 * math.cos(math.radians(3.0 * h_bar + 6.0)) - 0.20 * math.cos(math.radians(4.0 * h_bar - 63.0)))
    d_theta = 30.0 * math.exp(-(((h_bar - 275.0) / 25.0) ** 2))
    r_c = 2.0 * math.sqrt(c_bar_p ** 7 / (c_bar_p ** 7 + 25.0 ** 7)) if c_bar_p else 0.0
    s_l = 1.0 + 0.015 * (l_bar - 50.0) ** 2 / math.sqrt(20.0 + (l_bar - 50.0) ** 2)
    s_c = 1.0 + 0.045 * c_bar_p
    s_h = 1.0 + 0.015 * c_bar_p * t
    r_t = -math.sin(math.radians(2.0 * d_theta)) * r_c
    return math.sqrt((d_lp / s_l) ** 2 + (d_cp / s_c) ** 2 + (d_hp / s_h) ** 2 + r_t * (d_cp / s_c) * (d_hp / s_h))


def dominant_color(img: np.ndarray) -> Dict[str, Any]:
    """The most common colour (4-bit-per-channel bins; nearest-neighbour downscale keeps real colours)."""
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return {"hex": None, "lab": (0.0, 0.0, 0.0), "share": 0.0}
    scale = min(1.0, 160.0 / w)
    small = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_NEAREST)
    px = small.reshape(-1, 3)
    q = (px >> 4).astype(np.int32)
    codes = (q[:, 0] << 8) | (q[:, 1] << 4) | q[:, 2]
    counts = np.bincount(codes, minlength=4096)
    mode = int(np.argmax(counts))
    mean_bgr = px[codes == mode].mean(axis=0)
    b, g, r = (int(round(v)) for v in mean_bgr)
    lab = _lab(np.array([[b, g, r]], dtype=np.uint8))[0]
    return {"hex": f"#{r:02x}{g:02x}{b:02x}", "lab": tuple(float(v) for v in lab),
            "share": round(float(counts[mode]) / float(len(codes)), 3)}


# ── structure ───────────────────────────────────────────────────────────
def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Mean SSIM (Wang et al. 2004, 11×11 Gaussian, σ 1.5) of two same-size greyscale images."""
    x, y = a.astype(np.float64), b.astype(np.float64)
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    blur = lambda m: cv2.GaussianBlur(m, (11, 11), 1.5)  # noqa: E731
    mu_x, mu_y = blur(x), blur(y)
    sxx = blur(x * x) - mu_x * mu_x
    syy = blur(y * y) - mu_y * mu_y
    sxy = blur(x * y) - mu_x * mu_y
    num = (2 * mu_x * mu_y + c1) * (2 * sxy + c2)
    den = (mu_x * mu_x + mu_y * mu_y + c1) * (sxx + syy + c2)
    return float(np.clip((num / den).mean(), -1.0, 1.0))


def crop_ssim(design: np.ndarray, page: np.ndarray) -> float:
    """SSIM of two crops of one section, both scaled to the design crop's shape at 256 px wide."""
    dh, dw = design.shape[:2]
    if dh == 0 or dw == 0 or page.shape[0] == 0 or page.shape[1] == 0:
        return 0.0
    height = int(min(1024, max(16, round(dh * _SSIM_WIDTH / dw))))
    to = lambda im: cv2.cvtColor(  # noqa: E731
        cv2.resize(im, (_SSIM_WIDTH, height), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    return ssim(to(design), to(page))


def segment_bands(img: np.ndarray, min_height: int = _BAND_MIN_HEIGHT,
                  tolerance: float = _BAND_TOLERANCE) -> List[Dict[str, Any]]:
    """Full-width bands of a page image, cut where the margin (background) colour changes."""
    h, w = img.shape[:2]
    margin = max(2, int(w * 0.03))
    edges = np.concatenate([img[:, :margin], img[:, w - margin:]], axis=1)
    rows = _lab(np.median(edges, axis=1).astype(np.uint8))           # (h, 3)
    jumps = np.linalg.norm(np.diff(rows, axis=0), axis=1) > tolerance
    starts = [0] + [int(i) + 1 for i in np.nonzero(jumps)[0]]
    runs = [[s, e] for s, e in zip(starts, starts[1:] + [h])]
    # Thin runs (a divider line, a photo's edge) belong to the band above.
    merged: List[List[int]] = []
    for run in runs:
        if merged and run[1] - run[0] < min_height:
            merged[-1][1] = run[1]
        else:
            merged.append(run)
    if len(merged) > 1 and merged[0][1] - merged[0][0] < min_height:
        merged[1][0] = 0
        merged.pop(0)
    # Neighbours of the same colour are one band.
    out: List[Dict[str, Any]] = []
    for s, e in merged:
        colour = rows[s:e].mean(axis=0)
        if out and float(np.linalg.norm(out[-1]["_lab"] - colour)) <= tolerance:
            prev = out[-1]
            prev["height"] = e - prev["top"]
            prev["_lab"] = rows[prev["top"]:e].mean(axis=0)
        else:
            out.append({"top": s, "height": e - s, "_lab": colour})
    return [{"name": f"band {i + 1}", "top": b["top"], "height": b["height"]} for i, b in enumerate(out)]


def _row_features(img: np.ndarray, pitch: int) -> np.ndarray:
    h = img.shape[0]
    n = max(1, h // pitch)
    small = cv2.resize(img[: n * pitch] if h >= pitch else img, (_FEATURE_COLUMNS, n), interpolation=cv2.INTER_AREA)
    return _lab(small).reshape(n, _FEATURE_COLUMNS * 3).astype(np.float32)


def _row_cost(row: np.ndarray, design: np.ndarray) -> np.ndarray:
    return np.minimum(np.abs(design - row).mean(axis=1) / 10.0, _MAX_ROW_COST)


def _skip_cost(k: np.ndarray) -> np.ndarray:
    k = np.asarray(k, dtype=np.float64)
    return np.where(k <= 0, 0.0, np.where(k == 1, _SKIP_ONE_COST, _SKIP_BASE_COST + _SKIP_ROW_COST * (k - 1)))


def align_rows(page: np.ndarray, design: np.ndarray, free_end: bool = False) -> Tuple[np.ndarray, np.ndarray]:
    """Monotone map of each page row → a design row, and each row's match cost.

    ``page`` and ``design`` are row-feature matrices. A step of one design row
    per page row is free; staying on a row, skipping one, or skipping a run
    cost more, so heights may differ while a whole missing band is jumped.
    ``free_end``: the page capture stops early, so leaving the design's last
    rows unmatched costs nothing.
    """
    n, m = len(page), len(design)
    jj = np.arange(m)
    back = np.zeros((n, m), dtype=np.int32)
    acc = _row_cost(page[0], design) + _skip_cost(jj)
    back[0] = -1
    inf = np.float64(1e18)
    for i in range(1, n):
        prev = acc
        cand = np.stack([
            prev + _STAY_COST,                                                       # j' = j
            np.concatenate([[inf], prev[:-1]]),                                      # j' = j-1
            np.concatenate([[inf, inf], prev[:-2] + _SKIP_ONE_COST])[:m],            # j' = j-2
        ])
        args = np.stack([jj, jj - 1, jj - 2])
        if m > 3:
            g = prev - _SKIP_ROW_COST * jj
            run_min = np.minimum.accumulate(g)
            run_arg = np.maximum.accumulate(np.where(g <= run_min, jj, 0))
            far = np.full(m, inf)
            far[3:] = _SKIP_BASE_COST + _SKIP_ROW_COST * (jj[3:] - 2) + run_min[:-3]
            far_arg = np.full(m, -1)
            far_arg[3:] = run_arg[:-3]
            cand = np.vstack([cand, far[None, :]])
            args = np.vstack([args, far_arg[None, :]])
        pick = np.argmin(cand, axis=0)
        acc = cand[pick, jj] + _row_cost(page[i], design)
        back[i] = args[pick, jj]
    end = int(np.argmin(acc if free_end else acc + _skip_cost(m - 1 - jj)))
    mapping = np.zeros(n, dtype=np.int64)
    mapping[-1] = end
    for i in range(n - 1, 0, -1):
        mapping[i - 1] = back[i, mapping[i]]
    costs = np.array([float(np.abs(design[mapping[i]] - page[i]).mean() / 10.0) for i in range(n)])
    return mapping, np.minimum(costs, _MAX_ROW_COST)


# ── text ────────────────────────────────────────────────────────────────
def normalize_text(value: Any) -> str:
    """Case-folded letters, marks and digits only (Devanagari kept), single-spaced."""
    s = unicodedata.normalize("NFKC", str(value or "")).casefold()
    return " ".join("".join(ch if unicodedata.category(ch)[0] in "LMN" else " " for ch in s).split())


def text_diff(design_texts: Iterable[str], page_text: str) -> Tuple[List[str], List[str]]:
    """(design texts the page lacks, page lines the design lacks), each capped."""
    page_norm = f" {normalize_text(page_text)} "
    wanted = [t for t in dict.fromkeys(str(t).strip() for t in design_texts) if t]
    missing = [t for t in wanted if normalize_text(t) and f" {normalize_text(t)} " not in page_norm]
    design_norm = " " + " ".join(normalize_text(t) for t in wanted) + " "
    extra: List[str] = []
    for line in dict.fromkeys(ln.strip() for ln in str(page_text or "").splitlines()):
        # Counts and prices are live data, never authored to match the design.
        norm = " ".join(tok for tok in normalize_text(line).split() if not tok.isdigit())
        if len(norm) < 3:
            continue
        if f" {norm} " not in design_norm:
            extra.append(line[:120])
    return missing[:_MAX_TEXTS], extra[:_MAX_TEXTS]


# ── hints ───────────────────────────────────────────────────────────────
def _is_label(text: str) -> bool:
    return 0 < len(text) <= 40 and len(text.split()) <= 5


def _button_set(btn: Any) -> bool:
    return isinstance(btn, dict) and btn.get("enabled", True) is not False and bool(str(btn.get("text") or "").strip())


def text_hints(component: Optional[Dict[str, Any]], missing_text: List[str]) -> List[Dict[str, Any]]:
    """Missing design text → the prop that would carry it, where the block type makes that clear."""
    hints: List[Dict[str, Any]] = []
    labels = [t for t in missing_text if _is_label(t)]
    props = (component or {}).get("props") if isinstance((component or {}).get("props"), dict) else {}
    ctype = (component or {}).get("type")
    used: set = set()
    if ctype == "ctaBanner" and labels:
        if not _button_set(props.get("button")):
            used.add(labels[0])
            hints.append({"prop_path": "props.button",
                          "suggestion": f"The design has a button \"{labels[0]}\"; this ctaBanner has none → set "
                                        "props.button {enabled:true, text, action, target}."})
        elif not _button_set(props.get("secondaryButton")):
            used.add(labels[0])
            hints.append({"prop_path": "props.secondaryButton",
                          "suggestion": f"The design has a second button \"{labels[0]}\"; this ctaBanner has no "
                                        "secondaryButton → set props.secondaryButton {enabled:true, text, action, "
                                        "target or audienceId}."})
    elif ctype == "heroSection" and labels:
        left = props.get("left") if isinstance(props.get("left"), dict) else {}
        buttons = [b for b in left.get("buttons") or [] if _button_set(b)]
        if len(buttons) < 2:
            used.add(labels[0])
            hints.append({"prop_path": "props.left.buttons",
                          "suggestion": f"The design has a button \"{labels[0]}\" that the hero lacks → add it to "
                                        "props.left.buttons."})
    for t in missing_text:
        if t in used or len(hints) >= 6:
            continue
        hints.append({"prop_path": None,
                      "suggestion": f"The design shows \"{t[:80]}\" in this section; the page does not."})
    return hints


def _colour_prop(component: Optional[Dict[str, Any]]) -> str:
    props = (component or {}).get("props")
    return "props.backgroundColor" if isinstance(props, dict) and "backgroundColor" in props else "style.backgroundColor"


# ── the comparison ──────────────────────────────────────────────────────
def finite_number(value: Any) -> Optional[float]:
    """``value`` as a finite float (a number or numeric string), else None ("nan" / "inf" too)."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _scaled_sections(sections: Optional[Sequence[Dict[str, Any]]], factor: float, height: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for i, s in enumerate(sections or []):
        if not isinstance(s, dict):
            continue
        top, h = finite_number(s.get("top", s.get("y"))), finite_number(s.get("height"))
        if top is None or h is None or abs(top) > 1e7 or abs(h) > 1e7:
            continue
        t, b = int(round(top * factor)), int(round((top + h) * factor))
        t, b = max(0, min(t, height)), max(0, min(b, height))
        if b - t < 4:
            continue
        out.append({"name": str(s.get("name") or s.get("id") or f"section {i + 1}")[:80],
                    "node": s.get("id"), "top": t, "height": b - t,
                    "texts": [str(x)[:300] for x in (s.get("texts") or []) if str(x).strip()][:80]})
    return sorted(out, key=lambda s: s["top"])


def _palette(i: int) -> Tuple[int, int, int]:
    colours = [(60, 76, 231), (219, 152, 52), (113, 204, 46), (18, 156, 243), (182, 89, 155), (128, 128, 0)]
    return colours[i % len(colours)]


def side_by_side(design: np.ndarray, page: np.ndarray, pairs: List[Tuple[int, int, int, int]],
                 column_width: int = 560, max_height: int = 3600) -> bytes:
    """Design (left) and page (right), with each paired section's bounds in the same colour."""
    w = design.shape[1]
    scale = column_width / float(w)
    tall = max(design.shape[0], page.shape[0]) * scale
    if tall > max_height:
        scale *= max_height / tall
    cw = max(1, int(round(w * scale)))
    left = cv2.resize(design, (cw, max(1, int(round(design.shape[0] * scale)))), interpolation=cv2.INTER_AREA)
    right = cv2.resize(page, (cw, max(1, int(round(page.shape[0] * scale)))), interpolation=cv2.INTER_AREA)
    height = max(left.shape[0], right.shape[0])
    canvas = np.full((height, cw * 2 + 16, 3), 200, dtype=np.uint8)
    canvas[: left.shape[0], :cw] = left
    canvas[: right.shape[0], cw + 16:] = right
    for i, (d_top, d_bot, p_top, p_bot) in enumerate(pairs):
        colour = _palette(i)
        for x0, top, bot in ((0, d_top, d_bot), (cw + 16, p_top, p_bot)):
            y0, y1 = int(top * scale), max(int(top * scale) + 1, int(bot * scale) - 1)
            cv2.rectangle(canvas, (x0 + 1, y0), (x0 + cw - 2, y1), colour, 2)
            cv2.putText(canvas, str(i + 1), (x0 + 6, y0 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, colour, 2)
    return encode_jpeg(canvas, 78)


def compare_page(
    design: np.ndarray,
    page: np.ndarray,
    *,
    page_sections: Sequence[Dict[str, Any]],
    design_sections: Optional[Sequence[Dict[str, Any]]] = None,
    design_width: Optional[float] = None,
    design_texts: Optional[Sequence[str]] = None,
    components: Optional[Dict[str, Dict[str, Any]]] = None,
    with_image: bool = True,
    chrome: Optional[Dict[str, bool]] = None,
    truncated: bool = False,
) -> Dict[str, Any]:
    """Compare a rendered page with its design, section by section.

    ``page_sections``: ``[{id, top, height, text?, type?}]`` in page pixels (the
    rendered image's width). ``design_sections``: optional ``[{name?, id?, top,
    height, texts?}]`` in design units, where the frame is ``design_width``
    wide (default: the page width). ``design_texts``: page-level design strings
    for a whole-page text check. ``components``: section id → component JSON,
    for hints that name a prop. ``chrome``: ``{header, footer}`` — the site has
    that bar but it was not measured as a section, so a design band above the
    first (below the last) paired section is the bar, not a missing section.
    ``truncated``: the render stopped before the page ended, so design bands
    below the last paired section were not compared (``beyond_capture``).
    """
    width = int(page.shape[1])
    design = resize_to_width(design, width)
    dh, ph = int(design.shape[0]), int(page.shape[0])
    factor = width / float(design_width or width)
    regions = _scaled_sections(design_sections, factor, dh) if design_sections else []
    regions_given = bool(regions)
    if not regions:
        regions = [{**b, "node": None, "texts": []} for b in segment_bands(design)]

    pitch = max(4, int(math.ceil(max(dh, ph) / float(_ALIGN_MAX_ROWS))))
    mapping, costs = align_rows(_row_features(page, pitch), _row_features(design, pitch), free_end=truncated)
    n = len(mapping)

    edges = sorted({0, dh, *(r["top"] for r in regions), *(r["top"] + r["height"] for r in regions)})

    def snap(y: int) -> int:
        near = min(edges, key=lambda e: abs(e - y))
        return near if abs(near - y) <= 2 * pitch else y

    def mapped(top: int, bottom: int) -> Tuple[int, int, float]:
        # Rows wholly inside the section (a straddling row mixes in its
        # neighbour), each edge carried over with its offset into the row,
        # then snapped to a design section edge when one is that close.
        i0 = min(n - 1, max(0, int(math.ceil(top / float(pitch)))))
        i1 = min(n - 1, max(i0, bottom // pitch - 1))
        d_top = int(mapping[i0]) * pitch - (i0 * pitch - top)
        d_bot = (int(mapping[i1]) + 1) * pitch + (bottom - (i1 + 1) * pitch)
        d_top, d_bot = snap(max(0, min(dh, d_top))), snap(max(0, min(dh, d_bot)))
        return d_top, max(d_top, d_bot), float(costs[i0:i1 + 1].mean())

    sections_out: List[Dict[str, Any]] = []
    extra_ids: List[str] = []
    pairs: List[Tuple[int, int, int, int]] = []
    covered = [0.0] * len(regions)
    components = components or {}
    for s in sorted((s for s in page_sections if isinstance(s, dict)), key=lambda s: float(s.get("top") or 0)):
        sid = str(s.get("id") or "")
        top = int(max(0, float(s.get("top") or 0)))
        bottom = int(min(ph, top + max(0.0, float(s.get("height") or 0))))
        if bottom - top < 4:
            continue
        comp = components.get(sid)
        d_top, d_bot, cost = mapped(top, bottom)
        entry: Dict[str, Any] = {"section_id": sid, "type": s.get("type") or (comp or {}).get("type"),
                                 "top": top, "height": bottom - top}
        if d_bot - d_top < max(8, _EXTRA_MAPPED_SHARE * (bottom - top)):
            extra_ids.append(sid)
            entry.update({"extra": True, "hints": [{
                "prop_path": None,
                "suggestion": "Nothing in the design matches this section: remove it, or move it to where the "
                              "design has it."}]})
            sections_out.append(entry)
            continue
        names, nodes, texts = [], [], []
        for k, r in enumerate(regions):
            overlap = max(0, min(d_bot, r["top"] + r["height"]) - max(d_top, r["top"]))
            share = overlap / float(r["height"])
            covered[k] += share
            if share >= _COVERED:
                names.append(r["name"])
                if r.get("node"):
                    nodes.append(r["node"])
                texts.extend(r.get("texts") or [])
        d_crop, p_crop = design[d_top:d_bot], page[top:bottom]
        d_col, p_col = dominant_color(d_crop), dominant_color(p_crop)
        delta = delta_e2000(d_col["lab"], p_col["lab"])
        ratio = (bottom - top) / float(max(1, d_bot - d_top))
        score = crop_ssim(d_crop, p_crop)
        entry.update({
            "design_sections": names, "design_top": d_top, "design_height": d_bot - d_top,
            "ssim": round(score, 3), "height_ratio": round(ratio, 3), "color_delta": round(delta, 1),
            "page_color": p_col["hex"], "design_color": d_col["hex"], "match_cost": round(cost, 3),
        })
        if nodes:
            entry["figma_nodes"] = nodes
        hints: List[Dict[str, Any]] = []
        if texts:
            missing, extra = text_diff(texts, str(s.get("text") or ""))
            entry["missing_text"], entry["extra_text"] = missing, extra
            hints.extend(text_hints(comp, missing))
        if delta > _COLOR_HINT_DELTA and d_col["share"] >= _DOMINANT_MIN_SHARE and p_col["share"] >= _DOMINANT_MIN_SHARE:
            hints.append({"prop_path": _colour_prop(comp),
                          "suggestion": f"The design's background here is {d_col['hex']}; the page renders "
                                        f"{p_col['hex']} (ΔE {delta:.0f})."})
        if ratio < _SHORT_RATIO:
            hints.append({"prop_path": None,
                          "suggestion": f"Renders at {ratio:.0%} of the design's height: the design has more content "
                                        "or more padding here (items, images, style.paddingTop/paddingBottom)."})
        elif ratio > _TALL_RATIO:
            hints.append({"prop_path": None,
                          "suggestion": f"Renders at {ratio:.0%} of the design's height: extra items, larger "
                                        "images or more padding than the design."})
        if score < _LOW_SSIM:
            hints.append({"prop_path": None,
                          "suggestion": "The layout differs a lot from the design here; compare the two crops "
                                        "in the side-by-side image."})
        entry["hints"] = hints
        sections_out.append(entry)
        pairs.append((d_top, d_bot, top, bottom))

    missing_sections: List[Dict[str, Any]] = []
    chrome_bands: List[Dict[str, Any]] = []
    beyond_capture: List[Dict[str, Any]] = []
    chrome = chrome or {}
    spans = [(p["design_top"], p["design_top"] + p["design_height"]) for p in sections_out if not p.get("extra")]
    first_top = min((a for a, _ in spans), default=None)
    last_bottom = max((b for _, b in spans), default=None)
    slack = 2 * pitch
    for k, r in enumerate(regions):
        if covered[k] >= _COVERED:
            continue
        r_bottom = r["top"] + r["height"]
        if chrome.get("header") and first_top is not None and r_bottom <= first_top + slack:
            chrome_bands.append({"design_section": r["name"], "design_top": r["top"], "design_height": r["height"],
                                 "matched_by": "header"})
            continue
        if last_bottom is not None and r["top"] >= last_bottom - slack:
            if chrome.get("footer"):
                chrome_bands.append({"design_section": r["name"], "design_top": r["top"],
                                     "design_height": r["height"], "matched_by": "footer"})
                continue
            if truncated:
                beyond_capture.append({"design_section": r["name"], "design_top": r["top"],
                                       "design_height": r["height"]})
                continue
        crop = design[r["top"]: r["top"] + r["height"]]
        col = dominant_color(crop)
        item: Dict[str, Any] = {"design_section": r["name"], "design_top": r["top"], "design_height": r["height"],
                                "design_color": col["hex"]}
        if r.get("node"):
            item["figma_node"] = r["node"]
        if r.get("texts"):
            item["texts"] = r["texts"][:8]
        before = [p for p in sections_out if not p.get("extra") and p["design_top"] <= r["top"]]
        where = f" after '{before[-1]['section_id']}'" if before else " at the top of the page"
        item["hints"] = [{"prop_path": None,
                          "suggestion": f"The design has a {r['height']}px band (mostly {col['hex']}) here with no "
                                        f"counterpart on the page: add a section for it{where}."}]
        missing_sections.append(item)

    paired = [p for p in sections_out if not p.get("extra")]
    weight = sum(p["height"] for p in paired)
    overall_ssim = sum(p["ssim"] * p["height"] for p in paired) / weight if weight else 0.0
    out: Dict[str, Any] = {
        "overall": {
            "ssim": round(overall_ssim, 3),
            "sections_paired": len(paired),
            "sections_extra": len(extra_ids),
            "sections_missing": len(missing_sections),
            "height_ratio": round(ph / float(max(1, dh)), 3),
            "passes": (bool(paired) and not missing_sections and not beyond_capture
                       and all(p["ssim"] >= SECTION_SSIM_BAR for p in paired)),
            "bar": {"section_ssim": SECTION_SSIM_BAR, "missing_sections": 0, "provisional": True},
        },
        "design_sections_from": "given" if regions_given else "bands",
        "sections": sections_out,
        "missing_sections": missing_sections,
        "extra_sections": extra_ids,
    }
    if chrome_bands:
        out["chrome_bands"] = chrome_bands
    if truncated:
        out["overall"]["complete"] = False
        out["beyond_capture"] = beyond_capture
    if design_texts:
        page_text = "\n".join(str(s.get("text") or "") for s in page_sections if isinstance(s, dict))
        missing, _ = text_diff(design_texts, page_text)
        out["page_missing_text"] = missing
    if with_image:
        out["side_by_side_jpeg"] = side_by_side(design, page, pairs)
    return out


__all__ = [
    "CompareError", "MAX_IMAGE_BYTES", "MAX_IMAGE_PIXELS", "MAX_STITCHED_HEIGHT", "SECTION_SSIM_BAR",
    "align_rows", "check_reference", "compare_page", "crop_ssim", "decode_image", "decode_reference", "image_info", "delta_e2000", "dominant_color", "encode_jpeg",
    "image_size", "normalize_text", "resize_to_width", "segment_bands", "side_by_side", "ssim", "stitch_vertical",
    "text_diff", "text_hints",
]
