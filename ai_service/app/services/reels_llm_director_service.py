"""
Phase 2c — LLM-driven Director.

Generates a list of `OverlaySpec`s for a reel: hook text, mid-clip micro-hook,
loop-back ending, plus optional emphasis overlays tied to specific spoken
phrases. Captions and the base SOURCE_CLIP entry stay deterministic (they're
tied to `word_importance` + the speaker_clip MP4); this module only produces
the **storytelling overlay track** that the deterministic director was
hand-coding before.

Falls back gracefully:
  * No OPENROUTER_API_KEY → returns empty list, director uses deterministic
    hook overlay (the Phase-1 behavior).
  * LLM transport / parsing / validation failure → returns empty list (same
    fallback).
  * Spec validation strips invalid entries individually before returning, so
    one bad overlay doesn't nuke the rest.

The director (`reels_director_service.py`) is responsible for translating each
`OverlaySpec` into a `_Shot` with HTML appropriate to its `type` and
`color_intent`. That keeps the LLM focused on *what to say where* and lets the
deterministic side own *how it looks*.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from .use_case_chat import chat_json, models_for

from ..config import get_settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Disable via env if the LLM is misbehaving — falls back to the deterministic
# hook overlay, captions still ship as normal.
_DISABLE_ENV = "REELS_LLM_DIRECTOR_DISABLED"

_LLM_TIMEOUT_S = 30.0
# The model comes from the 'reels_director' use case (ai_model_defaults, set in
# the super-admin portal; GLM by default) and the call walks its fallback chain
# through llm_router.chat_with_chain. REELS_DIRECTOR_LLM_MODEL, when set, is
# tried first (emergency override). Reasoning effort is pinned low: the call
# runs inside a render with a 30 s per-request budget.
_USE_CASE = "reels_director"
_LLM_MODEL_ENV = "REELS_DIRECTOR_LLM_MODEL"
_REASONING_EFFORT = "low"

# Spec validation bounds — matches research §12.2/§12.3 rules.
HOOK_MAX_END_S = 2.6              # hook is the 0..~2.5s window
MIN_OVERLAY_DURATION_S = 0.5      # too short = unreadable
# Tightened 4.0 → 2.5 (Phase 2e cadence fix). A 4s overlay sits on
# screen long after the speaker has moved past the moment — research
# §12.3's "visual change every 2-4s" requires actual change, not static
# text. 2.5s lets overlays punctuate without dominating.
MAX_OVERLAY_DURATION_S = 2.5
MAX_OVERLAY_WORDS = 6             # short-form ceiling for readability
MAX_OVERLAY_CHARS = 60            # belt-and-suspenders against runaway text
# Bumped 2 → 4 (Phase 2e cadence). With a 25s reel, hook+micro_hook+
# loop_back = 3 visual events. Adding 4 emphasis overlays gets us to ~7
# events, much closer to the research-recommended 2-4s visual-change
# cadence. The audited 2026-05-13 reel had only 1 emphasis — see the
# `_synth_emphasis` fallback below for the deterministic filler.
MAX_EMPHASIS_OVERLAYS = 4
# Below-this emphasis count triggers the deterministic synthesizer in
# `_fill_missing_required`. Two is the visual-floor: with 0 or 1
# emphasis overlays the mid-clip stretch between micro_hook and
# loop_back goes 5-10s with no visual change, which research §12.3
# flags as a retention killer for podcast-style content.
MIN_EMPHASIS_TARGET = 2

# Verbal-CTA opener list — overlays that telegraph "please follow me" kill
# the loop-back effect (research §12.2). Reject overlays whose text matches
# any of these substrings (case-insensitive).
CTA_KILL_PHRASES = (
    "follow ", "subscribe", "like this", "like and ", "smash that",
    "drop a comment", "let me know", "share this", "tag someone",
    "link in bio", "check the link", "hit follow",
)

# Text-only overlay types — these emit caption-style text positioned over
# the speaker. Use the existing OverlaySpec.text field.
_TEXT_OVERLAY_TYPES = {"hook", "micro_hook", "loop_back", "emphasis"}
# Media overlay types (Phase 2c.5 Slice 1) — these emit a Pexels-fetched
# video or image positioned per spec.position. Use OverlaySpec.concept.
_MEDIA_OVERLAY_TYPES = {"broll_video", "broll_image"}
# Stat / motion-graphic overlay types (Phase 2c.5 Slice 2) — HTML/CSS only,
# no network. `animated_stat` uses `value` + optional `subtitle`;
# `motion_graphic` uses `graphic_kind` + `bars`.
_STAT_OVERLAY_TYPES = {"animated_stat", "motion_graphic"}
# Combined "non-text visual" set — these share the cardinality cap (max 3
# total across all four types) and the hook/loop-back protection windows.
_NON_TEXT_VISUAL_TYPES = _MEDIA_OVERLAY_TYPES | _STAT_OVERLAY_TYPES
# Union — keep tight; FE/Director needs to know how to render each.
_OVERLAY_TYPES = _TEXT_OVERLAY_TYPES | _NON_TEXT_VISUAL_TYPES
# Allowed color intents — match the caption palette so the look stays cohesive.
# Media types ignore this field but we accept it for schema uniformity.
_COLOR_INTENTS = {"neutral", "important", "definition", "warning"}
# Allowed positions for media overlays.
#   full         — replaces the speaker for the spec's duration
#   corner       — top-right PiP-style overlay; speaker still visible
#   lower_third  — bottom strip; speaker still visible (top 70%)
_MEDIA_POSITIONS = {"full", "corner", "lower_third"}

# Non-text-visual cardinality + timing constraints. Applies to ALL four
# types (broll_video, broll_image, animated_stat, motion_graphic). The
# prompt references these so the LLM stays in bounds; validator enforces.
MAX_MEDIA_OVERLAYS = 3
MIN_MEDIA_DURATION_S = 1.2
MAX_MEDIA_DURATION_S = 3.5
# Concept length cap mirrors what Pexels search handles well — short
# phrases hit the relevance index better than long descriptions.
MAX_CONCEPT_LEN = 40
MIN_CONCEPT_WORDS = 1
MAX_CONCEPT_WORDS = 4

# Background-concept caps (Phase 2c.8). This is the WHOLE-REEL b-roll
# query — used by layouts like `stacked_speaker_with_broll` /
# `pip_corner_speaker` when the user didn't supply a `background_video_url`.
# A 2-5 word phrase ("podcast studio interview", "data analytics dashboard")
# returns far more relevant Pexels footage than the heuristic's
# single-word pick. Wider word band than per-phrase concepts because the
# background needs to capture the REEL's overall mood, not a moment.
MIN_BG_CONCEPT_WORDS = 2
MAX_BG_CONCEPT_WORDS = 5
MAX_BG_CONCEPT_LEN = 50

# Background-concepts SEQUENCE caps (Phase 2c.9). The renderer fetches one
# Pexels clip per concept and stitches them via ffmpeg concat into the
# bottom-half bgv track, so the bottom CHANGES as the reel progresses
# instead of looping one static clip for 50s. 2 is the floor (single
# clip = use the legacy single-concept path); 5 is the ceiling (each
# clip ~5-10s of a 25-50s reel; more would feel choppy and explode the
# parallel-fetch cost on Pexels).
MIN_BG_CONCEPTS = 2
MAX_BG_CONCEPTS = 5

# animated_stat caps. `value` is the BIG number/word — short enough to
# render at ~14vw without wrapping. `subtitle` is one supporting line.
MAX_STAT_VALUE_LEN = 12
MAX_STAT_SUBTITLE_LEN = 32

# motion_graphic caps — per-kind. Each `graphic_kind` has its own
# bar-count band, value-shape rule, and label-length cap because the
# visual treatment differs (3 bars max for bar_chart vs 5 points max for
# line_chart vs 2 cards exactly for comparison_icons). The director-side
# renderer (`_build_motion_graphic_html`) MUST have a matching branch
# per kind — add new ones to BOTH places.
_GRAPHIC_KIND_SPECS: dict[str, dict] = {
    "bar_chart":        {"min_bars": 2, "max_bars": 3, "values_required": True,  "max_label_len": 14},
    "line_chart":       {"min_bars": 2, "max_bars": 5, "values_required": True,  "max_label_len": 8},
    "pie_chart":        {"min_bars": 2, "max_bars": 4, "values_required": True,  "max_label_len": 14},
    "comparison_icons": {"min_bars": 2, "max_bars": 2, "values_required": False, "max_label_len": 20},
}
_SUPPORTED_GRAPHIC_KINDS = set(_GRAPHIC_KIND_SPECS.keys())


# ---------------------------------------------------------------------------
# Spec
# ---------------------------------------------------------------------------

@dataclass
class OverlaySpec:
    """One overlay the director will turn into a `_Shot` entry.

    All times are in REEL TIMELINE seconds (post-trim, post-atempo) — the
    LLM is fed remapped word timestamps so it operates entirely in reel
    coordinates and never has to think about the source video's clock.

    Four flavors share this struct (only the type-relevant fields are
    consulted by the renderer; the rest stay at defaults):

      * **Text overlays** (`hook` / `micro_hook` / `loop_back` / `emphasis`)
        — use `text` for the visible caption-style copy.

      * **Media overlays** (`broll_video` / `broll_image`, Phase 2c.5
        Slice 1) — use `concept` as the Pexels search query.

      * **Stat overlays** (`animated_stat`, Phase 2c.5 Slice 2) — use
        `value` for the headline number/word and `subtitle` for the
        supporting copy.

      * **Motion graphics** (`motion_graphic`, Phase 2c.5 Slice 2/3) —
        use `graphic_kind` to pick the chart variant (bar_chart /
        line_chart / pie_chart / comparison_icons) and `bars` for the
        data points. Renderer in `reels_director_service` branches by
        kind.

    Validation enforces the type-specific required fields; the resolver
    (`reels_director_service`) inspects `type` to choose HTML strategy.
    """
    type: str
    t_start: float
    t_end: float
    # Universally applicable
    position: str = "full"
    color_intent: str = "neutral"
    # Text overlays
    text: str = ""
    # Media overlays (broll_video / broll_image)
    concept: str = ""
    # animated_stat
    value: str = ""             # headline (e.g. "47%", "2x", "14 YEARS")
    subtitle: str = ""          # supporting copy (e.g. "of users churn")
    # motion_graphic
    graphic_kind: str = ""      # one of _SUPPORTED_GRAPHIC_KINDS
    # Reused across all graphic_kinds as the generic "label + value" data
    # array — bars (bar_chart), points (line_chart), wedges (pie_chart),
    # cards (comparison_icons). Field name kept as `bars` to avoid churn.
    bars: list[dict] = field(default_factory=list)  # [{label: str, value: float}, …]

    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "t_start": round(self.t_start, 3),
            "t_end": round(self.t_end, 3),
            "position": self.position,
            "color_intent": self.color_intent,
            "text": self.text,
            "concept": self.concept,
            "value": self.value,
            "subtitle": self.subtitle,
            "graphic_kind": self.graphic_kind,
            "bars": self.bars,
        }


# ---------------------------------------------------------------------------
# Prompt
# ---------------------------------------------------------------------------

REEL_DIRECTOR_SYSTEM_PROMPT = """You direct overlays for short-form reels built from interview footage.

The speaker's voice IS the narration — you do NOT write the script. Your job is to layer two kinds of overlays on top of the speaker:

  A. **TEXT overlays** — bold caption-style copy that reinforces structure (hook / mid-beat / loop) or punctuates a specific phrase.
  B. **MEDIA overlays** — short b-roll cuts (Pexels stock video or photo) that visualize concrete things the speaker mentions.

**You MUST produce all three of these TEXT overlays, in this order:**
  1. **HOOK** — stops the scroll in the first 2.5 seconds.
  2. **MICRO_HOOK** — re-engages attention near the middle.
  3. **LOOP_BACK** — echoes the hook in the final ~1 second so re-watches feel intentional.

You MUST emit AT LEAST 2 **emphasis** text overlays tied to specific spoken phrases (up to 4). Emphasis overlays are the workhorses of visual cadence — research §12.3 demands a visual change every 2-4 seconds, and hook+micro_hook+loop_back only cover 3 moments. Without emphasis overlays the middle stretch goes 5-10s with no visual change, which is a documented retention killer for podcast / lecture content. Aim for one every 6-8s of reel time. Reels with fewer than 2 emphasis overlays look sparse.

You may include up to 3 **non-text visual** overlays total — across all four kinds combined (broll_video, broll_image, animated_stat, motion_graphic). These are **selective, not constant**. Many reels need ZERO visual overlays (emotional monologue, abstract reflection). Prefer fewer + better-aimed picks over carpet-bombing.

## When to use which visual type

  * **broll_video** — speaker mentions something with implied motion: a place, an activity, a scene, people doing things. ("the team was working", "in San Francisco", "Beatles in concert"). Pexels returns a 5-15s clip we'll loop / cut to fit.
  * **broll_image** — speaker mentions something iconic + static: logos, products, geographic markers, named entities. ("at Apple", "Mount Everest", "the constitution"). A still photo is cleaner than a video clip with implied motion that doesn't exist.
  * **animated_stat** — speaker drops a specific number, percentage, or short stat-phrase that lifts when displayed prominently. ("47% of users churn" → value="47%", subtitle="of users churn". "I worked there 14 years" → value="14 YEARS"). Use when the SPECIFIC number is the punchline. Don't use for vague magnitudes ("a lot", "way more").
  * **motion_graphic** — speaker compares, trends, or partitions data that benefits from a visual chart. Pick `graphic_kind` to match the SHAPE of the claim:
      * `bar_chart` (2-3 bars, numeric) — direct value comparison. ("Sales grew from 100 to 500" → bars=[{label:"Before",value:100},{label:"After",value:500}]).
      * `line_chart` (2-5 points, numeric) — trend over a sequence. Use when the SHAPE of the curve (steady growth, hockey stick, dip-and-recover) is the punchline. ("Revenue went 1, 2, 5, 12 million across four years" → bars=[{label:"Y1",value:1},{label:"Y2",value:2},{label:"Y3",value:5},{label:"Y4",value:12}]).
      * `pie_chart` (2-4 wedges, numeric) — proportions of a whole. Values are auto-normalized to total. ("60% churn in month 1" → bars=[{label:"Churned",value:60},{label:"Retained",value:40}]).
      * `comparison_icons` (exactly 2, values OPTIONAL) — qualitative side-by-side. Use when the contrast IS the point and exact numbers don't apply. ("Junk food vs whole food" → bars=[{label:"Junk food"},{label:"Whole food"}]).
    Use motion_graphic when the claim's STRUCTURE (comparison / trend / proportion / contrast) is the lift. For a single big number on its own, use animated_stat instead.
  * **NO visual** when the speaker:
      * makes an emotional / personal point — let their face carry it
      * delivers a contrarian sting or rhetorical pivot — abrupt cut undercuts the moment
      * pauses or vocalizes a beat (laughter, "uh", "I mean")
      * the concept is too abstract for stock footage / numbers to capture ("the truth is hard")

## Hard rules — output that breaks any of these will be silently discarded

  ### Text overlays
  * Each text is ≤6 words AND ≤60 characters.
  * HOOK must start at t_start ≤ 0.3 and end at t_end ≤ 2.6. It must reinforce or sharpen the speaker's opening claim — use a curiosity gap, a contrarian frame, or a concrete number. Avoid restating the speaker word-for-word.
  * MICRO_HOOK lands between 35% and 65% of the way through. 1-3s long. Should re-engage attention — a question, a stat, a "but here's the twist" beat. REQUIRED, not optional.
  * LOOP_BACK is in the final 1.5 seconds, ≥0.5s long. 2-4 words. Should rhyme visually/thematically with the hook. REQUIRED, not optional.
  * EMPHASIS (optional, max 2) is tied to a specific spoken phrase — t_start should align with the start of the phrase.
  * Text-overlay duration ≥0.5s and ≤4.0s.
  * NO verbal-CTA language: "follow me", "subscribe", "like this video", "drop a comment", "link in bio", "smash that like". Captions handle CTAs.
  * ALL CAPS for hook / micro_hook / loop_back. Mixed case OK for emphasis.
  * color_intent: "important" (yellow) for key claims/stats, "definition" (green) for definitions / aha moments, "warning" (red) for cautions / stakes, "neutral" (white) default.

  ### Non-text visual overlays (broll_video / broll_image / animated_stat / motion_graphic)
  Shared rules across all four:
  * Each visual overlay duration is ≥1.2s and ≤3.5s.
  * `position`: "full" (replaces speaker for that duration — the conventional cut), "corner" (top-right; speaker stays visible), "lower_third" (bottom strip; speaker stays in top 70%). Default to "full" unless the speaker's expression matters.
  * Visuals may NOT land in the first 2.6s of the reel (hook window — speaker owns the scroll-stop).
  * Visuals may NOT land in the final 1.5s of the reel (loop_back window — visual rhyme must read cleanly).
  * Visuals MAY overlap an emphasis text overlay — they layer (visual behind, text in front).
  * No more than 3 visuals TOTAL across all four kinds combined.

  Type-specific:
  * **broll_video / broll_image** — `concept` is 1-4 words, ≤40 characters — a short Pexels-friendly search query. NOT a sentence. ("team collaboration", "apple logo", "san francisco skyline", "concert crowd").
  * **animated_stat** — `value` is the headline number/word, ≤12 chars ("47%", "2×", "14 YEARS", "$10M"). `subtitle` is the supporting copy, ≤32 chars ("of users churn", "in revenue last quarter"). Use ALL CAPS for `value` if it includes letters. `color_intent` drives accent color: "important" (yellow) for KPIs and big numbers, "warning" (red) for negative stats, "definition" (green) for breakthroughs/wins, "neutral" (white) default.
  * **motion_graphic** — `graphic_kind` MUST be one of `bar_chart` | `line_chart` | `pie_chart` | `comparison_icons`. `bars` is a list of `{"label": "<short>", "value": <number>}` items. Counts: bar_chart 2-3 / line_chart 2-5 / pie_chart 2-4 / comparison_icons exactly 2. Values numeric for bar_chart, line_chart, pie_chart (required — drives height / line position / proportion). Values OPTIONAL for comparison_icons (omit when non-numeric). Label cap: 14 chars (8 for line_chart since labels sit tight under the curve; 20 for comparison_icons since each card has more horizontal room).

## Background concepts (used only by stacked / pip layouts)

For the "ambient glue" b-roll that fills the bottom half of `stacked_speaker_with_broll` or the background of `pip_corner_speaker`, emit a top-level `background_concepts` ARRAY of 2-5 Pexels search queries. The renderer fetches one clip per concept and stitches them into a sequence so the bottom half CHANGES as the speaker progresses through the reel — research §12.3 says static b-roll that loops for the whole reel feels visually flat.

  * 2-5 concepts per reel. Skip the field entirely if the speaker is abstract / introspective / philosophical — no usable scene to depict.
  * Each concept is 2-5 words, ≤50 characters. Think Pexels search bar.
  * Capture the SCENE / MOOD, not a specific phrase: "podcast studio interview", "data analytics dashboard", "san francisco skyline", "team meeting whiteboard", "tech startup office".
  * Order the concepts to match the speaker's narrative arc — early concepts for the opening, later concepts for the payoff. They play back in the order you emit them.
  * For backward compatibility you MAY also emit a single `background_concept` field (the legacy single-concept form). When both are present the array wins.

  Examples:
    * Tech podcast about AI: `["tech startup office", "data analytics dashboard", "ai robot futuristic"]`
    * Math history lecture: `["ancient sanskrit manuscript", "indian temple architecture", "modern mathematics blackboard"]`
    * Interview about teamwork: `["team meeting whiteboard", "diverse workplace collaboration", "celebration team success"]`

## If you can't produce a required text overlay

Omit it — a deterministic fallback will fill the slot. Don't pad with weak copy.

## Output

A single JSON object, no prose / markdown / commentary:
{
  "background_concepts": ["<concept 1>", "<concept 2>", "<concept 3>"],  // optional, 2-5 concepts
  "background_concept": "<2-5 word Pexels search, optional, legacy single-concept form>",
  "overlays": [
    // Text:
    {"type": "hook"|"micro_hook"|"loop_back"|"emphasis",
     "t_start": <float>, "t_end": <float>,
     "text": "<string>",
     "color_intent": "neutral"|"important"|"definition"|"warning"},
    // Media:
    {"type": "broll_video"|"broll_image",
     "t_start": <float>, "t_end": <float>,
     "concept": "<1-4 word search query>",
     "position": "full"|"corner"|"lower_third"},
    // Animated stat:
    {"type": "animated_stat",
     "t_start": <float>, "t_end": <float>,
     "value": "<headline ≤12 chars>",
     "subtitle": "<supporting copy ≤32 chars, optional>",
     "position": "full"|"corner"|"lower_third",
     "color_intent": "neutral"|"important"|"definition"|"warning"},
    // Motion graphic (pick graphic_kind to match the shape of the claim):
    {"type": "motion_graphic",
     "t_start": <float>, "t_end": <float>,
     "graphic_kind": "bar_chart"|"line_chart"|"pie_chart"|"comparison_icons",
     "bars": [{"label": "<short>", "value": <number, optional for comparison_icons>}, …],
     "position": "full"|"corner"|"lower_third",
     "color_intent": "neutral"|"important"|"definition"|"warning"}
  ]
}
"""


def _build_user_prompt(
    reel_duration_s: float,
    title: str,
    rationale: str,
    reel_time_transcript: str,
    layout: str = "full_speaker_with_overlays",
) -> str:
    # When the layout actually USES the bottom-half / background bgv,
    # promote `background_concepts` from optional to required — without
    # them, stacked / pip layouts get downgraded to full_speaker and the
    # user's layout choice is silently ignored. Production audit
    # 2026-05-21 reel-0b8d21629a4a hit this: stacked layout requested,
    # LLM emitted no bg_concepts, downgrade fired, FE got full_speaker.
    layout_hint = ""
    if layout in ("stacked_speaker_with_broll", "pip_corner_speaker"):
        layout_hint = (
            f"\nLAYOUT IS `{layout}` — this layout REQUIRES bgv. "
            "You MUST emit `background_concepts` with 2-5 entries. "
            "Without them the layout is downgraded to full-speaker and "
            "the user's choice is wasted. Even for abstract / philosophical "
            "content, pick scene-level concepts that evoke the mood "
            "(library shelves, candle flame, ocean waves, old manuscript) "
            "rather than skipping the field.\n"
        )
    return (
        f"Reel duration: {reel_duration_s:.2f}s.\n"
        f"Working title: {title}\n"
        f"Why this clip was picked: {rationale}\n"
        f"{layout_hint}\n"
        f"Reel-time transcript (seconds since reel start):\n{reel_time_transcript}\n\n"
        "Return the JSON object now."
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class LLMDirector:
    """One LLM call → list of OverlaySpec. Stateless; instantiate per render."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._api_key = self._settings.openrouter_api_key
        self._llm_url = self._settings.llm_base_url
        self._models = models_for(_USE_CASE, env=_LLM_MODEL_ENV)
        self._model = self._models[0]

    @property
    def enabled(self) -> bool:
        if os.getenv(_DISABLE_ENV, "").strip().lower() in ("1", "true", "yes"):
            return False
        return bool(self._api_key)

    async def generate_overlays(
        self,
        *,
        reel_duration_s: float,
        title: str,
        rationale: str,
        word_importance_reel_time: list[dict],
        layout: str = "full_speaker_with_overlays",
    ) -> tuple[list[OverlaySpec], Optional[str], Optional[list[str]]]:
        """Returns (overlays, optional single bg_concept, optional bg_concepts list).

        All derived from the SAME LLM call — no extra round-trip:
          * `overlays`: validated `OverlaySpec` list.
          * `bg_concept`: legacy single 2-5 word Pexels query (Phase 2c.8).
            Kept for backward compatibility with older candidates and
            with the LLM occasionally emitting the singular field.
          * `bg_concepts`: Phase 2c.9 — list of 2-5 Pexels queries that
            the director stitches into a SEQUENCE of clips for the
            stacked / pip layout bottom half. Caller prefers the sequence
            over the single when both are present.

        Returns `([], None, None)` on any failure — caller's path
        handles all fallbacks.

        `word_importance_reel_time` should already be remapped through
        the trim_map — the LLM operates in reel-timeline coordinates.
        """
        if not self.enabled:
            return [], None, None
        if reel_duration_s <= 1.0 or not word_importance_reel_time:
            return [], None, None

        transcript_block = _format_transcript_for_prompt(word_importance_reel_time)
        user = _build_user_prompt(
            reel_duration_s=reel_duration_s,
            title=title.strip() or "Watch this",
            rationale=rationale.strip() or "Strong engagement signals.",
            reel_time_transcript=transcript_block,
            layout=layout,
        )

        raw = await self._call_llm(user)
        if not raw:
            return [], None, None

        try:
            payload = _extract_json_object(raw)
        except ValueError as e:
            logger.warning(f"[LLMDirector] JSON parse failed: {e}; raw={raw[:300]!r}")
            return [], None, None

        candidates = payload.get("overlays")
        if not isinstance(candidates, list):
            logger.warning(f"[LLMDirector] no 'overlays' array in response: {raw[:300]!r}")
            return [], None, None

        valid: list[OverlaySpec] = []
        for entry in candidates:
            spec = _validate_overlay(entry, reel_duration_s)
            if spec is not None:
                valid.append(spec)

        valid = _enforce_structural_rules(valid, reel_duration_s)

        # Fill any missing structural overlays from word_importance. This
        # guarantees every reel has a hook + mid-clip beat regardless of
        # whether the LLM emitted them. We only do this when the LLM did
        # produce SOMETHING — if it returned an empty list, the director's
        # outer fallback path will install the Phase-1 single hook overlay.
        if valid:
            valid = _fill_missing_required(
                valid,
                reel_duration_s=reel_duration_s,
                title=title,
                word_importance_reel_time=word_importance_reel_time,
            )

        bg_concept = _validate_background_concept(payload.get("background_concept"))
        bg_concepts = _validate_background_concepts(payload.get("background_concepts"))
        return valid, bg_concept, bg_concepts

    async def _call_llm(self, user_prompt: str) -> Optional[str]:
        """One call through the model chain: response_format=json_object
        first, the chain again without it if a model rejected the parameter
        (400). Transport errors / 5xx / empty replies move to the next model.
        None when every model failed — the caller's fallback path takes over.
        """
        payload = {
            "messages": [
                {"role": "system", "content": REEL_DIRECTOR_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.5,    # a little spice for varied hook phrasing
            "max_tokens": 800,
        }
        result = await chat_json(
            payload,
            use_case=_USE_CASE,
            models=self._models,
            api_key=self._api_key,
            timeout=_LLM_TIMEOUT_S,
            label="LLMDirector",
            reasoning_effort=_REASONING_EFFORT,
        )
        return result.content if result is not None else None


# ---------------------------------------------------------------------------
# Helpers — transcript formatting, JSON extraction, validation
# ---------------------------------------------------------------------------

def _format_transcript_for_prompt(
    word_importance_reel_time: list[dict],
    max_chars: int = 6000,
) -> str:
    """Compact `[t_start-t_end] word` lines, capped so a long reel can't
    bloat the prompt past sensible token limits. 6000 chars ≈ 1500 tokens
    for English."""
    lines: list[str] = []
    used = 0
    for w in word_importance_reel_time:
        try:
            ts = float(w.get("t_start") or 0.0)
            te = float(w.get("t_end") or 0.0)
        except (TypeError, ValueError):
            continue
        txt = str(w.get("word") or "").strip()
        if not txt:
            continue
        line = f"[{ts:.2f}-{te:.2f}] {txt}"
        if used + len(line) + 1 > max_chars:
            lines.append("[…truncated…]")
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines)


# Strict JSON object extractor — tolerates code-fence wrappers + leading prose,
# but rejects anything that isn't a single top-level object.
_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```\s*$", re.DOTALL | re.IGNORECASE)


def _extract_json_object(raw: str) -> dict:
    """Parse the LLM's response into a dict, tolerating common output noise.

    Strategy:
      1. Strip a single code-fence wrapper if present.
      2. Try `json.loads` on the whole thing.
      3. Fall back to scanning for the first top-level `{...}` block.
    """
    s = raw.strip()
    m = _FENCE_RE.match(s)
    if m:
        s = m.group(1).strip()
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    # Locate the first `{` … balanced `}` substring and try that.
    start = s.find("{")
    if start < 0:
        raise ValueError("no JSON object in response")
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "{":
            depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    obj = json.loads(s[start:i + 1])
                except json.JSONDecodeError as e:
                    raise ValueError(f"balanced block did not parse: {e}")
                if isinstance(obj, dict):
                    return obj
                break
    raise ValueError("no balanced JSON object found")


def _validate_background_concept(raw: Any) -> Optional[str]:
    """Clean + validate the LLM's top-level `background_concept` field.

    Returns the normalized concept string (lowercase, trimmed, single-
    spaced) or None if missing / unusable. Same character classes as
    per-overlay media `concept` so Pexels search results stay reliable:
      * 2-5 words (wider than per-overlay because the bg query should
        describe a scene, not a beat).
      * ≤50 characters.
      * No stray punctuation beyond hyphens / apostrophes.
      * Lowercase normalized for cache stability — `find_b_roll` uses
        the concept as its cache key.

    Returns None on any rejection — caller falls back to the heuristic
    `extract_concept` over `word_importance` and ultimately to the
    layout's downgrade path if neither produces a usable URL.
    """
    if not isinstance(raw, str):
        return None
    cleaned = raw.strip().strip(".,!?;:\"'()[]").lower()
    # Collapse runs of whitespace so "team   meeting" → "team meeting"
    # without depending on re (already imported at module-top).
    cleaned = " ".join(cleaned.split())
    if not cleaned or len(cleaned) > MAX_BG_CONCEPT_LEN:
        return None
    words = cleaned.split()
    if len(words) < MIN_BG_CONCEPT_WORDS or len(words) > MAX_BG_CONCEPT_WORDS:
        return None
    return cleaned


def _validate_background_concepts(raw: Any) -> Optional[list[str]]:
    """Clean + validate the LLM's top-level `background_concepts` array.

    Each entry runs through the same validator as the single-concept
    field (`_validate_background_concept`). Invalid entries are
    SILENTLY DROPPED rather than nuking the whole sequence — a partially-
    valid array of 3 concepts is still useful even if the LLM emitted a
    4th malformed one.

    Drops duplicates after normalization so we don't fetch the same
    Pexels clip twice. Caps at MAX_BG_CONCEPTS — extras after the cap
    are also dropped silently (the prompt asks for 2-5 so 6+ means the
    LLM ignored guidance).

    Returns None when:
      * input isn't a list
      * fewer than MIN_BG_CONCEPTS valid entries remain after filtering
        (so we don't try to stitch a 1-clip "sequence")
    Returns the cleaned list otherwise. Caller's resolver will fall
    through to the single-concept path when None.
    """
    if not isinstance(raw, list) or not raw:
        return None
    cleaned: list[str] = []
    seen: set[str] = set()
    for entry in raw:
        normalized = _validate_background_concept(entry)
        if normalized is None:
            continue
        if normalized in seen:
            continue
        cleaned.append(normalized)
        seen.add(normalized)
        if len(cleaned) >= MAX_BG_CONCEPTS:
            break
    if len(cleaned) < MIN_BG_CONCEPTS:
        return None
    return cleaned


def _validate_overlay(entry: Any, reel_duration_s: float) -> Optional[OverlaySpec]:
    """One overlay → OverlaySpec or None. None means "drop this entry".

    Branches on `type`:
      * Text types (`hook` / `micro_hook` / `loop_back` / `emphasis`)
        require non-empty `text`; reject empties and CTA-kill phrases.
      * Media types (`broll_video` / `broll_image`) require non-empty
        `concept` (Pexels search query) + valid `position`.
    Timing rules are mostly shared (overall window + min/max duration)
    with type-specific windows for the four text variants and media's
    own [min/max] duration band.
    """
    if not isinstance(entry, dict):
        return None
    typ = str(entry.get("type") or "").strip().lower()
    if typ not in _OVERLAY_TYPES:
        return None
    try:
        ts = float(entry.get("t_start"))
        te = float(entry.get("t_end"))
    except (TypeError, ValueError):
        return None

    # Overall timing — every type shares this gate. Clamp loop_back's
    # occasional 1-frame overshoot to reel_duration.
    if not (0.0 <= ts < te <= reel_duration_s + 0.5):
        return None
    te = min(te, reel_duration_s)
    duration = te - ts

    is_visual = typ in _NON_TEXT_VISUAL_TYPES

    if is_visual:
        # Shared timing band for all non-text visual overlays (media +
        # stat + graphic). Same min/max — they're all "punctuation" beats
        # that briefly take the frame, not extended content.
        if duration < MIN_MEDIA_DURATION_S or duration > MAX_MEDIA_DURATION_S:
            return None

        # Position selection (full | corner | lower_third). Default to
        # "full" if missing/unknown — that's the conventional b-roll cut
        # AND the conventional stat-card placement.
        raw_pos = str(entry.get("position") or "full").strip().lower()
        position = raw_pos if raw_pos in _MEDIA_POSITIONS else "full"

        # Color intent — used by stat / graphic for accent color. Media
        # types ignore but accept the field.
        color = str(entry.get("color_intent") or "neutral").strip().lower()
        if color not in _COLOR_INTENTS:
            color = "neutral"

        if typ in _MEDIA_OVERLAY_TYPES:
            # Media overlays use `concept` — a short Pexels search query.
            concept = str(entry.get("concept") or "").strip().lower()
            if not concept:
                return None
            concept = concept.strip(".,!?;:\"'()[]")
            if not concept or len(concept) > MAX_CONCEPT_LEN:
                return None
            word_count = len(concept.split())
            if word_count < MIN_CONCEPT_WORDS or word_count > MAX_CONCEPT_WORDS:
                return None
            return OverlaySpec(
                type=typ, t_start=ts, t_end=te,
                concept=concept, position=position, color_intent=color,
            )

        if typ == "animated_stat":
            # Big bouncing number/word. `value` is required; `subtitle`
            # is the optional supporting line.
            value = str(entry.get("value") or "").strip()
            if not value or len(value) > MAX_STAT_VALUE_LEN:
                return None
            subtitle = str(entry.get("subtitle") or "").strip()
            if len(subtitle) > MAX_STAT_SUBTITLE_LEN:
                # Don't reject — just truncate. Subtitles run long when
                # the LLM gets verbose; better to ship a clipped one than
                # drop the whole stat.
                subtitle = subtitle[:MAX_STAT_SUBTITLE_LEN].rstrip()
            return OverlaySpec(
                type=typ, t_start=ts, t_end=te,
                value=value, subtitle=subtitle,
                position=position, color_intent=color,
            )

        if typ == "motion_graphic":
            # Per-kind validation: count band + value-shape rule + label
            # cap all live in `_GRAPHIC_KIND_SPECS`, so adding a new kind
            # is one dict entry + one renderer branch in the director.
            kind = str(entry.get("graphic_kind") or "").strip().lower()
            if kind not in _SUPPORTED_GRAPHIC_KINDS:
                return None
            kind_spec = _GRAPHIC_KIND_SPECS[kind]
            raw_bars = entry.get("bars") or []
            if not isinstance(raw_bars, list):
                return None
            bars: list[dict] = []
            for b in raw_bars:
                if not isinstance(b, dict):
                    continue
                label = str(b.get("label") or "").strip()
                if not label or len(label) > kind_spec["max_label_len"]:
                    continue
                # Coerce value to float for chart math. LLM occasionally
                # emits strings ("100", "100k"); strip non-numeric suffix
                # if present. Missing/non-numeric values are tolerated only
                # for kinds with values_required=False (comparison_icons —
                # qualitative contrast where exact numbers don't apply).
                raw_v = b.get("value")
                try:
                    val = float(raw_v)
                except (TypeError, ValueError):
                    m = re.match(r"-?\d+(\.\d+)?", str(raw_v or ""))
                    if m:
                        val = float(m.group(0))
                    elif not kind_spec["values_required"]:
                        val = 0.0
                    else:
                        continue
                if val < 0:
                    val = 0.0
                # Reject inf / nan — chart renderers (height-pct math,
                # SVG y-coord interpolation, conic-gradient stops) would
                # emit literal "inf"/"nan" text and broken geometry. The
                # LLM only emits these via numeric-string corruption, so
                # silently dropping the bar is the right call.
                if not math.isfinite(val):
                    continue
                bars.append({"label": label, "value": val})
            if not (kind_spec["min_bars"] <= len(bars) <= kind_spec["max_bars"]):
                return None
            # Numeric kinds need at least one positive value — all-zero
            # renders as an invisible chart. Kinds with values_required
            # =False (comparison_icons) can ship label-only and look fine.
            if kind_spec["values_required"]:
                if max((b["value"] for b in bars), default=0) <= 0:
                    return None
            return OverlaySpec(
                type=typ, t_start=ts, t_end=te,
                graphic_kind=kind, bars=bars,
                position=position, color_intent=color,
            )

    # ── Text-overlay validation ─────────────────────────────────────────
    text = str(entry.get("text") or "").strip()
    if not text:
        return None
    color = str(entry.get("color_intent") or "neutral").strip().lower()
    if color not in _COLOR_INTENTS:
        color = "neutral"

    # CTA filter — overlay text containing any kill phrase is dropped.
    text_lower = text.lower()
    if any(kp in text_lower for kp in CTA_KILL_PHRASES):
        return None

    # Length caps.
    word_count = len(text.split())
    if word_count > MAX_OVERLAY_WORDS or len(text) > MAX_OVERLAY_CHARS:
        return None

    # Text-overlay duration band (0.5-4.0s, narrower than media).
    if duration < MIN_OVERLAY_DURATION_S or duration > MAX_OVERLAY_DURATION_S:
        return None

    # Type-specific timing windows.
    if typ == "hook":
        if ts > 0.3 or te > HOOK_MAX_END_S:
            return None
    elif typ == "loop_back":
        # last 1.5s; start in the back half and end ≤ reel_duration
        if ts < reel_duration_s - 1.5 - 0.25:
            return None
    elif typ == "micro_hook":
        mid_lo = 0.30 * reel_duration_s
        mid_hi = 0.70 * reel_duration_s
        if ts < mid_lo or ts > mid_hi:
            return None
    # emphasis: any time inside the reel, already gated by overall timing checks.

    return OverlaySpec(
        type=typ,
        t_start=ts,
        t_end=te,
        text=text,
        color_intent=color,
    )


def _enforce_structural_rules(
    specs: list[OverlaySpec],
    reel_duration_s: float,
) -> list[OverlaySpec]:
    """Apply post-validation invariants so the final set is well-formed:

    * At most one hook / micro_hook / loop_back — keep the earliest valid
      one for each type. (LLMs sometimes emit two "hooks".)
    * At most MAX_EMPHASIS_OVERLAYS (4) emphasis overlays.
    * Drop emphasis overlays that overlap the hook or loop_back windows —
      stacking different overlays in the same band looks busy.
    * At most `MAX_MEDIA_OVERLAYS` (3) media overlays. Drop any that
      overlap the hook / micro_hook / loop_back windows OR another media
      overlay — media-on-media is visual chaos.
    * Sort the final list by t_start so downstream HTML generation can
      assume monotonic ordering.

    `reel_duration_s` is consumed when computing implicit structural
    windows (hook 0..HOOK_MAX_END_S even if the LLM didn't emit one,
    loop_back at the tail, micro_hook in the 30-70% band).
    """
    seen_unique: dict[str, OverlaySpec] = {}
    emphases: list[OverlaySpec] = []
    # All four non-text visual types (broll_video / broll_image /
    # animated_stat / motion_graphic) share one cardinality cap and one
    # overlap rule — they're mutually exclusive in time regardless of kind.
    visuals: list[OverlaySpec] = []
    for s in specs:
        if s.type in ("hook", "micro_hook", "loop_back"):
            if s.type not in seen_unique:
                seen_unique[s.type] = s
        elif s.type == "emphasis":
            emphases.append(s)
        elif s.type in _NON_TEXT_VISUAL_TYPES:
            visuals.append(s)

    hook = seen_unique.get("hook")
    micro = seen_unique.get("micro_hook")
    loop = seen_unique.get("loop_back")

    def _overlaps(a: OverlaySpec, b: Optional[OverlaySpec]) -> bool:
        if b is None:
            return False
        return a.t_start < b.t_end and b.t_start < a.t_end

    # Cap emphasis at MAX_EMPHASIS_OVERLAYS (4, Phase 2e cadence) and drop
    # any that overlap hook / loop_back. We tolerate emphasis overlapping
    # micro_hook because both can co-exist on the same beat — they're
    # both small text overlays.
    emphases = [e for e in emphases if not _overlaps(e, hook) and not _overlaps(e, loop)]
    emphases.sort(key=lambda x: x.t_start)
    emphases = emphases[:MAX_EMPHASIS_OVERLAYS]

    # Media: implicit hook / loop_back windows even if the LLM didn't
    # emit a hook/loop_back spec — those windows are STRUCTURALLY
    # protected (research §12.2 "hook is the 3-second moment"; loop-back
    # is the visual rhyme). Always reject media that lands there.
    implicit_hook_end = HOOK_MAX_END_S
    implicit_loop_start = max(0.0, reel_duration_s - 1.5)

    def _in_implicit_hook(s: OverlaySpec) -> bool:
        return s.t_start < implicit_hook_end

    def _in_implicit_loop(s: OverlaySpec) -> bool:
        return s.t_end > implicit_loop_start

    visuals = [
        v for v in visuals
        if not _overlaps(v, hook)
        and not _overlaps(v, micro)
        and not _overlaps(v, loop)
        and not _in_implicit_hook(v)
        and not _in_implicit_loop(v)
    ]
    visuals.sort(key=lambda x: x.t_start)

    # Greedy de-dup: keep visuals that don't overlap a previously-kept one.
    # Keeps the earliest of any colliding pair so the timeline reads
    # left-to-right cleanly. Same cap applies whether the visual is media,
    # stat, or graphic — they're all "punctuation" beats fighting for the
    # same attention budget.
    deduped_visuals: list[OverlaySpec] = []
    for v in visuals:
        if any(_overlaps(v, prev) for prev in deduped_visuals):
            continue
        deduped_visuals.append(v)
        if len(deduped_visuals) >= MAX_MEDIA_OVERLAYS:
            break

    out = list(seen_unique.values()) + emphases + deduped_visuals
    out.sort(key=lambda x: x.t_start)
    return out


# ---------------------------------------------------------------------------
# Deterministic fallback fillers
#
# Even with a tightened prompt, Haiku-class models occasionally omit one of
# the required overlays (hook / micro_hook). When the LLM returned ≥1 valid
# spec but missed a structural slot, we'd rather synthesize something
# transcript-driven than ship a reel without that beat. These fillers are
# intentionally simple — short, ALL CAPS, drawn from the speaker's own
# words — so they slot in cleanly next to the LLM's tailored picks.
# ---------------------------------------------------------------------------

# Stop-words that produce useless single-word overlays. Built from the
# preview service's STOPWORDS but trimmed to the ones that genuinely never
# work as a punctuation overlay.
_FALLBACK_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
    "on", "at", "by", "for", "with", "from", "as", "is", "are", "was",
    "were", "be", "been", "being", "am", "i", "you", "he", "she", "it",
    "we", "they", "them", "us", "me", "my", "your", "his", "her", "its",
    "our", "their", "this", "that", "these", "those", "so", "well", "just",
    "now", "very", "would", "could", "should", "do", "does", "did", "has",
    "have", "had", "yeah", "yep", "oh", "okay", "right", "like", "kind",
    "sort", "really", "know", "mean", "see",
}


def _fill_missing_required(
    specs: list[OverlaySpec],
    *,
    reel_duration_s: float,
    title: str,
    word_importance_reel_time: list[dict],
) -> list[OverlaySpec]:
    """Add a deterministic hook + micro_hook if the LLM omitted them.

    Loop_back is intentionally NOT synthesized — a weak loop-back is worse
    than none, and the loop quality axis the scorer already enforces gives
    a decent baseline. The hook is the highest-stakes overlay (research
    §12.2 — first 3s decide watch-vs-scroll), so we always guarantee one.
    Micro_hook is the second-highest (research §12.3 — re-engagement at
    midpoint adds ~15% retention), so we guarantee that too.

    Synthesis strategy:
      * **Hook**: derived from the candidate's working title (uppercased,
        truncated to 6 words). Falls back to the first non-stopword
        content word of the reel if the title is empty/junk.
      * **Micro_hook**: highest-importance spoken PHRASE (2-4 consecutive
        words) in the middle 30-65% of the reel, placed at the phrase's
        onset. If no phrase qualifies, the slot is SKIPPED — a generic
        filler reads as template spam and is worse than no overlay.

    Returns the spec list with any missing slots filled in. Preserves
    monotonic ordering by t_start.
    """
    present = {s.type for s in specs}
    additions: list[OverlaySpec] = []

    if "hook" not in present:
        hook = _synth_hook(title, word_importance_reel_time, reel_duration_s)
        if hook is not None:
            additions.append(hook)
            logger.info("[LLMDirector] LLM omitted hook — filled with deterministic synth")

    if "micro_hook" not in present:
        micro = _synth_micro_hook(word_importance_reel_time, reel_duration_s)
        if micro is not None:
            additions.append(micro)
            logger.info("[LLMDirector] LLM omitted micro_hook — filled with deterministic synth")

    # Emphasis floor (Phase 2e bug-followup). The 2026-05-13 audit showed
    # the LLM emitting only 1 emphasis when the prompt asks for 2-4 —
    # leaving a 5-10s mid-clip stretch with no visual change. We count
    # LLM-emitted + just-synthesized emphasis specs (additions can include
    # nothing yet because hook/micro_hook synths don't add emphasis), then
    # top up to MIN_EMPHASIS_TARGET with deterministic picks from the
    # speaker's highest-importance content words. The synthesizer respects
    # hook / loop / micro_hook protection zones AND any existing emphasis
    # so we never stack on what the LLM already shipped.
    emphasis_count = sum(
        1 for s in specs if s.type == "emphasis"
    ) + sum(1 for s in additions if s.type == "emphasis")
    if emphasis_count < MIN_EMPHASIS_TARGET:
        needed = MIN_EMPHASIS_TARGET - emphasis_count
        # `existing_specs` for the synth must include all current specs +
        # already-added fillers so the synthesizer's protected-range
        # computation is complete.
        new_emphasis = _synth_emphasis(
            existing_specs=specs + additions,
            word_importance_reel_time=word_importance_reel_time,
            reel_duration_s=reel_duration_s,
            target_count=needed,
        )
        if new_emphasis:
            additions.extend(new_emphasis)
            logger.info(
                f"[LLMDirector] LLM emitted {emphasis_count} emphasis "
                f"(< MIN_EMPHASIS_TARGET={MIN_EMPHASIS_TARGET}); "
                f"synthesized {len(new_emphasis)} more for cadence"
            )

    if not additions:
        return specs

    merged = specs + additions
    merged.sort(key=lambda x: x.t_start)
    return merged


def _synth_hook(
    title: str,
    word_importance_reel_time: list[dict],
    reel_duration_s: float,
) -> Optional[OverlaySpec]:
    """Build a deterministic hook overlay from the working title.

    Truncates to MAX_OVERLAY_WORDS, uppercases, and times it to fit inside
    the validator's hook window (0.0 → 2.2s by default). Returns None if
    the title is empty AND we can't find a usable opening word.
    """
    text = _trim_to_overlay_text(title)
    if not text:
        # Title was unusable — fall back to the first meaningful word(s).
        first_words: list[str] = []
        for w in word_importance_reel_time:
            tok = str(w.get("word") or "").strip().strip(".,!?")
            if not tok or tok.lower() in _FALLBACK_STOPWORDS:
                continue
            first_words.append(tok)
            if len(first_words) >= 3:
                break
        text = _trim_to_overlay_text(" ".join(first_words))
    if not text:
        return None

    hook_end = min(2.2, max(0.6, reel_duration_s - 0.1))
    return OverlaySpec(
        type="hook",
        t_start=0.0,
        t_end=hook_end,
        text=text.upper(),
        color_intent="important",
    )


# Phrase-window bounds for the deterministic micro_hook. A 2-4 word
# spoken phrase ("LOSE 80% OF VIEWERS") re-engages far better than a
# single floating word ("TEAMWORK") — single words read as decoration,
# phrases read as a claim.
_SYNTH_PHRASE_MIN_WORDS = 2
_SYNTH_PHRASE_MAX_WORDS = 4


def _synth_micro_hook(
    word_importance_reel_time: list[dict],
    reel_duration_s: float,
) -> Optional[OverlaySpec]:
    """Build a deterministic micro_hook from the highest-importance spoken
    PHRASE (2-4 consecutive words) in the middle of the reel.

    The micro_hook validator only accepts t_start in [0.30*dur, 0.70*dur],
    so candidate phrases must start in that band. Windows must begin and
    end on content words (no dangling stopwords), must not cross a
    sentence boundary, and must contain at least one importance>=3 word —
    if nothing qualifies the slot is SKIPPED entirely. A generic filler
    ("WAIT FOR IT"-style) telegraphs template output and tests worse than
    leaving the mid-beat to the speaker.
    """
    if reel_duration_s < 4.0:
        # Reel too short for a midpoint overlay to make sense.
        return None
    mid_lo = 0.30 * reel_duration_s
    mid_hi = 0.65 * reel_duration_s  # leave room for a 1.5s overlay before 0.70*dur

    # Normalize once: (clean_token, raw_token, t_start, t_end, importance).
    words: list[tuple[str, str, float, float, int]] = []
    for w in word_importance_reel_time:
        try:
            ts = float(w.get("t_start") or 0.0)
            te = float(w.get("t_end") or 0.0)
        except (TypeError, ValueError):
            continue
        raw = str(w.get("word") or "").strip()
        clean = raw.strip(".,!?;:\"'")
        if not clean:
            continue
        words.append((clean, raw, ts, te, int(w.get("importance") or 2)))

    best: Optional[dict] = None
    best_score = -1.0
    for i, (clean_i, _raw_i, ts_i, _te_i, imp_i) in enumerate(words):
        if not (mid_lo <= ts_i <= mid_hi):
            continue
        # Phrase must START on a content word.
        if clean_i.lower() in _FALLBACK_STOPWORDS:
            continue
        for length in range(_SYNTH_PHRASE_MIN_WORDS, _SYNTH_PHRASE_MAX_WORDS + 1):
            window = words[i:i + length]
            if len(window) < length:
                break
            # No sentence boundary INSIDE the phrase (the last word may
            # carry one — that's the natural end of the claim).
            if any(t[1].rstrip("'\"").endswith((".", "?", "!")) for t in window[:-1]):
                break
            # Phrase must END on a content word too.
            if window[-1][0].lower() in _FALLBACK_STOPWORDS:
                continue
            text = " ".join(t[0] for t in window)
            if len(text) > MAX_OVERLAY_CHARS:
                continue
            max_imp = max(t[4] for t in window)
            if max_imp < 3:
                # No genuinely important anchor — not worth an overlay.
                continue
            # Total importance favors dense claims; the small length bonus
            # breaks ties toward fuller phrases over fragments.
            score = sum(t[4] for t in window) + 0.15 * length
            # Continuation penalty: if the window stops mid-claim (next
            # word is a content word and the window doesn't end the
            # sentence), a truncated overlay like "TEAMWORK IS YOUR
            # GREATEST" beats-out the complete "GREATEST STRENGTH" on raw
            # sum alone — punish the cut so natural phrase ends win.
            ends_sentence = window[-1][1].rstrip("'\"").endswith((".", "?", "!"))
            nxt = words[i + length] if i + length < len(words) else None
            if not ends_sentence and nxt is not None and nxt[0].lower() not in _FALLBACK_STOPWORDS:
                score -= 1.5 * nxt[4]
            if score > best_score:
                best_score = score
                best = {
                    "text": text,
                    "t_start": ts_i,
                    "t_end_phrase": window[-1][3],
                    "max_importance": max_imp,
                }

    if best is None:
        return None

    t_start = float(best["t_start"])
    # Hold a beat past the spoken phrase, inside the validator's duration
    # band, never spilling into the loop_back tail.
    t_end = min(
        max(t_start + 1.5, float(best["t_end_phrase"]) + 0.4),
        t_start + MAX_OVERLAY_DURATION_S,
        reel_duration_s - 0.5,
    )
    # Validator requires duration ≥ MIN_OVERLAY_DURATION_S; if our window
    # was clipped too tight by the reel end, skip rather than ship a
    # malformed overlay.
    if t_end - t_start < MIN_OVERLAY_DURATION_S:
        return None
    color = "important" if best["max_importance"] >= 3 else "neutral"
    return OverlaySpec(
        type="micro_hook",
        t_start=t_start,
        t_end=t_end,
        text=best["text"].upper(),
        color_intent=color,
    )


# Minimum spacing between two emphasis overlays. Clusters of emphasis
# read as visual noise; spacing them apart hits the research §12.3
# "visual change every 2-4s" cadence cleanly.
_MIN_EMPHASIS_SPACING_S = 3.0
# Duration of each synthesized emphasis. Tight enough to punctuate, long
# enough to read at 6vw font size — matches the LLM-emitted defaults.
_SYNTH_EMPHASIS_DURATION_S = 1.5


def _synth_emphasis(
    existing_specs: list[OverlaySpec],
    word_importance_reel_time: list[dict],
    reel_duration_s: float,
    target_count: int,
) -> list[OverlaySpec]:
    """Synthesize up to `target_count` emphasis overlays from the speaker's
    own high-importance words. Used when the LLM emitted fewer than
    MIN_EMPHASIS_TARGET (the audited 2026-05-13 reel hit this — LLM
    emitted 1 emphasis when the prompt asked for 2-4).

    Strategy mirrors `_synth_micro_hook`:
      * Rank content words by (importance, length, position) — descending.
      * Skip words in protected zones: hook window (0..HOOK_MAX_END_S),
        loop-back window (last 1.5s), and any range already covered by
        an existing spec (hook / micro_hook / loop_back / LLM-emitted
        emphasis / visual overlay).
      * Enforce `_MIN_EMPHASIS_SPACING_S` between picks so the synthesized
        emphasis don't cluster.
      * Each emphasis runs `_SYNTH_EMPHASIS_DURATION_S` from the word's
        onset; t_end clamped to reel_duration - 0.1s.

    Returns 0..target_count new OverlaySpecs. Caller (`_fill_missing_required`)
    merges + sorts.
    """
    if target_count <= 0 or reel_duration_s < 4.0:
        return []

    hook_end = HOOK_MAX_END_S
    loop_start = max(0.0, reel_duration_s - 1.5)
    if loop_start <= hook_end:
        # Reel too short to have a safe middle window for emphasis.
        return []

    # Blocked ranges: hook + loop windows + EVERY existing spec (whether
    # text overlay or visual). Synthesized emphasis must not overlap any.
    blocked: list[tuple[float, float]] = [
        (0.0, hook_end),
        (loop_start, reel_duration_s),
    ]
    for s in existing_specs:
        blocked.append((s.t_start, s.t_end))

    def _in_blocked(ts: float, te: float) -> bool:
        for r_start, r_end in blocked:
            if ts < r_end and r_start < te:
                return True
        return False

    # Candidate words: importance ≥ 2, not stopwords, inside the safe
    # middle band, room for a full SYNTH_EMPHASIS_DURATION_S window.
    candidates: list[tuple[int, int, float, str]] = []
    max_t_start = loop_start - _SYNTH_EMPHASIS_DURATION_S
    for w in word_importance_reel_time:
        try:
            ts = float(w.get("t_start") or 0.0)
        except (TypeError, ValueError):
            continue
        if ts < hook_end or ts > max_t_start:
            continue
        tok = str(w.get("word") or "").strip().strip(".,!?")
        if not tok or tok.lower() in _FALLBACK_STOPWORDS:
            continue
        importance = int(w.get("importance") or 2)
        if importance < 2:
            continue
        candidates.append((importance, len(tok), ts, tok))

    # Sort by importance desc, then length desc, then earliest first
    # (so when two words tie we prefer the one that comes earlier — it
    # has more reel time to breathe before the next overlay).
    candidates.sort(key=lambda x: (-x[0], -x[1], x[2]))

    additions: list[OverlaySpec] = []
    placed_starts: list[float] = []
    for imp, _wlen, ts, tok in candidates:
        if len(additions) >= target_count:
            break
        te = min(ts + _SYNTH_EMPHASIS_DURATION_S, reel_duration_s - 0.1)
        if te - ts < MIN_OVERLAY_DURATION_S:
            continue
        if _in_blocked(ts, te):
            continue
        # Spacing check: don't place two synthesized emphasis within
        # _MIN_EMPHASIS_SPACING_S of each other (clusters look noisy).
        if any(abs(ts - p) < _MIN_EMPHASIS_SPACING_S for p in placed_starts):
            continue
        # Length cap on the synthesized text — single content word, ALL
        # CAPS, matches the hook/micro_hook visual style.
        text = tok.upper()
        if len(text) > MAX_OVERLAY_CHARS:
            text = text[:MAX_OVERLAY_CHARS]
        color = "important" if imp >= 3 else "neutral"
        additions.append(OverlaySpec(
            type="emphasis",
            t_start=ts,
            t_end=te,
            text=text,
            color_intent=color,
        ))
        placed_starts.append(ts)
    return additions


def _trim_to_overlay_text(s: str) -> str:
    """Squeeze a string into the overlay's word/char limits.

    LLM-generated titles can run long (e.g. the preview service's fallback
    title is "never done by one person They're" — 7 words). We cut to
    MAX_OVERLAY_WORDS, then truncate to MAX_OVERLAY_CHARS as a belt.
    """
    if not s:
        return ""
    words = s.strip().split()
    if not words:
        return ""
    words = words[:MAX_OVERLAY_WORDS]
    text = " ".join(words)
    if len(text) > MAX_OVERLAY_CHARS:
        text = text[:MAX_OVERLAY_CHARS].rstrip()
    return text
