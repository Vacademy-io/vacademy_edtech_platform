"""
Intent Router — runs first in the pipeline, reads the user's prompt + attached
resources, and emits a structured RoutingPlan (which tools to fire, which
behavioral flags to set, plus a one-paragraph human explanation).

The plan is persisted to run_dir/routing_plan.json and exposed to the FE as
toggles. User overrides win over router decisions; failures are non-fatal —
on any error the safe default RoutingPlan is returned so the rest of the
pipeline behaves like it does today.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
from .llm_router import post_chat

from ..constants.model_defaults import NON_GLM_FALLBACK
from ..constants.models import get_use_case_model_chain
from ..schemas.routing import (
    RoutingConfig,
    RoutingPlan,
    ToolDecision,
)

logger = logging.getLogger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# The whole routing call, both legs. The primary (GLM) leg gets at most
# _PRIMARY_TIMEOUT_S so a slow or failed answer still leaves the one retry on
# NON_GLM_FALLBACK room to finish inside the budget.
_HTTP_TIMEOUT_S = 20.0
_PRIMARY_TIMEOUT_S = 13.0
# GLM's reasoning tokens count against max_tokens: the JSON plan is ~400
# tokens, the rest is thinking headroom at low effort. Only generated tokens
# are paid for.
_MAX_TOKENS = 2500
# Sent explicitly: on the OpenRouter failover leg a payload with no reasoning
# object runs GLM at its heavy default and ends at the length limit, empty.
_REASONING = {"effort": "low"}

_SYSTEM_PROMPT = """You are an Intent Router for an AI video generation pipeline.

Read the user's prompt + attached resources, and return a JSON plan describing:
  - which tools to invoke (scrape_url, web_search)
  - how the rest of the pipeline should behave (config flags)
  - a one-paragraph human explanation users will see in the UI

OUTPUT SHAPE (strict JSON):
{
  "tools": [
    {
      "name": "scrape_url" | "web_search",
      "enabled": true | false,
      "params": { ... },              // see below
      "reason": "<short justification — 1 sentence>"
    }
  ],
  "config": {
    "mute_tts_on_source_clips": bool, // mute TTS narration during source clips
    "source_clip_priority": "low" | "medium" | "high", // how strongly Director should favor SOURCE_CLIP
    "infographic_mode": "side" | "overlay" | "sequential", // how source clips are framed
    "narration_fit_to_source": bool,  // narration must fit within sum of source video durations
    "coverage_min_pct": 0..100        // 0 = no check; e.g. 50 = warn if SOURCE_CLIP < 50% of source
  },
  "explanation": "<one short paragraph the user sees>"
}

TOOL PARAMS:
  - scrape_url: {"url": "<the URL to scrape>"} — only the FIRST URL detected
  - web_search: {"query": "<concise focused query you derive from the prompt>"}

DECISION RUBRIC:
1. INPUT VIDEOS PROVIDED + prompt says "cover the demo" / "just the videos" / "do not add extra parts" / "trim based on need":
   → DISABLE scrape_url AND web_search (videos cover the topic)
   → config: mute_tts_on_source_clips=true, source_clip_priority="high", narration_fit_to_source=true, coverage_min_pct=50
   → If prompt also says "in the same screen" / "on top of the video" / "infographics along the video": infographic_mode="overlay"
   → Otherwise infographic_mode="side"

2. PROMPT HAS A URL + NO INPUT VIDEOS:
   → ENABLE scrape_url with that URL
   → If prompt also asks for broader context (e.g. "compare X with others"): also enable web_search
   → config: source_clip_priority="medium", infographic_mode="side", narration_fit_to_source=false

3. PROMPT ASKS FOR CURRENT/FACTUAL INFO (keywords: "latest", "research", "what is", "compare", "recent", "news", "today's", "current") + NO URL/files/videos:
   → ENABLE web_search; query should be a concise focused search query derived from the prompt
   → DISABLE scrape_url
   → config: source_clip_priority="medium", infographic_mode="side"

4. INPUT VIDEOS + RICH REFERENCE FILES already cover the topic:
   → DISABLE web_search (we have grounding)
   → scrape_url decision follows rule 1 logic

5. NO URL, NO VIDEOS, NO FILES, NO research-y phrasing (basic explainer / how-to / story):
   → DISABLE both tools
   → config: defaults (medium priority, side mode)

ALWAYS:
  - Set source=router (default; the merge step sets source=user when overrides apply)
  - Reason field must be a SHORT, SPECIFIC justification a user can verify ("you have 2 demo videos so the pipeline focuses on them")
  - If a tool is DISABLED, you MUST still include it in the tools[] list with enabled=false and a reason
  - Explanation should be 1-2 sentences in friendly second-person ("I'll use your demos as the main footage and skip the website capture so the video stays focused.")

EXAMPLE — User has 2 input videos + URL https://vacademy.io + prompt about covering the demo:
{
  "tools": [
    {"name": "scrape_url", "enabled": false, "params": {"url": "https://vacademy.io"},
     "reason": "You have 2 demo videos covering the content; skipping the website capture keeps the focus on your footage."},
    {"name": "web_search", "enabled": false, "params": {},
     "reason": "Your demo videos provide the grounding; no extra search needed."}
  ],
  "config": {
    "mute_tts_on_source_clips": true,
    "source_clip_priority": "high",
    "infographic_mode": "overlay",
    "narration_fit_to_source": true,
    "coverage_min_pct": 50
  },
  "explanation": "I'll use your 2 demo videos as the primary footage with infographic overlays floating on top, mute TTS during clips so you hear the original demo audio, and keep the narration within the demo length."
}

EXAMPLE — Prompt "create a 90s video about latest Mars rover findings":
{
  "tools": [
    {"name": "scrape_url", "enabled": false, "params": {},
     "reason": "No URL provided in the prompt."},
    {"name": "web_search", "enabled": true, "params": {"query": "latest NASA Mars rover findings 2026"},
     "reason": "Prompt asks for current findings — searching the web for up-to-date sources."}
  ],
  "config": {
    "mute_tts_on_source_clips": false,
    "source_clip_priority": "medium",
    "infographic_mode": "side",
    "narration_fit_to_source": false,
    "coverage_min_pct": 0
  },
  "explanation": "I'll search the web for the latest Mars rover findings so the script is grounded in current sources."
}

Return ONLY the JSON object. No prose, no markdown fences.
"""


class IntentRouterService:
    """Single LLM call → structured RoutingPlan."""

    def __init__(self, openrouter_key: str, model: Optional[str] = None):
        self._openrouter_key = openrouter_key
        # None = the ai_model_defaults 'video' default, read per call.
        self._model = model

    async def route(
        self,
        prompt: str,
        *,
        input_video_count: int = 0,
        attached_file_count: int = 0,
        urls_in_prompt: Optional[List[str]] = None,
        orientation: str = "landscape",
        content_type: str = "VIDEO",
    ) -> RoutingPlan:
        """Return a RoutingPlan. On any failure: return safe defaults."""
        urls_in_prompt = urls_in_prompt or []
        if not self._openrouter_key:
            logger.warning("[IntentRouter] No OpenRouter key — returning default plan")
            return _default_plan(urls_in_prompt, input_video_count)

        user_msg = (
            f"USER PROMPT:\n{prompt}\n\n"
            f"ATTACHED RESOURCES:\n"
            f"  - input_videos: {input_video_count}\n"
            f"  - reference_files: {attached_file_count}\n"
            f"  - urls_in_prompt: {urls_in_prompt}\n"
            f"  - orientation: {orientation}\n"
            f"  - content_type: {content_type}\n"
        )
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ]

        # Primary model, then ONE retry on the non-GLM fallback when the first
        # leg times out, errors, or returns content that is not a valid plan.
        chain = get_use_case_model_chain("video", self._model)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + _HTTP_TIMEOUT_S
        plan: Optional[RoutingPlan] = None
        for i, model in enumerate(chain):
            budget = deadline - loop.time()
            if i == 0 and len(chain) > 1:
                budget = min(budget, _PRIMARY_TIMEOUT_S)
            if budget <= 0:
                break
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.1,
                "max_tokens": _MAX_TOKENS,
                "response_format": {"type": "json_object"},
            }
            if model != NON_GLM_FALLBACK:
                # The Gemini Flash fallback leg sends none, as before: an
                # effort would turn its thinking on and slow the retry.
                payload["reasoning"] = dict(_REASONING)
            try:
                content = await asyncio.wait_for(self._post(payload, budget), timeout=budget)
            except Exception as e:
                logger.warning(f"[IntentRouter] LLM call on {model} failed: {e!r}")
                continue
            plan = _parse_plan(content)
            if plan is not None:
                if i > 0:
                    logger.info(f"[IntentRouter] Plan came from fallback model {model}")
                break
            logger.warning(f"[IntentRouter] Parse failed on {model}; raw={content[:300]!r}")

        if plan is None:
            logger.warning("[IntentRouter] No usable plan from %s (using defaults)", chain)
            return _default_plan(urls_in_prompt, input_video_count)

        # Backstop: ensure both known tools are represented in the plan
        plan = _ensure_tool_present(plan, "scrape_url", urls_in_prompt)
        plan = _ensure_tool_present(plan, "web_search", urls_in_prompt)
        logger.info(f"[IntentRouter] Plan: {plan.explanation}")
        return plan

    async def _post(self, payload: Dict[str, Any], timeout_s: float) -> str:
        """One chat completion → the message content (raises on any failure)."""
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await post_chat(client, payload, self._openrouter_key)
            resp.raise_for_status()
            data = resp.json()
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError(
                f"empty content (finish={data['choices'][0].get('finish_reason')})"
            )
        return content


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_plan(content: str) -> Optional[RoutingPlan]:
    """The model's JSON → RoutingPlan, or None when it does not parse."""
    # Tolerate stray markdown fences just in case
    content_clean = content.strip()
    if content_clean.startswith("```"):
        content_clean = content_clean.strip("`")
        if content_clean.lower().startswith("json"):
            content_clean = content_clean[4:].strip()
    try:
        return RoutingPlan.model_validate(json.loads(content_clean))
    except Exception:
        return None


def _default_plan(urls_in_prompt: List[str], input_video_count: int) -> RoutingPlan:
    """Safe default when the router LLM is unavailable or failed.

    Mirrors the pre-router hardcoded behavior: scrape if there's a URL and
    no input videos; never search; medium priority; side layout.
    """
    tools: List[ToolDecision] = []
    if urls_in_prompt and input_video_count == 0:
        tools.append(ToolDecision(
            name="scrape_url",
            enabled=True,
            params={"url": urls_in_prompt[0]},
            reason="Default: URL detected and no input videos.",
        ))
    else:
        tools.append(ToolDecision(
            name="scrape_url",
            enabled=False,
            params={"url": urls_in_prompt[0]} if urls_in_prompt else {},
            reason="Default: input videos provided, skipping URL capture." if input_video_count else "Default: no URL detected.",
        ))
    tools.append(ToolDecision(
        name="web_search",
        enabled=False,
        params={},
        reason="Default: web search not enabled without router LLM.",
    ))
    config = RoutingConfig(
        mute_tts_on_source_clips=bool(input_video_count),
        source_clip_priority="medium",
        infographic_mode="side",
        narration_fit_to_source=False,
        coverage_min_pct=0,
    )
    return RoutingPlan(
        tools=tools,
        config=config,
        explanation="Using default routing (router unavailable).",
    )


def _ensure_tool_present(plan: RoutingPlan, name: str, urls_in_prompt: List[str]) -> RoutingPlan:
    """If the LLM omitted a tool, add it as disabled so FE always sees both toggles."""
    if any(t.name == name for t in plan.tools):
        return plan
    if name == "scrape_url":
        params = {"url": urls_in_prompt[0]} if urls_in_prompt else {}
        plan.tools.append(ToolDecision(
            name="scrape_url", enabled=False, params=params,
            reason="Not selected by router.",
        ))
    elif name == "web_search":
        plan.tools.append(ToolDecision(
            name="web_search", enabled=False, params={},
            reason="Not selected by router.",
        ))
    return plan


def apply_overrides(plan: RoutingPlan, overrides: Optional[Dict[str, Any]]) -> RoutingPlan:
    """Sparse override merge.

    Shape:
      {
        "tools": {"scrape_url": true, "web_search": false},  // bool only flips enabled
        "config": {"mute_tts_on_source_clips": true, ...}
      }

    Overridden ToolDecision.source becomes 'user'. Config overrides replace
    individual fields only; unset fields keep router's choice.
    """
    if not overrides:
        return plan

    # Tool overrides — only `enabled` is overridable; reason gets a marker
    tool_overrides = (overrides.get("tools") or {}) if isinstance(overrides, dict) else {}
    if isinstance(tool_overrides, dict):
        for tool in plan.tools:
            if tool.name in tool_overrides:
                new_enabled = bool(tool_overrides[tool.name])
                if new_enabled != tool.enabled:
                    tool.enabled = new_enabled
                    tool.source = "user"
                    tool.reason = f"User override → {'enabled' if new_enabled else 'disabled'}."

    # Config overrides — replace fields one by one
    cfg_overrides = (overrides.get("config") or {}) if isinstance(overrides, dict) else {}
    if isinstance(cfg_overrides, dict) and cfg_overrides:
        cfg_dict = plan.config.model_dump()
        for key, val in cfg_overrides.items():
            if key in cfg_dict:
                cfg_dict[key] = val
        try:
            plan.config = RoutingConfig.model_validate(cfg_dict)
        except Exception as e:
            logger.warning(f"[IntentRouter] Bad config override {cfg_overrides}: {e}")

    return plan


# ---------------------------------------------------------------------------
# Visual preferences — free-text scanner (deterministic, no LLM).
#
# Slice A of user-driven visual treatment steering. Scans the user's prompt
# for phrases that imply a per-family bias (5 families) or text-density
# preference (4 levels) and returns a partial dict matching the
# VisualPreferences schema. Unmentioned families come back as None so the
# caller can merge with structured slider input (free-text wins on overlap).
# ---------------------------------------------------------------------------

# Family patterns. Each match contributes "high" by default; if the 24-char
# window before the match contains a negation (no/not/less/without/skip/avoid/
# fewer/minimal/minimize) the polarity flips to "no" instead.
_FAMILY_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("stock_video", re.compile(
        r"\b(?:stock(?:\s+(?:video|footage|clips?))?|real\s+footage|"
        r"live\s+video|actual\s+footage|use\s+videos?)\b",
        re.IGNORECASE,
    )),
    ("ai_imagery", re.compile(
        r"\b(?:ai[\s-]?generated(?:\s+(?:images?|photos?|art|imagery))?|"
        r"generated\s+(?:images?|photos?|art|imagery)|ai\s+images?)\b",
        re.IGNORECASE,
    )),
    ("svg_illustrated", re.compile(
        r"\b(?:infographics?|illustrated|illustrations?|svgs?|diagrams?|"
        r"hand[\s-]?drawn|sketch(?:ed|es)?)\b",
        re.IGNORECASE,
    )),
    ("motion_graphics", re.compile(
        r"\b(?:motion[\s-]?graphics?|animated\s+charts?|kinetic|"
        r"animated\s+typography|chart\s+animations?|process\s+animations?)\b",
        re.IGNORECASE,
    )),
    ("app_ui_mockup", re.compile(
        r"\b(?:app\s+(?:ui|interface|mockups?|screens?)|"
        r"mobile\s+app|web\s+app|screen\s+recording|"
        r"(?:interface|ui|device)\s+mockups?|"
        r"dashboard\s+(?:mockup|screenshot)|product\s+ui)\b",
        re.IGNORECASE,
    )),
    # Phase 7: AI video (fal.ai Veo). Phrases that indicate the user wants
    # generative video clips: "AI video", "AI-generated video", "Veo",
    # "generative video", "generated clips", "ai video clips". Negation
    # window handles "less AI video", "no generated clips", etc.
    ("ai_video", re.compile(
        r"\b(?:ai[\s-]?(?:generated[\s-]?)?(?:video|clip|footage)s?|"
        r"veo|generative\s+video|video\s+synthesis|generated\s+clips?|"
        r"ai\s+motion\s+(?:video|clips?))\b",
        re.IGNORECASE,
    )),
]

# Negation tokens that flip a family match from "high" to "no". Anchored to
# end-of-string so we only match when the negation is RIGHT before the
# keyword (windowed lookbehind is faked by slicing 24 chars before the match
# and running this pattern on the slice).
_NEGATION_PATTERN = re.compile(
    # Direct negations, plus the COMPARATIVE forms that name the disfavoured
    # side. "Prefer annotated diagrams over stock footage" is a rejection of
    # stock, but only the word immediately before the family term is examined,
    # so "over" has to count as a negation or the sentence reads as a request
    # FOR stock footage — which is how a brief that banned b-roll resolved to
    # stock_video: high.
    # Not anchored to the word immediately before the term: a negation is
    # routinely separated from it by an adjective ("no smiling-doctor stock",
    # "no generic hospital b-roll"), and anchoring made those read as requests
    # FOR the thing being banned.
    r"\b(?:no|not|less|without|skip|avoid|fewer|minim(?:al|ize|um)"
    r"|over|instead\s+of|rather\s+than|in\s+place\s+of|as\s+opposed\s+to)\b",
    re.IGNORECASE,
)


def _scan_family_preference(text: str, pattern: "re.Pattern[str]") -> Optional[str]:
    """Return 'high', 'no', or None for one family.

    'high' = pattern matched at least once without a negation in the 24-char
             window before the match.
    'no'   = every match was preceded by a negation (and at least one matched).
    None   = pattern never matched.

    If both polarities appear (e.g. "more SVG but less stock"), 'high' wins —
    the user expressed positive interest at least once, and the negation
    likely refers to a different family.
    """
    found_high = False
    found_no = False
    for m in pattern.finditer(text):
        window_start = max(0, m.start() - 24)
        prefix = text[window_start:m.start()]
        if _NEGATION_PATTERN.search(prefix):
            found_no = True
        else:
            found_high = True
    if found_high:
        return "high"
    if found_no:
        return "no"
    return None


# Text-density patterns. Explicit phrase list per level — the generic
# negation logic does NOT apply because phrases like "no text" are themselves
# the keyword (would otherwise double-process). First-matching-level wins.
_TEXT_DENSITY_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("minimal", re.compile(
        r"\b(?:no\s+text|without\s+text|zero\s+text|text[\s-]?free|"
        r"just\s+visuals|let\s+(?:the\s+)?visuals\s+speak|"
        r"visuals\s+only)\b",
        re.IGNORECASE,
    )),
    ("low", re.compile(
        r"\b(?:less\s+text|minimal[\s-]text|minimize\s+text|"
        r"fewer\s+words(?:\s+on\s+screen)?|reduce\s+text|"
        r"too\s+much\s+text|cut\s+down\s+(?:on\s+)?text)\b",
        re.IGNORECASE,
    )),
    ("rich", re.compile(
        r"\b(?:lots?\s+of\s+text|rich\s+text|more\s+text\s+on\s+screen|"
        r"title\s+cards\s+everywhere|text[\s-]?heavy)\b",
        re.IGNORECASE,
    )),
]


def extract_visual_preferences_from_text(prompt: str) -> Dict[str, Optional[str]]:
    """Scan prompt for visual treatment hints. Pure, deterministic, no LLM.

    Returns a dict with the same keys as VisualPreferences. Keys with no
    detected phrase map to None (the caller's structured slider wins on
    those keys; free-text wins on the keys this function fills in).
    """
    out: Dict[str, Optional[str]] = {
        "stock_video": None,
        "ai_imagery": None,
        "svg_illustrated": None,
        "motion_graphics": None,
        "app_ui_mockup": None,
        "ai_video": None,
        "text_density": None,
    }
    if not prompt:
        return out
    for family, pat in _FAMILY_PATTERNS:
        out[family] = _scan_family_preference(prompt, pat)
    for level, pat in _TEXT_DENSITY_PATTERNS:
        if pat.search(prompt):
            out["text_density"] = level
            break
    return out


def merge_visual_preferences(
    structured: Optional[Dict[str, Optional[str]]],
    from_text: Dict[str, Optional[str]],
) -> Dict[str, Optional[str]]:
    """Merge UI sliders with the free-text scan. Free-text wins on overlap.

    Keys present (non-None) in ``from_text`` overwrite the same key in
    ``structured``; keys absent (None) in ``from_text`` keep the structured
    value. The result has every VisualPreferences key set to either a value
    or None (no missing keys).
    """
    keys = (
        "stock_video", "ai_imagery", "svg_illustrated",
        "motion_graphics", "app_ui_mockup", "ai_video", "text_density",
    )
    base = dict(structured or {})
    merged: Dict[str, Optional[str]] = {k: base.get(k) for k in keys}
    for k in keys:
        v = from_text.get(k)
        if v is not None:
            merged[k] = v
    return merged
