"""Lesson mode — the teacher track, rendered by the Spatius Video API.

One Spatius job renders the WHOLE voice narration (one continuous track keeps
lip-sync exact and avoids an opening/closing transition per section). The
avatar comes back head-and-shoulders on a solid green background; per run of
sections that share a layout we cut that stretch, key the green out, crop to
the layout's framing and encode a transparent VP9 WebM. The timeline overlay
plays those clips (see lesson_mode.build_teacher_entries).

Measured on the Video API (2026-10-12):
  * a 40 s WAV renders in ~55-65 s; output h264 25 fps + AAC copy of our audio;
  * the voice sits at a constant +0.20 s inside the MP4 (no drift) and the MP4
    runs ~1.8 s longer (closing transition) — the offset is measured per job;
  * one job at a time per app: a second POST answers 429 → wait for the slot;
  * `videoUrl` is a signed link valid ~15 minutes → download immediately.

Deliberately free of `app.*` imports: inside ai-service the package is
`ai_service.app`, and a bare `app.` import silently fails there.
Env: SPATIUS_API_KEY, SPATIUS_APP_ID, optional SPATIUS_OPEN_API_BASE;
S3_AWS_ACCESS_KEY / S3_AWS_ACCESS_SECRET / S3_AWS_REGION, AWS_S3_PUBLIC_BUCKET.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

OPEN_API_BASE = "https://console.spatius.ai/v1/open"
RENDER_W, RENDER_H = 1920, 1080
GREEN_HEX = "#00B140"
GREEN_RGB = (0x00, 0xB1, 0x40)

# Vendor: 50 credits per generated minute; ≈ $0.0009 per credit on Starter.
SPATIUS_CREDITS_PER_MINUTE = 50
VENDOR_USD_PER_MINUTE = 0.045
# Display estimate only. The institute is charged by video_generation_service:
# the returned video's seconds × ai_models 'spatius/video' price × the live
# credit ratio (credit_rate_config: 100 credits per $ + 50% margin = 150 per $,
# so 1 platform credit ≈ $0.0067). This module stays free of app imports, so
# the estimate uses the seeded ratio.
DISPLAY_CREDITS_PER_USD = 150.0

DEFAULT_OFFSET_S = 0.20
CACHE_NAME = "lesson_teacher.json"


class TeacherRenderError(RuntimeError):
    pass


def configured() -> bool:
    return bool(_api_key() and _app_id())


def _api_key() -> str:
    return (os.environ.get("SPATIUS_API_KEY") or "").strip()


def _app_id() -> str:
    return (os.environ.get("SPATIUS_APP_ID") or "").strip()


def _base() -> str:
    return (os.environ.get("SPATIUS_OPEN_API_BASE") or OPEN_API_BASE).strip().rstrip("/")


def _headers() -> Dict[str, str]:
    return {"X-API-Key": _api_key(), "X-App-ID": _app_id(), "Content-Type": "application/json"}


def _vendor_error(body: Any) -> Optional[str]:
    """Spatius answers some failures with HTTP 200 and an `errors` body."""
    if isinstance(body, dict):
        if body.get("errors"):
            return json.dumps(body["errors"])[:300]
        err = body.get("error")
        if isinstance(err, dict):
            return f"{err.get('code')}: {err.get('message')}"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Spatius Video API
# ─────────────────────────────────────────────────────────────────────────────

def submit_video(
    avatar_id: str,
    audio_url: str,
    *,
    name: str,
    client: Optional[httpx.Client] = None,
    slot_wait_s: float = 1500.0,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """POST /videos. Retries 429 (one job at a time per app) until a slot opens."""
    body = {
        "avatarId": avatar_id,
        "audioUrl": audio_url,
        "name": name[:128],
        "requestId": str(uuid.uuid4()),
        "video": {
            "width": RENDER_W, "height": RENDER_H, "fit": "contain",
            "backgroundColor": GREEN_HEX,
        },
    }
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        deadline = time.monotonic() + slot_wait_s
        delay = 15.0
        while True:
            r = client.post(f"{_base()}/videos", headers=_headers(), json=body)
            if r.status_code == 429 and time.monotonic() < deadline:
                sleep(delay)
                delay = min(60.0, delay * 1.5)
                continue
            try:
                data = r.json()
            except ValueError:
                data = {}
            if r.status_code >= 400 or _vendor_error(data):
                raise TeacherRenderError(
                    f"Spatius video submit failed ({r.status_code}): {_vendor_error(data) or r.text[:200]}"
                )
            job_id = data.get("jobId") or data.get("id")
            if not job_id:
                raise TeacherRenderError(f"Spatius video submit returned no jobId: {str(data)[:200]}")
            return str(job_id)
    finally:
        if own:
            client.close()


def wait_for_video(
    job_id: str,
    *,
    timeout_s: float,
    poll_s: float = 12.0,
    client: Optional[httpx.Client] = None,
    sleep: Callable[[float], None] = time.sleep,
    on_progress: Optional[Callable[[str], None]] = None,
) -> str:
    """Poll the job until it succeeds; return the (short-lived) MP4 URL."""
    own = client is None
    client = client or httpx.Client(timeout=30)
    try:
        deadline = time.monotonic() + timeout_s
        last_stage = None
        while True:
            r = client.get(f"{_base()}/video-jobs/{job_id}", headers=_headers())
            data = r.json() if r.status_code < 500 else {}
            job = data.get("job") or {}
            status = str(job.get("status") or "")
            stage = str((job.get("progress") or {}).get("stage") or status)
            if on_progress and stage != last_stage:
                on_progress(stage)
                last_stage = stage
            if status == "succeeded":
                url = data.get("videoUrl")
                if not url:
                    raise TeacherRenderError("Spatius job succeeded without a videoUrl")
                return str(url)
            if status in ("failed", "expired"):
                raise TeacherRenderError(f"Spatius job {status}: {json.dumps(job.get('error') or job)[:300]}")
            if r.status_code >= 400 and r.status_code != 429:
                raise TeacherRenderError(f"Spatius job poll {r.status_code}: {r.text[:200]}")
            if time.monotonic() > deadline:
                raise TeacherRenderError(f"Spatius job {job_id} still {status or 'unknown'} after {timeout_s:.0f}s")
            sleep(poll_s)
    finally:
        if own:
            client.close()


def render_timeout_s(audio_seconds: float) -> float:
    """Generous budget: measured ~1.5x realtime, plus queueing behind other jobs."""
    return max(600.0, audio_seconds * 4.0 + 300.0)


# ─────────────────────────────────────────────────────────────────────────────
# Media helpers (ffmpeg)
# ─────────────────────────────────────────────────────────────────────────────

def _ffmpeg() -> str:
    return os.environ.get("FFMPEG_BIN") or "ffmpeg"


def _run(cmd: List[str], timeout: float = 900) -> None:
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if p.returncode != 0:
        raise TeacherRenderError(f"ffmpeg failed ({p.returncode}): {(p.stderr or '')[-400:]}")


def media_duration(path: Path) -> float:
    p = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=30,
    )
    try:
        return float((p.stdout or "0").strip() or 0)
    except ValueError:
        return 0.0


def to_wav(src: Path, out: Path) -> Path:
    _run([_ffmpeg(), "-v", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "24000",
          "-c:a", "pcm_s16le", str(out)], timeout=300)
    return out


def _pcm_envelope(path: Path, rate: int = 8000, hop: int = 80):
    import numpy as np
    p = subprocess.run(
        [_ffmpeg(), "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "s16le", "-"],
        capture_output=True, timeout=300,
    )
    if p.returncode != 0 or not p.stdout:
        raise TeacherRenderError("could not decode audio for offset measurement")
    x = np.abs(np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32))
    n = len(x) // hop
    return x[: n * hop].reshape(n, hop).mean(axis=1)  # 10 ms bins


def measure_offset(reference_audio: Path, rendered_mp4: Path, *, max_offset_s: float = 2.0) -> float:
    """Where our narration starts inside the Spatius MP4 (seconds).

    Cross-correlates 10 ms loudness envelopes over the first ~60 s. Falls back
    to the measured constant when the signal is unusable."""
    try:
        import numpy as np
        ref = _pcm_envelope(reference_audio)
        out = _pcm_envelope(rendered_mp4)
        win = min(len(ref), 6000)
        if win < 200:
            return DEFAULT_OFFSET_S
        ref_w = ref[:win] - ref[:win].mean()
        best_k, best_v = 0, -1e30
        for k in range(0, int(max_offset_s * 100) + 1):
            seg = out[k:k + win]
            if len(seg) < win:
                break
            v = float(np.dot(ref_w, seg - seg.mean()))
            if v > best_v:
                best_k, best_v = k, v
        return round(best_k / 100.0, 2)
    except Exception:
        return DEFAULT_OFFSET_S


def subject_box(mp4: Path, at_s: float) -> Tuple[int, int, int, int]:
    """Bounding box (x0, y0, x1, y1) of the non-green pixels in one frame."""
    import numpy as np
    p = subprocess.run(
        [_ffmpeg(), "-v", "error", "-ss", f"{at_s:.2f}", "-i", str(mp4), "-frames:v", "1",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, timeout=60,
    )
    if p.returncode != 0 or len(p.stdout) < RENDER_W * RENDER_H * 3:
        return (RENDER_W // 4, RENDER_H // 10, RENDER_W * 3 // 4, RENDER_H)
    img = np.frombuffer(p.stdout[: RENDER_W * RENDER_H * 3], dtype=np.uint8).reshape(RENDER_H, RENDER_W, 3)
    d = np.abs(img.astype(np.int16) - np.array(GREEN_RGB, dtype=np.int16)).sum(axis=2)
    ys, xs = np.where(d > 90)
    if len(xs) < 1000:
        return (RENDER_W // 4, RENDER_H // 10, RENDER_W * 3 // 4, RENDER_H)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def head_center_x(box: Tuple[int, int, int, int]) -> int:
    return (box[0] + box[2]) // 2


def crop_for(clip_w: int, clip_h: int, box: Tuple[int, int, int, int], *, layout: str) -> Tuple[int, int, int, int]:
    """Crop (x, y, w, h) of the 1920x1080 render that frames the teacher for
    a clip of clip_w x clip_h. Head room above the hair, shoulders to the
    bottom edge; centred on the subject; clamped to the frame."""
    aspect = clip_w / float(clip_h)
    top_pad = int(RENDER_H * (0.05 if layout in ("corner", "bubble") else 0.08))
    y = max(0, box[1] - top_pad)
    h = RENDER_H - y
    if layout == "bubble":
        # Head and upper shoulders only — the circle crops the rest anyway,
        # and a tighter source keeps the face from looking tiny in 270 px.
        h = int(h * 0.74)
    w = int(round(h * aspect))
    if w > RENDER_W:
        w = RENDER_W
        h = int(round(w / aspect))
        y = RENDER_H - h
    cx = head_center_x(box)
    x = min(max(0, cx - w // 2), RENDER_W - w)
    w -= w % 2
    h -= h % 2
    return x, y, w, h


def cut_clip(
    src_mp4: Path,
    *,
    start_s: float,
    duration_s: float,
    crop: Tuple[int, int, int, int],
    out_w: int,
    out_h: int,
    out_path: Path,
) -> Path:
    """Crop, scale, key out the green and encode a transparent VP9 WebM.

    Scaled BEFORE keying: chromakey is the expensive filter (ffmpeg 5.1 on a
    1.5-CPU pod: ~0.8 s per second of 980x1020 video vs ~0.3 s at clip
    size). RGB colorkey is cheaper still but leaves a dark-green halo on hair
    and ears, so chromakey stays."""
    x, y, w, h = crop
    vf = (
        f"crop={w}:{h}:{x}:{y},scale={out_w}:{out_h}:flags=bicubic,"
        f"chromakey=0x{GREEN_RGB[0]:02X}{GREEN_RGB[1]:02X}{GREEN_RGB[2]:02X}:0.14:0.06,"
        f"despill=type=green,format=yuva420p"
    )
    _run([
        _ffmpeg(), "-v", "error", "-y",
        "-ss", f"{max(0.0, start_s):.3f}", "-i", str(src_mp4), "-t", f"{max(0.1, duration_s):.3f}",
        "-vf", vf, "-an",
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "33",
        "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
        "-threads", "2", "-tile-columns", "1",
        "-g", "12", "-auto-alt-ref", "0",
        str(out_path),
    ], timeout=max(300.0, duration_s * 6))
    return out_path


# ─────────────────────────────────────────────────────────────────────────────
# Storage
# ─────────────────────────────────────────────────────────────────────────────

def upload_public(path: Path, key: str, content_type: str) -> str:
    import boto3
    bucket = os.environ.get("AWS_S3_PUBLIC_BUCKET") or "vacademy-media-storage-public"
    kwargs: Dict[str, Any] = {"region_name": os.environ.get("S3_AWS_REGION") or os.environ.get("AWS_REGION") or "ap-south-1"}
    ak = os.environ.get("S3_AWS_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID")
    sk = os.environ.get("S3_AWS_ACCESS_SECRET") or os.environ.get("AWS_SECRET_ACCESS_KEY")
    if ak and sk:
        kwargs.update(aws_access_key_id=ak, aws_secret_access_key=sk)
    boto3.client("s3", **kwargs).upload_file(
        str(path), bucket, key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=31536000"},
    )
    return f"https://{bucket}.s3.amazonaws.com/{key}"


def _download(url: str, out: Path) -> Path:
    with httpx.stream("GET", url, timeout=300, follow_redirects=True) as r:
        r.raise_for_status()
        with out.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Orchestration
# ─────────────────────────────────────────────────────────────────────────────

def _write_json_atomic(path: Path, data: Dict[str, Any]) -> None:
    """temp file + os.replace: the checkpoint uploader never reads half a file."""
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2))
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fire(checkpoint: Optional[Callable[[List[Path]], None]], paths: List[Path]) -> None:
    """Best-effort resume checkpoint — never fails the render."""
    if checkpoint is None:
        return
    try:
        checkpoint([p for p in paths if p.exists()])
    except Exception as e:  # noqa: BLE001
        print(f"   ⚠️ teacher checkpoint skipped: {e}")


def _load_cache(cache: Path) -> Optional[Dict[str, Any]]:
    if not cache.exists():
        return None
    try:
        data = json.loads(cache.read_text())
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _voice_matches(cached: Dict[str, Any], voice_sha: Optional[str]) -> bool:
    """Legacy caches carry no voice hash — matched on avatar alone, as before."""
    want = cached.get("voice_sha256")
    return not want or want == voice_sha


def render_track(
    *,
    voice_audio: Path,
    avatar_id: str,
    run_dir: Path,
    run_name: str,
    uploader: Callable[[Path, str, str], str] = upload_public,
    on_progress: Optional[Callable[[str], None]] = None,
    checkpoint: Optional[Callable[[List[Path]], None]] = None,
) -> Dict[str, Any]:
    """Render the teacher for the whole narration. Cached in run_dir.

    Resume-safe (the json is checkpointed by the pipeline):
      * right after submit the cache holds {"status": "submitted", job_id,
        avatar_id, audio_url, voice_sha256}; a resumed leg with the same
        avatar + voice re-polls that job instead of paying for a new render;
      * the raw MP4 is uploaded once (`raw_mp4_url`), so a ready cache restored
        on another pod downloads it instead of rendering again.
    """
    work = run_dir / "lesson"
    work.mkdir(parents=True, exist_ok=True)
    cache = run_dir / CACHE_NAME
    raw_mp4 = work / "teacher_raw.mp4"
    cached = _load_cache(cache)
    if cached and cached.get("avatar_id") != avatar_id:
        cached = None

    wav: Optional[Path] = None
    voice_sha: Optional[str] = None

    def _voice() -> Tuple[Path, str]:
        nonlocal wav, voice_sha
        if wav is None or voice_sha is None:
            wav = to_wav(voice_audio, work / "teacher_voice.wav")
            voice_sha = _sha256(wav)
        return wav, voice_sha

    # ── ready cache ────────────────────────────────────────────────────
    if cached and cached.get("status") == "ready":
        ok = True
        if cached.get("voice_sha256"):
            try:
                ok = _voice_matches(cached, _voice()[1])
            except Exception:
                ok = True  # can't hash the voice → trust the cache, as before
        if ok:
            if not raw_mp4.exists() and cached.get("raw_mp4_url"):
                try:
                    _download(str(cached["raw_mp4_url"]), raw_mp4)
                    print("   🧑‍🏫 Teacher render restored from raw_mp4_url")
                except Exception as e:
                    print(f"   ⚠️ teacher_raw.mp4 restore failed ({e}) — rendering again")
            if raw_mp4.exists():
                cached["raw_mp4"] = str(raw_mp4)  # run_dir differs across legs
                return cached
        cached = None

    if not configured():
        raise TeacherRenderError("Spatius is not configured (SPATIUS_API_KEY / SPATIUS_APP_ID)")

    wav, voice_sha = _voice()
    audio_s = media_duration(wav)
    t0 = time.monotonic()
    timeout_s = render_timeout_s(audio_s)
    job_id: Optional[str] = None
    audio_url: Optional[str] = None
    video_url: Optional[str] = None

    # ── submitted cache: re-poll the paid job ─────────────────────────
    if (
        cached and cached.get("status") == "submitted" and cached.get("job_id")
        and cached.get("voice_sha256") == voice_sha
    ):
        job_id = str(cached["job_id"])
        audio_url = cached.get("audio_url")
        print(f"   🧑‍🏫 Teacher job {job_id} already submitted — re-polling (no new render)")
        if on_progress:
            on_progress("resumed")
        try:
            video_url = wait_for_video(job_id, timeout_s=timeout_s, on_progress=on_progress)
        except TeacherRenderError as e:
            # Failed / expired / vanished job: one fresh submit below.
            print(f"   ⚠️ Re-polled teacher job {job_id} unusable ({e}) — submitting again")
            job_id, video_url = None, None

    if video_url is None:
        if not audio_url:
            audio_url = uploader(wav, f"ai-videos/{run_name}/lesson/teacher_voice.wav", "audio/wav")
        job_id = submit_video(avatar_id, audio_url, name=f"vacademy-{run_name}")
        try:
            _write_json_atomic(cache, {
                "status": "submitted",
                "provider": "spatius",
                "job_id": job_id,
                "avatar_id": avatar_id,
                "audio_url": audio_url,
                "voice_sha256": voice_sha,
                "submitted_at": time.time(),
            })
            _fire(checkpoint, [cache])
        except Exception as e:
            print(f"   ⚠️ could not persist the submitted teacher job: {e}")
        if on_progress:
            on_progress("submitted")
        video_url = wait_for_video(job_id, timeout_s=timeout_s, on_progress=on_progress)

    _download(video_url, raw_mp4)
    render_s = time.monotonic() - t0
    video_s = media_duration(raw_mp4)
    offset = measure_offset(wav, raw_mp4)
    box = subject_box(raw_mp4, min(max(1.0, audio_s / 2.0), max(1.0, video_s - 1.0)))
    # Upload the raw render ONCE (the signed vendor URL dies in ~15 min) so a
    # resume on another pod can re-cut clips without a second render.
    raw_mp4_url: Optional[str] = None
    try:
        raw_mp4_url = uploader(raw_mp4, f"ai-videos/{run_name}/lesson/teacher_raw.mp4", "video/mp4")
    except Exception as e:
        print(f"   ⚠️ teacher_raw.mp4 upload failed ({e}) — handing it to the checkpoint uploader")
    result = {
        "status": "ready",
        "provider": "spatius",
        "avatar_id": avatar_id,
        "job_id": job_id,
        "audio_url": audio_url,
        "voice_sha256": voice_sha,
        "raw_mp4": str(raw_mp4),
        "raw_mp4_url": raw_mp4_url,
        "audio_seconds": round(audio_s, 2),
        "video_seconds": round(video_s, 2),
        "offset_s": offset,
        "subject_box": list(box),
        "render_seconds": round(render_s, 1),
        "vendor_credits": round(video_s / 60.0 * SPATIUS_CREDITS_PER_MINUTE, 1),
        "vendor_usd": round(video_s / 60.0 * VENDOR_USD_PER_MINUTE, 4),
        "platform_credits": platform_credits_for(video_s / 60.0 * VENDOR_USD_PER_MINUTE),
        "clips": [],
    }
    _write_json_atomic(cache, result)
    # The json always; the mp4 only when its own upload failed (upload once).
    _fire(checkpoint, [cache] + ([] if raw_mp4_url else [raw_mp4]))
    return result


def platform_credits_for(vendor_usd: float, credits_per_usd: float = DISPLAY_CREDITS_PER_USD) -> float:
    """Display estimate of what the teacher costs the institute: vendor USD ×
    the credit ratio. Not the charge (see DISPLAY_CREDITS_PER_USD)."""
    return round(max(0.0, float(vendor_usd or 0.0)) * float(credits_per_usd), 2)


def build_clips(
    track: Dict[str, Any],
    runs: List[Dict[str, Any]],
    *,
    content_starts_at: float,
    width: int,
    height: int,
    run_dir: Path,
    run_name: str,
    uploader: Callable[[Path, str, str], str] = upload_public,
    pad_end_s: float = 0.0,
    reuse: Optional[List[Dict[str, Any]]] = None,
) -> List[Optional[str]]:
    """One transparent WebM per teacher run; returns public URLs (None = failed).

    `runs` carry absolute timeline times; `content_starts_at` (the intro
    length) maps them onto narration time. `reuse` is an earlier pre-cut
    (narration-time records): a clip is reused when it has the same layout,
    starts within 80 ms and lasts at least as long — section starts are fixed
    once the voice is recorded, only the last section's end can move."""
    import lesson_mode as lm

    raw_mp4 = Path(track["raw_mp4"])
    offset = float(track.get("offset_s", DEFAULT_OFFSET_S))
    box = tuple(track.get("subject_box") or (480, 110, 1440, 1080))
    video_s = float(track.get("video_seconds") or media_duration(raw_mp4))
    work = run_dir / "lesson"
    work.mkdir(parents=True, exist_ok=True)
    urls: List[Optional[str]] = []
    records = []
    tag = "pre" if pad_end_s > 0 else "fin"
    for k, run in enumerate(runs):
        size = lm.clip_size(run["layout"], width, height)
        if size is None:
            urls.append(None)
            continue
        cw, ch = size
        narr_start = float(run["start"]) - content_starts_at
        narr_end = float(run["end"]) - content_starts_at
        hit = next((
            r for r in (reuse or [])
            if r.get("url") and r.get("layout") == run["layout"]
            and abs(float(r.get("start", -99)) - narr_start) <= 0.08
            and float(r.get("end", -99)) >= narr_end - 0.05
        ), None)
        if hit:
            urls.append(hit["url"])
            records.append(dict(hit))
            continue
        src_start = narr_start + offset
        dur = narr_end - narr_start + pad_end_s
        if src_start >= video_s - 0.1:
            urls.append(None)
            continue
        crop = crop_for(cw, ch, box, layout=run["layout"])  # type: ignore[arg-type]
        out = work / f"teacher_{tag}_{k:03d}_{run['layout']}.webm"
        try:
            cut_clip(raw_mp4, start_s=src_start, duration_s=min(dur, video_s - src_start),
                     crop=crop, out_w=cw, out_h=ch, out_path=out)
            url = uploader(out, f"ai-videos/{run_name}/lesson/{out.name}", "video/webm")
        except Exception as e:  # one bad clip must not sink the lesson
            print(f"   ⚠️ Lesson teacher clip {k} ({run['layout']}) failed: {e}")
            url = None
        urls.append(url)
        records.append({"layout": run["layout"], "start": round(narr_start, 3),
                        "end": round(narr_end + pad_end_s, 3), "url": url,
                        "crop": list(crop), "size": [cw, ch]})
    track["clips" if not pad_end_s else "precut"] = records
    try:
        _write_json_atomic(run_dir / CACHE_NAME, track)
    except Exception:
        pass
    return urls
