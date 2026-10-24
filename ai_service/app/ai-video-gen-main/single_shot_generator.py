"""
Single-shot HTML generation for the editor's "insert shot in gap" flow.

The main pipeline produces all of a video's shots in one pass — Director
plan → HTML per shot → render. When a user fills a gap in an existing
video timeline we don't want to re-run any of that; we just need ONE shot
generated for the gap, with visuals informed by the narration that
already plays in that range.

Wraps `VideoGenerationPipeline._generate_html_per_shot` (the same code
path the main pipeline uses) by:
  - constructing a minimal pipeline instance (mirrors `sentence_tts.py`)
  - setting only the instance attributes the per-shot path reads
  - feeding it a one-shot Director plan synthesized from the gap's
    speech + an optional user hint

Returns a timeline-ready entry dict (inTime/exitTime, html, z, …).
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_one_shot(
    *,
    gap_start: float,
    gap_end: float,
    speech_text: str,
    words_in_range: List[Dict[str, Any]],
    video_width: int,
    video_height: int,
    quality_tier: str,
    style_guide: Optional[Dict[str, Any]],
    user_hint: Optional[str],
    openrouter_key: str,
    run_dir: Path,
    html_model: Optional[str] = None,
) -> Dict[str, Any]:
    """Generate one HTML shot to fill `[gap_start, gap_end]`.

    Args:
        gap_start, gap_end: absolute timeline seconds for the new shot.
            The shot's `inTime`/`exitTime` are set to these values
            verbatim — the caller is responsible for confirming the gap
            doesn't already overlap an existing entry.
        speech_text: the narration that plays in this range, concatenated
            from `meta.sentences[]`. Used as `narration_excerpt` and as
            the spine of `visual_description`. Empty string is allowed
            (silent gap), in which case the LLM falls back to the
            user_hint alone.
        words_in_range: word-level Whisper timestamps inside the gap.
            Passed straight to `_generate_html_per_shot` as the `words`
            arg — it filters them again to the shot's range and uses
            them to seed `gsap.delay` on word-tied animations.
        video_width, video_height: render canvas (1920x1080 or 1080x1920).
        quality_tier: "free" | "standard" | "premium" | "ultra" |
            "super_ultra". Maps to QUALITY_TIERS in automation_pipeline.
        style_guide: the same style_guide dict the original pipeline
            wrote into S3 checkpoints. None falls back to the default
            black preset — visuals will still render but the new shot
            won't share institute brand colors with the rest.
        user_hint: optional free-text visual instruction from the user.
            Concatenated into `visual_description`. None or empty means
            "infer purely from the speech".
        openrouter_key: required for the LLM call inside
            `_generate_html_per_shot`. Same key the main pipeline uses.
        run_dir: a (preferably temp) directory for per-shot caching.
            The pipeline writes a `shot_cache/shot_NNN.json` here; the
            caller should pass a fresh dir per request to avoid serving
            stale cached HTML.

    Returns a timeline-ready entry dict with `inTime`, `exitTime`,
    `htmlStartX/Y`, `htmlEndX/Y`, `html`, `id`, `z`. Underscore-prefixed
    fields from the per-shot generator (`_shot_type`, etc.) are stripped
    — they're internal pipeline state, not part of the persisted format.
    """
    if gap_end <= gap_start:
        raise ValueError(f"invalid gap range: {gap_start} → {gap_end}")
    duration = gap_end - gap_start
    speech_text = (speech_text or "").strip()
    user_hint = (user_hint or "").strip() or None

    pipeline = _construct_pipeline(
        openrouter_key, quality_tier=quality_tier, html_model=html_model,
    )
    _attach_minimal_state(pipeline, video_width=video_width, video_height=video_height)

    sg = style_guide if isinstance(style_guide, dict) else _default_style_guide()
    shot_type = _infer_shot_type(speech_text, user_hint)

    director_plan = _build_one_shot_director_plan(
        gap_start=gap_start,
        gap_end=gap_end,
        speech_text=speech_text,
        user_hint=user_hint,
        shot_type=shot_type,
        words_in_range=words_in_range,
    )

    run_dir.mkdir(parents=True, exist_ok=True)

    entries, _usage = pipeline._generate_html_per_shot(  # noqa: SLF001 — intentional reuse
        director_plan=director_plan,
        style_guide=sg,
        words=list(words_in_range or []),
        run_dir=run_dir,
        language="English",
    )
    if not entries:
        raise RuntimeError("per-shot generator produced no entry")

    raw = entries[0]
    return _to_timeline_entry(
        raw,
        gap_start=gap_start,
        gap_end=gap_end,
        video_width=video_width,
        video_height=video_height,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

# Conservative default — works for any educational content without
# requiring a specific layout. Heuristic overrides only when the user's
# hint is unambiguous (e.g. "title card" → KINETIC_TITLE).
_DEFAULT_SHOT_TYPE = "TEXT_DIAGRAM"

_TITLE_KEYWORDS = ("title", "headline", "heading", "intro slide", "name reveal")
_INFOGRAPHIC_KEYWORDS = ("diagram", "infographic", "flow", "arrows", "boxes", "schematic", "blueprint")


def _infer_shot_type(speech_text: str, user_hint: Optional[str]) -> str:
    """Lightweight keyword router for shot_type. Avoids a separate LLM
    call — accuracy isn't critical because TEXT_DIAGRAM is broadly
    capable and the per-shot HTML generator is what actually does the
    creative work."""
    hint_lower = (user_hint or "").lower()
    if any(kw in hint_lower for kw in _TITLE_KEYWORDS):
        return "KINETIC_TITLE"
    if any(kw in hint_lower for kw in _INFOGRAPHIC_KEYWORDS):
        return "INFOGRAPHIC_SVG"
    return _DEFAULT_SHOT_TYPE


def _construct_pipeline(
    openrouter_key: str, *, quality_tier: str, html_model: Optional[str],
):
    """Build a VideoGenerationPipeline configured only enough for the
    per-shot HTML path. Pexels/Pixabay init is skipped (empty keys); the
    constructor tolerates this and the per-shot path doesn't need stock
    media for TEXT_DIAGRAM/KINETIC_TITLE/INFOGRAPHIC_SVG shots.

    `html_model` overrides the constructor's default (GLM_DEFAULT, the
    client's last resort). Pass None to let every call resolve the
    registry's video default (`ai_model_defaults`), which this pipeline uses
    anyway: it has no stage map, so a call that names no model goes to the
    registry default before the client default."""
    try:
        from automation_pipeline import VideoGenerationPipeline
    except ImportError as exc:
        raise RuntimeError(f"automation_pipeline not importable: {exc}") from exc
    kwargs: Dict[str, Any] = {
        "openrouter_key": openrouter_key,
        "pexels_api_keys": "",
        "pixabay_api_keys": "",
        "quality_tier": quality_tier,
    }
    if html_model:
        # Both `script_model` and `html_model` are set: the per-shot
        # path only uses html_client, but the script_client is built
        # eagerly in __init__ so we keep them in sync.
        kwargs["script_model"] = html_model
        kwargs["html_model"] = html_model
    return VideoGenerationPipeline(**kwargs)


def _attach_minimal_state(pipeline, *, video_width: int, video_height: int) -> None:
    """Set the instance attributes that `_generate_html_per_shot` reads.
    These are normally set by `pipeline.generate(...)` but we're calling
    one method on a freshly-constructed instance, so we set them by hand.
    Anything we omit fails closed: getattr defaults inside the per-shot
    function (`_input_video_contexts`, `_emphasis_map`, etc.)."""
    import threading as _threading_mod

    pipeline.video_width = video_width
    pipeline.video_height = video_height
    pipeline.aspect_label = "9:16 portrait" if video_width < video_height else "16:9 landscape"
    # Routing knobs — defaults match a non-source-clip, side-mode video.
    pipeline._routing_config = {
        "mute_tts_on_source_clips": False,
        "source_clip_priority": "medium",
        "infographic_mode": "side",
        "narration_fit_to_source": False,
        "coverage_min_pct": 0,
    }
    pipeline._routing_plan = {}
    # No source-clip/image context for inserted shots (a SOURCE_CLIP or
    # IMAGE_CLIP shot in a gap doesn't make sense; the heuristic above
    # never picks them).
    pipeline._input_video_contexts = None
    pipeline._input_video_context = None
    pipeline._input_image_contexts = None
    pipeline._mute_tts_on_source_clips = False
    # No cooperative cancel for a single-shot request — the per-shot path
    # reads this directly (set by run() on full-pipeline runs).
    pipeline._stop_event = None
    # Sound effects off — inserted shots don't get whoosh/sfx because we
    # don't run the Sound Planner here. The user can add cues manually
    # via the existing SFX UI if they want.
    pipeline._sound_effects_enabled = False
    pipeline._sub_shots_enabled = False
    pipeline._background_music_track = None
    pipeline._progress_callback = None
    pipeline._background_music_enabled_override = None
    pipeline._background_music_volume_override = None
    # Thread-safe token accounting. The per-shot path acquires
    # `_token_lock` after the LLM call to bump cumulative totals — these
    # are normally created in `pipeline.generate()`, which we don't call.
    pipeline._token_lock = _threading_mod.Lock()
    pipeline._cumulative_tokens = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }
    # Stock-video dedup set (super_ultra only); empty is fine for any tier.
    pipeline._used_pexels_video_ids = set()
    # Other lazily-initialised state the per-shot path may peek at.
    pipeline._user_had_script = False


def _build_one_shot_director_plan(
    *,
    gap_start: float,
    gap_end: float,
    speech_text: str,
    user_hint: Optional[str],
    shot_type: str,
    words_in_range: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Synthesize a Director-shaped plan with a single shot. Field set
    matches what `_generate_html_per_shot` reads off each shot dict."""
    visual_description = _compose_visual_description(speech_text, user_hint)
    text_elements = _extract_text_elements(speech_text)
    return {
        "shots": [
            {
                "shot_type": shot_type,
                "start_time": float(gap_start),
                "end_time": float(gap_end),
                "visual_description": visual_description,
                "narration_excerpt": speech_text,
                "text_elements": text_elements,
                "animation_strategy": "concise entrance, hold-drift, gentle exit",
                "complexity_level": "moderate",
                "transition_in": "fade",
                "sync_points": [],
                "z": 10,
            }
        ],
        "audio_duration": float(gap_end),
        "continuity_notes": (
            "Inserted shot filling a previously-empty gap in the timeline. "
            "Match the surrounding video's style; visuals must align with "
            "the narration that already plays in this range."
        ),
    }


def _compose_visual_description(speech_text: str, user_hint: Optional[str]) -> str:
    """Combine the user's optional hint with the spoken text. The hint
    leads (it's the most explicit signal of intent); the speech follows
    as the script the visuals must match."""
    parts: List[str] = []
    if user_hint:
        parts.append(f"User intent: {user_hint}")
    if speech_text:
        parts.append(f"Narration in this range: \"{speech_text}\"")
        parts.append(
            "Generate visuals (text reveals, diagrams, callouts) that "
            "directly illustrate the narration above. Time key reveals "
            "to the WORD TIMINGS so the visuals land with the words."
        )
    elif user_hint:
        parts.append(
            "(No narration plays in this range — generate self-contained "
            "visuals based on the user's intent above.)"
        )
    else:
        parts.append(
            "Generate a clean visual hold — title card or simple "
            "illustration matching the surrounding video's style."
        )
    return "\n\n".join(parts)


def _extract_text_elements(speech_text: str) -> List[str]:
    """Pull a small set of candidate phrases out of the speech to seed
    the LLM's `text_elements` field. Naive: split on sentence punctuation,
    keep the first ~3 short fragments. The LLM will pick what to actually
    render based on its own design judgement."""
    if not speech_text:
        return []
    import re
    raw_parts = re.split(r"(?<=[.!?])\s+", speech_text)
    fragments: List[str] = []
    for part in raw_parts:
        cleaned = part.strip().strip('"').strip("'")
        if not cleaned:
            continue
        # Keep medium-length fragments — too short loses meaning, too
        # long won't fit on screen.
        if 8 <= len(cleaned) <= 80:
            fragments.append(cleaned)
        if len(fragments) >= 3:
            break
    return fragments


def _default_style_guide() -> Dict[str, Any]:
    """Conservative dark-theme fallback used when the original style
    guide isn't available (e.g. older video without a checkpoint).
    Mirrors `BACKGROUND_PRESETS["black"]` from prompts.py."""
    return {
        "background_type": "black",
        "palette": {
            "background": "#000000",
            "text": "#ffffff",
            "text_secondary": "#cbd5e1",
            "primary": "#3b82f6",
            "secondary": "#1e293b",
            "accent": "#38bdf8",
            "svg_stroke": "#ffffff",
            "svg_fill": "#3b82f6",
            "card_bg": "rgba(30, 41, 59, 0.8)",
            "card_border": "rgba(255, 255, 255, 0.1)",
            "annotation_color": "#38bdf8",
        },
        "fonts": {"primary": "Montserrat", "secondary": "Inter", "code": "Fira Code"},
        "borderRadius": "8px",
        "glassmorphism": False,
    }


# Underscore-prefixed fields are pipeline-internal scratch — strip them
# before the entry hits S3 / the editor.
_INTERNAL_ENTRY_KEYS = (
    "_shot_type", "_narration_excerpt", "_visual_description",
    "_skill_audio_events", "_overlay_slots",
)


def _to_timeline_entry(
    raw: Dict[str, Any],
    *,
    gap_start: float,
    gap_end: float,
    video_width: int,
    video_height: int,
) -> Dict[str, Any]:
    """Turn the per-shot generator's `{start, end, ...}` output into the
    persisted timeline entry shape `{inTime, exitTime, ...}` plus a fresh
    unique id. Times are pinned to the gap exactly — we ignore any
    `start`/`end` the LLM might have edited, since the audio for this
    range is fixed."""
    entry_id = f"shot-ins-{int(time.time() * 1000)}"
    out: Dict[str, Any] = {
        "id": entry_id,
        "inTime": float(gap_start),
        "exitTime": float(gap_end),
        "htmlStartX": int(raw.get("htmlStartX", 0)),
        "htmlStartY": int(raw.get("htmlStartY", 0)),
        "htmlEndX": int(raw.get("htmlEndX", video_width)),
        "htmlEndY": int(raw.get("htmlEndY", video_height)),
        "html": raw.get("html", ""),
        "z": int(raw.get("z", 10)),
    }
    if "entry_meta" in raw:
        out["entry_meta"] = raw["entry_meta"]
    if "shot_type" in raw:
        out["shot_type"] = raw["shot_type"]
    return out
