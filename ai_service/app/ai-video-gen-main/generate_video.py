import base64
import bisect
import json
import math
import os
import shutil
import sys
import re
import time
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import argparse


from moviepy.audio.io.AudioFileClip import AudioFileClip
from moviepy.video.io.ImageSequenceClip import ImageSequenceClip
from moviepy.video.io.VideoFileClip import VideoFileClip
from moviepy.video.compositing.CompositeVideoClip import CompositeVideoClip
from playwright.sync_api import sync_playwright
from dispatcher_install_js import get_dispatcher_install_js

from render_harness import build_harness_html


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def _prepare_page(page, width: int, height: int, background_color: str = "#000") -> None:
    """Initialize a blank page with desired viewport and helper updaters for snippets/captions."""
    libs = f"file://{Path.cwd()}/assets/libs"
    page.set_viewport_size({"width": width, "height": height})

    # ── Navigation guard ──
    # LLM-generated shot HTML occasionally triggers a real top-level navigation
    # (a `window.location =` script, a <meta http-equiv="refresh">, an
    # auto-submitting <form>, an <a> that gets click()'d). When that navigation
    # commits, the page's JS execution context is destroyed — and the renderer
    # scrubs `gsap.globalTimeline.totalTime(t)` via page.evaluate() on EVERY
    # frame. The next evaluate then dies with "Execution context was destroyed,
    # most likely because of a navigation" and the whole multi-minute render is
    # lost mid-way (observed at frame ~300 when shot-1 mounted).
    #
    # We abort any main-frame navigation that fires AFTER the harness page has
    # loaded. Subresource loads (images/fonts/videos/libs) are navigation=False
    # and pass straight through, so this doesn't break asset loading. Iframe
    # navigations are left alone — they don't touch the main execution context.
    _nav_guard = {"armed": False}

    def _route_guard(route):
        request = route.request
        try:
            if (
                _nav_guard["armed"]
                and request.is_navigation_request()
                and request.frame == page.main_frame
            ):
                print(
                    f"[RENDER-GUARD] blocked top-level navigation → {request.url[:160]}",
                    flush=True,
                )
                route.abort()
                return
        except Exception:
            pass
        try:
            route.continue_()
        except Exception:
            # Route already handled / page closing — nothing to recover.
            pass

    page.route("**/*", _route_guard)

    # Install updater that creates/removes/positions shadow-root wrapped snippets and scales to fit.


    page.add_init_script(
        """
        window.__updateCharacter = (state) => {
          let container = document.getElementById('character-container');
          if (!container) {
            container = document.createElement('div');
            container.id = 'character-container';
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.pointerEvents = 'none';
            container.style.userSelect = 'none';
            container.style.zIndex = '10';
            container.style.zIndex = '10';
            const world = document.getElementById('world-layer') || document.body;
            world.appendChild(container);

            const pose = document.createElement('img');
            pose.id = 'char-pose';
            pose.style.position = 'absolute';
            pose.style.left = '0';
            pose.style.top = '0';
            pose.style.transformOrigin = 'top left';
            pose.style.willChange = 'transform';
            container.appendChild(pose);

            const mouth = document.createElement('img');
            mouth.id = 'char-mouth';
            mouth.style.position = 'absolute';
            mouth.style.transformOrigin = 'top left';
            mouth.style.willChange = 'transform';
            container.appendChild(mouth);
          }

          if (!state || !state.visible) {
            container.style.display = 'none';
            return;
          }

          container.style.display = 'block';
          if (typeof state.zIndex !== 'undefined') {
            container.style.zIndex = String(state.zIndex);
          }

          const poseImg = document.getElementById('char-pose');
          const mouthImg = document.getElementById('char-mouth');

          if (state.poseSrc && poseImg.getAttribute('data-src') !== state.poseSrc) {
            poseImg.src = state.poseSrc;
            poseImg.setAttribute('data-src', state.poseSrc);
          }
          if (state.mouthSrc && mouthImg.getAttribute('data-src') !== state.mouthSrc) {
            mouthImg.src = state.mouthSrc;
            mouthImg.setAttribute('data-src', state.mouthSrc);
          }

          poseImg.style.left = (state.poseX || 0) + 'px';
          poseImg.style.top = (state.poseY || 0) + 'px';
          poseImg.style.transform = `scale(${state.poseScale || 1})`;
          poseImg.style.display = 'block';

          mouthImg.style.left = (state.mouthX || 0) + 'px';
          mouthImg.style.top = (state.mouthY || 0) + 'px';
          mouthImg.style.transform = `scale(${state.mouthScale || 1})`;
          mouthImg.style.display = state.mouthSrc ? 'block' : 'none';
        };
        """
    )


    
    # Camera updater
    page.add_init_script(
        """
        window.__updateCamera = (state) => {
            const world = document.getElementById('world-layer');
            if (!world) return;
            if (!state) {
                world.style.transform = 'translate(0px, 0px) scale(1)';
                return;
            }
            // state: { x, y, scale }
            // Transform origin is center center. 
            // To zoom into (x, y), we need to translate the world such that (x,y) moves to center, then scale.
            // Simplified: We assume x,y are offsets from center (0,0).
            // Actually, let's keep it simple: translate then scale.
            // transform: translate(dx, dy) scale(s)
            
            const x = state.x || 0;
            const y = state.y || 0;
            const s = state.scale || 1;
            
            // To make (x,y) the new center:
            // translate = -x, -y
            // But we might want smooth drift. state.x/y should be computed offsets.
            // Let's assume input state.x/y are in pixels (displacement from center).
            
            world.style.transform = `translate(${-x}px, ${-y}px) scale(${s})`;
        };
        """
    )

    # In-page navigation guard (defense-in-depth alongside the route abort
    # above). Neutralizes the common in-document navigation triggers before any
    # shot HTML runs. The route guard is the catch-all (it stops even a raw
    # `location.href = ...` assignment, which can't be overridden from JS); this
    # init script additionally suppresses anchor clicks / form submits /
    # window.open / beforeunload so they never even reach the network layer.
    page.add_init_script(
        """
        (() => {
          try { window.open = function () { return null; }; } catch (e) {}
          // Anchors / forms: prevent default navigation. Nothing should be
          // clicked during a headless render, but shot scripts sometimes
          // synthesize clicks or call form.submit().
          document.addEventListener('click', (e) => {
            const a = e.target && e.target.closest && e.target.closest('a[href]');
            if (a) { e.preventDefault(); e.stopPropagation(); }
          }, true);
          document.addEventListener('submit', (e) => {
            e.preventDefault(); e.stopPropagation();
          }, true);
          try {
            const noop = function () {};
            HTMLFormElement.prototype.submit = noop;
            if (HTMLFormElement.prototype.requestSubmit) {
              HTMLFormElement.prototype.requestSubmit = noop;
            }
          } catch (e) {}
          // Best-effort: stub the Location methods (direct `location.href = x`
          // is caught by the Playwright route guard, not here).
          try {
            ['assign', 'replace', 'reload'].forEach((m) => {
              try {
                Object.defineProperty(window.location, m, {
                  value: function () {}, writable: false, configurable: true,
                });
              } catch (e) {}
            });
          } catch (e) {}
          // Cancel any beforeunload-driven unload.
          window.addEventListener('beforeunload', (e) => {
            e.preventDefault(); e.returnValue = '';
          }, true);
        })();
        """
    )

    # Base content with background color. HTML overlays are transparent.
    # The harness HTML — with all educational library script tags, base CSS,
    # and the __updateSnippets shadow-DOM dispatcher — lives in render_harness.py
    # so the screenshot endpoint (vision-review path) shares byte-identical setup.
    html_content = build_harness_html(background_color)
    
    temp_html_path = Path.cwd() / ".render_page.html"
    temp_html_path.write_text(html_content, encoding="utf-8")
    page.goto(f"file://{temp_html_path}", wait_until="domcontentloaded")
    # Harness is loaded — arm the navigation guard so any FURTHER top-level
    # navigation (triggered by shot HTML) is aborted instead of destroying the
    # execution context the renderer scrubs each frame.
    _nav_guard["armed"] = True

    # Replace background color token
    # page.evaluate("(bg) => { document.querySelector('style').textContent = document.querySelector('style').textContent.replace('REPLACE_BG', bg); }", background_color)
    # Ensure functions exist on current document as well
    page.evaluate(get_dispatcher_install_js(libs))


def _load_timeline(json_path: Path) -> List[Dict[str, Any]]:
    raw = json.loads(json_path.read_text())
    # Support both new format {"meta": {...}, "entries": [...]} and old flat list [...]
    if isinstance(raw, dict) and "entries" in raw:
        _dims = raw.get("meta", {}).get("dimensions", {})
        _default_w = int(_dims.get("width", 1920))
        _default_h = int(_dims.get("height", 1080))
        data = raw["entries"]
    else:
        _default_w = 1920
        _default_h = 1080
        data = raw
    if not isinstance(data, list):
        raise ValueError("JSON root must be a list of entries (or a dict with 'entries' key)")
    # normalize/validate
    timeline: List[Dict[str, Any]] = []
    for idx, item in enumerate(data):
        for k in ("inTime", "exitTime", "html"):
            if k not in item:
                raise ValueError(f"Timeline item {idx} missing key: {k}")
        _x = int(item.get("htmlStartX", 0))
        _y = int(item.get("htmlStartY", 0))
        _ex = int(item.get("htmlEndX", _default_w))
        _ey = int(item.get("htmlEndY", _default_h))
        entry = {
            "id": str(item.get("id") or f"snippet-{idx}"),
            "inTime": float(item["inTime"]),
            "exitTime": float(item["exitTime"]),
            "x": _x,
            "y": _y,
            "w": _ex - _x,
            "h": _ey - _y,
            "html": str(item["html"]),
        }
        if "z" in item:
            try:
                entry["z"] = int(item["z"])
            except (TypeError, ValueError):
                pass
        # NOTE: intentionally NOT carrying `timescale` here. Reverted from v24
        # because plumbing timescale through to JS made the dispatcher's
        # per-shot-timeline branch fire for most shots, and that approach
        # regressed many previously-working shots while not fixing the
        # original 3 problem shots (shot-1/2/22 in the test render). Leaving
        # timescale undefined in JS means the per-shot-timeline branch stays
        # dormant and shots play at base speed against globalTimeline — which
        # is what worked for the majority before my v24-v30 changes.
        # Carry `entry_meta` through so the per-frame caption block can apply
        # per-shot caption_style overrides (hide / top / bottom). Editor writes
        # this via /frame/update; older timelines without entry_meta no-op.
        em = item.get("entry_meta")
        if isinstance(em, dict):
            entry["entry_meta"] = em
        timeline.append(entry)
    return timeline
def _load_words(words_path: Path) -> List[Dict[str, Any]]:
    data = json.loads(words_path.read_text())
    if not isinstance(data, list):
        raise ValueError("Words JSON must be a list of {word,start,end}")
    words: List[Dict[str, Any]] = []
    for idx, w in enumerate(data):
        if not all(k in w for k in ("word", "start", "end")):
            raise ValueError(f"Word item {idx} missing required keys")
        words.append({
            "word": str(w["word"]),
            "start": float(w["start"]),
            "end": float(w["end"]),
        })
    return words


def _normalize_phone_code(phone: str) -> str:
    base = str(phone or "")
    if "_" in base:
        base = base.split("_", 1)[0]
    base = "".join(ch for ch in base if not ch.isdigit())
    normalized = base.strip().lower()
    return normalized or "closed"


def _load_character_config(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text())
    poses = data.get("poses")
    if not isinstance(poses, dict) or not poses:
        raise ValueError("Character config must include a 'poses' mapping with at least one pose")
    return data


def _load_phoneme_map(path: Path) -> Dict[str, str]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, dict):
        raise ValueError("Phoneme map JSON must be an object of {phone: filename}")
    mapping: Dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(value, str):
            continue
        normalized_key = _normalize_phone_code(key)
        if not normalized_key:
            continue
        mapping[normalized_key] = value
    if "closed" not in mapping:
        raise ValueError("Phoneme map missing required 'closed' entry")
    return mapping


def _load_alignment(path: Path) -> List[Dict[str, Any]]:
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("Alignment JSON must be an object containing a 'words' array")
    phonemes: List[Dict[str, Any]] = []
    current_time = 0.0
    for word in data.get("words", []):
        if not isinstance(word, dict):
            continue
        if word.get("case") and word.get("case") != "success":
            continue
        word_start_raw = word.get("start")
        try:
            word_start = float(word_start_raw)
        except (TypeError, ValueError):
            word_start = current_time
        if word_start > current_time + 1e-6:
            phonemes.append({"phone": "closed", "start": current_time, "end": word_start})
            current_time = word_start
        else:
            current_time = max(current_time, word_start)
        phones = word.get("phones", [])
        if not isinstance(phones, list):
            phones = []
        for p in phones:
            if not isinstance(p, dict):
                continue
            duration_raw = p.get("duration", 0)
            try:
                duration = float(duration_raw)
            except (TypeError, ValueError):
                duration = 0.0
            if duration <= 0:
                continue
            phone_code = _normalize_phone_code(p.get("phone", ""))
            phonemes.append({
                "phone": phone_code,
                "start": current_time,
                "end": current_time + duration,
            })
            current_time += duration
        # If no phones were present but an end time exists, keep the mouth closed
        if not phones:
            word_end_raw = word.get("end")
            try:
                word_end = float(word_end_raw)
            except (TypeError, ValueError):
                word_end = current_time
            if word_end > current_time + 1e-6:
                phonemes.append({"phone": "closed", "start": current_time, "end": word_end})
                current_time = word_end
    return phonemes


def _build_phoneme_index(phonemes: List[Dict[str, Any]]) -> List[float]:
    """Pre-compute a sorted list of phoneme start times for binary search."""
    return [p["start"] for p in phonemes]


def _get_active_phoneme(phonemes: List[Dict[str, Any]], t: float,
                        _start_times: Optional[List[float]] = None) -> str:
    """O(log n) phoneme lookup using bisect on pre-sorted start times."""
    if not phonemes:
        return "closed"
    starts = _start_times if _start_times is not None else [p["start"] for p in phonemes]
    # Find the rightmost phoneme whose start <= t
    idx = bisect.bisect_right(starts, t) - 1
    if idx >= 0 and phonemes[idx]["start"] <= t < phonemes[idx]["end"]:
        return phonemes[idx]["phone"]
    return "closed"


def _build_caption_segments(words: List[Dict[str, Any]], gap_threshold: float = 0.6) -> List[Dict[str, Any]]:
    """Build caption phrases matching the client-side buildPhrases algorithm from useCaptions.ts."""
    if not words:
        return []

    WORDS_PER_PHRASE = 10
    MIN_PHRASE_DURATION = 2.0
    MAX_PHRASE_DURATION = 5.0

    phrases: List[Dict[str, Any]] = []
    current_words: List[Dict[str, Any]] = []
    phrase_start_time = 0.0

    for i, word in enumerate(words):
        if not current_words:
            phrase_start_time = float(word["start"])
        current_words.append(word)

        phrase_duration = float(word["end"]) - phrase_start_time
        word_count = len(current_words)
        word_text = str(word.get("word", "")).strip()

        # Determine if we should end this phrase (matches client logic exactly)
        should_break = (
            # Natural sentence break (ends with punctuation)
            bool(re.search(r'[.!?]$', word_text)) or
            # Maximum words reached
            word_count >= WORDS_PER_PHRASE or
            # Maximum duration exceeded
            phrase_duration >= MAX_PHRASE_DURATION or
            # Comma/semicolon with enough words and time
            (bool(re.search(r'[,;:]$', word_text)) and
                word_count >= 5 and
                phrase_duration >= MIN_PHRASE_DURATION) or
            # Long pause between this word and next (natural break)
            (i < len(words) - 1 and float(words[i + 1]["start"]) - float(word["end"]) > 0.5)
        )

        if should_break or i == len(words) - 1:
            phrases.append({
                "start": phrase_start_time,
                "end": float(word["end"]),
                "text": " ".join(str(w["word"]) for w in current_words),
                "words": current_words[:],
            })
            current_words = []

    return phrases


def _active_caption_at(segments: List[Dict[str, Any]], t: float) -> Dict[str, Any]:
    # Add small tail (0.3s) after phrase ends and early start (0.1s) before phrase begins
    for seg in segments:
        if (seg["start"] - 0.1) <= t <= (seg["end"] + 0.3):
            return seg
    return {}


def _load_branding(branding_path: Path) -> Dict[str, Any]:
    data = json.loads(branding_path.read_text())
    for k in ("html", "x", "y", "w", "h"):
        if k not in data:
            raise ValueError(f"Branding JSON missing key: {k}")
    return {
        "id": "branding",
        "x": int(data["x"]),
        "y": int(data["y"]),
        "w": int(data["w"]),
        "h": int(data["h"]),
        "html": str(data["html"]),
        "z": int(data.get("z", 1000)),
    }


def _path_to_data_uri(path: Path) -> str:
    import mimetypes

    mime, _ = mimetypes.guess_type(str(path))
    if not mime:
        mime = "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


_MEDIA_KEEP_AS_FILE_URL = frozenset({".mp4", ".webm", ".mov", ".m4v", ".ogv", ".mp3", ".wav", ".m4a", ".ogg"})


def _convert_file_urls_to_data_uris(html: str) -> str:
    """Convert file:// URLs in img src attributes to data URIs."""
    import re
    
    def replace_file_url(match):
        quote_char = match.group(1)  # The quote character used (" or ')
        file_url = match.group(2)   # The file URL
        # Remove file:// prefix
        if file_url.startswith("file://"):
            file_path = file_url[7:]  # Remove "file://"
        else:
            file_path = file_url
        
        try:
            path = Path(file_path)
            # Video/audio stay file:// — the page is file:// with
            # --allow-file-access-from-files, so they load and seek directly.
            # Inlined, the render worker's prefetched lesson-teacher clip
            # (62 MB webm for a 10-min lesson) became an 83 MB string that
            # __updateSnippets re-sent every frame: 0.02 fps.
            if path.suffix.lower() in _MEDIA_KEEP_AS_FILE_URL:
                return match.group(0)
            if path.exists():
                data_uri = _path_to_data_uri(path)
                return f'src={quote_char}{data_uri}{quote_char}'
            else:
                print(f"Warning: Image file not found: {file_path}")
                return match.group(0)  # Return original if file doesn't exist
        except Exception as e:
            print(f"Warning: Failed to convert {file_url} to data URI: {e}")
            return match.group(0)  # Return original on error
    
    # Match src="file://..." or src='file://...' (handles both single and double quotes)
    pattern = r'src=(["\'])(file://[^"\']+)\1'
    return re.sub(pattern, replace_file_url, html)


def _load_video_options(options_path: Path) -> Dict[str, Any]:
    data = json.loads(options_path.read_text())
    return {
        "width": int(data.get("width", 1920)),
        "height": int(data.get("height", 1080)),
        "fps": int(data.get("fps", 30)),
        "background_color": str(data.get("background_color", "#000")),
        "show_captions": bool(data.get("show_captions", False)),
        "captions_settings_path": data.get("captions_settings_path"),
        "words_json_path": data.get("words_json_path"),
        "show_branding": bool(data.get("show_branding", False)),
        "branding_json_path": data.get("branding_json_path"),
        "frames_dir": data.get("frames_dir", ".render_frames"),
        "show_character": bool(data.get("show_character", False)),
        "character_config_path": data.get("character_config_path"),
        "phoneme_map_path": data.get("phoneme_map_path"),
        "alignment_json_path": data.get("alignment_json_path"),
        "character_pose": data.get("character_pose"),
        "crossfade_duration": float(data.get("crossfade_duration", 0.0)),
    }


def _load_caption_settings(settings_path: Path) -> Dict[str, Any]:
    data = json.loads(settings_path.read_text())
    # Defaults now match client-side CaptionDisplay.tsx styling
    return {
        "font_family": data.get("font_family", "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"),
        # `font_family_key` is set by render_worker/worker.py when the request
        # specifies one of the harness-loaded fonts ('inter', 'montserrat',
        # 'noto-sans', 'fira-code', 'system'). When present it overrides
        # `font_family` below in the per-frame caption emission so the
        # corresponding Google Font is picked up.
        "font_family_key": data.get("font_family_key"),
        "font_size": data.get("font_size", 48),  # Render default: 48px at 1920w (matches YouTube caption size)
        "font_color": data.get("font_color", "#FFFFFF"),
        "font_weight": data.get("font_weight", 400),  # Client uses normal weight
        "background_color": data.get("background_color", "rgba(0,0,0,0.75)"),  # Client default opacity 0.75
        "padding_px": data.get("padding_px", 10),
        "border_radius_px": data.get("border_radius_px", 8),
        "gap_threshold_seconds": data.get("gap_threshold_seconds", 0.5),  # Matches client pause threshold
        "position": data.get("position", "bottom"),  # top or bottom — matches client
        "box": data.get("box", {"x": 0, "y": 0, "w": 1920, "h": 1080}),
        "text_align": data.get("text_align", "center"),
        "line_height": data.get("line_height", 1.5),
        "max_lines": data.get("max_lines", 2),
        "allow_html": data.get("allow_html", False),
        "annotate_active_word": data.get("annotate_active_word", False),
        "active_word_css": data.get("active_word_css", "font-weight:700; text-decoration:underline;"),
        "inactive_word_css": data.get("inactive_word_css", "opacity:0.9;"),
        "max_words_per_line": int(data.get("max_words_per_line", 10)),
        # Style-polish fields. All optional; defaults preserve the existing
        # phrase-style / system-font / no-stroke rendering when omitted.
        "style": data.get("style", "phrase"),  # 'phrase' or 'karaoke'
        "text_stroke_width": int(data.get("text_stroke_width", 0)),
        "text_stroke_color": data.get("text_stroke_color", "#000000"),
        "highlight_color": data.get("highlight_color", "#fbbf24"),
    }


# Map worker's `font_family_key` enum to the CSS font-family string with a
# system fallback chain (so a missed Google Font load doesn't blank the
# caption). Keep this set in lockstep with the FE
# `caption-rendering.ts:resolveCaptionFontFamily` and the harness's Google
# Fonts link in `render_harness.py:19`.
_SYSTEM_FONT_STACK = (
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif"
)
_FONT_FAMILY_BY_KEY: Dict[str, str] = {
    "system": _SYSTEM_FONT_STACK,
    "inter": f"'Inter', {_SYSTEM_FONT_STACK}",
    "montserrat": f"'Montserrat', {_SYSTEM_FONT_STACK}",
    "noto-sans": f"'Noto Sans', {_SYSTEM_FONT_STACK}",
    "fira-code": "'Fira Code', ui-monospace, monospace",
}


def _active_entries_at(
    timeline: List[Dict[str, Any]],
    t: float,
    crossfade: float = 0.0,
) -> List[Dict[str, Any]]:
    active: List[Dict[str, Any]] = []
    for item in timeline:
        item_id: str = item["id"]
        in_t: float = item["inTime"]
        ex_t: float = item["exitTime"]
        is_branding = item_id.startswith("branding-")
        cf = 0.0 if is_branding else crossfade

        if t < in_t - cf or t >= ex_t + cf:
            continue

        entry = {
            "id": item_id,
            "x": item["x"],
            "y": item["y"],
            "w": item["w"],
            "h": item["h"],
            "html": item["html"],
            "inTime": in_t,
        }
        if "z" in item:
            entry["z"] = item["z"]
        # NOTE: intentionally NOT carrying `timescale` (reverted; see _load_timeline above).
        # Carry `entry_meta` so the per-frame caption block can read
        # entry_meta.caption_style for per-shot overrides.
        if "entry_meta" in item and isinstance(item["entry_meta"], dict):
            entry["entry_meta"] = item["entry_meta"]

        if cf > 0.0:
            if t < in_t:
                entry["opacity"] = max(0.0, min(1.0, (t - (in_t - cf)) / cf))
            elif t >= ex_t:
                entry["opacity"] = max(0.0, min(1.0, (ex_t + cf - t) / cf))
            else:
                entry["opacity"] = 1.0

        active.append(entry)
    return active


def _validate_assets(
    audio_path: Path,
    timeline_path: Path,
    show_captions: bool,
    captions_words_path: str,
    captions_settings_path: str,
    show_branding: bool,
    branding_json_path: str,
    show_character: bool,
    character_config_path: str,
    phoneme_map_path: str,
    alignment_json_path: str,
) -> None:
    """Pre-flight check to ensure all referenced assets exist."""
    print("🔍 Validating assets...")
    errors = []

    if not audio_path.exists():
        errors.append(f"Audio file missing: {audio_path}")
    
    if not timeline_path.exists():
        errors.append(f"Timeline JSON missing: {timeline_path}")
    else:
        # Check assets referenced in timeline HTML
        try:
            import re
            timeline_data = json.loads(timeline_path.read_text())
            # Support new format {"meta": {...}, "entries": [...]}
            if isinstance(timeline_data, dict) and "entries" in timeline_data:
                timeline_data = timeline_data["entries"]
            for idx, item in enumerate(timeline_data):
                html = item.get("html", "")
                # Find all file:// paths
                # Regex matches src="file://..." or src='file://...'
                matches = re.finditer(r'src=["\']file://([^"\']+)["\']', html)
                for m in matches:
                    file_path = Path(m.group(1))
                    if not file_path.exists():
                        errors.append(f"Missing asset in timeline item {idx}: {file_path}")
        except Exception as e:
            errors.append(f"Failed to parse timeline JSON for validation: {e}")

    if show_captions:
        if not captions_words_path:
            errors.append("Captions enabled but words JSON path not provided.")
        elif not Path(captions_words_path).exists():
            errors.append(f"Captions words JSON missing: {captions_words_path}")
            
        if not captions_settings_path:
            errors.append("Captions enabled but settings JSON path not provided.")
        elif not Path(captions_settings_path).exists():
            errors.append(f"Captions settings JSON missing: {captions_settings_path}")

    if show_branding:
        if not branding_json_path:
            errors.append("Branding enabled but branding JSON path not provided.")
        elif not Path(branding_json_path).exists():
            errors.append(f"Branding JSON missing: {branding_json_path}")
        else:
            # Check image in branding if present
            try:
                import re
                branding_data = json.loads(Path(branding_json_path).read_text())
                html = branding_data.get("html", "")
                matches = re.finditer(r'src=["\']file://([^"\']+)["\']', html)
                for m in matches:
                    file_path = Path(m.group(1))
                    if not file_path.exists():
                        errors.append(f"Missing asset in branding JSON: {file_path}")
            except Exception as e:
                errors.append(f"Failed to parse branding JSON for validation: {e}")

    if show_character:
        if not character_config_path:
            errors.append("Character enabled but config path not provided.")
        elif not Path(character_config_path).exists():
            errors.append(f"Character config missing: {character_config_path}")
        else:
            # Check character assets (simplified check)
            try:
                config_p = Path(character_config_path)
                char_data = json.loads(config_p.read_text())
                poses_dir = config_p.parent / "poses"
                pose = char_data.get("poses", {}).get(char_data.get("defaultPose", "normal"))
                if pose and "image" in pose:
                    if not (poses_dir / pose["image"]).exists():
                        errors.append(f"Character default pose image missing: {pose['image']}")
            except Exception:
                 pass # Warning only, strictly checked later

        if not phoneme_map_path:
            # Default check handled in logic, but if provided must exist
            pass 
        elif not Path(phoneme_map_path).exists():
            errors.append(f"Phoneme map missing: {phoneme_map_path}")

        if not alignment_json_path:
            pass # logic tries default
        elif not Path(alignment_json_path).exists():
            errors.append(f"Alignment JSON missing: {alignment_json_path}")

    if errors:
        print("\n❌ Asset Validation Failed:")
        for err in errors:
            print(f"  - {err}")
        raise FileNotFoundError("One or more required assets are missing. See log above.")
    
    print("✅ Assets validated.")
def render_video_from_json(
    audio_path: str,
    json_path: str,
    output_path: str = "output.mp4",
    width: Optional[int] = None,
    height: Optional[int] = None,
    fps: Optional[int] = None,
    temp_frames_dir: Optional[str] = None,
    background_color: Optional[str] = None,
    video_options_path: str = "",
    captions_words_path: str = "",
    captions_settings_path: str = "",
    show_captions: Optional[bool] = None,
    branding_json_path: str = "",
    show_branding: Optional[bool] = None,
    show_character: Optional[bool] = None,
    character_config_path: str = "",
    phoneme_map_path: str = "",
    alignment_json_path: str = "",
    character_pose: str = "",
    avatar_video_path: str = "",
    audio_delay: float = 0.0,
    frames_only: bool = False,
    start_frame: Optional[int] = None,
    end_frame: Optional[int] = None,
    device_scale_factor: Optional[int] = None,
) -> Path:
    """
    Render a portrait video by placing timed HTML overlays (from JSON) on a 1080x1920 canvas
    and combining the frames with the provided MP3 narration.

    Args:
        audio_path: Path to the narration audio (e.g., MP3).
        json_path: Path to timeline JSON (list of entries with inTime/exitTime and HTML + box).
        output_path: Output MP4 filepath.
        width: Video width (default 1080).
        height: Video height (default 1920).
        fps: Frames per second (default 30).
        temp_frames_dir: Directory to store intermediate PNG frames.
        show_character: Enable Matamata-style lip-sync rendering.
        character_config_path: Path to the character pose configuration JSON.
        phoneme_map_path: Path to phoneme->mouth sprite mapping JSON.
        alignment_json_path: Path to Gentle alignment JSON containing phoneme timings.
        character_pose: Optional pose name override (defaults to config's default).

    Returns:
        Path to the generated MP4 file.
    """
    audio_p = Path(audio_path).expanduser().resolve()
    json_p = Path(json_path).expanduser().resolve()
    out_p = Path(output_path).expanduser().resolve()

    # Apply video options file if provided
    opts: Dict[str, Any] = {}
    if video_options_path:
        opts = _load_video_options(Path(video_options_path).expanduser().resolve())
    # Resolve final render settings with precedence: CLI args > options.json > defaults
    width = width if width is not None else opts.get("width", 1920)
    height = height if height is not None else opts.get("height", 1080)
    fps = fps if fps is not None else opts.get("fps", 30)
    background_color = background_color if background_color is not None and background_color != "" else opts.get("background_color", "#000")
    temp_frames_dir = temp_frames_dir if temp_frames_dir else opts.get("frames_dir", ".render_frames")
    # Resolve boolean flags with precedence: CLI args (explicit) > options.json > default (False)
    # When CLI passes an explicit True/False, respect it. When None (not set), fall back to config.
    if show_captions is None:
        show_captions = bool(opts.get("show_captions", False))
    if show_captions:
        if not captions_words_path and opts.get("words_json_path"):
            captions_words_path = opts["words_json_path"]
        if not captions_settings_path and opts.get("captions_settings_path"):
            captions_settings_path = opts["captions_settings_path"]
    if show_branding is None:
        show_branding = bool(opts.get("show_branding", False))
    if show_branding:
        if not branding_json_path and opts.get("branding_json_path"):
            branding_json_path = opts["branding_json_path"]
    if show_character is None:
        show_character = bool(opts.get("show_character", False))
    if not character_config_path and opts.get("character_config_path"):
        character_config_path = opts["character_config_path"]
    if not phoneme_map_path and opts.get("phoneme_map_path"):
        phoneme_map_path = opts["phoneme_map_path"]
    if not alignment_json_path and opts.get("alignment_json_path"):
        alignment_json_path = opts["alignment_json_path"]
    if not character_pose and opts.get("character_pose"):
        character_pose = opts["character_pose"]

    # --- Pre-Validation Step ---
    _validate_assets(
        audio_path=audio_p,
        timeline_path=json_p,
        show_captions=show_captions,
        captions_words_path=captions_words_path,
        captions_settings_path=captions_settings_path,
        show_branding=show_branding,
        branding_json_path=branding_json_path,
        show_character=show_character,
        character_config_path=character_config_path,
        phoneme_map_path=phoneme_map_path,
        alignment_json_path=alignment_json_path,
    )
    # ---------------------------

    frames_dir = Path(temp_frames_dir).expanduser().resolve()

    if not audio_p.exists():
        raise FileNotFoundError(f"Audio not found: {audio_p}")
    if not json_p.exists():
        raise FileNotFoundError(f"JSON not found: {json_p}")

    # Prepare timeline, audio, optional captions/branding
    timeline = _load_timeline(json_p)

    # Convert file:// URLs in timeline HTML to data URIs so images can load in browser
    for entry in timeline:
        h = entry.get("html", "")
        if not isinstance(h, str):
            continue

        # Sanitize common LLM artifacts where attributes are wrapped in brackets e.g. class="]mermaid["
        # Regex for class="]value[" -> class="value"
        h = re.sub(r'=(["\'])\](.*?)\[\1', r'=\1\2\1', h)

        entry["html"] = _convert_file_urls_to_data_uris(h)

    audio_clip = AudioFileClip(str(audio_p))
    audio_duration: float = float(audio_clip.duration)
    
    # Calculate total video duration from timeline (which includes intro/outro if present)
    # The timeline now has branding entries that extend beyond the audio
    timeline_max_end = max((float(e.get("exitTime", 0)) for e in timeline), default=audio_duration)
    
    # If audio_delay is specified, the audio starts after intro, so total duration is:
    # intro_duration + audio_duration + outro_duration
    # The timeline already accounts for this, so we use the timeline's max end time
    duration: float = max(audio_duration + audio_delay, timeline_max_end)
    total_frames = int(math.ceil(duration * fps))
    
    print(f"DEBUG: Audio duration: {audio_duration}s")
    print(f"DEBUG: Audio delay (intro): {audio_delay}s")
    print(f"DEBUG: Timeline max end: {timeline_max_end}s")
    print(f"DEBUG: Total video duration: {duration}s")
    print(f"DEBUG: Total frames to render: {total_frames}")
    
    # Apply audio delay - audio will start after the intro
    if audio_delay > 0:
        print(f"DEBUG: Applying audio delay of {audio_delay}s for intro silence")
        audio_clip = audio_clip.with_start(audio_delay)

    caption_segments: List[Dict[str, Any]] = []
    caption_words: List[Dict[str, Any]] = []
    caption_styles: Dict[str, Any] = {}
    if show_captions:
        if not captions_words_path or not captions_settings_path:
            raise ValueError("Captions requested but words path or settings path not provided")
        words_p = Path(captions_words_path).expanduser().resolve()
        settings_p = Path(captions_settings_path).expanduser().resolve()
        if not words_p.exists():
            raise FileNotFoundError(f"Words JSON not found: {words_p}")
        if not settings_p.exists():
            raise FileNotFoundError(f"Caption settings JSON not found: {settings_p}")
        words = _load_words(words_p)
        
        # Offset caption word timings by audio_delay (for intro silence)
        if audio_delay > 0:
            for word in words:
                word["start"] = float(word.get("start", 0)) + audio_delay
                word["end"] = float(word.get("end", 0)) + audio_delay
        
        caption_words = words
        caption_settings = _load_caption_settings(settings_p)
        caption_segments = _build_caption_segments(words, caption_settings["gap_threshold_seconds"])
        caption_styles = caption_settings
        # Caption is rendered as a full-viewport overlay with CSS positioning
        # (matching client-side CaptionDisplay.tsx approach) — see the per-frame
        # caption HTML emission below for the actual position/box logic.
        # Caption font_size in caption_settings is "px at the 1920px canvas".
        # Scale by the LONG side (max of width/height), not width alone:
        # width-only scaling halves portrait captions relative to frame height
        # (64px → 36px on a 1920-TALL frame ≈ 1.9% of height, half the
        # TikTok/CapCut norm). max(w,h)/1920 is identical for landscape and
        # restores portrait captions to the same proportion of the long side.
        # Single source of truth — the render-worker passes user-selected px
        # through unchanged so this stays the only canvas-relative scale; if
        # we ever scale here AND in the worker the result compounds and
        # silently shrinks captions.
        caption_font_scale = max(width, height) / 1920.0
        base_font_size = caption_settings.get("font_size", 20)
        caption_settings["font_size"] = max(12, int(base_font_size * caption_font_scale))

    branding_entry: Dict[str, Any] = {}
    if show_branding:
        if not branding_json_path:
            raise ValueError("Branding requested but branding_json_path not provided")
        branding_p = Path(branding_json_path).expanduser().resolve()
        if not branding_p.exists():
            raise FileNotFoundError(f"Branding JSON not found: {branding_p}")
        branding_entry = _load_branding(branding_p)
        # Convert file:// URLs in branding HTML to data URIs
        if "html" in branding_entry:
            branding_entry["html"] = _convert_file_urls_to_data_uris(branding_entry["html"])

    alignment_phonemes: List[Dict[str, Any]] = []
    phoneme_map_lookup: Dict[str, str] = {}
    pose_image_src: str = ""
    pose_offset_x = 0.0
    pose_offset_y = 0.0
    mouth_anchor_x = 0.0
    mouth_anchor_y = 0.0
    pose_scale_value = 1.0
    mouth_scale_value = 1.0
    character_z_index = 10
    mouths_dir: Optional[Path] = None
    mouth_src_cache: Dict[str, str] = {}

    if show_character:
        if not character_config_path:
            default_character_candidates = [
                Path("assets/character/character.json"),
                Path("assets/character/SampleCharacter/character.json"),
            ]
            for candidate in default_character_candidates:
                if candidate.exists():
                    character_config_path = str(candidate)
                    break
        if not character_config_path:
            raise ValueError("Character rendering requested but character_config_path not provided")
        config_p = Path(character_config_path).expanduser().resolve()
        if not config_p.exists():
            raise FileNotFoundError(f"Character config not found: {config_p}")
        char_config = _load_character_config(config_p)
        poses_config = char_config.get("poses", {})
        pose_defs: Dict[str, Dict[str, Any]] = {
            name: data
            for name, data in poses_config.items()
            if isinstance(data, dict) and "image" in data
        }
        if not pose_defs:
            raise ValueError("Character config does not define any usable poses")
        resolved_pose_name = character_pose or poses_config.get("defaultPose") or char_config.get("defaultPose") or "normal"
        if resolved_pose_name not in pose_defs:
            resolved_pose_name = next(iter(pose_defs.keys()))
        default_mouth_scale = float(poses_config.get("defaultMouthScale", char_config.get("defaultMouthScale", 1.0)))
        character_dir = config_p.parent
        poses_dir = (character_dir / "poses").expanduser().resolve()
        mouths_dir = (character_dir / "mouths").expanduser().resolve()
        if not poses_dir.exists():
            raise FileNotFoundError(f"Character poses directory not found: {poses_dir}")
        if not mouths_dir.exists():
            raise FileNotFoundError(f"Character mouths directory not found: {mouths_dir}")
        pose_sources: Dict[str, str] = {}
        for pose_name, pose_data in pose_defs.items():
            image_name = pose_data.get("image")
            if not image_name:
                raise ValueError(f"Pose '{pose_name}' missing image filename")
            pose_path = (poses_dir / image_name).expanduser().resolve()
            if not pose_path.exists():
                raise FileNotFoundError(f"Pose image not found: {pose_path}")
            pose_sources[pose_name] = _path_to_data_uri(pose_path)
        pose_data = pose_defs[resolved_pose_name]
        pose_image_src = pose_sources[resolved_pose_name]
        pose_offset_x = float(pose_data.get("poseX", pose_data.get("offsetX", 0.0)))
        pose_offset_y = float(pose_data.get("poseY", pose_data.get("offsetY", 0.0)))
        mouth_anchor_x = float(pose_data.get("mouthX", pose_data.get("x", 0.0)))
        mouth_anchor_y = float(pose_data.get("mouthY", pose_data.get("y", 0.0)))
        pose_scale_value = float(pose_data.get("poseScale", pose_data.get("scale", 1.0)))
        mouth_scale_value = float(pose_data.get("mouthScale", 1.0)) * float(default_mouth_scale) * pose_scale_value
        character_z_index = int(pose_data.get("zIndex", 10))

        if not phoneme_map_path:
            default_phoneme_map = Path("assets/phonemes.json")
            if default_phoneme_map.exists():
                phoneme_map_path = str(default_phoneme_map)
        if not phoneme_map_path:
            raise ValueError("Character rendering requires phoneme_map_path or assets/phonemes.json")
        phoneme_map_p = Path(phoneme_map_path).expanduser().resolve()
        if not phoneme_map_p.exists():
            raise FileNotFoundError(f"Phoneme map not found: {phoneme_map_p}")
        phoneme_map_lookup = _load_phoneme_map(phoneme_map_p)

        if not alignment_json_path:
            for candidate in (Path("alignment.json"), Path("assets/alignment.json")):
                if candidate.exists():
                    alignment_json_path = str(candidate)
                    break
        if not alignment_json_path:
            raise ValueError("Character rendering requires alignment_json_path (Gentle output)")
        alignment_p = Path(alignment_json_path).expanduser().resolve()
        if not alignment_p.exists():
            raise FileNotFoundError(f"Alignment JSON not found: {alignment_p}")
        alignment_phonemes = _load_alignment(alignment_p)
        if not alignment_phonemes:
            raise ValueError(f"Alignment JSON '{alignment_p}' did not provide any phonemes")
        # Pre-build sorted start-time index for O(log n) phoneme lookups
        _phoneme_start_times = _build_phoneme_index(alignment_phonemes)

    # Frames directory
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Render frames using Playwright (CSS animations run in real-time between frames)
    print("[RENDER-STAGE] launching chromium", flush=True)
    with sync_playwright() as p:
        # Retry chromium.launch on transient failure. When N parallel workers
        # all spawn chromium simultaneously on a tight-RAM box, the OS can
        # briefly deny one of them (OOM at allocation, fork limit, /tmp
        # contention). Playwright's `rewrite_error` truncates the underlying
        # cause so we can't see why — retrying with a small backoff lets the
        # transient pressure pass instead of failing the whole worker.
        _launch_args = dict(
            channel="chrome",  # Google Chrome — includes H.264/AAC codecs (Playwright Chromium lacks them)
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--allow-file-access-from-files",
                "--disable-web-security",
                "--autoplay-policy=no-user-gesture-required",
                # Use SwiftShader for GPU compositing (software GL) — enables
                # the same CSS compositor pipeline as headed Chrome, producing
                # smoother transforms and SVG rendering than --disable-gpu.
                "--use-gl=swiftshader",
                "--enable-gpu-rasterization",
            ],
        )
        browser = None
        _last_launch_err: Optional[BaseException] = None
        for _attempt in range(3):
            try:
                browser = p.chromium.launch(**_launch_args)
                break
            except Exception as _e:
                _last_launch_err = _e
                _backoff = 2.0 * (_attempt + 1)  # 2s, 4s, 6s
                print(
                    f"[RENDER-STAGE] chromium.launch attempt {_attempt + 1}/3 failed: "
                    f"{type(_e).__name__}: {_e}. Retrying in {_backoff:.1f}s",
                    flush=True,
                )
                import time as _time
                _time.sleep(_backoff)
        if browser is None:
            raise RuntimeError(
                f"chromium.launch failed after 3 attempts: {_last_launch_err}"
            ) from _last_launch_err
        print("[RENDER-STAGE] chromium launched, opening context", flush=True)
        _dpi_scale = device_scale_factor if device_scale_factor is not None else 1
        print(f"🎥 Rendering with DPI Scale Factor: {_dpi_scale}", flush=True)
        context = browser.new_context(
            viewport={"width": width, "height": height},
            device_scale_factor=_dpi_scale,
        )
        page = context.new_page()
        print("[RENDER-STAGE] page created, preparing harness", flush=True)
        
        # Hook up console logging to Python stdout for debugging
        # Log errors, warnings, and info for full visibility
        _browser_error_count = [0]
        def _on_console(msg):
            if msg.type in ("error", "warning"):
                _browser_error_count[0] += 1
                print(f"[BROWSER {msg.type.upper()}] {msg.text}")
            elif msg.type in ("info", "log", "debug"):
                txt = msg.text
                if any(tag in txt for tag in ("DIAG", "VERSION", "ANNOT", "SIZING", "VIVUS", "ROUGHNOTATION", "per-shot-timeline", "per-shot-timeline-postscript", "per-shot-timeline-postscript-gtl", "TS-RX", "vx-timescale", "scoped-gsap", "SCRIPT-ERR")):
                    print(f"[BROWSER LOG] {txt}")
        page.on("console", _on_console)
        def _on_pageerror(err):
            # Filter known cosmetic errors from LLM-generated content
            err_str = str(err)
            harmless_patterns = (
                "Vivus [constructor]",  # SVG ID not in shadow DOM — falls back gracefully
                "Cannot read properties of null (reading 'parentElement')",  # LLM script ref to detached node
                "Cannot read properties of null (reading 'getTotalLength')",  # SVG path on null
                "Cannot read properties of null (reading 'classList')",  # null element manipulation
                "Cannot read properties of null (reading 'style')",  # null element style
                "Cannot read properties of undefined (reading 'show')",  # annotation on undefined
            )
            if any(p in err_str for p in harmless_patterns):
                # Track but don't print — these don't break rendering
                _browser_error_count[0] += 1
                return
            _browser_error_count[0] += 1
            print(f"[BROWSER EXCEPTION] {err}")
        page.on("pageerror", _on_pageerror)
        
        _prepare_page(page, width=width, height=height, background_color=background_color)
        # ── Build version marker ── (bump this when deploying changes)
        print(f"[RENDER-VERSION] generate_video.py build=2026-05-26-v36 (nav-guard + dispatcher neutralizes location/open/document.write in shot scripts, fps={fps})", flush=True)
        # Wait for fonts to load before rendering frames
        try:
            page.evaluate("() => document.fonts.ready")
        except Exception:
            pass
        if not show_character:
            page.evaluate("() => window.__updateCharacter && window.__updateCharacter(null)")

        # ── Inject batched render function to reduce IPC round-trips ──
        # One page.evaluate() per frame instead of 5-7 separate calls.
        page.evaluate("""() => {
            window.__batchRenderFrame = async (state) => {
                // 1. Update snippets
                if (state.entries) await window.__updateSnippets(state.entries);
                // 2. Update camera
                if (window.__updateCamera) window.__updateCamera(state.camera);
                // 3. Update character
                if (state.character && window.__updateCharacter) window.__updateCharacter(state.character);
                // 4. Update caption
                if (window.__updateCaption) window.__updateCaption(state.caption || null);
                // 5. Sync GSAP — seek global timeline to current frame time.
                // totalTime() on a paused timeline still updates all child tweens.
                try {
                    gsap.globalTimeline.totalTime(state.t);
                } catch(e) {}
                // 5a. At shot boundaries, kill tweens that ended more than 1s ago.
                // The renderer reuses the same gsap.globalTimeline across all shots
                // in a chunk (see worker.py:312 — "shots share window.gsap.globalTimeline").
                // Completed tweens stay registered and are walked every scrub, so
                // per-frame cost grows linearly with shot index. Killing the dead
                // ones at each segment change keeps that cost flat without
                // disturbing tweens that are active or upcoming.
                if (state.segmentChanged) {
                    try {
                        const cutoff = state.t - 1;
                        // CRITICAL: nested=false. The previous version used
                        // getChildren(true, ...) which walks recursively into
                        // master timelines added by shot scripts. For tweens
                        // INSIDE a nested timeline, tween.endTime() returns the
                        // timeline-LOCAL position (e.g., 6.6 for a tween at
                        // tl-position 6.0 dur 0.6), NOT the absolute gtl time.
                        // cutoff is in absolute gtl time (e.g., state.t - 1 =
                        // 8.5 when state.t=9.5). 6.6 < 8.5 → killed before
                        // firing. Result: every nested tween in shot scripts'
                        // gsap.timeline().to(...) chains was getting killed
                        // immediately on shot mount (segmentChanged=true), so
                        // they never fired. Visual symptom: shot-1 EXECUTION
                        // GAP stuck at scale 0.5 (the scale-2 tween was at
                        // tl-position 6.0, killed); shot-2 entirely white
                        // (every master-tl tween killed; only the immediate-
                        // render fromVars from tl.fromTo applied, leaving
                        // #shot-root at opacity:0); shot-22 flash-word words
                        // stuck at opacity 1 from first .to but second .to
                        // never fired. Free-standing gsap.to/fromTo etc.
                        // (top-level gtl children) survived because their
                        // endTime() IS absolute gtl time.
                        // Walking only direct children fixes this — top-level
                        // tween/timeline endTime is absolute. Killing a parent
                        // timeline cascades to its internal tweens, which is
                        // also fine for cleanup purposes.
                        const children = gsap.globalTimeline.getChildren(false, true, true);
                        let _killed = 0;
                        for (const tw of children) {
                            try {
                                const et = tw.endTime();
                                if (typeof et === 'number' && et < cutoff) {
                                    tw.kill();
                                    _killed++;
                                }
                            } catch(e) {}
                        }
                        if (_killed > 0) {
                            console.log('[GSAP-GC] killed=' + _killed + ' at t=' + state.t.toFixed(2));
                        }
                    } catch(e) {}
                }
                // 5b. Sync Anime.js registered timelines
                try { if (window._animeSeek) window._animeSeek(state.t); } catch(e) {}
                // 5c. Scrub CSS animations inside opted-in subtrees.
                // CSS keyframe animations run on the WALL clock, but frames here
                // are captured at non-realtime pace — without scrubbing, every
                // animation-delay'd reveal (reels karaoke captions, stat pops,
                // chart draws, emoji pops) lands at a machine-dependent time in
                // the output MP4. Subtrees marked data-anim-scrub get every
                // WAAPI-visible animation paused and pinned to the scrub clock:
                // currentTime = (state.t - host inTime), which preserves the
                // authored animation-delay semantics exactly. Opt-in so legacy
                // video-gen shots keep their historical wall-clock behavior.
                try {
                    const scrubHosts = document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]');
                    scrubHosts.forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        const optIns = root.querySelectorAll('[data-anim-scrub]');
                        if (optIns.length === 0) return;
                        const inTime = parseFloat(host.dataset.inTime || '0');
                        const relMs = Math.max(0, (state.t - inTime) * 1000);
                        const seen = new Set();
                        optIns.forEach(el => {
                            let anims = [];
                            try { anims = el.getAnimations({ subtree: true }); } catch (e) {}
                            anims.forEach(a => {
                                if (seen.has(a)) return;
                                seen.add(a);
                                try {
                                    if (a.playState !== 'paused') a.pause();
                                    a.currentTime = relMs;
                                } catch (e) {}
                            });
                        });
                    });
                } catch (e) {}
                // 6. Seek stock videos (skip entirely if none exist).
                //
                // Broken-video defence: when a stock URL fails to load, the <video>
                // sits at readyState=0 indefinitely. The previous code waited up
                // to 10s for `canplaythrough` + 2s for `seeked` PER FRAME PER VIDEO,
                // turning a single 404'd clip into 11s/frame for the whole shot.
                //
                // We now use a wall-clock budget per video: each video gets up to
                // VIDEO_LOAD_BUDGET_MS to reach readyState>=2 (HAVE_CURRENT_DATA,
                // which is enough to seek). On reaching it we render normally; if
                // the budget runs out we permanently skip seeks for that video.
                // The render rate doesn't affect the budget (some boxes render
                // 5fps, others 0.5fps — a frame-count threshold would unfairly
                // penalise slow-loading-but-valid videos on slow render boxes).
                const VIDEO_LOAD_BUDGET_MS = 5000;
                if (!window.__videoState) window.__videoState = new WeakMap();
                if (state.seekVideos) {
                    const allHosts = document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]');
                    let hasVideos = false;
                    allHosts.forEach(host => {
                        const root = host.shadowRoot;
                        if (root && root.querySelector('video')) hasVideos = true;
                    });
                    if (!hasVideos) { /* skip */ }
                    else {
                    const seekPromises = [];
                    allHosts.forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('video').forEach(v => {
                            try {
                                v.pause();
                                // Initialise per-video bookkeeping on first sight.
                                let _vs = window.__videoState.get(v);
                                if (!_vs) {
                                    _vs = { brokenSinceMs: null, gaveUp: false };
                                    window.__videoState.set(v, _vs);
                                }
                                // Permanently skip if we've already given up.
                                if (_vs.gaveUp) return;
                                // Not enough data to seek: give the video up to
                                // VIDEO_LOAD_BUDGET_MS wall-clock to load before
                                // permanently skipping it. Reset the timer if the
                                // video later recovers.
                                if (v.readyState < 2) {
                                    if (_vs.brokenSinceMs === null) {
                                        _vs.brokenSinceMs = performance.now();
                                    } else if (performance.now() - _vs.brokenSinceMs > VIDEO_LOAD_BUDGET_MS) {
                                        _vs.gaveUp = true;
                                        try { console.log('[VIDEO-DIAG] gave up on video after ' + VIDEO_LOAD_BUDGET_MS + 'ms unloaded (src=' + (v.currentSrc || v.src || '?') + ')'); } catch(e) {}
                                    }
                                    return;
                                }
                                // Recovered (or never broken) — clear the timer.
                                _vs.brokenSinceMs = null;
                                const doSeek = async () => {
                                    // Tight wait if we have data but not yet
                                    // canplaythrough — gives a partly-loaded
                                    // video a brief chance to settle, but bounds
                                    // the per-frame cost.
                                    if (v.readyState < 4) {
                                        await new Promise(r => {
                                            v.addEventListener('canplaythrough', r, { once: true });
                                            setTimeout(r, 250);
                                        });
                                    }
                                    const inTime = parseFloat(host.dataset.inTime || '0');
                                    const relTime = state.t - inTime;
                                    let targetTime = 0;
                                    if (v.duration && v.duration > 0 && relTime >= 0) {
                                        // Only explicitly-looping videos wrap with
                                        // modulo; everything else (e.g. the reels
                                        // speaker clip) clamps to its last frame so
                                        // a timeline that slightly outruns the clip
                                        // doesn't flash the first frame at the end.
                                        const loops = v.loop || v.hasAttribute('loop') || v.dataset.loop === '1';
                                        targetTime = loops
                                            ? (relTime % v.duration)
                                            : Math.min(relTime, Math.max(0, v.duration - (state.frameStepS || 0.04)));
                                    } else if (relTime >= 0) {
                                        targetTime = relTime;
                                    }
                                    // Half-frame tolerance: the previous fixed 50ms
                                    // tolerance exceeded the 33-40ms frame step, so
                                    // consecutive-frame seeks were skipped and video
                                    // motion ran at half rate (judder).
                                    const seekTol = Math.min(0.05, (state.frameStepS || 0.04) / 2);
                                    if (Math.abs(v.currentTime - targetTime) > seekTol) {
                                        await new Promise(r => {
                                            v.addEventListener('seeked', r, { once: true });
                                            setTimeout(r, 250);
                                            v.currentTime = targetTime;
                                        });
                                    }
                                };
                                seekPromises.push(doSeek());
                            } catch(e) {}
                        });
                    });
                    if (seekPromises.length > 0) await Promise.all(seekPromises);
                    } // end else (hasVideos)
                }
                // 7. Rough Notation — force redraw on segment changes (hide+show
                // to rebuild the SVG path with current layout). On non-segment
                // frames, just ensure isShowing without redrawing.
                if (window.__registeredAnnotations && window.__registeredAnnotations.length > 0) {
                    let redrawnCount = 0;
                    window.__registeredAnnotations.forEach(a => {
                        try {
                            if (state.segmentChanged) {
                                // Force redraw — handles cases where the SVG was
                                // drawn before layout settled (zero-length paths)
                                if (a.isShowing) a.hide();
                                a.show();
                                redrawnCount++;
                            } else if (!a.isShowing) {
                                a.show();
                            }
                        } catch(e) {}
                    });
                    if (state.segmentChanged) {
                        console.log('[ANNOT-DIAG] registered=' + window.__registeredAnnotations.length + ' redrawn=' + redrawnCount);
                    }
                }
                // Force-show all annotation SVGs in shadow DOMs
                let svgCount = 0;
                document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"], [id^="branding-"]').forEach(host => {
                    const root = host.shadowRoot;
                    if (!root) return;
                    root.querySelectorAll('svg.rough-annotation').forEach(svg => {
                        svg.style.setProperty('opacity', '1', 'important');
                        svg.style.setProperty('visibility', 'visible', 'important');
                        svg.style.setProperty('display', 'block', 'important');
                        svgCount++;
                    });
                });
                if (state.segmentChanged && svgCount > 0) {
                    console.log('[ANNOT-DIAG] forced visible on ' + svgCount + ' rough-annotation SVGs');
                }
                // 7.5. Force-visible: rescue elements whose visibility depends on
                // a GSAP tween that failed to bind a target. LLM HTML pattern:
                //   .headline { opacity: 0 }  /* CSS — element starts hidden */
                //   gsap.fromTo('#headline', {y:30}, {opacity:1, y:0, duration:0.6})
                // If '#headline' resolves correctly: GSAP sets inline opacity from
                // tween — fade-in plays. If selector doesn't resolve in the shadow
                // root (typo, GSAP-internal toArray bypassing the scope proxy,
                // shadow-DOM scoping mismatch the FE iframe-srcdoc doesn't have):
                // GSAP warns 'target not found', the element stays at CSS opacity:0
                // forever, invisible the entire shot.
                //
                // The 78+ '[BROWSER WARNING] GSAP target  not found' lines in user's
                // log map to elements like .kinetic-word / .headline / .node etc
                // that have CSS opacity:0 and no inline opacity to indicate intent.
                //
                // Rescue logic, run only on shot boundary (cheap):
                //   - Skip if author set INLINE opacity → intentional initial state.
                //   - Skip if any GSAP tween exists for this element → legit anim.
                //   - Otherwise, force inline opacity:1 to match what FE shows.
                if (state.segmentChanged && window.gsap && typeof window.gsap.getTweensOf === 'function') {
                    let _fvCount = 0;
                    document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"], [id^="branding-"]').forEach(host => {
                        const fvRoot = host.shadowRoot;
                        if (!fvRoot) return;
                        fvRoot.querySelectorAll('*').forEach(el => {
                            try {
                                const inlineOp = el.style && el.style.opacity;
                                if (inlineOp !== '' && inlineOp !== undefined && inlineOp !== null) return;
                                const computed = window.getComputedStyle(el).opacity;
                                if (parseFloat(computed) > 0.01) return;
                                const tweens = window.gsap.getTweensOf(el);
                                if (tweens && tweens.length > 0) return;
                                el.style.setProperty('opacity', '1', 'important');
                                _fvCount++;
                            } catch (_) {}
                        });
                    });
                    if (_fvCount > 0) console.log('[FORCE-VISIBLE] set opacity:1 on ' + _fvCount + ' untweened invisible elements');
                }
                // 8. Wait for paint — double-RAF ensures the browser has fully
                // composited GSAP transform updates AND SVG stroke repaints
                // before screenshot capture. Single RAF was insufficient for
                // SVG strokeDashoffset animations (tape draw, line reveals).
                await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            };
        }""")

        _render_start = start_frame if start_frame is not None else 0
        _render_end = end_frame if end_frame is not None else total_frames
        print(f"DEBUG: Rendering frame range [{_render_start}, {_render_end}) of {total_frames} total")

        _prev_active_ids = set()
        _crossfade_duration: float = float(opts.get("crossfade_duration", 0.0))
        _frame_progress_start = time.time()
        _frame_progress_chunk_size = max(1, _render_end - _render_start)

        for frame_index in range(_render_start, _render_end):
            t = frame_index / float(fps)
            active = _active_entries_at(timeline, t, crossfade=_crossfade_duration)
            # Add branding if enabled
            if show_branding and branding_entry:
                active.append(branding_entry)
            # Update DOM for overlays (part of batch, but snippets need to run first for segment-change detection)
            page.evaluate("async (entries) => await window.__updateSnippets(entries)", active)

            # Wait for images/fonts/annotations to load when active segments change
            _cur_active_ids = {e["id"] for e in active}
            _segment_changed = _cur_active_ids != _prev_active_ids
            if _segment_changed:
                # Wait for any <link rel="stylesheet"> in shadow DOMs to finish loading
                # FIRST — otherwise their @font-face rules haven't been parsed yet, so
                # document.fonts.ready resolves before those fonts are even discovered,
                # and we end up rendering with fallback fonts (causing text overflow when
                # the fallback is wider than the intended font, e.g. Bebas Neue → sans).
                try:
                    page.evaluate("""async () => {
                        const links = [];
                        document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"], #caption').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            root.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        });
                        // Also check main document head links (just in case)
                        document.head.querySelectorAll('link[rel="stylesheet"]').forEach(l => links.push(l));
                        const waits = links.map(l => {
                            // sheet truthy → already loaded
                            try { if (l.sheet) return Promise.resolve(); } catch (e) {}
                            return new Promise(resolve => {
                                let done = false;
                                const finish = () => { if (!done) { done = true; resolve(); } };
                                l.addEventListener('load', finish, { once: true });
                                l.addEventListener('error', finish, { once: true });
                                setTimeout(finish, 3000);
                            });
                        });
                        await Promise.all(waits);
                    }""")
                except Exception:
                    pass
                # Wait for fonts used by new snippets (now that link CSS is parsed,
                # @font-face rules have registered the fonts as pending)
                try:
                    page.evaluate("() => document.fonts.ready")
                except Exception:
                    pass
                # AUTO-FIT: two-pass cleanup that fixes text getting clipped in renders.
                # PASS A — parent-bound clipping: when a parent has `overflow: hidden`
                # and a smaller width than its headline child (caused by async font
                # loading reflowing the child but not the parent's max-content), force
                # the parent to fit its content. Common in flex-column align-items:center
                # wrappers that auto-size to pre-font-load text width.
                # PASS B — host-bound shrinkage: scale down font-size on headline-class
                # elements that exceed their host's bounds. Catches LLM-generated HTML
                # where text fills or overflows the canvas.
                # Compares against each host's getBoundingClientRect, so it works for
                # 1080x1920 portrait, 1920x1080 landscape, 720x1280, or any host size.
                try:
                    shrink_log = page.evaluate("""() => {
                        const SAFETY_PX = 8;        // breathing room from host edge
                        const MIN_FONT_PX = 14;     // never shrink below this absolute floor
                        const MIN_SCALE = 0.4;      // never shrink below 40% of original
                        const MAX_PASSES = 3;       // re-measure after each shrink (wrap may help)
                        // Headline-class selectors only — leave body/labels alone.
                        const sels = 'h1, h2, h3, .headline, .title, .display, [class*="display-"], [class*="title"], [class*="headline"], [class*="heading"], [class*="slam"]';
                        const log = [];

                        // ── PASS A: unclip parents that are narrower than their content ──
                        // When a flex/inline-block parent has overflow:hidden and was sized
                        // to its child's pre-font-load width, the parent stays narrow after
                        // the child grows when fonts load. The clipped region cuts the right
                        // edge of headline text. Walk ancestors of every headline; if an
                        // ancestor has overflow:hidden AND clientWidth < its child's
                        // scrollWidth (or rect.right of headline), force max-content sizing.
                        document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            const hostRect = host.getBoundingClientRect();
                            const hostW = hostRect.width;
                            if (hostW < 100) return;
                            root.querySelectorAll(sels).forEach(el => {
                                const elRect = el.getBoundingClientRect();
                                const elScrollW = el.scrollWidth || 0;
                                const elContentW = Math.max(elRect.width, elScrollW);
                                if (elContentW <= 0) return;
                                // Walk up the ancestor chain (stopping at the shadow root)
                                let p = el.parentElement;
                                let safety = 8;
                                while (p && safety-- > 0) {
                                    const cs = getComputedStyle(p);
                                    const overflowsX = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflow === 'clip' || cs.overflowX === 'clip';
                                    if (overflowsX) {
                                        const pRect = p.getBoundingClientRect();
                                        // Parent is clipping if its width is smaller than
                                        // the headline's content width (with small fudge).
                                        if (pRect.width + 4 < elContentW) {
                                            // Don't grow beyond the host (canvas).
                                            const maxAllowed = hostW - SAFETY_PX;
                                            const targetW = Math.min(elContentW, maxAllowed);
                                            // Force the parent to expand to fit its child.
                                            // min-width handles flex/auto-sized parents
                                            // without breaking explicit width: 100% etc.
                                            p.style.minWidth = targetW + 'px';
                                            p.style.maxWidth = 'none';
                                            log.push({
                                                phase: 'A',
                                                id: host.id,
                                                parent: p.tagName + (p.className && typeof p.className === 'string' ? '.' + p.className.split(' ')[0] : ''),
                                                pWas: Math.round(pRect.width),
                                                pNow: Math.round(targetW),
                                                childContent: Math.round(elContentW)
                                            });
                                        }
                                    }
                                    p = p.parentElement;
                                }
                            });
                        });

                        // ── PASS B: shrink fonts that exceed the host bounds ──
                        document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            const hostRect = host.getBoundingClientRect();
                            const hostW = hostRect.width;
                            const hostH = hostRect.height;
                            if (hostW < 100 || hostH < 100) return; // skip tiny hosts (branding, etc.)
                            const els = root.querySelectorAll(sels);
                            els.forEach(el => {
                                // Skip if user explicitly hid via display:none — no layout
                                const cs0 = getComputedStyle(el);
                                if (cs0.display === 'none' || cs0.visibility === 'hidden') return;
                                // Capture original size BEFORE any shrinking. Track original
                                // via dataset so re-runs (segment changes) don't compound.
                                let originalSize;
                                if (el.dataset.__origFontPx) {
                                    originalSize = parseFloat(el.dataset.__origFontPx);
                                    // Restore original first; shrink will re-apply if needed.
                                    el.style.fontSize = originalSize + 'px';
                                } else {
                                    originalSize = parseFloat(cs0.fontSize);
                                    el.dataset.__origFontPx = String(originalSize);
                                }
                                if (!originalSize || originalSize < MIN_FONT_PX + 2) return;
                                const minAllowed = Math.max(MIN_FONT_PX, originalSize * MIN_SCALE);

                                for (let pass = 0; pass < MAX_PASSES; pass++) {
                                    const r = el.getBoundingClientRect();
                                    // Use offsetWidth/scrollWidth for layout-true width
                                    // (rect.width can be skewed by transforms like
                                    // translateY/scale used in entrance animations).
                                    // scrollWidth catches single-line overflow when the
                                    // block fills its parent but text exceeds it.
                                    const layoutW = Math.max(el.offsetWidth || 0, el.scrollWidth || 0, r.width);
                                    if (layoutW <= 0) break;
                                    // Two ways to overflow:
                                    //  (a) the element's own box is wider than the host
                                    //  (b) text scrolls past the element's bounds inside it
                                    const exceedsHost = layoutW > hostW - SAFETY_PX;
                                    const textOverflows = el.scrollWidth > el.clientWidth + 1;
                                    if (!exceedsHost && !textOverflows) break;
                                    // Choose the worst overflow for ratio
                                    const overflowingW = exceedsHost ? layoutW : el.scrollWidth;
                                    const targetW = exceedsHost ? (hostW - SAFETY_PX) : (el.clientWidth - SAFETY_PX);
                                    if (targetW <= 0) break;
                                    const ratio = targetW / overflowingW;
                                    if (ratio >= 0.99) break; // close enough, don't churn
                                    const cur = parseFloat(getComputedStyle(el).fontSize);
                                    let next = cur * ratio;
                                    if (next < minAllowed) next = minAllowed;
                                    if (Math.abs(next - cur) < 0.5) break; // negligible change
                                    el.style.fontSize = next + 'px';
                                    if (pass === 0) {
                                        log.push({
                                            phase: 'B',
                                            id: host.id,
                                            tag: el.tagName + (el.className ? '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '') : ''),
                                            from: Math.round(originalSize),
                                            to: Math.round(next),
                                            origW: Math.round(layoutW),
                                            hostW: Math.round(hostW),
                                            reason: exceedsHost ? 'host' : 'self'
                                        });
                                    }
                                    if (next === minAllowed) break; // floor hit
                                }
                            });
                        });
                        return log;
                    }""")
                    if shrink_log:
                        print(f"[AUTO-SHRINK] {len(shrink_log)} elements resized: {shrink_log}")
                except Exception as _e:
                    print(f"[AUTO-SHRINK] error: {_e}")
                # FONT-DIAG: dump loaded fonts + measured widest text per snippet so
                # we can tell whether overflow is a missing-font issue or a genuine
                # "user HTML asks for text wider than canvas" issue.
                try:
                    diag = page.evaluate("""() => {
                        const loaded = [];
                        document.fonts.forEach(f => {
                            if (f.status === 'loaded') loaded.push(f.family + ' ' + f.weight);
                        });
                        const measurements = [];
                        document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]').forEach(host => {
                            const root = host.shadowRoot;
                            if (!root) return;
                            root.querySelectorAll('h1, h2, .headline, .tracking-label').forEach(el => {
                                const r = el.getBoundingClientRect();
                                const cs = getComputedStyle(el);
                                measurements.push({
                                    id: host.id,
                                    tag: el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : ''),
                                    text: (el.textContent || '').trim().slice(0, 40),
                                    width: Math.round(r.width),
                                    fontFamily: cs.fontFamily,
                                    fontSize: cs.fontSize,
                                    fontWeight: cs.fontWeight,
                                });
                            });
                        });
                        return {
                            viewport: window.innerWidth + 'x' + window.innerHeight,
                            fontsLoaded: loaded.length,
                            sampleFonts: loaded.slice(0, 10),
                            measurements
                        };
                    }""")
                    print(f"[FONT-DIAG] {diag}")
                except Exception as _e:
                    print(f"[FONT-DIAG] error: {_e}")
                # Wait for all images in shadow DOMs to finish loading.
                # MUST include [id^="shot-"]: Director-mode entries host under
                # shot-{idx}, and support-visual photos live there — without
                # this the frame loop races the S3 fetch and images pop in
                # mid-shot in the final MP4 (the video-buffer wait below
                # already included shot-; the image wait had been missed).
                page.evaluate("""() => {
                    const promises = [];
                    document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]').forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('img').forEach(img => {
                            if (!img.complete) {
                                promises.push(new Promise(resolve => {
                                    img.addEventListener('load', resolve, { once: true });
                                    img.addEventListener('error', resolve, { once: true });
                                    setTimeout(resolve, 3000);
                                }));
                            }
                        });
                    });
                    return Promise.all(promises);
                }""")
                # Wait for stock videos to buffer enough data for seeking (skip if none exist)
                page.evaluate("""async () => {
                    const allVideos = [];
                    document.querySelectorAll('[id^="snippet-"], [id^="segment-"], [id^="shot-"]').forEach(host => {
                        const root = host.shadowRoot;
                        if (!root) return;
                        root.querySelectorAll('video').forEach(v => allVideos.push({v, host}));
                    });
                    if (allVideos.length === 0) return; // No videos — skip entirely
                    console.log('[VIDEO-DIAG] Found ' + allVideos.length + ' video elements');
                    const waits = [];
                    allVideos.forEach(({v, host}) => {
                        v.preload = 'auto';
                        if (v.readyState < 1) v.load();
                        if (v.readyState < 4) {
                            waits.push(new Promise(r => {
                                v.addEventListener('canplaythrough', r, { once: true });
                                v.addEventListener('error', r, { once: true });
                                setTimeout(r, 10000);
                            }));
                        }
                        v.pause();
                    });
                    if (waits.length > 0) await Promise.all(waits);
                    allVideos.forEach(({v, host}) => {
                        console.log('[VIDEO-DIAG] ' + host.id + ': readyState=' + v.readyState +
                            ' duration=' + (v.duration||'?') + ' error=' + (v.error ? v.error.message : 'none'));
                    });
                }""")
                # Wait for Rough Notation annotations to position after layout
                page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")

                # ── Resolve Ken Burns / Camera Drift overlap ──
                # Pause CSS Ken Burns animations; the deterministic camera drift system
                # handles all motion to avoid double-motion conflicts.
                page.evaluate("""() => {
                    document.querySelectorAll('.kb-zoom-in,.kb-zoom-out,.kb-pan-left,.kb-pan-right,.kb-pan-up,.kb-zoom-pan-tl').forEach(el => {
                        el.style.animationPlayState = 'paused';
                        el.style.transform = 'scale(1)';
                    });
                }""")

                _prev_active_ids = _cur_active_ids

            # --- Camera: static (matches FE preview — no drift/zoom/pan) ---
            cam_scale = 1.0
            cam_x = 0.0
            cam_y = 0.0

            # ── Build batched frame state (Python-side) ──
            # Camera
            _cam_state = {"x": cam_x, "y": cam_y, "scale": cam_scale}

            # Character (lip-sync)
            _char_state = None
            if show_character:
                phone_code = _normalize_phone_code(_get_active_phoneme(alignment_phonemes, t, _phoneme_start_times))
                mouth_file = (
                    phoneme_map_lookup.get(phone_code)
                    or phoneme_map_lookup.get("sil")
                    or phoneme_map_lookup.get("closed")
                )
                if not mouth_file:
                    raise ValueError(f"No mouth sprite configured for phoneme '{phone_code}' and no 'closed' fallback")
                if mouths_dir is None:
                    raise RuntimeError("Mouths directory is not initialized for character rendering")
                mouth_src = mouth_src_cache.get(mouth_file)
                if not mouth_src:
                    mouth_path = (mouths_dir / mouth_file).expanduser().resolve()
                    if not mouth_path.exists():
                        raise FileNotFoundError(f"Mouth sprite not found: {mouth_path}")
                    mouth_src = _path_to_data_uri(mouth_path)
                    mouth_src_cache[mouth_file] = mouth_src
                _char_state = {
                    "visible": True,
                    "poseSrc": pose_image_src,
                    "mouthSrc": mouth_src,
                    "poseX": pose_offset_x,
                    "poseY": pose_offset_y,
                    "poseScale": pose_scale_value,
                    "mouthX": pose_offset_x + mouth_anchor_x,
                    "mouthY": pose_offset_y + mouth_anchor_y,
                    "mouthScale": mouth_scale_value,
                    "zIndex": character_z_index,
                }

            # Caption
            _caption_entry = None
            if show_captions and caption_segments and caption_styles:
                seg = _active_caption_at(caption_segments, t)
                if seg:
                    # Per-shot override: find the primary (non-branding) active
                    # entry and read its entry_meta.caption_style. `hide` skips
                    # caption emission for this frame; `position` overrides the
                    # global setting. `null` (the editor's explicit-clear
                    # sentinel) and missing keys both fall back to global.
                    _shot_override = None
                    for _e in active:
                        if str(_e.get("id", "")).startswith("branding-"):
                            continue
                        _em = _e.get("entry_meta")
                        if isinstance(_em, dict):
                            _cs = _em.get("caption_style")
                            if isinstance(_cs, dict):
                                _shot_override = _cs
                        break

                    if _shot_override and _shot_override.get("hide"):
                        # Skip caption emission for this frame entirely.
                        seg = None  # type: ignore[assignment]

                if seg:
                    style = caption_styles
                    allow_html = bool(style.get("allow_html", False))
                    raw_text = seg.get("text", "")
                    _override_pos = (
                        _shot_override.get("position")
                        if isinstance(_shot_override, dict)
                        else None
                    )
                    cap_position = str(_override_pos or style.get("position", "bottom"))
                    if cap_position == "top":
                        position_css = f"top:{int(height * 0.037)}px; bottom:auto;"
                    else:
                        position_css = f"bottom:{int(height * 0.074)}px; top:auto;"
                    # Lesson mode: while a teacher overlay is on screen its
                    # entry_meta.caption_box keeps captions on the board side
                    # (or above a portrait teacher band) instead of across
                    # the teacher's face (lesson_mode.caption_box). The
                    # caption host is always full-viewport (dispatcher
                    # __updateCaption), so the pill itself is re-centred.
                    _cap_x, _cap_w, _cap_cy = 0, width, None
                    _lesson_cb = None
                    for _e in active:
                        _em = _e.get("entry_meta")
                        if (isinstance(_em, dict) and _em.get("kind") in ("lesson_band", "lesson_teacher")
                                and isinstance(_em.get("caption_box"), dict)):
                            # The caption band wins over a teacher entry's box.
                            if _lesson_cb is None or _em.get("kind") == "lesson_band":
                                _lesson_cb = _em["caption_box"]
                    if _lesson_cb is not None:
                        try:
                            _cap_x = max(0, int(_lesson_cb.get("x", 0)))
                            _cap_w = max(1, min(width - _cap_x, int(_lesson_cb.get("w", width))))
                            if _lesson_cb.get("cy") is not None:
                                _cap_cy = int(_lesson_cb["cy"])
                                position_css = ""
                            elif _lesson_cb.get("bottom") is not None and cap_position != "top":
                                position_css = f"bottom:{int(_lesson_cb['bottom'])}px; top:auto;"
                        except (TypeError, ValueError):
                            _cap_x, _cap_w, _cap_cy = 0, width, None
                    font_size = int(style.get("font_size", 20))
                    font_color = str(style.get("font_color", "#FFFFFF"))
                    font_weight = int(style.get("font_weight", 400))
                    # Font family — prefer the worker's `font_family_key` (one
                    # of the harness-loaded Google Fonts) if set; otherwise
                    # fall back to the legacy `font_family` CSS string.
                    _ff_key = style.get("font_family_key")
                    if _ff_key and _ff_key in _FONT_FAMILY_BY_KEY:
                        font_family_css = _FONT_FAMILY_BY_KEY[_ff_key]
                    else:
                        font_family_css = str(
                            style.get(
                                "font_family",
                                "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
                            )
                        )
                    # Caption font_size is already pre-scaled by the canvas
                    # LONG side earlier in this function. The same scale
                    # applies to text stroke so the outline stays visually
                    # proportional on portrait (width-only would thin the
                    # stroke to half the font's proportion on 9:16).
                    _font_scale = max(width, height) / 1920.0
                    text_stroke_width = max(
                        0, int(int(style.get("text_stroke_width", 0)) * _font_scale)
                    )
                    text_stroke_color = str(style.get("text_stroke_color", "#000000"))
                    # Stroke CSS — `paint-order: stroke fill` ensures the
                    # stroke is laid UNDER the glyph fill so edges stay
                    # readable at thick widths. Empty string when off.
                    if text_stroke_width > 0:
                        stroke_css = (
                            f"-webkit-text-stroke:{text_stroke_width}px {text_stroke_color}; "
                            f"paint-order:stroke fill; "
                        )
                    else:
                        stroke_css = ""

                    # Build inner content. For karaoke style emit per-word
                    # spans with active/past/upcoming coloring; for phrase
                    # style emit a single escaped text node. Mirrors the
                    # browser branch in CaptionDisplay.tsx:62-99 EXACTLY so
                    # the editor preview, the post-gen player, and the MP4
                    # all agree on which word is current at every frame.
                    cap_style_mode = str(style.get("style", "phrase"))
                    if cap_style_mode == "karaoke" and seg.get("words"):
                        highlight_color = str(style.get("highlight_color", "#fbbf24"))
                        _heavy = min(900, font_weight + 200)
                        _spans: List[str] = []
                        for _w in seg["words"]:
                            try:
                                _ws = float(_w.get("start", 0))
                                _we = float(_w.get("end", 0))
                            except Exception:
                                continue
                            _is_current = _ws <= t < _we
                            _is_past = t >= _we
                            _color = highlight_color if _is_current else font_color
                            _weight = _heavy if _is_current else font_weight
                            _opacity = 0.5 if _is_past else 1.0
                            _word_text = _html_escape(str(_w.get("word", "")))
                            _spans.append(
                                f'<span style="color:{_color}; font-weight:{_weight}; '
                                f'opacity:{_opacity}; transition:color .12s,opacity .12s;">'
                                f'{_word_text}</span>'
                            )
                        content_html = " ".join(_spans)
                    else:
                        content_html = raw_text if allow_html else _html_escape(raw_text)
                    if _cap_cy is not None:
                        # Lesson caption band: centred in the band, whatever
                        # the number of lines.
                        _pill_box_css = (
                            f"left:{_cap_x + _cap_w // 2}px; top:{_cap_cy}px; "
                            f"transform:translate(-50%,-50%); max-width:{int(_cap_w * 0.9)}px; "
                        )
                    elif (_cap_x, _cap_w) == (0, width):
                        _pill_box_css = "left:50%; transform:translateX(-50%); max-width:85%; "
                    else:
                        _pill_box_css = (
                            f"left:{_cap_x + _cap_w // 2}px; transform:translateX(-50%); "
                            f"max-width:{int(_cap_w * 0.85)}px; "
                        )
                    html = (
                        f'<div style="width:100%; height:100%; position:relative;">'
                        f'<div style="position:absolute; {_pill_box_css}'
                        f'padding:10px 20px; border-radius:8px; '
                        f'background:{style["background_color"]}; text-align:center; '
                        f'font-family:{font_family_css}; '
                        f'font-size:{font_size}px; font-weight:{font_weight}; color:{font_color}; '
                        f'text-shadow:0 1px 3px rgba(0,0,0,0.4); line-height:1.5; letter-spacing:0.02em; '
                        f'min-height:44px; display:flex; align-items:center; justify-content:center; '
                        f'{position_css}">'
                        f'<div style="display:inline-block; text-shadow:0 1px 3px rgba(0,0,0,0.4); '
                        f'{stroke_css}">'
                        f'{content_html}</div></div></div>'
                    )
                    _caption_entry = {"x": 0, "y": 0, "w": width, "h": height, "html": html}

            # ── Single batched evaluate: camera + character + caption + GSAP + video seek + annotations + paint wait ──
            # Emit a parseable progress line every 50 frames so the parent
            # render-worker process can see liveness in real time and forward
            # aggregate progress to the AI server. Format consumed by
            # render_worker/worker.py's stdout streamer.
            _local_idx = frame_index - _render_start
            if _local_idx > 0 and (_local_idx % 50 == 0 or frame_index + 1 == _render_end):
                _elapsed = max(0.001, time.time() - _frame_progress_start)
                _rate = _local_idx / _elapsed
                _remaining = max(0, _frame_progress_chunk_size - _local_idx)
                _eta = _remaining / _rate if _rate > 0 else 0
                print(
                    f"[FRAME-PROGRESS] worker_pid={os.getpid()} "
                    f"rendered={_local_idx}/{_frame_progress_chunk_size} "
                    f"frame_index={frame_index} elapsed={_elapsed:.1f}s "
                    f"eta={_eta:.1f}s rate={_rate:.2f}fps"
                )
                sys.stdout.flush()

            try:
                page.evaluate("async (state) => await window.__batchRenderFrame(state)", {
                    "entries": None,  # Already updated via __updateSnippets above
                    "camera": _cam_state,
                    "character": _char_state,
                    "caption": _caption_entry,
                    "t": t,
                    "frameStepS": 1.0 / float(fps),
                    "seekVideos": True,
                    "segmentChanged": _segment_changed,
                })
            except Exception as _eval_err:
                # Name the culprit shot when the page context dies mid-render. The
                # Python side knows exactly which entries are active at this frame,
                # so we can point at the offending shot even when the browser logs
                # are truncated. The dispatcher now neutralizes the common in-page
                # navigation triggers (location.*/window.open/document.write); if
                # this still fires, inspect the listed shot's HTML for a channel we
                # don't yet cover (<meta http-equiv=refresh>, a submitting <form>,
                # an iframe, etc.).
                _emsg = str(_eval_err)
                if (
                    "Execution context was destroyed" in _emsg
                    or "Target closed" in _emsg
                    or "Target crashed" in _emsg
                ):
                    _active_ids = [e.get("id") for e in active]
                    print(
                        f"[RENDER-FATAL] page context died at frame={frame_index} "
                        f"t={t:.2f}s segment_changed={_segment_changed} "
                        f"active_shots={_active_ids} — a shot navigated the page or "
                        f"wiped the document. The shot that just mounted is the culprit; "
                        f"inspect its HTML.",
                        flush=True,
                    )
                    sys.stdout.flush()
                raise

            # Capture frame — clip to exact viewport to prevent camera/overflow bleeding
            # JPEG is 3-5x faster than PNG to encode and sufficient for H.264 re-encoding
            frame_path = frames_dir / f"frame_{frame_index:06d}.jpg"
            try:
                page.screenshot(
                    path=str(frame_path),
                    type="jpeg",
                    quality=95,
                    timeout=30000,
                    clip={"x": 0, "y": 0, "width": width, "height": height},
                )
            except Exception as e:
                print(f"❌ Screenshot failed at frame {frame_index}: {e}")
                # Try to proceed or abort? Aborting is safer to avoid long hangs.
                raise e

        if _browser_error_count[0] > 0:
            print(f"[BROWSER SUMMARY] Total browser errors/exceptions during render: {_browser_error_count[0]}")
        print("DEBUG: Finished rendering loop. Closing context...")
        context.close()
        print("DEBUG: Context closed. Closing browser...")
        browser.close()
        print("DEBUG: Browser closed.")

    # If frames-only mode, skip video assembly (caller handles it)
    if frames_only:
        rendered_count = len(list(frames_dir.glob("frame_*.jpg")))
        stale_png = len(list(frames_dir.glob("frame_*.png")))
        if stale_png > 0 and rendered_count == 0:
            print(f"ERROR: FRAME FORMAT MISMATCH — {stale_png} .png frames found but expected .jpg!")
        print(f"DEBUG: Frames-only mode complete. Rendered {rendered_count} frames to {frames_dir}")
        return frames_dir

    # Assemble video
    print("DEBUG: Collecting frame files...")
    frame_files = sorted(str(p) for p in frames_dir.glob("frame_*.jpg"))
    print(f"DEBUG: Found {len(frame_files)} frames.")
    if len(frame_files) != total_frames:
        raise RuntimeError(
            f"Expected {total_frames} frames, found {len(frame_files)} in {frames_dir}"
        )

    print("DEBUG: Creating ImageSequenceClip...")
    video_clip = ImageSequenceClip(frame_files, fps=fps).with_audio(audio_clip).with_duration(duration)
    print("DEBUG: ImageSequenceClip created.")

    if avatar_video_path and Path(avatar_video_path).exists():
        try:
            print(f"Overlaying avatar video from: {avatar_video_path}")
            avatar_clip = VideoFileClip(avatar_video_path)
            
            # Ensure avatar clip matches duration (loop or cut)
            if avatar_clip.duration < duration:
                # Loop if too short (unlikely if generated from same audio, but safe)
                # Actually SadTalker should match. If header/footer silence, might differ slightly.
                # We'll just let it play. If it stops, it disappears? Or freeze?
                # Best to ensure it covers the duration.
                pass
            
            # Resize and position
            # Make it 1/3 height
            target_h = height // 3
            avatar_clip = avatar_clip.resized(height=target_h)
            
            # Position bottom right with margin
            margin_x = 50
            margin_y = 50
            pos_x = width - avatar_clip.w - margin_x
            pos_y = height - avatar_clip.h - margin_y
            
            avatar_clip = avatar_clip.with_position((pos_x, pos_y))
            
            # Composite
            video_clip = CompositeVideoClip([video_clip, avatar_clip]).with_duration(duration).with_audio(audio_clip)

        except Exception as e:
            print(f"Failed to overlay avatar video: {e}")

    # Ensure parent directory exists
    out_p.parent.mkdir(parents=True, exist_ok=True)

    # libx264 + aac, yuv420p is broadly compatible
    # threads=1 is CRITICAL for stability on macOS/MoviePy to avoid multiprocessing crashes/leaks
    print(f"DEBUG: Writing video to {out_p} with threads=1...")
    video_clip.write_videofile(
        str(out_p),
        fps=fps,
        codec="libx264",
        audio_codec="aac",
        preset="medium",
        threads=1,
        ffmpeg_params=["-pix_fmt", "yuv420p"],
    )
    print("DEBUG: Video writing complete.")

    # Cleanup moviepy clips
    video_clip.close()
    audio_clip.close()

    return out_p


def _parse_args(argv: List[str]):
    parser = argparse.ArgumentParser(description="Render MP4 from audio + timed HTML overlays JSON")
    parser.add_argument("audio", help="Path to narration audio (e.g., MP3)")
    parser.add_argument("timeline", help="Path to timeline JSON with HTML overlays")
    parser.add_argument("output", nargs="?", default="output.mp4", help="Output MP4 path (default: output.mp4)")
    parser.add_argument("--width", type=int, default=None, help="Video width (overrides options JSON)")
    parser.add_argument("--height", type=int, default=None, help="Video height (overrides options JSON)")
    parser.add_argument("--fps", type=int, default=None, help="Frames per second (overrides options JSON)")
    parser.add_argument("--frames-dir", default=None, help="Temp frames directory (overrides options JSON)")
    parser.add_argument("--background", default=None, help="Background color (CSS), overrides options JSON")
    parser.add_argument("--video-options", default="", help="Path to video options JSON")
    parser.add_argument("--show-captions", action=argparse.BooleanOptionalAction, default=None, help="Enable/disable captions (--show-captions / --no-show-captions)")
    parser.add_argument("--captions-words", default="", help="Path to words JSON for captions")
    parser.add_argument("--captions-settings", default="", help="Path to captions settings JSON")
    parser.add_argument("--show-branding", action=argparse.BooleanOptionalAction, default=None, help="Enable/disable branding overlay (--show-branding / --no-show-branding)")
    parser.add_argument("--branding-json", default="", help="Path to branding JSON")
    parser.add_argument("--show-character", action=argparse.BooleanOptionalAction, default=None, help="Enable/disable character animation (--show-character / --no-show-character)")
    parser.add_argument("--character-config", default="", help="Path to character configuration JSON")
    parser.add_argument("--phoneme-map", default="", help="Path to phoneme-to-mouth mapping JSON")
    parser.add_argument("--alignment-json", default="", help="Path to Gentle alignment JSON with phonemes")
    parser.add_argument("--character-pose", default="", help="Pose name override for the animated character")
    parser.add_argument("--avatar-video", default="", help="Path to generated avatar video loop/clip")
    parser.add_argument("--audio-delay", type=float, default=0.0, help="Delay audio start by this many seconds (for intro silence)")
    parser.add_argument("--frames-only", action="store_true", help="Only render frames (skip video assembly). Used for parallel rendering.")
    parser.add_argument("--start-frame", type=int, default=None, help="First frame index to render (inclusive). Used with --frames-only for parallel.")
    parser.add_argument("--end-frame", type=int, default=None, help="Last frame index to render (exclusive). Used with --frames-only for parallel.")
    parser.add_argument("--dpi-scale", type=int, default=None, help="Device scale factor for rendering (default: 2 for retina). Use 1 for faster renders at lower quality.")
    return parser.parse_args(argv[1:])


if __name__ == "__main__":
    args = _parse_args(sys.argv)
    result_path = render_video_from_json(
        audio_path=args.audio,
        json_path=args.timeline,
        output_path=args.output,
        width=args.width,
        height=args.height,
        fps=args.fps,
        temp_frames_dir=args.frames_dir,
        background_color=args.background,
        video_options_path=args.video_options,
        captions_words_path=args.captions_words,
        captions_settings_path=args.captions_settings,
        show_captions=args.show_captions,
        branding_json_path=args.branding_json,
        show_branding=args.show_branding,
        show_character=args.show_character,
        character_config_path=args.character_config,
        phoneme_map_path=args.phoneme_map,
        alignment_json_path=args.alignment_json,
        character_pose=args.character_pose,
        avatar_video_path=args.avatar_video,
        audio_delay=args.audio_delay,
        frames_only=args.frames_only,
        start_frame=args.start_frame,
        end_frame=args.end_frame,
        device_scale_factor=args.dpi_scale,
    )
    print(f"Video written to: {result_path}")


