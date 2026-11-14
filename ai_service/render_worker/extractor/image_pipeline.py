"""
Image indexing pipeline orchestrator.

Mirrors the video pipeline (pipeline.py::run_index_pipeline) but for single
frames. Stages run sequentially; mode determines which stages execute.

Modes:
  photo      — face detection + free regions + rembg matte + caption + colors + ocr (light)
  screenshot — heavy ocr + caption (with ui_elements) + colors
  diagram    — ocr + caption (diagram-aware prompt) + colors

Output: image_metadata.json (ImageContext) + optional image_fg.png. Both go
to S3 under ai-input-assets/{asset_id}/.

Called from main.py via asyncio.run_in_executor() (blocking, runs in thread pool).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import shutil
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Optional

from ._s3 import S3Helper
from .llm_defaults import LLM_MAX_TOKENS, llm_model, reasoning_extra_body
from .schemas import (
    DominantColor,
    ImageCaption,
    ImageColors,
    ImageContext,
    ImageFaces,
    ImageForeground,
    ImageMeta,
    ImageOcr,
    OcrBlock,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Free-region computation — mirror of full_video_face._compute_free_regions
# but operating on a single bbox. Kept inline to avoid pulling in the
# video-only module.
# ---------------------------------------------------------------------------

def _free_regions_for_bbox(bbox_norm: list[float]) -> list[str]:
    """Return canvas zones that DON'T contain the given face bbox center.

    Same semantics as the video pipeline's free_regions: half-zones useful
    for wide overlays (banners), quadrant-zones for discrete elements.
    """
    cx = bbox_norm[0] + bbox_norm[2] / 2
    cy = bbox_norm[1] + bbox_norm[3] / 2
    out: list[str] = []
    # Quadrants: zone is free iff center is NOT in that quadrant.
    if not (cx < 0.5 and cy < 0.5):
        out.append("top_left")
    if not (cx >= 0.5 and cy < 0.5):
        out.append("top_right")
    if not (cx < 0.5 and cy >= 0.5):
        out.append("bottom_left")
    if not (cx >= 0.5 and cy >= 0.5):
        out.append("bottom_right")
    # Halves: hysteresis matches the video pipeline.
    if cx > 0.45:
        out.append("left_half")
    if cx < 0.55:
        out.append("right_half")
    if cy > 0.40:
        out.append("top_half")
    if cy < 0.60:
        out.append("bottom_half")
    return out


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

def _extract_dominant_colors(image_path: Path, k: int = 5) -> list[DominantColor]:
    """Quantize the image to k colors and return them with pixel-share weights.

    Uses Pillow's median-cut quantizer — fast, no extra deps, and the small
    color count makes the weight estimate stable enough for design use
    (background detection, palette suggestions).
    """
    from PIL import Image

    img = Image.open(image_path).convert("RGB")
    # Downsample for speed — large images don't change palette outcomes
    # but make quantize() do unnecessary work.
    if max(img.size) > 512:
        img.thumbnail((512, 512))
    quant = img.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    palette = quant.getpalette() or []
    counts = quant.getcolors() or []
    total = sum(c for c, _ in counts) or 1
    out: list[DominantColor] = []
    for count, idx in sorted(counts, key=lambda x: -x[0]):
        r, g, b = palette[idx * 3:idx * 3 + 3]
        out.append(DominantColor(
            hex=f"#{r:02x}{g:02x}{b:02x}",
            weight=round(count / total, 3),
        ))
    return out


def _run_ocr(image_path: Path) -> ImageOcr:
    """Run rapidocr (already wired in render_worker for demo videos)."""
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
    except ImportError:
        logger.warning("rapidocr unavailable, skipping OCR")
        return ImageOcr()

    from PIL import Image

    img = Image.open(image_path).convert("RGB")
    width, height = img.size
    arr = _pil_to_numpy(img)

    ocr = RapidOCR()
    # rapidocr returns (results, elapsed) where results is a list of
    # [bbox4points, text, confidence].
    result, _ = ocr(arr)
    blocks: list[OcrBlock] = []
    if result:
        for entry in result:
            try:
                pts, text, conf = entry
            except Exception:
                continue
            if not text or not text.strip():
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            x_min, x_max = min(xs), max(xs)
            y_min, y_max = min(ys), max(ys)
            blocks.append(OcrBlock(
                text=text.strip(),
                bbox_norm=[
                    round(x_min / width, 4),
                    round(y_min / height, 4),
                    round((x_max - x_min) / width, 4),
                    round((y_max - y_min) / height, 4),
                ],
                confidence=round(float(conf), 3) if conf is not None else 0.0,
            ))
    return ImageOcr(
        blocks=blocks,
        full_text="\n".join(b.text for b in blocks),
    )


def _detect_faces(image_path: Path) -> ImageFaces:
    """MediaPipe face detection on a single image (photo mode only)."""
    try:
        import mediapipe as mp  # type: ignore
    except ImportError:
        logger.warning("mediapipe unavailable, skipping face detection")
        return ImageFaces()

    from PIL import Image

    img = Image.open(image_path).convert("RGB")
    width, height = img.size
    arr = _pil_to_numpy(img)

    with mp.solutions.face_detection.FaceDetection(
        model_selection=1, min_detection_confidence=0.5,
    ) as detector:
        result = detector.process(arr)
    detections = result.detections or []
    if not detections:
        return ImageFaces()

    # Pick the largest face as the primary subject — most photos have one
    # focal subject, and area is a good heuristic for that subject.
    largest = None
    largest_area = 0.0
    for det in detections:
        box = det.location_data.relative_bounding_box
        area = box.width * box.height
        if area > largest_area:
            largest_area = area
            largest = box
    if largest is None:
        return ImageFaces(detected=False, face_count=len(detections))

    bbox = [
        round(max(0.0, largest.xmin), 4),
        round(max(0.0, largest.ymin), 4),
        round(min(1.0, largest.width), 4),
        round(min(1.0, largest.height), 4),
    ]
    return ImageFaces(
        detected=True,
        primary_bbox_norm=bbox,
        free_regions=_free_regions_for_bbox(bbox),
        face_count=len(detections),
    )


def _matte_background(image_path: Path, output_path: Path) -> bool:
    """Background-removed PNG via rembg (photo mode only). Returns success."""
    try:
        from rembg import remove  # type: ignore
    except ImportError:
        logger.warning("rembg unavailable, skipping matte stage")
        return False

    try:
        with open(image_path, "rb") as f:
            input_bytes = f.read()
        output_bytes = remove(input_bytes)
        output_path.write_bytes(output_bytes)
        return True
    except Exception as e:
        logger.warning(f"rembg failed (non-fatal): {e}")
        return False


def _generate_caption(image_path: Path, mode: str) -> Optional[ImageCaption]:
    """Vision caption via OpenRouter. Model: $IMAGE_CAPTION_MODEL >
    $RENDER_WORKER_LLM_MODEL > the platform default (GLM, low reasoning
    effort). Returns None if API key not configured.

    Captioning is best-effort: a missing key, network error, or malformed
    response leaves caption as None — the rest of the pipeline still produces
    a usable image_metadata.json.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        logger.info("OPENROUTER_API_KEY unset, skipping caption stage")
        return None

    prompt = _caption_prompt(mode)
    image_b64 = _image_jpeg_b64(image_path)

    try:
        from openai import OpenAI  # type: ignore
    except ImportError:
        logger.warning("openai SDK unavailable, skipping caption")
        return None

    try:
        client = OpenAI(
            api_key=api_key,
            base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        )
        model = llm_model("IMAGE_CAPTION_MODEL")
        resp = client.chat.completions.create(
            model=model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            }],
            timeout=60,
            # Room for GLM's (low-effort) reasoning on top of the caption JSON.
            max_tokens=LLM_MAX_TOKENS,
            response_format={"type": "json_object"},
            extra_body=reasoning_extra_body(model) or None,
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        return ImageCaption(
            short=str(data.get("short", "")).strip(),
            long=str(data.get("long", "")).strip(),
            tags=[str(t).strip() for t in (data.get("tags") or []) if str(t).strip()],
            ui_elements=[str(e).strip() for e in (data.get("ui_elements") or []) if str(e).strip()],
        )
    except Exception as e:
        logger.warning(f"caption generation failed (non-fatal): {e}")
        return None


def _caption_prompt(mode: str) -> str:
    if mode == "screenshot":
        return (
            "This is a software screenshot. Output JSON only, no prose. "
            "Schema: {short: string (one sentence), long: string (paragraph), "
            "tags: string[] (5-10 keywords), ui_elements: string[] (visible apps, "
            "buttons, panels — e.g. ['VS Code', 'Terminal', 'Run button'])}. "
            "Focus on what application is shown and what action is happening."
        )
    if mode == "diagram":
        return (
            "This is a diagram or technical illustration. Output JSON only. "
            "Schema: {short: string (one sentence), long: string (explain the "
            "concept being illustrated and the relationships shown), "
            "tags: string[] (5-10 keywords)}. ui_elements is not used."
        )
    return (
        "This is a photograph. Output JSON only, no prose. "
        "Schema: {short: string (one sentence), long: string (paragraph "
        "describing subject, setting, mood), tags: string[] (5-10 keywords)}. "
        "ui_elements is not used."
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pil_to_numpy(img):
    import numpy as np  # type: ignore
    return np.array(img)


def _image_jpeg_b64(image_path: Path, max_dim: int = 1568) -> str:
    """Re-encode the image as JPEG and return base64 for LLM vision input.

    JPEG (not PNG) keeps the data-URI under Gemini's per-image size cap even
    for 10MB source uploads. max_dim caps the longest side at 1568px — the
    resolution Gemini downsamples to internally — so we don't waste bytes on
    pixels the model will discard anyway.
    """
    from PIL import Image

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim))
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("ascii")


def _probe_image(image_path: Path) -> dict[str, Any]:
    """Pillow-based metadata: width, height, format, size."""
    from PIL import Image

    file_size = image_path.stat().st_size
    with Image.open(image_path) as img:
        return {
            "width": img.width,
            "height": img.height,
            "format": (img.format or "UNKNOWN").upper(),
            "file_size_bytes": file_size,
        }


# Pillow → (file extension, image/* mime subtype). Anything not in this
# table — including the "UNKNOWN" sentinel from _probe_image when Pillow
# can't identify the source — falls back to PNG, which any browser will
# render and any downstream consumer can decode.
_FORMAT_TO_EXT_MIME: dict[str, tuple[str, str]] = {
    "JPEG": ("jpg", "jpeg"),
    "PNG": ("png", "png"),
    "WEBP": ("webp", "webp"),
    "GIF": ("gif", "gif"),
    "BMP": ("bmp", "bmp"),
    "TIFF": ("tif", "tiff"),
}


def _ext_and_mime(pil_format: str) -> tuple[str, str]:
    return _FORMAT_TO_EXT_MIME.get((pil_format or "").upper(), ("png", "png"))


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_image_index_pipeline(
    input_asset_id: str,
    source_url: str,
    mode: str,
    on_progress: Callable[[float], None],
) -> dict[str, Any]:
    """Index a single image. Blocking — runs in thread pool executor.

    Returns:
        {
            "output_urls": {"image_metadata": ..., "assets": {...}},
            "width": int,
            "height": int,
        }
    """
    if mode not in ("photo", "screenshot", "diagram"):
        raise ValueError(f"Unsupported image mode: {mode!r}")

    work_dir = Path(tempfile.mkdtemp(prefix=f"index_image_{input_asset_id}_"))
    s3 = S3Helper()
    s3_base = f"ai-input-assets/{input_asset_id}"

    try:
        # ── SETUP (0-10%) ─────────────────────────────────────────────
        on_progress(2)
        image_path = work_dir / "source_image"
        logger.info(f"Downloading source image: {source_url}")
        s3.download(source_url, image_path)
        on_progress(8)

        probe = _probe_image(image_path)
        width = probe["width"]
        height = probe["height"]
        logger.info(f"Image: {width}x{height} {probe['format']} ({probe['file_size_bytes']} bytes)")

        output_urls: dict[str, Any] = {"assets": {}}

        # Re-upload the source to public bucket so the FE can preview it,
        # mirroring video pipeline's source.mp4 handling.
        # Fall back to png for any format Pillow couldn't identify — better
        # to upload as a known type than ship `image/unknown` to S3, which
        # browsers would refuse to render inline.
        ext, mime_subtype = _ext_and_mime(probe["format"])
        upload_key = f"{s3_base}/source.{ext}"
        source_public_url = s3.upload(image_path, upload_key, content_type=f"image/{mime_subtype}")
        output_urls["assets"]["source_image"] = source_public_url
        on_progress(10)

        # ── COLORS (10-25%) ───────────────────────────────────────────
        logger.info("=== STAGE: Dominant colors ===")
        colors = ImageColors(dominant=_extract_dominant_colors(image_path))
        on_progress(25)

        # ── OCR (25-50%) ──────────────────────────────────────────────
        logger.info(f"=== STAGE: OCR ({mode}) ===")
        ocr = _run_ocr(image_path)
        logger.info(f"OCR: {len(ocr.blocks)} blocks")
        on_progress(50)

        # ── FACE + MATTE (50-85%, photo only) ─────────────────────────
        faces: Optional[ImageFaces] = None
        foreground: Optional[ImageForeground] = None
        if mode == "photo":
            logger.info("=== STAGE: Face detection ===")
            faces = _detect_faces(image_path)
            on_progress(65)

            logger.info("=== STAGE: Background removal ===")
            fg_path = work_dir / "image_fg.png"
            if _matte_background(image_path, fg_path):
                fg_url = s3.upload(
                    fg_path, f"{s3_base}/assets/image_fg.png",
                    content_type="image/png",
                )
                output_urls["assets"]["image_fg"] = fg_url
                foreground = ImageForeground(
                    asset_path="assets/image_fg.png", has_alpha=True,
                )
            on_progress(85)
        else:
            on_progress(85)

        # ── CAPTION (85-95%) ──────────────────────────────────────────
        logger.info(f"=== STAGE: Caption ({mode}) ===")
        caption = _generate_caption(image_path, mode)
        on_progress(95)

        # ── OUTPUT (95-100%) ──────────────────────────────────────────
        ctx = ImageContext(
            meta=ImageMeta(
                mode=mode,
                width=width,
                height=height,
                format=probe["format"],
                file_size_bytes=probe["file_size_bytes"],
            ),
            colors=colors,
            ocr=ocr,
            faces=faces,
            foreground=foreground,
            caption=caption,
        )

        metadata_path = work_dir / "image_metadata.json"
        metadata_path.write_text(
            ctx.model_dump_json(indent=2, exclude_none=True),
            encoding="utf-8",
        )
        metadata_url = s3.upload(
            metadata_path, f"{s3_base}/image_metadata.json",
            content_type="application/json",
        )
        output_urls["image_metadata"] = metadata_url
        on_progress(100)

        logger.info("Image pipeline complete")
        return {
            "output_urls": output_urls,
            "width": width,
            "height": height,
        }

    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
        except Exception:
            pass
