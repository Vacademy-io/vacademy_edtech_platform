"""
Studio wizard plan service — per-step LLM orchestration.

Given a project's manifest + prompt + preferences + prior-step confirmations,
this asks the LLM to emit a `{operations: [{tool, params, reason?}]}` plan for
ONE wizard step, then validates each operation through its tool's validator.
Belt-and-suspenders, mirroring reels' LLMDirector:
  1. tier-filter the tool catalog BEFORE prompting (LLM never sees forbidden tools)
  2. per-operation validate; drop bad ones, keep the rest
  3. deterministic fallback when the LLM fails entirely (so the wizard always
     advances — the build ships something)

No native tool-calling (the codebase has none) — structured-JSON emission with
`response_format=json_object`, same multi-attempt retry as reels.

Stage routing: the caller passes an optional `model` (resolved from the
project's `model_overrides` for this step); absent → the 'studio_plan' use
case (ai_model_defaults; GLM by default). Every call walks the use case's
fallback chain through llm_router.chat_with_chain.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .use_case_chat import chat_json, models_for

from ..config import get_settings
from . import studio_tools
from .studio_tools import ToolValidationError

logger = logging.getLogger(__name__)

_LLM_TIMEOUT_S = 60.0
# The model comes from the 'studio_plan' use case (ai_model_defaults, set in the
# super-admin portal; GLM by default). A project's per-step override wins, then
# STUDIO_PLAN_LLM_MODEL (emergency override).
_USE_CASE = "studio_plan"
_LLM_MODEL_ENV = "STUDIO_PLAN_LLM_MODEL"
_FENCE_RE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)

# Per-step max operations the LLM may emit (post-validation cap is applied too).
_MAX_OPERATIONS = 24

_STEP_INTENT = {
    "arrangement": (
        "Decide which parts of the source videos to keep and in what order. "
        "Use pick_segments to select ranges worth keeping (skip dead air, "
        "rambling, off-topic tangents per the user's intent), then "
        "arrange_sequence to order them into a coherent video. Honor each "
        "asset's used_range_s / excluded_ranges_s / user_note. Respect the "
        "target duration as a soft goal."
    ),
    "cuts": "Identify spans to trim (silences, fillers, off-topic).",
    "overlays": (
        "Add titles and short on-screen text callouts over chosen segments to "
        "improve clarity and retention. Reference each segment by its 0-based "
        "segment_idx in the confirmed arrangement order (see prior_steps). Keep "
        "text short and punchy; prefer a few high-impact overlays over many."
    ),
    "audio": "Propose background music, sound effects, and transitions.",
}


@dataclass
class StepPlanResult:
    step: str
    operations: List[Dict[str, Any]] = field(default_factory=list)
    notes: Optional[str] = None
    used_fallback: bool = False


# ---------------------------------------------------------------------------
# Prompt assembly
# ---------------------------------------------------------------------------

def _build_system_prompt(step: str, tool_catalog: str) -> str:
    intent = _STEP_INTENT.get(step, "Plan this editing step.")
    return (
        "You are the Studio editor — an AI that plans video edits as a list of "
        "tool operations over a set of indexed source assets.\n\n"
        f"STEP: {step}\n{intent}\n\n"
        "AVAILABLE TOOLS (use ONLY these; emit nothing else):\n"
        f"{tool_catalog}\n\n"
        "OUTPUT FORMAT — strict JSON, no prose outside it:\n"
        '{ "operations": [ { "tool": "<tool name>", "params": { ... }, '
        '"reason": "<short why>" } ], "notes": "<one-line summary for the user>" }\n\n'
        "Rules:\n"
        "- Reference assets ONLY by the handles given in the manifest (v1, i1, …).\n"
        "- Every timestamp is in the SOURCE asset's own seconds.\n"
        "- Prefer fewer, well-chosen operations over many noisy ones.\n"
        "- If the user gave per-asset notes or ranges, honor them.\n"
    )


def _build_user_prompt(
    *,
    user_prompt: Optional[str],
    manifest: List[Dict[str, Any]],
    preferences: Optional[Dict[str, Any]],
    constraints: Dict[str, Any],
    prior_steps: Optional[Dict[str, Any]],
    extra_context: Optional[str],
) -> str:
    payload: Dict[str, Any] = {
        "user_prompt": (user_prompt or "").strip() or "(no prompt given)",
        "assets": manifest,
        "constraints": constraints,
    }
    if preferences:
        payload["preferences"] = preferences
    if prior_steps:
        payload["prior_steps_confirmed"] = prior_steps
    if extra_context:
        payload["extra_context"] = extra_context.strip()
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _extract_json_object(raw: str) -> dict:
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
                return json.loads(s[start : i + 1])
    raise ValueError("unbalanced JSON object in response")


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class StudioPlanService:
    """Stateless per-step planner. Instantiate per request."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._api_key = self._settings.openrouter_api_key
        self._llm_url = self._settings.llm_base_url

    @property
    def enabled(self) -> bool:
        return bool(self._api_key)

    async def plan_step(
        self,
        *,
        step: str,
        tier: str,
        user_prompt: Optional[str],
        manifest: List[Dict[str, Any]],
        preferences: Optional[Dict[str, Any]] = None,
        constraints: Optional[Dict[str, Any]] = None,
        prior_steps: Optional[Dict[str, Any]] = None,
        extra_context: Optional[str] = None,
        tools_enabled: Optional[List[str]] = None,
        tools_disabled: Optional[List[str]] = None,
        model: Optional[str] = None,
        detect_ctx: Optional[Dict[str, Any]] = None,
    ) -> StepPlanResult:
        """Run one wizard step's plan. Two tool flavors, combined:
          * deterministic tools (`detect`) run server-side from `detect_ctx`
            (e.g. cuts: silences + fillers) — no LLM, no cost.
          * LLM tools are proposed by one LLM call, then validated.
        Always returns a result — the LLM path falls back deterministically.
        A pure-deterministic step (no LLM tools) makes NO LLM call.
        """
        constraints = constraints or {}
        specs = studio_tools.tools_for_step(
            step, tier, tools_enabled=tools_enabled, tools_disabled=tools_disabled
        )
        if not specs:
            logger.info(f"[studio-plan] no tools for step={step} tier={tier}")
            return StepPlanResult(step=step, operations=[], notes="No tools available for this step.")

        ctx = _build_validation_ctx(manifest, prior_steps)
        # P7: audio policy preferences ride detect_ctx (router _plan_inputs);
        # expose them to LLM-tool validators too — propose_bgm drops its op
        # when bgm_policy='never' (defense-in-depth; the prompt also says so).
        for _policy_key in ("bgm_policy", "sfx_policy"):
            if detect_ctx and _policy_key in detect_ctx:
                ctx[_policy_key] = detect_ctx[_policy_key]
        det_specs = [s for s in specs if s.is_deterministic]
        llm_specs = [s for s in specs if not s.is_deterministic]

        # 1) Deterministic detectors — run directly, no LLM.
        det_ops: List[Dict[str, Any]] = []
        for spec in det_specs:
            try:
                produced = spec.detect(detect_ctx or {}) or []
            except Exception as e:  # a detector bug must not 500 the step
                logger.warning(f"[studio-plan] detector {spec.name} failed: {e}")
                produced = []
            for op in produced:
                if isinstance(op, dict) and op.get("tool") and isinstance(op.get("params"), dict):
                    det_ops.append(op)

        # 2) LLM tools — one call, validated. Skipped entirely when there are
        #    no LLM tools for this step (e.g. Cuts in P3 is all-deterministic).
        llm_ops: List[Dict[str, Any]] = []
        llm_notes: Optional[str] = None
        if llm_specs and self.enabled:
            catalog = studio_tools.build_tool_catalog_prompt(llm_specs)
            system = _build_system_prompt(step, catalog)
            user = _build_user_prompt(
                user_prompt=user_prompt,
                manifest=manifest,
                preferences=preferences,
                constraints=constraints,
                prior_steps=prior_steps,
                extra_context=extra_context,
            )
            raw = await self._call_llm(system, user, model=model)
            if raw:
                try:
                    payload = _extract_json_object(raw)
                    llm_ops = self._validate_operations(payload.get("operations"), llm_specs, ctx)
                    n = payload.get("notes")
                    llm_notes = n.strip()[:280] if isinstance(n, str) else None
                except ValueError as e:
                    logger.warning(f"[studio-plan] JSON parse failed ({e}); raw={raw[:300]!r}")

        operations = det_ops + llm_ops

        # Fallback ONLY applies to LLM-driven steps that came back empty
        # (arrangement). A deterministic step legitimately returns [] when the
        # detectors found nothing — that's "nothing to cut", not a failure.
        if not operations and llm_specs and not det_specs:
            return self._fallback(step, manifest, ctx, reason="no valid operations")

        notes = llm_notes or _deterministic_notes(step, det_ops)
        return StepPlanResult(step=step, operations=operations, notes=notes)

    def _validate_operations(
        self,
        raw_ops: Any,
        specs: List[Any],
        ctx: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not isinstance(raw_ops, list):
            return []
        allowed = {s.name: s for s in specs}
        out: List[Dict[str, Any]] = []
        for op in raw_ops[: _MAX_OPERATIONS * 2]:  # scan a little past the cap
            if not isinstance(op, dict):
                continue
            tool_name = str(op.get("tool", "")).strip()
            spec = allowed.get(tool_name)
            if spec is None:
                continue  # tier-filtered or hallucinated tool
            params = op.get("params")
            if not isinstance(params, dict):
                continue
            try:
                cleaned = spec.validate(params, ctx)
            except ToolValidationError as e:
                logger.info(f"[studio-plan] dropped {tool_name}: {e}")
                continue
            except Exception as e:  # validator bug — don't take the run down
                logger.warning(f"[studio-plan] validator error for {tool_name}: {e}")
                continue
            entry: Dict[str, Any] = {"tool": tool_name, "params": cleaned}
            reason = op.get("reason")
            if isinstance(reason, str) and reason.strip():
                entry["reason"] = reason.strip()[:280]
            out.append(entry)
            if len(out) >= _MAX_OPERATIONS:
                break
        return out

    def _fallback(
        self,
        step: str,
        manifest: List[Dict[str, Any]],
        ctx: Dict[str, Any],
        *,
        reason: str,
    ) -> StepPlanResult:
        """Deterministic minimal plan so the wizard always advances.

        Arrangement fallback: keep each video whole (or its used_range) in
        manifest order, then arrange them in that same order. Images become
        still cards at the end. Other steps fall back to an empty plan (the
        user can author manually).
        """
        logger.info(f"[studio-plan] fallback for step={step}: {reason}")
        if step != "arrangement":
            return StepPlanResult(
                step=step, operations=[], notes=f"AI step skipped ({reason}); add items manually.",
                used_fallback=True,
            )

        durations: Dict[str, Any] = ctx.get("durations") or {}
        segments = []
        order = []
        for asset in manifest:
            handle = asset.get("handle")
            if asset.get("kind") == "video":
                rng = asset.get("used_range_s")
                if rng and len(rng) == 2:
                    t_start, t_end = float(rng[0]), float(rng[1])
                else:
                    t_start, t_end = 0.0, float(durations.get(handle) or 0) or 0.0
                if t_end > t_start:
                    segments.append({"handle": handle, "t_start": round(t_start, 2), "t_end": round(t_end, 2)})
                    order.append({"handle": handle, "t_start": round(t_start, 2), "t_end": round(t_end, 2)})
            else:
                order.append({"handle": handle})

        ops: List[Dict[str, Any]] = []
        if segments:
            ops.append({"tool": "pick_segments", "params": {"segments": segments},
                        "reason": "Fallback: kept each clip whole."})
        if order:
            ops.append({"tool": "arrange_sequence", "params": {"order": order},
                        "reason": "Fallback: original upload order."})
        return StepPlanResult(
            step=step, operations=ops, used_fallback=True,
            notes=f"AI unavailable ({reason}) — used a simple as-uploaded arrangement you can edit.",
        )

    async def _call_llm(
        self, system: str, user: str, *, model: Optional[str]
    ) -> Optional[str]:
        """One call through the model chain. The project's per-step model
        override (`model`) wins; then $STUDIO_PLAN_LLM_MODEL; then the
        'studio_plan' use case chain (GLM by default) for failover.
        response_format=json_object first, the chain again without it if a
        model rejected the parameter (400). None when every model failed."""
        payload = {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.4,
            "max_tokens": 2000,
        }
        result = await chat_json(
            payload,
            use_case=_USE_CASE,
            models=self._models(model),
            api_key=self._api_key,
            timeout=_LLM_TIMEOUT_S,
            label="studio-plan",
        )
        return result.content if result is not None else None

    @staticmethod
    def _models(model: Optional[str]) -> List[str]:
        return models_for(_USE_CASE, explicit=model, env=_LLM_MODEL_ENV)

    def _settings_default_model(self) -> str:
        """The model a step runs on when the project sets no override."""
        return self._models(None)[0]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deterministic_notes(step: str, det_ops: List[Dict[str, Any]]) -> Optional[str]:
    """A friendly summary line for a deterministic step (no LLM notes)."""
    if not det_ops:
        if step == "cuts":
            return "No silences or filler words found to trim."
        return None
    counts = []
    for op in det_ops:
        cuts = (op.get("params") or {}).get("cuts") or []
        label = op.get("tool", "").replace("detect_", "")
        counts.append(f"{len(cuts)} {label}")
    return "Found " + ", ".join(counts) + " — review and confirm what to cut."


def _build_validation_ctx(
    manifest: List[Dict[str, Any]],
    prior_steps: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the shared context every tool validator receives.

    `segment_count` (the number of items in the confirmed arrangement order)
    lets overlay-step validators clamp a `segment_idx`. It's the length of the
    SAME ordered list the timeline builder iterates (extract_order), so a
    segment_idx in [0, segment_count) maps 1:1 to a build segment_window. 0
    when no arrangement is confirmed yet (overlay tools then accept any
    non-negative idx; COMPOSE_HTML drops ones with no resolvable window).
    """
    video_handles = set()
    image_handles = set()
    all_handles = set()
    durations: Dict[str, Any] = {}
    for a in manifest:
        h = a.get("handle")
        if not h:
            continue
        all_handles.add(h)
        if a.get("kind") == "video":
            video_handles.add(h)
            durations[h] = a.get("duration_s")
        else:
            image_handles.add(h)

    segment_count = 0
    if prior_steps:
        try:
            from .studio_timeline_builder import extract_order
            segment_count = len(extract_order((prior_steps or {}).get("arrangement")))
        except Exception:  # never let ctx-building take down a plan
            segment_count = 0

    return {
        "video_handles": video_handles,
        "image_handles": image_handles,
        "all_handles": all_handles,
        "durations": durations,
        "segment_count": segment_count,
    }


def resolve_step_model(
    model_overrides: Optional[Dict[str, Any]],
    step: str,
) -> Optional[str]:
    """Resolve the LLM model for a wizard step from the project's
    model_overrides (per_stage.studio_<step> wins over default). Returns None
    to let the service pick its settings default.

    Honors user control (AI_VIDEO_STUDIO.md §13.2) without needing the full
    V200 DB matrix — that lands in P10.
    """
    if not isinstance(model_overrides, dict):
        return None
    stage_id = f"studio_{step}"
    per_stage = model_overrides.get("per_stage")
    if isinstance(per_stage, dict) and isinstance(per_stage.get(stage_id), str):
        return per_stage[stage_id]
    default = model_overrides.get("default")
    return default if isinstance(default, str) and default else None
