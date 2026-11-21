"""
Stage 2: LLM-based highlight window selection.

Uses OpenRouter API (same as the main AI pipeline) to pick the most engaging
30-60s window from the transcript + prosody data. Model: $HIGHLIGHT_LLM_MODEL
> $RENDER_WORKER_LLM_MODEL > the platform default (GLM, low reasoning effort).
Falls back to an energy-based heuristic if the API key is missing or the
call fails.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Optional

import numpy as np

from .llm_defaults import LLM_MAX_TOKENS, llm_model, reasoning_extra_body
from .schemas import (
    EmphasisMark,
    HighlightWindow,
    ProsodySummary,
    SceneBoundary,
    Sentence,
)

logger = logging.getLogger(__name__)

OPENROUTER_API_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
_MODEL_ENV = "HIGHLIGHT_LLM_MODEL"


# ---------------------------------------------------------------------------
# LLM-based selection
# ---------------------------------------------------------------------------

def select_highlight_llm(
    transcript: list[Sentence],
    emphasis_marks: list[EmphasisMark],
    scene_boundaries: list[SceneBoundary],
    prosody: ProsodySummary,
    duration_s: float,
    min_window: float = 30.0,
    max_window: float = 60.0,
) -> Optional[HighlightWindow]:
    """Call OpenRouter to pick the highlight window.

    Returns HighlightWindow or None if the call fails.
    """
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        logger.info("OPENROUTER_API_KEY not set — skipping LLM highlight")
        return None

    # Build compact context for the LLM (sentence-level only, ~1-2K tokens)
    sentences_compact = [
        {"text": s.text, "start": s.start, "end": s.end}
        for s in transcript
    ]
    emphasis_compact = [
        {"t": e.t, "word": e.word, "reason": e.reason}
        for e in emphasis_marks[:20]  # cap to keep tokens low
    ]
    scene_times = [sb.t for sb in scene_boundaries]

    user_content = json.dumps({
        "total_duration_s": round(duration_s, 1),
        "transcript": sentences_compact,
        "emphasis": emphasis_compact,
        "scene_cuts": scene_times[:30],
        "prosody_summary": {
            "mean_rms": prosody.mean_rms,
            "peak_rms": prosody.peak_rms,
            "pause_count": prosody.pause_count,
        },
    }, ensure_ascii=False)

    system_prompt = (
        "You select the most engaging 30-60 second highlight from a video based on "
        "its transcript, emphasis markers, and scene structure. "
        "Pick a window where the speaker says something impactful, data-rich, or "
        "emotionally resonant. Prefer windows that start/end near sentence or pause "
        "boundaries (not mid-word). "
        "Respond with ONE JSON object: {\"t_start\": float, \"t_end\": float, \"reason\": \"...\"} "
        "and nothing else. No preamble."
    )

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=OPENROUTER_API_URL,
        )
        model = llm_model(_MODEL_ENV)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            # Room for GLM's (low-effort) reasoning on top of a ~100-token reply.
            max_tokens=LLM_MAX_TOKENS,
            response_format={"type": "json_object"},
            extra_body=reasoning_extra_body(model) or None,
        )
        raw = response.choices[0].message.content or ""
        parsed = json.loads(raw)
        t_start = float(parsed["t_start"])
        t_end = float(parsed["t_end"])
        reason = str(parsed.get("reason", "llm_selected"))

        # Validate
        if t_end - t_start < min_window:
            t_end = min(t_start + min_window, duration_s)
        if t_end - t_start > max_window:
            t_end = t_start + max_window
        t_start = max(0.0, t_start)
        t_end = min(duration_s, t_end)

        window = HighlightWindow(
            t_start=round(t_start, 3),
            t_end=round(t_end, 3),
            reason=reason,
        )
        logger.info(f"LLM highlight: {window.t_start}-{window.t_end}s ({reason})")
        return window

    except Exception as e:
        logger.warning(f"LLM highlight selection failed ({e}) — will use energy fallback")
        return None


# ---------------------------------------------------------------------------
# Energy-based fallback
# ---------------------------------------------------------------------------

def select_highlight_energy(
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    duration_s: float,
    window_s: float = 45.0,
) -> HighlightWindow:
    """Sliding window over RMS energy — pick the window with highest mean.

    Used when the LLM call fails or OPENROUTER_API_KEY is not set.
    """
    if duration_s <= window_s:
        # Video is shorter than the window — use the whole thing
        return HighlightWindow(t_start=0.0, t_end=round(duration_s, 3),
                               reason="full_video_short")

    if len(rms_values) == 0:
        # No prosody data — use the first window_s seconds
        return HighlightWindow(t_start=0.0, t_end=round(window_s, 3),
                               reason="no_prosody_data")

    best_start = 0.0
    best_energy = 0.0
    step = 1.0  # slide by 1s

    t = 0.0
    while t + window_s <= duration_s:
        mask = (rms_times >= t) & (rms_times < t + window_s)
        if mask.any():
            energy = float(np.mean(rms_values[mask]))
            if energy > best_energy:
                best_energy = energy
                best_start = t
        t += step

    window = HighlightWindow(
        t_start=round(best_start, 3),
        t_end=round(best_start + window_s, 3),
        reason="energy_heuristic",
    )
    logger.info(f"Energy highlight: {window.t_start}-{window.t_end}s (mean_rms={best_energy:.4f})")
    return window


# ---------------------------------------------------------------------------
# Combined entry point
# ---------------------------------------------------------------------------

def select_highlight(
    transcript: list[Sentence],
    emphasis_marks: list[EmphasisMark],
    scene_boundaries: list[SceneBoundary],
    prosody: ProsodySummary,
    duration_s: float,
    rms_times: np.ndarray,
    rms_values: np.ndarray,
) -> HighlightWindow:
    """Try LLM first, fall back to energy heuristic."""
    window = select_highlight_llm(
        transcript, emphasis_marks, scene_boundaries, prosody, duration_s,
    )
    if window is not None:
        return window
    return select_highlight_energy(rms_times, rms_values, duration_s)
