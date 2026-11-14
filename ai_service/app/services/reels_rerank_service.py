"""
LLM selection pass for /scan — the semantic judge with real authority.

The 4-axis heuristic in `reels_engagement_service` is a cheap PREFILTER: it
enumerates and scores every window of the source and hands the diversified
top-K (≤60) here. This module runs ONE LLM call that hard-SELECTS and orders
the final top-N the user sees. The heuristic composite is advisory input to
the LLM, not the ranking authority — token-level proxies (opener word lists,
TF-IDF spread) cannot judge "would I actually post this?"; a model reading
the full window transcript can.

Design:
  * Single call per cold /scan. Each window ships its FULL transcript
    (middle-elided only past _TRANSCRIPT_CHAR_CAP chars), start/end times,
    predicted output duration, and the heuristic axis scores as advisory
    signals. The request's real target duration + topic keywords are in the
    prompt — selection criteria match what the user actually asked for.
  * The model returns an ordered `selection` array (best first) of exactly
    the ids it wants surfaced, with a one-line reason each. `apply_selection`
    reorders the heuristic candidates to match, fills any shortfall from the
    heuristic order, and re-assigns composites monotonically (the FE sorts by
    composite; rank is authoritative, so composite must agree with rank).
  * The call goes through llm_router.chat_with_chain with the
    'reels_selection' use-case chain (GLM by default): Isoquant for GLM with
    reasoning effort low and a max_tokens allowance on both gateway legs, then
    the next model on any failure.
  * On any failure (no API key, transport error, malformed response, zero
    valid ids) the caller falls back to the pure-heuristic order — selection
    never blocks /scan.

The module keeps its historical filename; the ±10% "rerank nudge" it used to
implement is gone.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Optional, Sequence

from .use_case_chat import chat_json

logger = logging.getLogger(__name__)

# The selection prompt is much larger than the old snippet-rerank prompt
# (up to 60 windows × ~800 chars ≈ 12k input tokens), so it gets a longer
# leash than the usual 15s LLM budget. Still bounded — /scan is interactive.
_SELECT_TIMEOUT_S = 30.0
# Whole-chain budget: walking the chain (gateway → OpenRouter → next model)
# must not hold an interactive /scan for minutes.
_SELECT_BUDGET_S = 45.0
_SELECT_TEMPERATURE = 0.2
# Output is an ordered id list + short reasons (≤50 entries × ~25 tokens ≈
# 1.3k). 4000 leaves headroom for verbose models; reasoning models (GLM) get
# a further allowance on top from chat_with_chain.
_SELECT_MAX_TOKENS = 4000
SELECTION_USE_CASE = "reels_selection"
# Hard cap on windows shipped to the LLM — keeps the prompt inside a cheap
# model's comfortable context and the cost per scan predictable.
MAX_SELECTION_WINDOWS = 60
# Per-window transcript cap. Ellipsis goes in the MIDDLE so the model always
# sees the true opener (hook) and the true ending (payoff/loop) verbatim.
_TRANSCRIPT_CHAR_CAP = 800

_SYSTEM_PROMPT = """You are the final clip selector for a short-video tool.
The input is a list of candidate windows cut from ONE long source video.
Each window has: an id, start/end seconds, its predicted duration after
silence/filler trimming, its transcript, and advisory heuristic scores
(0-100; computed from audio/token statistics — useful hints, NOT ground
truth; overrule them whenever the transcript says otherwise).

Select the N best windows and order them best-first. Judge each window as a
STANDALONE vertical clip (TikTok / Reels / Shorts):
  * Hook: the first sentence must earn the next 3 seconds — concrete claim,
    number, story opening, or counterintuitive framing.
  * Self-contained: no dangling references to earlier context, no setup
    without payoff. The clip must resolve the idea it opens.
  * One clear idea per clip; dense, not rambling.
  * Prefer windows whose predicted duration is close to the target.
  * If topic keywords are given, prefer windows that actually cover them.
Down-rank: mid-sentence starts, trailing thoughts, meta-talk about the video
itself, housekeeping ("like and subscribe"), greetings.

Return STRICT JSON, no prose:
{
  "selection": [
    {"id": "<input id>", "reason": "<5-12 words, a real critique>"},
    ...
  ]
}

Rules: exactly N entries (fewer only if fewer inputs qualify at all), best
clip FIRST, every id must come from the input, no id twice."""


async def select_top_candidates(
    *,
    candidates: list[dict],
    select_n: int,
    target_duration_sec: int,
    topic_keywords: Sequence[str] = (),
    api_key: Optional[str],
    models: Sequence[str],
) -> Optional[list[tuple[str, str]]]:
    """Run the LLM selection pass. Returns the ordered `[(id, reason), ...]`
    the model chose (best first, ≤ select_n entries), or None on any failure
    so the caller can fall back to the heuristic order.

    Each `candidate` is a dict with keys: id, transcript, t_start, t_end,
    predicted_duration_s, scores (dict of the 5 axes + composite). `models` is
    the chain to walk (first = preferred).
    """
    if not candidates or not api_key or select_n <= 0 or not models:
        return None
    if len(candidates) <= 1:
        return None  # nothing to choose between

    pool = candidates[:MAX_SELECTION_WINDOWS]
    user = _build_user_prompt(
        pool,
        select_n=min(select_n, len(pool)),
        target_duration_sec=target_duration_sec,
        topic_keywords=topic_keywords,
    )
    payload = {
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        "temperature": _SELECT_TEMPERATURE,
        "max_tokens": _SELECT_MAX_TOKENS,
    }
    # json_object first; the chain again without it if a model rejected the
    # parameter (400). Never raises — None means "heuristic order stands".
    try:
        result = await asyncio.wait_for(
            chat_json(
                payload,
                use_case=SELECTION_USE_CASE,
                models=list(models),
                api_key=api_key,
                timeout=_SELECT_TIMEOUT_S,
                label="ReelsSelect",
            ),
            timeout=_SELECT_BUDGET_S,
        )
    except asyncio.TimeoutError:
        logger.warning(f"[ReelsSelect] no answer within {_SELECT_BUDGET_S:.0f}s — heuristic order stands")
        return None
    raw: Optional[str] = result.content if result is not None else None

    if not raw:
        return None

    parsed = _parse_response(raw)
    if not parsed:
        return None

    valid_ids = {c["id"] for c in pool}
    ordered: list[tuple[str, str]] = []
    seen: set[str] = set()
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        cand_id = entry.get("id")
        if not isinstance(cand_id, str) or cand_id not in valid_ids or cand_id in seen:
            continue
        reason = entry.get("reason")
        ordered.append((cand_id, reason if isinstance(reason, str) else ""))
        seen.add(cand_id)
        if len(ordered) >= select_n:
            break
    if not ordered:
        logger.warning("[ReelsSelect] response contained no valid candidate ids")
        return None
    return ordered


def apply_selection(
    scored: list,
    ordered: list[tuple[str, str]],
    select_n: int,
) -> list:
    """Reorder the heuristic candidate list to the LLM's selection.

    `scored` is the heuristic-ordered prefilter output (duck-typed: each item
    has `.rank`, `.score.composite`, `.score.breakdown`); candidate `i` maps
    to id `f"c{i}"` — the same scheme the caller used to build the prompt.
    `ordered` is `select_top_candidates`'s output.

    Returns a NEW list of up to `select_n` candidates, mutated in place:
      * order = LLM order, topped up from the heuristic order when the LLM
        returned fewer than select_n valid ids;
      * composites are re-assigned monotonically — the rank-k candidate gets
        the k-th highest composite among the selected set, so a UI sorting
        by composite agrees with rank (rank stays authoritative);
      * the LLM's reason + the composite scale factor land in the breakdown
        under the existing `llm_rerank_reason` / `llm_rerank_factor` keys
        (same wire fields the FE already renders).

    Returns [] when `ordered` contains no resolvable ids — caller falls back.
    """
    n = len(scored)
    if n == 0:
        return []
    index_of = {f"c{i}": i for i in range(n)}
    picked_idx: list[int] = []
    reasons: dict[int, str] = {}
    seen: set[int] = set()
    for cand_id, reason in ordered:
        idx = index_of.get(cand_id)
        if idx is None or idx in seen:
            continue
        seen.add(idx)
        picked_idx.append(idx)
        if reason:
            reasons[idx] = reason
        if len(picked_idx) >= select_n:
            break
    if not picked_idx:
        return []
    # Shortfall: the LLM endorsed fewer than select_n — fill the tail with
    # the best remaining heuristic picks so the user still gets a full grid.
    if len(picked_idx) < select_n:
        for i in range(n):
            if i in seen:
                continue
            seen.add(i)
            picked_idx.append(i)
            if len(picked_idx) >= select_n:
                break

    selected = [scored[i] for i in picked_idx]
    # Monotonic composite re-assignment: permute the selected set's own
    # composite values so they descend in rank order. The value multiset is
    # preserved (no inflation/deflation), only the pairing changes.
    descending = sorted((c.score.composite for c in selected), reverse=True)
    for rank, (cand, new_composite) in enumerate(zip(selected, descending), start=1):
        old = cand.score.composite
        if old > 0:
            cand.score.breakdown["llm_rerank_factor"] = round(new_composite / old, 3)
        reason = reasons.get(picked_idx[rank - 1])
        if reason:
            cand.score.breakdown["llm_rerank_reason"] = reason[:200]
        cand.score.composite = new_composite
        cand.rank = rank
    return selected


def _build_user_prompt(
    candidates: list[dict],
    *,
    select_n: int,
    target_duration_sec: int,
    topic_keywords: Sequence[str],
) -> str:
    """Render the selection task + candidate blocks. Full transcripts (middle-
    elided past the cap) — the model must see real openers and endings, not
    sanitized snippets."""
    lines = [
        f"Select the {select_n} best windows, ordered best-first.",
        f"Target clip duration: {target_duration_sec}s.",
    ]
    keywords = [k.strip() for k in topic_keywords if k and k.strip()]
    if keywords:
        lines.append(f"Topic keywords from the user: {', '.join(keywords[:20])}.")
    lines.append("\nCandidate windows:\n")
    for c in candidates:
        scores = c.get("scores") or {}
        score_str = " ".join(
            f"{axis}={scores[axis]:.0f}"
            for axis in ("hook", "pacing", "info", "loop", "topic", "composite")
            if isinstance(scores.get(axis), (int, float))
        )
        transcript = _clip_middle((c.get("transcript") or "").strip(), _TRANSCRIPT_CHAR_CAP)
        lines.append(
            f'- id: "{c["id"]}"\n'
            f"  window: {c.get('t_start', 0.0):.1f}s → {c.get('t_end', 0.0):.1f}s"
            f" (predicted output {c.get('predicted_duration_s', 0.0):.1f}s)\n"
            f"  heuristic (advisory): {score_str}\n"
            f'  transcript: "{transcript}"'
        )
    return "\n".join(lines)


def _clip_middle(text: str, cap: int) -> str:
    """Cap `text` at `cap` chars by eliding the MIDDLE — the opener and the
    ending carry the hook/payoff signal and must survive verbatim."""
    if len(text) <= cap:
        return text
    half = (cap - 3) // 2
    return f"{text[:half]} … {text[-half:]}"


def _parse_response(raw: str) -> Optional[list[dict]]:
    """Extract the `selection` array. Strips markdown fences if the LLM added
    any; accepts the legacy `ranking` key as an alias."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as e:
        logger.warning(f"[ReelsSelect] JSON parse failed: {e}; raw={text[:200]!r}")
        return None
    selection = obj.get("selection")
    if not isinstance(selection, list):
        selection = obj.get("ranking")  # tolerate models trained on the old shape
    if not isinstance(selection, list):
        logger.warning(
            f"[ReelsSelect] missing 'selection' array; got {type(selection).__name__}"
        )
        return None
    return selection
