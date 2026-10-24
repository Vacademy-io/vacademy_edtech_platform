"""
Cost Event Tracker — per-run observability for video-gen LLM/asset spend.

Runs IN PARALLEL with the existing per-stage `outputs["token_usage"]` aggregation.
Does NOT disrupt credit deduction or the existing summed-totals flow. Adds:
  • Per-event log: every LLM call, image gen, stock fetch, TTS synth recorded as a
    distinct dict with `phase` ("base" | "regen" | "retry"), `stage`, `model`,
    `tokens`, `cost_usd`, `outcome`, `duration_ms`.
  • `build_report()` → the cost_breakdown.json shape consumed by video_generation_service
    and uploaded to S3 alongside other per-run artifacts.

Phase semantics:
  • base   — first-pass LLM call for a given (stage, shot_idx). Default.
  • regen  — corrective regen triggered by bbox-lint / vision-review / brand-asset /
             back-half-motion validator. Wrapped by `_llm_phase.set("regen")`.
  • retry  — automatic retry of a base call (empty-string, transient error). Stamped
             inside OpenRouterClient.chat() when a retry attempt actually succeeds.

The tracker is owned by AutomationPipeline (`self._cost_events`) and threaded into
each LLM client via `client.cost_events = tracker`. Clients call `record_llm()` on
each successful chat() response. The pipeline reports the final breakdown via
`outputs["cost_breakdown"]` at the end of a run.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


# What a generated image is for. Billing charges every image event once, on
# its model (host_identity included: one per real Seedream call, not per shot).
IMAGE_PURPOSES = ("support_visual", "thumbnail", "host_identity", "cast_sheet", "keyframe", "other")


@dataclass
class CostEvent:
    """Single billable event in a video-gen run."""

    timestamp: str          # ISO8601 UTC
    stage: str              # e.g. "script", "director", "shot_html_seg_3", "vision_review_shot_5"
    phase: str              # "base" | "regen" | "retry"
    kind: str               # "llm" | "image" | "stock" | "tts" | "ai_video"
    model: str              # e.g. "google/gemini-3.1-pro-preview", "recraft-v4.1", "pexels-stock"
    prompt_tokens: int = 0
    completion_tokens: int = 0
    character_count: int = 0  # for TTS
    cost_usd: float = 0.0
    duration_ms: Optional[int] = None
    outcome: str = "ok"     # "ok" | "empty_string_recovered" | "parse_failed" | "ship_original_after_regen" | "error"
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    # Per-stage routing telemetry (V200). "" when stage routing is off / map
    # missing for this stage; otherwise one of:
    #   "matrix"           — admin default from ai_model_stage_assignments
    #   "user_default"     — user's ModelOverrides.default replaced the matrix
    #   "user_per_stage"   — user's ModelOverrides.per_stage[stage] replaced the matrix
    # Lands in cost_breakdown.json so forensics can answer "did the user
    # override actually land at runtime?".
    source: str = ""
    # Image events only: one of IMAGE_PURPOSES. "" for every other kind.
    purpose: str = ""


class CostEventTracker:
    """Append-only event log for a single video-gen run.

    Thread-safe for append operations under CPython (list.append is atomic).
    No locking needed for the common case of parallel-per-shot workers.
    """

    def __init__(self) -> None:
        self._events: List[CostEvent] = []
        self._anomalies: List[str] = []

    # ── Recording API ────────────────────────────────────────────────────

    def record_llm(
        self,
        stage: str,
        model: str,
        usage: Dict[str, Any],
        phase: str = "base",
        outcome: str = "ok",
        duration_ms: Optional[int] = None,
        cost_usd: float = 0.0,
        source: str = "",
    ) -> None:
        """Record one successful LLM completion. `usage` is the dict OpenRouter returns
        (with `prompt_tokens`, `completion_tokens`, optional `cache_read_input_tokens`,
        `cache_creation_input_tokens`).

        `source` (optional) attributes the model choice to the per-stage routing
        layer — see CostEvent.source docstring. Empty string ("") = legacy
        path / no stage routing active for this call.
        """
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="llm",
            model=model,
            prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
            completion_tokens=int(usage.get("completion_tokens", 0) or 0),
            cache_read_input_tokens=int(usage.get("cache_read_input_tokens", 0) or 0),
            cache_creation_input_tokens=int(usage.get("cache_creation_input_tokens", 0) or 0),
            cost_usd=float(cost_usd or 0.0),
            duration_ms=duration_ms,
            outcome=outcome,
            source=source,
        ))

    def record_image(
        self,
        stage: str,
        model: str,
        phase: str = "base",
        cost_usd: Optional[float] = 0.0,
        outcome: str = "ok",
        purpose: str = "other",
    ) -> None:
        """Record ONE generated image. `model` is the real image model id
        (e.g. "recraft/recraft-v4.1"); `cost_usd` is the vendor's reported cost
        for the call, or None/0 when it reported none (billing then uses the
        model's unit price). An unknown `purpose` is booked as "other"."""
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="image",
            model=model,
            cost_usd=float(cost_usd or 0.0),
            outcome=outcome,
            purpose=purpose if purpose in IMAGE_PURPOSES else "other",
        ))

    def record_stock(
        self,
        stage: str,
        provider: str = "pexels",
        phase: str = "base",
        cost_usd: float = 0.0,
    ) -> None:
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="stock",
            model=provider,
            cost_usd=float(cost_usd or 0.0),
        ))

    def record_tts(
        self,
        stage: str,
        model: str,
        character_count: int,
        phase: str = "base",
        cost_usd: float = 0.0,
    ) -> None:
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="tts",
            model=model,
            character_count=int(character_count or 0),
            cost_usd=float(cost_usd or 0.0),
        ))

    def record_ai_video(
        self,
        stage: str,
        model: str,
        cost_usd: float,
        phase: str = "base",
        outcome: str = "ok",
    ) -> None:
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="ai_video",
            model=model,
            cost_usd=float(cost_usd or 0.0),
            outcome=outcome,
        ))

    def record_music(
        self,
        stage: str,
        model: str,
        duration_s: float,
        cost_usd: float,
        phase: str = "base",
        outcome: str = "ok",
    ) -> None:
        """Background music bed generation (Lyria, fal-ElevenLabs, etc.).

        Distinct from `record_sfx` so the ledger can break out music spend
        from per-cue SFX spend — useful when tuning tier cost budgets.
        """
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="music",
            model=model,
            character_count=int(max(0.0, float(duration_s or 0.0))),  # repurpose as seconds for music
            cost_usd=float(cost_usd or 0.0),
            outcome=outcome,
        ))

    def record_sfx(
        self,
        stage: str,
        model: str,
        duration_s: float,
        cost_usd: float,
        phase: str = "base",
        outcome: str = "ok",
    ) -> None:
        """Sound-effect / stinger / transition-whoosh generation.

        One CostEvent per generated cue. Library hits (sounds_metadata.json)
        cost $0 and don't go through here — only fresh API-generated audio
        creates a charge.
        """
        self._events.append(CostEvent(
            timestamp=_now_iso(),
            stage=stage,
            phase=phase,
            kind="sfx",
            model=model,
            character_count=int(max(0.0, float(duration_s or 0.0))),
            cost_usd=float(cost_usd or 0.0),
            outcome=outcome,
        ))

    def record_anomaly(self, message: str) -> None:
        """Surface a notable run-level observation in the final report
        (e.g. 'bbox-lint calls: 15 succeeded=0 (render worker 500)')."""
        self._anomalies.append(str(message))

    # ── Reporting ────────────────────────────────────────────────────────

    def build_report(
        self,
        video_id: str,
        tier: str,
        pipeline_version: str,
        run_started_at: Optional[str] = None,
        extra_anomalies: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Build the cost_breakdown.json payload. Safe to call multiple times
        (events are not mutated)."""
        run_completed_at = _now_iso()

        # Roll-ups by phase
        phase_totals: Dict[str, Dict[str, float]] = {
            "base": _zero_bucket(),
            "regen": _zero_bucket(),
            "retry": _zero_bucket(),
        }
        non_llm_total_usd = 0.0

        for ev in self._events:
            bucket = phase_totals.setdefault(ev.phase, _zero_bucket())
            bucket["prompt_tokens"] += ev.prompt_tokens
            bucket["completion_tokens"] += ev.completion_tokens
            bucket["character_count"] += ev.character_count
            bucket["cost_usd"] += ev.cost_usd
            bucket["event_count"] += 1
            if ev.kind in ("image", "stock", "tts", "ai_video"):
                non_llm_total_usd += ev.cost_usd

        total_usd = sum(b["cost_usd"] for b in phase_totals.values())

        summary: Dict[str, Any] = {
            "total_usd": round(total_usd, 4),
            "base_usd": round(phase_totals["base"]["cost_usd"], 4),
            "regen_usd": round(phase_totals["regen"]["cost_usd"], 4),
            "retry_usd": round(phase_totals["retry"]["cost_usd"], 4),
            "non_llm_usd": round(non_llm_total_usd, 4),
        }
        if total_usd > 0:
            summary["base_pct"] = round(100.0 * phase_totals["base"]["cost_usd"] / total_usd, 2)
            summary["regen_pct"] = round(100.0 * phase_totals["regen"]["cost_usd"] / total_usd, 2)
            summary["retry_pct"] = round(100.0 * phase_totals["retry"]["cost_usd"] / total_usd, 2)
        else:
            summary["base_pct"] = summary["regen_pct"] = summary["retry_pct"] = 0.0

        # Stage entries (flat list, ordered as recorded — preserves run trace)
        stages = [_event_to_stage_entry(ev) for ev in self._events]

        anomalies = list(self._anomalies)
        if extra_anomalies:
            anomalies.extend(str(a) for a in extra_anomalies)

        return {
            "video_id": video_id,
            "run_started_at": run_started_at,
            "run_completed_at": run_completed_at,
            "tier": tier,
            "pipeline_version": pipeline_version,
            "summary": summary,
            "stages": stages,
            "anomalies": anomalies,
        }

    @property
    def event_count(self) -> int:
        return len(self._events)


# ── Helpers ──────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _zero_bucket() -> Dict[str, float]:
    return {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "character_count": 0,
        "cost_usd": 0.0,
        "event_count": 0,
    }


def _event_to_stage_entry(ev: CostEvent) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "stage": ev.stage,
        "phase": ev.phase,
        "kind": ev.kind,
        "model": ev.model,
        "timestamp": ev.timestamp,
        "outcome": ev.outcome,
    }
    if ev.prompt_tokens or ev.completion_tokens:
        out["prompt_tokens"] = ev.prompt_tokens
        out["completion_tokens"] = ev.completion_tokens
    if ev.character_count:
        out["character_count"] = ev.character_count
    if ev.cache_read_input_tokens or ev.cache_creation_input_tokens:
        out["cache_read_input_tokens"] = ev.cache_read_input_tokens
        out["cache_creation_input_tokens"] = ev.cache_creation_input_tokens
    if ev.cost_usd:
        out["cost_usd"] = round(ev.cost_usd, 6)
    if ev.duration_ms is not None:
        out["duration_ms"] = int(ev.duration_ms)
    if ev.purpose:
        out["purpose"] = ev.purpose
    return out
