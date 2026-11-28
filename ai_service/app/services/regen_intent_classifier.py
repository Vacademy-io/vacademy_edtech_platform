"""Regen intent classifier — decides between deterministic DOM patch and full LLM remake.

A tiny classifier call (the 'video' default model, GLM at low effort, with one
retry on Gemini Flash) takes the user's edit instruction
plus a compact shot summary (NOT the full HTML — that's what made the regen
prompt the wrong shape in the first place) and returns structured intent:

    {
      "intent": "targeted_patch" | "full_remake",
      "patch_ops": [
        { "target": "image" | "text" | "color" | "media_query",
          "selector_hint": "background video" | "headline" | "#s3_w1",
          "new_value": "<new query / text / hex>",
          "confidence": 0.0-1.0 }
      ],
      "rationale": "<one short sentence>"
    }

Caller routes:
  - `targeted_patch` with high-confidence ops → `regen_dom_patcher.apply()`
    → return patched HTML, never call the heavy LLM
  - `full_remake` (or low-confidence patch) → fall through to canonical LLM
"""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Any, Dict, List, Optional

import requests

from ..constants.model_defaults import NON_GLM_FALLBACK

logger = logging.getLogger(__name__)

# The classifier model is the ai_model_defaults 'video' default (GLM), NOT the
# regen-output model — that one is tier-aware. On a timeout, error or bad JSON
# it retries once on NON_GLM_FALLBACK. The primary leg gets at most this share
# of the caller's budget so the retry still fits inside it.
_PRIMARY_BUDGET_SHARE = 2 / 3
# The answer is ~150 tokens; GLM's reasoning counts against max_tokens.
_MAX_TOKENS = 2000
# Sent explicitly: on the OpenRouter failover leg a payload with no reasoning
# object runs GLM at its heavy default.
_REASONING = {"effort": "low"}
# Each leg runs here so the caller's budget is a hard wall-clock limit, even
# when post_chat_sync's own gateway failover would double a timeout. A leg
# abandoned at its deadline finishes on its own within its httpx timeout.
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="regen-intent")

# Confidence below which we treat an op as too risky to apply deterministically.
# Caller falls through to the LLM path for these.
_CONFIDENCE_FLOOR = 0.65

_SYSTEM_PROMPT = """You classify a single edit instruction on an AI-generated educational video shot.

Output STRICT JSON only (no markdown fences, no commentary), shape:
{
  "intent": "targeted_patch" | "full_remake",
  "patch_ops": [
    {
      "target": "image" | "text" | "color" | "media_query",
      "selector_hint": "<id or natural-language hint, e.g. 'background video', 'headline', '#s3_w1'>",
      "new_value": "<new content — for media_query: a search phrase; for text: the literal new text; for color: hex like #004280>",
      "confidence": 0.0-1.0
    }
  ],
  "rationale": "<one short sentence why>"
}

Rules:
- Choose `targeted_patch` when the instruction names ONE OR TWO attributes with clear targets ("change the image to elephants", "make the headline blue", "update the title text").
- Choose `full_remake` when the instruction implies layout, composition, motion, or overall style ("redesign", "make it more dramatic", "different layout", "add a section").
- Ambiguous? Pick `full_remake`. Safer default — the LLM will do the right thing.
- For "the image" / "the text" with multiple candidates: pick the one most likely meant given shot context. Set selector_hint to a natural-language description; the deterministic patcher resolves to the largest matching element.
- `media_query` is for shots that source images via search query (`data-video-query` / `data-img-prompt`). Use this for "change the background to <X>" / "show <X> instead of <Y>" — the system will re-fetch the asset using the new query. Do NOT use for "change to this URL" (we don't accept URLs from this path).
- `color` only for explicit color asks ("make X blue", "change brand color to #..."). Output `new_value` as a hex code; if user says a color name, map to a CSS-named-color or common hex.
- `confidence` <= 0.6 means "I'm guessing"; the caller will fall back to the LLM.
- Output AT MOST 3 patch_ops. More than that = full_remake.
- No trailing whitespace, no comments inside the JSON.
"""


def _coerce_op(op: Any) -> Optional[Dict[str, Any]]:
    """Validate and normalize one patch_op from the LLM."""
    if not isinstance(op, dict):
        return None
    target = (op.get("target") or "").strip().lower()
    if target not in ("image", "text", "color", "media_query"):
        return None
    selector = (op.get("selector_hint") or "").strip()
    new_value = op.get("new_value")
    if new_value is None or (isinstance(new_value, str) and not new_value.strip()):
        return None
    try:
        confidence = float(op.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))
    return {
        "target": target,
        "selector_hint": selector or "primary",
        "new_value": str(new_value).strip() if not isinstance(new_value, str) else new_value.strip(),
        "confidence": round(confidence, 3),
    }


def _strip_code_fence(text: str) -> str:
    """Strip ```json … ``` if the model wraps its output despite the rule."""
    match = re.search(r"```(?:json)?\s*\n?([\s\S]*?)\n?\s*```", text, re.IGNORECASE)
    return match.group(1).strip() if match else text.strip()


def build_shot_summary(
    *,
    shot_type: Optional[str],
    text_blocks: List[Dict[str, str]],
    images: List[Dict[str, str]],
    color_vars: List[Dict[str, str]],
) -> str:
    """Compact human-readable shot snapshot for the classifier prompt.

    Far smaller than the full HTML — gives the model just enough to resolve
    "the image" / "the title" / "the brand color" type references.
    """
    parts: List[str] = []
    if shot_type:
        parts.append(f"shot_type: {shot_type}")
    if images:
        parts.append("\nimages:")
        for img in images[:6]:
            label = img.get("id") or img.get("kind") or "image"
            descriptor = img.get("query") or img.get("src") or ""
            parts.append(f"  - {label}: {descriptor[:120]}")
    if text_blocks:
        parts.append("\ntext_blocks:")
        for tb in text_blocks[:10]:
            label = tb.get("id") or tb.get("role") or "text"
            content = (tb.get("content") or "").strip().replace("\n", " ")
            parts.append(f"  - {label}: \"{content[:80]}\"")
    if color_vars:
        parts.append("\nbrand_colors:")
        for cv in color_vars[:6]:
            parts.append(f"  - {cv.get('var')}: {cv.get('value')}")
    return "\n".join(parts) or "(empty shot summary)"


def _request_classification(
    model: str, user_message: str, openrouter_api_key: str, timeout_s: float
) -> Dict[str, Any]:
    """One classifier call → the parsed JSON with a valid `intent` (raises
    on any failure, so the caller can move to the next model)."""
    from .llm_router import post_chat_sync

    payload: Dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
        "max_tokens": _MAX_TOKENS,
        "response_format": {"type": "json_object"},
    }
    if model != NON_GLM_FALLBACK:
        # The Gemini Flash fallback leg sends none, as before: an effort would
        # turn its thinking on and slow the retry.
        payload["reasoning"] = dict(_REASONING)

    response = post_chat_sync(api_key=openrouter_api_key, payload=payload, timeout=timeout_s)
    if response.status_code != 200:
        raise RuntimeError(f"non-200: {response.status_code} {response.text[:200]}")
    raw = response.json()["choices"][0]["message"]["content"]
    parsed = json.loads(_strip_code_fence(raw or ""))
    if not isinstance(parsed, dict):
        raise ValueError(f"classifier JSON is not an object: {type(parsed).__name__}")
    intent = (parsed.get("intent") or "").strip().lower()
    if intent not in ("targeted_patch", "full_remake"):
        raise ValueError(f"invalid intent value: {intent!r}")
    parsed["intent"] = intent
    return parsed


def classify_intent(
    *,
    user_instruction: str,
    shot_summary: str,
    openrouter_api_key: str,
    timeout_s: float = 12.0,
) -> Optional[Dict[str, Any]]:
    """Call the classifier. Returns parsed dict, or None on any failure.

    Caller treats None as "skip the fast path, go straight to LLM regen."
    Designed to fail closed — a slow/broken classifier never blocks regen,
    and both legs together stay inside `timeout_s`.
    """
    if not user_instruction or not user_instruction.strip():
        return None
    if not openrouter_api_key:
        return None

    user_message = (
        f"SHOT SNAPSHOT:\n{shot_summary}\n\n"
        f"USER INSTRUCTION:\n{user_instruction.strip()}\n\n"
        "Return JSON only."
    )

    try:
        from ..constants.models import get_use_case_model_chain

        chain = get_use_case_model_chain("video")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[regen_intent] model lookup failed ({e}); using {NON_GLM_FALLBACK}")
        chain = [NON_GLM_FALLBACK]

    deadline = time.monotonic() + timeout_s
    parsed: Optional[Dict[str, Any]] = None
    for i, model in enumerate(chain):
        budget = deadline - time.monotonic()
        if i == 0 and len(chain) > 1:
            budget = min(budget, timeout_s * _PRIMARY_BUDGET_SHARE)
        if budget <= 0:
            break
        future = _POOL.submit(_request_classification, model, user_message, openrouter_api_key, budget)
        try:
            parsed = future.result(timeout=budget)
        except FutureTimeout:
            logger.warning(f"[regen_intent] classifier on {model} timed out after {budget:.1f}s")
            continue
        except Exception as e:
            logger.warning(f"[regen_intent] classifier on {model} failed: {e}")
            continue
        if i > 0:
            logger.info(f"[regen_intent] classified by fallback model {model}")
        break

    if parsed is None:
        return None
    intent = parsed["intent"]

    ops_in = parsed.get("patch_ops") or []
    ops_out: List[Dict[str, Any]] = []
    if isinstance(ops_in, list):
        for op in ops_in[:3]:  # cap defensively even if LLM exceeds
            normalized = _coerce_op(op)
            if normalized:
                ops_out.append(normalized)

    # Aggregate confidence — min of ops, capped at 1.0; 0 if no ops on a patch.
    if intent == "targeted_patch":
        if not ops_out:
            # Patch without ops is a contradiction — treat as full_remake.
            logger.info("[regen_intent] patch without ops — coercing to full_remake")
            return {
                "intent": "full_remake",
                "patch_ops": [],
                "rationale": parsed.get("rationale") or "no valid ops parsed",
                "confidence": 0.0,
            }
        agg_conf = min(op["confidence"] for op in ops_out)
    else:
        agg_conf = 1.0  # full_remake is always "confident" by definition

    return {
        "intent": intent,
        "patch_ops": ops_out,
        "rationale": str(parsed.get("rationale") or "")[:240],
        "confidence": round(agg_conf, 3),
    }


def is_patch_safe_to_apply(classification: Dict[str, Any]) -> bool:
    """Caller's gate: true iff the classifier wants a patch AND every op
    clears the confidence floor."""
    if not classification:
        return False
    if classification.get("intent") != "targeted_patch":
        return False
    ops = classification.get("patch_ops") or []
    if not ops:
        return False
    return all(op.get("confidence", 0.0) >= _CONFIDENCE_FLOOR for op in ops)
