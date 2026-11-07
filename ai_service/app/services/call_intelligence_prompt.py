"""Prompt builder for CRM call-recording analysis.

Produces a single strict-JSON instruction the LLM answers from a call transcript.
The output contract is FIXED (so the columns + dashboards stay stable); only the
call objective and the rubric quality breakdown are institute-tunable:

  - The objective is INFERRED from the transcript (an optional objective_hint
    only nudges that inference) — institutes don't have to configure goals.
  - rubric.qualities + rubric.weights steer the caller_self_goal_rating breakdown.

Transcripts are Hindi / English / code-mixed (Hinglish); the model reads all of
them. schema_version is bumped whenever this contract changes.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

# Bumped on any change to the output contract below. Stored on every row so old
# analyses remain interpretable when the schema evolves.
SCHEMA_VERSION = "1.1"   # 1.1: + `update` (two-line call update for the call log)
PROMPT_VERSION = "ci-1.1"

DEFAULT_QUALITIES = ["rapport", "needs_discovery", "objection_handling", "next_step_secured"]


def build_prompt(
    transcript: str,
    *,
    rating_scale: int = 10,
    objective_hint: Optional[str] = None,
    qualities: Optional[List[Any]] = None,
    weights: Optional[Dict[str, float]] = None,
    direction: Optional[str] = None,
    source: Optional[str] = None,
    duration_seconds: Optional[int] = None,
) -> str:
    """Build the analysis prompt. `transcript` is the (possibly Hinglish) call text.

    `qualities` items may be a bare string (the metric key) or a dict
    {"key": ..., "description": ...} — the description is an institute-authored
    definition of a (possibly custom) metric, so the model grades it as intended.
    """
    raw_qualities = qualities if qualities else DEFAULT_QUALITIES
    scale = rating_scale if rating_scale and rating_scale > 0 else 10

    def _line(q: Any) -> str:
        if isinstance(q, dict):
            key = str(q.get("key") or q.get("term") or "").strip()
            desc = (q.get("description") or "").strip()
        else:
            key = str(q).strip()
            desc = ""
        if not key:
            return ""
        w = f" (weight {weights[key]})" if weights and key in weights else ""
        return f'      - "{key}"{w}' + (f" — {desc}" if desc else "")

    quality_lines = "\n".join(line for q in raw_qualities if (line := _line(q)))

    context_bits = []
    if direction:
        context_bits.append(f"call direction: {direction}")
    if source:
        context_bits.append(f"recording source: {source}")
    if duration_seconds is not None:
        context_bits.append(f"duration: {duration_seconds}s")
    context_line = ("Call context — " + ", ".join(context_bits) + ".") if context_bits else ""

    objective_line = (
        f'The institute hints the intended objective is roughly: "{objective_hint}". '
        "Treat this only as a hint — infer the real objective from what actually happens in the call."
        if objective_hint
        else "No objective was configured — infer the caller's intended objective purely from the conversation."
    )

    # The exact JSON the model must return. Keep keys in sync with the
    # call_intelligence columns + analysis_json mapping in the service.
    schema = {
        "schema_version": SCHEMA_VERSION,
        "language": {"primary": "hi|en|mixed", "code_switching": True},
        "inferred_goal": {
            "objective": "string — what the caller was trying to achieve",
            "call_type": "SALES_OUTREACH|FOLLOW_UP|DEMO_BOOKING|OBJECTION_HANDLING|PAYMENT|SUPPORT|OTHER",
            "confidence": 0.0,
        },
        "general_summary": "string — 2-4 neutral sentences",
        "update": "string — the call in at most TWO short lines (max 160 characters total): "
                  "what happened, then what happens next. Plain words, no labels.",
        "action_items": [
            {"text": "string", "owner": "CALLER|LEAD|UNSPECIFIED", "due_hint": "string|null",
             "priority": "HIGH|MEDIUM|LOW"}
        ],
        "generic_status": "CONNECTED_POSITIVE|CONNECTED_NEUTRAL|CONNECTED_NEGATIVE|CALLBACK_REQUESTED|"
                          "NOT_INTERESTED|INFORMATION_ONLY|NO_CLEAR_OUTCOME|WRONG_NUMBER",
        "call_analysis": {
            "key_topics": ["string"],
            "objections": [{"objection": "string", "handled": True, "resolution": "string|null"}],
            "questions_by_lead": ["string"],
            "commitments": ["string"],
            "risk_flags": ["string"],
        },
        "sentiment": {
            "lead": "POSITIVE|NEUTRAL|NEGATIVE",
            "caller": "POSITIVE|NEUTRAL|NEGATIVE",
            "trajectory": "IMPROVED|FLAT|DECLINED",
        },
        "caller_self_goal_rating": {
            "score": f"number 0-{scale} — how well the caller advanced THEIR OWN objective",
            "rationale": "string",
            "qualities": [{"key": "one of the rubric qualities", "score": f"0-{scale}", "comment": "string"}],
        },
        "call_output_rating": {
            "score": f"number 0-{scale} — outcome strength from the LEAD's perspective",
            "rationale": "string",
            "conversion_likelihood": "HIGH|MEDIUM|LOW",
        },
        "next_best_action": "string",
        "coaching_tips": ["string — concrete, for the caller to improve"],
        "talk_ratio": {"caller_pct": 0, "lead_pct": 0},
        "highlights": [{"quote": "string (verbatim, original language)", "label": "string"}],
    }

    return f"""You are a sales-call quality analyst for an education CRM. Analyze ONE call between a counsellor (the CALLER) and a prospective student/parent (the LEAD).

{context_line}
{objective_line}

There is no speaker labelling — infer who is the caller vs the lead from the content. The transcript may be in Hindi, English, or mixed (Hinglish); understand all of them and write your output values in English (keep `highlights[].quote` verbatim in the original language).

Score TWO independent 0-{scale} ratings:
  1. caller_self_goal_rating.score — how effectively the CALLER advanced their own objective (a coaching/performance lens on the counsellor). Break it down across exactly these rubric qualities:
{quality_lines}
     Use the weights (when given) to inform the overall score.
  2. call_output_rating.score — how successful the call was as an OUTCOME, judged from the LEAD's side (interest, commitment, progress toward the objective).

Return ONLY a single JSON object, no markdown fences, no commentary, matching EXACTLY this shape (same keys, same enums):

{json.dumps(schema, indent=2, ensure_ascii=False)}

TRANSCRIPT:
\"\"\"
{transcript}
\"\"\"
"""
