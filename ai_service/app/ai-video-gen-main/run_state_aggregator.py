"""Process-local live-progress aggregator for v3 video runs.

Single source of truth for "what is the pipeline doing right now" — feeds
the polling status endpoint and the post-run history view from the same
shape. Replaces the SSE event stream: the FE no longer subscribes; it
polls ``GET /external/video/v1/status/{video_id}`` and reads ``live``.

Threading model:
- Pipeline thread calls ``RunStateAggregator.handle_event(video_id, ev)``
  from any worker thread (HTML / TTS / Veo).
- FastAPI handler calls ``snapshot(video_id)`` from the event-loop thread.
- Per-entry RLock guards mutations; ``snapshot()`` returns a deep copy so
  the caller cannot mutate registry state.

Deployment assumption: single ai_service instance. If we ever scale out,
swap ``_RUNS`` for a Redis-backed dict — the public API is the choke point.

v3-only by design: legacy v2/v1 runs continue using
``repository.update_generation_progress`` and the prior SSE plumbing.
"""

from __future__ import annotations

import copy
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any, Deque, Dict, List, Optional


# ──────────────────────────────────────────────────────────────────────────
# Canonical IDs — must match FE PipelineNodeId in
# frontend-admin-dashboard/src/routes/video-api-studio/-components/pipeline/-utils/stage-vocab.ts
# ──────────────────────────────────────────────────────────────────────────

STAGE_PITCH = "pitch"
STAGE_RESEARCH = "research"
STAGE_SHOT_PLANNER = "shotPlanner"
STAGE_NARRATION_WRITER = "narrationWriter"
STAGE_FILMING = "filming"
STAGE_TALENT = "talent"
STAGE_SCORE = "score"
STAGE_FINAL_CUT = "finalCut"

V3_STAGES = [
    STAGE_PITCH,
    STAGE_RESEARCH,
    STAGE_SHOT_PLANNER,
    STAGE_NARRATION_WRITER,
    STAGE_FILMING,
    STAGE_TALENT,
    STAGE_SCORE,
    STAGE_FINAL_CUT,
]

# Mapping of legacy + v3 sub_stage strings → owning stage. Source of truth
# kept in sync with the FE's SUB_STAGE_BY_NODE.
SUB_STAGE_TO_STAGE: Dict[str, str] = {
    # Pitch (run start, configs hydrated)
    "run_started": STAGE_PITCH,
    "configs_hydrated": STAGE_PITCH,
    # Research (reference asset prefetch)
    "research_start": STAGE_RESEARCH,
    "research_done": STAGE_RESEARCH,
    # ShotPlanner (v3)
    "shot_planning": STAGE_SHOT_PLANNER,
    "shot_planning_done": STAGE_SHOT_PLANNER,
    # NarrationWriter (v3)
    "narration_writing": STAGE_NARRATION_WRITER,
    "narration_writing_done": STAGE_NARRATION_WRITER,
    # Filming (per-shot HTML + TTS + render-worker capture)
    "tts_generating": STAGE_NARRATION_WRITER,  # per-shot TTS rides Narration
    "tts_done": STAGE_NARRATION_WRITER,
    "html_generating": STAGE_FILMING,
    "html_done": STAGE_FILMING,
    "thumbnails_generating": STAGE_FILMING,
    "thumbnails_done": STAGE_FILMING,
    "thumbnails_failed": STAGE_FILMING,
    # Talent
    "avatar_batch_start": STAGE_TALENT,
    "avatar_image_audio_ready": STAGE_TALENT,
    "avatar_render_done": STAGE_TALENT,
    "avatar_failed": STAGE_TALENT,
    "avatar_batch_done": STAGE_TALENT,
    # Score
    "background_music_start": STAGE_SCORE,
    "background_music_segment": STAGE_SCORE,
    "background_music_concat": STAGE_SCORE,
    "background_music_done": STAGE_SCORE,
    # Final cut
    "render_start": STAGE_FINAL_CUT,
    "render_progress": STAGE_FINAL_CUT,
    "render_done": STAGE_FINAL_CUT,
}


# ──────────────────────────────────────────────────────────────────────────
# Snapshot dataclasses (asdict() round-trips cleanly to JSON)
# ──────────────────────────────────────────────────────────────────────────


# How much of a failure message to keep. Long enough that a raw model
# response is still diagnosable, short enough not to bloat run metadata.
_ERROR_KEEP = 4000


@dataclass
class StageProgress:
    state: str = "pending"  # pending | in_progress | wrapped | failed
    started_at: Optional[float] = None
    wrapped_at: Optional[float] = None
    message: Optional[str] = None  # human-readable substatus
    detail: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RegenRecord:
    step: str          # density | bbox | brand_asset | vision_review
    attempt: int
    verdict: str       # pass | fail | shipped_original
    reason: Optional[str] = None
    at: float = 0.0


@dataclass
class ShotProgress:
    idx: int
    shot_type: Optional[str] = None
    intent_role: Optional[str] = None
    audio_policy: Optional[str] = None
    background_treatment: Optional[str] = None
    transition_in: Optional[str] = None
    narration_brief: Optional[str] = None
    duration_estimate_s: Optional[float] = None
    state: str = "pending"             # pending | in_progress | wrapped | cut | reshoot
    substage: Optional[str] = None     # html_gen | density | bbox | brand | vision | screenshot | tts | media_polling
    attempts: Dict[str, int] = field(default_factory=dict)
    regen_log: List[RegenRecord] = field(default_factory=list)
    external_call_ids: List[str] = field(default_factory=list)
    cost_usd: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    started_at: Optional[float] = None
    wrapped_at: Optional[float] = None
    elapsed_s: Optional[float] = None
    last_error: Optional[str] = None


@dataclass
class ExternalCall:
    id: str
    provider: str                      # veo | seedream | pexels | elevenlabs | runpod
    op: str                            # submit | poll | render | tts
    state: str                         # queued | polling | done | failed
    shot_idx: Optional[int] = None
    request_id: Optional[str] = None
    started_at: float = 0.0
    finished_at: Optional[float] = None
    elapsed_s: Optional[float] = None
    poll_count: int = 0
    eta_s: Optional[float] = None
    error: Optional[str] = None


@dataclass
class CostSummary:
    spent_usd: float = 0.0
    spent_credits: float = 0.0
    cap_usd: Optional[float] = None
    cap_credits: Optional[float] = None
    tokens_prompt: int = 0
    tokens_completion: int = 0
    tokens_total: int = 0
    estimated_cost_usd: float = 0.0


@dataclass
class ProgressEvent:
    """Compact event record kept in the rolling log."""
    at: float
    type: str
    stage: Optional[str] = None
    shot_idx: Optional[int] = None
    message: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)


@dataclass
class LiveProgress:
    video_id: str
    status: str = "PENDING"            # PENDING | IN_PROGRESS | COMPLETED | FAILED | STALLED
    active_stage: str = STAGE_PITCH
    active_substage: Optional[str] = None
    director_thought: Optional[str] = None   # one-line "what the system is doing now"
    started_at: float = 0.0
    last_event_at: float = 0.0
    finished_at: Optional[float] = None
    stages: Dict[str, StageProgress] = field(default_factory=dict)
    shots: List[ShotProgress] = field(default_factory=list)
    recurring_motifs: List[Dict[str, Any]] = field(default_factory=list)
    external_calls: List[ExternalCall] = field(default_factory=list)
    costs: CostSummary = field(default_factory=CostSummary)
    event_log: Deque[ProgressEvent] = field(default_factory=lambda: deque(maxlen=200))


# ──────────────────────────────────────────────────────────────────────────
# Aggregator
# ──────────────────────────────────────────────────────────────────────────


class RunStateAggregator:
    """Singleton holding ``LiveProgress`` per video_id in process memory."""

    _EXTERNAL_LOG_CAP = 100

    def __init__(self) -> None:
        self._runs: Dict[str, LiveProgress] = {}
        self._locks: Dict[str, threading.RLock] = {}
        self._registry_lock = threading.Lock()

    # ── lifecycle ────────────────────────────────────────────────────────

    def start_run(self, video_id: str) -> LiveProgress:
        """Idempotent: returns the existing run if one is already registered."""
        with self._registry_lock:
            existing = self._runs.get(video_id)
            if existing is not None:
                return existing
            lp = LiveProgress(video_id=video_id, started_at=time.time())
            lp.last_event_at = lp.started_at
            lp.status = "IN_PROGRESS"
            for stage_id in V3_STAGES:
                lp.stages[stage_id] = StageProgress()
            # Pitch is "wrapped" the moment the run is registered — by then
            # the user has already submitted prompt + configs.
            lp.stages[STAGE_PITCH].state = "wrapped"
            lp.stages[STAGE_PITCH].started_at = lp.started_at
            lp.stages[STAGE_PITCH].wrapped_at = lp.started_at
            self._runs[video_id] = lp
            self._locks[video_id] = threading.RLock()
            return lp

    def end_run(self, video_id: str, terminal_status: str) -> None:
        """Mark terminal and keep the snapshot resident for a short window
        so late polls still see fresh data. The async flusher writes the
        final snapshot to the DB before drop_run is called by the caller."""
        lock = self._locks.get(video_id)
        if not lock:
            return
        with lock:
            lp = self._runs.get(video_id)
            if not lp:
                return
            lp.status = terminal_status
            lp.finished_at = time.time()
            lp.last_event_at = lp.finished_at
            # Mark every non-wrapped stage as wrapped on COMPLETED, failed on FAILED.
            for stage_id, sp in lp.stages.items():
                if sp.state in ("pending", "in_progress"):
                    if terminal_status == "COMPLETED":
                        sp.state = "wrapped"
                        sp.wrapped_at = lp.finished_at
                    elif terminal_status == "FAILED":
                        sp.state = "failed"
                        sp.wrapped_at = lp.finished_at

    def drop_run(self, video_id: str) -> None:
        with self._registry_lock:
            self._runs.pop(video_id, None)
            self._locks.pop(video_id, None)

    # ── snapshot read ────────────────────────────────────────────────────

    def has_run(self, video_id: str) -> bool:
        return video_id in self._runs

    def snapshot(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Return a JSON-serializable deep copy of the live state, or None."""
        lock = self._locks.get(video_id)
        if not lock:
            return None
        with lock:
            lp = self._runs.get(video_id)
            if not lp:
                return None
            return _serialize(lp)

    # ── event ingestion ──────────────────────────────────────────────────

    def handle_event(self, video_id: str, event: Dict[str, Any]) -> None:
        """Route a pipeline progress event into the structured snapshot.

        Safe to call from any thread. Unknown event types are appended to
        the rolling log but otherwise ignored — additive event taxonomy
        means new emit sites don't need aggregator changes to surface.
        """
        lock = self._locks.get(video_id)
        if not lock:
            # Auto-register on first event so callers don't have to coordinate.
            self.start_run(video_id)
            lock = self._locks.get(video_id)
            if not lock:
                return
        with lock:
            lp = self._runs.get(video_id)
            if not lp:
                return
            now = time.time()
            lp.last_event_at = now
            etype = event.get("type") or ""
            try:
                handler = _HANDLERS.get(etype)
                if handler is not None:
                    handler(lp, event, now)
            except Exception:
                # Never let an aggregator bug break the pipeline thread.
                pass
            # Always append a compact event-log record.
            lp.event_log.append(
                ProgressEvent(
                    at=now,
                    type=etype,
                    stage=lp.active_stage,
                    shot_idx=event.get("shot_idx") or event.get("shot_index"),
                    message=event.get("message"),
                    detail={k: v for k, v in event.items()
                            if k not in ("type", "message", "shot_idx", "shot_index",
                                         "shots_summary", "shot_plan", "thumbnails")},
                )
            )

    # ── DB flush helper (caller schedules) ───────────────────────────────

    def serialize_for_db(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Same as ``snapshot`` but with the rolling log truncated to the
        last 50 events to keep the JSONB row compact."""
        snap = self.snapshot(video_id)
        if snap is None:
            return None
        log = snap.get("event_log") or []
        snap["event_log"] = log[-50:]
        return snap


# ──────────────────────────────────────────────────────────────────────────
# Event handlers — one per event type. Pure functions; mutate ``lp`` only.
# ──────────────────────────────────────────────────────────────────────────


def _ensure_shot(lp: LiveProgress, idx: int) -> ShotProgress:
    while len(lp.shots) <= idx:
        lp.shots.append(ShotProgress(idx=len(lp.shots)))
    return lp.shots[idx]


def _set_stage_active(lp: LiveProgress, stage_id: str, message: Optional[str], now: float) -> None:
    if stage_id not in lp.stages:
        lp.stages[stage_id] = StageProgress()
    sp = lp.stages[stage_id]
    if sp.state == "pending":
        sp.state = "in_progress"
        sp.started_at = now
    sp.message = message or sp.message
    lp.active_stage = stage_id


def _wrap_stage(lp: LiveProgress, stage_id: str, now: float) -> None:
    if stage_id not in lp.stages:
        lp.stages[stage_id] = StageProgress()
    sp = lp.stages[stage_id]
    sp.state = "wrapped"
    sp.wrapped_at = now


def _handle_sub_stage(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    sub = (ev.get("sub_stage") or "").strip()
    if not sub:
        return
    lp.active_substage = sub
    msg = ev.get("message")
    stage_id = SUB_STAGE_TO_STAGE.get(sub)
    if stage_id:
        if sub.endswith("_done") or sub in ("avatar_batch_done", "thumbnails_done"):
            _wrap_stage(lp, stage_id, now)
        else:
            _set_stage_active(lp, stage_id, msg, now)
    # ShotPlanner finished — seed shots list from the summary if provided.
    if sub == "shot_planning_done":
        shots_summary = ev.get("shots_summary") or ev.get("shot_plan") or []
        if isinstance(shots_summary, list):
            for s in shots_summary:
                if not isinstance(s, dict):
                    continue
                idx = s.get("shot_index") if "shot_index" in s else s.get("idx")
                if idx is None:
                    continue
                shot = _ensure_shot(lp, int(idx))
                shot.shot_type = s.get("shot_type") or shot.shot_type
                shot.intent_role = s.get("intent_role") or shot.intent_role
                shot.audio_policy = s.get("audio_policy") or shot.audio_policy
                shot.background_treatment = s.get("background_treatment") or shot.background_treatment
                shot.transition_in = s.get("transition_in") or shot.transition_in
                shot.narration_brief = s.get("narration_brief") or shot.narration_brief
                shot.duration_estimate_s = s.get("duration_estimate_s") or shot.duration_estimate_s
        motifs = ev.get("recurring_motifs")
        if isinstance(motifs, list):
            lp.recurring_motifs = motifs


def _handle_shot_decisions(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    idx = ev.get("shot_idx") if "shot_idx" in ev else ev.get("shot_index")
    if idx is None:
        return
    shot = _ensure_shot(lp, int(idx))
    for k in ("shot_type", "intent_role", "audio_policy",
              "background_treatment", "transition_in",
              "narration_brief", "duration_estimate_s"):
        v = ev.get(k)
        if v is not None:
            setattr(shot, k, v)


def _handle_shot_substage(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    idx = ev.get("shot_idx") if "shot_idx" in ev else ev.get("shot_index")
    if idx is None:
        return
    shot = _ensure_shot(lp, int(idx))
    if shot.state == "pending":
        shot.state = "in_progress"
        shot.started_at = now
    shot.substage = ev.get("substage")
    _set_stage_active(lp, STAGE_FILMING, ev.get("message"), now)


def _handle_shot_regen_attempt(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    idx = ev.get("shot_idx") if "shot_idx" in ev else ev.get("shot_index")
    if idx is None:
        return
    shot = _ensure_shot(lp, int(idx))
    step = ev.get("step") or "unknown"
    attempt = int(ev.get("attempt") or 1)
    key = f"{step}_regen"
    shot.attempts[key] = max(shot.attempts.get(key, 0), attempt)
    shot.regen_log.append(
        RegenRecord(
            step=step,
            attempt=attempt,
            verdict=ev.get("verdict") or "fail",
            reason=ev.get("reason"),
            at=now,
        )
    )


def _handle_shot_done(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    idx = ev.get("shot_index") if "shot_index" in ev else ev.get("shot_idx")
    if idx is None:
        return
    shot = _ensure_shot(lp, int(idx))
    shot.state = "wrapped"
    shot.wrapped_at = now
    if shot.started_at:
        shot.elapsed_s = round(now - shot.started_at, 2)
    if ev.get("shot_type"):
        shot.shot_type = ev["shot_type"]
    tok = ev.get("token_delta") or {}
    if isinstance(tok, dict):
        shot.tokens_in += int(tok.get("prompt_tokens") or 0)
        shot.tokens_out += int(tok.get("completion_tokens") or 0)
    cum = ev.get("cumulative_tokens") or {}
    if isinstance(cum, dict):
        lp.costs.tokens_prompt = int(cum.get("prompt_tokens") or lp.costs.tokens_prompt)
        lp.costs.tokens_completion = int(cum.get("completion_tokens") or lp.costs.tokens_completion)
        lp.costs.tokens_total = int(cum.get("total_tokens") or lp.costs.tokens_total)
        if cum.get("estimated_cost_usd"):
            lp.costs.estimated_cost_usd = float(cum["estimated_cost_usd"])


def _handle_shot_error(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    idx = ev.get("shot_index") if "shot_index" in ev else ev.get("shot_idx")
    if idx is None:
        return
    shot = _ensure_shot(lp, int(idx))
    # 300 chars is not enough to diagnose a shot failure. A per-shot error
    # commonly embeds the model's raw output, and clipping it mid-JSON makes a
    # well-formed-but-rejected response indistinguishable from a truncated one
    # — which cost a wrong diagnosis on a real incident. Keep enough to tell
    # those apart.
    shot.last_error = str(ev.get("error") or "")[:_ERROR_KEEP]
    retrying = bool(ev.get("retrying"))
    shot.state = "reshoot" if retrying else "cut"


def _handle_external_call(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    call_id = str(ev.get("id") or ev.get("request_id") or f"{ev.get('provider')}-{now}")
    existing = next((c for c in lp.external_calls if c.id == call_id), None)
    state = ev.get("state") or "queued"
    if existing is None:
        call = ExternalCall(
            id=call_id,
            provider=str(ev.get("provider") or "unknown"),
            op=str(ev.get("op") or ""),
            state=state,
            shot_idx=ev.get("shot_idx") if "shot_idx" in ev else ev.get("shot_index"),
            request_id=ev.get("request_id"),
            started_at=now,
            eta_s=ev.get("eta_s"),
        )
        lp.external_calls.append(call)
        if call.shot_idx is not None:
            shot = _ensure_shot(lp, int(call.shot_idx))
            if call_id not in shot.external_call_ids:
                shot.external_call_ids.append(call_id)
        if len(lp.external_calls) > RunStateAggregator._EXTERNAL_LOG_CAP:
            lp.external_calls = lp.external_calls[-RunStateAggregator._EXTERNAL_LOG_CAP:]
    else:
        existing.state = state
        if state == "polling":
            existing.poll_count += 1
        if ev.get("eta_s") is not None:
            existing.eta_s = ev["eta_s"]
        if state in ("done", "failed"):
            existing.finished_at = now
            existing.elapsed_s = round(now - existing.started_at, 2)
            if state == "failed":
                existing.error = str(ev.get("error") or "")[:_ERROR_KEEP]


def _handle_cost_tick(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    if ev.get("spent_usd") is not None:
        lp.costs.spent_usd = float(ev["spent_usd"])
    if ev.get("spent_credits") is not None:
        lp.costs.spent_credits = float(ev["spent_credits"])
    if ev.get("cap_usd") is not None:
        lp.costs.cap_usd = float(ev["cap_usd"])
    if ev.get("cap_credits") is not None:
        lp.costs.cap_credits = float(ev["cap_credits"])


def _handle_director_thinking(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    msg = ev.get("message")
    if isinstance(msg, str) and msg.strip():
        lp.director_thought = msg.strip()[:240]


def _handle_render_progress(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    _set_stage_active(lp, STAGE_FINAL_CUT, ev.get("message"), now)
    detail = lp.stages[STAGE_FINAL_CUT].detail
    if ev.get("frames_done") is not None:
        detail["frames_done"] = int(ev["frames_done"])
    if ev.get("frames_total") is not None:
        detail["frames_total"] = int(ev["frames_total"])
    if ev.get("eta_s") is not None:
        detail["eta_s"] = float(ev["eta_s"])


def _handle_thumbnails_ready(lp: LiveProgress, ev: Dict[str, Any], now: float) -> None:
    thumb_set = ev.get("thumbnails") or {}
    lp.stages.setdefault(STAGE_FILMING, StageProgress()).detail["thumbnails"] = thumb_set


_HANDLERS = {
    "sub_stage": _handle_sub_stage,
    "shot_decisions": _handle_shot_decisions,
    "shot_substage": _handle_shot_substage,
    "shot_regen_attempt": _handle_shot_regen_attempt,
    "shot_done": _handle_shot_done,
    "shot_error": _handle_shot_error,
    "external_call": _handle_external_call,
    "cost_tick": _handle_cost_tick,
    "director_thinking": _handle_director_thinking,
    "render_progress": _handle_render_progress,
    "thumbnails_ready": _handle_thumbnails_ready,
}


# ──────────────────────────────────────────────────────────────────────────
# Serialization (dataclass → JSON-safe dict, deepcopy-isolated)
# ──────────────────────────────────────────────────────────────────────────


def _serialize(lp: LiveProgress) -> Dict[str, Any]:
    raw = {
        "video_id": lp.video_id,
        "status": lp.status,
        "active_stage": lp.active_stage,
        "active_substage": lp.active_substage,
        "director_thought": lp.director_thought,
        "started_at": lp.started_at,
        "last_event_at": lp.last_event_at,
        "finished_at": lp.finished_at,
        "stages": {k: asdict(v) for k, v in lp.stages.items()},
        "shots": [asdict(s) for s in lp.shots],
        "recurring_motifs": list(lp.recurring_motifs),
        "external_calls": [asdict(c) for c in lp.external_calls],
        "costs": asdict(lp.costs),
        "event_log": [asdict(e) for e in lp.event_log],
    }
    return copy.deepcopy(raw)


# ──────────────────────────────────────────────────────────────────────────
# Module-level singleton — import and use directly.
# ──────────────────────────────────────────────────────────────────────────

RUN_STATE = RunStateAggregator()
