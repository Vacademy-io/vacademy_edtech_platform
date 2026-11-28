"""
Render Worker — Downloads inputs from S3, runs generate_video.py, uploads MP4.

Reuses the exact same Playwright + MoviePy + FFmpeg pipeline from
ai-video-gen-main/generate_video.py. The only difference is that inputs
come from S3 URLs instead of local paths.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable, Optional
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger("render-worker")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

AWS_ACCESS_KEY = os.environ.get("S3_AWS_ACCESS_KEY") or os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_KEY = os.environ.get("S3_AWS_ACCESS_SECRET") or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = os.environ.get("S3_AWS_REGION") or os.environ.get("AWS_REGION", "ap-south-1")
S3_BUCKET = os.environ.get("AWS_S3_PUBLIC_BUCKET", "vacademy-media-storage-public")

# Path to generate_video.py (baked into Docker image)
RENDER_SCRIPT = Path(__file__).parent / "ai-video-gen-main" / "generate_video.py"
VIDEO_OPTIONS = Path(__file__).parent / "ai-video-gen-main" / "video_options.json"
CAPTIONS_SETTINGS = Path(__file__).parent / "ai-video-gen-main" / "captions_settings.json"
REPO_ROOT = Path(__file__).parent / "ai-video-gen-main"


class RenderWorker:
    """Downloads inputs, runs generate_video.py, uploads output."""

    def __init__(self):
        self._s3 = boto3.client(
            "s3",
            aws_access_key_id=AWS_ACCESS_KEY or None,
            aws_secret_access_key=AWS_SECRET_KEY or None,
            region_name=AWS_REGION,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def render(
        self,
        video_id: str,
        timeline_url: str,
        audio_url: str,
        words_url: Optional[str] = None,
        branding_meta_url: Optional[str] = None,
        avatar_video_url: Optional[str] = None,
        show_captions: bool = True,
        show_branding: bool = True,
        audio_delay: float = 0.0,
        on_progress: Optional[Callable[[float], None]] = None,
        width: int = 1920,
        height: int = 1080,
        fps: Optional[int] = None,
        caption_position: Optional[str] = None,
        caption_text_color: Optional[str] = None,
        caption_bg_color: Optional[str] = None,
        caption_bg_opacity: Optional[int] = None,
        caption_font_size: Optional[int] = None,
        caption_style: Optional[str] = None,
        caption_font_family: Optional[str] = None,
        caption_font_weight: Optional[int] = None,
        caption_text_stroke_width: Optional[int] = None,
        caption_text_stroke_color: Optional[str] = None,
        caption_highlight_color: Optional[str] = None,
        audio_tracks: Optional[list] = None,
        source_video_urls: Optional[list] = None,
    ) -> str:
        """
        Run the full render pipeline and return the S3 URL of the output MP4.

        Runs generate_video.py in a subprocess (blocking I/O offloaded
        to a thread so the event loop stays free).
        """
        work_dir = Path(tempfile.mkdtemp(prefix=f"render_{video_id}_"))
        logger.info(f"Work dir: {work_dir}")

        try:
            # ── Download inputs ──
            if on_progress:
                on_progress(5)

            audio_path = work_dir / "narration.mp3"
            timeline_path = work_dir / "time_based_frame.json"

            self._download(audio_url, audio_path)
            self._download(timeline_url, timeline_path)

            # ── Media prefetch (frame-stall fix) ─────────────────────────
            # Embedded <video> clips used to stream from S3/fal DURING the
            # frame-stepped Playwright render; buffer stalls froze the frame
            # for seconds while the separately-muxed audio kept playing
            # (prod drama render froze 15-18s and 36-44s — the renderer's
            # seek loop skips unbuffered videos and permanently gives up
            # after a 5s wall-clock budget). Downloading every clip ONCE and
            # rewriting the local timeline copy to file:// srcs removes all
            # network I/O from the capture path — seeks become instant. The
            # S3 timeline is untouched (browser preview keeps remote URLs).
            # Off the event loop: downloads + seek re-encodes can outlast the
            # 90 s /health liveness window and get the container killed.
            try:
                await asyncio.to_thread(self._prefetch_timeline_videos, timeline_path, work_dir)
            except Exception as exc:
                logger.warning(f"[MEDIA-PREFETCH] failed ({exc}) — rendering with remote URLs")

            words_path = work_dir / "narration.words.json"
            if words_url:
                self._download(words_url, words_path)

            if branding_meta_url:
                branding_meta_path = work_dir / "branding_meta.json"
                self._download(branding_meta_url, branding_meta_path)
                # Override audio_delay from branding_meta if present
                try:
                    meta = json.loads(branding_meta_path.read_text())
                    bd = float(meta.get("intro_duration_seconds", 0.0))
                    if bd > 0:
                        audio_delay = bd
                        logger.info(f"Audio delay from branding_meta: {audio_delay}s")
                except Exception:
                    pass

            avatar_path: Optional[Path] = None
            if avatar_video_url:
                avatar_path = work_dir / "avatar_video.mp4"
                self._download(avatar_video_url, avatar_path)

            # ── Load timeline JSON once (used for both audio_tracks and sound cues) ──
            timeline_data: Optional[dict] = None
            try:
                _td = json.loads(timeline_path.read_text())
                if isinstance(_td, dict):
                    timeline_data = _td
            except Exception as exc:
                logger.warning(f"Failed to parse timeline JSON for audio extraction: {exc}")

            # ── Download extra audio tracks ──
            # audio_tracks is a list of dicts: {id, label, url, volume, delay, fadeIn, fadeOut}
            # If not passed explicitly, try to read from timeline meta
            if audio_tracks is None:
                if timeline_data is not None:
                    audio_tracks = timeline_data.get("meta", {}).get("audio_tracks", []) or []
                else:
                    audio_tracks = []

            # Each entry is (path, track_metadata) to keep indices aligned
            extra_audio_items: list[tuple[Path, dict]] = []
            for idx, track in enumerate(audio_tracks or []):
                track_url = track.get("url", "")
                if not track_url:
                    continue
                ext = track_url.rsplit(".", 1)[-1].split("?")[0].lower() or "mp3"
                if len(ext) > 10:  # bad parse — fallback
                    ext = "mp3"
                track_path = work_dir / f"audio_track_{idx}.{ext}"
                try:
                    self._download(track_url, track_path)
                    extra_audio_items.append((track_path, track))
                except Exception as exc:
                    logger.warning(f"Failed to download audio track {idx} ({track_url}): {exc}")

            # ── Parse and download per-shot SFX cues (sound_planner output) ──
            # Each cue: {id, t, url, volume, role, duration, absolute_time}.
            # `absolute_time` already includes the intro-branding offset, so the
            # ffmpeg adelay below uses it directly (no double-delay).
            # Unique URLs are downloaded once and reused via separate ffmpeg
            # `-i` inputs (cheap: identical bytes mux'd in twice is negligible).
            sfx_items: list[tuple[Path, dict]] = []
            if timeline_data is not None:
                import hashlib as _hash
                url_to_path: dict[str, Optional[Path]] = {}
                _all_cues: list[dict] = []
                for _tl_entry in timeline_data.get("entries", []) or []:
                    for _cue in _tl_entry.get("sound_cues", []) or []:
                        if not _cue.get("url"):
                            continue
                        if _cue.get("absolute_time") is None:
                            continue
                        _all_cues.append(_cue)

                for _cue in _all_cues:
                    _url = _cue["url"]
                    if _url not in url_to_path:
                        _ext = _url.rsplit(".", 1)[-1].split("?")[0].lower() or "mp3"
                        if len(_ext) > 10:
                            _ext = "mp3"
                        _key = _hash.md5(_url.encode()).hexdigest()[:10]
                        _sp = work_dir / f"sfx_{_key}.{_ext}"
                        try:
                            self._download(_url, _sp)
                            url_to_path[_url] = _sp
                        except Exception as _exc:
                            logger.warning(f"Failed to download SFX {_url}: {_exc}")
                            url_to_path[_url] = None
                    _path = url_to_path.get(_url)
                    if _path is not None:
                        sfx_items.append((_path, _cue))

                if sfx_items:
                    logger.info(
                        f"Loaded {len(sfx_items)} SFX cues across "
                        f"{sum(1 for v in url_to_path.values() if v is not None)} unique files"
                    )
                    # Diagnostic: SFX cue distribution. The duckkey (sidechain
                    # signal) ends at the last cue's tail. If that's before
                    # narration ends, TTS gets cut by sidechaincompress unless
                    # `apad` is applied — log both numbers so we can verify.
                    _sfx_times = sorted(
                        (float(c.get("absolute_time", 0) or 0), float(c.get("duration", 0) or 0))
                        for _, c in sfx_items
                    )
                    _first_t = _sfx_times[0][0]
                    _last_t = _sfx_times[-1][0]
                    _last_end = max(t + d for t, d in _sfx_times)
                    _max_vol = max((float(c.get("volume", 0) or 0) for _, c in sfx_items), default=0)
                    logger.info(
                        f"[SFX-DIAG] cues={len(sfx_items)} first_t={_first_t:.2f}s "
                        f"last_t={_last_t:.2f}s last_cue_end={_last_end:.2f}s "
                        f"max_vol={_max_vol:.3f} → duckkey ends ~{_last_end:.2f}s "
                        f"(apad extends it past narration EOF)"
                    )

            if on_progress:
                on_progress(15)

            # ── Parallel frame rendering ──
            # Split frames across N parallel Playwright processes for speed.
            # Each process renders a subset of frames, then we assemble with FFmpeg.
            #
            # Worker count picking:
            #   • RENDER_PARALLEL_WORKERS env var → explicit override, used as-is.
            #   • Unset → auto-cap based on MemAvailable from /proc/meminfo.
            #
            # Each chromium worker peaks at ~2.5 GB during render (browser + renderer
            # + GPU + utility processes). On an 8 GB box, 4 workers (the old default)
            # tries to claim 10 GB and the 4th launch fails with a Playwright launch
            # error that gets truncated by `rewrite_error` so the underlying OOM /
            # resource-exhaustion cause isn't visible. Auto-cap formula:
            #   workers = max(1, floor((MemAvailable_MB - 1024) / 2560))
            # leaving 1 GB for OS / uvicorn / ffmpeg-spawned-later. On a typical
            # 8 GB box → 2 workers; 16 GB → 6; 32 GB → 12.
            def _autocap_workers() -> int:
                try:
                    with open("/proc/meminfo", "r") as _mf:
                        for _line in _mf:
                            if _line.startswith("MemAvailable:"):
                                _avail_kb = int(_line.split()[1])
                                _avail_mb = _avail_kb / 1024
                                _cap = max(1, int((_avail_mb - 1024) / 2560))
                                logger.info(
                                    f"[RENDER] Auto-capped workers to {_cap} "
                                    f"(MemAvailable={_avail_mb:.0f} MB, ~2.5 GB/worker)"
                                )
                                return _cap
                except Exception as _e:
                    logger.warning(f"[RENDER] Could not read /proc/meminfo for autocap: {_e}")
                return 4  # last-resort default — same as old behavior

            _env_workers = os.environ.get("RENDER_PARALLEL_WORKERS", "").strip()
            if _env_workers:
                NUM_WORKERS = int(_env_workers)
                _autocap = _autocap_workers()
                if NUM_WORKERS > _autocap:
                    logger.warning(
                        f"[RENDER] RENDER_PARALLEL_WORKERS={NUM_WORKERS} exceeds "
                        f"RAM-based safe cap of {_autocap}. Honoring env value but "
                        f"chromium launches may OOM on this box."
                    )
            else:
                NUM_WORKERS = _autocap_workers()
            FPS = fps if fps and fps in (15, 20, 25, 30, 45, 60) else 25
            output_path = work_dir / "output.mp4"
            frames_dir = work_dir / ".render_frames"
            frames_dir.mkdir(parents=True, exist_ok=True)

            # Always render at native resolution (1920x1080 or 1080x1920).
            # The HTML/CSS/SVG content was generated for this canvas size.
            # User's requested resolution (720p/1080p) is applied as FFmpeg downscale.
            output_width = width    # final video resolution (e.g. 1280x720 for 720p)
            output_height = height
            is_portrait = height > width
            render_width = 1080 if is_portrait else 1920
            render_height = 1920 if is_portrait else 1080

            # Build caption settings override if custom options provided
            _captions_settings_path = CAPTIONS_SETTINGS  # default baked-in file
            if any(v is not None for v in [
                caption_position, caption_text_color, caption_bg_color, caption_bg_opacity,
                caption_font_size, caption_style, caption_font_family, caption_font_weight,
                caption_text_stroke_width, caption_text_stroke_color, caption_highlight_color,
            ]):
                try:
                    base_settings = json.loads(CAPTIONS_SETTINGS.read_text()) if CAPTIONS_SETTINGS.exists() else {}
                except Exception:
                    base_settings = {}
                if caption_font_size is not None:
                    # Pass-through: generate_video.py applies canvas-relative
                    # scaling (width/1920) to font_size on every render path
                    # — pre-scaling here would compound to (width/1920)² on
                    # portrait and silently shrink captions to ~1% of frame.
                    base_settings["font_size"] = int(caption_font_size)
                if caption_text_color is not None:
                    base_settings["font_color"] = caption_text_color
                if caption_bg_color is not None or caption_bg_opacity is not None:
                    # Convert hex + opacity to rgba
                    hex_color = (caption_bg_color or "#000000").lstrip("#")
                    if len(hex_color) == 3:
                        hex_color = ''.join(c * 2 for c in hex_color)  # "FFF" → "FFFFFF"
                    elif len(hex_color) < 6:
                        hex_color = hex_color.ljust(6, "0")
                    r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
                    alpha = round((caption_bg_opacity if caption_bg_opacity is not None else 75) / 100.0, 2)
                    base_settings["background_color"] = f"rgba({r},{g},{b},{alpha})"
                if caption_position is not None:
                    base_settings["position"] = caption_position
                # Style-polish fields — all pass-through to generate_video.py
                # which reads them from caption_styles dict and applies them
                # during the per-frame caption HTML emission. None of these
                # need canvas-relative pre-scaling (font_size is the only one
                # that does, handled above).
                if caption_style is not None:
                    base_settings["style"] = caption_style
                if caption_font_family is not None:
                    base_settings["font_family_key"] = caption_font_family
                if caption_font_weight is not None:
                    base_settings["font_weight"] = int(caption_font_weight)
                if caption_text_stroke_width is not None:
                    base_settings["text_stroke_width"] = int(caption_text_stroke_width)
                if caption_text_stroke_color is not None:
                    base_settings["text_stroke_color"] = caption_text_stroke_color
                if caption_highlight_color is not None:
                    base_settings["highlight_color"] = caption_highlight_color
                override_path = work_dir / "captions_settings_override.json"
                override_path.write_text(json.dumps(base_settings, indent=2))
                _captions_settings_path = override_path
                logger.info(f"Caption settings override written: {base_settings}")

            # First, compute total frames by doing a dry-run parse of timeline + audio
            import json as _json
            import sys as _sys
            from pathlib import Path as _Path
            tl_data = _json.loads(timeline_path.read_text())
            if isinstance(tl_data, dict) and "entries" in tl_data:
                tl_entries = tl_data["entries"]
            else:
                tl_entries = tl_data

            # All shot-HTML preprocessing now lives in the shared helper —
            # see app/ai-video-gen-main/shot_preprocess.py. Both this path
            # (production /jobs) and the single-shot preview path (in
            # screenshot_worker.record_shot_mp4) call it so a shot rendered
            # via /shot/preview-mp4 looks identical to the same shot inside
            # a full /jobs render.
            _harness_dir = _Path(__file__).parent / "ai-video-gen-main"
            if str(_harness_dir) not in _sys.path:
                _sys.path.insert(0, str(_harness_dir))
            from shot_preprocess import preprocess_shot_html, PREPROCESS_BUILD

            # Build identifier — proves the new shared preprocessor (with
            # timescale rewrite) is actually running this render, vs. a
            # stale image. Search container logs for this exact line to
            # verify a full /jobs render uses the latest preprocessor.
            logger.info(f"[shot-preprocess] build={PREPROCESS_BUILD} entries={len(tl_entries)}")

            _modified_tl = False
            for _entry in tl_entries:
                if "html" not in _entry:
                    continue
                _orig = _entry["html"]
                _cleaned, _ts = preprocess_shot_html(
                    _orig,
                    shot_type=_entry.get("shot_type"),
                    shot_id=_entry.get("id"),
                )
                if _cleaned != _orig:
                    _entry["html"] = _cleaned
                    _modified_tl = True
                # Attach the extracted vx-timescale to the entry so the
                # dispatcher's __updateSnippets can read e.timescale and
                # create a per-shot child timeline. Skip the field when ≈1
                # to keep the wire payload small for shots without a
                # FE-editor duration adjustment.
                if abs(_ts - 1.0) > 1e-6:
                    _entry["timescale"] = _ts
                    _modified_tl = True

            from moviepy import AudioFileClip as _AFC
            _audio_dur = _AFC(str(audio_path)).duration
            logger.info(f"[NARRATION-DIAG] file=narration.mp3 duration={_audio_dur:.2f}s audio_delay={audio_delay:.2f}s narration_end={_audio_dur + audio_delay:.2f}s")

            # Timeline coverage diagnostic: shot-by-shot inTime/exitTime + gap
            # detection. If a gap > 0.5s exists between consecutive shots, log
            # it as a warning — that produces visible black frames mid-video.
            if tl_entries:
                _sorted_entries = sorted(
                    [(float(e.get("inTime", 0) or 0), float(e.get("exitTime", 0) or 0), e.get("id", "?"))
                     for e in tl_entries],
                    key=lambda x: x[0],
                )
                _first_in = _sorted_entries[0][0]
                _last_out = max(o for _, o, _ in _sorted_entries)
                _gaps: list[tuple[str, str, float, float]] = []
                for _i in range(1, len(_sorted_entries)):
                    _prev_id = _sorted_entries[_i - 1][2]
                    _prev_out = _sorted_entries[_i - 1][1]
                    _cur_id = _sorted_entries[_i][2]
                    _cur_in = _sorted_entries[_i][0]
                    if _cur_in - _prev_out > 0.5:
                        _gaps.append((_prev_id, _cur_id, _prev_out, _cur_in))
                logger.info(
                    f"[TIMELINE-DIAG] entries={len(tl_entries)} first_in={_first_in:.2f}s "
                    f"last_out={_last_out:.2f}s coverage={_last_out - _first_in:.2f}s gaps={len(_gaps)}"
                )
                if _first_in > 0.5:
                    logger.warning(
                        f"[TIMELINE-DIAG] first shot starts at {_first_in:.2f}s — "
                        f"video will be black for the leading {_first_in:.2f}s"
                    )
                for _prev_id, _cur_id, _prev_out, _cur_in in _gaps[:5]:
                    logger.warning(
                        f"[TIMELINE-DIAG] gap between '{_prev_id}'→'{_cur_id}': "
                        f"{_prev_out:.2f}s..{_cur_in:.2f}s ({_cur_in - _prev_out:.2f}s of black)"
                    )

            tl_max_end = max((float(e.get("exitTime", 0) or 0) for e in tl_entries), default=0.0)
            # Background music / extra audio tracks: probed for diagnostics
            # only — they DO NOT extend the video. Whichever is longer of
            # narration+delay / visuals timeline is the video duration; BG
            # music is mixed under and truncated by FFmpeg's `-shortest`.
            _extra_track_ends: list[float] = []
            for _idx, (_p, _track) in enumerate(extra_audio_items):
                if not _p.exists():
                    logger.warning(f"[EXTRA-AUDIO-DIAG] track {_idx} ({_p.name}) missing on disk — skipped")
                    continue
                try:
                    _t_dur = _AFC(str(_p)).duration
                except Exception as _exc:
                    logger.warning(f"[EXTRA-AUDIO-DIAG] track {_idx} ({_p.name}) probe failed: {_exc}")
                    continue
                _t_delay = float(_track.get("delay", 0) or 0)
                _t_end = _t_delay + _t_dur
                _extra_track_ends.append(_t_end)
                logger.info(
                    f"[EXTRA-AUDIO-DIAG] track[{_idx}] label='{_track.get('label', '?')}' "
                    f"file={_p.name} delay={_t_delay:.2f}s duration={_t_dur:.2f}s "
                    f"vol={float(_track.get('volume', 1.0) or 1.0):.2f} "
                    f"fadeIn={float(_track.get('fadeIn', 0) or 0):.2f}s "
                    f"fadeOut={float(_track.get('fadeOut', 0) or 0):.2f}s "
                    f"→ ends_at={_t_end:.2f}s"
                )
            extra_max_end = max(_extra_track_ends, default=0.0)
            _narration_end = _audio_dur + audio_delay
            # Video length is bounded by visuals + narration only. If user-
            # supplied BG music outlasts that, we truncate it (FFmpeg
            # `-shortest`) — we do NOT extend the video for it.
            total_duration = max(_narration_end, tl_max_end)
            total_frames = int(total_duration * FPS) + 1

            # Identify the dominant duration source so a future "video too short"
            # / "video too long" report can be diagnosed at a glance.
            if abs(total_duration - _narration_end) < 0.05:
                _dom = "narration"
            elif abs(total_duration - tl_max_end) < 0.05:
                _dom = "timeline_visuals"
            else:
                _dom = "unknown"
            logger.info(
                f"Duration sources: narration+delay={_narration_end:.2f}s, "
                f"timeline_end={tl_max_end:.2f}s, extra_audio_end={extra_max_end:.2f}s "
                f"→ total={total_duration:.2f}s (dominant={_dom}; BG music truncated to total)"
            )

            # Audio-vs-video alignment warnings — these are the symptoms users
            # have hit before (TTS cut, black tail). Logging the mismatch
            # *before* render makes regressions obvious from logs alone.
            if _narration_end > tl_max_end + 0.5:
                logger.warning(
                    f"[AUDIO-VIDEO-DIAG] narration ({_narration_end:.2f}s) outlasts visuals "
                    f"({tl_max_end:.2f}s) by {_narration_end - tl_max_end:.2f}s — "
                    f"trailing shots will be extended to avoid black tail"
                )
            if extra_max_end > total_duration + 0.5:
                logger.info(
                    f"[AUDIO-VIDEO-DIAG] BG music ({extra_max_end:.2f}s) extends past "
                    f"video end ({total_duration:.2f}s) — will be truncated by FFmpeg -shortest"
                )
            # SFX duckkey vs narration check — if SFX end before narration AND
            # apad got bypassed, narration would be cut. This is the bug we hit
            # at 40s. Log clearly so any future regression here is obvious.
            if sfx_items:
                _sfx_last_end = max(
                    float(c.get("absolute_time", 0) or 0) + float(c.get("duration", 0) or 0)
                    for _, c in sfx_items
                )
                if _narration_end > _sfx_last_end + 0.5:
                    logger.info(
                        f"[AUDIO-VIDEO-DIAG] narration ({_narration_end:.2f}s) outlasts last SFX "
                        f"({_sfx_last_end:.2f}s) by {_narration_end - _sfx_last_end:.2f}s — "
                        f"apad on duckkey is required to keep narration uncut"
                    )

            # When narration outlasts the visual timeline, hold the last shot
            # on screen for the remainder so the viewer doesn't see a black
            # gap during the trailing narration. Only triggered for narration
            # > visuals — BG music never extends visuals.
            if total_duration > tl_max_end + 0.01 and tl_entries:
                _eps = 0.01
                _extended = 0
                for _entry in tl_entries:
                    if float(_entry.get("exitTime", 0) or 0) >= tl_max_end - _eps:
                        _entry["exitTime"] = total_duration
                        _extended += 1
                _modified_tl = True
                logger.info(
                    f"Extended {_extended} trailing entry/entries from {tl_max_end:.2f}s "
                    f"to {total_duration:.2f}s to cover trailing narration"
                )

            # Internal gap-snap: extend each content shot's exitTime so it
            # touches the next shot's inTime. Director-generated storyboards
            # often leave small gaps (shot N exits at 15.9s, shot N+1 starts
            # at 16.2s). The renderer's _active_entries_at filter excludes a
            # shot once t >= exitTime, so frames inside the gap have ZERO
            # active shots and render as the bare page background — the
            # blank-white frames the user has been reporting at t=16, t=26
            # etc. Branding entries (intro/outro/watermark) are excluded;
            # they have their own placement semantics. Snap is only applied
            # at the render side here so OLD timelines (built before the
            # build-side gap-snap shipped in automation_pipeline.py v20)
            # also get fixed without regenerating.
            if tl_entries:
                _content = [
                    _e for _e in tl_entries
                    if not str(_e.get("id", "")).startswith("branding-")
                ]
                _content_sorted = sorted(
                    _content, key=lambda _e: float(_e.get("inTime", 0) or 0)
                )
                _snapped = 0
                _max_gap_filled = 0.0
                for _i in range(len(_content_sorted) - 1):
                    _cur = _content_sorted[_i]
                    _nxt = _content_sorted[_i + 1]
                    _cur_exit = float(_cur.get("exitTime", 0) or 0)
                    _nxt_in = float(_nxt.get("inTime", 0) or 0)
                    _gap = _nxt_in - _cur_exit
                    # Only fill positive gaps. Touching (gap=0) and overlapping
                    # (gap<0) shots are already fine. Skip absurd gaps (>10s) —
                    # likely an intentional structural break.
                    if 0.0 < _gap <= 10.0:
                        _cur["exitTime"] = _nxt_in
                        _snapped += 1
                        if _gap > _max_gap_filled:
                            _max_gap_filled = _gap
                if _snapped > 0:
                    _modified_tl = True
                    logger.info(
                        f"[GAP-SNAP] extended {_snapped} shot(s) to eliminate "
                        f"timeline gaps (largest gap filled: {_max_gap_filled:.3f}s) "
                        f"— prevents blank frames between shots"
                    )

            if _modified_tl:
                timeline_path.write_text(_json.dumps(
                    tl_data if isinstance(tl_data, dict) else tl_entries,
                    ensure_ascii=False,
                ))
                logger.info("Preprocessed timeline: stripped <video>/stage-drift/vx-timescale/gsap CDN; converted vx-shot CSS transitions to GSAP tweens; extended trailing shots to cover audio tail")

            logger.info(
                f"Render: {render_width}x{render_height} @ {FPS}fps → output {output_width}x{output_height}. "
                f"Total frames: {total_frames}, splitting across {NUM_WORKERS} workers"
            )

            # Build base command (shared across all workers)
            base_cmd = [
                sys.executable,
                str(RENDER_SCRIPT),
                str(audio_path),
                str(timeline_path),
                str(output_path),  # not used in frames-only mode, but required arg
                "--frames-dir", str(frames_dir),
                "--fps", str(FPS),
                "--width", str(render_width),
                "--height", str(render_height),
                "--frames-only",
            ]
            if VIDEO_OPTIONS.exists():
                base_cmd.extend(["--video-options", str(VIDEO_OPTIONS)])
            if words_url and words_path.exists():
                base_cmd.extend(["--captions-words", str(words_path)])
            if _captions_settings_path.exists():
                base_cmd.extend(["--captions-settings", str(_captions_settings_path)])
            if audio_delay > 0:
                base_cmd.extend(["--audio-delay", str(audio_delay)])
            # Pass explicit caption/branding flags so they override video_options.json defaults
            if show_captions:
                base_cmd.append("--show-captions")
            else:
                base_cmd.append("--no-show-captions")

            # Branding watermark overlay (branding.json is baked into Docker image)
            branding_json = REPO_ROOT / "branding.json"
            # An institute watermark (brand_overrides.watermark) is already a
            # timeline entry; the platform one sits in the same top-right
            # corner and printed "Vacademy" across the institute's logo.
            _has_institute_watermark = any(
                isinstance(e, dict) and e.get("id") == "branding-watermark"
                for e in (tl_entries if isinstance(tl_entries, list) else [])
            )
            if show_branding and branding_json.exists() and not _has_institute_watermark:
                base_cmd.extend(["--show-branding", "--branding-json", str(branding_json)])
            else:
                base_cmd.append("--no-show-branding")

            # Split frame ranges
            chunk_size = (total_frames + NUM_WORKERS - 1) // NUM_WORKERS
            frame_ranges = []
            for i in range(NUM_WORKERS):
                start = i * chunk_size
                end = min(start + chunk_size, total_frames)
                if start < total_frames:
                    frame_ranges.append((start, end))

            if on_progress:
                on_progress(20)

            # Run workers in parallel
            logger.info(f"Launching {len(frame_ranges)} parallel render workers: {frame_ranges}")

            # Per-worker frame progress (rendered, total) for aggregate %.
            _worker_progress: dict[int, tuple[int, int]] = {
                i: (0, end - start) for i, (start, end) in enumerate(frame_ranges)
            }
            import re as _re_mod
            _frame_progress_re = _re_mod.compile(
                r"\[FRAME-PROGRESS\][^\n]*?rendered=(\d+)/(\d+)"
            )

            def _push_aggregate_progress() -> None:
                if not on_progress:
                    return
                # Scale into the [25, 70] band — earlier % is download/setup,
                # later % is FFmpeg encode + S3 upload.
                done = sum(p[0] for p in _worker_progress.values())
                total = sum(p[1] for p in _worker_progress.values()) or 1
                pct = 25.0 + (done / total) * 45.0
                try:
                    on_progress(min(70.0, pct))
                except Exception:
                    pass

            def _run_chunk(worker_idx: int, start: int, end: int) -> subprocess.CompletedProcess:
                # Stagger chromium launches so N parallel workers don't all hit
                # the chromium-spawn memory peak in the same moment. A 4-worker
                # render on a tight box used to fail at the last `chromium.launch`
                # because all four were allocating headers + heaps simultaneously.
                # 2s/worker is negligible vs. multi-minute renders.
                if worker_idx > 0:
                    time.sleep(worker_idx * 2)
                chunk_cmd = base_cmd + ["--start-frame", str(start), "--end-frame", str(end)]
                proc = subprocess.Popen(
                    chunk_cmd,
                    cwd=str(REPO_ROOT),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,  # line-buffered
                )
                stdout_chunks: list[str] = []
                stderr_chunks: list[str] = []

                import threading as _th

                def _drain_stdout() -> None:
                    assert proc.stdout is not None
                    for line in proc.stdout:
                        stdout_chunks.append(line)
                        # Forward to container logs in real time. Strip trailing \n
                        # to avoid double newlines from logger formatting.
                        _stripped = line.rstrip("\n")
                        if _stripped:
                            logger.info(f"[w{worker_idx}] {_stripped}")
                        # Aggregate frame progress when we see a [FRAME-PROGRESS] line.
                        m = _frame_progress_re.search(line)
                        if m:
                            try:
                                rendered = int(m.group(1))
                                total = int(m.group(2))
                                _worker_progress[worker_idx] = (rendered, total)
                                _push_aggregate_progress()
                            except Exception:
                                pass

                def _drain_stderr() -> None:
                    assert proc.stderr is not None
                    for line in proc.stderr:
                        stderr_chunks.append(line)

                t_out = _th.Thread(target=_drain_stdout, daemon=True)
                t_err = _th.Thread(target=_drain_stderr, daemon=True)
                t_out.start()
                t_err.start()

                try:
                    proc.wait(timeout=5400)
                    t_out.join(timeout=10)
                    t_err.join(timeout=10)
                    return subprocess.CompletedProcess(
                        chunk_cmd,
                        returncode=proc.returncode,
                        stdout="".join(stdout_chunks),
                        stderr="".join(stderr_chunks),
                    )
                except subprocess.TimeoutExpired:
                    proc.kill()
                    try:
                        proc.wait(timeout=10)
                    except Exception:
                        pass
                    t_out.join(timeout=5)
                    t_err.join(timeout=5)
                    return subprocess.CompletedProcess(
                        chunk_cmd,
                        returncode=124,
                        stdout="".join(stdout_chunks),
                        stderr=(
                            "".join(stderr_chunks)
                            + f"\n[WORKER-TIMEOUT] subprocess exceeded 5400s for frames ({start}, {end})\n"
                        ),
                    )

            loop = asyncio.get_event_loop()
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=NUM_WORKERS) as pool:
                futures = [
                    loop.run_in_executor(pool, _run_chunk, i, start, end)
                    for i, (start, end) in enumerate(frame_ranges)
                ]
                results = await asyncio.gather(*futures)

            # Check all workers succeeded and collect browser logs
            all_browser_errors: list[str] = []
            for i, result in enumerate(results):
                # Always save full stdout/stderr to log files for debugging
                worker_log_path = work_dir / f"worker_{i}_stdout.log"
                worker_err_path = work_dir / f"worker_{i}_stderr.log"
                try:
                    worker_log_path.write_text(result.stdout or "")
                    worker_err_path.write_text(result.stderr or "")
                except Exception:
                    pass

                if result.returncode != 0:
                    stderr_full = result.stderr or ""
                    stdout_full = result.stdout or ""
                    # Pick the most informative tail: Python traceback wins over generic stderr.
                    tb_idx = stderr_full.rfind("Traceback (most recent call last)")
                    if tb_idx == -1:
                        for marker in ("[WORKER-TIMEOUT]", "playwright._impl._errors.", "Error:", "Exception:"):
                            mi = stderr_full.rfind(marker)
                            if mi != -1:
                                tb_idx = mi
                                break
                    err_excerpt = stderr_full[tb_idx:tb_idx + 2000] if tb_idx != -1 else stderr_full[-2000:]
                    # How far did the worker get before dying? Last [RENDER-VERSION]/frame log tells us.
                    progress_tag = ""
                    if "[RENDER-VERSION]" not in stdout_full:
                        progress_tag = " [never reached page setup]"
                    elif "Frames-only mode complete" not in stdout_full:
                        last_frame = 0
                        for line in stdout_full.splitlines():
                            if "Rendered frame" in line or "Wrote frame" in line:
                                try:
                                    last_frame = max(last_frame, int(''.join(c for c in line.split()[-1] if c.isdigit()) or 0))
                                except Exception:
                                    pass
                        progress_tag = f" [setup reached, dies mid-render; last frame ~{last_frame}]" if last_frame else " [setup reached, dies before first frame]"
                    logger.error(f"Worker {i} STDERR (full saved to {worker_err_path}):\n{err_excerpt}")
                    logger.error(f"Worker {i} STDOUT tail:\n{stdout_full[-1500:]}")
                    raise RuntimeError(
                        f"Render worker {i} (frames {frame_ranges[i]}) failed{progress_tag}: "
                        f"{err_excerpt[:1200]}"
                    )
                # Collect ALL browser errors/warnings from successful workers
                if "[BROWSER ERROR]" in result.stdout or "[BROWSER EXCEPTION]" in result.stdout:
                    browser_lines = [l for l in result.stdout.split('\n') if '[BROWSER' in l]
                    all_browser_errors.extend(browser_lines)
                    logger.warning(
                        f"Worker {i} browser errors ({len(browser_lines)} lines):\n"
                        + '\n'.join(browser_lines[:50])  # Log up to 50 lines per worker
                    )
                # Forward diagnostic lines from worker stdout
                diag_lines = [l for l in result.stdout.split('\n')
                              if any(tag in l for tag in ('RENDER-VERSION', 'SIZING-DIAG', 'ANNOT-DIAG', 'VIDEO-DIAG', 'VIVUS-DIAG', 'ROUGHNOTATION-DIAG', 'FONT-DIAG', 'AUTO-SHRINK'))]
                if diag_lines:
                    logger.info(f"Worker {i} diagnostics ({len(diag_lines)} lines):\n" + '\n'.join(diag_lines[:50]))
                logger.info(f"Worker {i} done: {result.stdout[-200:]}")

            # Write consolidated browser error log
            if all_browser_errors:
                browser_log_path = work_dir / "browser_errors.log"
                try:
                    browser_log_path.write_text('\n'.join(all_browser_errors))
                    logger.info(f"Browser errors log: {browser_log_path} ({len(all_browser_errors)} total lines)")
                except Exception:
                    pass

            rendered_frames = sorted(frames_dir.glob("frame_*.jpg"))
            # Diagnostic: detect if frames were written as .png instead of .jpg (format mismatch)
            stale_png_count = len(list(frames_dir.glob("frame_*.png")))
            if stale_png_count > 0 and len(rendered_frames) == 0:
                logger.error(f"FRAME FORMAT MISMATCH: Found {stale_png_count} .png frames but expected .jpg. "
                             f"generate_video.py may be out of sync with worker.py.")
            logger.info(f"Total rendered frames: {len(rendered_frames)} (.jpg), stale .png: {stale_png_count}")

            if on_progress:
                on_progress(70)

            # ── SOURCE_CLIP compositing ──
            # For shots that use source video footage, overlay the rendered HTML
            # frames on top of extracted source clips. Supports multiple sources.
            if source_video_urls:
                from collections import defaultdict
                # Group SOURCE_CLIP entries by source_video_index
                _clips_by_source: dict = defaultdict(list)
                for _e in tl_entries:
                    if _e.get("shot_type") == "SOURCE_CLIP" and _e.get("source_start") is not None:
                        _sv_idx = _e.get("source_video_index", 0)
                        _clips_by_source[_sv_idx].append(_e)

                if _clips_by_source:
                    logger.info(f"Compositing SOURCE_CLIP shots from {len(_clips_by_source)} source(s)...")

                for _sv_idx, _clip_entries in _clips_by_source.items():
                    if _sv_idx >= len(source_video_urls):
                        logger.warning(f"source_video_index {_sv_idx} out of range (have {len(source_video_urls)} URLs)")
                        continue
                    _sv_path = work_dir / f"source_video_{_sv_idx}.mp4"
                    self._download(source_video_urls[_sv_idx], _sv_path)
                    logger.info(f"Downloaded source video [{_sv_idx}] for {len(_clip_entries)} clips")
                    await self._composite_source_clips(
                        source_video_path=_sv_path,
                        source_clip_entries=_clip_entries,
                        frames_dir=frames_dir,
                        render_width=render_width,
                        render_height=render_height,
                        fps=FPS,
                    )
                    # Free disk immediately after compositing this source
                    _sv_path.unlink(missing_ok=True)

            if on_progress:
                on_progress(75)

            # ── Collect HTML <video> audio ──
            # Playwright screenshots are silent, so an UNMUTED <video> in the
            # shot HTML (embedded clip, AI_VIDEO_HERO intrinsic audio) is
            # inaudible in the MP4 unless we extract its audio and mux it at the
            # shot's inTime. Non-fatal: a failure here just ships the video
            # without that track rather than failing the whole render.
            try:
                video_audio_items = self._collect_video_audio(tl_entries, work_dir)
            except Exception as _vae:
                logger.warning(f"[VIDEO-AUDIO] collection failed (continuing without): {_vae}")
                video_audio_items = []

            # ── Assemble with FFmpeg ──
            logger.info("Assembling video with FFmpeg...")
            # Frames rendered at native resolution (1080p/1920p).
            # Downscale to target resolution if different.

            # Build multi-audio FFmpeg command.
            # Input 0: frame sequence
            # Input 1: narration (always present)
            # Inputs 2..N: extra audio tracks (optional)
            # extra_audio_items is list[(Path, track_dict)] — indices already aligned
            valid_extra = [(p, t) for p, t in extra_audio_items if p.exists()]
            narration_idx = 1  # input index for narration.mp3

            valid_sfx = [(p, c) for p, c in sfx_items if p.exists()]

            ffmpeg_cmd = [
                "ffmpeg", "-y",
                "-framerate", str(FPS),
                "-i", str(frames_dir / "frame_%06d.jpg"),
                "-i", str(audio_path),  # narration — always input 1
            ]
            for p, _track in valid_extra:
                if _track.get("loop"):
                    # -stream_loop applies to the NEXT -i: repeat the file
                    # indefinitely. The mix still terminates at video end via
                    # the muxer's -shortest, and the chain below always applies
                    # a tail fade at total_duration for looped tracks.
                    ffmpeg_cmd += ["-stream_loop", "-1", "-i", str(p)]
                else:
                    ffmpeg_cmd += ["-i", str(p)]
            # SFX cue inputs come after extras so the input-index math stays
            # additive: 0=frames, 1=narration, 2..2+E-1=extras, 2+E..=sfx,
            # then HTML <video> audio after the sfx block.
            for p, _ in valid_sfx:
                ffmpeg_cmd += ["-i", str(p)]
            for p, _ in video_audio_items:
                ffmpeg_cmd += ["-i", str(p)]

            # Build filter_complex
            # 1. Scale video
            # 2. Narration: delay → format-normalize → [nar]
            # 3. Per extra track: delay → volume → fade → format-normalize → [extraN]
            # 4. Per SFX cue: delay (absolute_time) → volume → tail-fade →
            #    format-normalize → asplit (when ducking) → [sfxN] + [sfxN_key]
            # 5. If any SFX: sum keys → sidechaincompress narration → [nar_duct]
            # 6. amix all audio streams → [aout]
            #
            # `aresample + aformat` on every chain is required because amix
            # demands matching sample rate / sample format / channel layout.
            # Catalog SFX MP3s vary (22.05/44.1/48 kHz; mono/stereo); without
            # this, amix errors or silently produces broken audio.
            FMT_NORM = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo"

            filter_parts = [f"[0:v]scale={output_width}:{output_height}:flags=lanczos[scaled]"]
            narration_delay_ms = int(audio_delay * 1000)
            filter_parts.append(
                f"[{narration_idx}:a]adelay={narration_delay_ms}|{narration_delay_ms},{FMT_NORM}[nar]"
            )

            extra_labels: list[str] = []
            # Tail-fade duration applied to BG/extra tracks that would
            # otherwise hard-cut at video end. 0.6s gives a clean musical
            # tail-out vs. an abrupt cut without dragging out the ending.
            _BG_TAIL_FADE_S = 0.6
            for rel_idx, (_p, track) in enumerate(valid_extra):
                abs_idx = rel_idx + 2  # 0=frames, 1=narration, 2+=extra
                track_delay = float(track.get("delay", 0) or 0)
                delay_ms = int(track_delay * 1000)
                volume = float(track.get("volume", 1.0))
                fade_in = float(track.get("fadeIn", 0))
                fade_out = float(track.get("fadeOut", 0))
                label = f"extra{rel_idx}"

                # Probe the source duration so we know if the track will
                # extend past video end. If so, swap the user's fadeOut for
                # a fade timed to total_duration so the cut doesn't pop.
                # Looped tracks (-stream_loop -1 on the input) are infinite,
                # so they ALWAYS reach video end and take the tail fade.
                _is_loop = bool(track.get("loop"))
                try:
                    _src_dur = _AFC(str(_p)).duration
                except Exception:
                    _src_dur = None
                _track_natural_end = (track_delay + _src_dur) if _src_dur is not None else None
                _will_be_truncated = _is_loop or (
                    _track_natural_end is not None
                    and _track_natural_end > total_duration + 0.05
                )

                chain = f"[{abs_idx}:a]adelay={delay_ms}|{delay_ms}"
                if volume != 1.0:
                    chain += f",volume={volume:.4f}"
                if fade_in > 0:
                    chain += f",afade=t=in:st=0:d={fade_in:.3f}"
                if _will_be_truncated:
                    # Track will be cut by FFmpeg -shortest at total_duration.
                    # Apply a fade-out ending exactly at total_duration so the
                    # final amix sees a graceful tail rather than a hard cut.
                    _fade_dur = max(0.1, min(_BG_TAIL_FADE_S, total_duration - track_delay - 0.05))
                    _fade_st = max(0.0, total_duration - _fade_dur)
                    chain += f",afade=t=out:st={_fade_st:.3f}:d={_fade_dur:.3f}"
                    logger.info(
                        f"[EXTRA-AUDIO-DIAG] track[{rel_idx}] truncated at video end "
                        f"({total_duration:.2f}s) — applying tail fade-out "
                        f"st={_fade_st:.2f}s dur={_fade_dur:.2f}s"
                    )
                elif fade_out > 0:
                    # Track ends naturally before video end → use the user-
                    # specified fadeOut (reverse→fade-in→reverse trick).
                    chain += f",areverse,afade=t=in:d={fade_out:.3f},areverse"
                chain += f",{FMT_NORM}[{label}]"
                filter_parts.append(chain)
                extra_labels.append(f"[{label}]")

            # Per-shot SFX cues (sound_planner output). Each cue plays once at
            # its absolute_time. When `valid_sfx` is non-empty we asplit each
            # chain so the SFX feeds both the final mix AND a sidechain key
            # used to duck the narration during the cue.
            duck_enabled = bool(valid_sfx)
            sfx_input_base = 2 + len(valid_extra)
            sfx_labels: list[str] = []
            sfx_key_labels: list[str] = []
            for rel_idx, (_, cue) in enumerate(valid_sfx):
                abs_idx = sfx_input_base + rel_idx
                abs_t = float(cue.get("absolute_time", 0.0) or 0.0)
                delay_ms = max(0, int(round(abs_t * 1000)))
                volume = float(cue.get("volume", 0.5) or 0.5)
                cue_dur = float(cue.get("duration", 0.0) or 0.0)
                label = f"sfx{rel_idx}"
                key_label = f"sfx{rel_idx}_key"

                chain = (
                    f"[{abs_idx}:a]adelay={delay_ms}|{delay_ms}"
                    f",volume={volume:.4f}"
                )
                if cue_dur > 0.10:
                    fade_st = max(0.0, cue_dur - 0.03)
                    chain += f",afade=t=out:st={fade_st:.3f}:d=0.03"
                chain += f",{FMT_NORM}"
                if duck_enabled:
                    chain += f",asplit=2[{label}][{key_label}]"
                    sfx_key_labels.append(f"[{key_label}]")
                else:
                    chain += f"[{label}]"
                filter_parts.append(chain)
                sfx_labels.append(f"[{label}]")

            # Sidechain duck on narration when SFX exist. Sums all SFX keys
            # into a single sidechain signal, then sidechaincompresses the
            # narration against it. Threshold is low because cue volumes are
            # already attenuated by the planner; ratio + release tuned to
            # match the player-side duck (≈ −4 dB, 250 ms tail).
            final_nar_label = "[nar]"
            if duck_enabled and sfx_key_labels:
                # `apad` pads the sidechain key with infinite silence after the
                # last SFX ends. Without this, sidechaincompress's framesync
                # ends the output as soon as the key EOFs — so when the last
                # SFX cue finishes (e.g. ~39 s), the ducked narration also
                # gets truncated, even though narration itself runs longer.
                # Silence is below threshold, so the pad doesn't duck anything.
                if len(sfx_key_labels) == 1:
                    filter_parts.append(f"{sfx_key_labels[0]}apad[duckkey]")
                else:
                    n_keys = len(sfx_key_labels)
                    filter_parts.append(
                        f"{''.join(sfx_key_labels)}amix=inputs={n_keys}:normalize=0,apad[duckkey]"
                    )
                # Tuned for ~−4 dB ducking on narration (matches player-side preview).
                # threshold=0.18 ≈ −15 dBFS — sits just below typical SFX cue peaks
                # so only loud cue moments duck, not their fade tails.
                # ratio=2 keeps the duck gentle. release=200 ms feels natural.
                filter_parts.append(
                    "[nar][duckkey]sidechaincompress="
                    "threshold=0.18:ratio=2:attack=15:release=200:makeup=1[nar_duct]"
                )
                final_nar_label = "[nar_duct]"

            # Per HTML <video> audio: play from 0 at the shot's inTime, trimmed
            # to the shot window. Anchored to inTime (the same timebase the
            # frames use — see generate_video.py's seek: relTime = state.t -
            # inTime), NOT audio_delay, so the audio lands exactly where the
            # video's pixels are in the assembled MP4. `atrim`+`asetpts` cut the
            # source to the shot length and reset its clock so `adelay` shifts
            # it to inTime; longer-than-source shots just go silent after EOF
            # (no loop — matches what a heard clip expects).
            video_input_base = sfx_input_base + len(valid_sfx)
            video_labels: list[str] = []
            for rel_idx, (_, spec) in enumerate(video_audio_items):
                abs_idx = video_input_base + rel_idx
                delay_ms = max(0, int(round(float(spec.get("delay", 0.0)) * 1000)))
                seg_dur = max(0.05, float(spec.get("duration", 0.0)))
                vol = float(spec.get("volume", 1.0))
                label = f"vid{rel_idx}"
                chain = f"[{abs_idx}:a]atrim=0:{seg_dur:.3f},asetpts=PTS-STARTPTS"
                if abs(vol - 1.0) > 1e-3:
                    chain += f",volume={vol:.4f}"
                chain += f",adelay={delay_ms}|{delay_ms},{FMT_NORM}[{label}]"
                filter_parts.append(chain)
                video_labels.append(f"[{label}]")

            audio_labels = [final_nar_label, *extra_labels, *sfx_labels, *video_labels]
            if video_labels:
                logger.info(
                    f"[AUDIO-MIX] +{len(video_labels)} HTML <video> audio track(s) "
                    f"muxed at their shot inTimes"
                )

            if valid_sfx:
                logger.info(
                    f"[AUDIO-MIX] {len(valid_sfx)} SFX cues, "
                    f"{len(valid_extra)} BG/extra tracks, narration "
                    f"ducked via sidechaincompress (threshold=0.18,ratio=2), "
                    f"duckkey apad'd to outlast narration"
                )
            else:
                logger.info(
                    f"[AUDIO-MIX] no SFX cues — narration mixed straight, "
                    f"{len(valid_extra)} BG/extra tracks"
                )

            if len(audio_labels) == 1:
                # Single audio stream — no amix needed (already format-normalized)
                filter_parts.append(f"{audio_labels[0]}anull[aout]")
            else:
                n = len(audio_labels)
                filter_parts.append(
                    f"{''.join(audio_labels)}amix=inputs={n}:duration=longest:normalize=0[aout]"
                )

            filter_complex = ";".join(filter_parts)

            ffmpeg_cmd += [
                "-filter_complex", filter_complex,
                "-map", "[scaled]",
                "-map", "[aout]",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-crf", "23",
                "-preset", "fast",
                "-c:a", "aac",
                "-shortest",
                str(output_path),
            ]
            logger.info(f"FFmpeg filter_complex: {filter_complex}")

            # ── Pre-FFmpeg frame-gap backfill ──
            # Under memory pressure (multiple concurrent jobs sharing chromium
            # on a tight box), Playwright's page.screenshot occasionally
            # returns "success" without writing the file — no exception, no log
            # line, just a missing JPG. Workers complete cleanly with 1-8
            # frames silently dropped, then ffmpeg fails: "Could find no file
            # with path 'frame_%06d.jpg' and index in the range 0-4". image2's
            # probe range is 5; a single missing frame in 0-4 sinks the whole
            # render even though 4000+ usable frames are on disk.
            #
            # Defensive fix: detect gaps in the frame index sequence and
            # backfill each missing index with a copy of its nearest existing
            # neighbor BEFORE invoking ffmpeg. Quality impact: each gap
            # becomes a single-frame freeze (67ms at 15 FPS, 33ms at 30 FPS).
            # Vastly preferable to failing the entire render.
            try:
                _frames_now = sorted(frames_dir.glob("frame_*.jpg"))
                _frame_count = len(_frames_now)
                _first_5 = [p.name for p in _frames_now[:5]]
                _last_5 = [p.name for p in _frames_now[-5:]] if _frame_count > 5 else []
                _frame0 = frames_dir / "frame_000000.jpg"
                _frame0_exists = _frame0.exists()
                _frame0_size = _frame0.stat().st_size if _frame0_exists else -1
                logger.info(
                    f"[FFMPEG-PREFLIGHT] dir={frames_dir} count={_frame_count} "
                    f"first5={_first_5} last5={_last_5} "
                    f"frame0_exists={_frame0_exists} frame0_bytes={_frame0_size}"
                )

                if _frame_count > 0:
                    _present_indices: set[int] = set()
                    for _p in _frames_now:
                        try:
                            _present_indices.add(int(_p.stem.split("_")[-1]))
                        except (ValueError, IndexError):
                            pass
                    if _present_indices:
                        _highest = max(_present_indices)
                        _missing = [
                            i for i in range(_highest + 1) if i not in _present_indices
                        ]
                        if _missing:
                            import bisect as _bisect_mod
                            _present_sorted = sorted(_present_indices)
                            _filled = 0
                            _failed = 0
                            for _idx in _missing:
                                _pos = _bisect_mod.bisect_left(_present_sorted, _idx)
                                if _pos == 0:
                                    _neighbor = _present_sorted[0]
                                elif _pos == len(_present_sorted):
                                    _neighbor = _present_sorted[-1]
                                else:
                                    _left = _present_sorted[_pos - 1]
                                    _right = _present_sorted[_pos]
                                    _neighbor = (
                                        _left if (_idx - _left) <= (_right - _idx) else _right
                                    )
                                _src = frames_dir / f"frame_{_neighbor:06d}.jpg"
                                _dst = frames_dir / f"frame_{_idx:06d}.jpg"
                                try:
                                    shutil.copyfile(_src, _dst)
                                    _filled += 1
                                except Exception:
                                    _failed += 1
                            _sample = _missing[:10] + (["..."] if len(_missing) > 10 else [])
                            logger.warning(
                                f"[FFMPEG-PREFLIGHT] backfilled {_filled}/{len(_missing)} "
                                f"missing frames with nearest-neighbor copies "
                                f"(failed={_failed}). Missing indices (sample): {_sample}. "
                                f"Highest frame: {_highest}. Quality impact: brief "
                                f"frame freezes at gap locations."
                            )
            except Exception as _diag_err:
                logger.warning(f"[FFMPEG-PREFLIGHT] backfill failed: {_diag_err}")

            ffmpeg_result = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    ffmpeg_cmd, check=False, capture_output=True, text=True, timeout=600
                ),
            )

            if ffmpeg_result.returncode != 0:
                logger.error(f"FFmpeg STDERR:\n{ffmpeg_result.stderr[-2000:]}")
                raise RuntimeError(f"FFmpeg assembly failed: {ffmpeg_result.stderr[-500:]}")

            if not output_path.exists():
                raise RuntimeError(f"FFmpeg completed but output.mp4 not found at {output_path}")

            logger.info(f"Video assembled: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")

            # ── Fix C — Defensive post-trim to planned timeline duration ──
            # Production runs (output(24).mp4) shipped 62.35s containers when
            # the planned timeline was 38.5s — 24s of trailing dead frames.
            # The container claims a longer duration than the visual track;
            # ffmpeg's earlier assembly step appears to over-shoot. We trim
            # the assembled MP4 to the exact planned `total_duration` before
            # S3 upload so downstream consumers get the file the timeline
            # promised. Real render-server bug should be filed separately.
            try:
                _planned_dur = float(total_duration)
                # Only re-encode when the container actually overshoots — a
                # full 1080p re-encode of a 10-min lesson can exceed the 300 s
                # trim timeout on its own.
                _actual_dur = 0.0
                try:
                    _probe = await asyncio.to_thread(
                        subprocess.run,
                        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                         "-of", "csv=p=0", str(output_path)],
                        capture_output=True, text=True, timeout=30,
                    )
                    _actual_dur = float((_probe.stdout or "0").strip() or 0.0)
                except Exception:
                    _actual_dur = 0.0
                if _actual_dur and _actual_dur <= _planned_dur + 0.5:
                    logger.info(
                        f"[Render worker] output.mp4 is {_actual_dur:.2f}s for a "
                        f"{_planned_dur:.2f}s plan — no post-trim needed"
                    )
                elif _planned_dur > 0.5:
                    _trimmed_path = output_path.with_name("output_trimmed.mp4")
                    _trim_cmd = [
                        "ffmpeg", "-y", "-loglevel", "error",
                        "-i", str(output_path),
                        "-t", f"{_planned_dur:.3f}",
                        # Re-encode video (keyframe-accurate cut); stream-copy audio.
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "copy",
                        "-movflags", "+faststart",
                        str(_trimmed_path),
                    ]
                    # Off the event loop: re-encoding a 10-min 1080p MP4 takes
                    # minutes; inline it blocked /health past the liveness
                    # probe and the container was killed with the MP4 built
                    # but not uploaded (ITRC sample, 2026-10-23).
                    _trim_res = await asyncio.to_thread(
                        subprocess.run,
                        _trim_cmd, check=False, capture_output=True, text=True, timeout=300,
                    )
                    if _trim_res.returncode == 0 and _trimmed_path.exists():
                        _orig_mb = output_path.stat().st_size / 1024 / 1024
                        _new_mb = _trimmed_path.stat().st_size / 1024 / 1024
                        logger.info(
                            f"[Render worker] Post-trimmed output.mp4 to {_planned_dur:.2f}s "
                            f"({_orig_mb:.1f} MB → {_new_mb:.1f} MB) (Fix C)"
                        )
                        output_path = _trimmed_path
                    else:
                        logger.warning(
                            f"[Render worker] Post-trim ffmpeg failed (using original): "
                            f"{(_trim_res.stderr or '')[-300:]}"
                        )
            except Exception as _trim_err:
                logger.warning(f"[Render worker] Post-trim exception (using original): {_trim_err}")

            if on_progress:
                on_progress(85)

            # ── Upload to S3 ──
            s3_key = f"ai-videos/{video_id}/video/output.mp4"
            video_url = await asyncio.to_thread(self._upload, output_path, s3_key)
            logger.info(f"Uploaded to S3: {video_url}")

            if on_progress:
                on_progress(100)

            return video_url

        finally:
            # Clean up work directory
            try:
                shutil.rmtree(work_dir, ignore_errors=True)
                logger.info(f"Cleaned up {work_dir}")
            except Exception:
                pass

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _download(self, url: str, local_path: Path):
        """Download a file from S3 URL or any HTTP URL."""
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # Try S3 download first (faster, no public URL needed). Tolerant of
        # global/regional/accelerate hosts; CDN URLs fall through to HTTP.
        if S3_BUCKET and S3_BUCKET in url:
            try:
                m = re.match(
                    rf"^https?://{re.escape(S3_BUCKET)}\.s3[.\-][a-z0-9.\-]*?amazonaws\.com/(.+)$", url)
                if m:
                    s3_key = m.group(1)
                    self._s3.download_file(S3_BUCKET, s3_key, str(local_path))
                    logger.info(f"Downloaded (S3): {local_path.name}")
                    return
            except (ClientError, Exception) as e:
                logger.warning(f"S3 download failed, trying HTTP: {e}")

        # Fallback: HTTP download
        try:
            req = Request(url, headers={"User-Agent": "VacademyRenderWorker/1.0"})
            with urlopen(req, timeout=120) as resp:
                local_path.write_bytes(resp.read())
            logger.info(f"Downloaded (HTTP): {local_path.name}")
        except Exception as e:
            raise RuntimeError(f"Failed to download {url}: {e}")

    async def _composite_source_clips(
        self,
        source_video_path: Path,
        source_clip_entries: list,
        frames_dir: Path,
        render_width: int,
        render_height: int,
        fps: int,
    ) -> None:
        """Replace rendered HTML-only frames with source_video + HTML overlay composites.

        For each SOURCE_CLIP entry in the timeline:
        1. Extract the source video clip for [source_start, source_end]
        2. Read the Playwright-rendered overlay frames (transparent bg) for this shot
        3. Composite overlay on top of source clip → overwrite frame JPGs

        The Playwright renderer produced frames with whatever background the HTML had
        (should be transparent/black for SOURCE_CLIP). We replace those frames with
        the source video underneath + the overlay on top.
        """
        import cv2
        import numpy as np

        cap = cv2.VideoCapture(str(source_video_path))
        if not cap.isOpened():
            logger.error(f"Cannot open source video for compositing: {source_video_path}")
            return

        for entry in source_clip_entries:
            in_time = float(entry.get("inTime", 0))
            exit_time = float(entry.get("exitTime", 0))
            source_start = float(entry.get("source_start", 0))
            source_end = float(entry.get("source_end", source_start + (exit_time - in_time)))

            # Frame range in the output video
            # Frames are named frame_000001.jpg (1-indexed)
            first_frame_num = int(in_time * fps) + 1
            last_frame_num = int(exit_time * fps) + 1
            source_duration = source_end - source_start

            if source_duration <= 0:
                continue

            logger.info(
                f"  Compositing SOURCE_CLIP: output frames {first_frame_num}-{last_frame_num}, "
                f"source {source_start:.1f}-{source_end:.1f}s"
            )

            # Detect compositing mode from the FIRST frame of this shot.
            # Compute card bounds once and reuse for all frames to avoid flicker
            # caused by per-frame bounding-box jitter from JPEG artifacts.
            _first_path = frames_dir / f"frame_{first_frame_num:06d}.jpg"
            _first_overlay = cv2.imread(str(_first_path)) if _first_path.exists() else None

            # Compositing mode: "card" (video in a container) or "fullscreen" (video behind overlay)
            _comp_mode = "fullscreen"
            _card_bounds = None  # (y0, x0, card_h, card_w, new_h, new_w, oy, ox)

            # Explicit hint from the pipeline (overlay infographic mode) — force
            # fullscreen so callouts on top of full-canvas source video aren't
            # clobbered by the card-bounds heuristic.
            _explicit_mode = entry.get("compositing_mode") or ""
            _force_fullscreen = _explicit_mode == "fullscreen"
            if _force_fullscreen:
                logger.info("    Compositing mode: fullscreen (explicit overlay hint from pipeline)")

            if _first_overlay is not None and not _force_fullscreen:
                _fg = cv2.cvtColor(_first_overlay, cv2.COLOR_BGR2GRAY)
                _bm = _fg <= 15
                _br = np.sum(_bm) / _bm.size
                if _br < 0.75:
                    _coords = np.argwhere(_bm)
                    if len(_coords) > 100:
                        _comp_mode = "card"
                        _y0, _x0 = _coords.min(axis=0)
                        _y1, _x1 = _coords.max(axis=0) + 1
                        _card_w, _card_h = _x1 - _x0, _y1 - _y0
                        # Pre-compute source resize dimensions (stable for all frames)
                        _src_fps_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                        _src_fps_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                        _scale = min(_card_w / max(_src_fps_w, 1), _card_h / max(_src_fps_h, 1))
                        _nw = int(_src_fps_w * _scale)
                        _nh = int(_src_fps_h * _scale)
                        _ox = _x0 + (_card_w - _nw) // 2
                        _oy = _y0 + (_card_h - _nh) // 2
                        _card_bounds = (_oy, _ox, _nh, _nw)
                        logger.info(f"    Card layout detected: card=({_x0},{_y0})-({_x1},{_y1}), "
                                    f"video={_nw}x{_nh} at ({_ox},{_oy})")

            # Seek to source_start and read frames sequentially (avoids costly random seeks)
            cap.set(cv2.CAP_PROP_POS_MSEC, source_start * 1000)

            for frame_num in range(first_frame_num, last_frame_num + 1):
                frame_path = frames_dir / f"frame_{frame_num:06d}.jpg"
                if not frame_path.exists():
                    # Still advance the video even if frame file is missing
                    cap.read()
                    continue

                # Calculate the source video timestamp for this output frame
                t_in_shot = (frame_num - first_frame_num) / fps
                t_ratio = t_in_shot / max(exit_time - in_time, 0.001)
                source_t = source_start + t_ratio * source_duration

                # Seek to source timestamp and read frame
                cap.set(cv2.CAP_PROP_POS_MSEC, source_t * 1000)
                ret, src_frame = cap.read()
                if not ret:
                    continue

                # Read the existing overlay frame (rendered by Playwright)
                overlay = cv2.imread(str(frame_path))
                if overlay is None:
                    # Resize source and write directly
                    if src_frame.shape[1] != render_width or src_frame.shape[0] != render_height:
                        src_frame = cv2.resize(src_frame, (render_width, render_height))
                    cv2.imwrite(str(frame_path), src_frame)
                    continue

                # Resize overlay if needed
                if overlay.shape[1] != render_width or overlay.shape[0] != render_height:
                    overlay = cv2.resize(overlay, (render_width, render_height))

                if _comp_mode == "card" and _card_bounds:
                    # Card layout — place source video in the pre-computed card region
                    oy, ox, nh, nw = _card_bounds
                    resized_src = cv2.resize(src_frame, (nw, nh))
                    composited = overlay.copy()
                    composited[oy:oy + nh, ox:ox + nw] = resized_src
                else:
                    # Full-screen overlay — brightness-based alpha
                    if src_frame.shape[1] != render_width or src_frame.shape[0] != render_height:
                        src_frame = cv2.resize(src_frame, (render_width, render_height))
                    gray = cv2.cvtColor(overlay, cv2.COLOR_BGR2GRAY)
                    mask = (gray > 15).astype(np.float32)
                    mask = cv2.GaussianBlur(mask, (3, 3), 0)
                    mask = mask[:, :, np.newaxis]
                    composited = (src_frame * (1.0 - mask) + overlay * mask).astype(np.uint8)

                # Write composited frame back (as JPG to match existing format)
                cv2.imwrite(str(frame_path), composited)

            logger.info(f"  ✅ Composited {last_frame_num - first_frame_num + 1} frames")

        cap.release()

    def _prefetch_timeline_videos(self, timeline_path: Path, work_dir: Path) -> None:
        """Download every remote <video src> in the timeline once and rewrite
        the LOCAL timeline copy to file:// URLs. The page itself is loaded
        via file:// (generate_video.py page.goto), so file:// subresources
        are same-origin and seek instantly — no mid-render buffering, no
        frozen frames. Per-URL failures keep the remote URL (old behavior)."""
        import hashlib
        import re as _re

        data = json.loads(timeline_path.read_text())
        entries = data.get("entries") if isinstance(data, dict) else data
        if not isinstance(entries, list):
            return
        media_dir = work_dir / "media_cache"
        media_dir.mkdir(parents=True, exist_ok=True)
        # video|source AND img: support-visual photos (and stock images)
        # stream from S3 mid-render otherwise — same nondeterminism the
        # video prefetch removed. Tag name captured so images skip the
        # video-only seek re-encode.
        _src_re = _re.compile(
            r"""(<(video|source|img)\b[^>]*?\bsrc\s*=\s*["'])(https?://[^"']+)(["'])""",
            _re.IGNORECASE | _re.DOTALL,
        )
        cache: "dict[str, str]" = {}
        localized = 0

        def _swap(m: "_re.Match") -> str:
            nonlocal localized
            tag = (m.group(2) or "").lower()
            url = m.group(3)
            if url not in cache:
                key = hashlib.md5(url.encode()).hexdigest()[:12]
                ext = url.rsplit(".", 1)[-1].split("?")[0].lower()
                if not ext or len(ext) > 5 or "/" in ext:
                    ext = "png" if tag == "img" else "mp4"
                lp = media_dir / f"clip_{key}.{ext}"
                try:
                    self._download(url, lp)
                    # AI-generated clips ship near-single-GOP streams
                    # (keyframes 3-7s apart) — Chromium's frame-precise seeks
                    # stall past the last early keyframe and the shot FREEZES
                    # for the rest of its window (prod: identical freezes at
                    # 14-19s + 36-44s across renders, anchored exactly on the
                    # clips' sparse keyframes). Re-encode such files with a
                    # dense keyframe grid before the render ever sees them.
                    if tag != "img":
                        lp = self._normalize_for_seek(lp)
                    cache[url] = lp.resolve().as_uri()
                except Exception as exc:
                    logger.warning(f"[MEDIA-PREFETCH] {url[:110]}: {exc} — keeping remote")
                    cache[url] = url
            out = cache[url]
            if out != url:
                localized += 1
            return m.group(1) + out + m.group(4)

        changed = False
        for e in entries:
            if not isinstance(e, dict):
                continue
            html = e.get("html")
            if isinstance(html, str) and ("<video" in html.lower() or "<img" in html.lower()):
                new_html = _src_re.sub(_swap, html)
                if new_html != html:
                    e["html"] = new_html
                    changed = True
        if changed:
            timeline_path.write_text(json.dumps(data, ensure_ascii=False))
            logger.info(
                f"[MEDIA-PREFETCH] localized {localized} <video> src(s) "
                f"({len([v for v in cache.values() if v.startswith('file:')])} file(s)) into {media_dir}"
            )

    def _normalize_for_seek(self, src_path: Path) -> Path:
        """Re-encode a prefetched clip when its keyframe grid is too sparse
        for frame-precise seeking (the renderer seeks every video to every
        frame's timestamp; a >2s keyframe gap makes Chromium's precise seek
        exceed the per-frame budget and the picture freezes). Keyframe every
        12 frames (~0.5s @24fps) makes every seek decode ≤12 frames. Returns
        the path to render from — the original on probe/encode failure."""
        import subprocess
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v",
                 "-show_entries", "frame=pts_time", "-of", "csv=p=0",
                 "-skip_frame", "nokey", str(src_path)],
                capture_output=True, text=True, timeout=60,
            )
            kts = []
            for line in (probe.stdout or "").splitlines():
                s = line.strip().rstrip(",")
                if not s:
                    continue
                try:
                    kts.append(float(s))
                except ValueError:
                    continue
            durp = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(src_path)],
                capture_output=True, text=True, timeout=30,
            )
            dur = float((durp.stdout or "0").strip() or 0.0)
            kts = sorted(set(kts))
            gaps = [b - a for a, b in zip(kts, kts[1:])]
            if kts and dur > 0:
                gaps.append(dur - kts[-1])
            max_gap = max(gaps) if gaps else dur
            if max_gap <= 2.0 and kts:
                return src_path  # dense enough — seeks are cheap already
            out = src_path.with_name(src_path.stem + "_seekable.mp4")
            # CRF 18 + a 12-frame GOP turned a 37 MB Pexels 1080p clip into
            # 80-110 MB (13 Mbit/s), and Chrome's page crashed mounting it
            # ("Target page, context or browser has been closed" before the
            # first frame) — every retry of that render failed the same way.
            # Reproduced on the worker 2026-10-12: CRF 26 (29 MB) and CRF 23
            # capped at 6 Mbit/s (39 MB) render fine. Stock footage is a
            # background bed; 6 Mbit/s at 1080p is plenty.
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-i", str(src_path),
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                 "-maxrate", "6M", "-bufsize", "12M",
                 "-g", "12", "-keyint_min", "12", "-sc_threshold", "0",
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                 "-c:a", "copy", str(out)],
                check=True, capture_output=True, timeout=600,
            )
            logger.info(
                f"[MEDIA-PREFETCH] re-encoded {src_path.name} for seekability "
                f"(max keyframe gap was {max_gap:.1f}s)"
            )
            return out
        except Exception as exc:
            logger.warning(
                f"[MEDIA-PREFETCH] seek-normalize failed for {src_path.name}: {exc} — using original"
            )
            return src_path

    def _collect_video_audio(self, tl_entries: list, work_dir: Path) -> "list[tuple[Path, dict]]":
        """Extract audio specs for every UNMUTED <video> in the timeline HTML.

        Playwright screenshots capture pixels only, so a <video> playing audio
        in the browser is silent in the rendered MP4 — the FFmpeg assembly
        otherwise mixes narration + extra tracks + SFX but never the videos'
        own audio. This walks each timeline entry's HTML, finds unmuted <video>
        tags, downloads the source once per URL, probes for an audio stream,
        and returns list[(local_path, {delay, duration, volume, url})] so
        render() can mux each at its shot's inTime.

        MUTED videos are skipped by design — that's how the audio-policy layer
        marks "narration plays, video is silent" (narration_only AI_VIDEO_HERO,
        decorative loops). UNMUTED videos are the ones meant to be heard
        (AI_VIDEO_HERO intrinsic audio, embedded clips). SOURCE_CLIP videos are
        skipped here (their tag is stripped pre-render and they composite via
        OpenCV; their audio is a separate path).
        """
        import hashlib
        import re

        _video_block = re.compile(r"<video\b([^>]*)>(.*?)</video>", re.IGNORECASE | re.DOTALL)
        _src_attr = re.compile(r"""\bsrc\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
        _muted_attr = re.compile(r"\bmuted\b", re.IGNORECASE)
        _vol_attr = re.compile(r"""\bdata-(?:render-)?volume\s*=\s*["']([0-9.]+)["']""", re.IGNORECASE)

        specs: "list[tuple[Path, dict]]" = []
        url_to_path: "dict[str, Optional[Path]]" = {}

        for entry in tl_entries:
            html = entry.get("html") or ""
            if not html or "<video" not in html.lower():
                continue
            try:
                in_time = float(entry.get("inTime", 0) or 0)
                exit_time = float(entry.get("exitTime", 0) or 0)
            except (TypeError, ValueError):
                continue
            shot_dur = exit_time - in_time
            if shot_dur <= 0:
                continue
            for m in _video_block.finditer(html):
                attrs, inner = m.group(1) or "", m.group(2) or ""
                if _muted_attr.search(attrs):
                    continue  # muted by design — narration plays instead
                if "data-source-clip" in attrs.lower():
                    continue  # composited separately
                _sm = _src_attr.search(attrs) or _src_attr.search(inner)
                if not _sm:
                    continue
                src_raw = _sm.group(1).strip()
                is_data_uri = src_raw[:5].lower() == "data:"
                # Strip a #t= media fragment for real URLs — the renderer seeks
                # every video from 0 at the shot's inTime (relTime % duration),
                # so audio starts from 0 too. Data URIs are left intact (base64
                # payloads never contain '#'; splitting could corrupt them).
                src = src_raw if is_data_uri else src_raw.split("#", 1)[0]
                if not src:
                    continue
                vol = 1.0
                _vm = _vol_attr.search(attrs)
                if _vm:
                    try:
                        vol = max(0.0, min(2.0, float(_vm.group(1))))
                    except (TypeError, ValueError):
                        vol = 1.0
                if src not in url_to_path:
                    if is_data_uri:
                        _vp = self._decode_data_uri_video(src, work_dir)
                        if _vp is None:
                            url_to_path[src] = None
                        else:
                            url_to_path[src] = _vp if self._has_audio_stream(_vp) else None
                            if url_to_path[src] is None:
                                logger.info("[VIDEO-AUDIO] no audio stream in data: URI video — skipping")
                    elif src.startswith("file://"):
                        # Media-prefetch rewrote this src to a local file — use
                        # it directly instead of re-downloading.
                        from urllib.parse import unquote, urlparse
                        _lp = Path(unquote(urlparse(src).path))
                        if _lp.exists():
                            url_to_path[src] = _lp if self._has_audio_stream(_lp) else None
                            if url_to_path[src] is None:
                                logger.info(f"[VIDEO-AUDIO] no audio stream in {_lp.name} — skipping")
                        else:
                            logger.warning(f"[VIDEO-AUDIO] prefetched file missing: {_lp}")
                            url_to_path[src] = None
                    else:
                        _key = hashlib.md5(src.encode()).hexdigest()[:10]
                        _ext = src.rsplit(".", 1)[-1].split("?")[0].lower() or "mp4"
                        if len(_ext) > 5:
                            _ext = "mp4"
                        _vp = work_dir / f"htmlvideo_{_key}.{_ext}"
                        try:
                            self._download(src, _vp)
                        except Exception as exc:
                            logger.warning(f"[VIDEO-AUDIO] download failed for {src[:120]}: {exc}")
                            url_to_path[src] = None
                        else:
                            url_to_path[src] = _vp if self._has_audio_stream(_vp) else None
                            if url_to_path[src] is None:
                                logger.info(f"[VIDEO-AUDIO] no audio stream in {src[:120]} — skipping")
                _path = url_to_path.get(src)
                if _path is None:
                    continue
                _disp_url = f"data:[{len(src)} chars]" if is_data_uri else src
                specs.append((_path, {"delay": in_time, "duration": shot_dur, "volume": vol, "url": _disp_url}))

        if specs:
            _uniq = sum(1 for v in url_to_path.values() if v is not None)
            logger.info(
                f"[VIDEO-AUDIO] {len(specs)} unmuted <video> audio track(s) "
                f"across {_uniq} unique file(s) will be muxed at their shot inTimes"
            )
        return specs

    def _decode_data_uri_video(self, data_uri: str, work_dir: Path) -> Optional[Path]:
        """Decode a `data:` URI <video> source to a temp file for audio extraction.

        Handles `data:<mediatype>[;base64],<payload>`. Base64 payloads are
        decoded (whitespace/newlines from HTML wrapping are tolerated);
        non-base64 payloads are percent-decoded. Returns the written Path, or
        None if the URI is malformed / empty. The file is named by a hash of
        the URI so identical data URIs across shots dedupe to one file.
        """
        import base64
        import hashlib
        from urllib.parse import unquote_to_bytes

        try:
            header, sep, payload = data_uri.partition(",")
            if not sep or not payload:
                return None
            meta = header[5:]  # strip leading "data:"
            is_b64 = ";base64" in meta.lower()
            mediatype = (meta.split(";", 1)[0].strip().lower() or "video/mp4")
            ext = {
                "video/mp4": "mp4",
                "video/webm": "webm",
                "video/ogg": "ogv",
                "video/quicktime": "mov",
                "video/x-matroska": "mkv",
            }.get(mediatype, "mp4")
            if is_b64:
                # validate=False discards HTML-introduced whitespace/newlines
                # before the padding check.
                data = base64.b64decode(payload, validate=False)
            else:
                data = unquote_to_bytes(payload)
            if not data:
                return None
            key = hashlib.md5(data_uri.encode("utf-8", "ignore")).hexdigest()[:10]
            _vp = work_dir / f"htmlvideo_data_{key}.{ext}"
            _vp.write_bytes(data)
            logger.info(
                f"[VIDEO-AUDIO] decoded data: URI video → {_vp.name} "
                f"({len(data) / 1024:.0f} KB, {mediatype})"
            )
            return _vp
        except Exception as exc:
            logger.warning(
                f"[VIDEO-AUDIO] failed to decode data: URI video "
                f"({len(data_uri)} chars): {exc}"
            )
            return None

    def _has_audio_stream(self, path: Path) -> bool:
        """True if `path` has at least one audio stream (ffprobe)."""
        try:
            out = subprocess.check_output(
                ["ffprobe", "-v", "error", "-select_streams", "a",
                 "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
                timeout=30,
            )
            return b"audio" in out
        except Exception:
            return False

    def _upload(self, local_path: Path, s3_key: str) -> str:
        """Upload a file to S3 and return the public URL."""
        self._s3.upload_file(
            str(local_path),
            S3_BUCKET,
            s3_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        return f"https://{S3_BUCKET}.s3.amazonaws.com/{s3_key}"
