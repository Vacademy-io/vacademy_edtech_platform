"""
Render Worker — Dedicated video rendering service.

Runs on a separate server (Hetzner CPX32). Accepts render jobs via HTTP,
runs generate_video.py (Playwright + FFmpeg), uploads MP4 to S3.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import Response
from pydantic import BaseModel, Field

from worker import RenderWorker
from transcribe_worker import TranscribeWorker
from screenshot_worker import get_screenshot_worker
# audio_ops is imported lazily inside the /audio/* route handlers
# (matches /concat_audio's pattern — keeps the import surface minimal here).

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("render-worker")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

RENDER_KEY = os.environ.get("RENDER_KEY", "")
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Vacademy Render Worker", version="1.0.0")

# In-memory job tracker (single-process worker, no need for DB)
jobs: Dict[str, dict] = {}
worker = RenderWorker()
transcribe_worker = TranscribeWorker()

# Dev-mode static route — serves transcript files from local disk when AWS
# creds are absent. Mounted lazily because the dir may not exist at boot.
_LOCAL_TRANSCRIPT_DIR = os.environ.get("LOCAL_TRANSCRIPT_DIR", "/tmp/vacademy-transcripts")
if not (os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY")):
    from fastapi.staticfiles import StaticFiles
    os.makedirs(_LOCAL_TRANSCRIPT_DIR, exist_ok=True)
    app.mount("/transcripts", StaticFiles(directory=_LOCAL_TRANSCRIPT_DIR), name="transcripts")
    logger.info(f"Dev mode: serving transcripts from {_LOCAL_TRANSCRIPT_DIR} at /transcripts")


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def _verify_key(x_render_key: str = Header(...)):
    # compare_digest: a plain != short-circuits on the first differing byte,
    # which leaks key prefixes through response timing.
    if RENDER_KEY and not hmac.compare_digest(x_render_key, RENDER_KEY):
        raise HTTPException(status_code=401, detail="Invalid render key")


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RenderJobRequest(BaseModel):
    job_id: Optional[str] = Field(default=None, description="Optional job ID (generated if not provided)")
    video_id: str = Field(..., description="Video ID for S3 path")
    timeline_url: str = Field(..., description="S3 URL to time_based_frame.json")
    audio_url: str = Field(..., description="S3 URL to narration.mp3")
    words_url: Optional[str] = Field(None, description="S3 URL to narration.words.json")
    branding_meta_url: Optional[str] = Field(None, description="S3 URL to branding_meta.json")
    avatar_video_url: Optional[str] = Field(None, description="S3 URL to avatar_video.mp4")
    callback_url: Optional[str] = Field(None, description="URL to POST on completion")
    show_captions: bool = Field(default=True)
    show_branding: bool = Field(default=True)
    audio_delay: float = Field(default=0.0)
    width: int = Field(default=1920, description="Video width (1920 for landscape, 1080 for portrait)")
    height: int = Field(default=1080, description="Video height (1080 for landscape, 1920 for portrait)")
    fps: Optional[int] = Field(default=None, description="Frames per second (15, 20, 25). Defaults to 22 if not set.")
    caption_position: Optional[str] = Field(default=None, description="top or bottom")
    caption_text_color: Optional[str] = Field(default=None, description="CSS color for caption text")
    caption_bg_color: Optional[str] = Field(default=None, description="CSS hex color for caption background")
    caption_bg_opacity: Optional[int] = Field(default=None, description="Caption background opacity 0-100")
    caption_font_size: Optional[int] = Field(default=None, description="Caption font size in px")
    # Style-polish fields (additive, all optional). Render server falls back
    # to pre-feature defaults when any field is omitted (phrase / system font /
    # 400 weight / no stroke / yellow highlight).
    caption_style: Optional[str] = Field(default=None, description="phrase or karaoke")
    caption_font_family: Optional[str] = Field(
        default=None,
        description="system | inter | montserrat | noto-sans | fira-code",
    )
    caption_font_weight: Optional[int] = Field(
        default=None, description="400, 500, 600, 700, 800, or 900"
    )
    caption_text_stroke_width: Optional[int] = Field(
        default=None, description="Outline width in px at 1920w canvas; 0 = no stroke"
    )
    caption_text_stroke_color: Optional[str] = Field(
        default=None, description="Hex color for the text stroke"
    )
    caption_highlight_color: Optional[str] = Field(
        default=None, description="Hex color for the active word in karaoke style"
    )
    source_video_url: Optional[str] = Field(default=None, description="(deprecated) Single source video URL — use source_video_urls")
    source_video_urls: Optional[List[str]] = Field(default=None, description="S3 URLs of indexed source videos for SOURCE_CLIP compositing")


class RenderJobResponse(BaseModel):
    job_id: str
    status: str
    message: str = ""


class RenderJobStatus(BaseModel):
    job_id: str
    video_id: str
    status: str  # queued, running, completed, failed
    progress: Optional[float] = None  # 0-100
    video_url: Optional[str] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


# ---------------------------------------------------------------------------
# Background render task
# ---------------------------------------------------------------------------

async def _run_render_job(job_id: str, request: RenderJobRequest):
    """Run render in background, update job status."""
    jobs[job_id]["status"] = "running"
    jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Surface whether AI service supplied a callback URL. Silent None here
    # is the most common reason renders complete on the worker but the FE
    # never sees them — make it impossible to miss in the logs.
    if request.callback_url:
        logger.info(
            f"Job {job_id} (video_id={request.video_id}) will push to: {request.callback_url}"
        )
    else:
        logger.warning(
            f"Job {job_id} (video_id={request.video_id}) has NO callback_url — "
            f"AI server will not be notified. Check AI_SERVICE_PUBLIC_URL on AI service."
        )

    try:
        video_url = await worker.render(
            video_id=request.video_id,
            timeline_url=request.timeline_url,
            audio_url=request.audio_url,
            words_url=request.words_url,
            branding_meta_url=request.branding_meta_url,
            avatar_video_url=request.avatar_video_url,
            show_captions=request.show_captions,
            show_branding=request.show_branding,
            audio_delay=request.audio_delay,
            on_progress=lambda p: _update_progress(job_id, p),
            width=request.width,
            height=request.height,
            fps=request.fps,
            caption_position=request.caption_position,
            caption_text_color=request.caption_text_color,
            caption_bg_color=request.caption_bg_color,
            caption_bg_opacity=request.caption_bg_opacity,
            caption_font_size=request.caption_font_size,
            caption_style=request.caption_style,
            caption_font_family=request.caption_font_family,
            caption_font_weight=request.caption_font_weight,
            caption_text_stroke_width=request.caption_text_stroke_width,
            caption_text_stroke_color=request.caption_text_stroke_color,
            caption_highlight_color=request.caption_highlight_color,
            source_video_urls=request.source_video_urls or ([request.source_video_url] if request.source_video_url else None),
        )

        jobs[job_id]["status"] = "completed"
        jobs[job_id]["video_url"] = video_url
        jobs[job_id]["progress"] = 100
        jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Job {job_id} completed: {video_url}")

        # Send callback
        if request.callback_url:
            await _send_callback(request.callback_url, {
                "video_id": request.video_id,
                "job_id": job_id,
                "status": "completed",
                "video_url": video_url,
            })

    except Exception as e:
        error_msg = str(e)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = error_msg
        jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.error(f"Job {job_id} failed: {error_msg}")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "video_id": request.video_id,
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            })


def _update_progress(job_id: str, progress: float):
    """Update in-memory progress and debounce-push to the AI server.

    Called from sync threads (subprocess stdout streamer in worker.py), so we
    use a sync httpx client. We rate-limit pushes: at most one push per 5s
    OR when progress moves by ≥ 2% — whichever comes first. This keeps the
    AI server's DB fresh without flooding it.
    """
    if job_id not in jobs:
        return
    import time as _time
    job = jobs[job_id]
    job["progress"] = progress
    job["updated_at"] = datetime.now(timezone.utc).isoformat()

    callback_url = job.get("callback_url")
    if not callback_url:
        return

    now_ts = _time.time()
    last_pushed = job.get("_last_pushed_progress", -1.0)
    last_pushed_at = job.get("_last_pushed_at", 0.0)
    moved_enough = abs(progress - last_pushed) >= 2.0
    enough_time = (now_ts - last_pushed_at) >= 5.0
    if not (moved_enough or enough_time):
        return

    job["_last_pushed_progress"] = progress
    job["_last_pushed_at"] = now_ts

    # Sync HTTP push — runs on the worker thread, doesn't block the event loop.
    try:
        import httpx as _httpx
        headers = {}
        if RENDER_KEY:
            headers["X-Render-Key"] = RENDER_KEY
        with _httpx.Client(timeout=10) as client:
            client.post(
                callback_url,
                json={
                    "video_id": job["video_id"],
                    "job_id": job_id,
                    "status": "running",
                    "progress": progress,
                },
                headers=headers,
            )
    except Exception as e:
        # Push failure is non-fatal — the AI server has a watchdog on
        # last_seen_at. We just log.
        logger.debug(f"Progress push failed for {job_id}: {e}")


async def _send_callback(url: str, data: dict):
    """Send completion callback to API server."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {}
            if RENDER_KEY:
                headers["X-Render-Key"] = RENDER_KEY
            await client.post(url, json=data, headers=headers)
            logger.info(f"Callback sent to {url}")
    except Exception as e:
        logger.warning(f"Callback failed: {e}")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    active = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
    return {"status": "ok", "active_jobs": active, "max_concurrent": MAX_CONCURRENT_JOBS}


@app.post("/jobs", response_model=RenderJobResponse)
async def submit_job(
    request: RenderJobRequest,
    x_render_key: str = Header(""),
):
    _verify_key(x_render_key)

    # Check capacity
    active = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
    if active >= MAX_CONCURRENT_JOBS:
        raise HTTPException(status_code=429, detail=f"Server busy ({active}/{MAX_CONCURRENT_JOBS} jobs running)")

    job_id = request.job_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    jobs[job_id] = {
        "job_id": job_id,
        "video_id": request.video_id,
        "status": "queued",
        "progress": 0,
        "video_url": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        # Push-based status: cached so _update_progress can debounce-POST
        # progress to the AI server. Without callback_url the push is skipped.
        "callback_url": request.callback_url,
        "_last_pushed_progress": -1.0,  # sentinel so first update fires
        "_last_pushed_at": 0.0,
    }

    # Fire and forget
    asyncio.create_task(_run_render_job(job_id, request))

    return RenderJobResponse(job_id=job_id, status="queued", message="Render job submitted")


@app.get("/jobs/{job_id}", response_model=RenderJobStatus)
async def get_job_status(job_id: str, x_render_key: str = Header("")):
    _verify_key(x_render_key)

    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    j = jobs[job_id]
    return RenderJobStatus(**j)


# ---------------------------------------------------------------------------
# Screenshot — single-shot captures for the vision-review path
#
# Loads the same harness as /jobs (via render_harness.py), injects one shot's
# HTML, and returns base64-encoded PNGs at requested timestamps. Used by the
# AI service's vision reviewer to grade shots before they're shipped.
# ---------------------------------------------------------------------------

class ScreenshotRequest(BaseModel):
    html: str = Field(..., description="Shot HTML — post-skill-composer, post-density-validator")
    width: int = Field(..., gt=0, le=4096, description="Viewport width in px (e.g. 1920)")
    height: int = Field(..., gt=0, le=4096, description="Viewport height in px (e.g. 1080)")
    timestamps: List[float] = Field(..., min_length=1, max_length=5, description="Shot-relative seconds at which to capture frames")
    background: str = Field(default="#0a0e27", description="CSS color used as the harness fill where shot HTML is transparent")


class ScreenshotFrame(BaseModel):
    t: float
    image_b64: str = Field(..., description="Base64-encoded PNG bytes")


class ScreenshotResponse(BaseModel):
    screenshots: List[ScreenshotFrame]
    ms: int = Field(..., description="Wall-clock duration of the screenshot batch")


@app.post("/screenshot", response_model=ScreenshotResponse)
async def take_screenshot(
    request: ScreenshotRequest,
    x_render_key: str = Header(""),
):
    """Capture N PNG screenshots of one shot's HTML at the given timestamps.

    Synchronous (no job queue) because per-shot screenshot is fast (<3s p95)
    and the vision reviewer waits inline. Reuses a long-lived Chromium
    instance under the hood — see screenshot_worker.ScreenshotWorker.
    """
    _verify_key(x_render_key)

    # Reject obviously bad timestamps early.
    for t in request.timestamps:
        if t < 0 or t > 600:
            raise HTTPException(status_code=400, detail=f"timestamp out of range: {t}")

    import time as _time
    start = _time.monotonic()
    try:
        worker = get_screenshot_worker()
        frames = await worker.screenshot_shot(
            html=request.html,
            width=request.width,
            height=request.height,
            timestamps=request.timestamps,
            background=request.background,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("screenshot failed")
        raise HTTPException(status_code=500, detail=f"screenshot failed: {exc}")
    elapsed_ms = int((_time.monotonic() - start) * 1000)

    return ScreenshotResponse(
        screenshots=[ScreenshotFrame(**f) for f in frames],
        ms=elapsed_ms,
    )


# ---------------------------------------------------------------------------
# Bbox-check — deterministic post-render overflow lint.
#
# Catches the TEXT_CLIPPED class deterministically: walks the rendered shadow
# DOM at each timestamp and reports every visible text/media element whose
# bounding box crosses the canvas edge. The LLM vision reviewer is
# probabilistic about this class (the audited vid_1778774930857_w8cwa1y
# silently shipped a clipped KINETIC_TITLE); a `getBoundingClientRect()` check
# doesn't lie.
#
# Same harness/dispatcher/wait pattern as /screenshot so what we measure
# equals what the production MP4 renders.
# ---------------------------------------------------------------------------


class BboxCheckRequest(BaseModel):
    html: str = Field(..., description="Shot HTML — same input as /screenshot")
    width: int = Field(..., gt=0, le=4096, description="Viewport width in px")
    height: int = Field(..., gt=0, le=4096, description="Viewport height in px")
    timestamps: List[float] = Field(
        ...,
        min_length=1,
        max_length=5,
        description="Shot-relative seconds at which to evaluate. Typically [0.3*dur, 0.6*dur, dur-0.1].",
    )
    background: str = Field(default="#0a0e27", description="CSS color used as the harness fill")
    keep_out: List[Dict[str, Any]] = Field(
        default_factory=list,
        max_length=8,
        description="Canvas rects {l,t,r,b,name} the shot must leave empty (lesson teacher area, caption strip).",
    )
    check_squeeze: bool = Field(default=False, description="Also report text squeezed into a too-narrow column")


class BboxViolationRect(BaseModel):
    l: float
    t: float
    r: float
    b: float


class BboxViolation(BaseModel):
    t: float = Field(..., description="Timestamp (shot-relative seconds) at which the violation was observed")
    selector: str = Field(..., description="Approximate CSS path of the offending element (#id or tag.class)")
    rect: BboxViolationRect = Field(..., description="Bounding rect at the moment of the violation")
    text: str = Field(default="", description="First 80 chars of the element's text content (empty for media)")
    is_media: bool = Field(default=False, description="True if the element is IMG/SVG/CANVAS/VIDEO")
    zone: str = Field(default="", description="Keep-out zone hit (empty = canvas overflow)")


class BboxCheckResponse(BaseModel):
    ok: bool = Field(..., description="True if no violations across any timestamp")
    violations: List[BboxViolation] = Field(default_factory=list)
    ms: int = Field(..., description="Wall-clock duration of the bbox check")


@app.post("/bbox-check", response_model=BboxCheckResponse)
async def bbox_check(
    request: BboxCheckRequest,
    x_render_key: str = Header(""),
):
    """Deterministic overflow lint: walks the rendered shadow DOM and reports
    every visible text/media element whose bounding box crosses the canvas
    edge at any of the supplied timestamps.

    Returns `ok=true, violations=[]` when every leaf-text and media element
    renders fully within the canvas at every sampled timestamp. The pipeline
    consumes this verdict to fire one corrective regen (demote font tier)
    before shipping the shot — closing the loop the LLM reviewer leaves open.
    """
    _verify_key(x_render_key)

    for t in request.timestamps:
        if t < 0 or t > 600:
            raise HTTPException(status_code=400, detail=f"timestamp out of range: {t}")

    import time as _time
    start = _time.monotonic()
    try:
        worker = get_screenshot_worker()
        rows = await worker.bbox_check_shot(
            html=request.html,
            width=request.width,
            height=request.height,
            timestamps=request.timestamps,
            background=request.background,
            keep_out=request.keep_out,
            check_squeeze=request.check_squeeze,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("bbox-check failed")
        raise HTTPException(status_code=500, detail=f"bbox-check failed: {exc}")
    elapsed_ms = int((_time.monotonic() - start) * 1000)

    violations = [
        BboxViolation(
            t=float(row["t"]),
            selector=str(row.get("selector", "?")),
            rect=BboxViolationRect(**(row.get("rect") or {"l": 0, "t": 0, "r": 0, "b": 0})),
            text=str(row.get("text", "")),
            is_media=bool(row.get("is_media", False)),
            zone=str(row.get("zone", "") or ""),
        )
        for row in rows
    ]
    return BboxCheckResponse(ok=not violations, violations=violations, ms=elapsed_ms)


# ---------------------------------------------------------------------------
# Shot preview MP4 — single-shot debug render
#
# Renders one shot's HTML at every frame across `duration_seconds` and returns
# a short MP4 (no audio). Used to iterate on shot HTML quickly without paying
# the cost of a full multi-minute /jobs render.
# ---------------------------------------------------------------------------

class ShotPreviewRequest(BaseModel):
    """Single-shot preview-MP4 request.

    Accepts BOTH the explicit `{width, height, duration_seconds}` shape AND
    a timeline entry shape `{html, inTime, exitTime, htmlEndX, htmlEndY, ...}`
    so you can paste a `timeline.entries[i]` object verbatim. Extra fields
    (id, z, sound_cues, etc.) are ignored.

    Resolution rules:
      - width  ← `width` if set, else `htmlEndX - htmlStartX`
      - height ← `height` if set, else `htmlEndY - htmlStartY`
      - duration_seconds ← `duration_seconds` if set, else `exitTime - inTime`
    """

    # Required — the only truly mandatory field.
    html: str = Field(..., description="Shot HTML (inline <style>/<script>/<svg> all OK)")

    # Timeline-entry shape (paste-friendly). Optional individually; one of
    # each pair must resolve to a positive value at request time.
    inTime: Optional[float] = Field(default=None, description="Timeline entry start time (used to compute duration)")
    exitTime: Optional[float] = Field(default=None, description="Timeline entry end time (used to compute duration)")
    htmlStartX: int = Field(default=0, description="Timeline entry left offset; subtracted from htmlEndX")
    htmlStartY: int = Field(default=0, description="Timeline entry top offset; subtracted from htmlEndY")
    htmlEndX: Optional[int] = Field(default=None, description="Timeline entry right edge (used to compute width)")
    htmlEndY: Optional[int] = Field(default=None, description="Timeline entry bottom edge (used to compute height)")

    # Explicit overrides — take precedence over timeline-derived values.
    width: Optional[int] = Field(default=None, gt=0, le=4096, description="Override viewport width")
    height: Optional[int] = Field(default=None, gt=0, le=4096, description="Override viewport height")
    duration_seconds: Optional[float] = Field(default=None, gt=0, le=60, description="Override duration (≤60s)")

    fps: int = Field(default=25, description="Frames per second (15, 20, 25, 30, or 60)")
    background: str = Field(default="#0a0e27", description="Harness fill color where the shot is transparent")
    shot_type: Optional[str] = Field(
        default=None,
        description="Timeline entry's shot_type (e.g. 'SOURCE_CLIP'). Used by the "
                    "production-equivalent preprocessing — for SOURCE_CLIP, inline "
                    "<video data-source-clip> tags are stripped. Safe to omit for "
                    "regular shots; defaults to None.",
    )

    # Pydantic v2: silently drop unknown fields (id, z, sound_cues, ...)
    model_config = {"extra": "ignore"}


@app.post("/shot/preview-mp4")
async def preview_shot_mp4(
    request: ShotPreviewRequest,
    x_render_key: str = Header(""),
):
    """Render one shot's HTML to a short MP4 (no audio).

    Synchronous — for a 9s shot at 25fps that's 225 frames, ~30-60s wall-clock
    on the worker. Use this to test individual shot HTML changes (positioning,
    animations, GSAP timing) without re-rendering the full video.

    Returns the MP4 bytes directly with `Content-Type: video/mp4`. Save it to
    a file and play locally:
        curl -X POST .../shot/preview-mp4 -H "X-Render-Key: ..." \\
             -H "Content-Type: application/json" \\
             -d @shot.json --output preview.mp4
    """
    _verify_key(x_render_key)

    # Resolve dimensions: explicit override → timeline-entry derivation.
    eff_width = request.width if request.width is not None else (
        (request.htmlEndX - request.htmlStartX) if request.htmlEndX is not None else None
    )
    eff_height = request.height if request.height is not None else (
        (request.htmlEndY - request.htmlStartY) if request.htmlEndY is not None else None
    )
    eff_duration = request.duration_seconds if request.duration_seconds is not None else (
        (request.exitTime - request.inTime)
        if (request.exitTime is not None and request.inTime is not None)
        else None
    )

    if eff_width is None or eff_width <= 0:
        raise HTTPException(
            status_code=400,
            detail="width is required — provide either `width` or `htmlEndX` (with optional `htmlStartX`)",
        )
    if eff_height is None or eff_height <= 0:
        raise HTTPException(
            status_code=400,
            detail="height is required — provide either `height` or `htmlEndY` (with optional `htmlStartY`)",
        )
    if eff_duration is None or eff_duration <= 0:
        raise HTTPException(
            status_code=400,
            detail="duration_seconds is required — provide either `duration_seconds` or both `inTime` and `exitTime`",
        )

    try:
        worker = get_screenshot_worker()
        mp4_bytes = await worker.record_shot_mp4(
            html=request.html,
            width=int(eff_width),
            height=int(eff_height),
            duration_seconds=float(eff_duration),
            fps=request.fps,
            background=request.background,
            shot_type=request.shot_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("preview-mp4 failed")
        raise HTTPException(status_code=500, detail=f"preview-mp4 failed: {exc}")

    return Response(
        content=mp4_bytes,
        media_type="video/mp4",
        headers={
            "Content-Disposition": "inline; filename=shot-preview.mp4",
            "Content-Length": str(len(mp4_bytes)),
        },
    )


# ---------------------------------------------------------------------------
# Index Jobs — Video input indexing (stub for Step 1, real pipeline in Step 2)
# ---------------------------------------------------------------------------

index_jobs: Dict[str, dict] = {}


class IndexJobRequest(BaseModel):
    input_video_id: str = Field(..., description="AI Input Asset record ID (legacy field name)")
    source_url: str = Field(..., description="S3 URL of the uploaded asset")
    mode: str = Field(..., description="Video: 'podcast'|'demo'. Image: 'photo'|'screenshot'|'diagram'")
    kind: str = Field(default="video", description="'video' or 'image' — selects pipeline branch")
    callback_url: Optional[str] = Field(None, description="Webhook URL on completion")


class IndexJobResponse(BaseModel):
    job_id: str
    status: str
    message: str = ""


class IndexJobStatus(BaseModel):
    job_id: str
    input_video_id: str
    kind: str = "video"
    status: str  # queued, running, completed, failed
    progress: Optional[float] = None
    output_urls: Optional[dict] = None
    duration_seconds: Optional[float] = None  # video only
    resolution: Optional[str] = None          # video only
    width: Optional[int] = None               # image only
    height: Optional[int] = None              # image only
    error: Optional[str] = None
    created_at: str
    updated_at: str


async def _run_index_job(job_id: str, request: IndexJobRequest):
    """Run the indexing pipeline in a thread pool executor.

    Dispatches on `request.kind`:
      video → extractor.pipeline.run_index_pipeline (transcript/visuals)
      image → extractor.image_pipeline.run_image_index_pipeline (caption/ocr/face/colors)
    """
    index_jobs[job_id]["status"] = "running"
    index_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    def progress_cb(pct: float):
        index_jobs[job_id]["progress"] = pct
        index_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        if request.kind == "image":
            from extractor.image_pipeline import run_image_index_pipeline
            pipeline_fn = run_image_index_pipeline
        else:
            from extractor.pipeline import run_index_pipeline
            pipeline_fn = run_index_pipeline

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            pipeline_fn,
            request.input_video_id,
            request.source_url,
            request.mode,
            progress_cb,
        )

        index_jobs[job_id]["status"] = "completed"
        index_jobs[job_id]["progress"] = 100
        index_jobs[job_id]["output_urls"] = result["output_urls"]
        # Video-only fields (None for image jobs).
        index_jobs[job_id]["duration_seconds"] = result.get("duration_seconds")
        index_jobs[job_id]["resolution"] = result.get("resolution")
        # Image-only fields (None for video jobs).
        index_jobs[job_id]["width"] = result.get("width")
        index_jobs[job_id]["height"] = result.get("height")
        index_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Index job {job_id} ({request.kind}) completed: {list(result['output_urls'].keys())}")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "input_video_id": request.input_video_id,
                "job_id": job_id,
                "status": "completed",
                "output_urls": result["output_urls"],
                "duration_seconds": result.get("duration_seconds"),
                "resolution": result.get("resolution"),
                "width": result.get("width"),
                "height": result.get("height"),
            })

    except Exception as e:
        error_msg = str(e)
        index_jobs[job_id]["status"] = "failed"
        index_jobs[job_id]["error"] = error_msg
        index_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.error(f"Index job {job_id} failed: {error_msg}", exc_info=True)

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "input_video_id": request.input_video_id,
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            })


@app.post("/index-jobs", response_model=IndexJobResponse)
async def submit_index_job(
    request: IndexJobRequest,
    x_render_key: str = Header(""),
):
    _verify_key(x_render_key)

    # Shared capacity check: render + index jobs compete for the same CPU
    active_render = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
    active_index = sum(1 for j in index_jobs.values() if j["status"] in ("queued", "running"))
    active_total = active_render + active_index
    if active_total >= MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy ({active_total}/{MAX_CONCURRENT_JOBS} jobs running)",
        )

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    index_jobs[job_id] = {
        "job_id": job_id,
        "input_video_id": request.input_video_id,
        "kind": request.kind,
        "status": "queued",
        "progress": 0,
        "output_urls": None,
        "duration_seconds": None,
        "resolution": None,
        "width": None,
        "height": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    asyncio.create_task(_run_index_job(job_id, request))

    return IndexJobResponse(job_id=job_id, status="queued", message="Index job submitted")


@app.get("/index-jobs/{job_id}", response_model=IndexJobStatus)
async def get_index_job_status(job_id: str, x_render_key: str = Header("")):
    _verify_key(x_render_key)

    if job_id not in index_jobs:
        raise HTTPException(status_code=404, detail="Index job not found")

    j = index_jobs[job_id]
    return IndexJobStatus(**j)


# ---------------------------------------------------------------------------
# PDF OCR Jobs — handwritten answer-sheet layout extraction for ai_service
# copy-check. Produces a LayoutMap (line_id → box + text + conf + region list)
# that the LLM grader references when assigning verdicts to lines.
# ---------------------------------------------------------------------------

pdf_ocr_jobs: Dict[str, dict] = {}


class PdfOcrJobRequest(BaseModel):
    pdf_url: str = Field(..., description="Public URL of the PDF to OCR")
    job_id: Optional[str] = Field(default=None, description="Optional job ID (generated if not provided)")
    dpi: int = Field(default=200, ge=72, le=400, description="Rasterization DPI for OCR")
    callback_url: Optional[str] = Field(None, description="Webhook URL on completion")


class PdfOcrJobResponse(BaseModel):
    job_id: str
    status: str
    message: str = ""


class PdfOcrJobStatus(BaseModel):
    job_id: str
    pdf_url: str
    status: str  # queued, running, completed, failed
    progress: Optional[float] = None
    layout_map: Optional[dict] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


async def _run_pdf_ocr_job(job_id: str, request: PdfOcrJobRequest):
    pdf_ocr_jobs[job_id]["status"] = "running"
    pdf_ocr_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    def progress_cb(pct: float):
        pdf_ocr_jobs[job_id]["progress"] = pct
        pdf_ocr_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        from pdf_ocr import run_pdf_ocr_pipeline

        loop = asyncio.get_event_loop()
        layout_map = await loop.run_in_executor(
            None,
            run_pdf_ocr_pipeline,
            request.pdf_url,
            progress_cb,
            request.dpi,
        )

        pdf_ocr_jobs[job_id]["status"] = "completed"
        pdf_ocr_jobs[job_id]["progress"] = 100
        pdf_ocr_jobs[job_id]["layout_map"] = layout_map
        pdf_ocr_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"PDF-OCR job {job_id} completed in {layout_map.get('duration_ms')}ms")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "completed",
                "layout_map": layout_map,
            })

    except Exception as e:
        error_msg = str(e)
        pdf_ocr_jobs[job_id]["status"] = "failed"
        pdf_ocr_jobs[job_id]["error"] = error_msg
        pdf_ocr_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.exception(f"PDF-OCR job {job_id} failed")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            })


@app.post("/pdf-ocr-jobs", response_model=PdfOcrJobResponse)
async def submit_pdf_ocr_job(
    request: PdfOcrJobRequest,
    x_render_key: str = Header(""),
):
    _verify_key(x_render_key)

    active_render = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
    active_index = sum(1 for j in index_jobs.values() if j["status"] in ("queued", "running"))
    active_pdf = sum(1 for j in pdf_ocr_jobs.values() if j["status"] in ("queued", "running"))
    active_total = active_render + active_index + active_pdf
    if active_total >= MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy ({active_total}/{MAX_CONCURRENT_JOBS} jobs running)",
        )

    job_id = request.job_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    pdf_ocr_jobs[job_id] = {
        "job_id": job_id,
        "pdf_url": request.pdf_url,
        "status": "queued",
        "progress": 0,
        "layout_map": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    asyncio.create_task(_run_pdf_ocr_job(job_id, request))

    return PdfOcrJobResponse(job_id=job_id, status="queued", message="PDF OCR job submitted")


@app.get("/pdf-ocr-jobs/{job_id}", response_model=PdfOcrJobStatus)
async def get_pdf_ocr_job_status(job_id: str, x_render_key: str = Header("")):
    _verify_key(x_render_key)

    if job_id not in pdf_ocr_jobs:
        raise HTTPException(status_code=404, detail="PDF OCR job not found")

    j = pdf_ocr_jobs[job_id]
    return PdfOcrJobStatus(**j)


# Eviction sweeper: layout_map blobs can be MBs each and we never delete
# them, so the dict grows unbounded across uptime. Drop terminal-state
# entries older than PDF_OCR_JOB_TTL_SECONDS at a low cadence.
PDF_OCR_JOB_TTL_SECONDS = int(os.environ.get("PDF_OCR_JOB_TTL_SECONDS", str(24 * 3600)))


async def _pdf_ocr_jobs_sweeper():
    while True:
        try:
            await asyncio.sleep(600)  # every 10 minutes
            now = datetime.now(timezone.utc)
            stale: list[str] = []
            for jid, j in pdf_ocr_jobs.items():
                if j["status"] not in ("completed", "failed"):
                    continue
                try:
                    updated = datetime.fromisoformat(j["updated_at"])
                except Exception:
                    continue
                if (now - updated).total_seconds() > PDF_OCR_JOB_TTL_SECONDS:
                    stale.append(jid)
            for jid in stale:
                pdf_ocr_jobs.pop(jid, None)
            if stale:
                logger.info("pdf-ocr-jobs sweeper evicted %d stale entries", len(stale))
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("pdf-ocr-jobs sweeper failed")


@app.on_event("startup")
async def _start_pdf_ocr_sweeper():
    asyncio.create_task(_pdf_ocr_jobs_sweeper())


# ---------------------------------------------------------------------------
# Concat Audio — merge Lyria-generated background-music segments
# ---------------------------------------------------------------------------

class ConcatAudioSegment(BaseModel):
    url: str = Field(..., description="Public S3 URL of the segment MP3")
    fade_in: float = Field(default=0.0, ge=0.0, description="Fade-in seconds for this segment")
    fade_out: float = Field(default=0.0, ge=0.0, description="Fade-out seconds for this segment")


class ConcatAudioRequest(BaseModel):
    segments: List[ConcatAudioSegment] = Field(..., description="Ordered list of audio segments")
    crossfade_seconds: float = Field(default=2.0, ge=0.0, le=10.0, description="Crossfade duration between adjacent segments")
    output_key: str = Field(..., description="Destination S3 key for the merged MP3")
    bucket: Optional[str] = Field(default=None, description="S3 bucket (defaults to AWS_BUCKET_NAME env)")


class ConcatAudioResponse(BaseModel):
    url: str
    duration: float


@app.post("/concat_audio", response_model=ConcatAudioResponse)
async def concat_audio(request: ConcatAudioRequest, x_render_key: str = Header("")):
    """Download segment MP3s, crossfade them via ffmpeg, upload the merged track.

    Used by the AI-video-gen pipeline when Lyria generates multiple music
    segments (video duration > ~170s). Single-segment videos skip this call
    entirely on the caller side.
    """
    _verify_key(x_render_key)

    if not request.segments:
        raise HTTPException(status_code=400, detail="segments is required")

    import shutil
    import subprocess
    import tempfile
    from pathlib import Path
    from urllib.request import Request as _UrlReq, urlopen

    if shutil.which("ffmpeg") is None:
        raise HTTPException(status_code=500, detail="ffmpeg not installed on render worker")

    bucket = request.bucket or os.environ.get("AWS_BUCKET_NAME", "vacademy-media-storage")
    try:
        import boto3  # type: ignore
    except ImportError:
        raise HTTPException(status_code=500, detail="boto3 not installed on render worker")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        local_files: List[Path] = []
        for i, seg in enumerate(request.segments):
            dst = tmp / f"seg_{i:02d}.mp3"
            try:
                req = _UrlReq(seg.url, headers={"User-Agent": "VacademyRenderWorker/1.0"})
                with urlopen(req, timeout=120) as resp:
                    dst.write_bytes(resp.read())
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Failed to fetch segment {i}: {exc}")
            local_files.append(dst)

        output = tmp / "music.mp3"
        if len(local_files) == 1:
            # Still apply fades to the single clip so intro/outro are not abrupt.
            seg = request.segments[0]
            afilter = []
            if seg.fade_in > 0:
                afilter.append(f"afade=t=in:st=0:d={seg.fade_in}")
            if seg.fade_out > 0:
                # Apply at the end — requires knowing duration; use areverse trick via ffprobe
                duration = _probe_duration(local_files[0])
                start = max(0.0, duration - seg.fade_out)
                afilter.append(f"afade=t=out:st={start}:d={seg.fade_out}")
            afilter_str = ",".join(afilter) if afilter else "anull"
            cmd = [
                "ffmpeg", "-y", "-i", str(local_files[0]),
                "-af", afilter_str, "-b:a", "192k", str(output),
            ]
        else:
            # Build acrossfade filter graph for N segments.
            inputs: List[str] = []
            for f in local_files:
                inputs.extend(["-i", str(f)])
            filter_parts: List[str] = []
            prev = "[0:a]"
            for i in range(1, len(local_files)):
                out_label = f"[a{i}]"
                filter_parts.append(
                    f"{prev}[{i}:a]acrossfade=d={request.crossfade_seconds}"
                    f":c1=tri:c2=tri{out_label}"
                )
                prev = out_label
            filter_graph = ";".join(filter_parts)
            cmd = [
                "ffmpeg", "-y", *inputs,
                "-filter_complex", filter_graph,
                "-map", prev, "-b:a", "192k", str(output),
            ]

        result = subprocess.run(cmd, capture_output=True, timeout=600)
        if result.returncode != 0 or not output.exists():
            stderr = result.stderr.decode("utf-8", errors="replace")[-1000:]
            raise HTTPException(status_code=500, detail=f"ffmpeg concat failed: {stderr}")

        merged_duration = _probe_duration(output)
        audio_bytes = output.read_bytes()

        s3 = boto3.client(
            "s3",
            aws_access_key_id=os.environ.get("S3_AWS_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID") or None,
            aws_secret_access_key=os.environ.get("S3_AWS_ACCESS_SECRET") or os.environ.get("AWS_SECRET_ACCESS_KEY") or None,
            region_name=os.environ.get("S3_AWS_REGION") or os.environ.get("AWS_REGION", "ap-south-1"),
        )
        try:
            s3.put_object(
                Bucket=bucket, Key=request.output_key,
                Body=audio_bytes, ContentType="audio/mpeg",
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"S3 upload failed: {exc}")

        merged_url = f"https://{bucket}.s3.amazonaws.com/{request.output_key}"
        return ConcatAudioResponse(url=merged_url, duration=merged_duration)


def _probe_duration(path) -> float:
    """Best-effort MP3 duration via ffprobe; returns 0.0 on failure."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            timeout=30,
        )
        return float(out.strip())
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Audio slice / splice — sentence-level operations for the script editor
#
# slice_audio: cut one MP3 into N stream-copied clips. Used both during
# generation (post-TTS, to persist per-sentence clips) and on demand to
# backfill sentences[] for older videos. Stream copy is lossless; slices
# align to MP3 frame boundaries (~26 ms) which is fine for sentence cuts.
#
# splice_audio: replace a time range of an MP3 with a new clip, crossfading
# both joins. Used when the editor re-narrates a single sentence — returns
# the new total duration and the delta vs the original so the caller can
# ripple downstream timestamps.
# ---------------------------------------------------------------------------

class SliceCutModel(BaseModel):
    id: str = Field(..., description="Stable id used in the output S3 key and returned to the caller")
    start: float = Field(..., ge=0.0, description="Start time in seconds")
    end: float = Field(..., gt=0.0, description="End time in seconds (exclusive)")


class SliceAudioRequest(BaseModel):
    audio_url: str = Field(..., description="Public S3 URL of the source MP3")
    cuts: List[SliceCutModel] = Field(..., min_length=1, description="Cuts to extract")
    output_prefix: str = Field(..., description="S3 key prefix; clips upload to {prefix}{id}.mp3")
    bucket: Optional[str] = Field(default=None, description="S3 bucket (defaults to AWS_BUCKET_NAME env)")


class SliceClipResponse(BaseModel):
    id: str
    audio_url: str
    duration: float


class SliceAudioResponse(BaseModel):
    clips: List[SliceClipResponse]


@app.post("/audio/slice", response_model=SliceAudioResponse)
async def slice_audio_endpoint(request: SliceAudioRequest, x_render_key: str = Header("")):
    """Cut a single MP3 into N independent clips and upload each to S3.

    Synchronous because slicing a typical 60s narration into ~30 sentences
    finishes in well under a second on the worker hardware. If we ever need
    to slice multi-hour audio this should move to the background job model.
    """
    _verify_key(x_render_key)
    from audio_ops import AudioOpsError, SliceCut, slice_audio

    cuts = [SliceCut(id=c.id, start=c.start, end=c.end) for c in request.cuts]
    try:
        results = slice_audio(
            audio_url=request.audio_url,
            cuts=cuts,
            output_prefix=request.output_prefix,
            bucket=request.bucket,
        )
    except AudioOpsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("slice_audio failed")
        raise HTTPException(status_code=500, detail=f"slice_audio failed: {exc}")

    return SliceAudioResponse(
        clips=[SliceClipResponse(id=r.id, audio_url=r.audio_url, duration=r.duration) for r in results]
    )


class SpliceReplacement(BaseModel):
    new_clip_url: str = Field(..., description="Public S3 URL of the replacement MP3")
    replace_start: float = Field(..., ge=0.0, description="Start of the range to replace, in seconds")
    replace_end: float = Field(..., gt=0.0, description="End of the range to replace, in seconds (exclusive)")
    crossfade_ms: int = Field(default=50, ge=0, le=2000, description="Crossfade duration at each join")
    head_pad_ms: int = Field(default=40, ge=0, le=500, description="Shift the splice boundary this many ms later — preserves the previous word's natural acoustic tail at sentence boundaries")


class SpliceAudioRequest(BaseModel):
    base_audio_url: str = Field(..., description="Public S3 URL of the original MP3 to splice into")
    replacement: SpliceReplacement
    output_key: str = Field(..., description="Destination S3 key for the spliced MP3")
    bucket: Optional[str] = Field(default=None, description="S3 bucket (defaults to AWS_BUCKET_NAME env)")


class SpliceAudioResponse(BaseModel):
    output_url: str
    new_duration: float
    duration_delta: float = Field(..., description="new_duration − base_duration; ripple downstream timestamps by this")


@app.post("/audio/splice", response_model=SpliceAudioResponse)
async def splice_audio_endpoint(request: SpliceAudioRequest, x_render_key: str = Header("")):
    """Replace a time range of an MP3 with a new clip, crossfading both joins.

    The crossfade is clamped per-side to the available audio length so that
    splicing very near the start/end of the file (or with a very short
    replacement) degrades to a hard concat instead of failing.
    """
    _verify_key(x_render_key)
    from audio_ops import AudioOpsError, splice_audio

    try:
        result = splice_audio(
            base_audio_url=request.base_audio_url,
            new_clip_url=request.replacement.new_clip_url,
            replace_start=request.replacement.replace_start,
            replace_end=request.replacement.replace_end,
            output_key=request.output_key,
            bucket=request.bucket,
            crossfade_ms=request.replacement.crossfade_ms,
            head_pad_ms=request.replacement.head_pad_ms,
        )
    except AudioOpsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("splice_audio failed")
        raise HTTPException(status_code=500, detail=f"splice_audio failed: {exc}")

    return SpliceAudioResponse(
        output_url=result.output_url,
        new_duration=result.new_duration,
        duration_delta=result.duration_delta,
    )


class SilenceRangeRequest(BaseModel):
    base_audio_url: str = Field(..., description="Public S3 URL of the original MP3")
    silence_start: float = Field(..., ge=0.0, description="Start of the range to silence, in seconds")
    silence_end: float = Field(..., gt=0.0, description="End of the range to silence, in seconds (exclusive)")
    output_key: str = Field(..., description="Destination S3 key for the silenced MP3")
    bucket: Optional[str] = Field(default=None, description="S3 bucket (defaults to AWS_S3_PUBLIC_BUCKET / AWS_BUCKET_NAME env)")
    crossfade_ms: int = Field(default=50, ge=0, le=2000)
    head_pad_ms: int = Field(default=40, ge=0, le=500)


@app.post("/audio/silence_range", response_model=SpliceAudioResponse)
async def silence_audio_range_endpoint(
    request: SilenceRangeRequest, x_render_key: str = Header(""),
):
    """Replace a range of the audio with synthesized silence of the same
    length. Total duration is preserved, downstream timestamps don't move
    — used by the editor's "mute this sentence" flow.
    """
    _verify_key(x_render_key)
    from audio_ops import AudioOpsError, silence_audio_range

    try:
        result = silence_audio_range(
            base_audio_url=request.base_audio_url,
            silence_start=request.silence_start,
            silence_end=request.silence_end,
            output_key=request.output_key,
            bucket=request.bucket,
            crossfade_ms=request.crossfade_ms,
            head_pad_ms=request.head_pad_ms,
        )
    except AudioOpsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("silence_audio_range failed")
        raise HTTPException(status_code=500, detail=f"silence_audio_range failed: {exc}")

    return SpliceAudioResponse(
        output_url=result.output_url,
        new_duration=result.new_duration,
        duration_delta=result.duration_delta,
    )


# ---------------------------------------------------------------------------
# Transcribe Jobs — Speech-to-text for long recordings
# ---------------------------------------------------------------------------

transcribe_jobs: Dict[str, dict] = {}


class TranscribeJobRequest(BaseModel):
    source_url: str = Field(..., description="S3 or public URL to audio/video file")
    language: Optional[str] = Field(None, description="'auto', 'en', 'hi', 'hinglish', or ISO 639-1 code. None = auto-detect")
    model_size: str = Field(default="base", description="Whisper model: 'base', 'small', or 'medium'")
    word_timestamps: bool = Field(default=True, description="Include word-level timestamps")
    output_formats: Optional[list] = Field(default=None, description="List of: 'json', 'srt', 'vtt', 'txt'. Default: all")
    task: str = Field(
        default="transcribe",
        description="'transcribe' (source language), 'translate' (English), or 'both' (run loaded model twice)",
    )
    callback_url: Optional[str] = Field(None, description="URL to POST on completion")


class TranscribeJobResponse(BaseModel):
    job_id: str
    status: str
    message: str = ""


class TranscribeJobStatus(BaseModel):
    job_id: str
    status: str  # queued, running, completed, failed
    progress: Optional[float] = None
    output_urls: Optional[dict] = None              # legacy: matches task
    output_urls_source: Optional[dict] = None        # populated when task in ('transcribe', 'both')
    output_urls_english: Optional[dict] = None       # populated when task in ('translate', 'both')
    duration_seconds: Optional[float] = None
    detected_language: Optional[str] = None
    language_probability: Optional[float] = None
    segment_count: Optional[int] = None
    word_count: Optional[int] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


async def _run_transcribe_job(job_id: str, request: TranscribeJobRequest):
    """Run transcription in background, update job status."""
    transcribe_jobs[job_id]["status"] = "running"
    transcribe_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        effective_model = os.getenv("WHISPER_MODEL_OVERRIDE") or request.model_size
        result = await transcribe_worker.transcribe(
            job_id=job_id,
            source_url=request.source_url,
            language=request.language,
            model_size=effective_model,
            word_timestamps=request.word_timestamps,
            output_formats=request.output_formats,
            task=request.task,
            on_progress=lambda p: _update_transcribe_progress(job_id, p),
        )

        transcribe_jobs[job_id]["status"] = "completed"
        transcribe_jobs[job_id]["progress"] = 100
        transcribe_jobs[job_id]["output_urls"] = {
            k: v for k, v in result.items()
            if k.endswith("_url")
        }
        transcribe_jobs[job_id]["output_urls_source"] = result.get("output_urls_source")
        transcribe_jobs[job_id]["output_urls_english"] = result.get("output_urls_english")
        transcribe_jobs[job_id]["duration_seconds"] = result.get("duration_seconds")
        transcribe_jobs[job_id]["detected_language"] = result.get("detected_language")
        transcribe_jobs[job_id]["language_probability"] = result.get("language_probability")
        transcribe_jobs[job_id]["segment_count"] = result.get("segment_count")
        transcribe_jobs[job_id]["word_count"] = result.get("word_count")
        transcribe_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(f"Transcribe job {job_id} completed: {result.get('segment_count')} segments, {result.get('duration_seconds')}s")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "completed",
                **result,
            })

    except Exception as e:
        error_msg = str(e)
        transcribe_jobs[job_id]["status"] = "failed"
        transcribe_jobs[job_id]["error"] = error_msg
        transcribe_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.error(f"Transcribe job {job_id} failed: {error_msg}", exc_info=True)

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            })


def _update_transcribe_progress(job_id: str, progress: float):
    if job_id in transcribe_jobs:
        transcribe_jobs[job_id]["progress"] = round(progress, 1)
        transcribe_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()


@app.post("/transcribe-jobs", response_model=TranscribeJobResponse)
async def submit_transcribe_job(
    request: TranscribeJobRequest,
    x_render_key: str = Header(""),
):
    _verify_key(x_render_key)

    # Validate model_size
    if request.model_size not in ("base", "small", "medium"):
        raise HTTPException(status_code=400, detail="model_size must be 'base', 'small', or 'medium'")

    # Validate task
    if request.task not in ("transcribe", "translate", "both"):
        raise HTTPException(status_code=400, detail="task must be 'transcribe', 'translate', or 'both'")

    # Shared capacity check: all job types compete for CPU/RAM
    active_render = sum(1 for j in jobs.values() if j["status"] in ("queued", "running"))
    active_index = sum(1 for j in index_jobs.values() if j["status"] in ("queued", "running"))
    active_transcribe = sum(1 for j in transcribe_jobs.values() if j["status"] in ("queued", "running"))
    active_total = active_render + active_index + active_transcribe
    if active_total >= MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy ({active_total}/{MAX_CONCURRENT_JOBS} jobs running)",
        )

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    transcribe_jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0,
        "output_urls": None,
        "output_urls_source": None,
        "output_urls_english": None,
        "duration_seconds": None,
        "detected_language": None,
        "language_probability": None,
        "segment_count": None,
        "word_count": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    asyncio.create_task(_run_transcribe_job(job_id, request))

    return TranscribeJobResponse(job_id=job_id, status="queued", message="Transcription job submitted")


@app.get("/transcribe-jobs/{job_id}", response_model=TranscribeJobStatus)
async def get_transcribe_job_status(job_id: str, x_render_key: str = Header("")):
    _verify_key(x_render_key)

    if job_id not in transcribe_jobs:
        raise HTTPException(status_code=404, detail="Transcribe job not found")

    j = transcribe_jobs[job_id]
    return TranscribeJobStatus(**j)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# PPTX -> animated-HTML jobs (LibreOffice build-step snapshots + manifest)
# ---------------------------------------------------------------------------

pptx_anim_jobs: Dict[str, dict] = {}

PPTX_ANIM_JOB_TTL_SECONDS = int(os.environ.get("PPTX_ANIM_JOB_TTL_SECONDS", str(24 * 3600)))


class PptxAnimJobRequest(BaseModel):
    pptx_url: str
    deck_id: Optional[str] = None
    dpi: int = 110
    job_id: Optional[str] = None
    callback_url: Optional[str] = None


class PptxAnimJobResponse(BaseModel):
    job_id: str
    status: str
    message: str


class PptxAnimJobStatus(BaseModel):
    job_id: str
    pptx_url: str
    status: str  # queued, running, completed, failed
    progress: Optional[float] = None
    result: Optional[dict] = None  # {deck_base, manifest_url, slide_count, step_count, manifest}
    error: Optional[str] = None
    created_at: str
    updated_at: str


async def _run_pptx_anim_job(job_id: str, request: PptxAnimJobRequest):
    pptx_anim_jobs[job_id]["status"] = "running"
    pptx_anim_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    def progress_cb(pct: float):
        pptx_anim_jobs[job_id]["progress"] = pct
        pptx_anim_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        from pptx_anim import convert_deck_to_s3

        deck_id = request.deck_id or job_id
        # LibreOffice render is blocking/CPU-bound — keep it off the event loop.
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            convert_deck_to_s3,
            request.pptx_url,
            deck_id,
            request.dpi,
            progress_cb,
        )

        pptx_anim_jobs[job_id]["status"] = "completed"
        pptx_anim_jobs[job_id]["progress"] = 100
        pptx_anim_jobs[job_id]["result"] = result
        pptx_anim_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.info(
            f"PPTX-anim job {job_id} completed: {result['slide_count']} slides, "
            f"{result['step_count']} steps"
        )

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "completed",
                "result": result,
            })

    except Exception as e:
        error_msg = str(e)
        pptx_anim_jobs[job_id]["status"] = "failed"
        pptx_anim_jobs[job_id]["error"] = error_msg
        pptx_anim_jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        logger.exception(f"PPTX-anim job {job_id} failed")

        if request.callback_url:
            await _send_callback(request.callback_url, {
                "job_id": job_id,
                "status": "failed",
                "error": error_msg,
            })


@app.post("/pptx-anim-jobs", response_model=PptxAnimJobResponse)
async def submit_pptx_anim_job(
    request: PptxAnimJobRequest,
    x_render_key: str = Header(""),
):
    _verify_key(x_render_key)

    active = sum(
        1
        for d in (jobs, index_jobs, pdf_ocr_jobs, pptx_anim_jobs)
        for j in d.values()
        if j["status"] in ("queued", "running")
    )
    if active >= MAX_CONCURRENT_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"Server busy ({active}/{MAX_CONCURRENT_JOBS} jobs running)",
        )

    job_id = request.job_id or str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    pptx_anim_jobs[job_id] = {
        "job_id": job_id,
        "pptx_url": request.pptx_url,
        "status": "queued",
        "progress": 0,
        "result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }

    asyncio.create_task(_run_pptx_anim_job(job_id, request))

    return PptxAnimJobResponse(job_id=job_id, status="queued", message="PPTX anim job submitted")


@app.get("/pptx-anim-jobs/{job_id}", response_model=PptxAnimJobStatus)
async def get_pptx_anim_job_status(job_id: str, x_render_key: str = Header("")):
    _verify_key(x_render_key)
    if job_id not in pptx_anim_jobs:
        raise HTTPException(status_code=404, detail="PPTX anim job not found")
    return PptxAnimJobStatus(**pptx_anim_jobs[job_id])


async def _pptx_anim_jobs_sweeper():
    # result blobs are tiny (lists of filenames) but the dict still grows
    # unbounded across uptime; drop terminal entries past their TTL.
    while True:
        try:
            await asyncio.sleep(600)  # every 10 minutes
            now = datetime.now(timezone.utc)
            stale = []
            for jid, j in pptx_anim_jobs.items():
                if j["status"] not in ("completed", "failed"):
                    continue
                try:
                    updated = datetime.fromisoformat(j["updated_at"])
                except Exception:
                    continue
                if (now - updated).total_seconds() > PPTX_ANIM_JOB_TTL_SECONDS:
                    stale.append(jid)
            for jid in stale:
                pptx_anim_jobs.pop(jid, None)
            if stale:
                logger.info(f"Swept {len(stale)} stale PPTX-anim jobs")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("PPTX-anim sweeper error")


@app.on_event("startup")
async def _start_pptx_anim_sweeper():
    asyncio.create_task(_pptx_anim_jobs_sweeper())


@app.on_event("startup")
async def startup():
    logger.info(f"Render Worker started (max {MAX_CONCURRENT_JOBS} concurrent jobs)")
