"""Shot creativity critic — the "director's eye" elevation gate.

Unlike the defect gates (animation-density / bbox / brand-asset / vision-review),
which only REMOVE problems and explicitly ban taste calls, this gate judges
whether a shot is creatively ALIVE or merely competent-and-forgettable, and
pushes it BOLDER. It scores four taste dimensions 0-5 and, for the weakest,
emits one concrete elevation suggestion. The pipeline fires ONE latitude-
EXPANDING corrective regen when the min score is below threshold, with the same
ship-original-on-regression safety as the other gates.

It runs only on the highest-impact shots (hook / hero / moment / close) at the
top tiers, and reuses the screenshot the vision reviewer already cached (so it
adds no extra screenshot capture) plus a structural digest of the HTML.

The rubric (SYSTEM_PROMPT) is frozen as a PROMPT_VERSION string so historical
critic decisions stay comparable across rubric changes.

Companion: shot_visual_reviewer.py (the defect-removal sibling this mirrors).
"""
from __future__ import annotations

import base64
import json
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple


PROMPT_VERSION = "c1"

# Default model + pricing — caller normally passes the matrix-resolved model.
# None lets the client pick the registry's video default (the GLM chain).
_DEFAULT_MODEL: Optional[str] = None
# Fallback price per 1M tokens (the GLM rate) when the registry can't be read;
# shared with the visual reviewer. The estimate feeds the critic's run cost cap.
try:
    from shot_visual_reviewer import (
        _DEFAULT_INPUT_COST_PER_M,
        _DEFAULT_OUTPUT_COST_PER_M,
        model_cost_per_m as _model_cost_per_m,
    )
except ImportError:  # pragma: no cover - module sits next to this file
    _DEFAULT_INPUT_COST_PER_M = 0.027
    _DEFAULT_OUTPUT_COST_PER_M = 0.49

    def _model_cost_per_m(model):  # type: ignore[misc]
        return _DEFAULT_INPUT_COST_PER_M, _DEFAULT_OUTPUT_COST_PER_M

# Below this min-score, the shot is "competent but flat" → fire one elevation regen.
DEFAULT_MIN_SCORE = 3


SYSTEM_PROMPT = f"""You are a film director's eye reviewing ONE shot of an AI-generated explainer video.
Critic prompt version: {PROMPT_VERSION}.

Your job is NOT defect-checking — the shot already passed legibility, layout, and
narration-sync gates; do NOT re-flag those. You judge TASTE: is this shot
creatively ALIVE and memorable, or competent-and-forgettable? Then push it bolder.

You receive the shot's creative intent (its role, the video's controlling idea and
visual metaphor, the section's emotional beat), a structural digest of its
HTML/CSS/GSAP, and optionally one rendered frame.

Score each dimension 0-5 (5 = world-class, 3 = acceptable, 0-2 = flat/templated):
1. BIG_IDEA — is there ONE memorable visual idea that serves the controlling idea
   or visual metaphor, or is it a default centered title + subtitle on a flat bg?
2. MOTION_HOOK — is there a moment a viewer would rewind for (a reveal, a
   transform/morph, anticipation+overshoot, a rolling counter, a draw-on), or does
   everything just fade in and park? Many opacity-only fade-in tweens = LOW.
3. BEAT_DELIVERY — does the shot embody its emotional beat (urgency → snappy/hard
   cuts; awe → scale + negative space; calm → slow overlapping reveals)? A safe
   centered headline on a "surprise" or "urgency" beat scores LOW.
4. COMPOSITIONAL_TENSION — dynamic asymmetry, scale contrast, deliberate negative
   space, off-axis anchors — or dead-centered and evenly weighted?

Then write ONE concrete elevation_suggestion: the single boldest change that would
most raise the WEAKEST dimension. Name the specific element and the specific move
(e.g. "blow the stat up to display size, anchor it bottom-left, and roll it
0→{{value}} on the word 'doubled'"). It MUST keep narration sync, the brand
palette, and legibility — everything else is open.

Be honest and demanding: most first-draft shots are a 2-3. Reserve 4-5 for shots
with a genuine idea AND a real motion hook. Do not award points for mere polish.

Return JSON ONLY (first char {{, last char }}, no prose outside it):
{{
  "scores": {{"big_idea": 0, "motion_hook": 0, "beat_delivery": 0, "compositional_tension": 0}},
  "min_score": 0,
  "elevation_suggestion": "<one concrete sentence: element + bolder move>",
  "verdict": "<=120 chars: why it's flat, or why it's strong>"
}}"""


# ─────────────────────────────────────────────────────────────────────────────
# HTML structural digest (the motion-hook + composition signal, compact)
# ─────────────────────────────────────────────────────────────────────────────

_TWEEN_RE = re.compile(r"gsap\.(?:to|from|fromTo|timeline)\b")
_OPACITY_RE = re.compile(r"opacity\s*:")
_TRANSFORM_RE = re.compile(r"\b(x|y|scale|scaleX|scaleY|rotation|rotate)\s*:")
_REVEAL_RE = re.compile(r"strokeDashoffset|clipPath|clip-path|MorphSVG|morphElement|innerHTML|textContent|drawSVG", re.I)
_CENTER_RE = re.compile(r"full-screen-center|justify-content\s*:\s*center|align-items\s*:\s*center|text-align\s*:\s*center")
_ASYMM_RE = re.compile(r"layout-split|layout-bento|grid-template|position\s*:\s*absolute|flex-start|flex-end|left:|right:|bottom:|top:")
_TAG_RE = re.compile(r"<[^>]+>")


def digest_html(html: str, max_text: int = 200) -> str:
    """Compact, deterministic structural digest so the critic call stays small
    (never dump full HTML). Surfaces the motion-variety + composition signal."""
    html = html or ""
    tweens = len(_TWEEN_RE.findall(html))
    opacity_tweens = len(_OPACITY_RE.findall(html))
    transform_tweens = len(_TRANSFORM_RE.findall(html))
    reveals = len(_REVEAL_RE.findall(html))
    centered = len(_CENTER_RE.findall(html))
    asymmetric = len(_ASYMM_RE.findall(html))
    text = re.sub(r"\s+", " ", _TAG_RE.sub(" ", html)).strip()[:max_text]
    return (
        f"gsap_tweens={tweens} (opacity-mentions={opacity_tweens}, "
        f"transform-mentions={transform_tweens}, reveal/transform-ops={reveals}); "
        f"layout-signals: centered={centered} asymmetric={asymmetric}\n"
        f"on-screen text: {text}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Prompt + parsing
# ─────────────────────────────────────────────────────────────────────────────

def _build_user_prompt(
    *,
    shot: Dict[str, Any],
    creative_concept: Optional[Dict[str, Any]],
    emotional_beat: str,
    canvas: str,
    html: str,
    has_screenshot: bool,
) -> str:
    cc = creative_concept or {}
    lines = [
        "SHOT INTENT:",
        f"- Role in the video: {shot.get('intent_role', '')}",
        f"- Shot type: {shot.get('shot_type', '')}",
        f"- This shot's point: {shot.get('narration_brief', '') or shot.get('visual_description', '')}",
        f"- Emotional beat: {emotional_beat or shot.get('emotion', '') or '(unspecified)'}",
        f"- Canvas: {canvas}",
        "",
        "VIDEO CREATIVE CONCEPT:",
        f"- Controlling idea: {cc.get('controlling_idea', '(none)')}",
        f"- Visual metaphor: {cc.get('visual_metaphor', '(none)')}",
        f"- Signature device: {cc.get('signature_device', '(none)')}",
        "",
        "SHOT STRUCTURE (digest of the generated HTML/CSS/GSAP):",
        digest_html(html),
    ]
    if has_screenshot:
        lines += ["", "A rendered mid-frame of the shot is attached — judge composition from it."]
    lines += ["", "Score the four dimensions and return the JSON object only."]
    return "\n".join(lines)


def _png_to_data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


def _parse_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    for cand in (raw, _FENCE_RE.sub("", raw).strip()):
        cand = (cand or "").strip()
        start = cand.find("{")
        end = cand.rfind("}")
        if start < 0 or end <= start:
            continue
        try:
            data = json.loads(cand[start:end + 1])
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return None


def _clamp_score(v: Any) -> int:
    try:
        return max(0, min(5, int(round(float(v)))))
    except (TypeError, ValueError):
        return 3  # neutral/acceptable on garbage so we don't regen on a parse fluke


def _normalize(parsed: Dict[str, Any]) -> Dict[str, Any]:
    raw_scores = parsed.get("scores") if isinstance(parsed.get("scores"), dict) else {}
    scores = {
        "big_idea": _clamp_score(raw_scores.get("big_idea")),
        "motion_hook": _clamp_score(raw_scores.get("motion_hook")),
        "beat_delivery": _clamp_score(raw_scores.get("beat_delivery")),
        "compositional_tension": _clamp_score(raw_scores.get("compositional_tension")),
    }
    min_score = min(scores.values())
    return {
        "scores": scores,
        "min_score": min_score,
        "elevation_suggestion": str(parsed.get("elevation_suggestion") or "").strip(),
        "verdict": str(parsed.get("verdict") or "").strip()[:200],
    }


def _estimate_cost(usage: Optional[Dict[str, Any]], in_per_m: float, out_per_m: float) -> float:
    u = usage or {}
    return (
        float(u.get("prompt_tokens", 0) or 0) / 1_000_000 * in_per_m
        + float(u.get("completion_tokens", 0) or 0) / 1_000_000 * out_per_m
    )


def _no_op_record(*, model: Optional[str], error: Optional[str] = None) -> Dict[str, Any]:
    """A passing, no-cost record so the caller always ships the original."""
    return {
        "passes": True,
        "scores": {"big_idea": 3, "motion_hook": 3, "beat_delivery": 3, "compositional_tension": 3},
        "min_score": 3,
        "elevation_suggestion": "",
        "verdict": "",
        "cost_usd": 0.0,
        "review_ms": 0,
        "prompt_version": PROMPT_VERSION,
        "model": model,
        "raw": "",
        "error": error,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def critique_shot(
    *,
    html: str,
    shot: Dict[str, Any],
    creative_concept: Optional[Dict[str, Any]],
    emotional_beat: str,
    canvas: str,
    llm_chat: Callable[..., Any],
    screenshot: Optional[bytes] = None,
    min_score: int = DEFAULT_MIN_SCORE,
    model: Optional[str] = _DEFAULT_MODEL,
    max_tokens: int = 900,
    temperature: float = 0.3,
    # None = the model's registry price (GLM constants when unreadable).
    input_cost_per_m: Optional[float] = None,
    output_cost_per_m: Optional[float] = None,
) -> Dict[str, Any]:
    """Score one shot's creativity 0-5 on four dimensions + emit an elevation
    suggestion. Never raises — every error path returns a passing no-op record so
    the caller ships the original. `passes` is False only when min_score < the
    threshold (i.e. the shot is competent-but-flat and worth one elevation regen).

    Returns: {passes, scores, min_score, elevation_suggestion, verdict, cost_usd,
              review_ms, prompt_version, model, raw, error}
    """
    if not (html or "").strip():
        return _no_op_record(model=model, error="empty html")
    if input_cost_per_m is None or output_cost_per_m is None:
        _in_m, _out_m = _model_cost_per_m(model)
        input_cost_per_m = _in_m if input_cost_per_m is None else input_cost_per_m
        output_cost_per_m = _out_m if output_cost_per_m is None else output_cost_per_m

    user_text = _build_user_prompt(
        shot=shot,
        creative_concept=creative_concept,
        emotional_beat=emotional_beat,
        canvas=canvas,
        html=html,
        has_screenshot=bool(screenshot),
    )
    if screenshot:
        user_content: Any = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": _png_to_data_url(screenshot)}},
        ]
    else:
        user_content = user_text

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
    started = time.monotonic()
    try:
        try:
            raw, usage = llm_chat(
                messages, model=model, temperature=temperature,
                max_tokens=max_tokens, response_format={"type": "json_object"},
            )
        except TypeError:
            raw, usage = llm_chat(messages, model=model, temperature=temperature, max_tokens=max_tokens)
    except Exception as exc:
        return _no_op_record(model=model, error=str(exc))

    parsed = _parse_json(raw or "")
    if not parsed:
        return _no_op_record(model=model, error="unparseable critic JSON")

    norm = _normalize(parsed)
    return {
        "passes": norm["min_score"] >= int(min_score),
        "scores": norm["scores"],
        "min_score": norm["min_score"],
        "elevation_suggestion": norm["elevation_suggestion"],
        "verdict": norm["verdict"],
        "cost_usd": _estimate_cost(usage, input_cost_per_m, output_cost_per_m),
        "review_ms": int((time.monotonic() - started) * 1000),
        "prompt_version": PROMPT_VERSION,
        "model": model,
        "raw": (raw or "")[:4000],
        "error": None,
    }


def build_elevation_corrective(record: Dict[str, Any]) -> str:
    """The latitude-EXPANDING corrective prompt — the OPPOSITE of the defect
    gates' re-clamp directives. Hands the LLM permission to be bolder."""
    scores = record.get("scores") or {}
    weakest = min(scores, key=scores.get) if scores else "big_idea"
    sugg = (record.get("elevation_suggestion") or "").strip()
    verdict = (record.get("verdict") or "").strip()
    return (
        "Your shot is technically fine but creatively FLAT (a director would not "
        f"keep it). Weakest dimension: {weakest} "
        f"(scores: {json.dumps(scores)}). {('Critic note: ' + verdict) if verdict else ''}\n\n"
        "Regenerate this ONE shot BOLDER. You now have EXPANDED latitude:\n"
        "- Break the default centered title+subtitle layout — use asymmetry, scale "
        "contrast, off-axis anchors, or deliberate negative space.\n"
        "- Add at least ONE real motion hook (a reveal, a transform/morph, "
        "anticipation+overshoot, a rolling number, a draw-on) — not just opacity "
        "fade-ins that park.\n"
        "- Lean into the video's controlling idea and visual metaphor; make this "
        "shot deliver its emotional beat, not a safe headline.\n"
        + (f"- Specifically: {sugg}\n" if sugg else "")
        + "\nHARD CONSTRAINTS (do NOT break these): keep the narration/word-timing "
        "sync, the brand palette tokens (var(--brand-*)), and legibility. "
        "Everything else is open. Return only the JSON shot object."
    )


# ─────────────────────────────────────────────────────────────────────────────
# Smoke test
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    flat_html = (
        "<div class='full-screen-center'><h1 id='t' style='opacity:0'>Compound Interest</h1></div>"
        "<script>gsap.to('#t',{opacity:1,duration:0.5});</script>"
    )

    def fake_low(messages, **kw):
        return json.dumps({
            "scores": {"big_idea": 2, "motion_hook": 1, "beat_delivery": 2, "compositional_tension": 2},
            "min_score": 1,
            "elevation_suggestion": "Blow the number up to display size, anchor bottom-left, roll 0→value on 'doubled'.",
            "verdict": "Centered title, single fade-in — no idea, no hook.",
        }), {"prompt_tokens": 800, "completion_tokens": 60}

    def fake_high(messages, **kw):
        return json.dumps({
            "scores": {"big_idea": 4, "motion_hook": 4, "beat_delivery": 4, "compositional_tension": 4},
            "min_score": 4, "elevation_suggestion": "", "verdict": "Strong metaphor + real reveal.",
        }), {"prompt_tokens": 800, "completion_tokens": 30}

    def fake_raise(messages, **kw):
        raise RuntimeError("boom")

    r_low = critique_shot(html=flat_html, shot={"intent_role": "hook"}, creative_concept={"controlling_idea": "doing nothing wins"}, emotional_beat="surprise", canvas="landscape", llm_chat=fake_low)
    assert r_low["passes"] is False and r_low["min_score"] == 1, r_low
    assert "Blow the number" in build_elevation_corrective(r_low)

    r_high = critique_shot(html=flat_html, shot={"intent_role": "hook"}, creative_concept={}, emotional_beat="calm", canvas="landscape", llm_chat=fake_high)
    assert r_high["passes"] is True and r_high["min_score"] == 4, r_high

    r_err = critique_shot(html=flat_html, shot={}, creative_concept={}, emotional_beat="", canvas="landscape", llm_chat=fake_raise)
    assert r_err["passes"] is True and r_err["error"] == "boom", r_err  # ships original on failure

    r_empty = critique_shot(html="", shot={}, creative_concept={}, emotional_beat="", canvas="landscape", llm_chat=fake_low)
    assert r_empty["passes"] is True and r_empty["error"] == "empty html"

    print("shot_creativity_critic.py smoke test passed.")
