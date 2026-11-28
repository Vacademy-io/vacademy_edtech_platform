"""Read OMR sheets with the vendored OMRChecker. Runs ONLY inside a worker process.

assessment_service draws every sheet and writes the matching OMRChecker
``template.json`` from the same coordinates, so this module does not guess any
layout: it renders each page, lets OMRChecker find the four corner markers and
read the bubbles, and reports what it read.

Why a separate process (see ``pool.py``): OMRChecker is a command-line program,
not a library. It imports itself as the top-level package ``src``, keeps
module-level state, configures the root logger on import and calls ``exit()`` on
a bad template. None of that may touch the ai_service process.

Besides OMRChecker's own reading, each field gets a confidence check that
OMRChecker does not report: the smallest distance between any bubble's darkness
and the threshold OMRChecker used for that field. A faint mark, a half-erased
one or a smudge lands close to the threshold, and the caller flags it for review
instead of trusting it. The threshold is recomputed with OMRChecker's own
``get_global_threshold`` / ``get_local_threshold`` on the same image, so it is
exactly the one the reading used (see ``VENDORED.md``: the reader is unpatched).
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

_VENDOR_DIR = Path(__file__).resolve().parents[2] / "vendor" / "omrchecker"

# Set by init_worker in the worker process.
_omr: dict[str, Any] = {}


def init_worker() -> None:
    """ProcessPoolExecutor initializer: make OMRChecker importable and quiet."""
    os.environ.setdefault("MPLBACKEND", "Agg")
    if str(_VENDOR_DIR) not in sys.path:
        sys.path.insert(0, str(_VENDOR_DIR))
    import logging

    import cv2  # noqa: F401
    import numpy as np  # noqa: F401
    from src.defaults import CONFIG_DEFAULTS  # type: ignore[import-not-found]  # noqa: F401
    from src.template import Template  # type: ignore[import-not-found]
    from src.utils.parsing import open_config_with_defaults  # type: ignore[import-not-found]

    # OMRChecker logs every step at INFO through a rich handler; a 200-sheet
    # batch would flood the pod log. Warnings and errors still come through.
    logging.getLogger().setLevel(logging.WARNING)
    for name in list(logging.root.manager.loggerDict):
        logging.getLogger(name).setLevel(logging.WARNING)

    _omr["Template"] = Template
    _omr["open_config"] = open_config_with_defaults


# --------------------------------------------------------------------- marker


def draw_marker(marker: dict, px_per_mm: float = 12.0):
    """The corner marker exactly as the sheet prints it: a black square with a
    white square inside and a black core, on a white margin. Template matching
    compares this image against the scan, so its proportions must match the
    printed marker (assessment_service sends the same millimetre sizes it drew)."""
    import numpy as np

    outer = float(marker["outer_mm"])
    inner = float(marker["inner_mm"])
    core = float(marker["core_mm"])
    pad = float(marker["pad_mm"])
    total = outer + 2 * pad
    size = int(round(total * px_per_mm))
    img = np.full((size, size), 255, dtype=np.uint8)

    def square(side_mm: float, value: int) -> None:
        half = side_mm * px_per_mm / 2
        c = size / 2
        a, b = int(round(c - half)), int(round(c + half))
        img[a:b, a:b] = value

    square(outer, 0)
    square(inner, 255)
    square(core, 0)
    return img


# ---------------------------------------------------------------------- pages


@dataclass
class PageRead:
    page_no: int
    status: str  # READ | NO_MARKERS | ERROR
    error: Optional[str] = None
    rotated: bool = False
    values: dict[str, str] = field(default_factory=dict)
    low_confidence: list[str] = field(default_factory=list)
    sheet_pdf: Optional[bytes] = None
    marked_jpeg: Optional[bytes] = None
    name_crop_jpeg: Optional[bytes] = None


def _page_images(content: bytes, file_kind: str, pages: list[int], dpi: int):
    """(page_no, grayscale ndarray) for the requested 1-based pages."""
    import cv2
    import numpy as np

    if file_kind == "image":
        if pages and pages != [1]:
            return
        arr = np.frombuffer(content, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise ValueError("the image could not be decoded")
        yield 1, img
        return

    import fitz  # PyMuPDF

    doc = fitz.open(stream=content, filetype="pdf")
    try:
        for p in pages:
            if p < 1 or p > doc.page_count:
                continue
            pix = doc[p - 1].get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY)
            img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
            if pix.stride != pix.width:
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, : pix.width]
            yield p, img.copy()
    finally:
        doc.close()


def count_pages(content: bytes, file_kind: str) -> int:
    if file_kind == "image":
        return 1
    import fitz

    doc = fitz.open(stream=content, filetype="pdf")
    try:
        return doc.page_count
    finally:
        doc.close()


def _jpeg(img, quality: int = 80, max_side: Optional[int] = None) -> bytes:
    import cv2

    if max_side:
        h, w = img.shape[:2]
        scale = max_side / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("jpeg encoding failed")
    return buf.tobytes()


def _single_page_pdf(jpeg: bytes) -> bytes:
    """The scanned page as a one-page PDF: the attempt's answer-sheet viewer
    (pdf.js) expects a PDF, like every other uploaded copy."""
    import fitz

    img_doc = fitz.open(stream=jpeg, filetype="jpeg")
    try:
        rect = img_doc[0].rect
        pdf = fitz.open()
        page = pdf.new_page(width=rect.width, height=rect.height)
        page.insert_image(rect, stream=jpeg)
        out = pdf.tobytes(deflate=True)
        pdf.close()
        return out
    finally:
        img_doc.close()


def _box_mean(img, box) -> float:
    import cv2

    x, y, w, h = (int(round(v)) for v in box)
    region = img[max(0, y): y + h, max(0, x): x + w]
    if region.size == 0:
        return 255.0
    return float(cv2.mean(region)[0])


def _suspect_fields(template, img, low_margin: float, faint_delta: float) -> set[str]:
    """Field labels whose reading should not be trusted without a look.

    Two independent signals, per field (one question, one roll digit, the set):
      * borderline: some bubble's darkness is within ``low_margin`` of the
        threshold OMRChecker used for that field - a mark it barely counted or
        barely ignored;
      * faint: a bubble OMRChecker counted as empty is clearly darker than the
        other empty bubbles of the SAME field (by ``faint_delta``). On a row with
        no confident mark OMRChecker falls back to the page-wide threshold, so a
        light pencil mark there reads as a confident blank; comparing within the
        row catches it and is immune to uneven lighting across the page.
    """
    import numpy as np

    suspect: set[str] = set()
    for label, vals, thr in _field_values(template, img):
        if min(abs(v - thr) for v in vals) < low_margin:
            suspect.add(label)
            continue
        empty = sorted(v for v in vals if v >= thr)
        if len(empty) >= 2:
            baseline = float(np.median(empty[1:]))  # the others, without the darkest empty one
            if empty[0] < baseline - faint_delta:
                suspect.add(label)
    return suspect


def _field_values(template, img) -> list[tuple[str, list[float], float]]:
    """(label, bubble darkness values, threshold) per field, as OMRChecker reads them.

    Mirrors ImageInstanceOps.read_omr_response (vendor/omrchecker/src/core.py):
    same resize + normalize, same bubble boxes, same global and per-strip
    threshold calls in the same order. Only the bookkeeping is ours."""
    import cv2
    import numpy as np

    from src.utils.image import ImageUtils  # type: ignore[import-not-found]

    ops = template.image_instance_ops
    img = ImageUtils.resize_util(img.copy(), template.page_dimensions[0], template.page_dimensions[1])
    if img.max() > img.min():
        img = ImageUtils.normalize_util(img)

    strips: list[tuple[str, list[float]]] = []
    all_q_vals: list[float] = []
    all_std: list[float] = []
    for block in template.field_blocks:
        box_w, box_h = block.bubble_dimensions
        for bubbles in block.traverse_bubbles:
            vals = []
            for pt in bubbles:
                x, y = pt.x + block.shift, pt.y
                vals.append(cv2.mean(img[y: y + box_h, x: x + box_w])[0])
            strips.append((bubbles[0].field_label, vals))
            all_q_vals.extend(vals)
            all_std.append(round(float(np.std(vals)), 2))

    global_std_thresh, _, _ = ops.get_global_threshold(all_std)
    global_thr, _, _ = ops.get_global_threshold(all_q_vals, looseness=4)

    out: list[tuple[str, list[float], float]] = []
    for i, (label, vals) in enumerate(strips):
        no_outliers = all_std[i] < global_std_thresh
        thr = ops.get_local_threshold(vals, global_thr, no_outliers, None, False)
        out.append((label, vals, float(thr)))
    return out


def _upside_down(template, img, orientation_box) -> bool:
    """The sheet prints a solid bar near the top-left corner and nothing at the
    point-mirrored spot near the bottom-right. Four corner markers look the same
    either way up, so this bar is what tells a sheet fed upside down."""
    from src.utils.image import ImageUtils  # type: ignore[import-not-found]

    page_w, page_h = template.page_dimensions
    img = ImageUtils.resize_util(img, page_w, page_h)
    x, y, w, h = orientation_box
    mirrored = (page_w - x - w, page_h - y - h, w, h)
    return _box_mean(img, mirrored) + 40 < _box_mean(img, orientation_box)


def _read_one(template, gray, layout: dict) -> tuple[Optional[dict], Optional[Any], bool, Optional[Any]]:
    """Preprocess (markers + warp) and read one page. Returns
    (response, final_marked, rotated, warped) - response None when no markers."""
    import cv2

    ops = template.image_instance_ops
    for rotated in (False, True):
        src_img = cv2.rotate(gray, cv2.ROTATE_180) if rotated else gray
        ops.reset_all_save_img()
        warped = ops.apply_preprocessors("sheet", src_img.copy(), template)
        if warped is None:
            if rotated:
                return None, None, False, None
            continue
        box = layout.get("orientation_box")
        if not rotated and box and _upside_down(template, warped, box):
            continue
        response, final_marked, _multi, _ = ops.read_omr_response(template, image=warped, name="sheet", save_dir=None)
        return response, final_marked, rotated, warped
    return None, None, False, None


def read_file(
    content: bytes,
    file_kind: str,
    pages: list[int],
    template_json: dict,
    marker: dict,
    layout: dict,
) -> list[PageRead]:
    """Read the given pages of one uploaded file. Called in a worker process."""
    import cv2

    from src.utils.image import ImageUtils  # type: ignore[import-not-found]

    Template = _omr["Template"]
    open_config = _omr["open_config"]
    low_margin = float(layout.get("low_margin", 20))
    faint_delta = float(layout.get("faint_delta", 15))
    name_box = layout.get("name_box")

    with tempfile.TemporaryDirectory(prefix="omr-") as tmp:
        tmp_dir = Path(tmp)
        cv2.imwrite(str(tmp_dir / "marker.png"), draw_marker(marker))
        (tmp_dir / "template.json").write_text(json.dumps(template_json))
        (tmp_dir / "config.json").write_text(json.dumps({
            "dimensions": {
                "processing_width": int(layout["processing_width"]),
                "processing_height": int(layout["processing_height"]),
            },
            "outputs": {"show_image_level": 0, "save_image_level": 0, "save_detections": False},
        }))
        config = open_config(tmp_dir / "config.json")
        template = Template(tmp_dir / "template.json", config)

        out: list[PageRead] = []
        for page_no, gray in _page_images(content, file_kind, pages, int(layout.get("render_dpi", 200))):
            try:
                response, marked, rotated, warped = _read_one(template, gray, layout)
                as_scanned = cv2.rotate(gray, cv2.ROTATE_180) if rotated else gray
                sheet_jpeg = _jpeg(as_scanned, quality=78, max_side=2000)
                if response is None:
                    out.append(PageRead(page_no=page_no, status="NO_MARKERS",
                                        error="the four corner markers could not be found",
                                        sheet_pdf=_single_page_pdf(sheet_jpeg)))
                    continue
                low = sorted(_suspect_fields(template, warped, low_margin, faint_delta))
                name_crop = None
                if name_box:
                    page_img = ImageUtils.resize_util(warped, template.page_dimensions[0], template.page_dimensions[1])
                    x, y, w, h = (int(round(v)) for v in name_box)
                    crop = page_img[max(0, y): y + h, max(0, x): x + w]
                    if crop.size:
                        name_crop = _jpeg(crop, quality=85)
                out.append(PageRead(
                    page_no=page_no,
                    status="READ",
                    rotated=rotated,
                    values={str(k): str(v) for k, v in response.items()},
                    low_confidence=low,
                    sheet_pdf=_single_page_pdf(sheet_jpeg),
                    marked_jpeg=_jpeg(marked, quality=75, max_side=1600),
                    name_crop_jpeg=name_crop,
                ))
            except BaseException as e:  # noqa: BLE001  (OMRChecker calls exit() on some errors)
                out.append(PageRead(page_no=page_no, status="ERROR", error=f"{type(e).__name__}: {e}"[:500]))
        return out
