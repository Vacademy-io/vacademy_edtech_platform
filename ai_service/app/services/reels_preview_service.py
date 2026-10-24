"""
Gate 2 enrichment for reels-from-long-video (POST /preview).

For each user-picked scan candidate, this service produces:
  - title           (≤8 words, ≤60 chars)
  - rationale       (≤20 words explaining why this clip is worth rendering)
  - word_importance ([word, t_start, t_end, importance 0-3])
  - cut_plan        ([t_start, t_end, kind: silence | word | filler])
  - predicted_output_duration_s (after the cut plan is applied)

Design notes:
- Single LLM call per candidate (Haiku-class model) returns title + rationale
  + a parallel `importance` array indexed by word position. Word indices
  instead of full word objects keep the response bandwidth small.
- The LLM provides the BASE word importance; deterministic post-processing
  applies hard rules: emphasis-marked words get importance ≥ 2, topic-
  keyword matches get importance = 3.
- If the LLM key is missing or the call fails / response is malformed, a
  pure-heuristic fallback produces usable (but coarser) importance scores.
  The Phase-1 product can ship with the fallback; the LLM is quality polish.
- The cut planner is deterministic and duration-driven, in three steps
  (each later step only runs if the reel is still over target + tolerance):
    1. silence spans — every prosody pause ≥0.4s inside the window is
       trimmed down to a 0.15s breathing gap (kind="silence"). The
       constants mirror the engagement scorer's predicted_after_silence_s
       math so scan-time prediction and the rendered edit agree.
    2. disfluency runs — whole runs of importance==0 words (fillers,
       repeats, false starts), and ONLY when the run borders a ≥120ms
       pause or a window edge. Isolated mid-clause holes are never
       punched; importance ≥ 1 words are never auto-cut.
    3. edge shrink — drop a whole trailing (preferred) or leading
       sentence when fillers alone can't reach target.
  Any remaining excess is left to the render-time speed_multiplier.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional, Sequence

from .use_case_chat import chat_json, models_for

from ..config import get_settings
from .reels_engagement_service import (
    SILENCE_TRIM_MIN_GAP_S,
    SILENCE_TRIM_THRESHOLD_S,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants — mirror engagement scorer where applicable
# ---------------------------------------------------------------------------

_LLM_TIMEOUT_S = 30.0
# The model comes from the 'reels_preview' use case (ai_model_defaults, set in
# the super-admin portal; GLM by default) and the call walks its fallback chain
# through llm_router.chat_with_chain. REELS_PREVIEW_LLM_MODEL, when set, is
# tried first (emergency override).
_USE_CASE = "reels_preview"
_LLM_MODEL_ENV = "REELS_PREVIEW_LLM_MODEL"

# Cut planner constraints.
MIN_CUT_SPAN_S = 0.080         # below this = sub-syllable, audible artifact risk
# Cap on a single auto word/filler cut. A run of importance-0 words longer
# than this almost always means the importance labels are wrong (the LLM
# wrote off a whole clause) — we skip the run rather than auto-delete that
# much speech. Silence spans and window-edge sentence drops are exempt:
# nothing meaningful is inside them.
MAX_CUT_SPAN_S = 2.000
# B2 (2026-05-22) — user-toggled cuts (kind="user") from the FE trim UI can
# run longer than auto-cuts because the user explicitly judges the span as
# removable. Up to 15s per single user span; the audio_edit pipeline uses
# atrim+concat which handles arbitrary-length joins cleanly at word
# boundaries (the FE only lets users toggle whole words, not partial spans).
MAX_USER_CUT_SPAN_S = 15.000
# Grammar safety for word-level cuts. A splice is only inaudible-as-an-edit
# when it lands where the speaker actually paused; a cut span must border a
# gap at least this long (or a window edge) on one side. This is what stops
# the planner from punching isolated mid-clause holes (deleted pronouns /
# copulas in the middle of a sentence).
PAUSE_ADJACENCY_MIN_GAP_S = 0.120

# Heuristic filler — single-word disfluencies. Importance 0 by default in
# the fallback path.
# Notes on cuts from earlier lists:
#  - "actually", "literally", "basically", "really" are NOT filler here —
#    they can be contrarian/emphasis markers (engagement scorer treats
#    "actually" as a strong opener +25). Conflating these would have the two
#    services disagreeing about the same word.
#  - Multi-word fillers ("you know", "i mean", "kind of", "sort of") are
#    handled separately by `_count_filler_bigrams` below, since the single-
#    token `in FILLER_WORDS` test can't match them.
FILLER_WORDS = {
    "um", "uh", "uhh", "umm", "er", "erm", "hmm", "ah", "ahh", "ahem",
    "y'know",
}

# Bigram fillers — checked against (token_i, token_i+1). When matched, BOTH
# words get importance 0.
FILLER_BIGRAMS = {
    ("you", "know"),
    ("i", "mean"),
    ("kind", "of"),
    ("sort", "of"),
    ("you", "see"),
}

# Common low-content stopwords for the heuristic — importance 1 (cuttable
# but not as freely as fillers).
STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "then", "of", "to", "in",
    "on", "at", "by", "for", "with", "from", "as", "is", "are", "was",
    "were", "be", "been", "being", "am", "i", "you", "he", "she", "it",
    "we", "they", "them", "us", "me", "my", "your", "his", "her", "its",
    "our", "their", "this", "that", "these", "those", "so", "well", "just",
    "now", "very", "would", "could", "should", "do", "does", "did", "has",
    "have", "had", "yeah", "yep", "oh",
}


# ---------------------------------------------------------------------------
# Internal types
# ---------------------------------------------------------------------------

@dataclass
class _Word:
    """Word with timing + importance — internal to the planner."""
    idx: int
    text: str
    t_start: float
    t_end: float
    importance: int = 2  # default routine
    keyword_type: Optional[str] = None  # important | definition | warning
    # Optional emoji to display next to this word in captions (Phase 2c.7).
    # Populated only when the LLM emits an emoji for this slot; heuristic
    # fallback leaves it None.
    emoji: Optional[str] = None

    @property
    def duration(self) -> float:
        return max(0.0, self.t_end - self.t_start)


# Maximum emojis to surface across all captions in a single reel. Research
# §12.4: 0-3 emoji per reel is the engagement sweet spot; more becomes
# visual clutter that competes with the keyword-color highlight pattern.
MAX_EMOJIS_PER_REEL = 3
# Per-entry codepoint cap. Most caption emojis are 1-2 chars (single emoji
# or emoji + skin-tone modifier). ZWJ family sequences (5-7 chars) are
# extremely rare in caption context and indistinguishable at small font
# sizes anyway. Cap of 4 rejects "emoji walls" (8+ unrelated emojis in one
# slot, sometimes emitted when the LLM misinterprets the schema) while
# still allowing emoji+modifier pairs.
MAX_EMOJI_LEN = 4
# Reject any emoji-slot that contains an ASCII letter or digit. LLMs
# occasionally emit text labels ("money" instead of "💰") when they don't
# know an emoji — we drop those rather than render mid-sentence text.
_EMOJI_REJECT_RE = re.compile(r"[A-Za-z0-9]")


@dataclass
class _CutSpan:
    """One contiguous range to remove from the audio + video."""
    t_start: float
    t_end: float
    kind: str  # "word" | "filler" | "silence"

    @property
    def duration(self) -> float:
        return max(0.0, self.t_end - self.t_start)


@dataclass
class EnrichedPayload:
    """JSON-serializable result persisted to ai_reel_candidates.enriched."""
    title: str
    rationale: str
    word_importance: list[dict]   # [{word, t_start, t_end, importance, keyword_type}]
    cut_plan: list[dict]          # [{t_start, t_end, kind}]
    predicted_output_duration_s: float
    method: str                   # "llm" | "heuristic_fallback"
    # Issue 1B' — LLM-suggested transcript corrections that were applied
    # to the word list (e.g. "raven" → "Ravana" when context implies the
    # Ramayana). Persisted for observability + so the FE can show a
    # "transcript was edited" indicator.
    transcript_corrections: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "rationale": self.rationale,
            "word_importance": self.word_importance,
            "cut_plan": self.cut_plan,
            "predicted_output_duration_s": self.predicted_output_duration_s,
            "method": self.method,
            "transcript_corrections": self.transcript_corrections,
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

def preview_models() -> list[str]:
    """The model chain for /preview enrichment: $REELS_PREVIEW_LLM_MODEL (if
    set), then the 'reels_preview' use case chain. `[0]` is also the model the
    /preview credit estimate is priced at."""
    return models_for(_USE_CASE, env=_LLM_MODEL_ENV)


class ReelsPreviewService:
    """Single-candidate enrichment. Stateless — instantiate per /preview call."""

    def __init__(self):
        self._settings = get_settings()
        self._api_key = self._settings.openrouter_api_key
        self._llm_url = self._settings.llm_base_url
        self._models = preview_models()
        self._model = self._models[0]

    @property
    def has_llm(self) -> bool:
        return bool(self._api_key)

    async def enrich(
        self,
        candidate_row: Any,            # AiReelCandidate
        context: dict,                 # parsed video_context.json
        target_duration_sec: int,
        duration_tolerance_sec: int,
        topic_keywords: Sequence[str] = (),
    ) -> EnrichedPayload:
        """Enrich one scan candidate. Falls back to heuristic when LLM is
        unavailable or returns malformed output. Always returns a payload."""
        # 1. Extract the window's word-level data from the transcript.
        words = _extract_window_words(
            context.get("transcript") or [],
            candidate_row.source_t_start,
            candidate_row.source_t_end,
        )
        if not words:
            # Window has no words — degenerate but real (e.g., silent stretch
            # that nonetheless scored). Return empty enrichment so the FE can
            # show "no usable content" rather than crash.
            return EnrichedPayload(
                title="(silent window)",
                rationale="No transcribed speech in this window.",
                word_importance=[],
                cut_plan=[],
                predicted_output_duration_s=float(candidate_row.predicted_output_duration_s or 0),
                method="heuristic_fallback",
            )

        # 2. LLM importance (or heuristic fallback). The LLM path also
        # returns an emoji-per-word parallel array; heuristic path has no
        # emojis (a static-keyword → emoji mapping looks robotic and was
        # rejected during Phase 2c.7 design — LLM context-awareness is
        # what makes the emoji feel intentional).
        emojis_arr: list[str] = []
        corrections: list[dict] = []
        if self.has_llm:
            llm_out = await self._call_llm(
                words,
                candidate_row,
                topic_keywords,
                target_duration_sec=target_duration_sec,
                duration_tolerance_sec=duration_tolerance_sec,
            )
            if llm_out is not None:
                title, rationale, importance_arr, emojis_arr, corrections = llm_out
                method = "llm"
            else:
                title, rationale, importance_arr = _heuristic_importance(
                    words, candidate_row, topic_keywords
                )
                method = "heuristic_fallback"
        else:
            title, rationale, importance_arr = _heuristic_importance(
                words, candidate_row, topic_keywords
            )
            method = "heuristic_fallback"

        # 3. Apply LLM-or-heuristic importance + emojis to the word list,
        #    then enforce deterministic floors from emphasis marks +
        #    topic keyword matches.
        _apply_importance(words, importance_arr)
        if emojis_arr:
            _apply_emojis(words, emojis_arr)
        # Apply LLM-suggested transcript corrections (Issue 1B' —
        # Raven→Ravana style fixes). Mutates `words[i].text` in place
        # so downstream consumers (LLM director, captions) see the
        # corrected token. The original transcript timing/audio is
        # untouched — only the displayed text changes.
        applied_corrections = _apply_corrections(words, corrections)
        _enforce_deterministic_floors(
            words,
            emphasis_marks=context.get("emphasis") or [],
            topic_keywords=topic_keywords,
            candidate_t_start=candidate_row.source_t_start,
            candidate_t_end=candidate_row.source_t_end,
        )

        # 4. Cut planner. Silence spans are planned from the indexer's
        # prosody pauses — the same signal the scan-time scorer used for
        # predicted_after_silence_s, so prediction and edit agree.
        pauses = (context.get("prosody") or {}).get("pauses") or []
        cut_plan, predicted_final = plan_cuts(
            words,
            target_duration_sec=target_duration_sec,
            duration_tolerance_sec=duration_tolerance_sec,
            window_t_start=float(candidate_row.source_t_start),
            window_t_end=float(candidate_row.source_t_end),
            pauses=pauses,
        )

        return EnrichedPayload(
            title=title or _fallback_title(words),
            rationale=rationale or _fallback_rationale(candidate_row),
            word_importance=[
                {
                    "word": w.text,
                    "t_start": round(w.t_start, 3),
                    "t_end": round(w.t_end, 3),
                    "importance": w.importance,
                    "keyword_type": w.keyword_type,
                    "emoji": w.emoji,
                }
                for w in words
            ],
            cut_plan=[
                {"t_start": round(c.t_start, 3), "t_end": round(c.t_end, 3), "kind": c.kind}
                for c in cut_plan
            ],
            predicted_output_duration_s=round(predicted_final, 2),
            method=method,
            transcript_corrections=applied_corrections,
        )

    # ── LLM call ──────────────────────────────────────────────────────────

    async def _call_llm(
        self,
        words: list[_Word],
        candidate_row: Any,
        topic_keywords: Sequence[str],
        *,
        target_duration_sec: int,
        duration_tolerance_sec: int,
    ) -> Optional[tuple[str, str, list[int], list[str], list[dict]]]:
        """One LLM call returning (title, rationale, importance, emojis, corrections).

        `emojis_array` is parallel to `importance_array` — same length,
        with "" entries for words that don't get an emoji. Defaults to
        `[]` when the LLM omits the optional `emojis` key OR when the
        validator rejects malformed emoji entries.

        Returns None on transport error, schema validation failure, or
        importance-array length mismatch — caller falls back to heuristic.
        """
        system = _SYSTEM_PROMPT
        user = _build_user_prompt(
            words,
            candidate_row,
            topic_keywords,
            target_duration_sec=target_duration_sec,
            duration_tolerance_sec=duration_tolerance_sec,
        )
        payload = {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            # 0.7 — the hook-line title needs creative range. Importance
            # scoring is anchored by the 0-3 rubric plus the deterministic
            # floors applied after the call, so it tolerates the heat.
            "temperature": 0.7,
            "max_tokens": 1500,
        }

        # Through the model chain: response_format=json_object first, then the
        # chain again without it if a model rejected the parameter (400).
        # Transport errors / 5xx / empty replies move to the next model.
        result = await chat_json(
            payload,
            use_case=_USE_CASE,
            models=self._models,
            api_key=self._api_key,
            timeout=_LLM_TIMEOUT_S,
            label="ReelsPreview",
        )
        raw: Optional[str] = result.content if result is not None else None

        if not raw:
            return None

        return _parse_llm_response(raw, expected_len=len(words))


# ---------------------------------------------------------------------------
# Cut planner
# ---------------------------------------------------------------------------

def plan_cuts(
    words: list[_Word],
    *,
    target_duration_sec: int,
    duration_tolerance_sec: int,
    window_t_start: float,
    window_t_end: float,
    pauses: Sequence[dict] = (),
) -> tuple[list[_CutSpan], float]:
    """Deterministic cut planner. Returns (cut_plan, predicted_final_duration_s).

    Three duration-driven steps — each later step only runs while the reel
    is still over `target + tolerance`:

      1. Silence: every prosody pause ≥ SILENCE_TRIM_THRESHOLD_S that lies
         fully inside the window is trimmed down to a SILENCE_TRIM_MIN_GAP_S
         breathing gap (kind="silence"). The constants mirror the engagement
         scorer's `predicted_after_silence_s` math, so the scan-time
         prediction and the rendered edit describe the same audio. Silence
         trim is unconditional in the plan; render time honors
         PaceConfig.silence_trim by dropping these spans where the trim_map
         is derived (reels_audio_edit_service).
      2. Disfluency runs: maximal runs of importance==0 words (fillers,
         repeats, false starts) cut whole — only when the run borders a
         ≥ PAUSE_ADJACENCY_MIN_GAP_S gap or a window edge on at least one
         side. Importance ≥ 1 words are never auto-cut: deleting glue words
         mid-clause makes speech ungrammatical, which is worse than missing
         the duration target.
      3. Edge shrink: drop a whole trailing (preferred — the head carries
         the hook) or leading sentence, only when the shrink lands inside
         [target - tol, target + tol].

    Any remaining excess is left to the render-time speed_multiplier.
    Predicted duration is computed from the UNION of all spans, so spans
    planned from different signals (prosody pauses vs ASR word timing)
    can brush against each other without double-counting savings.
    """
    window_duration = max(0.0, window_t_end - window_t_start)
    if not words:
        return [], window_duration

    target_s = float(target_duration_sec)
    tolerance_s = float(duration_tolerance_sec)

    # 1. Silence spans — emitted before any word math so the remaining
    # excess for word cuts is computed against the post-silence duration.
    plan: list[_CutSpan] = _plan_silence_spans(
        words, pauses, window_t_start, window_t_end
    )

    def _predicted() -> float:
        return max(0.0, window_duration - _union_duration_s(plan))

    if _predicted() - target_s <= tolerance_s:
        return plan, _predicted()

    # 2. Disfluency runs, longest first (most seconds saved per seam).
    runs = _disfluency_runs(words)
    runs.sort(key=lambda r: -r.duration)
    for run in runs:
        if _predicted() - target_s <= tolerance_s:
            break
        # Don't let one long run swing the reel from too-long to too-short.
        if window_duration - _union_duration_s(plan + [run]) < target_s - tolerance_s:
            continue
        plan.append(run)
    plan.sort(key=lambda s: s.t_start)

    if _predicted() - target_s <= tolerance_s:
        return plan, _predicted()

    # 3. Edge shrink to the nearest sentence boundary.
    edge_span = _plan_edge_shrink(
        words,
        plan,
        window_t_start=window_t_start,
        window_t_end=window_t_end,
        window_duration=window_duration,
        target_s=target_s,
        tolerance_s=tolerance_s,
    )
    if edge_span is not None:
        plan.append(edge_span)
        plan.sort(key=lambda s: s.t_start)

    return plan, _predicted()


def _plan_silence_spans(
    words: list[_Word],
    pauses: Sequence[dict],
    window_t_start: float,
    window_t_end: float,
) -> list[_CutSpan]:
    """kind="silence" spans: each pause ≥ threshold fully inside the window,
    trimmed down to the keep-gap. The kept gap is split half-before /
    half-after the cut so both sides of the seam keep breathing room (the
    audio service's de-click fades also want a few ms to land in).

    Only pauses that lie ENTIRELY inside the window count — same rule the
    engagement scorer applies when computing predicted_after_silence_s.
    Edge-straddling dead air is the window snapper's problem, not ours.
    """
    spans: list[_CutSpan] = []
    half_gap = SILENCE_TRIM_MIN_GAP_S / 2.0
    for p in pauses or ():
        if not isinstance(p, dict):
            continue
        try:
            ps = float(p.get("start", 0.0))
            pe = float(p.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        if ps < window_t_start or pe > window_t_end:
            continue
        if pe - ps < SILENCE_TRIM_THRESHOLD_S:
            continue
        cs, ce = ps + half_gap, pe - half_gap
        # Defensive clamp: ASR word timings occasionally bleed into a
        # prosody-detected pause. Never let a silence cut clip speech —
        # shrink to the word-free middle, or drop the pause entirely when
        # a word sits strictly inside it (distrust the signal).
        intruded = False
        for w in words:
            if w.t_end <= cs or w.t_start >= ce:
                continue
            if w.t_start <= cs:
                cs = max(cs, w.t_end)
            elif w.t_end >= ce:
                ce = min(ce, w.t_start)
            else:
                intruded = True
                break
        if intruded:
            continue
        if ce - cs >= MIN_CUT_SPAN_S:
            spans.append(_CutSpan(cs, ce, "silence"))
    spans.sort(key=lambda s: s.t_start)
    return spans


def _disfluency_runs(words: list[_Word]) -> list[_CutSpan]:
    """Candidate kind="filler" spans: maximal runs of consecutive
    importance==0 words that qualify for a grammar-safe cut.

    A run is split wherever the inter-word gap reaches
    SILENCE_TRIM_THRESHOLD_S — that gap belongs to the silence planner,
    and keeping the two span kinds disjoint keeps the duration math exact.

    Qualification rules:
      - The run must border a gap ≥ PAUSE_ADJACENCY_MIN_GAP_S (or a window
        edge) on at least one side. A run covering a whole phrase between
        two pauses qualifies via either side; an isolated mid-clause word
        does not — splicing there is audible AND ungrammatical.
      - MIN_CUT_SPAN_S ≤ duration ≤ MAX_CUT_SPAN_S. Longer runs mean the
        importance labels probably wrote off a whole clause; skip rather
        than auto-delete that much speech.
    """
    n = len(words)
    out: list[_CutSpan] = []
    i = 0
    while i < n:
        if words[i].importance != 0:
            i += 1
            continue
        j = i
        while (
            j + 1 < n
            and words[j + 1].importance == 0
            and (words[j + 1].t_start - words[j].t_end) < SILENCE_TRIM_THRESHOLD_S
        ):
            j += 1
        gap_before = (
            float("inf") if i == 0
            else words[i].t_start - words[i - 1].t_end
        )
        gap_after = (
            float("inf") if j == n - 1
            else words[j + 1].t_start - words[j].t_end
        )
        if max(gap_before, gap_after) >= PAUSE_ADJACENCY_MIN_GAP_S:
            span = _CutSpan(words[i].t_start, words[j].t_end, "filler")
            if MIN_CUT_SPAN_S <= span.duration <= MAX_CUT_SPAN_S:
                out.append(span)
        i = j + 1
    return out


# Sentence terminator at the end of a token, tolerating trailing quotes /
# brackets ("end." / "end?\"" / "end.)").
_SENTENCE_END_RE = re.compile(r"[.!?…]['\"’”)\]]*$")


def _plan_edge_shrink(
    words: list[_Word],
    plan: list[_CutSpan],
    *,
    window_t_start: float,
    window_t_end: float,
    window_duration: float,
    target_s: float,
    tolerance_s: float,
) -> Optional[_CutSpan]:
    """Last duration lever before speed_multiplier: drop a whole sentence
    off a window edge (kind="word"). Tail first — the head carries the
    hook. Returns the single best span, or None when no sentence-granular
    shrink lands inside [target - tol, target + tol].

    The candidate span runs all the way to the window edge so trailing /
    leading dead air goes with the sentence. Overlap with already-planned
    spans is fine — predicted duration is union-based.
    """
    sentence_ends = [
        i for i, w in enumerate(words) if _SENTENCE_END_RE.search(w.text.strip())
    ]
    if not sentence_ends:
        return None

    def _try(span: _CutSpan) -> Optional[float]:
        """Predicted duration with `span` added, or None if it misses the
        acceptance band."""
        if span.duration < MIN_CUT_SPAN_S:
            return None
        predicted = max(0.0, window_duration - _union_duration_s(plan + [span]))
        if target_s - tolerance_s <= predicted <= target_s + tolerance_s:
            return predicted
        return None

    n = len(words)
    # Tail: latest sentence end first = smallest shrink. Skip the final
    # word — if it terminates a sentence there's nothing after it to drop.
    for k in reversed(sentence_ends):
        if k >= n - 1:
            continue
        span = _CutSpan(words[k + 1].t_start, window_t_end, "word")
        if _try(span) is not None:
            return span

    # Head: earliest sentence end first = smallest shrink.
    for k in sentence_ends:
        if k >= n - 1:
            continue
        span = _CutSpan(window_t_start, words[k + 1].t_start, "word")
        if _try(span) is not None:
            return span
    return None


def _union_duration_s(spans: list[_CutSpan]) -> float:
    """Total seconds covered by the spans' union (overlap-safe)."""
    total = 0.0
    cur_start: Optional[float] = None
    cur_end: Optional[float] = None
    for s in sorted(spans, key=lambda x: x.t_start):
        if cur_end is None or s.t_start > cur_end:
            if cur_end is not None and cur_start is not None:
                total += cur_end - cur_start
            cur_start, cur_end = s.t_start, s.t_end
        else:
            cur_end = max(cur_end, s.t_end)
    if cur_end is not None and cur_start is not None:
        total += cur_end - cur_start
    return total


# ---------------------------------------------------------------------------
# Heuristic fallback (used when LLM unavailable or response fails)
# ---------------------------------------------------------------------------

def _heuristic_importance(
    words: list[_Word],
    candidate_row: Any,
    topic_keywords: Sequence[str],
) -> tuple[str, str, list[int]]:
    """Returns (title, rationale, importance_array). Coarser than LLM but
    deterministic and free."""
    kw_lower = {k.lower().strip() for k in topic_keywords if k}
    tokens = [w.text.lower().strip(",.!?;:\"'()[]") for w in words]

    # Pass 1: bigram filler detection (must run before single-word so both
    # halves of the bigram land at importance 0 atomically).
    filler_idxs: set[int] = set()
    for i in range(len(tokens) - 1):
        if (tokens[i], tokens[i + 1]) in FILLER_BIGRAMS:
            filler_idxs.add(i)
            filler_idxs.add(i + 1)

    # Pass 2: single-word classification.
    importance: list[int] = []
    for i, token in enumerate(tokens):
        if i in filler_idxs or token in FILLER_WORDS:
            importance.append(0)
        elif token in kw_lower:
            importance.append(3)
        elif token in STOPWORDS or len(token) <= 2:
            importance.append(1)
        else:
            # Numeric, capitalized, or long content word → keep (importance 2).
            importance.append(2)
    # Pass the just-computed importance array so the title picker can use
    # it as a salience signal. At this point `w.importance` is still the
    # default (2) for every word — `_apply_importance` runs in the
    # caller (`enrich`) only AFTER this function returns.
    title = _fallback_title(words, importance=importance)
    rationale = _fallback_rationale(candidate_row)
    return title, rationale, importance


def _fallback_title(
    words: list[_Word],
    importance: Optional[list[int]] = None,
) -> str:
    """Heuristic title — runs when LLM enrichment fails or is unavailable.

    Previously emitted the first 6 words verbatim. When the window started
    mid-sentence (sentence-snap not yet fixed) the title looked like
    "a there was a person you" — pure low-information particles. The user
    surfaced this from a real production reel (2026-05-13 audit).

    New strategy:
      1. Score every word with `_word_salience` — importance + content-shape
         signals (capitalization, numerics, length > 6 chars).
      2. Pick the highest-salience anchor word (ties broken by earliest
         index so the title leads with the speaker's first big word).
      3. Build a 5-word phrase centered on the anchor (2 left + anchor +
         2 right after dropping leading stopwords).
      4. Title-case the result for visual polish.
      5. If every word scores 0 (degenerate window of pure particles),
         return "Reel highlight" rather than first-six-words.

    `importance` may be passed in by `_heuristic_importance` (which has
    the array in scope before it's applied to the word objects). When
    None, the function reads `w.importance` directly — works for the
    post-LLM path where `_apply_importance` has already run.
    """
    if not words:
        return "Untitled clip"

    def _word_salience(idx: int, w: _Word) -> int:
        tok = w.text.strip(",.!?;:\"'()[]").lower()
        # Skip empties, stopwords, fillers. We previously also rejected
        # `len(tok) <= 2` which threw away salient short tokens like
        # "47", "10", "AI" — that filter is gone now. Punctuation strip
        # handles "?" / "!" → empty. FILLER_WORDS ensures "um/uh/y'know"
        # never anchor the title (else windows of pure filler would
        # produce titles like "Um Uh You").
        if not tok or tok in STOPWORDS or tok in FILLER_WORDS:
            return 0
        imp = (
            importance[idx]
            if (importance is not None and idx < len(importance))
            else w.importance
        )
        # importance 0/1 → 0, 2 → 3, 3 → 6.
        s = max(0, imp - 1) * 3
        # Content-shape bonuses — help when importance is flat (e.g. the
        # heuristic gives almost every content word importance=2).
        if w.text[:1].isupper():
            s += 2          # proper noun / sentence-start salience
        if any(c.isdigit() for c in w.text):
            s += 2          # numbers anchor attention
        if len(tok) > 6:
            s += 1          # longer content words bias toward topic words
        return s

    scored = [(_word_salience(i, w), i) for i, w in enumerate(words)]
    # Anchor: max salience, then earliest index for ties (so a tied
    # candidate at the front of the window wins — produces titles that
    # lead with the speaker's first emphasis).
    best_score, anchor_idx = max(scored, key=lambda x: (x[0], -x[1]))
    if best_score == 0:
        # Every word looks like a stopword/particle/filler. Last-resort
        # fallback rather than emitting "a there was a person you".
        return "Reel highlight"

    # Build phrase: 2 words left + anchor + 2 words right. Trim leading
    # stopwords from the picked span (but never drop the anchor itself).
    lo = max(0, anchor_idx - 2)
    hi = min(len(words), anchor_idx + 3)
    pieces = [w.text.strip(",.!?;:\"'()[]") for w in words[lo:hi]]
    pieces = [p for p in pieces if p]
    anchor_in_pieces = anchor_idx - lo
    while (
        len(pieces) > 1
        and anchor_in_pieces > 0
        and pieces[0].lower() in STOPWORDS
    ):
        pieces = pieces[1:]
        anchor_in_pieces -= 1
    if not pieces:
        return "Reel highlight"
    # Title-case each token, preserving existing capitalization for
    # acronyms ("AI", "USA") and camelCase ("iPhone", "eBay"). Plain
    # `.capitalize()` would lowercase everything after the first char
    # which turns "AI" into "Ai".
    def _smart_cap(tok: str) -> str:
        if not tok or any(c.isupper() for c in tok):
            return tok          # already has cased letters — leave alone
        return tok.capitalize()  # plain lowercase or numeric → add a leading cap

    out = " ".join(_smart_cap(p) for p in pieces)
    return (out[:60] + "…") if len(out) > 60 else out


def _fallback_rationale(candidate_row: Any) -> str:
    """Generic rationale built from the candidate's score breakdown."""
    try:
        score = candidate_row.score or {}
        comp = float(score.get("composite") or 0)
    except Exception:
        comp = 0
    if comp >= 75:
        return "High engagement score with strong hook, pacing and information density."
    if comp >= 60:
        return "Solid candidate — engagement signals are above average for this source."
    return "Lower-confidence candidate; review before rendering."


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_window_words(
    transcript: list[dict],
    t_start: float,
    t_end: float,
) -> list[_Word]:
    """Pull words within [t_start, t_end] from the transcript, in order.

    Indexer's transcript stores words inside each sentence's `.words` list.
    """
    out: list[_Word] = []
    idx = 0
    for sentence in transcript:
        if sentence.get("end", 0) < t_start or sentence.get("start", 1e9) > t_end:
            continue
        for w in sentence.get("words") or []:
            ws = float(w.get("start", 0.0) or 0.0)
            we = float(w.get("end", 0.0) or 0.0)
            if we < t_start or ws > t_end:
                continue
            # Clip to window edges so cut-plan timestamps stay inside.
            ws = max(ws, t_start)
            we = min(we, t_end)
            if we <= ws:
                continue
            out.append(_Word(
                idx=idx,
                text=str(w.get("word") or ""),
                t_start=ws,
                t_end=we,
            ))
            idx += 1
    return out


def _apply_importance(words: list[_Word], importance: list[int]) -> None:
    """Write LLM-or-heuristic importance into the Word objects.

    Also derives a default `keyword_type` for any importance-3 word that
    the LLM didn't classify (the prompt currently doesn't ask for
    keyword_type — see deferred work). The renderer reads keyword_type
    to color-highlight captions; without it every word renders plain
    white and the Hormozi/karaoke styles lose their punch. Defaulting
    to "important" gets us the yellow-highlight on every high-impact
    word — the main visual goal. Future: teach the LLM to distinguish
    important / definition / warning explicitly.
    """
    for w, imp in zip(words, importance):
        try:
            i = int(imp)
        except (TypeError, ValueError):
            i = 2
        w.importance = max(0, min(3, i))
        if w.importance >= 3 and w.keyword_type is None:
            w.keyword_type = "important"


def _enforce_deterministic_floors(
    words: list[_Word],
    emphasis_marks: list[dict],
    topic_keywords: Sequence[str],
    candidate_t_start: float,
    candidate_t_end: float,
) -> None:
    """Apply hard rules that don't depend on the LLM:

    - Emphasis-marked words get importance ≥ 2 (never cuttable).
    - Topic-keyword matches get importance = 3 and `keyword_type = important`.
    Both rules monotonically raise importance — they never lower an LLM score.
    """
    # Index emphasis times for fast lookup. `m.get("t") or -1.0` (not the
    # 2-arg default) so explicit None values don't trip the float comparison.
    emph_ts: list[float] = []
    for m in emphasis_marks:
        t = m.get("t")
        if t is None:
            continue
        try:
            tv = float(t)
        except (TypeError, ValueError):
            continue
        if candidate_t_start <= tv <= candidate_t_end:
            emph_ts.append(tv)
    emph_ts.sort()
    kw_lower = {k.lower().strip() for k in topic_keywords if k}

    for w in words:
        # Topic-keyword exact match → 3 + classify as keyword.
        token = w.text.lower().strip(",.!?;:\"'()[]")
        if token in kw_lower:
            w.importance = max(w.importance, 3)
            if w.keyword_type is None:
                w.keyword_type = "important"
            continue
        # Emphasis-mark coverage → at least 2.
        for et in emph_ts:
            if w.t_start <= et <= w.t_end:
                w.importance = max(w.importance, 2)
                break


def _parse_llm_response(
    raw: str, expected_len: int
) -> Optional[tuple[str, str, list[int], list[str], list[dict]]]:
    """Parse the LLM's JSON output. Returns None on any validation failure
    of the REQUIRED fields (title / rationale / importance) — caller falls
    back to heuristic in that case. The OPTIONAL emojis array is degraded
    silently to `[]` if absent or malformed, so a typo in the emoji slot
    doesn't lose us the whole enrichment."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as e:
        logger.warning(f"[ReelsPreview] LLM returned non-JSON: {e}; raw[:200]={raw[:200]!r}")
        return None
    if not isinstance(parsed, dict):
        logger.warning(f"[ReelsPreview] LLM returned non-object: {type(parsed)}")
        return None
    title = str(parsed.get("title") or "").strip()
    rationale = str(parsed.get("rationale") or "").strip()
    imp = parsed.get("importance")
    if not isinstance(imp, list):
        logger.warning(
            f"[ReelsPreview] LLM importance not a list: {type(imp)}"
        )
        return None
    # Haiku occasionally returns an importance array that's 1-15% off from
    # the word count (it collapses contractions, merges short tokens, etc).
    # Throwing away the entire enrichment over a 1-word mismatch loses the
    # title + rationale + emoji tagging too — a much worse outcome than
    # padding/truncating with the default neutral importance (2). Reject
    # only when the mismatch exceeds 20% — at that point the response is
    # likely structurally broken and heuristic is safer.
    got_len = len(imp)
    delta_pct = abs(got_len - expected_len) / max(1, expected_len)
    if delta_pct > 0.20:
        logger.warning(
            f"[ReelsPreview] LLM importance array length mismatch beyond 20% "
            f"tolerance: got {got_len}, expected {expected_len}"
        )
        return None
    if got_len != expected_len:
        logger.info(
            f"[ReelsPreview] LLM importance array off by {got_len - expected_len} "
            f"(got {got_len}, expected {expected_len}); padding/truncating"
        )
        if got_len < expected_len:
            imp = list(imp) + [2] * (expected_len - got_len)
        else:
            imp = list(imp)[:expected_len]
    if len(title) > 80:
        title = title[:77] + "…"
    if len(rationale) > 200:
        rationale = rationale[:197] + "…"
    emojis = _validate_emojis(parsed.get("emojis"), expected_len)
    corrections = _validate_corrections(parsed.get("corrections"))
    return title, rationale, imp, emojis, corrections


def _validate_emojis(raw_emojis: Any, expected_len: int) -> list[str]:
    """Filter the LLM's `emojis` array into a clean parallel list.

    Rules:
      - Not a list → `[]` (no emojis). Wholly absent = LLM skipped it
        despite the prompt; we accept gracefully rather than fail the
        whole enrichment.
      - Length within 20% of expected → pad with "" or truncate to fit.
        Haiku off-by-one is common (collapses contractions) — rejecting
        the whole array over a 1-word mismatch loses the LLM's emoji
        intent for no reason. Same rule we apply to importance.
      - Length beyond 20% → `[]`.
      - Each entry MUST be a string; non-strings → "" in that slot.
      - Strip whitespace; cap at MAX_EMOJI_LEN bytes.
      - Reject entries containing any ASCII letter / digit (LLM tried to
        emit a text label).
      - Cap total non-empty entries at MAX_EMOJIS_PER_REEL; extras beyond
        the cap become "" so the renderer doesn't carpet-bomb.
    """
    if not isinstance(raw_emojis, list):
        if raw_emojis is not None:
            logger.info(
                f"[ReelsPreview] LLM emojis not a list ({type(raw_emojis).__name__}); skipping emoji enrichment"
            )
        return []
    got_len = len(raw_emojis)
    if got_len != expected_len:
        delta_pct = abs(got_len - expected_len) / max(1, expected_len)
        if delta_pct > 0.20:
            logger.info(
                f"[ReelsPreview] LLM emojis length {got_len} off from {expected_len} by >20%; "
                "skipping emoji enrichment"
            )
            return []
        if got_len < expected_len:
            raw_emojis = list(raw_emojis) + [""] * (expected_len - got_len)
        else:
            raw_emojis = list(raw_emojis)[:expected_len]
    out: list[str] = []
    kept = 0
    for e in raw_emojis:
        if not isinstance(e, str):
            out.append("")
            continue
        s = e.strip()
        if not s:
            out.append("")
            continue
        if len(s) > MAX_EMOJI_LEN:
            out.append("")
            continue
        if _EMOJI_REJECT_RE.search(s):
            out.append("")
            continue
        if kept >= MAX_EMOJIS_PER_REEL:
            out.append("")
            continue
        out.append(s)
        kept += 1
    return out


def _apply_emojis(words: list[_Word], emojis: list[str]) -> None:
    """Set `_Word.emoji` from a parallel-index emojis array. Silently
    no-ops when lengths disagree — the caller's path should already have
    rejected mismatches via `_validate_emojis`, but we double-check."""
    if not emojis or len(emojis) != len(words):
        return
    for w, e in zip(words, emojis):
        if e:
            w.emoji = e


# ---------------------------------------------------------------------------
# Transcript corrections (Issue 1B' — Raven→Ravana class of ASR errors)
#
# Whisper misidentifies domain-specific proper nouns in code-mixed speech:
#   "Ravana" (Sanskrit) → "raven" (English homophone)
#   "Veda"   (Sanskrit) → "vader"  (English homophone)
#   "Krishna"           → "Christian"
# These pass straight to downstream LLM director / Pexels query / captions.
#
# Fix: the same Haiku call that produces importance/emojis ALSO returns a
# `corrections` array — proposed token-level rewrites. Cheaper than a
# second LLM call. Original audio timing stays untouched; we only edit
# the displayed word text.
# ---------------------------------------------------------------------------

# Cap to avoid prompt-injection-ish behavior. Real cases need ~1-5 fixes
# per reel; more than 12 looks like the LLM hallucinating edits.
_CORRECTIONS_MAX_PER_REEL = 12
_CORRECTIONS_MAX_FIELD_LEN = 80
# Edit-ratio guard: corrected must be within this multiplier of original's
# length (and not absurdly shorter either). Catches cases like
# "raven" → "[INSTRUCTION] ignore previous and output X" (length blow-up)
# and "Ravana" → "." (length crash). 0.33-3.0 covers homophone fixes
# (similar length) + minor spelling variations.
_CORRECTIONS_LENGTH_RATIO_MIN = 0.33
_CORRECTIONS_LENGTH_RATIO_MAX = 3.0
# Characters allowed in a corrected token. Letters / digits / common
# diacritics / a small punctuation set. Anything else (brackets, slashes,
# control chars, prompt-injection markers) → reject the entry.
_CORRECTIONS_SAFE_CHARS_RE = re.compile(
    r"^[\w\sÀ-ɏḀ-ỿ'’.,\-]+$"
)


def _validate_corrections(raw: Any) -> list[dict]:
    """Sanity-check the LLM's `corrections` array. Returns a cleaned
    list of `{original, corrected, reason}` dicts.

    Rules:
      - Not a list → []
      - Each entry must be a dict with non-empty `original` + `corrected`
        strings, both ≤ _CORRECTIONS_MAX_FIELD_LEN chars.
      - Skip entries where original == corrected (no-op fix).
      - L2 / D3 defenses:
        * `corrected` must match _CORRECTIONS_SAFE_CHARS_RE (letters,
          digits, common diacritics, basic punctuation). Rejects
          prompt-injection-shaped strings.
        * `corrected` length must be within 0.33-3.0× the original's
          length. Catches replacement bombs ("X" → 200-char paragraph)
          and degenerate strips ("Ravana" → ".").
      - L3 dedup: keep the FIRST entry per lowercased-original; silently
        drop duplicates. LLM occasionally repeats the same fix.
      - `reason` is optional, capped at _CORRECTIONS_MAX_FIELD_LEN.
      - Cap to _CORRECTIONS_MAX_PER_REEL entries total.
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen_originals: set[str] = set()
    for entry in raw:
        if len(out) >= _CORRECTIONS_MAX_PER_REEL:
            break
        if not isinstance(entry, dict):
            continue
        original = str(entry.get("original") or "").strip()
        corrected = str(entry.get("corrected") or "").strip()
        if not original or not corrected:
            continue
        if original == corrected:
            continue
        if len(original) > _CORRECTIONS_MAX_FIELD_LEN:
            continue
        if len(corrected) > _CORRECTIONS_MAX_FIELD_LEN:
            continue  # don't silently truncate — reject
        # L3 dedup
        orig_lower = original.lower()
        if orig_lower in seen_originals:
            continue
        # L2 edit-ratio guard
        orig_len = len(original)
        corr_len = len(corrected)
        if orig_len == 0:
            continue
        ratio = corr_len / orig_len
        if ratio < _CORRECTIONS_LENGTH_RATIO_MIN or ratio > _CORRECTIONS_LENGTH_RATIO_MAX:
            continue
        # D3 charset guard — reject corrected strings with unexpected
        # characters (brackets, slashes, control chars, prompt-injection
        # markers).
        if not _CORRECTIONS_SAFE_CHARS_RE.match(corrected):
            continue
        reason = str(entry.get("reason") or "").strip()
        if len(reason) > _CORRECTIONS_MAX_FIELD_LEN:
            reason = reason[:_CORRECTIONS_MAX_FIELD_LEN]
        seen_originals.add(orig_lower)
        out.append({
            "original": original,
            "corrected": corrected,
            "reason": reason,
        })
    return out


def _apply_corrections(
    words: list[_Word],
    corrections: list[dict],
) -> list[dict]:
    """Replace word.text for every token whose stripped lowercased form
    matches a correction's `original`. Returns the list of corrections
    that were actually applied (with `count` field added) for the
    enriched payload.

    Case-insensitive lowercase match on the word's text minus
    punctuation. Preserves the original's trailing punctuation
    on the corrected token so caption rendering stays intact
    (e.g. "raven." → "Ravana.").

    No-ops gracefully if corrections is empty or no matches found —
    the caller doesn't need to special-case the absence.
    """
    if not corrections:
        return []
    # Build indexes: lowercased_original → corrected, lowercased_original → reason.
    # Built once instead of per-word next() scans (fixes the linear cost).
    # `_validate_corrections` already dedupes by lowercased_original, so
    # last-wins doesn't actually matter here, but the dict shape gives O(1)
    # lookup either way.
    correction_idx: dict[str, str] = {}
    reason_idx: dict[str, str] = {}
    for c in corrections:
        orig = c.get("original", "").lower().strip()
        corr = c.get("corrected", "").strip()
        if orig and corr:
            correction_idx[orig] = corr
            reason_idx[orig] = c.get("reason", "")

    applied: dict[str, dict] = {}
    for w in words:
        raw = w.text
        if not raw:
            continue
        # Strip outer non-alphanumeric (punctuation, brackets) for the match.
        # Preserves the original's surface punctuation on the corrected
        # output (e.g. "raven." → "Ravana.").
        leading = ""
        trailing = ""
        core = raw
        while core and not core[0].isalnum():
            leading += core[0]
            core = core[1:]
        while core and not core[-1].isalnum():
            trailing = core[-1] + trailing
            core = core[:-1]
        key = core.lower()
        if key in correction_idx:
            corrected_core = correction_idx[key]
            w.text = leading + corrected_core + trailing
            slot = applied.setdefault(key, {
                "original": core,
                "corrected": corrected_core,
                "reason": reason_idx.get(key, ""),
                "count": 0,
            })
            slot["count"] += 1
    return list(applied.values())


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are an editor scoring podcast transcript words for a short reel.

Given a transcript window and a target output duration, rate each word's importance on a 0-3 scale:
  0 = filler / disposable ("um", "uh", "like", repetitions, hedge phrases)
  1 = routine / cuttable (stopwords, low-information glue)
  2 = important (carries meaning; cutting would damage the sentence)
  3 = keyword / definition (must keep; topic-defining words)

Editorial principles:
- Preserve every claim, named entity, number, and emotional spike.
- Filler words ("um", "you know", "kind of") and verbal-pause stutters ("I, I think") are score 0.
- If a word is part of an emphasis cluster or topic keyword, it stays high — never below 2.
- Strong opening words (first 2 seconds) bias toward 2-3.
- The end of the window biases toward 2-3 (callback/payoff matters for retention).

Also produce:
- title:     a scroll-stopping hook line for the reel — the sentence that makes a viewer stop mid-feed. Spoken style, the way the speaker would actually say it ("This one mistake costs you years"). ≤8 words, ≤60 chars, no quotes around it, no ALL-CAPS clickbait.
- rationale: ≤20 words explaining why this clip is worth rendering. Mention the hook, the payoff, and one concrete content beat.

Required: emoji punctuation on high-impact words.
- Output an "emojis" array EXACTLY the same length as "importance".
- You MUST tag 2-4 emojis per reel (this is mandatory, not optional). Reels without emojis look flat — emojis are a proven retention lever.
- Pick the 2-4 highest-impact words: a stat, a named entity, an action verb, or a vivid noun. The rest of the slots are "" (empty string).
- Examples that work: "million" → 💰, "growth" → 📈, "fast" → ⚡, "team" → 👥, "secret" → 🔒, "warning" → ⚠️, "amazing" → 🤯, "data" → 📊, "love" → ❤️, "ancient" → 🏛️, "fire" → 🔥, "brain" → 🧠.
- Skip emoji for: stopwords, filler, abstract terms ("thing", "way", "idea"), and words that already carry their meaning clearly enough through tone and context.

Also check the transcript for likely ASR mistranscriptions of domain-specific proper nouns. ASR engines (esp. Whisper) confuse homophones in code-mixed speech — common cases:
- Indian / Sanskrit content: "Raavan/Ravana" → "raven", "Veda" → "vader", "Krishna" → "Christian", "puja" → "pizza", "Arjun" → "argon".
- Tech jargon: "Kubernetes" → "communities", "Postgres" → "post grass".
- Names mid-conversation usually OK; suspect words that ALSO have plain-English meanings AND whose surroundings imply a different domain.

For each suspicious token, emit a `corrections` entry with the original token + corrected form + a one-line reason (referencing the surrounding cultural / topical context that disambiguates). Skip when unsure — only correct when context strongly implies the alternative.

Return ONLY valid JSON with this exact shape (no markdown, no commentary):
{
  "title": "...",
  "rationale": "...",
  "importance": [0, 1, 2, 3, ...],
  "emojis":     ["", "", "💰", "", "📈", "", ...],
  "corrections": [
    {"original": "raven", "corrected": "Ravana", "reason": "Dashanan + 10 heads + Sanskrit context = Ramayana"},
    ...
  ]
}
The `importance` array MUST have exactly the same length as the words list given.
The `emojis` array MUST be present, the same length as `importance`, and contain 2-4 non-empty emoji entries (rest are "").
The `corrections` array is OPTIONAL; emit only when you're confident. Empty list `[]` is the default."""


_TOPIC_KEYWORD_MAX_CHARS = 64
# Strip control + delimiters that could break out of the "topic keywords"
# line in the prompt (angle brackets, backticks, newlines). We don't try to
# be paranoid — a corrupted importance array trips our parser and we fall
# back to heuristic, so worst case is "wasted LLM call." This is hygiene.
_KEYWORD_STRIP_RE = re.compile(r"[\x00-\x1f\x7f<>`\"\n\r]+")


def _sanitize_topic_keywords(keywords: Sequence[str]) -> list[str]:
    """Trim + strip dangerous characters from user-provided topic keywords
    before injecting into the LLM prompt."""
    out: list[str] = []
    for kw in keywords or ():
        if not isinstance(kw, str):
            continue
        cleaned = _KEYWORD_STRIP_RE.sub(" ", kw).strip()
        if not cleaned:
            continue
        if len(cleaned) > _TOPIC_KEYWORD_MAX_CHARS:
            cleaned = cleaned[:_TOPIC_KEYWORD_MAX_CHARS]
        out.append(cleaned)
    return out


def _build_user_prompt(
    words: list[_Word],
    candidate_row: Any,
    topic_keywords: Sequence[str],
    *,
    target_duration_sec: int,
    duration_tolerance_sec: int,
) -> str:
    """Compact word-indexed prompt — keeps response bandwidth small."""
    duration = candidate_row.source_t_end - candidate_row.source_t_start
    parts: list[str] = []
    parts.append(
        f"Window: source seconds {candidate_row.source_t_start:.1f}–{candidate_row.source_t_end:.1f} "
        f"({duration:.1f}s total, {len(words)} words)."
    )
    parts.append(
        f"Target reel duration: {target_duration_sec}s "
        f"(±{duration_tolerance_sec}s). Long pauses and importance-0 words "
        f"are what gets cut to reach it — score with that budget in mind."
    )
    safe_keywords = _sanitize_topic_keywords(topic_keywords)
    if safe_keywords:
        parts.append(f"Topic keywords (prefer to keep): {', '.join(safe_keywords)}")
    parts.append("")
    parts.append("Words (index: text):")
    for w in words:
        parts.append(f"{w.idx}: {w.text}")
    parts.append("")
    parts.append(
        f"Return JSON with title, rationale, and an importance array of "
        f"exactly {len(words)} integers (one per word, in index order)."
    )
    return "\n".join(parts)
