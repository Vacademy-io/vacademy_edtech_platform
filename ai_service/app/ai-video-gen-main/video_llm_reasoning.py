"""How hard a reasoning-mandatory model should think on a video pipeline call.

GLM 5.x thinks on every request and cannot be told not to. The video pipeline's
OpenRouterClient used to send no reasoning setting at all, so the model thought
at its own default. Measured on the same 18-shot plan for the same model
(z-ai/glm-5.3-flash, 2026-10-01):

    no reasoning setting   188 s   5,654 reasoning tokens   $0.0046
    effort "high"          228 s     688 reasoning tokens   $0.00087

Both returned a complete, valid 18/18 plan. Saying "high" explicitly is about
five times cheaper than saying nothing, because "nothing" is not "off" - it is
the model's own, much heavier default. Routed to Isoquant (see
app/services/llm_router.py) the same "high" request took 49 s.

The setting is OpenRouter's `reasoning` object. The router translates it into
Isoquant's top-level `reasoning_effort` when a model is routed there, and it is
honoured as-is when the call stays on OpenRouter or fails over to it.

Two per-call adjustments sit on top of the configured effort (`plan_reasoning`):

* `video_effort(level)` overrides the effort for the calls made inside it (hero
  shots think at "max"). "max" is Isoquant's level and OpenRouter rejects it, so
  the OpenRouter-shaped object carries "high" and the gateway effort is handed
  back separately for the client to give only to a gateway that accepts it.
* A small call (max_tokens under SMALL_CALL_MAX_TOKENS) with no override thinks
  at "low" and gets SMALL_CALL_MAX_TOKENS of room: at "high", GLM's reasoning
  alone fills a 200-1500 token budget, stops on "length" and re-runs the whole
  call at double the budget. A higher ceiling costs nothing; billing counts the
  tokens actually generated.
"""
from __future__ import annotations

import contextlib
import os
from contextvars import ContextVar
from typing import Any, Dict, Iterator, NamedTuple, Optional

__all__ = [
    "REASONING_MANDATORY_PREFIXES",
    "DEFAULT_EFFORT",
    "SMALL_CALL_MAX_TOKENS",
    "SMALL_CALL_EFFORT",
    "ReasoningPlan",
    "video_reasoning_effort",
    "reasoning_for",
    "video_effort",
    "effort_override",
    "plan_reasoning",
]

# Models whose endpoint thinks whether or not it is asked to.
REASONING_MANDATORY_PREFIXES = ("z-ai/glm-5", "z-ai/glm-4.6v")

DEFAULT_EFFORT = "high"
# Efforts OpenRouter's reasoning object accepts. Isoquant's "max" is deliberately
# absent: if the gateway fails over, OpenRouter must still accept the request.
_VALID = ("low", "medium", "high")
_OFF = ("", "none", "off", "default")


def video_reasoning_effort() -> Optional[str]:
    """The configured effort, or None to send no reasoning setting at all.

    VIDEO_REASONING_EFFORT=off restores the old behaviour. An unrecognised value
    falls back to the default rather than producing a request that 400s.
    """
    raw = os.getenv("VIDEO_REASONING_EFFORT", DEFAULT_EFFORT).strip().lower()
    if raw in _OFF:
        return None
    return raw if raw in _VALID else DEFAULT_EFFORT


def reasoning_for(model: Optional[str]) -> Optional[Dict[str, Any]]:
    """OpenRouter-shaped reasoning object for `model`, or None to leave it out.

    Only reasoning-mandatory models get one. Everything else in the fallback
    chain (Gemini, Claude, ...) is sent exactly what it was sent before.
    """
    if not model or not any(model.startswith(p) for p in REASONING_MANDATORY_PREFIXES):
        return None
    effort = video_reasoning_effort()
    if effort is None:
        return None
    return {"enabled": True, "effort": effort}


# ── Per-call effort override ───────────────────────────────────────────────
# Levels a caller may ask for. "max" is Isoquant's; it never reaches an
# OpenRouter-shaped payload (see plan_reasoning).
_OVERRIDE_LEVELS = ("low", "medium", "high", "max")
_effort_override: ContextVar[Optional[str]] = ContextVar("video_effort_override", default=None)

# Below this many max_tokens a GLM call is a "small call" (judges, rankers,
# choreographer, host description): it thinks at "low" with this much room.
SMALL_CALL_MAX_TOKENS = 4000
SMALL_CALL_EFFORT = "low"


@contextlib.contextmanager
def video_effort(level: Optional[str]) -> Iterator[None]:
    """Think at `level` for the calls made inside this block (this thread/task).

    An unknown or empty level means no override. Keep the block tight: a judge
    or regen call made inside it would think at the same level.
    """
    lvl = (level or "").strip().lower() or None
    if lvl not in _OVERRIDE_LEVELS:
        lvl = None
    token = _effort_override.set(lvl)
    try:
        yield
    finally:
        _effort_override.reset(token)


def effort_override() -> Optional[str]:
    """The effort set by the innermost `video_effort` block, or None."""
    return _effort_override.get()


class ReasoningPlan(NamedTuple):
    # OpenRouter-shaped reasoning object (never "max"), or None to send none.
    reasoning: Optional[Dict[str, Any]]
    # The effort a gateway that accepts it (Isoquant "max") should get instead,
    # or None when the reasoning object's effort is already right.
    gateway_effort: Optional[str]
    # The max_tokens to send (raised for small calls).
    max_tokens: int


def plan_reasoning(model: Optional[str], max_tokens: int) -> ReasoningPlan:
    """Reasoning setting and token ceiling for one call to `model`.

    Non-reasoning models, and every model when VIDEO_REASONING_EFFORT is off,
    are sent exactly what they were sent before.
    """
    base = reasoning_for(model)
    if base is None:
        return ReasoningPlan(None, None, max_tokens)
    override = effort_override()
    if override:
        # OpenRouter's object takes low/medium/high; anything above is "high"
        # there and goes to the gateway separately.
        or_effort = override if override in _VALID else "high"
        return ReasoningPlan(
            {"enabled": True, "effort": or_effort},
            override if override != or_effort else None,
            max_tokens,
        )
    if isinstance(max_tokens, (int, float)) and max_tokens < SMALL_CALL_MAX_TOKENS:
        return ReasoningPlan(
            {"enabled": True, "effort": SMALL_CALL_EFFORT}, None, SMALL_CALL_MAX_TOKENS
        )
    return ReasoningPlan(base, None, max_tokens)
