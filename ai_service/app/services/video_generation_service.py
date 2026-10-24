"""
AI Video Generation Service.
Wraps the ai-video-gen pipeline and provides stage-based generation.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import queue as _queue
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Optional, Dict, Any, AsyncIterator, List, Tuple
from uuid import uuid4

from ..repositories.ai_video_repository import AiVideoRepository
from .timeline_coverage import _frame_is_substantive, _timeline_coverage
from ..db import db_session as _fresh_db_session
from .s3_service import S3Service
from .s3_url_utils import extract_s3_key
from . import cancellation_registry


def _resolve_pipeline_version(quality_tier: Optional[str] = None) -> str:
    """v3 is the only supported pipeline. v2 BeatPlanner→Director→segment-HTML
    code remains inside `_run_v3_shot_planning`'s exception handler as an
    internal safety-net fallback, but is no longer a user-selectable mode.

    The `quality_tier` argument is kept for call-site back-compat — it's
    ignored. Every video persists `user_selections.pipeline_version = "v3"`,
    so the FE audit panel always reflects the actual runtime.

    Previously this function consulted `PIPELINE_VERSION` env var and the
    per-tier `pipeline_version` field on QUALITY_TIERS. Both surfaces had
    silent-fallback paths that could persist `"v2"` even when the runtime
    successfully ran v3 (e.g. lazy import races on cold start). Removed.
    """
    return "v3"


def _is_pipeline_cancelled(exc: BaseException) -> bool:
    """The pipeline lives in the ``ai-video-gen-main/`` directory (not a
    proper Python package importable from ``app.*``). It defines its own
    ``PipelineCancelled`` exception and raises it at safe checkpoints. We
    detect it here by class name so we don't need a fragile dynamic import
    at module load time — the pipeline is only loaded later via sys.path."""
    return type(exc).__name__ == "PipelineCancelled"


def _dominant_model_from_breakdown(
    cost_breakdown: Optional[Dict[str, Any]], kind: str = "llm"
) -> Optional[str]:
    """Return the model that did the most work of a given ``kind``, or None.

    Credit/usage rows should be attributed to the model that ACTUALLY executed
    — i.e. the per-stage routing result (``ai_model_stage_assignments``) after
    the caller's ``model_overrides`` are applied — not the legacy
    ``resolved_model``. ``resolved_model`` is only the ``ai_model_defaults``
    fallback that kicks in whenever a request omits a top-level ``model``
    (always the case for Vimotion), so attributing to it makes every run read
    as the system default (e.g. ``google/gemini-2.5-pro``) regardless of tier
    or per-stage selection.

    ``cost_breakdown["stages"]`` is the flat, per-call event log built by
    ``CostEventTracker`` (see ``cost_event_tracker.py``); each event carries the
    real model string and its ``kind`` — ``"llm"`` for shot-planner / narration
    / per-shot-HTML, ``"image"`` for Seedream/Gemini image gen, etc. Because the
    deduction fires per pipeline stage, the breakdown handed in here is scoped to
    one stage's calls — so for ``kind="llm"`` on the html stage this resolves to
    the per-shot-HTML model (the dominant token consumer) and for ``kind="image"``
    to the image model that stage actually used.

    We rank by prompt+completion tokens and return the heaviest, then fall back
    to call count — the right signal for token-less kinds like ``image`` (where
    every event reports zero tokens). Returns None when there is no breakdown or
    no event of this kind, letting the caller fall back to ``resolved_model``.
    """
    if not cost_breakdown:
        return None
    stages = cost_breakdown.get("stages")
    if not isinstance(stages, list):
        return None
    by_tokens: Dict[str, int] = {}
    by_calls: Dict[str, int] = {}
    for ev in stages:
        if not isinstance(ev, dict) or ev.get("kind") != kind:
            continue
        model = ev.get("model")
        if not isinstance(model, str) or not model:
            continue
        tokens = int(ev.get("prompt_tokens", 0) or 0) + int(ev.get("completion_tokens", 0) or 0)
        by_tokens[model] = by_tokens.get(model, 0) + tokens
        by_calls[model] = by_calls.get(model, 0) + 1
    if not by_calls:
        return None
    heaviest_model, heaviest_tokens = max(by_tokens.items(), key=lambda kv: kv[1])
    if heaviest_tokens > 0:
        return heaviest_model
    return max(by_calls.items(), key=lambda kv: kv[1])[0]


def _llm_token_split_from_breakdown(
    cost_breakdown: Optional[Dict[str, Any]],
) -> Dict[str, Tuple[int, int]]:
    """Per-model (prompt, completion) token subtotals for the stage's LLM
    events. Phase C made the html stage multi-model (hero escalation +
    best-of-N + pinned regen models) — the deduction path uses this to bill
    each model's tokens at its OWN credit multiplier instead of pricing
    everything at the dominant model's rate. Empty dict when no breakdown."""
    out: Dict[str, Tuple[int, int]] = {}
    if not cost_breakdown:
        return out
    stages = cost_breakdown.get("stages")
    if not isinstance(stages, list):
        return out
    for ev in stages:
        if not isinstance(ev, dict) or ev.get("kind") != "llm":
            continue
        model = ev.get("model")
        if not isinstance(model, str) or not model:
            continue
        pt = int(ev.get("prompt_tokens", 0) or 0)
        ct = int(ev.get("completion_tokens", 0) or 0)
        prev = out.get(model, (0, 0))
        out[model] = (prev[0] + pt, prev[1] + ct)
    return out


def _get_run_state_aggregator():
    """Lazy import of the v3 live-progress aggregator. The aggregator lives
    in ``ai-video-gen-main/`` so we follow the same sys.path trick the
    pipeline import uses. Returns the module-level RUN_STATE singleton or
    None if the module can't be loaded — callers must tolerate None so a
    broken aggregator never breaks the generation pipeline."""
    try:
        import sys as _sys
        from pathlib import Path as _Path
        _aigen = str(_Path(__file__).resolve().parent.parent / "ai-video-gen-main")
        if _aigen not in _sys.path:
            _sys.path.insert(0, _aigen)
        from run_state_aggregator import RUN_STATE  # type: ignore
        return RUN_STATE
    except Exception:
        return None


from .lesson_plan_service import LessonConfigError, resolve_lesson_plan  # noqa: E402
from sqlalchemy.orm import Session
from sqlalchemy import text
from ..models.ai_token_usage import ApiProvider, RequestType
from ..constants.model_defaults import GLM_DEFAULT
from .provider_rates import IMAGE_FALLBACK_MODEL_ID


# ── NLTK corpora bootstrap ────────────────────────────────────────────────
# The video pipeline needs these for phoneme/POS work. They must NEVER be
# fetched on a request path: nltk.download() is blocking network I/O, this
# service is constructed per request, and NLTK's servers rate-limit (429/503),
# which stalled content generation past the client timeout and blocked the
# event loop for everything else. Bake them into the image (see Dockerfile) and
# this becomes a no-op; otherwise it runs at most once, in the background.
_NLTK_PACKAGES = (
    ("averaged_perceptron_tagger", "taggers/averaged_perceptron_tagger"),
    ("cmudict", "corpora/cmudict"),
)
_nltk_bootstrap_started = False
_nltk_log = __import__("logging").getLogger(__name__)


def _ensure_nltk_data_async() -> None:
    """Fetch missing NLTK corpora once per process, off the event loop."""
    global _nltk_bootstrap_started
    # Set BEFORE doing anything: a failing fetch must not retry per request.
    if _nltk_bootstrap_started or os.getenv("SKIP_NLTK_DOWNLOAD"):
        return
    _nltk_bootstrap_started = True

    def _work() -> None:
        try:
            import nltk

            missing = []
            for pkg, path in _NLTK_PACKAGES:
                try:
                    nltk.data.find(path)
                except LookupError:
                    missing.append(pkg)
            if not missing:
                return  # already baked into the image — the good case
            for pkg in missing:
                try:
                    nltk.download(pkg, quiet=True)
                except Exception as exc:  # noqa: BLE001
                    _nltk_log.warning("[VideoGenService] NLTK download failed for %s: %s", pkg, exc)
        except Exception as exc:  # noqa: BLE001
            _nltk_log.warning("[VideoGenService] NLTK bootstrap skipped: %s", exc)

    try:
        import threading

        threading.Thread(target=_work, name="nltk-bootstrap", daemon=True).start()
    except Exception as exc:  # noqa: BLE001
        _nltk_log.warning("[VideoGenService] Could not start NLTK bootstrap thread: %s", exc)


# ── Per-stage billing (2026-10-13) ───────────────────────────────────────────
# Every AI-video charge is the vendor's USD × the live credit ratio
# (credit_rate_config via CreditRateService): LLM tokens through
# calculate_credits' real-cost path (ai_models rates), images / premium TTS /
# the lesson teacher / host identity images as precomputed
# CreditService.usd_to_credits amounts. In-run deductions pass
# allow_negative=True: the vendor has already been paid, so a short balance
# goes negative and the video finishes (the start-of-run check requires the
# full estimate — CreditService.check_video_tier_credits).
#
# Deliberately NOT billed here (known gaps, each is a separate code path that
# never reaches the stage loop):
#   • frame regenerate (regenerate_video_frame) and thumbnail regenerate
#     (regenerate_video_thumbnails) — LLM/image calls on user edits;
#   • insert-shot / single-shot generation (routers/external_video_generation
#     insert_shot → single_shot_generator, sentence_clip_service);
#   • the assist decision-gate revision and concept-alternative calls
#     (_assist_llm_client);
#   • background music (Lyria) and SFX generation — recorded in
#     cost_breakdown (kind "music" / "sfx") with their USD, not charged;
#   • Veo / dialogue clips are charged separately by AiVideoLedger.
# Free vendors (Edge TTS, Pexels stock) record usage but never deduct.

_FREE_VIDEO_PROVIDER_MODELS = frozenset({"edge-tts", "pexels-stock-api"})
# Image events billed outside the stage loop. Empty: host identity images are
# billed here from their own events (one per real Seedream call — one per run
# for custom avatars, none for argil/veed), not per completed host shot.
_IMAGE_PURPOSES_BILLED_ELSEWHERE: frozenset = frozenset()
_TTS_BILLING_MODELS = {
    "edge": "edge-tts",
    "google": "google-cloud-tts",
    "sarvam": "sarvam-bulbul-v3",
    "smallest": "smallest-tts",
}
_INDIAN_TTS_LANGUAGES = frozenset({
    "hindi", "bengali", "tamil", "telugu", "marathi", "kannada",
    "gujarati", "malayalam", "punjabi", "odia", "english (india)",
})
_LESSON_TEACHER_MODEL_ID = "spatius/video"
# Pre-2026-10-13 teacher charge (8 credits per started narration minute). Only
# used when neither the ai_models per-second price nor the vendor USD exists.
_LESSON_TEACHER_LEGACY_CREDITS_PER_MINUTE = 8


def _image_events_from_breakdown(cost_breakdown: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The stage's ``kind == "image"`` cost events (one per generated image)."""
    if not cost_breakdown:
        return []
    stages = cost_breakdown.get("stages")
    if not isinstance(stages, list):
        return []
    return [ev for ev in stages if isinstance(ev, dict) and ev.get("kind") == "image"]


def _resolve_tts_billing(
    tts_provider_resolved: Optional[str],
    tts_provider: Optional[str],
    language: Optional[str],
) -> Tuple[str, str]:
    """(vendor key, billing model id) for the stage's TTS characters.

    The pipeline's resolved provider wins — it covers the premium auto-pick and
    a mid-synth edge→google fallback. Without it, mirror the pipeline's own
    resolution from the request (premium + an Indian language → Sarvam)."""
    vendor = (tts_provider_resolved or "").strip().lower()
    if not vendor:
        requested = (tts_provider or "").strip().lower()
        if requested == "premium":
            vendor = "sarvam" if (language or "").strip().lower() in _INDIAN_TTS_LANGUAGES else "google"
        elif requested in ("google", "sarvam", "smallest"):
            vendor = requested
        else:
            vendor = "edge"
    return vendor, _TTS_BILLING_MODELS.get(vendor, f"{vendor}-tts")


def _bill_video_stage_usage(
    token_service: Any,
    *,
    usage: Dict[str, Any],
    cost_breakdown: Optional[Dict[str, Any]],
    usd_to_credits: Any,
    image_unit_usd: Any,
    institute_id: Optional[str],
    user_id: Optional[str],
    video_id: str,
    stage: str,
    resolved_model: Optional[str],
    tts_provider: Optional[str],
    tts_provider_resolved: Optional[str],
    language: Optional[str],
    meter: Optional[Dict[str, Any]] = None,
    idempotency_key_fn: Optional[Any] = None,
) -> Dict[str, Any]:
    """Record usage and deduct credits for one pipeline stage's output.

    ``idempotency_key_fn(sub) -> key``: when given, every deduction carries an
    idempotency key (``llm:{model}``, ``img:{event id or index}``, ``tts``
    under the stage's key, see _video_charge_key), so a stage re-run after a
    kill between billing and the stage's COMPLETED write is not billed twice.

    ``meter``: optional usage-event attribution fields (ai_billing.
    metering_kwargs); passed only where the token service accepts them and
    never changes an amount or a ledger row.

    ``usd_to_credits(usd) -> Decimal`` and ``image_unit_usd(model) -> float``
    are CreditService.usd_to_credits and provider_rates.image_cost_usd bound to
    the billing session (injected so tests can price without a DB). Returns a
    small summary for logging/tests."""
    import logging as _logging
    from decimal import Decimal as _Dec

    log = _logging.getLogger(__name__)
    summary: Dict[str, Any] = {"llm_rows": 0, "image_rows": 0, "image_shortfall": 0,
                               "stock_items": 0, "tts_model": None}
    from .ai_billing import supported_kwargs as _supported
    _meter_deduct = _supported(getattr(token_service, "record_usage_and_deduct_credits", None), meter or {})
    # Record-only rows (free stock media, free TTS) are bundled into the video.
    _meter_record = _supported(getattr(token_service, "record_usage", None),
                               {**meter, "free_reason": "BUNDLED"} if meter else {})

    def _idem(sub: str) -> Dict[str, Any]:
        if idempotency_key_fn is None:
            return {}
        try:
            key = idempotency_key_fn(sub)
        except Exception:  # noqa: BLE001 — a key failure must not drop the charge
            key = None
        return {"idempotency_key": key} if key else {}

    usage = usage or {}
    _u_pt = int(usage.get("prompt_tokens", 0) or 0)
    _u_ct = int(usage.get("completion_tokens", 0) or 0)

    # LLM: one VIDEO row per model the breakdown saw, so each model's tokens
    # are priced at its own ai_models rate (hero escalation, best-of-N, vision
    # review and pinned regen models are all multi-model). Tokens only the
    # breakdown has (e.g. vision review never reaches `usage`) are billed;
    # tokens only `usage` has go on the dominant model's row. A stage whose
    # usage dict omits total_tokens (the v3 script stage) still bills. Rows
    # are attributed to the model that ACTUALLY executed (the breakdown), not
    # `resolved_model` — that is only the ai_model_defaults fallback, and
    # billing on it made every Vimotion run read as the system default.
    _split = _llm_token_split_from_breakdown(cost_breakdown)
    _split = {m: v for m, v in _split.items() if v[0] + v[1] > 0}
    _executed_model = _dominant_model_from_breakdown(cost_breakdown)
    _attributed_model = _executed_model or resolved_model or "video-gen-pipeline"
    has_llm = (_u_pt + _u_ct) > 0 or bool(_split)
    if has_llm and not _executed_model:
        # Billing LLM tokens but the cost breakdown had no llm model (build
        # failure / pre-cost-breakdown run): attribution AND pricing fall back
        # to resolved_model. Surface it so a silently-degraded cost tracker
        # can't hide behind correct-looking bills.
        log.warning(
            "[VideoGenService] No LLM model in cost_breakdown for video %s stage %s; "
            "attributing VIDEO credits to fallback %r", video_id, stage, _attributed_model,
        )
    provider = ApiProvider.GEMINI if "gemini" in _attributed_model.lower() else ApiProvider.OPENAI

    if has_llm:
        if _split:
            _s_pt = sum(v[0] for v in _split.values())
            _s_ct = sum(v[1] for v in _split.values())
            _dom = _attributed_model if _attributed_model in _split else max(_split, key=lambda m: sum(_split[m]))
            _rp, _rc = max(0, _u_pt - _s_pt), max(0, _u_ct - _s_ct)
            if _rp or _rc:
                _split[_dom] = (_split[_dom][0] + _rp, _split[_dom][1] + _rc)
            rows = list(_split.items())
            source = "cost_breakdown_split"
        else:
            rows = [(_attributed_model, (_u_pt, _u_ct))]
            source = "cost_breakdown" if _executed_model else "resolved_model"
        for _m, (_pt, _ct) in rows:
            token_service.record_usage_and_deduct_credits(
                api_provider=ApiProvider.GEMINI if "gemini" in _m.lower() else provider,
                prompt_tokens=_pt,
                completion_tokens=_ct,
                total_tokens=_pt + _ct,
                request_type=RequestType.VIDEO,
                institute_id=institute_id,
                user_id=user_id,
                model=_m,
                metadata={
                    "video_id": video_id,
                    "image_count": usage.get("image_count", 0),
                    "stage": stage,
                    "attributed_model_source": source,
                },
                batch_id=video_id,
                allow_negative=True,
                **_idem(f"llm:{_m}"),
                **_meter_deduct,
            )
            summary["llm_rows"] += 1
        log.info(
            f"[VideoGenService] Recorded token usage for stage {stage}: {len(rows)} model row(s), "
            f"{sum(p + c for _, (p, c) in rows)} tokens"
        )

    # Images: one IMAGE row per generated image, on the model that made it,
    # priced from the vendor's reported cost (usage.cost) or the model's
    # ai_models unit price. Host identity images included — the host block
    # bills only the avatar video seconds.
    _events = _image_events_from_breakdown(cost_breakdown)
    _billable = [ev for ev in _events if (ev.get("purpose") or "other") not in _IMAGE_PURPOSES_BILLED_ELSEWHERE]
    _image_count = int(usage.get("image_count", 0) or 0)
    _shortfall = max(0, _image_count - len(_billable))
    if _shortfall:
        log.warning(
            f"[VideoGenService] Stage {stage} of {video_id} reports {_image_count} image(s) but "
            f"{len(_billable)} image cost event(s); billing {_shortfall} at the "
            f"{IMAGE_FALLBACK_MODEL_ID} price"
        )
    _image_rows: List[Tuple[str, Optional[float], str, Optional[str], Optional[str]]] = []
    for ev in _billable:
        _model = ev.get("model") or IMAGE_FALLBACK_MODEL_ID
        _cost = ev.get("cost_usd")
        try:
            _cost = float(_cost) if _cost is not None else None
        except (TypeError, ValueError):
            _cost = None
        _image_rows.append((_model, _cost if _cost and _cost > 0 else None,
                            ev.get("purpose") or "other", ev.get("stage"),
                            ev.get("event_id") or ev.get("id")))
    _image_rows += [(IMAGE_FALLBACK_MODEL_ID, None, "unrecorded", None, None)] * _shortfall
    for _img_idx, (_model, _cost, _purpose, _ev_stage, _ev_id) in enumerate(_image_rows):
        _usd = _cost if _cost is not None else float(image_unit_usd(_model))
        token_service.record_usage_and_deduct_credits(
            api_provider=ApiProvider.OPENAI,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            request_type=RequestType.IMAGE,
            institute_id=institute_id,
            user_id=user_id,
            model=_model,
            metadata={
                "video_id": video_id,
                "stage": stage,
                "purpose": _purpose,
                "event_stage": _ev_stage,
                "price_source": "usage.cost" if _cost is not None else "ai_models",
            },
            total_price=_usd,
            batch_id=video_id,
            precomputed_credits=usd_to_credits(_usd),
            allow_negative=True,
            **_idem(f"img:{_ev_id if _ev_id else _img_idx}"),
            **_meter_deduct,
        )
    summary["image_rows"] = len(_image_rows)
    summary["image_shortfall"] = _shortfall
    if _image_rows:
        log.info(f"[VideoGenService] Deducted credits for {len(_image_rows)} images in stage {stage}")

    # Stock photos/videos (Pexels / Pixabay) are free: usage only, no charge.
    _stock_count = int(usage.get("stock_count", 0) or 0)
    if _stock_count > 0:
        token_service.record_usage(
            api_provider=ApiProvider.OPENAI,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            request_type=RequestType.STOCK,
            institute_id=institute_id,
            user_id=user_id,
            model="pexels-stock-api",
            metadata={"video_id": video_id, "stage": stage, "stock_count": _stock_count, "billed": False},
            total_price=0.0,
            **_meter_record,
        )
        summary["stock_items"] = _stock_count

    # TTS: the vendor that actually spoke. Edge is free (usage only); premium
    # vendors are charged their per-character rate × the credit ratio.
    _tts_chars = int(usage.get("tts_character_count", 0) or 0)
    if _tts_chars > 0:
        _vendor, _tts_model = _resolve_tts_billing(tts_provider_resolved, tts_provider, language)
        summary["tts_model"] = _tts_model
        _tts_meta = {"video_id": video_id, "stage": stage, "tts_provider": tts_provider,
                     "tts_provider_resolved": _vendor}
        if _tts_model in _FREE_VIDEO_PROVIDER_MODELS:
            token_service.record_usage(
                api_provider=ApiProvider.GOOGLE_TTS,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                request_type=RequestType.TTS,
                institute_id=institute_id,
                user_id=user_id,
                model=_tts_model,
                metadata={**_tts_meta, "billed": False},
                total_price=0.0,
                tts_provider=_vendor,
                character_count=_tts_chars,
                **_meter_record,
            )
        else:
            from .provider_rates import tts_cost_usd
            _tts_usd = tts_cost_usd(_vendor, _tts_chars)
            _tts_credits = usd_to_credits(_tts_usd) if _tts_usd > 0 else None
            token_service.record_usage_and_deduct_credits(
                api_provider=ApiProvider.GOOGLE_TTS,
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                request_type=RequestType.TTS_PREMIUM,
                institute_id=institute_id,
                user_id=user_id,
                model=_tts_model,
                character_count=_tts_chars,
                metadata=_tts_meta,
                total_price=_tts_usd,
                tts_provider=_vendor,
                batch_id=video_id,
                # None (unknown vendor rate) → calculate_credits('tts_premium').
                precomputed_credits=_tts_credits if _tts_credits and _tts_credits > _Dec("0") else None,
                allow_negative=True,
                **_idem("tts"),
                **_meter_deduct,
            )
            log.info(f"[VideoGenService] Deducted premium TTS credits ({_vendor}) for {_tts_chars} chars in stage {stage}")
    return summary


def _merge_cost_breakdowns(by_stage: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """One cost_breakdown for the whole video from each stage run's report.

    The pipeline resets its CostEventTracker on every run() (one per stage),
    so each report covers one stage; uploading the latest one alone lost the
    script stage's events. Events keep their order and gain `pipeline_stage`;
    the summary sums the stages."""
    stages: List[Dict[str, Any]] = []
    anomalies: List[str] = []
    totals = {"total_usd": 0.0, "base_usd": 0.0, "regen_usd": 0.0, "retry_usd": 0.0, "non_llm_usd": 0.0}
    by_stage_summary: Dict[str, Any] = {}
    started: List[str] = []
    completed: List[str] = []
    latest: Dict[str, Any] = {}
    for stage_name, report in by_stage.items():
        if not isinstance(report, dict):
            continue
        latest = report
        for ev in report.get("stages") or []:
            if isinstance(ev, dict):
                stages.append({**ev, "pipeline_stage": stage_name})
        anomalies.extend(str(a) for a in (report.get("anomalies") or []))
        summ = report.get("summary") or {}
        by_stage_summary[stage_name] = summ
        for k in totals:
            try:
                totals[k] += float(summ.get(k) or 0.0)
            except (TypeError, ValueError):
                pass
        if report.get("run_started_at"):
            started.append(str(report["run_started_at"]))
        if report.get("run_completed_at"):
            completed.append(str(report["run_completed_at"]))
    summary: Dict[str, Any] = {k: round(v, 4) for k, v in totals.items()}
    for phase in ("base", "regen", "retry"):
        summary[f"{phase}_pct"] = (
            round(100.0 * totals[f"{phase}_usd"] / totals["total_usd"], 2) if totals["total_usd"] > 0 else 0.0
        )
    return {
        "video_id": latest.get("video_id"),
        "run_started_at": min(started) if started else None,
        "run_completed_at": max(completed) if completed else None,
        "tier": latest.get("tier"),
        "pipeline_version": latest.get("pipeline_version"),
        "summary": summary,
        "by_stage": by_stage_summary,
        "stages": stages,
        "anomalies": anomalies,
    }


def _lesson_teacher_charge(
    teacher_out: Dict[str, Any],
    *,
    video_price_per_second: Any,
    usd_to_credits: Any,
) -> Tuple[Any, Optional[float], str]:
    """(credits as Decimal, vendor USD, price source) for the lesson teacher.

    The vendor bills the returned video's seconds: ceil(video_seconds) ×
    ai_models 'spatius/video' video_price_per_second × the credit ratio; then
    the teacher's own vendor_usd × the ratio; the legacy 8 credits per started
    narration minute only when neither exists."""
    import math as _math
    from decimal import Decimal as _Dec

    try:
        video_s = float(teacher_out.get("video_seconds") or 0)
    except (TypeError, ValueError):
        video_s = 0.0
    try:
        vendor_usd = float(teacher_out.get("vendor_usd") or 0)
    except (TypeError, ValueError):
        vendor_usd = 0.0
    if video_s > 0 and video_price_per_second is not None and _Dec(str(video_price_per_second)) > 0:
        usd = _Dec(_math.ceil(video_s)) * _Dec(str(video_price_per_second))
        return usd_to_credits(usd), float(usd), "ai_models"
    if vendor_usd > 0:
        return usd_to_credits(vendor_usd), vendor_usd, "vendor_usd"
    try:
        audio_s = float(teacher_out.get("audio_seconds") or 0)
    except (TypeError, ValueError):
        audio_s = 0.0
    if audio_s <= 0:
        return _Dec("0"), None, "none"
    minutes = max(1, int(_math.ceil(audio_s / 60.0)))
    return _Dec(minutes * _LESSON_TEACHER_LEGACY_CREDITS_PER_MINUTE), None, "legacy_per_minute"


def _lesson_billing_record(
    lesson_out: Dict[str, Any],
    *,
    credits: Any,
    vendor_usd: Optional[float],
    price_source: str,
    billed_at: str,
) -> Dict[str, Any]:
    """Stamp the charge onto the lesson outputs block that goes into
    extra_metadata (JSON): numbers as float, never Decimal."""
    lesson_out["billed_at"] = billed_at
    lesson_out["billed_credits"] = float(credits)
    lesson_out["billed_vendor_usd"] = float(vendor_usd) if vendor_usd is not None else None
    lesson_out["billed_price_source"] = price_source
    return lesson_out


_FULL_VIDEO_REFUND_DESCRIPTION_PREFIX = "Full refund for failed video generation"


def _refund_generation(db: Any, video_id: str, institute_id: str, key_prefix: str) -> int:
    """How many times this video's charges under ``key_prefix`` were fully
    refunded: full-video REFUND rows (refund_video_credits), plus — for an
    institute that has or had an AI plan — REFUNDED plan usage events keyed
    under the prefix (a refund that only gave allowance back writes no REFUND
    row). Monotonic, so each refund generation gets distinct keys."""
    log = __import__("logging").getLogger(__name__)
    try:
        n = db.execute(
            text(
                "SELECT count(*) FROM credit_transactions "
                "WHERE batch_id = :v AND institute_id = :i "
                "AND transaction_type = 'REFUND' AND description LIKE :d"
            ),
            {"v": video_id, "i": institute_id, "d": _FULL_VIDEO_REFUND_DESCRIPTION_PREFIX + "%"},
        ).scalar() or 0
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "[VideoGenService] Refund count failed for %s (%s); using the base key", video_id, exc,
        )
        n = 0
    try:
        from .metering import plan_wiring

        if plan_wiring.known(institute_id):
            with db.begin_nested():   # a failure here never aborts the caller's transaction
                n = int(n) + int(db.execute(
                    text(
                        "SELECT count(*) FROM ai_usage_event "
                        "WHERE batch_id = :v AND institute_id = :i AND idempotency_key LIKE :k "
                        "AND billing_mode IN ('INCLUDED', 'ALLOWANCE') AND charge_status = 'REFUNDED'"
                    ),
                    {"v": video_id, "i": institute_id, "k": key_prefix + "%"},
                ).scalar() or 0)
    except Exception as exc:  # noqa: BLE001
        log.warning("[VideoGenService] Plan refund count failed for %s (%s)", video_id, exc)
    return int(n)


def _video_charge_key(db: Any, video_id: str, institute_id: str, suffix: str) -> str:
    """Idempotency key of one video charge: ``{video_id}:{suffix}``, plus a
    refund generation once the video was fully refunded (that refund includes
    this charge, so the re-run must be billable again). A resume after a kill
    (no refund) reuses the key → the replayed charge is a no-op. Per-shot
    AiVideoLedger refunds are not counted here."""
    key = f"{video_id}:{suffix}"
    n = _refund_generation(db, video_id, institute_id, key)
    return f"{key}:refund{n}" if n > 0 else key


def _stage_charge_key_fn(db: Any, video_id: str, institute_id: Optional[str], stage: str):
    """``sub -> key`` for _bill_video_stage_usage: ``{vid}:stage:{stage}:{sub}``
    with ONE refund generation for the whole stage (computed once, so every
    row of a stage run shares it). Returns (fn, generation)."""
    prefix = f"{video_id}:stage:{stage}"
    n = _refund_generation(db, video_id, institute_id, prefix + ":") if institute_id else 0
    gen = f":refund{n}" if n > 0 else ""
    return (lambda sub: f"{prefix}:{sub}{gen}"), n


def _lesson_teacher_idempotency_key(db: Any, video_id: str, institute_id: str) -> str:
    """`{video_id}:lesson-teacher`, plus a refund generation once
    refund_video_credits has refunded this video (that refund includes the
    teacher row, so the re-run's teacher must be billable again). Per-clip
    AiVideoLedger refunds are not counted: they never touch the teacher."""
    return _video_charge_key(db, video_id, institute_id, "lesson-teacher")


def _supported_meter(fn: Any, meter: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    from .ai_billing import supported_kwargs
    return supported_kwargs(fn, meter or {})


def video_meter(*, use_case: str, video_id: str, user_id: Optional[str], prompt: Optional[str] = None,
                content_type: Optional[str] = None, quality_tier: Optional[str] = None,
                stage: Optional[str] = None) -> Dict[str, Any]:
    """Usage-event attribution for a video's charges (ai_billing.metering_kwargs):
    the video id (also the ledger batch_id) and a short title from the prompt.
    Never raises; {} on any problem."""
    try:
        from .ai_billing import metering_kwargs, metering_user
        first_line = (prompt or "").strip().splitlines()[0] if (prompt or "").strip() else ""
        return metering_kwargs(use_case, metering_user(user_id), {
            "video_id": video_id,
            "video_title": first_line[:80] or None,
            "content_type": content_type,
            "quality_tier": quality_tier,
            "stage": stage,
        })
    except Exception:  # noqa: BLE001
        return {}


def _charge_lesson_teacher(
    db: Any,
    *,
    teacher_out: Dict[str, Any],
    credits: Any,
    teacher_usd: Optional[float],
    price_source: str,
    institute_id: str,
    user_id: Optional[str],
    video_id: str,
    token_usage_service: Any = None,
    credit_service: Any = None,
    meter: Optional[Dict[str, Any]] = None,
) -> Any:
    """Record the teacher's usage and deduct its credits; returns the credits
    ACTUALLY deducted (Decimal, 0 on an idempotent no-op or a failure).

    Calls CreditService.deduct_credits directly — record_usage_and_deduct_credits
    swallows failures and hides the no-op, and the caller stamps billed_* on
    the lesson metadata only when this returns > 0."""
    import logging as _logging
    from decimal import Decimal as _Dec

    log = _logging.getLogger(__name__)
    if token_usage_service is None:
        from .token_usage_service import TokenUsageService
        token_usage_service = TokenUsageService(db)
    if credit_service is None:
        from .credit_service import CreditService
        credit_service = CreditService(db)
    vendor_usd = teacher_out.get("vendor_usd")
    seconds = int(math.ceil(float(teacher_out.get("video_seconds") or teacher_out.get("audio_seconds") or 0)))
    usage = token_usage_service.record_usage(
        api_provider=ApiProvider.OPENAI,
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        request_type=RequestType.AVATAR_VIDEO,
        institute_id=institute_id,
        user_id=user_id,
        model=_LESSON_TEACHER_MODEL_ID,
        metadata={
            "video_id": video_id,
            "stage": "html",
            "purpose": "lesson_teacher",
            "audio_seconds": teacher_out.get("audio_seconds"),
            "video_seconds": teacher_out.get("video_seconds"),
            "vendor_usd": vendor_usd,
            "price_source": price_source,
        },
        total_price=float(vendor_usd) if vendor_usd is not None else teacher_usd,
        **_supported_meter(token_usage_service.record_usage, meter),
    )
    try:
        from .ai_billing import build_deduct_request

        result = credit_service.deduct_credits(build_deduct_request(
            meter,
            institute_id=institute_id,
            request_type=RequestType.AVATAR_VIDEO.value,
            model=_LESSON_TEACHER_MODEL_ID,
            seconds=seconds,
            usage_log_id=str(usage.id) if usage is not None and getattr(usage, "id", None) else None,
            batch_id=video_id,
            precomputed_credits=credits,
            idempotency_key=_lesson_teacher_idempotency_key(db, video_id, institute_id),
            user_id=user_id,
            allow_negative=True,
            description="Lesson teacher (Spatius) for AI video",
        ))
    except Exception as exc:  # noqa: BLE001
        log.error(f"[VideoGenService] Lesson teacher deduct failed for {video_id}: {exc}")
        return _Dec("0")
    deducted = _Dec(str(getattr(result, "credits_deducted", 0) or 0))
    if not getattr(result, "success", False) or deducted <= 0:
        log.warning(
            f"[VideoGenService] Lesson teacher for {video_id} not charged "
            f"({getattr(result, 'message', '')}); billed_* left unset"
        )
        return _Dec("0")
    return deducted


def _video_default_model_id(db: Optional[Session] = None, use_case: str = "video") -> str:
    """The registry default (ai_model_defaults) for `use_case`, else GLM_DEFAULT.

    Replaces the old hard-coded Gemini Flash client defaults: a registry read
    failure must never silently move video traffic onto another vendor."""
    try:
        from .ai_models_service import AIModelsService

        def _read(session: Session) -> Optional[str]:
            if use_case == "video":
                resp = AIModelsService(session).get_models_for_use_case(use_case)
                default = getattr(resp, "default_model", None)
                return getattr(default, "model_id", None) if default is not None else None
            return AIModelsService(session).get_default_model_id_for_use_case(use_case)

        if db is not None:
            model_id = _read(db)
        else:
            with _fresh_db_session() as _s:
                model_id = _read(_s)
        if model_id:
            return str(model_id)
    except Exception as exc:  # noqa: BLE001
        __import__("logging").getLogger(__name__).warning(
            "[VideoGenService] %s default model lookup failed (%s); using %s",
            use_case, exc, GLM_DEFAULT,
        )
    return GLM_DEFAULT


# TTS unit cost for the display-only metadata estimate below (billing uses
# provider_rates per vendor; see _bill_video_stage_usage).
_TTS_COST_PER_1K_CHARS_USD: float = 0.30  # ElevenLabs standard rate


def _lookup_image_unit_price(db: Session, image_model_id: Optional[str]) -> float:
    """Resolve per-image USD cost — the same lookup billing uses."""
    from .provider_rates import image_cost_usd
    return image_cost_usd(image_model_id, db=db)


# Image generation model used by the video pipeline (OpenRouter route) — its
# default; Seedream is only used for host identity / cast sheets / keyframes.
_VIDEO_IMAGE_MODEL_ID: str = IMAGE_FALLBACK_MODEL_ID


def _estimate_video_cost_usd(
    db: Session,
    model: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    image_count: int,
    tts_character_count: int,
) -> Optional[float]:
    """
    Estimate USD cost for a video generation run by sourcing rates from the
    ai_models table (single source of truth). Returns None if the LLM model is
    unknown — caller should treat that as "estimate unavailable" rather than $0.
    """
    if not model:
        return None
    try:
        row = db.execute(
            text(
                "SELECT input_price_per_1m, output_price_per_1m, is_free "
                "FROM ai_models WHERE model_id = :m AND is_active = TRUE LIMIT 1"
            ),
            {"m": model},
        ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    input_rate = 0.0 if row.is_free else float(row.input_price_per_1m or 0)
    output_rate = 0.0 if row.is_free else float(row.output_price_per_1m or 0)
    llm_cost = (prompt_tokens / 1_000_000) * input_rate + (completion_tokens / 1_000_000) * output_rate
    img_cost = image_count * _lookup_image_unit_price(db, _VIDEO_IMAGE_MODEL_ID)
    tts_cost = (tts_character_count / 1000) * _TTS_COST_PER_1K_CHARS_USD
    return round(llm_cost + img_cost + tts_cost, 4)



def _assign_capture_ids(captured_files: List[Dict[str, Any]]) -> None:
    """Mutate `captured_files` in place, stamping each entry with a stable `id`.

    The Director and the ARTICLE_FOCUS template reference screenshots by role
    rather than by filename. Filenames produced by web_content_capture_service
    look like ``{slug}-{run_id}-above-fold.png`` / ``-mid.png`` / ``-footer.png``
    for the three viewport screenshots and ``{slug}-{run_id}-img{N}.{ext}`` for
    the inline images.

    Roles assigned:
      - ``above_fold``         (top-of-page screenshot)
      - ``mid``                (mid-page screenshot)
      - ``footer``             (bottom-of-page screenshot)
      - ``inline_0`` … ``inline_N`` (top-ranked inline images)

    Files whose name matches none of the patterns get ``inline_<idx>`` based on
    their position in the captured-files list.
    """
    inline_idx = 0
    for f in captured_files:
        if not isinstance(f, dict):
            continue
        # Don't overwrite if upstream already assigned an id.
        if f.get("id"):
            continue
        name = (f.get("name") or "").lower()
        if "above-fold" in name or "above_fold" in name:
            f["id"] = "above_fold"
        elif "footer" in name:
            f["id"] = "footer"
        elif name.endswith("-mid.png") or "-mid." in name:
            f["id"] = "mid"
        else:
            f["id"] = f"inline_{inline_idx}"
            inline_idx += 1



class _LegState:
    """Book-keeping for one generate_till_stage leg (lease handle, uploader,
    the exception it ended with, and the run's final target stage)."""

    def __init__(self, final_target_stage: str = "HTML") -> None:
        self.final_target_stage = final_target_stage
        self.handle: Any = None
        self.uploader: Any = None
        self.exc: Optional[BaseException] = None
        self.interrupted: Optional[str] = None  # reason when the leg stopped as an interruption


def _stage_index(stage: Optional[str]) -> int:
    try:
        return VideoGenerationService.STAGES.index(str(stage or "").upper())
    except ValueError:
        return -1


class VideoGenerationService:
    """
    Service for AI video generation with stage-based control.
    Supports generating up to specific stages and resuming from checkpoints.
    """
    
    # Stage order for progression
    STAGES = ["PENDING", "SCRIPT", "TTS", "WORDS", "HTML", "AVATAR", "RENDER"]
    
    def __init__(
        self,
        repository: Optional[AiVideoRepository] = None,
        s3_service: Optional[S3Service] = None
    ):
        """Initialize video generation service."""
        import logging
        logger = logging.getLogger(__name__)
        
        self.repository = repository or AiVideoRepository()
        self.s3_service = s3_service or S3Service()
        
        # Path to ai-video-gen-main directory
        self.video_gen_root = Path(__file__).parent.parent / "ai-video-gen-main"
        
        # Ensure the video generation code exists
        if not self.video_gen_root.exists():
            logger.error(f"[VideoGenService] ai-video-gen-main NOT FOUND at {self.video_gen_root}")
            raise RuntimeError(
                f"AI video generation code not found at {self.video_gen_root}. "
                "Please ensure ai-video-gen-main directory is present."
            )
        
        # NLTK corpora are fetched ONCE per process, in the background — never
        # inline here. This service is constructed per REQUEST, and
        # nltk.download() is a blocking network call: when NLTK's servers rate-
        # limit (429/503, which they do) it stalled every content-generation
        # request past the client's timeout — and, being sync I/O on the event
        # loop, stalled unrelated requests with it.
        _ensure_nltk_data_async()

    # ── Assist mode (conversational decision gates) ──────────────────
    # Phase 0 handles the SCRIPT-boundary gates (shot_plan, narration,
    # creative_concept) entirely at this orchestration layer, reusing the
    # existing "stop at SCRIPT" mechanism that review mode already uses. No
    # surgery into automation_pipeline.py is required: the gate reads the
    # shot_plan.json / script.txt the pipeline already wrote to S3, and the
    # /decision endpoint overwrites those same artifacts (the script.txt-
    # overwrite trick, generalised) so the resume leg picks up the user's edits.
    # The mid-HTML visual_casting / shot_look gates are a later phase and are
    # ignored here when present in enabled_gates.

    def _decision_gates(self):
        """Lazy-import the pure decision-gate framework from ai-video-gen-main.

        Same sys.path trick the pipeline import uses — the module lives next to
        automation_pipeline.py so the pipeline can import it directly too.
        """
        import sys as _sys
        root = str(self.video_gen_root)
        if root not in _sys.path:
            _sys.path.insert(0, root)
        import decision_gates as _dg  # type: ignore
        return _dg

    def _design_identity_mod(self):
        """Lazy-import design_identity (Phase B) — same sys.path trick."""
        import sys as _sys
        root = str(self.video_gen_root)
        if root not in _sys.path:
            _sys.path.insert(0, root)
        import design_identity as _di  # type: ignore
        return _di

    def _load_assist_state(self, video_record, assist_mode, assist_gates, assist_granularity):
        """Read the persisted assist block, or build a fresh one on the first leg."""
        dg = self._decision_gates()
        existing = None
        if video_record is not None:
            meta = getattr(video_record, "extra_metadata", None) or {}
            if isinstance(meta, dict):
                existing = meta.get("assist")
        if isinstance(existing, dict) and "enabled" in existing:
            return dict(existing)
        return dg.make_assist_state(bool(assist_mode), assist_gates, assist_granularity or "per_decision")

    def _next_script_boundary_gate(self, assist, start_stage_idx):
        """First enabled+unanswered SCRIPT-boundary gate, and whether SCRIPT must run.

        Returns ``(gate_type | None, need_script_run)``. ``need_script_run`` is
        True on a fresh run (the SCRIPT stage hasn't produced its artifacts yet);
        on a resume leg where SCRIPT is already complete the artifacts exist in S3
        and the gate is presented without running any stage.
        """
        dg = self._decision_gates()
        if not assist or not assist.get("enabled"):
            return None, False
        script_idx = self.STAGES.index("SCRIPT")
        for gate in dg.SCRIPT_BOUNDARY_GATES:
            if not dg.is_gate_enabled(assist, gate):
                continue
            if dg.find_recorded_answer(assist, gate, None) is not None:
                continue
            return gate, (start_stage_idx <= script_idx)
        return None, False

    def _skip_empty_asset_gate(self, video_id, assist, gate_type):
        """Conditionally-presented gates auto-skip when their trigger data is
        absent from the plan: ASSET_REQUEST needs a non-empty ask list,
        STYLEFRAME needs a design_identity (educational low tiers don't
        generate one). Auto-answer the empty gate and advance to the next
        unanswered script-boundary gate (or None). Any other gate passes
        through untouched."""
        dg = self._decision_gates()
        _conditional = {
            dg.GateType.ASSET_REQUEST.value: "asset_requests",
            dg.GateType.STYLEFRAME.value: "design_identity",
            # SHOT_PLAN is conditional too: when v3 ShotPlanning fails the run
            # falls back to v2, where shots are planned by the Director at the
            # HTML stage — so at the script boundary there is NO plan yet and
            # the gate rendered as an unanswerable "0-shot plan" card (prod
            # vid_1787133865366). Skip it instead; the v2 Director still runs.
            dg.GateType.SHOT_PLAN.value: "shots",
        }
        plan_key = _conditional.get(gate_type)
        if plan_key is None:
            return gate_type
        plan = self._download_artifact_json(
            video_id,
            f"ai-videos/{video_id}/script/shot_plan.json",
            f"ai-videos/{video_id}/checkpoints/shot_plan.json",
        ) or {}
        if plan.get(plan_key):
            return gate_type
        dg.record_answer(
            assist,
            decision_id=f"auto_{gate_type}_{video_id}",
            gate_type=gate_type,
            mode="auto", answer={},
        )
        try:
            self.repository.update_assist_state(video_id, assist)
        except Exception:
            pass
        nxt, _ = self._next_script_boundary_gate(assist, self.STAGES.index("SCRIPT") + 1)
        # The next gate may itself be conditional-and-empty (e.g. styleframe
        # skipped → asset_request also empty) — recurse until stable.
        if nxt is not None and nxt != gate_type and nxt in _conditional:
            return self._skip_empty_asset_gate(video_id, assist, nxt)
        return nxt

    def _download_artifact_text(self, video_id, *candidate_keys):
        """Download the first existing S3 artifact among the keys; return text or None."""
        from ..config import get_settings as _gs
        import tempfile as _tmp
        _s = _gs()
        bucket = _s.aws_bucket_name or _s.aws_s3_public_bucket
        for key in candidate_keys:
            url = f"https://{bucket}.s3.amazonaws.com/{key}"
            tmp = Path(_tmp.gettempdir()) / f"assist_{video_id}_{Path(key).name}"
            try:
                if self.s3_service.download_file(url, tmp, expected_missing=True):
                    text = tmp.read_text(encoding="utf-8")
                    try:
                        tmp.unlink()
                    except Exception:
                        pass
                    return text
            except Exception:
                continue
        return None

    def _download_artifact_json(self, video_id, *candidate_keys):
        text = self._download_artifact_text(video_id, *candidate_keys)
        if not text:
            return None
        try:
            return json.loads(text)
        except Exception:
            return None

    async def _present_script_boundary_gate(
        self, video_id, institute_id, assist, gate_type, revision_note=None,
    ):
        """Build + persist + emit a SCRIPT-boundary decision; pause the leg.

        Reads the shot plan / script the pipeline already wrote to S3, builds the
        gate's ``decision_required`` payload, flips the video to AWAITING_INPUT,
        and yields the event. The leg then ends — the user answers via /decision.
        ``revision_note`` marks a re-presentation after freeform steering was
        applied — the card tells the user this is the revised draft.
        """
        import logging as _log
        logger = _log.getLogger(__name__)
        dg = self._decision_gates()
        shot_plan = self._download_artifact_json(
            video_id,
            f"ai-videos/{video_id}/script/shot_plan.json",
            f"ai-videos/{video_id}/checkpoints/shot_plan.json",
        ) or {}
        shots = shot_plan.get("shots") if isinstance(shot_plan, dict) else None
        shots = shots or []

        if gate_type == dg.GateType.SHOT_PLAN.value:
            decision = dg.build_shot_plan_decision(video_id, shots)
        elif gate_type == dg.GateType.NARRATION.value:
            per_shot = [
                {
                    "shot_index": (s.get("shot_index") if isinstance(s, dict) else None) or i,
                    "narration_text": (s.get("narration_text") if isinstance(s, dict) else "") or "",
                }
                for i, s in enumerate(shots)
            ]
            full_script = self._download_artifact_text(
                video_id, f"ai-videos/{video_id}/script/script.txt"
            ) or dg.narration_full_script_from_shots(shots)
            decision = dg.build_narration_decision(video_id, per_shot, full_script)
            # Hook variants — 3 openings to choose from (the draft + 2 labeled
            # alternates). Skipped on a steering re-present to keep focus on
            # the revised draft. Best-effort; absent on any failure.
            if not revision_note:
                _hooks = self._generate_hook_variants(video_id, shots)
                if _hooks:
                    decision["payload"]["hook_variants"] = _hooks
        elif gate_type == dg.GateType.STYLEFRAME.value:
            _identity = shot_plan.get("design_identity") if isinstance(shot_plan, dict) else {}
            _pairing_opts: list = []
            _motion_opts: list = []
            try:
                _di = self._design_identity_mod()
                _locked = bool(((_identity or {}).get("typography") or {}).get("locked_by_brand"))
                if not _locked:
                    _pairing_opts = [
                        {"key": k, "label": v["label"], "vibe": v["vibe"]}
                        for k, v in _di.FONT_PAIRINGS.items()
                    ]
                _motion_opts = [
                    {"key": k, "label": v["label"], "vibe": v["vibe"]}
                    for k, v in _di.MOTION_PERSONALITIES.items()
                ]
            except Exception:
                pass
            decision = dg.build_styleframe_decision(
                video_id, _identity or {}, _pairing_opts, _motion_opts
            )
        elif gate_type == dg.GateType.ASSET_REQUEST.value:
            _reqs = shot_plan.get("asset_requests") if isinstance(shot_plan, dict) else []
            decision = dg.build_asset_request_decision(video_id, _reqs or [])
        else:  # creative_concept
            concept = shot_plan.get("creative_concept") if isinstance(shot_plan, dict) else {}
            decision = dg.build_creative_concept_decision(video_id, concept or {})
            # Direction alternatives — the single biggest "choose, don't just
            # approve" upgrade: 2 genuinely different directions beside the
            # draft. Picking one flows through the existing concept-edit path.
            if not revision_note:
                _alts = self._generate_concept_alternatives(video_id, concept or {})
                if _alts:
                    decision["payload"]["alternatives"] = _alts

        if revision_note:
            decision["revision_note"] = str(revision_note)[:300]
            decision["prompt"] = "Revised per your note — review the update. " + str(
                decision.get("prompt") or ""
            )

        dg.set_pending(assist, decision)
        try:
            self.repository.update_assist_state(
                video_id, assist, status="AWAITING_INPUT", current_stage="SCRIPT"
            )
        except Exception as exc:
            logger.error(f"[Assist] failed to persist pending decision for {video_id}: {exc}")
        logger.info(
            f"[Assist] paused {video_id} at gate={gate_type} "
            f"decision_id={decision.get('decision_id')}"
        )
        yield {"type": "decision_required", **decision}

    async def _apply_freeform_steering(self, video_id, gate_type, note):
        """Revise the SCRIPT-stage artifacts per a freeform steering note.

        This is what makes the assist chat's free-text box REAL: 'make it
        punchier' re-runs the stage's LLM against the existing draft with the
        note, overwrites shot_plan.json (+ derived script.txt), and the caller
        re-presents the same gate with the revised draft. Best-effort — on any
        failure the gate is re-presented unchanged with an honest message.
        Yields progress events for the SSE stream.
        """
        import logging as _log
        logger = _log.getLogger(__name__)
        dg = self._decision_gates()  # also puts ai-video-gen-main on sys.path
        yield {
            "type": "sub_stage", "sub_stage": "assist_revision",
            "message": "Revising the draft per your note…", "video_id": video_id,
        }
        try:
            plan = self._download_artifact_json(
                video_id,
                f"ai-videos/{video_id}/script/shot_plan.json",
                f"ai-videos/{video_id}/checkpoints/shot_plan.json",
            ) or {}
            if not (isinstance(plan.get("shots"), list) and plan["shots"]):
                raise RuntimeError("shot_plan.json missing or has no shots")

            from ..config import get_settings as _gs
            _settings = _gs()
            _api_key = _settings.openrouter_api_key or ""
            if not _api_key:
                raise RuntimeError("no OpenRouter API key configured")
            from automation_pipeline import OpenRouterClient  # sys.path set above
            client = OpenRouterClient(
                api_key=_api_key, default_model=_video_default_model_id()
            )
            rec = self.repository.get_by_video_id(video_id)
            source_request = getattr(rec, "prompt", None)

            if gate_type == dg.GateType.NARRATION.value:
                from narration_writer import write_narration
                write_narration(
                    shot_plan=plan,
                    llm_chat=client.chat,
                    regen_note=(
                        "URGENT REVISION — the user reviewed this narration and asked:\n"
                        f"\"{note}\"\n"
                        "Revise the narration to satisfy the note. Keep everything that "
                        "already works — change what the note names plus whatever each "
                        "fix forces."
                    ),
                    source_request=source_request,
                )
            elif gate_type == dg.GateType.SHOT_PLAN.value:
                plan = self._revise_shot_plan_with_note(client, plan, note)
            elif gate_type == dg.GateType.STYLEFRAME.value:
                revised_identity = self._revise_design_identity_with_note(
                    client, plan.get("design_identity") or {}, note,
                    plan.get("creative_concept") or {},
                )
                if revised_identity:
                    plan["design_identity"] = revised_identity
            else:  # creative_concept
                revised = self._revise_concept_with_note(
                    client, plan.get("creative_concept") or {}, note, source_request
                )
                if revised:
                    plan["creative_concept"] = revised

            body = json.dumps(plan, ensure_ascii=False).encode("utf-8")
            for _k in (
                f"ai-videos/{video_id}/script/shot_plan.json",
                f"ai-videos/{video_id}/checkpoints/shot_plan.json",
            ):
                self.s3_service.upload_file_content(
                    content=body, filename="shot_plan.json", s3_key=_k,
                    content_type="application/json",
                )
            # Keep the derived script.txt in lockstep (narration gate reads it
            # as the full_script fallback; downstream stages may too).
            if gate_type in (dg.GateType.NARRATION.value, dg.GateType.SHOT_PLAN.value):
                try:
                    _script_text = dg.narration_full_script_from_shots(plan["shots"])
                    if _script_text.strip():
                        self.s3_service.upload_file_content(
                            content=_script_text.encode("utf-8"),
                            filename="script.txt",
                            s3_key=f"ai-videos/{video_id}/script/script.txt",
                            content_type="text/plain",
                        )
                except Exception:
                    pass
            logger.info(
                f"[Assist] steering applied for {video_id} gate={gate_type}: {note[:80]!r}"
            )
            yield {
                "type": "sub_stage", "sub_stage": "assist_revision_done",
                "message": "Draft revised — review the update.", "video_id": video_id,
            }
        except Exception as exc:
            logger.error(
                f"[Assist] steering revision failed for {video_id} gate={gate_type}: {exc}",
                exc_info=True,
            )
            yield {
                "type": "sub_stage", "sub_stage": "assist_revision_failed",
                "message": (
                    "Couldn't apply your note automatically — showing the current "
                    "draft. You can edit it directly instead."
                ),
                "video_id": video_id,
            }

    def _revise_shot_plan_with_note(self, client, plan, note):
        """One LLM call: revise the existing shot plan per the user's note.

        A revision, not a from-scratch replan — the model receives the current
        plan and must preserve schema + everything the note doesn't touch.
        """
        payload = {
            k: plan.get(k)
            for k in ("creative_concept", "shots")
            if plan.get(k) is not None
        }
        system = (
            "You are the ShotPlanner revising an EXISTING shot plan per a user's note. "
            "Output the FULL revised JSON object with the same keys and schema you "
            "received (`creative_concept` and `shots` — keep every per-shot field: "
            "shot_index, shot_type, intent_role, duration_estimate_s, narration_brief, "
            "narration_text, transition_in, background_treatment, pacing_role, "
            "audio_policy, image_prompt / video_query where present). Change ONLY what "
            "the note requires plus whatever each change forces — if you merge, add, "
            "or reorder shots, renumber shot_index 0..N-1 sequentially and keep "
            "narration_text coherent across the cut. Keep total duration within ±5% "
            "of the original. Output raw JSON only — no markdown fences."
        )
        user = (
            "EXISTING PLAN:\n" + json.dumps(payload, ensure_ascii=False)
            + "\n\nUSER NOTE:\n" + str(note)
            + "\n\nOutput the full revised JSON now."
        )
        text, _usage = client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4, max_tokens=16000, response_format={"type": "json_object"},
        )
        s, e = text.find("{"), text.rfind("}")
        if s < 0 or e <= s:
            raise RuntimeError("shot-plan revision returned no JSON")
        revised = json.loads(text[s:e + 1])
        if not (isinstance(revised, dict) and isinstance(revised.get("shots"), list) and revised["shots"]):
            raise RuntimeError("shot-plan revision returned no shots")
        plan["shots"] = revised["shots"]
        if isinstance(revised.get("creative_concept"), dict) and revised["creative_concept"]:
            plan["creative_concept"] = revised["creative_concept"]
        return plan

    def _revise_design_identity_with_note(self, client, identity, note, concept):
        """One LLM call: revise the design identity per the user's note, then
        re-normalize against the registries (free text can never leak into
        fonts URLs or ease values). Preserves the brand-font lock. The old
        styleframe image is dropped when the note changes the art direction
        or pairing — a stale anchor is worse than none."""
        _di = self._design_identity_mod()
        typ = (identity or {}).get("typography") or {}
        locked = bool(typ.get("locked_by_brand"))
        system = (
            _di.build_design_identity_prompt()
            + "\n\nYou are REVISING an existing identity per a user's note. Keep every "
            "choice the note doesn't ask to change."
        )
        user = json.dumps({
            "current_identity": {
                "identity_name": identity.get("identity_name"),
                "font_pairing": typ.get("pairing"),
                "motion_personality": (identity.get("motion") or {}).get("personality"),
                "finishing": identity.get("finishing"),
                "color_arc_note": identity.get("color_arc_note"),
                "image_art_direction": identity.get("image_art_direction"),
            },
            "creative_concept": concept,
            "user_note": str(note)[:800],
        }, ensure_ascii=False)
        text, _usage = client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5, max_tokens=600, response_format={"type": "json_object"},
        )
        s, e = text.find("{"), text.rfind("}")
        if s < 0 or e <= s:
            raise RuntimeError("identity revision returned no JSON")
        raw = json.loads(text[s:e + 1])
        revised = _di.normalize_design_identity(
            raw,
            mode="marketing",
            brand_fonts_locked=locked,
            brand_heading=typ.get("display") or "",
            brand_body=typ.get("body") or "",
        )
        # Keep the styleframe only when the visual anchor still matches.
        same_look = (
            revised.get("image_art_direction") == identity.get("image_art_direction")
            and (revised.get("typography") or {}).get("pairing") == typ.get("pairing")
        )
        revised["styleframe_url"] = identity.get("styleframe_url") if same_look else None
        return revised

    def _revise_concept_with_note(self, client, concept, note, source_request):
        """One LLM call: revise the creative concept fields per the user's note."""
        system = (
            "You revise a video's creative concept per a user's note. Output ONLY a "
            "JSON object with these keys: controlling_idea, tonal_register, "
            "emotional_arc, visual_metaphor, signature_device. One concise line per "
            "value. Keep whatever the note doesn't ask to change. No markdown fences."
        )
        user = (
            "CURRENT CONCEPT:\n" + json.dumps(concept or {}, ensure_ascii=False)
            + "\n\nSOURCE REQUEST:\n" + str(source_request or "")[:800]
            + "\n\nUSER NOTE:\n" + str(note)
        )
        text, _usage = client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.5, max_tokens=1000, response_format={"type": "json_object"},
        )
        s, e = text.find("{"), text.rfind("}")
        if s < 0 or e <= s:
            raise RuntimeError("concept revision returned no JSON")
        revised = json.loads(text[s:e + 1])
        if not isinstance(revised, dict):
            raise RuntimeError("concept revision returned non-object")
        merged = dict(concept or {})
        for k in (
            "controlling_idea", "tonal_register", "emotional_arc",
            "visual_metaphor", "signature_device",
        ):
            v = revised.get(k)
            if v not in (None, ""):
                merged[k] = str(v)
        return merged

    def _assist_llm_client(self):
        """OpenRouter client on the 'video' registry default (GLM) for
        assist-side enrichment/revision calls (concept alternatives, hook
        variants, steering). Returns None when no API key is configured —
        callers degrade gracefully."""
        from ..config import get_settings as _gs
        _settings = _gs()
        _api_key = _settings.openrouter_api_key or ""
        if not _api_key:
            return None
        self._decision_gates()  # ensures ai-video-gen-main on sys.path
        from automation_pipeline import OpenRouterClient
        return OpenRouterClient(
            api_key=_api_key, default_model=_video_default_model_id()
        )

    def _generate_concept_alternatives(self, video_id, concept):
        """2 contrasting creative directions beside the draft (one LLM call).

        Returns [{controlling_idea, tonal_register, emotional_arc,
        visual_metaphor, signature_device, why_this_works}, ...] or [] on any
        failure. The FE shows them as selectable direction cards; picking one
        submits through the existing concept-edit write-back.
        """
        import logging as _log
        logger = _log.getLogger(__name__)
        try:
            client = self._assist_llm_client()
            if client is None:
                return []
            rec = self.repository.get_by_video_id(video_id)
            source_request = str(getattr(rec, "prompt", None) or "")[:800]
            system = (
                "You are a creative director proposing ALTERNATIVE directions for a video. "
                "Given the current concept and the source request, output ONLY a JSON object "
                '{"alternatives": [<2 items>]} where each item has: controlling_idea, '
                "tonal_register (one of: ad, hype, explainer, tutorial, documentary, story, news), "
                "emotional_arc, visual_metaphor, signature_device, why_this_works (one line selling "
                "the direction). The two alternatives must be GENUINELY DIFFERENT from the current "
                "concept and from each other — different register, different metaphor, different "
                "angle of attack (e.g. one risk/fear-driven, one aspiration-driven). Concise — one "
                "line per field. No markdown fences."
            )
            user = (
                "SOURCE REQUEST:\n" + source_request
                + "\n\nCURRENT CONCEPT (direction A — do not repeat it):\n"
                + json.dumps(concept or {}, ensure_ascii=False)
            )
            text, _u = client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.9, max_tokens=1200, response_format={"type": "json_object"},
            )
            s, e = text.find("{"), text.rfind("}")
            data = json.loads(text[s:e + 1]) if (s >= 0 and e > s) else {}
            alts = data.get("alternatives")
            out = []
            for a in (alts or [])[:2]:
                if isinstance(a, dict) and a.get("controlling_idea"):
                    out.append({k: str(v)[:300] for k, v in a.items() if v not in (None, "")})
            return out
        except Exception as exc:
            logger.warning(f"[Assist] concept alternatives failed for {video_id}: {exc}")
            return []

    def _generate_hook_variants(self, video_id, shots):
        """2 alternative hook lines for shot 0, labeled by technique (one LLM call).

        Returns [{technique, text}, ...] or [] on failure. The FE shows them as
        chips over the shot-0 editor; picking one replaces the text and submits
        through the existing narration-edit path.
        """
        import logging as _log
        logger = _log.getLogger(__name__)
        try:
            narrated = [
                s for s in (shots or [])
                if isinstance(s, dict) and str(s.get("narration_text") or "").strip()
            ]
            if not narrated:
                return []
            hook = str(narrated[0].get("narration_text") or "")
            close = str(narrated[-1].get("narration_text") or "")
            words = len(hook.split())
            client = self._assist_llm_client()
            if client is None:
                return []
            rec = self.repository.get_by_video_id(video_id)
            source_request = str(getattr(rec, "prompt", None) or "")[:600]
            system = (
                "You write video hooks. Given the current hook, the closing line, and the source "
                'request, output ONLY a JSON object {"variants": [<2 items>]} — each item: '
                "technique (one of: quantified_claim, curiosity_gap, direct_callout, reversal, "
                "cold_open) and text. Each variant must use a DIFFERENT technique than the current "
                f"hook, stay within ±20% of {words} words (it must fit the same shot duration), "
                "ground any number/name in the source request (never invent), and still open a "
                "loop the existing closing line can answer. No markdown fences."
            )
            user = (
                "SOURCE REQUEST:\n" + source_request
                + "\n\nCURRENT HOOK:\n" + hook
                + "\n\nCLOSING LINE:\n" + close
            )
            text, _u = client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.9, max_tokens=600, response_format={"type": "json_object"},
            )
            s, e = text.find("{"), text.rfind("}")
            data = json.loads(text[s:e + 1]) if (s >= 0 and e > s) else {}
            out = []
            for v in (data.get("variants") or [])[:2]:
                if isinstance(v, dict) and str(v.get("text") or "").strip():
                    out.append({
                        "technique": str(v.get("technique") or "alternative")[:40],
                        "text": str(v.get("text")).strip()[:400],
                    })
            return out
        except Exception as exc:
            logger.warning(f"[Assist] hook variants failed for {video_id}: {exc}")
            return []

    def _persist_resume_artifacts(self, video_id, run_dir) -> None:
        """Upload the artifacts a resumed HTML leg needs, so an assist pause
        mid-HTML doesn't lose them when the temp dir is torn down.

        The visual_casting gate pauses inside the HTML stage — AFTER per-shot TTS
        produced narration.mp3 but BEFORE the service's normal end-of-stage S3
        upload. Without this, resume can't recover the audio / shot cache. Best-
        effort; mirrors the S3 layout the resume checkpoint-download reads.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            s3_updates: Dict[str, str] = {}
            _audio = run_dir / "narration.mp3"
            if _audio.exists():
                _u = self.s3_service.upload_video_file(_audio, video_id, "audio")
                if _u:
                    s3_updates["audio"] = _u
            _words = run_dir / "narration.words.json"
            if _words.exists():
                _u = self.s3_service.upload_video_file(_words, video_id, "words")
                if _u:
                    s3_updates["words"] = _u
            # narration.words.csv — the HTML-resume REQUIRES this (separate from
            # the .json); without it the resume dies "missing narration.words.csv".
            _words_csv = run_dir / "narration.words.csv"
            if _words_csv.exists():
                self.s3_service.upload_video_file(_words_csv, video_id, "words")
            _raw = run_dir / "narration_raw.json"
            if _raw.exists():
                self.s3_service.upload_video_file(_raw, video_id, "audio")
            # per-shot TTS dir — the pipeline writes run_dir/"tts" (shot_NNN.mp3,
            # _raw.json, _script.txt); a resumed combine leg restores it into
            # run_dir/tts and re-uses it instead of re-synthesising.
            _pst = run_dir / "tts"
            if _pst.exists() and _pst.is_dir():
                from .video_checkpoint import is_temp_file as _is_tmp
                for _f in _pst.glob("*"):
                    if _f.is_file() and not _is_tmp(_f):
                        try:
                            self.s3_service.upload_file(
                                _f, s3_key=f"ai-videos/{video_id}/per_shot_tts/{_f.name}"
                            )
                        except Exception:
                            pass
            _unmixed = run_dir / "narration_unmixed.mp3"
            if _unmixed.exists():
                self.s3_service.upload_video_file(_unmixed, video_id, "audio")
            from .video_checkpoint import RESUME_CHECKPOINT_FILES
            for _name in ("shot_plan.json", "asset_selections.json") + tuple(RESUME_CHECKPOINT_FILES):
                _f = run_dir / _name
                if _f.exists():
                    self.s3_service.upload_file(
                        _f, s3_key=f"ai-videos/{video_id}/checkpoints/{_name}"
                    )
            _sc = run_dir / "shot_cache"
            if _sc.exists() and _sc.is_dir():
                for _f in _sc.glob("*.json"):
                    if _f.name.startswith("."):
                        continue
                    self.s3_service.upload_file(
                        _f, s3_key=f"ai-videos/{video_id}/checkpoints/shot_cache/{_f.name}"
                    )
            if s3_updates:
                self.repository.update_files(video_id, s3_urls=s3_updates)
            logger.info(f"[Assist] persisted resume artifacts for {video_id}: {list(s3_updates)}")
        except Exception:
            logger.error(
                f"[Assist] failed to persist resume artifacts for {video_id}", exc_info=True
            )

    # ── Resume helpers ───────────────────────────────────────────────

    @classmethod
    def resume_start_stage(cls, rec: Any) -> Optional[str]:
        """The stage a resumed leg starts at, or None when nothing is left.

        From ``checkpoint.completed_stages`` (the stage after the highest
        completed one; SCRIPT when none — a kill during SCRIPT re-runs it).
        Legacy rows without a manifest: the stage after current_stage when the
        row reads COMPLETED, else current_stage itself (it never finished)."""
        meta = getattr(rec, "extra_metadata", None) or {}
        ckpt = meta.get("checkpoint") if isinstance(meta, dict) else None
        if isinstance(ckpt, dict) and "completed_stages" in ckpt:
            done = [_stage_index(s) for s in (ckpt.get("completed_stages") or [])]
            done = [i for i in done if i >= 1]
            nxt = (max(done) + 1) if done else 1
        else:
            cur = _stage_index(getattr(rec, "current_stage", None))
            if cur < 1:
                nxt = 1
            elif str(getattr(rec, "status", "") or "").upper() == "COMPLETED":
                nxt = cur + 1
            else:
                nxt = cur
        return cls.STAGES[nxt] if 1 <= nxt < len(cls.STAGES) else None

    @staticmethod
    def _combine_eligible(target_stage_idx: int, quality_tier: Optional[str], content_type: Optional[str]) -> bool:
        """Phase-B combine applies (TTS+WORDS run inside the HTML pass) —
        same tier/type/target rule as _run_pipeline_stages."""
        return (
            target_stage_idx >= 4
            and (quality_tier or "") in ("premium", "ultra", "super_ultra")
            and (content_type or "VIDEO") == "VIDEO"
        )

    @staticmethod
    def _html_completed(rec: Any) -> bool:
        meta = getattr(rec, "extra_metadata", None) or {}
        ckpt = meta.get("checkpoint") if isinstance(meta, dict) else None
        if isinstance(ckpt, dict) and "HTML" in (ckpt.get("completed_stages") or []):
            return True
        return (
            _stage_index(getattr(rec, "current_stage", None)) >= 4
            and str(getattr(rec, "status", "") or "").upper() == "COMPLETED"
        )

    def _bucket(self) -> Optional[str]:
        b = getattr(self.s3_service, "public_bucket", None)
        if b:
            return str(b)
        try:
            from ..config import get_settings
            st = get_settings()
            return st.aws_bucket_name or st.aws_s3_public_bucket
        except Exception:  # noqa: BLE001
            return None

    def _s3_url(self, key: str) -> str:
        """The raw-S3 URL download_file accepts for ``key`` (same convention
        as the other resume downloads)."""
        return f"https://{self._bucket()}.s3.amazonaws.com/{key}"

    def _list_keys(self, prefix: str) -> List[str]:
        """Every object key under ``prefix`` (list_objects_v2, paginated)."""
        client = getattr(self.s3_service, "s3_client", None)
        bucket = self._bucket()
        if client is None or not bucket:
            return []
        keys: List[str] = []
        token = None
        for _ in range(50):  # 50 × 1000 keys — far above any video
            kw: Dict[str, Any] = {"Bucket": bucket, "Prefix": prefix}
            if token:
                kw["ContinuationToken"] = token
            resp = client.list_objects_v2(**kw) or {}
            keys.extend(o["Key"] for o in (resp.get("Contents") or []) if o.get("Key"))
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")
            if not token:
                break
        return keys

    def _restore_checkpoints(self, video_id: str, run_dir: Path, video_record: Any = None) -> Dict[str, int]:
        """Pull a run's resume checkpoints from S3 into ``run_dir``.

        • checkpoints/shot_cache/* by LISTING (shots finish out of order; the
          old shot_000… probe stopped at the first gap and never saw _subK);
        • per_shot_tts/* → run_dir/tts (the per-shot TTS cache);
        • checkpoints/{preamble, reference_context, host_outputs,
          lesson_teacher, director_plan, style_guide, cost_breakdown_by_stage}
          and lesson/teacher_raw.mp4; asset_selections.json is always
          re-downloaded (the user may have just answered the gate);
        • a missing preamble plan is rebuilt from extra_metadata
          (intent_outcomes.routing_plan / video_type, host).
        Best-effort; returns counts for logging/tests."""
        import logging
        log = logging.getLogger(__name__)
        from .video_checkpoint import RESUME_CHECKPOINT_FILES, TEACHER_RAW_REL

        counts = {"shots": 0, "tts": 0, "files": 0}
        base = f"ai-videos/{video_id}"
        try:
            sc_dir = run_dir / "shot_cache"
            sc_dir.mkdir(parents=True, exist_ok=True)
            for key in self._list_keys(f"{base}/checkpoints/shot_cache/"):
                name = key.rsplit("/", 1)[-1]
                if not name.endswith(".json") or name.startswith("."):
                    continue
                local = sc_dir / name
                if local.exists() or self.s3_service.download_file(self._s3_url(key), local, expected_missing=True):
                    counts["shots"] += 1
        except Exception as exc:  # noqa: BLE001
            log.warning(f"[VideoGenService] shot-cache restore failed for {video_id}: {exc}")
        try:
            tts_dir = run_dir / "tts"
            for key in self._list_keys(f"{base}/per_shot_tts/"):
                name = key.rsplit("/", 1)[-1]
                if not name or name.startswith(".") or name.endswith(".tmp"):
                    continue
                tts_dir.mkdir(parents=True, exist_ok=True)
                local = tts_dir / name
                if local.exists() or self.s3_service.download_file(self._s3_url(key), local, expected_missing=True):
                    counts["tts"] += 1
        except Exception as exc:  # noqa: BLE001
            log.warning(f"[VideoGenService] per-shot TTS restore failed for {video_id}: {exc}")
        try:
            self.s3_service.download_file(
                self._s3_url(f"{base}/checkpoints/asset_selections.json"),
                run_dir / "asset_selections.json", expected_missing=True,
            )
            for name in RESUME_CHECKPOINT_FILES:
                local = run_dir / name
                if local.exists():
                    continue
                if self.s3_service.download_file(self._s3_url(f"{base}/checkpoints/{name}"), local,
                                                 expected_missing=True):
                    counts["files"] += 1
            if (run_dir / "lesson_teacher.json").exists() and not (run_dir / TEACHER_RAW_REL).exists():
                self.s3_service.download_file(self._s3_url(f"{base}/{TEACHER_RAW_REL}"),
                                              run_dir / TEACHER_RAW_REL, expected_missing=True)
        except Exception as exc:  # noqa: BLE001
            log.warning(f"[VideoGenService] checkpoint file restore failed for {video_id}: {exc}")
        self._rebuild_preamble_from_metadata(run_dir, video_record)
        log.info(f"[VideoGenService] Restored checkpoints for {video_id}: {counts}")
        return counts

    @staticmethod
    def _rebuild_preamble_from_metadata(run_dir: Path, video_record: Any) -> None:
        """Write routing_plan.json / video_type.json / host_plan.json from the
        row when their checkpoint is missing (cross-pod resume of a run from
        before preamble checkpoints): without host_plan.json the resumed leg
        silently drops the host."""
        meta = getattr(video_record, "extra_metadata", None) or {}
        if not isinstance(meta, dict):
            return
        try:
            from ..schemas.routing import HostPlan, RoutingPlan, VideoTypePlan
        except Exception:  # noqa: BLE001
            return
        io = meta.get("intent_outcomes") if isinstance(meta.get("intent_outcomes"), dict) else {}
        for fname, cls, src in (
            ("routing_plan.json", RoutingPlan, io.get("routing_plan")),
            ("video_type.json", VideoTypePlan, io.get("video_type")),
            ("host_plan.json", HostPlan, meta.get("host")),
        ):
            f = run_dir / fname
            if f.exists() or not isinstance(src, dict):
                continue
            try:
                src = {k: v for k, v in src.items() if k not in ("outputs", "estimated_cost_usd")} \
                    if fname == "host_plan.json" else src
                f.write_text(cls.model_validate(src).model_dump_json(indent=2), encoding="utf-8")
            except Exception:  # noqa: BLE001 — a bad snapshot just means the default plan
                continue

    @staticmethod
    async def _flush_uploader(uploader: Any, timeout: float) -> None:
        """Drain the leg's checkpoint uploads (off the event loop when we can)."""
        try:
            await asyncio.wait_for(asyncio.to_thread(uploader.close, timeout), timeout + 5)
        except BaseException:  # noqa: BLE001 — shutdown: best effort, synchronously
            try:
                uploader.close(min(timeout, 5.0))
            except Exception:  # noqa: BLE001
                pass

    async def _release_leg_for_pause(self, video_id: str, leg: Optional["_LegState"]) -> None:
        """Assist pause: flush the leg's checkpoints and release its lease
        BEFORE the pending decision becomes answerable. Otherwise a fast
        /decision on the other pod finds the lease still held by this ending
        leg and is refused (409) after it already recorded the answer."""
        if leg is None or leg.handle is None or leg.handle.ended:
            return
        if leg.uploader is not None:
            await self._flush_uploader(leg.uploader, 25.0)
        from . import ai_video_run_lease as _run_lease
        _run_lease.end_leg(leg.handle, "released", outcome="awaiting_input")

    def _mark_completed_stages(self, video_id: str, stages: List[str]) -> None:
        fn = getattr(self.repository, "update_checkpoint", None)
        if fn is None:
            return
        try:
            from datetime import datetime as _dt_c, timezone as _tz_c
            fn(video_id, {"v": 1, "updated_at": _dt_c.now(_tz_c.utc).isoformat()}, add_stages=stages)
        except Exception as exc:  # noqa: BLE001
            __import__("logging").getLogger(__name__).warning(
                f"[VideoGenService] could not record completed stages {stages} for {video_id}: {exc}")

    def _finish_leg(self, video_id: str, leg: "_LegState") -> None:
        """Final lease state of a leg:
          • fenced (another pod owns the run)  → untouched;
          • interrupted (task cancelled at shutdown, or an interruption the
            stage loop reported)                → ``interrupted`` (resumable);
          • FAILED / CANCELLED / AWAITING_INPUT, or the run's final target
            stage completed                    → ``released``;
          • otherwise (e.g. course-builder leg 1 stopped at SCRIPT)
                                               → ``handoff``.
        Never refunds and never changes the row's status."""
        import logging
        log = logging.getLogger(__name__)
        handle = leg.handle
        if handle is None:
            return
        from . import ai_video_run_lease as _run_lease
        try:
            if handle.stop_reason == "fenced" or cancellation_registry.reason(video_id) == "fenced":
                handle.stop_reason = "fenced"
                _run_lease.end_leg(handle, "fenced", outcome="fenced")
                return
            exc = leg.exc
            if leg.interrupted or (exc is not None and isinstance(exc, asyncio.CancelledError)):
                reason = leg.interrupted or "task_cancelled"
                _run_lease.end_leg(
                    handle, "interrupted", outcome="interrupted", reason=reason,
                    interrupted_at=_run_lease.now_iso(), interrupt_reason=reason,
                )
                return
            rec = None
            try:
                rec = self.repository.get_by_video_id(video_id)
            except Exception:  # noqa: BLE001
                rec = None
            status = str(getattr(rec, "status", "") or "").upper()
            if isinstance(exc, GeneratorExit):
                exc = None  # the consumer stopped reading — judge the leg by the row
            if status in ("FAILED", "CANCELLED", "AWAITING_INPUT") or exc is not None:
                _run_lease.end_leg(handle, "released", outcome=(status.lower() or "error"),
                                   reason=(type(exc).__name__ if exc is not None else None))
                return
            meta = getattr(rec, "extra_metadata", None) or {}
            ckpt = meta.get("checkpoint") if isinstance(meta, dict) else None
            done = {str(s).upper() for s in ((ckpt or {}).get("completed_stages") or [])} if isinstance(ckpt, dict) else set()
            final_idx = _stage_index(leg.final_target_stage)
            reached = any(_stage_index(s) >= final_idx for s in done) if final_idx >= 1 else True
            if not reached and not done and rec is not None:
                # Manifest write failed / legacy: fall back to the row.
                reached = (status == "COMPLETED" and _stage_index(rec.current_stage) >= final_idx)
            if reached:
                _run_lease.end_leg(handle, "released", outcome="completed")
            else:
                _run_lease.end_leg(handle, "handoff", outcome="handoff",
                                   reason=f"stopped before {leg.final_target_stage}")
        except Exception as exc:  # noqa: BLE001
            log.warning(f"[VideoGenService] finishing leg for {video_id} failed: {exc}")
        finally:
            # Not while a newer leg of the same video runs on this process:
            # clearing would detach its stop flag (cancel / fence unreachable).
            if _run_lease.active_leg(video_id) is None:
                cancellation_registry.clear(video_id)

    async def generate_till_stage(
        self,
        video_id: str,
        prompt: str,
        target_stage: str,
        language: str = "English",
        captions_enabled: bool = True,
        html_quality: str = "advanced",
        resume: bool = False,
        model: Optional[str] = None,
        target_audience: str = "General/Adult",
        target_duration: str = "2-3 minutes",
        voice_gender: str = "female",
        tts_provider: str = "standard",
        voice_id: Optional[str] = None,
        content_type: str = "VIDEO",
        db_session: Optional[Session] = None,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        generate_avatar: bool = False,
        avatar_image_url: Optional[str] = None,
        quality_tier: str = "ultra",
        reference_files: Optional[list] = None,
        orientation: str = "landscape",
        visual_style: str = "standard",
        sound_effects_enabled: bool = True,
        input_video_id: Optional[str] = None,
        input_video_ids: Optional[list] = None,
        input_video_audio: Optional[str] = None,
        mute_tts_on_source_clips: bool = False,
        background_music_enabled: Optional[bool] = None,
        background_music_volume: Optional[float] = None,
        sub_shots_enabled: bool = False,
        dialogue_scenes_enabled: bool = False,
        dialogue_mode: str = "storybook",
        dialogue_clip_model: str = "seedance-2.0",
        cast_id: Optional[str] = None,
        routing_overrides: Optional[Dict[str, Any]] = None,
        host: Optional[Any] = None,
        # Lesson mode (schemas.LessonConfig) — validated into a plan below.
        lesson: Optional[Any] = None,
        brand_kit_id: Optional[str] = None,
        # Per-video brand overrides (palette/intro/outro/watermark/system_prompt)
        # layered on top of the resolved kit. Untyped (Any) to avoid a
        # schemas → service circular import; shape is the pydantic BrandOverrides.
        brand_overrides: Optional[Any] = None,
        visual_preferences: Optional[Any] = None,
        ai_video_enabled: bool = False,
        ai_video_audio_enabled: bool = False,
        ai_video_model: Optional[str] = None,
        # Per-stage model overrides (V200 — DB-backed routing). Untyped here
        # (Any) to avoid a schemas → service circular import.
        model_overrides: Optional[Any] = None,
        # Assist mode (conversational, human-in-the-loop). When enabled, the run
        # pauses at SCRIPT-boundary decision gates (shot_plan / narration) — it
        # emits a `decision_required` event and stops the leg cleanly until the
        # user answers via /decision. Authoritative only on the first leg; resume
        # legs read the persisted extra_metadata.assist block instead.
        assist_mode: bool = False,
        assist_gates: Optional[List[str]] = None,
        assist_granularity: str = "per_decision",
        # ── Resume / ownership (2026-10: generation survives deploys) ──
        # resume_from_stage: explicit first stage of a resume leg (overrides
        # "the stage after current_stage"). resume_mode="auto": the resumer's
        # mode — start from checkpoint.completed_stages and apply the Phase-B
        # combine clamp (a combine run whose HTML is not completed restarts at
        # TTS, rebuilding narration from the restored per-shot TTS cache).
        resume_from_stage: Optional[str] = None,
        resume_mode: Optional[str] = None,
        # extra_metadata.run_request (services/video_run_request.capture) —
        # stored atomically with the row on creation.
        run_request: Optional[Dict[str, Any]] = None,
        # A run lease the caller already holds (router-acquired or claimed by
        # the resumer); None = acquire it here. lease_origin labels a lease
        # acquired here.
        lease: Optional[Dict[str, Any]] = None,
        lease_origin: str = "user",
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Generate video up to a specific stage with SSE progress updates.

        Args:
            video_id: Unique video identifier
            prompt: Text prompt for video generation
            target_stage: Target stage (SCRIPT, TTS, WORDS, HTML, RENDER)
            language: Language for video content
            resume: Whether to resume from existing progress
            target_audience: Target audience for age-appropriate content
            target_duration: Target video duration (e.g., '5 minutes')
            content_type: Type of content (VIDEO, QUIZ, STORYBOOK, etc.)
            quality_tier: Quality tier (free, standard, premium, ultra)
            orientation: Video orientation ('landscape' or 'portrait')
            voice_id: Specific voice ID for premium TTS

        Yields:
            SSE events with progress updates
        """
        import logging
        logger = logging.getLogger(__name__)
        # One leg = one call. The lease, the checkpoint uploader and the final
        # lease state (released / handoff / interrupted) are owned here.
        _leg = _LegState(
            final_target_stage=str(
                ((run_request or {}).get("final_target_stage") if isinstance(run_request, dict) else None)
                or target_stage or "HTML"
            ).upper(),
        )
        try:

            logger.info(f"[VideoGenService] generate_till_stage called with video_id={video_id}, target={target_stage}, content_type={content_type}, resume={resume}")
            logger.info(f"[VideoGenService] Prompt: {prompt[:100]}...")

            # Validate target stage
            if target_stage not in self.STAGES:
                error_msg = f"Invalid target stage: {target_stage}. Must be one of {self.STAGES}"
                logger.error(f"[VideoGenService] {error_msg}")
                yield {
                    "type": "error",
                    "message": error_msg
                }
                return

            # ── Vimotion saved-avatar + brand-kit resolution ───────────────
            # When the request carries `host.avatar.saved_avatar_id` or
            # `brand_kit_id`, hydrate from admin-core Postgres before any
            # tier-gate / pipeline work. The resolver scopes by institute_id,
            # so a request can never read another tenant's avatar/kit.
            # Voice override (use_avatar_voice=true) mutates the *local*
            # voice_id/voice_gender/tts_provider/language so every downstream
            # caller (including TTS) sees the avatar's voice.
            #
            # ── Resume safety contract ─────────────────────────────────────
            # The override is NOT persisted into host_plan.json — only into
            # function locals, then forwarded to _run_pipeline_stages and
            # AutomationPipeline kwargs. This is intentional and safe because:
            #   1. Resume requests carry the same payload (saved_avatar_id) so
            #      this block re-runs on every resume and re-derives the same
            #      override values (idempotent unless the avatar row was edited
            #      between original submit and resume — see #3).
            #   2. TTS is atomic from the pipeline's POV — narration.mp3 either
            #      exists (resume past TTS, voice_id no longer consulted) or it
            #      doesn't (resume runs TTS fresh with the re-resolved voice).
            #      There is no half-baked partial-narration state where stale
            #      voice_id could leak in.
            #   3. If the avatar row IS edited between submit and pre-TTS
            #      resume, the resumed run picks up the new voice. This is
            #      arguably correct behaviour (user changed their mind), but
            #      worth knowing if you go to wire saved-avatar voice into a
            #      cached plan for stricter resume determinism.
            # If you change any of the above (e.g. switch TTS to a multi-call
            # streaming flow, or move resolution behind a cache that survives
            # resume), persist applied_voice_* onto HostAvatarPlan and prefer
            # the cached values on resume.
            resolved_saved_avatar: Optional[Dict[str, Any]] = None
            try:
                host_avatar = getattr(host, "avatar", None) if host is not None else None
                saved_avatar_id = getattr(host_avatar, "saved_avatar_id", None) if host_avatar else None
                use_avatar_voice = bool(getattr(host_avatar, "use_avatar_voice", True)) if host_avatar else True
                if saved_avatar_id and institute_id:
                    from .vimotion_resolver import resolve_studio_avatar
                    resolved_saved_avatar = resolve_studio_avatar(saved_avatar_id, institute_id)
                    if resolved_saved_avatar is None:
                        logger.warning(
                            f"[VideoGenService] saved_avatar_id={saved_avatar_id!r} did not resolve "
                            f"for institute_id={institute_id!r} — falling back to request fields."
                        )
                    elif use_avatar_voice:
                        # Map saved-avatar voice fields onto the request locals.
                        # Avatar.voice_provider is concrete ('edge'|'sarvam'|'google');
                        # tts_provider in the request schema is the user-facing tier
                        # ('standard'|'premium'). edge → standard; sarvam/google → premium.
                        av_voice_id = resolved_saved_avatar.get("voice_id") or None
                        av_provider = (resolved_saved_avatar.get("voice_provider") or "").lower() or None
                        av_language = resolved_saved_avatar.get("voice_language") or None
                        av_gender = resolved_saved_avatar.get("voice_gender") or None
                        if av_voice_id:
                            voice_id = av_voice_id
                        if av_provider == "edge":
                            tts_provider = "standard"
                        elif av_provider in ("sarvam", "google"):
                            tts_provider = "premium"
                        if av_language:
                            language = av_language
                        if av_gender:
                            voice_gender = av_gender
                        logger.info(
                            f"[VideoGenService] Applied avatar voice override "
                            f"(voice_id={av_voice_id!r}, provider={av_provider!r}, "
                            f"language={av_language!r}, gender={av_gender!r})."
                        )
            except Exception as _vr_err:
                # Don't fail the whole request on a resolution glitch — log and
                # continue with whatever the caller sent in the request body.
                logger.warning(
                    f"[VideoGenService] Vimotion saved-avatar resolution failed (non-fatal): {_vr_err}"
                )

            # Tier-gate the Host feature BEFORE creating any DB record / charging
            # credits. Mirrors the early-fail UX of stage validation above.
            if host is not None and not resume:
                try:
                    from .host_planner_service import make_host_plan, HostFeatureError
                    from ..config import get_settings as _get_settings
                    _settings = _get_settings()
                    _early_host_plan = make_host_plan(
                        host,
                        quality_tier=quality_tier,
                        fal_api_key=getattr(_settings, "fal_api_key", None) or "",
                        resolved_saved_avatar=resolved_saved_avatar,
                    )
                    # New host pipeline supersedes the legacy single-PiP avatar.
                    # If both `host.type=avatar` and `generate_avatar=true` are set,
                    # the new per-shot host already covers the on-screen narrator —
                    # running EchoMimic on top would produce a redundant corner PiP.
                    # Suppress the legacy path here (mutate the local kwarg) so the
                    # rest of the pipeline only sees the new host configuration.
                    if _early_host_plan.is_avatar() and generate_avatar:
                        logger.info(
                            "[VideoGenService] host.type=avatar is set — suppressing legacy "
                            "generate_avatar=true (PiP) to avoid double-rendering the host."
                        )
                        generate_avatar = False
                except HostFeatureError as he:
                    logger.warning(f"[VideoGenService] Host validation failed: {he}")
                    yield {"type": "error", "message": str(he)}
                    return

            # Lesson mode — validate before any DB record / credit work, like host.
            lesson_plan_dict: Optional[Dict[str, Any]] = None
            if lesson is not None and not resume:
                try:
                    lesson_plan_dict = resolve_lesson_plan(
                        lesson, institute_id=institute_id, host=host, db=db_session,
                    )
                except LessonConfigError as le:
                    logger.warning(f"[VideoGenService] Lesson validation failed: {le}")
                    yield {"type": "error", "message": str(le)}
                    return
                except Exception as le:  # registry / import trouble must not 500 the request
                    logger.warning(f"[VideoGenService] Lesson validation errored: {le}")
                    yield {"type": "error", "message": f"Lesson mode could not be set up: {le}"}
                    return

            # Get or create video record
            video_record = self.repository.get_by_video_id(video_id)

            if not video_record:
                if resume:
                    yield {
                        "type": "error",
                        "message": f"Cannot resume: video_id {video_id} not found"
                    }
                    return

                # Create new record
                gen_metadata = {}
                if institute_id:
                    gen_metadata["institute_id"] = institute_id
                if user_id:
                    gen_metadata["user_id"] = user_id
                if orientation and orientation != "landscape":
                    gen_metadata["orientation"] = orientation
                # Persist visual_style mode so history, resume, and frame regeneration
                # can look up which pipeline mode the video was originally generated with.
                if visual_style and visual_style != "standard":
                    gen_metadata["visual_style"] = visual_style
                if quality_tier and quality_tier != "ultra":
                    gen_metadata["quality_tier"] = quality_tier
                # Which model the user asked for. Neither field was recorded, so a
                # finished run carried no trace of the choice and the only way to
                # answer "what model ran this?" was to guess. Worse, reading the
                # absent key returned None, which reads exactly like "no override
                # was set" — the run looks like it used defaults when it did not.
                if model:
                    gen_metadata["model"] = model
                if model_overrides is not None:
                    try:
                        gen_metadata["model_overrides"] = (
                            model_overrides.model_dump(exclude_none=True)
                            if hasattr(model_overrides, "model_dump")
                            else dict(model_overrides)
                        )
                    except Exception:
                        gen_metadata["model_overrides"] = str(model_overrides)
                # Normalize: singular → list (backward compat)
                if input_video_id and not input_video_ids:
                    input_video_ids = [input_video_id]
                if input_video_ids:
                    gen_metadata["input_video_ids"] = input_video_ids
                    gen_metadata["input_video_id"] = input_video_ids[0]  # compat
                if input_video_audio:
                    gen_metadata["input_video_audio"] = input_video_audio
                gen_metadata["mute_tts_on_source_clips"] = bool(mute_tts_on_source_clips)
                if background_music_enabled is not None:
                    gen_metadata["background_music_enabled"] = bool(background_music_enabled)
                if background_music_volume is not None:
                    gen_metadata["background_music_volume"] = float(background_music_volume)
                if sub_shots_enabled:
                    gen_metadata["sub_shots_enabled"] = True
                if dialogue_scenes_enabled:
                    gen_metadata["dialogue_scenes_enabled"] = True
                if dialogue_scenes_enabled and dialogue_mode:
                    gen_metadata["dialogue_mode"] = str(dialogue_mode)
                if dialogue_scenes_enabled and dialogue_clip_model:
                    gen_metadata["dialogue_clip_model"] = str(dialogue_clip_model)
                if cast_id:
                    gen_metadata["cast_id"] = str(cast_id)
                # Persist the AI-video (Veo) opt-in so a RESUME leg re-enables it.
                # Without this, the router's resume path reads
                # `_meta.get("ai_video_enabled", False)` = False and every
                # AI_VIDEO_HERO shot the plan committed to falls back to
                # VIDEO_HERO after the shot-plan gate (observed live: plan had 4
                # AI shots, all demoted "run disabled" on resume). Mirrors the
                # dialogue-flag persistence above.
                if ai_video_enabled:
                    gen_metadata["ai_video_enabled"] = True
                if ai_video_audio_enabled:
                    gen_metadata["ai_video_audio_enabled"] = True
                if ai_video_enabled and ai_video_model:
                    gen_metadata["ai_video_model"] = str(ai_video_model)
                # Persist the TTS voice knobs so per-sentence re-narration in the
                # editor can reproduce the same voice without the user having to
                # re-supply them. Defaults are skipped to keep the row small.
                if voice_gender and voice_gender != "female":
                    gen_metadata["voice_gender"] = voice_gender
                if tts_provider and tts_provider != "standard":
                    gen_metadata["tts_provider"] = tts_provider
                if voice_id:
                    gen_metadata["voice_id"] = voice_id
                # Persist the raw visual preference slider state at top-level so
                # resume / retry can rehydrate it without rummaging through
                # extra_metadata.user_selections. None-only entries are dropped.
                if visual_preferences is not None:
                    try:
                        _vp_dump = (
                            visual_preferences.model_dump()
                            if hasattr(visual_preferences, "model_dump")
                            else dict(visual_preferences)
                        )
                        if any(v is not None for v in _vp_dump.values()):
                            gen_metadata["visual_preferences"] = _vp_dump
                    except Exception:
                        pass
                # Persist the brand kit + per-video overrides so resume / retry
                # re-apply the SAME brand direction (kit system_prompt + palette +
                # intro/outro/watermark, and any overrides) to the shots generated
                # in the second half of a resumed run. Without this, a resumed video
                # drifts off-brand: the later shots regenerate with no brand
                # direction while the cached first-half shots keep theirs.
                if brand_kit_id:
                    gen_metadata["brand_kit_id"] = brand_kit_id
                if brand_overrides is not None:
                    try:
                        _bo_dump = (
                            brand_overrides.model_dump(exclude_none=True)
                            if hasattr(brand_overrides, "model_dump")
                            else dict(brand_overrides)
                        )
                        if _bo_dump:
                            gen_metadata["brand_overrides"] = _bo_dump
                    except Exception:
                        pass

                # The run request goes in WITH the row, so a kill at any later
                # point leaves a resumable record.
                if isinstance(run_request, dict) and run_request:
                    gen_metadata["run_request"] = run_request

                video_record = self.repository.create(
                    video_id=video_id,
                    prompt=prompt,
                    language=language,
                    content_type=content_type,
                    metadata=gen_metadata
                )
                yield {
                    "type": "progress",
                    "stage": "PENDING",
                    "message": f"{content_type} generation initialized",
                    "video_id": video_id,
                    "content_type": content_type,
                    "percentage": 0
                }
            elif not resume and isinstance(run_request, dict) and run_request:
                # Fresh leg on an existing row (client-supplied video_id): a new
                # run of the video — its request replaces the old one, or an
                # auto-resume of THIS run would rebuild the previous run's kwargs.
                _mm = getattr(self.repository, "merge_metadata", None)
                if _mm is not None:
                    _mm(video_id, {"run_request": run_request})

            # ── Run lease: one live leg per video across every pod ──────────
            _prev_meta = getattr(video_record, "extra_metadata", None) or {}
            if not isinstance(_prev_meta, dict):
                _prev_meta = {}
            if not run_request and isinstance(_prev_meta.get("run_request"), dict):
                _db_rr = _prev_meta["run_request"]
                _leg.final_target_stage = str(_db_rr.get("final_target_stage") or _leg.final_target_stage).upper()
                if _stage_index(target_stage) > _stage_index(_leg.final_target_stage):
                    # A user leg goes further than the recorded run (review
                    # mode: /generate to SCRIPT, then /resume to HTML) — the
                    # run's final target moves with it, so a kill of THIS leg
                    # is resumed to where the user asked.
                    _leg.final_target_stage = str(target_stage).upper()
                    _mm = getattr(self.repository, "merge_metadata", None)
                    if _mm is not None:
                        _mm(video_id, {"run_request": {**_db_rr, "final_target_stage": _leg.final_target_stage}})
            if hasattr(self.repository, "acquire_lease") or lease is not None:
                from . import ai_video_run_lease as _run_lease
                _leg.handle = _run_lease.begin_leg(
                    self.repository, video_id, origin=lease_origin, lease=lease,
                    prev_lease=_prev_meta.get("run_lease"),
                )
                if _leg.handle is None:
                    yield {
                        "type": "info",
                        "code": "LEASE_HELD",
                        "message": "This video is already being generated by another worker; "
                                   "poll its status instead of starting it again.",
                        "video_id": video_id,
                    }
                    return
                # Register the stop flag now so a fence / cross-pod cancel that
                # lands during the preamble is seen at the first stage boundary.
                cancellation_registry.register(video_id)

            # Determine starting stage
            if resume:
                if resume_from_stage and str(resume_from_stage).upper() in self.STAGES:
                    start_stage_idx = max(1, self.STAGES.index(str(resume_from_stage).upper()))
                elif resume_mode == "auto":
                    _auto_stage = self.resume_start_stage(video_record)
                    start_stage_idx = (
                        self.STAGES.index(_auto_stage) if _auto_stage else len(self.STAGES)
                    )
                else:
                    # Start from the stage AFTER the current completed one
                    start_stage_idx = self.STAGES.index(video_record.current_stage) + 1
                # Phase-B combine clamp (auto resumes only): a combine run
                # whose HTML stage has not completed must restart at TTS —
                # TTS/WORDS ran INSIDE the HTML pass, so starting at HTML finds
                # no narration and the shot timings would be un-reconciled.
                if (
                    resume_mode == "auto"
                    and start_stage_idx > 2
                    and self._combine_eligible(self.STAGES.index(target_stage), quality_tier, content_type)
                    and not self._html_completed(video_record)
                ):
                    logger.info(
                        f"[VideoGenService] auto-resume {video_id}: combine run without a completed "
                        f"HTML stage — restarting at TTS (was {self.STAGES[min(start_stage_idx, 6)]})"
                    )
                    start_stage_idx = 2
                # The pipeline's per-shot TTS cache hit is switched on only for
                # a combine run that (re)starts at TTS on an auto resume.
                if not (
                    resume_mode == "auto"
                    and start_stage_idx == 2
                    and self._combine_eligible(self.STAGES.index(target_stage), quality_tier, content_type)
                ):
                    resume_mode = None
                # If already at or past target, just return current state
                if start_stage_idx > self.STAGES.index(target_stage):
                    yield {
                        "type": "info",
                        "message": f"Video already at stage {video_record.current_stage}",
                        "video_id": video_id,
                        "current_stage": video_record.current_stage,
                        "files": video_record.s3_urls
                    }
                    return
            else:
                start_stage_idx = 1  # Start from SCRIPT

            target_stage_idx = self.STAGES.index(target_stage)

            # ── Assist mode: SCRIPT-boundary decision gates ─────────────────
            # Gated entirely behind assist_mode so the Auto path is unchanged.
            _assist = self._load_assist_state(video_record, assist_mode, assist_gates, assist_granularity)
            # Resolve the DecisionRequired sentinel class for the HTML-stage gate
            # catch below. Always importable (pure module); fall back to a private
            # placeholder so the `except` clause is always valid.
            try:
                _DecisionRequired = self._decision_gates().DecisionRequired
            except Exception:
                class _DecisionRequired(BaseException):  # noqa: N801 — placeholder, never raised
                    pass
            _pending_gate = None
            if _assist.get("enabled"):
                # Persist the assist block (first leg seeds it; resume legs no-op-merge)
                # so the /decision endpoint can read the gate set + answer ledger.
                try:
                    self.repository.update_assist_state(video_id, _assist)
                except Exception as _ae:
                    logger.warning(f"[Assist] could not persist assist state for {video_id}: {_ae}")
                _pending_gate, _need_script_run = self._next_script_boundary_gate(_assist, start_stage_idx)
                if _pending_gate and not _need_script_run:
                    # The asset gate only presents when the planner asked for
                    # something; empty → auto-answer + advance (possibly to None,
                    # in which case the leg proceeds normally below).
                    _pending_gate = self._skip_empty_asset_gate(video_id, _assist, _pending_gate)
                if _pending_gate and not _need_script_run:
                    # Script artifacts already exist (resume leg). If the user left
                    # a freeform steering note for this gate, REVISE the artifacts
                    # per the note first, then re-present the gate with the updated
                    # draft — this is what makes "make it punchier" actually work.
                    _steer = _assist.get("steering") if isinstance(_assist.get("steering"), dict) else None
                    _revision_note = None
                    if (
                        _steer
                        and _steer.get("gate_type") == _pending_gate
                        and str(_steer.get("text") or "").strip()
                    ):
                        _revision_note = str(_steer.get("text")).strip()
                        async for _ev in self._apply_freeform_steering(
                            video_id, _pending_gate, _revision_note
                        ):
                            yield _ev
                        _assist["steering"] = None
                        try:
                            self.repository.update_assist_state(video_id, _assist)
                        except Exception as _se:
                            logger.warning(
                                f"[Assist] could not clear steering for {video_id}: {_se}"
                            )
                    await self._release_leg_for_pause(video_id, _leg)
                    async for _ev in self._present_script_boundary_gate(
                        video_id, institute_id, _assist, _pending_gate,
                        revision_note=_revision_note,
                    ):
                        yield _ev
                    return
                if _pending_gate and _need_script_run:
                    # Clamp this leg to SCRIPT; we present the gate after it runs.
                    target_stage = "SCRIPT"
                    target_stage_idx = self.STAGES.index("SCRIPT")

            # Saved cast (storybook/drama series): load once per leg so the plan
            # keeps these characters verbatim and the pipeline reuses their stored
            # portrait sheets + voice mapping. Best-effort — a missing/foreign cast
            # just means a fresh cast this run.
            _saved_cast_list = None
            if cast_id and dialogue_scenes_enabled and institute_id:
                try:
                    from ..repositories.ai_video_cast_repository import AiVideoCastRepository
                    with _fresh_db_session() as _cast_db:
                        _cast_row = AiVideoCastRepository(_cast_db).get(str(cast_id), institute_id)
                    if _cast_row and _cast_row.get("characters"):
                        _saved_cast_list = _cast_row["characters"]
                        logger.info(
                            f"[Cast] video {video_id} reuses cast '{_cast_row['name']}' "
                            f"({len(_saved_cast_list)} characters)"
                        )
                except Exception as _cast_err:
                    logger.warning(f"[Cast] could not load cast {cast_id}: {_cast_err}")

            # Create temporary working directory
            with tempfile.TemporaryDirectory() as temp_dir:
                work_dir = Path(temp_dir) / video_id
                work_dir.mkdir(parents=True, exist_ok=True)

                # Per-leg checkpoint uploader (background thread). Flushed
                # before the temp dir is torn down.
                if _leg.handle is not None and getattr(self.s3_service, "upload_file", None) is not None:
                    try:
                        from .video_checkpoint import CheckpointUploader
                        _leg.uploader = CheckpointUploader(
                            self.s3_service, video_id,
                            repository=(self.repository if hasattr(self.repository, "update_checkpoint") else None),
                            known_shots=((_prev_meta.get("checkpoint") or {}).get("shots_persisted") or [])
                            if isinstance(_prev_meta.get("checkpoint"), dict) else [],
                        )
                        _leg.handle.uploader = _leg.uploader
                        _leg.handle.work_dir = work_dir
                    except Exception as _up_err:  # noqa: BLE001
                        logger.warning(f"[VideoGenService] checkpoint uploader unavailable: {_up_err}")
                        _leg.uploader = None

                try:
                    try:
                        # Run pipeline stages
                        async for event in self._run_pipeline_stages(
                            video_id=video_id,
                            prompt=prompt,
                            language=language,
                            captions_enabled=captions_enabled,
                            html_quality=html_quality,
                            work_dir=work_dir,
                            start_stage_idx=start_stage_idx,
                            target_stage_idx=target_stage_idx,
                            model=model,
                            target_audience=target_audience,
                            target_duration=target_duration,
                            voice_gender=voice_gender,
                            tts_provider=tts_provider,
                            voice_id=voice_id,
                            content_type=content_type,
                            db_session=db_session,
                            institute_id=institute_id,
                            user_id=user_id,
                            generate_avatar=generate_avatar,
                            avatar_image_url=avatar_image_url,
                            quality_tier=quality_tier,
                            reference_files=reference_files,
                            orientation=orientation,
                            visual_style=visual_style,
                            sound_effects_enabled=sound_effects_enabled,
                            input_video_ids=input_video_ids,
                            input_video_audio=input_video_audio,
                            mute_tts_on_source_clips=mute_tts_on_source_clips,
                            background_music_enabled=background_music_enabled,
                            background_music_volume=background_music_volume,
                            sub_shots_enabled=sub_shots_enabled,
                            dialogue_scenes_enabled=dialogue_scenes_enabled,
                            dialogue_mode=dialogue_mode,
                            dialogue_clip_model=dialogue_clip_model,
                            saved_cast=_saved_cast_list,
                            routing_overrides=routing_overrides,
                            host=host,
                            lesson_plan=lesson_plan_dict,
                            brand_kit_id=brand_kit_id,
                            brand_overrides=brand_overrides,
                            resolved_saved_avatar=resolved_saved_avatar,
                            visual_preferences=visual_preferences,
                            ai_video_enabled=ai_video_enabled,
                            ai_video_audio_enabled=ai_video_audio_enabled,
                            ai_video_model=ai_video_model,
                            model_overrides=model_overrides,
                            # Assist mode: the pipeline pauses at the HTML-stage
                            # visual_casting gate when enabled. None ⇒ no HTML gate.
                            assist_state=(_assist if _assist.get("enabled") else None),
                            resuming=bool(resume),
                            resume_mode=resume_mode,
                            checkpoint_uploader=_leg.uploader,
                            leg=_leg,
                        ):
                            # If we get an error event, refund credits and stop
                            if event.get("type") == "error":
                                logger.error(f"[VideoGenService] Error event received: {event.get('message', 'Unknown error')}")
                                # Refund all credits charged for this failed video.
                                # FRESH session — by the time a late-stage error lands
                                # here the request-scoped `db_session` connection is
                                # often dead (idle-in-tx kill during the long run),
                                # which made refunds silently fail. TokenUsageService
                                # doesn't commit; the context-manager exit does.
                                if institute_id:
                                    try:
                                        from .token_usage_service import TokenUsageService
                                        with _fresh_db_session() as _refund_db:
                                            TokenUsageService(_refund_db).refund_video_credits(video_id, institute_id)
                                    except Exception as refund_err:
                                        logger.error(
                                            f"[VideoGenService] Failed to refund credits for video {video_id}: {refund_err}",
                                            exc_info=True,
                                        )
                                yield event
                                return
                            yield event
                            if event.get("type") == "interrupted":
                                # Fenced: another pod owns the run now — no gate,
                                # no "completed" event from this leg.
                                return

                        # ── Assist mode: pause at the SCRIPT-boundary gate ──────
                        # The SCRIPT stage just produced shot_plan.json / script.txt;
                        # present the pending gate and end the leg cleanly (no completed
                        # event — the FE flips to the conversation card on this event).
                        if _assist.get("enabled") and _pending_gate:
                            _pending_gate = self._skip_empty_asset_gate(video_id, _assist, _pending_gate)
                        if _assist.get("enabled") and _pending_gate:
                            await self._release_leg_for_pause(video_id, _leg)
                            async for _ev in self._present_script_boundary_gate(
                                video_id, institute_id, _assist, _pending_gate
                            ):
                                yield _ev
                            return

                        # Final completion event
                        video_record = self.repository.get_by_video_id(video_id)
                        if video_record and video_record.status != "FAILED":
                            yield {
                                "type": "completed",
                                "message": f"Generation completed up to {target_stage}",
                                "video_id": video_id,
                                "current_stage": video_record.current_stage,
                                "files": video_record.s3_urls,
                                "file_ids": video_record.file_ids,
                                "percentage": 100
                            }

                    except _DecisionRequired as _dr:
                        # Assist mode: a gate inside the HTML stage (visual_casting) asked
                        # for the user. The decision_required event was already emitted to
                        # the SSE stream; persist the pending decision + flip to
                        # AWAITING_INPUT and end the leg cleanly (NOT a failure — no
                        # refund). The /decision endpoint resumes from here.
                        try:
                            # Persist the in-flight artifacts (narration.mp3, words, shot
                            # cache) to S3 BEFORE the temp dir is torn down, so the resume
                            # leg can recover them (the normal end-of-stage upload never
                            # ran — we paused mid-HTML).
                            self._persist_resume_artifacts(video_id, work_dir)
                            await self._release_leg_for_pause(video_id, _leg)
                            _decision = dict(getattr(_dr, "decision", {}) or {})
                            _decision["video_id"] = video_id
                            _dg = self._decision_gates()
                            _dg.set_pending(_assist, _decision)
                            # current_stage stays at the stage BEFORE html ("WORDS") so the
                            # resume leg RE-ENTERS the html stage (which skips cached shots,
                            # forces the picked clips, then renders). HTML would skip it.
                            self.repository.update_assist_state(
                                video_id, _assist, status="AWAITING_INPUT", current_stage="WORDS"
                            )
                            logger.info(
                                f"[Assist] HTML-stage gate paused {video_id} "
                                f"decision_id={_decision.get('decision_id')}"
                            )
                        except Exception:
                            logger.error(
                                f"[Assist] failed to persist HTML-stage pending decision for {video_id}",
                                exc_info=True,
                            )
                        return

                    except Exception as e:
                        import traceback
                        error_traceback = traceback.format_exc()
                        error_msg = str(e)
                        logger.error(f"[VideoGenService] Exception in generate_till_stage: {error_msg}")
                        logger.error(f"[VideoGenService] Full traceback:\n{error_traceback}")

                        # Mark as failed
                        self.repository.mark_failed(
                            video_id=video_id,
                            error_message=error_msg
                        )
                        # Refund all credits charged for this failed video.
                        # FRESH session — same reasoning as the error-event refund
                        # above: the request-scoped session is usually stale here.
                        if institute_id:
                            try:
                                from .token_usage_service import TokenUsageService
                                with _fresh_db_session() as _refund_db:
                                    TokenUsageService(_refund_db).refund_video_credits(video_id, institute_id)
                            except Exception as refund_err:
                                logger.error(
                                    f"[VideoGenService] Failed to refund credits for video {video_id}: {refund_err}",
                                    exc_info=True,
                                )
                        yield {
                            "type": "error",
                            "message": f"Generation failed: {error_msg}",
                            "video_id": video_id
                        }
                finally:
                    if _leg.uploader is not None:
                        await self._flush_uploader(_leg.uploader, 25.0)

        except BaseException as _leg_exc:  # noqa: BLE001 — recorded, re-raised
            _leg.exc = _leg_exc
            raise
        finally:
            self._finish_leg(video_id, _leg)

    async def _run_pipeline_stages(
        self,
        video_id: str,
        prompt: str,
        language: str,
        captions_enabled: bool,
        html_quality: str,
        work_dir: Path,
        start_stage_idx: int,
        target_stage_idx: int,
        model: Optional[str] = None,
        target_audience: str = "General/Adult",
        target_duration: str = "2-3 minutes",
        voice_gender: str = "female",
        tts_provider: str = "standard",
        voice_id: Optional[str] = None,
        content_type: str = "VIDEO",
        db_session: Optional[Session] = None,
        institute_id: Optional[str] = None,
        user_id: Optional[str] = None,
        generate_avatar: bool = False,
        avatar_image_url: Optional[str] = None,
        quality_tier: str = "ultra",
        reference_files: Optional[list] = None,
        orientation: str = "landscape",
        visual_style: str = "standard",
        sound_effects_enabled: bool = True,
        input_video_ids: Optional[list] = None,
        input_video_audio: Optional[str] = None,
        mute_tts_on_source_clips: bool = False,
        background_music_enabled: Optional[bool] = None,
        background_music_volume: Optional[float] = None,
        sub_shots_enabled: bool = False,
        dialogue_scenes_enabled: bool = False,
        dialogue_mode: str = "storybook",
        dialogue_clip_model: str = "seedance-2.0",
        saved_cast: Optional[List[Dict[str, Any]]] = None,
        routing_overrides: Optional[Dict[str, Any]] = None,
        host: Optional[Any] = None,
        lesson_plan: Optional[Dict[str, Any]] = None,
        brand_kit_id: Optional[str] = None,
        brand_overrides: Optional[Any] = None,
        resolved_saved_avatar: Optional[Dict[str, Any]] = None,
        visual_preferences: Optional[Any] = None,
        # AI video (Phase 3b) — per-run opt-in, ultra+ only. Passed through
        # to pipeline.run; the pipeline downgrades to False on ineligible
        # tiers, so callers can pass these flags unconditionally.
        ai_video_enabled: bool = False,
        ai_video_audio_enabled: bool = False,
        ai_video_model: Optional[str] = None,
        # Per-stage model overrides (V200 — DB-backed routing). When set,
        # resolved into a per-stage map via AIModelsService.get_stage_model_map
        # and passed to VideoGenerationPipeline. Untyped here (Any) to avoid a
        # schemas → service circular import; the field shape is the pydantic
        # `ModelOverrides` from app.schemas.video_generation.
        model_overrides: Optional[Any] = None,
        # Assist mode: the extra_metadata.assist block, forwarded to pipeline.run
        # so the HTML-stage visual_casting gate can fire. None ⇒ no HTML gate.
        assist_state: Optional[Dict[str, Any]] = None,
        # Resume / checkpointing (see generate_till_stage).
        resuming: bool = False,
        resume_mode: Optional[str] = None,
        checkpoint_uploader: Optional[Any] = None,
        leg: Optional["_LegState"] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Run the video generation pipeline stages with real-time DB updates.

        Yields:
            Progress events for each stage
        """
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        # Import the automation pipeline
        sys.path.insert(0, str(self.video_gen_root))
        
        try:
            from automation_pipeline import VideoGenerationPipeline
        except ImportError as e:
            raise RuntimeError(f"Failed to import video generation pipeline: {e}")
        
        # Initialize pipeline - get API key from settings
        import logging
        logger = logging.getLogger(__name__)
        
        from ..config import get_settings
        settings = get_settings()
        openrouter_key = settings.openrouter_api_key

        if not openrouter_key:
            error_msg = "OPENROUTER_API_KEY not set in environment. Please add it to your .env.stage file."
            logger.error(f"[VideoGenService] {error_msg}")
            raise ValueError(error_msg)

        # Prepare pipeline arguments. Image generation now runs through OpenRouter
        # (bytedance-seed/seedream-4.5); stock photos/videos come from Pexels and Pixabay.
        pipeline_args = {
            "openrouter_key": openrouter_key,
            "pexels_api_keys": settings.pexels_api_keys or "",
            "pixabay_api_keys": settings.pixabay_api_keys or "",
            "serper_api_keys": getattr(settings, "serper_api_keys", "") or "",
            "runs_dir": work_dir.parent,
            "quality_tier": quality_tier,
        }

        # The registry default for 'video' (ai_model_defaults; GLM on Isoquant),
        # with GLM_DEFAULT when the registry can't answer — never a silent
        # fallback onto another vendor.
        _video_default = _video_default_model_id(db_session)
        resolved_model = model or _video_default
        if not model:
            logger.info(f"[VideoGenService] Auto-selected default model '{resolved_model}' for video generation")

        # Every tier runs its script + shot HTML clients on the 'video' default
        # (owner decision 2026-10-13: no premium-model tier). The stage matrix
        # below still wins per stage, and the user's `model` reaches the
        # user-overridable stages through it.
        pipeline_args["script_model"] = _video_default
        pipeline_args["html_model"] = _video_default

        # ── V200 stage routing: DB-backed per-stage model assignment ──
        # Resolve a {stage_id → (model_id, source)} map from
        # `ai_model_stage_assignments` and pass it to the pipeline. Each LLM
        # call site reads its model via `_resolve_stage_model(stage)`; when
        # the matrix doesn't have a row for the stage OR the DB lookup fails,
        # the call falls through to `client.default_model` (the legacy
        # script_model / html_model set above) — defensive no-op.
        # The legacy global `model` field collapses to
        # `ModelOverrides(default=model)` so a request that pre-dates the
        # per-stage UI still gets the same critical-stage override behavior.
        try:
            from ..services.ai_models_service import AIModelsService
            if db_session:
                _effective_overrides = model_overrides
                if _effective_overrides is None and model:
                    # Collapse legacy `model` into the new shape so it
                    # applies only to user-overridable critical stages.
                    from ..schemas.video_generation import ModelOverrides
                    _effective_overrides = ModelOverrides(default=model)
                elif _effective_overrides is not None and model:
                    # Both fields sent — model_overrides wins. Log so a
                    # client-side bug (sending both) shows up in audit.
                    logger.warning(
                        f"[VideoGenService] Both legacy `model={model!r}` and "
                        f"`model_overrides` sent; `model_overrides` wins. "
                        f"Drop the legacy field on the next request."
                    )
                stage_resolved = AIModelsService(db_session).get_stage_model_map(
                    use_case="video",
                    quality_tier=quality_tier,
                    overrides=_effective_overrides,
                )
                if stage_resolved:
                    # Carry (model_id, source) tuple so cost_event_tracker
                    # can attribute each call to "matrix" / "user_default"
                    # / "user_per_stage" — preserves the resolution
                    # provenance the resolver computed.
                    pipeline_args["stage_model_map"] = {
                        stage_id: (rm.model_id, rm.source)
                        for stage_id, rm in stage_resolved.items()
                    }
                    logger.info(
                        f"[VideoGenService] Stage routing resolved "
                        f"{len(stage_resolved)} stage(s) for tier={quality_tier}; "
                        f"user_overrides_active={bool(_effective_overrides)}"
                    )
                else:
                    logger.info(
                        f"[VideoGenService] Stage routing returned no rows for "
                        f"use_case=video tier={quality_tier} — falling back to "
                        f"legacy script_model/html_model routing"
                    )
            else:
                logger.info(
                    f"[VideoGenService] Stage routing skipped — no db_session "
                    f"available; falling back to legacy script_model/html_model routing"
                )
        except Exception as _sr_err:
            logger.warning(
                f"[VideoGenService] Stage routing resolution failed "
                f"({_sr_err}); falling back to legacy script_model/html_model routing"
            )

        pipeline = VideoGenerationPipeline(**pipeline_args)
        
        # Fetch branding and style configuration. Two paths:
        #
        # 1. brand_kit_id set → REPLACE per-institute defaults entirely with the
        #    kit's palette/fonts/layout/intro/outro/watermark. No merge — kits are
        #    self-contained, so an unset kit field falls back to pipeline defaults
        #    rather than to the institute setting (mirrors vimotion's "swap kits"
        #    UX where each kit is a fully-baked look).
        #
        # 2. No brand_kit_id → legacy path: read VIDEO_BRANDING + VIDEO_STYLE from
        #    institute setting_json.
        branding_config = None
        style_config = None
        brand_kit_system_prompt = None
        if institute_id and brand_kit_id:
            try:
                from .vimotion_resolver import resolve_brand_kit
                kit = resolve_brand_kit(brand_kit_id, institute_id)
                if kit is None:
                    logger.warning(
                        f"[VideoGenService] brand_kit_id={brand_kit_id!r} did not resolve "
                        f"for institute_id={institute_id!r} — falling back to institute defaults."
                    )
                else:
                    # Map brand_kit columns onto VideoStyleConfig + VideoBrandingConfig.
                    # The FE-shared shape uses palette_json/intro_json/etc. as JSONB;
                    # here we just unwrap and rename to the pipeline's expected keys.
                    palette = kit.get("palette_json") or {}
                    if not isinstance(palette, dict):
                        palette = {}
                    style_config = {
                        "background_type": kit.get("background_type") or "white",
                        "primary_color": palette.get("primary"),
                        "secondary_color": palette.get("secondary"),
                        "accent_color": palette.get("accent"),
                        "background_color": palette.get("background"),
                        "heading_font": kit.get("heading_font"),
                        "body_font": kit.get("body_font"),
                        "layout_theme": kit.get("layout_theme"),
                        "logo_file_id": kit.get("logo_file_id"),
                    }
                    branding_config = {
                        "intro": kit.get("intro_json") or {},
                        "outro": kit.get("outro_json") or {},
                        "watermark": kit.get("watermark_json") or {},
                    }
                    # Free-text director instructions for this kit. Injected into
                    # the planner / narration / per-shot system prompts downstream.
                    brand_kit_system_prompt = kit.get("system_prompt") or None
                    logger.info(
                        f"[VideoGenService] Using brand_kit name={kit.get('name')!r} "
                        f"id={kit.get('id')!r} (replaces institute-wide style/branding; "
                        f"system_prompt={'yes' if brand_kit_system_prompt else 'no'})"
                    )
            except Exception as e:
                logger.warning(
                    f"[VideoGenService] brand_kit fetch failed: {e} — falling back to institute defaults."
                )
        if branding_config is None and style_config is None and institute_id and db_session:
            try:
                from .institute_settings_service import InstituteSettingsService
                settings_service = InstituteSettingsService(db_session)
                branding_result = settings_service.get_video_branding(institute_id)
                branding_config = branding_result.get("branding")
                if branding_result.get("has_custom_branding"):
                    logger.info(f"[VideoGenService] Using custom branding for institute {institute_id}")
                else:
                    logger.info(f"[VideoGenService] Using default Vacademy branding for institute {institute_id}")
                style_result = settings_service.get_video_style(institute_id)
                # Only apply style overrides when the org has explicitly saved a custom style.
                # Passing default values would silently override pipeline presets (e.g. accent
                # colors, fonts) even when the org never touched the settings.
                if style_result.get("has_custom_style"):
                    style_config = style_result.get("style")
                    logger.info(f"[VideoGenService] Using custom video style for institute {institute_id}")
                else:
                    logger.info(f"[VideoGenService] No custom video style for institute {institute_id}, using pipeline defaults")
            except Exception as e:
                logger.warning(f"[VideoGenService] Could not fetch branding/style config: {e}. Using defaults.")

        # ── Per-video brand overrides ──────────────────────────────────
        # Layer request-level overrides on top of whatever branding/style
        # resolved above (kit → institute → pipeline defaults). palette is
        # field-merged onto style_config; intro/outro/watermark replace those
        # branding sections; the system_prompt override REPLACES the kit's
        # system_prompt for this run (per product decision). Works with or
        # without a brand kit. One-shot — the FE does not persist these.
        effective_brand_system_prompt = brand_kit_system_prompt
        if brand_overrides is not None:
            # brand_overrides may be a pydantic BrandOverrides (fresh request) or a
            # plain dict (rehydrated from extra_metadata on resume / retry).
            _bo = (
                brand_overrides.model_dump()
                if hasattr(brand_overrides, "model_dump")
                else (brand_overrides if isinstance(brand_overrides, dict) else {})
            )
            ov_palette = _bo.get("palette")
            ov_intro = _bo.get("intro")
            ov_outro = _bo.get("outro")
            ov_watermark = _bo.get("watermark")
            ov_system_prompt = _bo.get("system_prompt")

            if isinstance(ov_palette, dict) and ov_palette:
                if not isinstance(style_config, dict):
                    style_config = {}
                # Map FE palette keys → pipeline style_config color keys; only the
                # provided keys win (field-level merge over the kit / institute).
                _palette_key_map = {
                    "primary": "primary_color",
                    "secondary": "secondary_color",
                    "accent": "accent_color",
                    "background": "background_color",
                }
                for _src, _dst in _palette_key_map.items():
                    _val = ov_palette.get(_src)
                    if _val:
                        style_config[_dst] = _val

            if any(isinstance(x, dict) and x for x in (ov_intro, ov_outro, ov_watermark)):
                if not isinstance(branding_config, dict):
                    branding_config = {}
                if isinstance(ov_intro, dict) and ov_intro:
                    branding_config["intro"] = ov_intro
                if isinstance(ov_outro, dict) and ov_outro:
                    branding_config["outro"] = ov_outro
                if isinstance(ov_watermark, dict) and ov_watermark:
                    branding_config["watermark"] = ov_watermark

            if isinstance(ov_system_prompt, str) and ov_system_prompt.strip():
                # Replace (not append) the kit's system prompt for this run.
                effective_brand_system_prompt = ov_system_prompt.strip()

            logger.info(
                "[VideoGenService] Applied per-video brand overrides "
                f"(palette={bool(isinstance(ov_palette, dict) and ov_palette)}, "
                f"intro={bool(isinstance(ov_intro, dict) and ov_intro)}, "
                f"outro={bool(isinstance(ov_outro, dict) and ov_outro)}, "
                f"watermark={bool(isinstance(ov_watermark, dict) and ov_watermark)}, "
                f"system_prompt={'yes' if (isinstance(ov_system_prompt, str) and ov_system_prompt.strip()) else 'no'})"
            )

        # Map stage indices to pipeline stage names and file keys
        stage_config = {
            1: {"name": "script", "file_key": "script", "file_name": "script.txt"},
            2: {"name": "tts", "file_key": "audio", "file_name": "narration.mp3"},
            3: {"name": "words", "file_key": "words", "file_name": "narration.words.json"},
            4: {"name": "html", "file_key": "timeline", "file_name": "time_based_frame.json"},
            5: {"name": "avatar", "file_key": "avatar", "file_name": "avatar_video.mp4"},
            6: {"name": "render", "file_key": "video", "file_name": "output.mp4"}
        }
        
        # Determine start_from and stop_at parameters
        # When resuming, start_from should be the stage we're resuming FROM (which we've already completed)
        # The pipeline will skip that stage and continue to the next one
        start_from = stage_config[start_stage_idx]["name"]
        stop_at = stage_config[target_stage_idx]["name"]  # Stop at target stage (e.g., "html")
        
        # Special handling: if we're resuming from SCRIPT and want to generate TTS,
        # we need to ensure script.txt exists in the run directory
        # The pipeline's logic: if start_from="script", it skips script generation and requires script.txt
        # Then it checks if do_tts is True (which it should be if stop_at is after tts)
        # If do_tts is True, it generates TTS; if False, it requires narration_raw.json
        # So the issue might be that do_tts is incorrectly False
        # Let's ensure the pipeline understands we want to generate TTS by checking the logic
        logger.info(f"[VideoGenService] Pipeline stage mapping: start_from={start_from} (stage_idx={start_stage_idx}), stop_at={stop_at} (stage_idx={target_stage_idx})")
        
        # Validate parameters before calling pipeline
        if html_quality not in ["classic", "advanced"]:
            logger.warning(f"[VideoGenService] Invalid html_quality '{html_quality}', defaulting to 'advanced'")
            html_quality = "advanced"
        
        # Ensure language is a string
        if not isinstance(language, str):
            language = str(language) if language else "English"
        
        # Ensure captions_enabled is a boolean
        if not isinstance(captions_enabled, bool):
            captions_enabled = bool(captions_enabled)
        
        logger.info(f"[VideoGenService] Validated parameters: start_from={start_from}, stop_at={stop_at}, language={language}, captions={captions_enabled}, html_quality={html_quality}")
        
        # If resuming, download required files from S3 to work directory
        # The pipeline expects files from previous stages to exist in the run directory
        # Pipeline creates run_dir at runs_dir / video_id, where runs_dir = work_dir.parent
        # So run_dir = work_dir.parent / video_id
        video_record = self.repository.get_by_video_id(video_id)
        if video_record and start_stage_idx >= 1:  # Resuming from SCRIPT or later
            logger.info(f"[VideoGenService] Resuming from stage {start_stage_idx}, downloading required files from S3...")
            
            # Pipeline creates run_dir at work_dir.parent / video_id
            # Create it here to ensure files are in the right place
            run_dir = work_dir.parent / video_id
            run_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"[VideoGenService] Using run_dir: {run_dir}")
            # Resuming a run whose target reaches HTML after SCRIPT finished:
            # restore every checkpoint (shot cache by listing, per-shot TTS,
            # preamble, reference context, host outputs, lesson teacher). Not
            # when SCRIPT itself re-runs — a new script invalidates them.
            _restore_ckpt = bool(resuming) and target_stage_idx >= 4 and start_stage_idx >= 2
            
            # Always need script.txt if resuming from SCRIPT or later (pipeline skips script generation when resuming)
            if start_stage_idx >= 1:  # SCRIPT, TTS, WORDS, HTML, or RENDER
                script_url = video_record.s3_urls.get("script")
                if script_url:
                    script_path = run_dir / "script.txt"
                    if not script_path.exists():
                        logger.info(f"[VideoGenService] Downloading script.txt from S3...")
                        if self.s3_service.download_file(script_url, script_path):
                            logger.info(f"[VideoGenService] Successfully downloaded script.txt")
                        else:
                            logger.warning(f"[VideoGenService] Failed to download script.txt from {script_url}")

                # Also pull internal plan files — `script_plan.json` (v2) and
                # `shot_plan.json` (v3). Without these, the resume path loads
                # `plan_data = {}` and the Director skips with "missing script
                # or beat outline" (v2) or the v3 ShotPlanner falls back to a
                # synthesized stub. Both are uploaded by the SCRIPT stage and
                # the public S3 URL is reconstructed from convention.
                try:
                    from ..config import get_settings
                    settings = get_settings()
                    bucket = settings.aws_bucket_name or settings.aws_s3_public_bucket
                    for _plan_name in ("script_plan.json", "shot_plan.json"):
                        plan_key = f"ai-videos/{video_id}/script/{_plan_name}"
                        plan_url = f"https://{bucket}.s3.amazonaws.com/{plan_key}"
                        plan_local = run_dir / _plan_name
                        if plan_local.exists():
                            continue
                        # The checkpoints/ copy carries the post-gate cast and
                        # narration edits — prefer it on a checkpoint resume.
                        if _plan_name == "shot_plan.json" and _restore_ckpt:
                            if self.s3_service.download_file(
                                f"https://{bucket}.s3.amazonaws.com/ai-videos/{video_id}/checkpoints/shot_plan.json",
                                plan_local, expected_missing=True,
                            ):
                                logger.info("[VideoGenService] Restored shot_plan.json from checkpoints/")
                                continue
                        logger.info(f"[VideoGenService] Attempting to download {_plan_name} from S3...")
                        if self.s3_service.download_file(plan_url, plan_local, expected_missing=True):
                            logger.info(f"[VideoGenService] Successfully downloaded {_plan_name}")
                        else:
                            logger.info(
                                f"[VideoGenService] {_plan_name} not found in S3 "
                                f"(legacy run or v2-only / v3-only path? "
                                f"Director/ShotPlanner will use a synthesized fallback)"
                            )
                except Exception as e:
                    logger.warning(f"[VideoGenService] Could not download plan JSON files: {e}")
            
            # Need narration_raw.json and narration.mp3 if resuming from WORDS or later
            if start_stage_idx >= 3:  # WORDS, HTML, or RENDER
                # Note: narration_raw.json might not be in S3 yet (it's an intermediate file)
                # We'll try to download it, but if it doesn't exist, the pipeline should generate TTS
                audio_url = video_record.s3_urls.get("audio") or self._s3_url(f"ai-videos/{video_id}/audio/narration.mp3")
                if audio_url:
                    audio_path = run_dir / "narration.mp3"
                    if not audio_path.exists():
                        logger.info(f"[VideoGenService] Downloading narration.mp3 from S3...")
                        if self.s3_service.download_file(audio_url, audio_path):
                            logger.info(f"[VideoGenService] Successfully downloaded narration.mp3")
                        else:
                            logger.warning(f"[VideoGenService] Failed to download narration.mp3 from {audio_url}")
                
                # Try to download narration_raw.json if it exists in S3
                # This file is saved during TTS generation but might not be in S3 yet
                # We'll construct the S3 key and try to download it
                try:
                    from ..config import get_settings
                    settings = get_settings()
                    bucket = settings.aws_bucket_name or settings.aws_s3_public_bucket
                    narration_raw_key = f"ai-videos/{video_id}/audio/narration_raw.json"
                    narration_raw_url = f"https://{bucket}.s3.amazonaws.com/{narration_raw_key}"
                    narration_raw_path = run_dir / "narration_raw.json"
                    if not narration_raw_path.exists():
                        logger.info(f"[VideoGenService] Attempting to download narration_raw.json from S3...")
                        if self.s3_service.download_file(narration_raw_url, narration_raw_path, expected_missing=True):
                            logger.info(f"[VideoGenService] Successfully downloaded narration_raw.json")
                        else:
                            logger.info(f"[VideoGenService] narration_raw.json not found in S3 (this is OK if TTS needs to be regenerated)")
                except Exception as e:
                    logger.warning(f"[VideoGenService] Could not download narration_raw.json: {e}")
            
            # Need words files if resuming from HTML or later
            if start_stage_idx >= 4:  # HTML or RENDER
                words_url = video_record.s3_urls.get("words") or self._s3_url(f"ai-videos/{video_id}/words/narration.words.json")
                if words_url:
                    words_path = run_dir / "narration.words.json"
                    if not words_path.exists():
                        logger.info(f"[VideoGenService] Downloading narration.words.json from S3...")
                        if self.s3_service.download_file(words_url, words_path):
                            logger.info(f"[VideoGenService] Successfully downloaded narration.words.json")
                    # narration.words.csv — the html-resume REQUIRES this alongside
                    # the .json (assist gate persists it to the same words/ prefix).
                    # Derive its URL from the .json URL.
                    words_csv_path = run_dir / "narration.words.csv"
                    if not words_csv_path.exists():
                        _csv_url = words_url.replace("narration.words.json", "narration.words.csv")
                        if self.s3_service.download_file(_csv_url, words_csv_path, expected_missing=True):
                            logger.info(f"[VideoGenService] Successfully downloaded narration.words.csv")

            # Checkpoints for an intra-HTML / combine resume (director plan,
            # per-shot cache listed — never probed —, per-shot TTS, preamble…).
            if start_stage_idx >= 4 or _restore_ckpt:
                self._restore_checkpoints(video_id, run_dir, video_record)

            # Need branding_meta.json for render stage (audio delay)
            if start_stage_idx >= 5:  # RENDER
                branding_meta_url = video_record.s3_urls.get("branding_meta")
                if branding_meta_url:
                    branding_meta_path = run_dir / "branding_meta.json"
                    if not branding_meta_path.exists():
                        logger.info(f"[VideoGenService] Downloading branding_meta.json from S3...")
                        if self.s3_service.download_file(branding_meta_url, branding_meta_path):
                            logger.info(f"[VideoGenService] Successfully downloaded branding_meta.json")
        
        # ── Intent router + Video-type classifier — pre-script preamble ──
        # Both run once per fresh video (gate <=1 because new videos start at
        # stage_idx=1 — PENDING is never entered, so ==0 would dead-code these).
        # They share inputs and have no mutual dependency, so we fan them out
        # in parallel and pay only the slower call's wall-clock.
        from ..schemas.routing import HostPlan, RoutingPlan, VideoTypePlan
        routing_plan = RoutingPlan()  # safe default
        video_type_plan = VideoTypePlan()  # safe default ("explainer", education)
        host_plan = HostPlan(enabled=False)  # safe default
        if start_stage_idx <= 1 and prompt:
            try:
                import asyncio as _asyncio
                from .intent_router_service import IntentRouterService, apply_overrides
                from .video_type_classifier_service import (
                    VideoTypeClassifierService,
                    apply_user_override as apply_video_type_override,
                )
                from .web_content_capture_service import extract_urls
                urls_found = extract_urls(prompt, max_urls=5)
                router_svc = IntentRouterService(openrouter_key=openrouter_key)
                type_svc = VideoTypeClassifierService(openrouter_key=openrouter_key)

                # User can pre-pick a type via routing_overrides.video_type — wins
                # over LLM classification (mirrors how tool overrides work today).
                user_type_override = None
                if isinstance(routing_overrides, dict):
                    user_type_override = routing_overrides.get("video_type")

                routing_plan, video_type_plan = await _asyncio.gather(
                    router_svc.route(
                        prompt=prompt,
                        input_video_count=len(input_video_ids or []),
                        attached_file_count=len(reference_files or []),
                        urls_in_prompt=urls_found,
                        orientation=orientation,
                        content_type=content_type,
                    ),
                    type_svc.classify(
                        prompt=prompt,
                        input_video_count=len(input_video_ids or []),
                        attached_file_count=len(reference_files or []),
                        urls_in_prompt=urls_found,
                        orientation=orientation,
                        content_type=content_type,
                        target_duration=target_duration,
                    ),
                )
                routing_plan = apply_overrides(routing_plan, routing_overrides)
                video_type_plan = apply_video_type_override(video_type_plan, user_type_override)
                (run_dir / "routing_plan.json").write_text(
                    routing_plan.model_dump_json(indent=2), encoding="utf-8"
                )
                (run_dir / "video_type.json").write_text(
                    video_type_plan.model_dump_json(indent=2), encoding="utf-8"
                )
                logger.info(f"[VideoGenService] Routing plan: {routing_plan.explanation}")
                logger.info(
                    f"[VideoGenService] Video type: {video_type_plan.type} "
                    f"(cadence={video_type_plan.cadence_hint}, "
                    f"conf={video_type_plan.confidence:.2f}) — {video_type_plan.reason}"
                )

                # Host plan (no LLM call — pure validation + normalisation).
                # Tier-gate already passed at the top of generate_till_stage,
                # so any failure here is a programmer error and we re-raise.
                if host is not None:
                    try:
                        from .host_planner_service import make_host_plan
                        from ..config import get_settings as _get_settings_inner
                        host_plan = make_host_plan(
                            host,
                            quality_tier=quality_tier,
                            fal_api_key=getattr(_get_settings_inner(), "fal_api_key", None) or "",
                            resolved_saved_avatar=resolved_saved_avatar,
                        )
                        (run_dir / "host_plan.json").write_text(
                            host_plan.model_dump_json(indent=2), encoding="utf-8"
                        )
                        if host_plan.enabled:
                            if host_plan.is_avatar() and host_plan.avatar:
                                from .host_planner_service import effective_avatar_endpoint
                                _endpoint = effective_avatar_endpoint(
                                    host_plan.avatar.provider,
                                    host_plan.avatar.avatar_model,
                                )
                                _hp_summary = (
                                    f"avatar provider={host_plan.avatar.provider} "
                                    f"endpoint={_endpoint} q={host_plan.avatar.quality}"
                                )
                            elif host_plan.is_raw():
                                _hp_summary = (
                                    f"raw input_videos="
                                    f"{len(host_plan.raw.input_video_ids) if host_plan.raw else 0}"
                                )
                            else:
                                _hp_summary = "(unknown)"
                            logger.info(
                                f"[VideoGenService] Host plan: type={host_plan.type} "
                                f"pct={host_plan.host_in_video_percentage}% — {_hp_summary}"
                            )
                    except Exception as he:
                        logger.warning(f"[VideoGenService] Host plan failed (non-fatal): {he}")
            except Exception as e:
                logger.warning(f"[VideoGenService] Pre-script preamble failed (non-fatal): {e}")
        else:
            cached_plan = run_dir / "routing_plan.json"
            if cached_plan.exists():
                try:
                    routing_plan = RoutingPlan.model_validate_json(cached_plan.read_text(encoding="utf-8"))
                except Exception as e:
                    logger.warning(f"[VideoGenService] Cached routing plan unreadable: {e}")
            cached_type = run_dir / "video_type.json"
            if cached_type.exists():
                try:
                    video_type_plan = VideoTypePlan.model_validate_json(cached_type.read_text(encoding="utf-8"))
                except Exception as e:
                    logger.warning(f"[VideoGenService] Cached video_type unreadable: {e}")
            cached_host = run_dir / "host_plan.json"
            if cached_host.exists():
                try:
                    host_plan = HostPlan.model_validate_json(cached_host.read_text(encoding="utf-8"))
                except Exception as e:
                    logger.warning(f"[VideoGenService] Cached host_plan unreadable: {e}")

        # ── Visual preferences (Slice A — deterministic, no LLM) ──
        # Scan the prompt for visual treatment hints, merge with the user's
        # structured slider input. Free-text wins on overlap (Q4 design rule).
        # Runs on every path — fresh or resume — and caches to
        # run_dir/visual_preferences.json. The merged view is mirrored into
        # extra_metadata.intent_outcomes further below; the raw view is kept
        # in extra_metadata.user_selections so history can pre-fill sliders
        # to exactly what the user originally picked.
        # ── Lesson mode plan — persisted for resume legs ──
        # Fresh runs arrive with the validated plan; resumes (assist gates,
        # stage-by-stage review, another pod) re-read it from run_dir or the
        # video record so the second half is still taught as a lesson.
        try:
            _lesson_cache = run_dir / "lesson_plan.json"
            if lesson_plan:
                _lesson_cache.write_text(json.dumps(lesson_plan, indent=2), encoding="utf-8")
                _vrec_l = self.repository.get_by_video_id(video_id)
                _emeta_l = (_vrec_l.extra_metadata or {}) if _vrec_l else {}
                _emeta_l["lesson"] = {**(_emeta_l.get("lesson") or {}), "plan": lesson_plan}
                self.repository.update_metadata(video_id, _emeta_l)
            else:
                if _lesson_cache.exists():
                    lesson_plan = json.loads(_lesson_cache.read_text(encoding="utf-8")) or None
                if not lesson_plan:
                    _vrec_l = self.repository.get_by_video_id(video_id)
                    lesson_plan = (((_vrec_l.extra_metadata or {}) if _vrec_l else {})
                                   .get("lesson") or {}).get("plan") or None
        except Exception as _lp_err:
            logger.warning(f"[VideoGenService] Lesson plan persist/reload failed: {_lp_err}")

        visual_prefs_struct: Dict[str, Any] = {}
        visual_prefs_from_text: Dict[str, Any] = {}
        visual_prefs_resolved: Dict[str, Any] = {}
        try:
            from .intent_router_service import (
                extract_visual_preferences_from_text,
                merge_visual_preferences,
            )
            cached_vp = run_dir / "visual_preferences.json"
            if visual_preferences is None and cached_vp.exists():
                # Resume / retry with no fresh slider input — reuse cached view.
                try:
                    _cached = json.loads(cached_vp.read_text(encoding="utf-8"))
                    visual_prefs_struct = _cached.get("raw") or {}
                    visual_prefs_from_text = _cached.get("from_text") or {}
                    visual_prefs_resolved = _cached.get("resolved") or {}
                except Exception as e:
                    logger.warning(f"[VideoGenService] Cached visual_preferences unreadable: {e}")
            if not visual_prefs_resolved:
                # Fresh run, OR cache missing on resume — scan + merge.
                if visual_preferences is not None:
                    visual_prefs_struct = (
                        visual_preferences.model_dump()
                        if hasattr(visual_preferences, "model_dump")
                        else dict(visual_preferences)
                    )
                visual_prefs_from_text = extract_visual_preferences_from_text(prompt or "")
                visual_prefs_resolved = merge_visual_preferences(
                    visual_prefs_struct, visual_prefs_from_text
                )
                cached_vp.write_text(
                    json.dumps(
                        {
                            "raw": visual_prefs_struct,
                            "from_text": visual_prefs_from_text,
                            "resolved": visual_prefs_resolved,
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                )
            _flagged = {k: v for k, v in visual_prefs_resolved.items() if v is not None}
            if _flagged:
                logger.info(f"[VideoGenService] Visual preferences resolved: {_flagged}")
        except Exception as e:
            logger.warning(f"[VideoGenService] Visual preferences resolution failed (non-fatal): {e}")

        # ── Web capture (only if router enabled scrape_url) ──
        # Artifacts are captured into _scrape_artifacts so we can persist them
        # to extra_metadata.intent_outcomes for later quality analysis (e.g.
        # the Telangana run where scrape returned thin content).
        captured_text_context = ""
        _scrape_artifacts: Optional[Dict[str, Any]] = None
        if start_stage_idx <= 1 and prompt and routing_plan.is_tool_enabled("scrape_url"):
            try:
                from .web_content_capture_service import WebContentCaptureService, extract_urls
                urls = extract_urls(prompt, max_urls=2)
                if urls:
                    logger.info(f"[VideoGenService] scrape_url enabled — capturing {len(urls)} URL(s): {urls}")
                    capture_svc = WebContentCaptureService(s3_service=self.s3_service)
                    captured_files, captured_text_context = await capture_svc.capture_urls(urls, run_dir)
                    if captured_files:
                        reference_files = (reference_files or []) + captured_files
                        logger.info(
                            f"[VideoGenService] Web capture added {len(captured_files)} "
                            f"reference files, {len(captured_text_context)} chars text"
                        )
                    # Snapshot for analysis. Cap text at 4000 chars to keep the
                    # metadata column lean while still preserving enough excerpt
                    # to judge whether the scrape captured the article body.
                    _captured_files_safe = captured_files if isinstance(captured_files, list) else []
                    # Stamp each captured file with a stable id so the Director
                    # and ARTICLE_FOCUS template can reference screenshots by
                    # role ("above_fold", "mid", "footer", "inline_0"…) instead
                    # of fragile slug-prefixed filenames.
                    _assign_capture_ids(_captured_files_safe)
                    _scrape_artifacts = {
                        "urls_attempted": urls,
                        "files_captured": _captured_files_safe,
                        "files_count": len(_captured_files_safe),
                        "screenshot_count": sum(
                            1 for f in _captured_files_safe
                            if (f.get("id") or "") in ("above_fold", "mid", "footer")
                        ),
                        "inline_image_count": sum(
                            1 for f in _captured_files_safe
                            if str(f.get("id") or "").startswith("inline_")
                        ),
                        "text_chars": len(captured_text_context or ""),
                        "text_excerpt": (captured_text_context or "")[:4000],
                    }
            except Exception as e:
                logger.warning(f"[VideoGenService] Web capture failed (non-fatal): {e}")
                _scrape_artifacts = {"error": str(e)}

        # ── Web search (only if router enabled web_search) ──
        searched_text_context = ""
        _search_artifacts: Optional[Dict[str, Any]] = None
        if start_stage_idx <= 1 and routing_plan.is_tool_enabled("web_search"):
            try:
                ws_tool = routing_plan.get_tool("web_search")
                query = (ws_tool.params or {}).get("query", "") if ws_tool else ""
                if query:
                    from .web_search_service import WebSearchService, format_search_for_context
                    logger.info(f"[VideoGenService] web_search enabled — query={query!r}")
                    search_svc = WebSearchService(openrouter_key=openrouter_key)
                    result = await search_svc.search(query)
                    searched_text_context = format_search_for_context(result)
                    # Snapshot. Cap synthesized answer at 2000 chars; sources
                    # are already small (host+url+empty snippet).
                    _ans = (result.get("answer") or "") if isinstance(result, dict) else ""
                    _src = result.get("sources") if isinstance(result, dict) else []
                    _search_artifacts = {
                        "query": query,
                        "answer": _ans[:2000],
                        "answer_chars": len(_ans),
                        "sources": _src or [],
                        "sources_count": len(_src or []),
                    }
            except Exception as e:
                logger.warning(f"[VideoGenService] Web search failed (non-fatal): {e}")
                _search_artifacts = {"error": str(e)}

        # ── Resolve mute_tts_on_source_clips from routing plan ──
        # apply_overrides() has already merged any user toggle into routing_plan.config,
        # so it represents the final user+router decision. The legacy kwarg can only force ON
        # (its default is False, indistinguishable from "not set"); the plan wins otherwise.
        if routing_plan.config.mute_tts_on_source_clips and not mute_tts_on_source_clips:
            mute_tts_on_source_clips = True
            logger.info("[VideoGenService] mute_tts_on_source_clips=true per routing plan")

        # ── Persist user_selections + intent_outcomes to extra_metadata ──
        # Snapshot of what the user asked for + what the pre-script preamble
        # decided on their behalf, INCLUDING the raw artifacts produced by
        # scrape_url and web_search. Lets history, debugging, and quality
        # analysis reproduce the exact context the pipeline ran with — without
        # poking at run_dir/*.json files. Only persists for fresh runs (resume
        # paths read the cached run_dir/*.json instead and skip re-classification).
        if start_stage_idx <= 1:
            try:
                _vrec = self.repository.get_by_video_id(video_id)
                _emeta = (_vrec.extra_metadata or {}) if _vrec else {}
                _emeta["user_selections"] = {
                    "prompt": prompt,
                    "content_type": content_type,
                    "quality_tier": quality_tier,
                    "model": model,
                    # Persist target_stage (canonical uppercase: SCRIPT/TTS/WORDS/HTML/RENDER)
                    # so the FE can distinguish review-mode runs (target_stage='SCRIPT')
                    # from full runs without depending on SSE replay state.
                    "target_stage": self.STAGES[target_stage_idx],
                    "target_duration": target_duration,
                    "target_audience": target_audience,
                    "orientation": orientation,
                    "language": language,
                    "voice_gender": voice_gender,
                    "tts_provider": tts_provider,
                    "voice_id": voice_id,
                    "html_quality": html_quality,
                    "captions_enabled": captions_enabled,
                    "generate_avatar": generate_avatar,
                    "avatar_image_url": avatar_image_url,
                    "sound_effects_enabled": sound_effects_enabled,
                    "background_music_enabled": background_music_enabled,
                    "background_music_volume": background_music_volume,
                    "sub_shots_enabled": sub_shots_enabled,
                    "dialogue_scenes_enabled": dialogue_scenes_enabled,
                    "dialogue_mode": dialogue_mode,
                    "dialogue_clip_model": dialogue_clip_model,
                    "saved_cast": saved_cast,
                    "mute_tts_on_source_clips_kwarg": mute_tts_on_source_clips,
                    "input_video_ids": input_video_ids,
                    "input_video_audio": input_video_audio,
                    "reference_files_count": len(reference_files or []),
                    "routing_overrides": routing_overrides,
                    # Raw slider input (None for unset families) — used by the
                    # FE history sidebar to pre-fill sliders to what the user
                    # originally picked. Free-text overrides land in
                    # intent_outcomes.visual_preferences_resolved instead.
                    "visual_preferences": visual_prefs_struct,
                    # Pipeline architecture flag — written up-front so the FE
                    # renders the right graph without waiting for SSE events.
                    # `_resolve_pipeline_version` is now a constant `"v3"` (v2
                    # deprecated, no longer user-selectable). Historical
                    # records may still have `"v2"` persisted from before this
                    # change and render under the v2 graph — that's correct
                    # display of what actually ran. Only new gen-starts get
                    # `"v3"` stamped going forward.
                    "pipeline_version": _resolve_pipeline_version(quality_tier),
                }
                _emeta["intent_outcomes"] = {
                    "video_type": video_type_plan.model_dump(),
                    "routing_plan": routing_plan.model_dump(),
                    "tools_enabled": [
                        t.name for t in routing_plan.tools if t.enabled
                    ],
                    "scrape_url_artifacts": _scrape_artifacts,
                    "web_search_artifacts": _search_artifacts,
                    # What the IntentRouter free-text scan picked up (only the
                    # non-None keys actually fired) and the post-merge view the
                    # downstream Script LLM / Director will consume in Slices B/C.
                    "visual_preferences_from_text": visual_prefs_from_text,
                    "visual_preferences_resolved": visual_prefs_resolved,
                }
                # Host snapshot. Inputs come from the HostPlan (post-tier-gate);
                # outputs (per-shot avatar URLs, fal job ids, total seconds) are
                # written by the AvatarBatch sub-stage during HTML generation.
                if host_plan and host_plan.enabled:
                    _hp_dump = host_plan.model_dump()
                    _existing_host = _emeta.get("host") or {}
                    _emeta["host"] = {
                        **_hp_dump,
                        # Preserve any outputs already written by an earlier
                        # AvatarBatch run (resume safety).
                        "outputs": _existing_host.get("outputs", {
                            "host_shot_indices": [],
                            "host_shot_count": 0,
                            "total_host_seconds": 0.0,
                            "shot_artifacts": [],
                            "errors": [],
                        }),
                        "estimated_cost_usd": _existing_host.get("estimated_cost_usd"),
                    }
                self.repository.update_metadata(video_id, _emeta)
            except Exception as _e:
                logger.warning(f"[VideoGenService] Failed to persist selections/outcomes: {_e}")

        # ── Process reference files (images/PDFs) ──
        reference_context = None
        if reference_files:
            try:
                from .reference_file_service import ReferenceFileService
                ref_svc = ReferenceFileService(
                    openrouter_key=openrouter_key,
                    s3_service=self.s3_service,
                )
                # Try cached first (for resume)
                reference_context = ReferenceFileService.load_cached(run_dir)
                if reference_context:
                    logger.info(f"[VideoGenService] Loaded cached reference context from {run_dir}")
                else:
                    logger.info(f"[VideoGenService] Processing {len(reference_files)} reference files...")
                    # Run on a thread so the event loop stays responsive.
                    # `ref_svc.process()` is sync end-to-end and makes 6-10s
                    # blocking LLM calls per reference image (Gemini vision via
                    # urllib.request.urlopen). With 6 images per run × 3 concurrent
                    # generations, the loop was blocked >150s — past the liveness
                    # probe's 5×30s threshold — and kubelet was SIGKILLing the pod
                    # (Exit 137, Reason: Error — not OOM, despite the symptom).
                    reference_context = await asyncio.to_thread(
                        ref_svc.process, reference_files, run_dir
                    )
                    logger.info(
                        f"[VideoGenService] Reference context ready: "
                        f"{len(reference_context.text_context)} chars text, "
                        f"{len(reference_context.embeddable_images)} images"
                    )
            except Exception as e:
                logger.warning(f"[VideoGenService] Reference file processing failed (non-fatal): {e}")
                reference_context = None

        # Resume: the final reference context (web capture + search text +
        # scrape artifacts merged) was checkpointed at SCRIPT end — reload it
        # even when this leg was given no reference_files.
        if reference_context is None and resuming and start_stage_idx >= 2:
            try:
                from .reference_file_service import ReferenceFileService
                reference_context = ReferenceFileService.load_cached(run_dir)
                if reference_context is not None:
                    logger.info(f"[VideoGenService] Restored reference context for {video_id}")
            except Exception as _rc_err:  # noqa: BLE001
                logger.warning(f"[VideoGenService] Could not reload reference context: {_rc_err}")

        # ── Merge captured page text + web search results into ReferenceContext ──
        extra_text_blocks = [b for b in (captured_text_context, searched_text_context) if b]
        if extra_text_blocks:
            extra_text = "\n\n".join(extra_text_blocks)
            if reference_context:
                reference_context.text_context = (
                    (reference_context.text_context + "\n\n" + extra_text)
                    if reference_context.text_context else extra_text
                )
            else:
                from .reference_file_service import ReferenceContext
                reference_context = ReferenceContext(text_context=extra_text)

        # ── Stash scrape artifacts on ReferenceContext so the Director +
        # ARTICLE_FOCUS template can look up screenshots by stable id without
        # poking at extra_metadata.intent_outcomes downstream.
        if _scrape_artifacts:
            if reference_context is None:
                from .reference_file_service import ReferenceContext
                reference_context = ReferenceContext()
            reference_context.scrape_artifacts = dict(_scrape_artifacts)

        # ── Load indexed input video contexts (if provided) ──
        input_video_contexts = None
        logger.info(f"[VideoGenService] input_video_ids={input_video_ids}, input_video_audio={input_video_audio}")
        if input_video_ids:
            try:
                import json as _json
                from ..repositories.ai_input_video_repository import AiInputVideoRepository
                iv_repo = AiInputVideoRepository(session=db_session)
                iv_records = iv_repo.get_by_ids(input_video_ids)
                logger.info(f"[VideoGenService] Found {len(iv_records)}/{len(input_video_ids)} input videos")

                loaded_contexts = []
                source_video_urls = []
                # The schema-level cap is a shared ceiling across both kinds.
                # Videos carry the real cost (a large download plus an index
                # job each) and the splice constraints, so they keep the
                # original limit of 5; images are bounded only by prompt size.
                from ..schemas.video_generation import MAX_INPUT_VIDEOS
                _video_count = 0
                for idx, iv_record in enumerate(iv_records):
                    # Polymorphic asset table: kind ∈ {video, image}. Old rows
                    # default to 'video' since the column was backfilled there.
                    iv_kind = getattr(iv_record, "kind", "video") or "video"

                    if iv_kind != "image":
                        _video_count += 1
                        if _video_count > MAX_INPUT_VIDEOS:
                            logger.warning(
                                f"[VideoGenService] Input video {iv_record.id} skipped — "
                                f"more than {MAX_INPUT_VIDEOS} videos selected"
                            )
                            continue

                    # Pick the metadata-URL field that corresponds to the kind.
                    if iv_kind == "image":
                        metadata_url = iv_record.image_metadata_url
                        local_filename = f"input_image_metadata_{idx}.json"
                    else:
                        metadata_url = iv_record.context_json_url
                        local_filename = f"input_video_context_{idx}.json"

                    if iv_record.status != "COMPLETED" or not metadata_url:
                        logger.warning(f"[VideoGenService] Input asset {iv_record.id} skipped "
                                       f"(kind={iv_kind}, status={iv_record.status})")
                        continue

                    # Download the metadata JSON (image_metadata.json or video_context.json).
                    context_path = run_dir / local_filename
                    if not context_path.exists():
                        context_path.parent.mkdir(parents=True, exist_ok=True)
                        _ctx_url = metadata_url
                        _downloaded = False
                        for _bkt in ["vacademy-media-storage", "vacademy-media-storage-public"]:
                            if _bkt in _ctx_url:
                                try:
                                    _key = extract_s3_key(_ctx_url, _bkt)
                                    if _key:
                                        self.s3_service.s3_client.download_file(
                                            _bkt, _key, str(context_path)
                                        )
                                        _downloaded = True
                                        break
                                except Exception:
                                    continue
                        if not _downloaded:
                            import httpx
                            resp = httpx.get(_ctx_url, timeout=60)
                            resp.raise_for_status()
                            context_path.write_bytes(resp.content)

                    _iv_assets = iv_record.assets_urls or {}

                    if iv_kind == "image":
                        # Mode-driven duration default: gives screenshots more
                        # dwell time than photos so OCR + UI labels are readable;
                        # diagrams need the longest beat to absorb structure.
                        _IMG_DURATION_BY_MODE = {"photo": 4.0, "screenshot": 6.0, "diagram": 8.0}
                        ctx = {
                            "index": idx,
                            "kind": "image",
                            "context": _json.loads(context_path.read_text()),
                            "source_url": iv_record.source_url,
                            "source_public_url": _iv_assets.get("source_image", "") or iv_record.source_url,
                            "assets_urls": _iv_assets,
                            "input_video_id": str(iv_record.id),  # legacy field name kept
                            "name": iv_record.name or f"Image {idx}",
                            "duration_seconds": _IMG_DURATION_BY_MODE.get(iv_record.mode, 5.0),
                            "mode": iv_record.mode,
                            "width": iv_record.width,
                            "height": iv_record.height,
                            # Images have no audio track; force TTS narration.
                            "audio_preference": "tts",
                        }
                        logger.info(f"[VideoGenService] Loaded input image [{idx}]: "
                                    f"{iv_record.name} ({iv_record.width}x{iv_record.height}, "
                                    f"mode={iv_record.mode}, default_duration={ctx['duration_seconds']}s)")
                    else:
                        # Resolve audio preference (video only)
                        _audio_pref = input_video_audio
                        if not _audio_pref:
                            if len(input_video_ids) > 1:
                                _audio_pref = "tts"
                            else:
                                _audio_pref = "original" if iv_record.mode == "podcast" else "tts"
                        ctx = {
                            "index": idx,
                            "kind": "video",
                            "context": _json.loads(context_path.read_text()),
                            "source_url": iv_record.source_url,
                            "source_public_url": _iv_assets.get("source_video", ""),
                            "assets_urls": _iv_assets,
                            "input_video_id": str(iv_record.id),
                            "name": iv_record.name or f"Video {idx}",
                            "duration_seconds": iv_record.duration_seconds,
                            "mode": iv_record.mode,
                            "audio_preference": _audio_pref,
                        }
                        source_video_urls.append(iv_record.source_url)
                        logger.info(f"[VideoGenService] Loaded input video [{idx}]: "
                                    f"{iv_record.name} ({iv_record.duration_seconds:.1f}s, mode={iv_record.mode})")
                    loaded_contexts.append(ctx)

                if loaded_contexts:
                    input_video_contexts = loaded_contexts
                    # Store in metadata for render endpoint
                    try:
                        video_record = self.repository.get_by_video_id(video_id)
                        if video_record:
                            existing_meta = video_record.extra_metadata or {}
                            existing_meta["source_video_urls"] = source_video_urls
                            existing_meta["input_video_ids"] = input_video_ids
                            # Backward compat: keep singular for old render path
                            existing_meta["source_video_url"] = source_video_urls[0]
                            existing_meta["input_video_id"] = input_video_ids[0]
                            self.repository.update_metadata(video_id, existing_meta)
                    except Exception:
                        pass  # non-fatal
            except Exception as e:
                logger.warning(f"[VideoGenService] Input video context loading failed (non-fatal): {e}")
                input_video_contexts = None

        # Calculate percentage per stage
        total_stages = target_stage_idx - start_stage_idx + 1
        percentage_per_stage = 80 / total_stages if total_stages > 0 else 80  # Save 20% for final processing

        # Update status to IN_PROGRESS at starting stage
        self.repository.update_stage(video_id, self.STAGES[start_stage_idx], "IN_PROGRESS")
        
        yield {
            "type": "progress",
            "stage": self.STAGES[start_stage_idx],
            "message": f"Starting generation from {start_from}",
            "percentage": 5,
            "video_id": video_id
        }
        
        # Setup for pipeline execution
        import asyncio
        import functools
        from concurrent.futures import ThreadPoolExecutor
        
        loop = asyncio.get_event_loop()
        pipeline_error = None
        
        # Map of expected files for each stage
        # Format: (output_key_from_pipeline, file_key_for_db_s3, file_name)
        # file_key is used as the key in s3_urls and file_ids in the database
        file_map = {
            # `script.txt` goes into the DB s3_urls (consumers ask for it).
            # `script_plan.json` is internal — uploaded for resume capability so
            # later stages (TTS/WORDS/HTML) can rehydrate the structured plan
            # (beat_outline, subject_domain, visual_style, key_terms, etc.).
            # Without this, resume at HTML loses the plan and the Director skips.
            "script": [
                ("script_path", "script", "script.txt"),
                (None, None, "script_plan.json"),  # internal — see download path (v2)
                (None, None, "shot_plan.json"),    # internal — see download path (v3)
            ],
            "tts": [
                ("audio_path", "audio", "narration.mp3"),
                # narration_raw.json is uploaded to S3 for resume capability but stored separately
                # We use "audio" stage but different handling to avoid overwriting narration.mp3
                (None, None, "narration_raw.json")  # Upload but don't store in main s3_urls (internal file)
            ],
            "words": [
                ("words_json", "words", "narration.words.json"),
                # The HTML resume REQUIRES the csv next to the json.
                (None, None, "narration.words.csv"),
                (None, "alignment", "alignment.json")  # alignment.json (not in outputs dict)
            ],
            "html": [
                (None, "generated_images", "generated_images"),  # Directory - process FIRST to build image mapping
                (None, "branding_meta", "branding_meta.json"),  # Branding metadata for audio delay
                # Per-shot TTS artifacts (Phase B / v2): the `tts/` directory
                # under run_dir contains shot_NNN.mp3, shot_NNN_raw.json, and
                # shot_NNN_script.txt for each shot. Uploaded as a directory
                # at `ai-videos/{video_id}/per_shot_tts/`. The editor uses
                # these for shot-level audio regeneration; the render server
                # continues to read the master narration.mp3 (re-uploaded
                # below). Skipped on legacy v1 runs because tts/ directory
                # doesn't exist there — upload loop tolerates missing dir.
                (None, "per_shot_tts", "tts"),
                ("timeline_json", "timeline", "time_based_frame.json"),  # Process AFTER images to update URLs
                ("audio_path", "audio", "narration.mp3"),  # Re-upload if audio was mixed with source clips
                ("words_json", "words", "narration.words.json"),  # Re-upload if words were filtered
                # Combine runs produce these inside the HTML pass — a later
                # resume past HTML (or an editor rebuild) needs them.
                (None, None, "narration.words.csv"),
                (None, None, "narration_raw.json"),
            ],
            "avatar": [("avatar_video_path", "avatar", "avatar_video.mp4")],
            "render": [("video_path", "video", "output.mp4")]
        }
        
        # Store image path mapping across stages (needed for html stage)
        image_path_mapping = {}  # Maps local file paths to S3 URLs

        # Cooperative stop signal — set by POST /cancel/{video_id} from the
        # router. Pipeline thread checks this at safe checkpoints and raises
        # PipelineCancelled. Cleared at the end of this generator (and as a
        # safety net by the router's _run_generation finally block).
        stop_event = cancellation_registry.register(video_id)

        # Resume hooks for pipeline.run — only passed when the pipeline's run()
        # accepts them (keeps this service deployable against an older
        # pipeline). checkpoint_callback(kind, paths) enqueues finished files
        # on the leg's uploader; resume_mode="auto" turns on the per-shot TTS
        # cache hit.
        _resume_run_kwargs: Dict[str, Any] = {}
        try:
            import inspect as _inspect
            _run_params = _inspect.signature(pipeline.run).parameters
            _var_kw = any(_p.kind == _p.VAR_KEYWORD for _p in _run_params.values())
            if checkpoint_uploader is not None and ("checkpoint_callback" in _run_params or _var_kw):
                from .video_checkpoint import make_checkpoint_callback
                _resume_run_kwargs["checkpoint_callback"] = make_checkpoint_callback(
                    checkpoint_uploader, video_id, work_dir
                )
            if resume_mode and ("resume_mode" in _run_params or _var_kw):
                _resume_run_kwargs["resume_mode"] = resume_mode
        except Exception as _rk_err:  # noqa: BLE001
            logger.warning(f"[VideoGenService] resume hooks not wired: {_rk_err}")

        def _fenced_exit() -> Dict[str, Any]:
            """Another pod took this run over: stop silently (no CANCELLED, no
            refund, no error event)."""
            if leg is not None:
                leg.interrupted = None
                if leg.handle is not None:
                    leg.handle.stop_reason = "fenced"
            logger.warning(f"[VideoGenService] {video_id}: lease fenced — leaving the run to its new owner")
            return {"type": "interrupted", "video_id": video_id, "reason": "fenced", "resuming": True}

        # ── PHASE B COMBINE (2026-05-14) ──────────────────────────────────
        # Phase B's per-shot TTS reorder requires the pipeline.run() call to
        # see do_tts=True AND do_html=True together. The per-stage iteration
        # below normally calls pipeline.run(start_from="tts", stop_at="tts")
        # for the TTS stage, which makes do_html=False inside that call —
        # falsifying the v2 gate. To fix: when Phase B conditions are met,
        # SKIP the individual TTS+WORDS iterations and run TTS+WORDS+HTML
        # as a single pipeline.run(start_from="tts", stop_at="html") during
        # what would have been the HTML iteration. The pipeline produces
        # narration.mp3 + words.json + timeline.json + per_shot_tts/ all in
        # that combined run, and the html-stage upload list at line ~1510
        # uploads every one of them.
        #
        # Conditions: target ≥ HTML, start ≤ TTS (fresh run or resume from
        # script), premium+ tier (has Director), VIDEO content type.
        _phase_b_combine = (
            target_stage_idx >= 4  # html
            and start_stage_idx <= 2  # tts or earlier
            and quality_tier in ("premium", "ultra", "super_ultra")
            and content_type == "VIDEO"
        )
        if _phase_b_combine:
            logger.info(
                f"[VideoGenService] 🧪 Phase B combine ACTIVE: TTS+WORDS+HTML "
                f"will run in a single pipeline.run(start_from='tts', stop_at='html') "
                f"call to enable per-shot TTS deferral (target={stop_at}, "
                f"start={start_from}, tier={quality_tier})"
            )

        # Iterate through stages individually
        for stage_idx in range(start_stage_idx, target_stage_idx + 1):
            if pipeline_error:
                logger.warning(f"[VideoGenService] Stopping stage loop due to error in previous stage")
                break

            # Check the stop flag at the start of each stage — cheapest
            # checkpoint, catches the case where the user cancelled while
            # we were uploading the previous stage's outputs to S3.
            if stop_event.is_set() and cancellation_registry.reason(video_id) == "fenced":
                yield _fenced_exit()
                return
            if stop_event.is_set():
                logger.info(f"[VideoGenService] Cancellation detected before stage {stage_idx}; halting")
                # Re-assert CANCELLED in DB. The cancel endpoint already
                # wrote it, but the previous stage's upload-loop may have
                # overwritten with IN_PROGRESS in between (race window).
                try:
                    self.repository.update_stage(
                        video_id, stage="CANCELLED", status="CANCELLED"
                    )
                except Exception:
                    pass
                yield {
                    "type": "cancelled",
                    "video_id": video_id,
                    "message": "Stopped by user",
                }
                cancellation_registry.clear(video_id)
                return

            # ── PHASE B COMBINE: skip TTS + WORDS individual iterations ──
            # When Phase B combine is active (Director-before-TTS reorder
            # requires TTS+HTML in a single pipeline.run), the per-shot TTS
            # + concat + reconcile work happens INSIDE the HTML iteration's
            # pipeline call (via start_from="tts"). The TTS and WORDS
            # individual iterations would otherwise call pipeline.run with
            # stop_at="tts" / "words" — falsifying do_html in the gate. So
            # we skip them here. The HTML iteration's upload list at
            # line ~1510 handles narration.mp3 + narration.words.json
            # upload, so the external file contract is preserved.
            if _phase_b_combine and stage_idx in (2, 3):
                logger.info(
                    f"[VideoGenService] 🧪 Phase B combine: skipping individual "
                    f"stage iteration for {self.STAGES[stage_idx]} (folded into HTML)"
                )
                try:
                    self.repository.update_stage(video_id, self.STAGES[stage_idx], "IN_PROGRESS")
                except Exception:
                    pass
                continue

            stage_name = self.STAGES[stage_idx]
            config = stage_config[stage_idx]
            stage_pipeline_name = config["name"]
            # Phase B: when HTML iteration runs with combine active, the
            # pipeline must start FROM TTS (not HTML) so the deferral gate
            # sees do_tts=True AND do_html=True in the same call. The pipeline
            # internally runs TTS-stage block (deferring), WORDS-stage block
            # (also deferring), then HTML-stage block (Director + per-shot
            # TTS + concat + html gen).
            _pipeline_start_from = stage_pipeline_name
            if _phase_b_combine and stage_idx == 4:  # html
                _pipeline_start_from = "tts"
                logger.info(
                    f"[VideoGenService] 🧪 Phase B combine: HTML iteration will "
                    f"call pipeline.run(start_from='tts', stop_at='html') to "
                    f"enable Director-before-TTS deferral"
                )
            
            # Yield progress at start of stage
            # Calculate percentage for start of this stage
            percentage = 5 + int((stage_idx - start_stage_idx) * percentage_per_stage)
            
            # Descriptive message: for HTML stage with Director enabled, show "Planning shots..."
            if stage_pipeline_name == "html" and quality_tier in ("premium", "ultra", "super_ultra"):
                _stage_message = "Planning shots & creating visuals..."
            else:
                _stage_message = f"Processing stage: {stage_pipeline_name.upper()}"

            yield {
                "type": "progress",
                "stage": stage_name,
                "message": _stage_message,
                "percentage": percentage,
                "video_id": video_id
            }
            
            outputs = None
            run_dir = work_dir # Default
            
            try:
                logger.info(f"[VideoGenService] Running pipeline stage: {stage_pipeline_name} (idx {stage_idx})")
                
                # For AVATAR stage: write audio S3 URL hint file so pipeline can pass it to RunPod
                if stage_pipeline_name == "avatar":
                    video_record = self.repository.get_by_video_id(video_id)
                    if video_record:
                        audio_s3_url = video_record.s3_urls.get("audio", "")
                        if audio_s3_url:
                            audio_url_file = run_dir / "audio_s3_url.txt"
                            audio_url_file.write_text(audio_s3_url)
                            logger.info(f"[VideoGenService] Wrote audio S3 URL hint for avatar stage: {audio_s3_url}")
                        else:
                            logger.warning("[VideoGenService] No audio S3 URL found for avatar stage")

                # Derive dimensions from orientation
                _vid_width = 1080 if orientation == "portrait" else 1920
                _vid_height = 1920 if orientation == "portrait" else 1080

                # Thread-safe queue: pipeline thread puts events; async loop drains them.
                # The live-progress aggregator is the structured-snapshot store the
                # polling /status endpoint reads from; the queue is the legacy SSE
                # delivery path (kept until the FE is fully on polling).
                _prog_queue: _queue.Queue = _queue.Queue()
                _aggregator = _get_run_state_aggregator()
                if _aggregator is not None:
                    _aggregator.start_run(video_id)

                def _progress_cb(event: Dict[str, Any]) -> None:
                    if _aggregator is not None:
                        _aggregator.handle_event(video_id, event)
                    _prog_queue.put_nowait(event)

                pipeline_run = functools.partial(
                    pipeline.run,
                    base_prompt=prompt,
                    run_name=video_id,
                    resume_run=None,
                    start_from=_pipeline_start_from,
                    stop_at=stage_pipeline_name,
                    language=language,
                    show_captions=captions_enabled,
                    html_quality=html_quality,
                    target_audience=target_audience,
                    target_duration=target_duration,
                    voice_gender=voice_gender,
                    tts_provider=tts_provider,
                    voice_id=voice_id,
                    branding_config=branding_config,
                    style_config=style_config,
                    # Free-text brand-kit director instructions (or the per-video
                    # system_prompt override, which replaces it). Injected into the
                    # ShotPlanner / Director / NarrationWriter / per-shot HTML system
                    # prompts. None = no brand direction (today's behavior).
                    brand_system_prompt=effective_brand_system_prompt,
                    content_type=content_type,
                    generate_avatar=generate_avatar,
                    avatar_image_url=avatar_image_url,
                    reference_context=reference_context.to_dict() if reference_context else None,
                    video_width=_vid_width,
                    video_height=_vid_height,
                    visual_style=visual_style,
                    sound_effects_enabled=sound_effects_enabled,
                    input_video_contexts=input_video_contexts,
                    mute_tts_on_source_clips=mute_tts_on_source_clips,
                    background_music_enabled=background_music_enabled,
                    background_music_volume=background_music_volume,
                    sub_shots_enabled=sub_shots_enabled,
                    dialogue_scenes_enabled=dialogue_scenes_enabled,
                    dialogue_mode=dialogue_mode,
                    dialogue_clip_model=dialogue_clip_model,
                    saved_cast=saved_cast,
                    routing_plan=routing_plan.model_dump() if routing_plan else None,
                    video_type_plan=video_type_plan.model_dump() if video_type_plan else None,
                    host_plan=host_plan.model_dump() if host_plan else None,
                    lesson_plan=lesson_plan or None,
                    # Resolved view = structured slider input merged with
                    # IntentRouter free-text scan (free-text wins on overlap).
                    # Empty / all-None → pipeline behaves identically to today.
                    visual_preferences=visual_prefs_resolved or None,
                    # AI video (Phase 3b): the pipeline gates eligibility by
                    # tier internally and downgrades silently when ineligible,
                    # so it's safe to forward whatever the request had.
                    ai_video_enabled=bool(ai_video_enabled),
                    ai_video_audio_enabled=bool(ai_video_audio_enabled),
                    ai_video_model=ai_video_model,
                    # Bind the AI video ledger writer to this institute so
                    # Veo USAGE_DEDUCTION rows are attributed correctly.
                    # Pipeline downgrades to no-op when institute_id is None.
                    institute_id=institute_id,
                    progress_callback=_progress_cb,
                    stop_event=stop_event,
                    # Assist mode: gate config + answer ledger. The HTML-stage
                    # visual_casting gate reads this; None ⇒ fully autonomous.
                    assist_state=assist_state,
                    **_resume_run_kwargs,
                )

                # Release the request-scoped DB connection before the long
                # pipeline run. SQLAlchemy auto-begins a transaction on the
                # session's first read (model routing / institute settings /
                # input assets above) and would hold the connection
                # idle-in-transaction for the entire LLM/TTS/render run —
                # PgBouncer/Postgres kills it, and every later touch of this
                # session (refunds, host credits, the router's exit commit)
                # then dies with psycopg ProtocolViolation "server conn
                # crashed?". Committing here returns the connection to the
                # pool; the session's next use checks out a fresh, pre-pinged
                # one.
                if db_session is not None:
                    try:
                        db_session.commit()
                    except Exception:
                        logger.warning(
                            f"[VideoGenService] Could not release DB connection "
                            f"before stage {stage_pipeline_name}; rolling back",
                            exc_info=True,
                        )
                        try:
                            db_session.rollback()
                        except Exception:
                            logger.warning(
                                "[VideoGenService] Rollback after failed "
                                "pre-stage release also failed; continuing",
                                exc_info=True,
                            )

                # Run pipeline in thread while draining the progress queue in the
                # async event loop so sub-stage events reach the SSE client in real time.
                _LIVE_FLUSH_INTERVAL_S = 5.0
                _last_live_flush_ts = 0.0
                with ThreadPoolExecutor() as executor:
                    _pipeline_future = loop.run_in_executor(executor, pipeline_run)
                    while not _pipeline_future.done():
                        # Drain all queued events without blocking the event loop
                        _drained: List[Dict[str, Any]] = []
                        while not _prog_queue.empty():
                            try:
                                _drained.append(_prog_queue.get_nowait())
                            except _queue.Empty:
                                break
                        for _ev in _drained:
                            # Attach video_id so the FE can correlate without extra state
                            _ev.setdefault("video_id", video_id)
                            # Persist latest generation_progress to DB metadata so
                            # GET /status also reflects sub-stage detail
                            if _ev.get("type") in (
                                "sub_stage", "shot_done", "shot_error"
                            ):
                                try:
                                    self.repository.update_generation_progress(video_id, _ev)
                                except Exception:
                                    pass
                            elif _ev.get("type") == "thumbnails_ready":
                                # Persist the full thumbnail set so Recent grid
                                # picks it up as soon as the background thread
                                # finishes (which can land before render does).
                                _thumbs = _ev.get("thumbnails") or {}
                                if _thumbs:
                                    try:
                                        self.repository.update_thumbnails(video_id, _thumbs)
                                    except Exception:
                                        pass
                            yield _ev
                        # Periodic flush of the live snapshot to DB so post-restart
                        # polls and history reads have something to fall back to.
                        # Best-effort; aggregator may be absent if module failed to
                        # load. 5s cadence keeps Postgres write volume bounded.
                        _now = time.time()
                        if _aggregator is not None and (_now - _last_live_flush_ts) >= _LIVE_FLUSH_INTERVAL_S:
                            try:
                                _snap = _aggregator.serialize_for_db(video_id)
                                if _snap:
                                    self.repository.update_live_snapshot(video_id, _snap)
                            except Exception:
                                pass
                            _last_live_flush_ts = _now
                        await asyncio.sleep(0.25)
                    # Drain any remaining events after the future completes
                    while not _prog_queue.empty():
                        try:
                            _ev = _prog_queue.get_nowait()
                            _ev.setdefault("video_id", video_id)
                            if _ev.get("type") in (
                                "sub_stage", "shot_done", "shot_error"
                            ):
                                try:
                                    self.repository.update_generation_progress(video_id, _ev)
                                except Exception:
                                    pass
                            elif _ev.get("type") == "thumbnails_ready":
                                # Persist the full thumbnail set so Recent grid
                                # picks it up as soon as the background thread
                                # finishes (which can land before render does).
                                _thumbs = _ev.get("thumbnails") or {}
                                if _thumbs:
                                    try:
                                        self.repository.update_thumbnails(video_id, _thumbs)
                                    except Exception:
                                        pass
                            yield _ev
                        except _queue.Empty:
                            break
                    outputs = await _pipeline_future

                    # Pin the CONCRETE voice actually used by TTS so per-shot /
                    # per-sentence re-narration reproduces the SAME voice
                    # (fixes "regenerated audio uses a different voice"). The
                    # pipeline stamps these once synthesis resolves a real voice
                    # name — including a premium auto-pick or a mid-synth
                    # edge→google fallback. Best-effort; never breaks generation.
                    try:
                        _rv_voice = getattr(pipeline, "_tts_voice_id_resolved", None)
                        _rv_provider = getattr(pipeline, "_tts_provider_resolved", None)
                        if _rv_voice:
                            _vrec_rv = self.repository.get_by_video_id(video_id)
                            _emeta_rv = dict((_vrec_rv.extra_metadata or {}) if _vrec_rv else {})
                            _emeta_rv["resolved_voice"] = {
                                "provider": _rv_provider,
                                "voice_id": _rv_voice,
                                "gender": voice_gender,
                                "language": language,
                            }
                            self.repository.update_metadata(video_id, _emeta_rv)
                    except Exception:
                        logger.warning(
                            "[VideoGenService] failed to persist resolved_voice for %s",
                            video_id, exc_info=True,
                        )

                # Record token usage per stage.
                #
                # Use a FRESH session — the request-scoped `db_session` may have
                # been killed by Postgres' idle-in-transaction timeout while
                # the pipeline was busy with LLM/TTS/render I/O (script + TTS +
                # words + HTML can take many minutes; SQLAlchemy auto-begins a
                # transaction on first read and never commits it, leaving the
                # session idle-in-tx for the entire run). Each token-usage
                # write is a short atomic op that doesn't need request scope.
                if outputs and "token_usage" in outputs:
                    try:
                        from .token_usage_service import TokenUsageService
                        usage = outputs["token_usage"] or {}
                        _cb = outputs.get("cost_breakdown")
                        # Per-stage billing — see the "Per-stage billing" block at
                        # the top of this module for what is (and is not) billed.
                        # LLM tokens count when usage OR the breakdown has them:
                        # the v3 script stage's usage carries no total_tokens and
                        # vision-review tokens only reach the breakdown.
                        has_tokens = (
                            int(usage.get("prompt_tokens", 0) or 0)
                            + int(usage.get("completion_tokens", 0) or 0)
                        ) > 0 or bool(_llm_token_split_from_breakdown(_cb))
                        has_images = usage.get("image_count", 0) > 0 or bool(_image_events_from_breakdown(_cb))
                        has_tts = usage.get("tts_character_count", 0) > 0
                        has_stock = usage.get("stock_count", 0) > 0

                        if has_tokens or has_images or has_tts or has_stock:
                          with _fresh_db_session() as _fresh:
                            from .credit_service import CreditService
                            from .provider_rates import image_cost_usd
                            _billing_credits = CreditService(_fresh)
                            _key_fn, _bill_gen = _stage_charge_key_fn(
                                _fresh, video_id, institute_id, stage_pipeline_name
                            )
                            _bill_video_stage_usage(
                                TokenUsageService(_fresh),
                                usage=usage,
                                cost_breakdown=_cb,
                                usd_to_credits=_billing_credits.usd_to_credits,
                                image_unit_usd=lambda _m, _db=_fresh: image_cost_usd(_m, db=_db),
                                institute_id=institute_id,
                                user_id=user_id,
                                video_id=video_id,
                                stage=stage_pipeline_name,
                                resolved_model=resolved_model,
                                tts_provider=tts_provider,
                                tts_provider_resolved=getattr(pipeline, "_tts_provider_resolved", None),
                                language=language,
                                meter=video_meter(
                                    use_case="lesson_video", video_id=video_id, user_id=user_id,
                                    prompt=prompt, content_type=content_type, quality_tier=quality_tier,
                                    stage=stage_pipeline_name,
                                ),
                                idempotency_key_fn=_key_fn,
                            )
                          # Observability: which leg billed which stage (the
                          # keys above are what actually prevent a re-bill).
                          _rsb = getattr(self.repository, "record_stage_billed", None)
                          if _rsb is not None:
                              from datetime import datetime as _dt_b, timezone as _tz_b
                              _rsb(video_id, stage_pipeline_name, {
                                  "leg_id": getattr(getattr(leg, "handle", None), "leg_id", None),
                                  "at": _dt_b.now(_tz_b.utc).isoformat(),
                                  "gen": _bill_gen,
                              })
                    except Exception as e:
                        logger.warning(f"[VideoGenService] Failed to record token usage: {e}")

                # Persist full token/cost breakdown into video metadata so it's
                # queryable without joining ai_token_usage (used by FE cost display)
                if outputs and "token_usage" in outputs and db_session:
                    try:
                        _usage = outputs["token_usage"] or {}
                        if (
                            int(_usage.get("prompt_tokens", 0) or 0)
                            + int(_usage.get("completion_tokens", 0) or 0)
                        ) > 0 or bool(_llm_token_split_from_breakdown(outputs.get("cost_breakdown"))):
                            from datetime import datetime as _dt
                            # Fresh session — `db_session` has been idle across
                            # the multi-minute stage run and its connection may
                            # be dead (idle-in-tx kill); a stale read here lost
                            # the cost estimate on every long run.
                            with _fresh_db_session() as _est_db:
                                _est_cost = _estimate_video_cost_usd(
                                    _est_db,
                                    _usage.get("model"),
                                    _usage.get("prompt_tokens", 0),
                                    _usage.get("completion_tokens", 0),
                                    _usage.get("image_count", 0),
                                    _usage.get("tts_character_count", 0),
                                )
                            _video_rec = self.repository.get_by_video_id(video_id)
                            _existing_meta = (_video_rec.extra_metadata or {}) if _video_rec else {}
                            _existing_meta["token_usage"] = {
                                "prompt_tokens": _usage.get("prompt_tokens", 0),
                                "completion_tokens": _usage.get("completion_tokens", 0),
                                "total_tokens": int(_usage.get("prompt_tokens", 0) or 0)
                                + int(_usage.get("completion_tokens", 0) or 0),
                                "image_count": _usage.get("image_count", 0),
                                "tts_character_count": _usage.get("tts_character_count", 0),
                                "stock_count": _usage.get("stock_count", 0),
                                "estimated_cost_usd": _est_cost,
                                "model": _usage.get("model"),
                                "recorded_at": _dt.utcnow().isoformat(),
                            }
                            self.repository.update_metadata(video_id, _existing_meta)
                            _cost_str = f"${_est_cost:.4f}" if _est_cost is not None else "unavailable (model not in ai_models)"
                            logger.info(f"[VideoGenService] Saved token_usage to metadata for {video_id}: est. {_cost_str}")
                    except Exception as _me:
                        logger.warning(f"[VideoGenService] Failed to save token_usage to metadata: {_me}")

                if outputs and "run_dir" in outputs:
                    run_dir = outputs["run_dir"]

                # Pillar 1 — per-video cost balance sheet (every stage). The pipeline's
                # tracker resets on every run() (one per stage), so each
                # stage's report is kept in run_dir/cost_breakdown_by_stage.json
                # (a re-run stage replaces its own entry) and the MERGED
                # report is mirrored to a stable S3 path — uploading the
                # latest stage's file alone lost the script stage's events.
                # A stage whose run produced no report keeps the previous
                # entries untouched (never re-files another stage's report).
                if run_dir:
                    try:
                        _by_stage_file = run_dir / "cost_breakdown_by_stage.json"
                        _by_stage: Dict[str, Any] = {}
                        if _by_stage_file.exists():
                            try:
                                _by_stage = json.loads(_by_stage_file.read_text(encoding="utf-8")) or {}
                            except Exception:
                                _by_stage = {}
                        _stage_cb = (outputs or {}).get("cost_breakdown")
                        if isinstance(_stage_cb, dict):
                            _by_stage[stage_pipeline_name] = _stage_cb
                            _by_stage_file.write_text(json.dumps(_by_stage, indent=2), encoding="utf-8")
                        if _by_stage:
                            _merged_cb_file = run_dir / "cost_breakdown_merged.json"
                            _merged_cb_file.write_text(
                                json.dumps(_merge_cost_breakdowns(_by_stage), indent=2), encoding="utf-8"
                            )
                            self.s3_service.upload_file(
                                _merged_cb_file,
                                s3_key=f"ai-videos/{video_id}/cost_breakdown/cost_breakdown.json",
                                content_type="application/json",
                            )
                            logger.info(
                                f"[VideoGenService] Uploaded merged cost_breakdown.json for {video_id} "
                                f"({', '.join(_by_stage)})"
                            )
                    except Exception as _cb_err:
                        logger.warning(f"[VideoGenService] Failed to upload cost_breakdown.json: {_cb_err}")

                # ── Merge host_outputs.json (written by AvatarBatch) into extra_metadata.host ──
                # AvatarBatch persists per-shot artifacts to run_dir/host_outputs.json
                # during the HTML stage. We pull it forward into extra_metadata.host.outputs
                # so analysis / debugging / cost reconciliation can read the full picture
                # without inspecting the run dir. We ALSO deduct credits for the avatar
                # video seconds here (fal.ai per-second), which the stage loop does not
                # see. The Seedream identity images are NOT billed here: the stage loop
                # bills them from their host_identity cost events, one per real call.
                if stage_pipeline_name == "html" and run_dir:
                    _host_out_file = run_dir / "host_outputs.json"
                    if _host_out_file.exists():
                        try:
                            import json as _json_h
                            _host_outputs = _json_h.loads(_host_out_file.read_text(encoding="utf-8"))
                            _vrec_h = self.repository.get_by_video_id(video_id)
                            _emeta_h = (_vrec_h.extra_metadata or {}) if _vrec_h else {}
                            _host_block = _emeta_h.get("host") or {}
                            _host_block["outputs"] = _host_outputs
                            _emeta_h["host"] = _host_block
                            self.repository.update_metadata(video_id, _emeta_h)
                            logger.info(
                                f"[VideoGenService] Merged host_outputs.json into extra_metadata.host.outputs "
                                f"({_host_outputs.get('host_shot_count', 0)} shots, "
                                f"{_host_outputs.get('total_host_seconds', 0):.1f}s)"
                            )

                            # ── Deduct credits for avatar-host work ──
                            # RequestType.AVATAR_VIDEO — the completed shots' seconds
                            # at the avatar model's video_price_per_second. (Until
                            # 2026-10-13 this also charged one Seedream image per
                            # completed shot — wrong for argil/veed, which make none,
                            # and for custom avatars, which make one per RUN. Those
                            # images are now billed from their cost events.)
                            #
                            # Resume-safe: each shot artifact gets a `deducted_at`
                            # timestamp once charged. On resume, we skip artifacts
                            # that already carry one — otherwise a partial AvatarBatch
                            # run that resumes would double-bill the user for the
                            # shots that completed in the prior attempt.
                            if institute_id and db_session:
                                try:
                                    from datetime import datetime as _dt_dh
                                    _all_artifacts = list(_host_outputs.get("shot_artifacts") or [])
                                    _completed_shots = [
                                        a for a in _all_artifacts
                                        if a.get("status") == "completed"
                                    ]
                                    _undeducted_completed = [
                                        a for a in _completed_shots
                                        if not a.get("deducted_at")
                                    ]
                                    _undeducted_seconds = int(round(sum(
                                        float(a.get("duration_s_actual") or a.get("duration_s") or 0)
                                        for a in _undeducted_completed
                                    )))
                                    _host_model = (
                                        (_host_block.get("avatar") or {}).get("avatar_model")
                                        or "fal-ai/kling-video/ai-avatar/v2/standard"
                                    )

                                    if not _undeducted_completed and not _undeducted_seconds:
                                        logger.info(
                                            "[VideoGenService] Host credits already deducted "
                                            "in a prior run — skipping (resume idempotency)."
                                        )
                                    else:
                                      # Fresh session — `db_session` has been idle
                                      # across the html render and its connection
                                      # is often dead by now (idle-in-tx kill),
                                      # which silently dropped host-credit
                                      # deductions on long runs. TokenUsageService
                                      # doesn't commit; the context-manager exit
                                      # commit persists these writes.
                                      with _fresh_db_session() as _host_db:
                                        _ts = TokenUsageService(_host_db)
                                        _now_iso = _dt_dh.utcnow().isoformat()
                                        # Stamp the shots so a resume does not bill
                                        # their seconds again.
                                        for _shot_art in _undeducted_completed:
                                            _shot_art["deducted_at"] = _now_iso
                                        # Avatar video seconds — single charge per dedup-run
                                        if _undeducted_seconds > 0:
                                            import hashlib as _hl
                                            _host_key = _video_charge_key(
                                                _host_db, video_id, institute_id,
                                                "host:" + _hl.sha1(",".join(sorted(
                                                    str(a.get("shot_index")) for a in _undeducted_completed
                                                )).encode("utf-8")).hexdigest()[:16],
                                            )
                                            _ts.record_usage_and_deduct_credits(
                                                api_provider=ApiProvider.OPENAI,
                                                prompt_tokens=0,
                                                completion_tokens=0,
                                                total_tokens=0,
                                                request_type=RequestType.AVATAR_VIDEO,
                                                institute_id=institute_id,
                                                user_id=user_id,
                                                model=_host_model,
                                                metadata={
                                                    "video_id": video_id,
                                                    "stage": "html",
                                                    "host_shot_count": len(_undeducted_completed),
                                                    "quality": (_host_block.get("avatar") or {}).get("quality"),
                                                },
                                                seconds=_undeducted_seconds,
                                                batch_id=video_id,
                                                idempotency_key=_host_key,
                                                allow_negative=True,
                                                **_supported_meter(
                                                    _ts.record_usage_and_deduct_credits,
                                                    video_meter(
                                                        use_case="avatar_video", video_id=video_id,
                                                        user_id=user_id, prompt=prompt,
                                                        content_type=content_type,
                                                        quality_tier=quality_tier, stage="html",
                                                    ),
                                                ),
                                            )

                                        # Persist deducted_at stamps back into extra_metadata.
                                        # _host_block["outputs"] points at the same dict we
                                        # just mutated, so re-saving is sufficient.
                                        _host_block["outputs"]["shot_artifacts"] = _all_artifacts
                                        _emeta_h["host"] = _host_block
                                        self.repository.update_metadata(video_id, _emeta_h)

                                        logger.info(
                                            f"[VideoGenService] Deducted host credits: "
                                            f"{_undeducted_seconds}s of {_host_model} "
                                            f"({len(_undeducted_completed)} shots)"
                                        )
                                except Exception as _hd_err:
                                    logger.warning(
                                        f"[VideoGenService] Failed to deduct host credits: {_hd_err}"
                                    )
                        except Exception as _hm_err:
                            logger.warning(f"[VideoGenService] Failed to merge host_outputs.json: {_hm_err}")

                # ── Lesson mode: teacher outputs → metadata + one credit charge ──
                # lesson_outputs.json is written by the pipeline's timeline
                # step. The teacher is charged once per video (idempotency key,
                # renewed after a full refund) for the vendor's billed video
                # seconds — see _lesson_teacher_charge for the price order and
                # _charge_lesson_teacher for the checked deduct.
                if stage_pipeline_name == "html" and run_dir and (run_dir / "lesson_outputs.json").exists():
                    try:
                        import json as _json_l
                        _lesson_out = _json_l.loads((run_dir / "lesson_outputs.json").read_text(encoding="utf-8"))
                        _vrec_lo = self.repository.get_by_video_id(video_id)
                        _emeta_lo = (_vrec_lo.extra_metadata or {}) if _vrec_lo else {}
                        _lesson_block = _emeta_lo.get("lesson") or {}
                        _prev_out = _lesson_block.get("outputs") or {}
                        _prev_billed = _prev_out.get("billed_at")
                        _teacher_out = _lesson_out.get("teacher") or {}
                        if _prev_billed:
                            _lesson_out["billed_at"] = _prev_billed
                            for _k in ("billed_credits", "billed_vendor_usd", "billed_price_source"):
                                if _k in _prev_out:
                                    _lesson_out[_k] = _prev_out.get(_k)
                        elif institute_id and (_lesson_out.get("clips_ok") or 0) > 0:
                            from datetime import datetime as _dt_lo
                            from .credit_service import CreditService as _CS_lo
                            with _fresh_db_session() as _lesson_db:
                                _cs_lo = _CS_lo(_lesson_db)
                                _credits, _teacher_usd, _price_src = _lesson_teacher_charge(
                                    _teacher_out,
                                    video_price_per_second=_cs_lo._get_model_video_per_second(_LESSON_TEACHER_MODEL_ID),
                                    usd_to_credits=_cs_lo.usd_to_credits,
                                )
                                _charged = (
                                    _charge_lesson_teacher(
                                        _lesson_db,
                                        teacher_out=_teacher_out,
                                        credits=_credits,
                                        teacher_usd=_teacher_usd,
                                        price_source=_price_src,
                                        institute_id=institute_id,
                                        user_id=user_id,
                                        video_id=video_id,
                                        credit_service=_cs_lo,
                                        meter=video_meter(
                                            use_case="avatar_video", video_id=video_id, user_id=user_id,
                                            prompt=prompt, content_type=content_type,
                                            quality_tier=quality_tier, stage="html",
                                        ),
                                    )
                                    if _credits > 0 else 0
                                )
                            # Stamp billed_* only for a charge that landed — an
                            # idempotent no-op or a failed deduct must not read
                            # as billed.
                            if _charged > 0:
                                _lesson_billing_record(
                                    _lesson_out,
                                    credits=_charged,
                                    vendor_usd=_teacher_usd,
                                    price_source=_price_src,
                                    billed_at=_dt_lo.utcnow().isoformat(),
                                )
                                logger.info(
                                    f"[VideoGenService] Lesson teacher charged {_charged} credits "
                                    f"({_teacher_out.get('video_seconds')}s video, {_price_src}) for {video_id}"
                                )
                        _lesson_block["outputs"] = _lesson_out
                        _emeta_lo["lesson"] = _lesson_block
                        self.repository.update_metadata(video_id, _emeta_lo)
                        if _lesson_out.get("error"):
                            # Surface it: the lesson shipped without its teacher.
                            try:
                                self.repository.record_warning(
                                    video_id,
                                    f"Lesson teacher unavailable — the video shows the board only "
                                    f"({str(_lesson_out['error'])[:200]})",
                                )
                            except Exception:
                                pass
                    except Exception as _lo_err:
                        logger.warning(f"[VideoGenService] Lesson outputs merge/charge failed: {_lo_err}")

                # ── Merge visual_preferences_realized.json into extra_metadata ──
                # _run_director writes this file alongside the director plan
                # whenever the user expressed any non-default visual preference.
                # We copy it into extra_metadata.intent_outcomes.visual_preferences_realized
                # so history views, dashboards, and offline analysis can read
                # declared-vs-realized stats without poking at the run_dir.
                # No-op when the file is absent (no preferences set / older runs).
                if stage_pipeline_name == "html" and run_dir:
                    _vp_realized_file = run_dir / "visual_preferences_realized.json"
                    if _vp_realized_file.exists():
                        try:
                            import json as _json_vp
                            _vp_realized = _json_vp.loads(
                                _vp_realized_file.read_text(encoding="utf-8")
                            )
                            _vrec_vp = self.repository.get_by_video_id(video_id)
                            _emeta_vp = (_vrec_vp.extra_metadata or {}) if _vrec_vp else {}
                            _io = _emeta_vp.get("intent_outcomes") or {}
                            _io["visual_preferences_realized"] = _vp_realized
                            _emeta_vp["intent_outcomes"] = _io
                            self.repository.update_metadata(video_id, _emeta_vp)
                            _fc = _vp_realized.get("family_counts") or {}
                            _ov = _vp_realized.get("override_count", 0)
                            _mm = len(_vp_realized.get("mismatches") or [])
                            logger.info(
                                f"[VideoGenService] Merged visual_preferences_realized.json: "
                                f"realized={_fc} overrides={_ov} mismatches={_mm}"
                            )
                        except Exception as _vp_merge_err:
                            logger.warning(
                                f"[VideoGenService] Failed to merge "
                                f"visual_preferences_realized.json: {_vp_merge_err}"
                            )

                # ── Validate required outputs for this stage ──
                # If the pipeline returned but critical output files are missing,
                # treat it as a stage failure instead of silently continuing.
                _required_outputs = {
                    "script": ["script_path"],
                    "tts": ["audio_path"],
                    "words": ["words_json"],
                    "html": ["timeline_json"],
                    "avatar": ["avatar_video_path"],
                    "render": ["video_path"],
                }
                _expected = list(_required_outputs.get(stage_pipeline_name, []))
                # No-audio content types (SLIDES) intentionally skip TTS — the
                # tts stage runs as a no-op (do_tts=False) and produces no
                # audio_path, so its absence is NOT a silent failure. Without
                # this, every SLIDES slide died at the tts stage with
                # "missing required outputs: ['audio_path']". Keep in sync with
                # NO_AUDIO_TYPES in automation_pipeline.py.
                _NO_AUDIO_CONTENT_TYPES = {"SLIDES"}
                if stage_pipeline_name == "tts" and content_type in _NO_AUDIO_CONTENT_TYPES:
                    _expected = [k for k in _expected if k != "audio_path"]
                # Same shape for the avatar stage. The pipeline only produces
                # avatar_video_path when an avatar was actually requested; with
                # no avatar host it returns
                # {"skipped": True, "reason": "host not avatar-enabled"} and
                # leaves the key None. That documented skip was then read as a
                # silent failure, so a till-render run WITHOUT an avatar — the
                # common case — died here after HTML had already succeeded and
                # the whole video was lost. A skip is not a missing output.
                if stage_pipeline_name == "avatar" and not generate_avatar:
                    _expected = [k for k in _expected if k != "avatar_video_path"]
                _missing = [k for k in _expected if not outputs or not outputs.get(k)]
                if _missing and not pipeline_error:
                    pipeline_error = (
                        f"Stage '{stage_pipeline_name}' finished but missing required outputs: "
                        f"{_missing}. The stage may have failed silently."
                    )
                    logger.error(f"[VideoGenService] {pipeline_error}")

            except Exception as e:
                # Detect PipelineCancelled by class name — the pipeline class
                # lives outside `app.*` so we can't catch the type directly
                # (see `_is_pipeline_cancelled` near the top of this module).
                if _is_pipeline_cancelled(e) and cancellation_registry.reason(video_id) == "fenced":
                    yield _fenced_exit()
                    return
                if _is_pipeline_cancelled(e):
                    logger.info(
                        f"[VideoGenService] Pipeline cancelled by user during stage {stage_pipeline_name}"
                    )
                    # Re-assert CANCELLED to win any race with a concurrent
                    # post-stage upload that may have written IN_PROGRESS.
                    try:
                        self.repository.update_stage(
                            video_id, stage="CANCELLED", status="CANCELLED"
                        )
                    except Exception:
                        pass
                    yield {
                        "type": "cancelled",
                        "video_id": video_id,
                        "message": "Stopped by user",
                    }
                    cancellation_registry.clear(video_id)
                    _agg_end = _get_run_state_aggregator()
                    if _agg_end is not None:
                        _agg_end.end_run(video_id, "FAILED")
                        try:
                            _final_snap = _agg_end.serialize_for_db(video_id)
                            if _final_snap:
                                self.repository.update_live_snapshot(video_id, _final_snap)
                        except Exception:
                            pass
                    return
                import traceback
                pipeline_error = str(e)
                error_traceback = traceback.format_exc()
                logger.error(f"[VideoGenService] Stage {stage_pipeline_name} failed: {pipeline_error}")
                logger.error(f"[VideoGenService] Traceback: {error_traceback}")
                # Loop continues to try to save partial files

            # For the avatar stage: _generate_avatar_runpod() submitted the RunPod job and
            # wrote its ID to runpod_job_id.txt, then returned immediately (no blocking wait).
            # Poll RunPod here using asyncio.sleep() so the event loop stays free between polls.
            if stage_pipeline_name == "avatar":
                runpod_job_id_file = run_dir / "runpod_job_id.txt"
                if runpod_job_id_file.exists():
                    runpod_job_id = runpod_job_id_file.read_text().strip()
                    if runpod_job_id:
                        yield {
                            "type": "progress",
                            "stage": "AVATAR",
                            "message": "Avatar job submitted — waiting for RunPod inference...",
                            "video_id": video_id,
                            "percentage": 20,
                        }
                        import requests as _requests
                        from .avatar_service import get_avatar_provider
                        from ..config import get_settings as _get_settings
                        _settings = _get_settings()
                        avatar_provider = get_avatar_provider(
                            provider="runpod",
                            api_key=_settings.runpod_api_key,
                            endpoint_id=_settings.runpod_endpoint_id,
                        )
                        deadline = time.time() + 3600  # 60-min timeout (cold start + chunked inference)
                        avatar_succeeded = False
                        while time.time() < deadline:
                            await asyncio.sleep(10)
                            rp = avatar_provider.check_status(runpod_job_id)
                            rp_status = rp["status"]
                            pct = rp.get("progress", 0)
                            stage_msg = rp.get("stage", "")
                            yield {
                                "type": "progress",
                                "stage": "AVATAR",
                                "message": f"Avatar: {stage_msg or f'{pct}% complete'}",
                                "video_id": video_id,
                                "percentage": 20 + int(pct * 0.65),  # 20-85 range
                            }
                            if rp_status == "COMPLETED":
                                video_url = rp.get("video_url", "")
                                logger.info(f"[VideoGenService] Avatar job complete: {video_url}")
                                resp = _requests.get(video_url, timeout=120)
                                resp.raise_for_status()
                                avatar_path = run_dir / "avatar_video.mp4"
                                avatar_path.write_bytes(resp.content)
                                logger.info(f"[VideoGenService] Avatar video downloaded: {avatar_path}")
                                avatar_succeeded = True
                                break
                            elif rp_status == "FAILED":
                                logger.error(f"[VideoGenService] RunPod avatar job failed: {rp.get('error')}")
                                break
                        if not avatar_succeeded:
                            logger.error(f"[VideoGenService] Avatar polling timed out/failed for RunPod job {runpod_job_id}")

            # Recalculate percentage for file processing (slightly higher)
            percentage = 5 + int((stage_idx - start_stage_idx + 1) * percentage_per_stage)
            
            uploaded_files = {}
            stage_has_files = False
            files_to_check = file_map.get(config["name"], [])
            
            for output_key, file_key, file_name in files_to_check:
                # Try to get from outputs first, then check directory
                file_path = None
                if output_key and outputs and output_key in outputs:
                    try:
                        file_path = Path(str(outputs[output_key]))
                    except Exception as e:
                        logger.warning(f"[VideoGenService] Could not parse output path for {output_key}: {e}")
                
                # If not in outputs, check run directory
                if not file_path or not file_path.exists():
                    potential_path = run_dir / file_name
                    if potential_path.exists():
                        file_path = potential_path
                    else:
                        # Try case-insensitive search
                        try:
                            for f in run_dir.glob("*"):
                                if f.name.lower() == file_name.lower():
                                    file_path = f
                                    logger.info(f"[VideoGenService] Found {file_name} via case-insensitive search: {file_path}")
                                    break
                        except Exception as e:
                            logger.warning(f"[VideoGenService] Could not search for {file_name}: {e}")
                
                # Special handling: if generated_images directory doesn't exist, log and skip
                if not file_path and file_key == "generated_images":
                    logger.info(f"[VideoGenService] generated_images directory not found in {run_dir}. This is normal if no images were generated. Skipping...")
                    continue
                
                if file_path:
                    # Convert to Path object and check existence safely
                    try:
                        file_path_obj = Path(str(file_path))
                        if file_path_obj.exists():
                            stage_has_files = True
                            try:
                                # Check if it's a directory (for generated_images)
                                if file_path_obj.is_dir():
                                    # Check if directory has any files before uploading
                                    files_in_dir = list(file_path_obj.rglob("*"))
                                    file_count = sum(1 for f in files_in_dir if f.is_file())
                                    
                                    if file_count == 0:
                                        logger.warning(f"[VideoGenService] Directory {file_key} exists but is empty: {file_path_obj}")
                                        # Skip empty directory but mark stage as having files (directory exists)
                                        continue
                                    
                                    logger.info(f"[VideoGenService] Uploading directory {file_key} from {file_path_obj} ({file_count} files)...")
                                    s3_urls = self.s3_service.upload_video_directory(
                                        directory_path=file_path_obj,
                                        video_id=video_id,
                                        stage=file_key
                                    )
                                    
                                    if not s3_urls:
                                        logger.warning(f"[VideoGenService] No files were uploaded from {file_key} directory")
                                        continue
                                    
                                    # Build mapping of local paths to S3 URLs for image replacement
                                    if file_key == "generated_images":
                                        logger.info(f"[VideoGenService] Building image path mapping from {len(s3_urls)} uploaded images...")
                                        # Build a mapping by relative path for more accurate matching
                                        s3_url_by_relative_path = {}
                                        s3_url_by_filename = {}
                                        
                                        for s3_url in s3_urls:
                                            # Extract relative path from S3 URL
                                            # Format: https://bucket.s3.amazonaws.com/ai-videos/{video_id}/generated_images/{relative_path}
                                            parts = s3_url.split(f"/generated_images/")
                                            if len(parts) == 2:
                                                relative_path = parts[1]
                                                s3_url_by_relative_path[relative_path] = s3_url
                                                # Also index by filename for fallback matching
                                                filename = relative_path.split('/')[-1]
                                                s3_url_by_filename[filename] = s3_url
                                        
                                        logger.info(f"[VideoGenService] Indexed {len(s3_url_by_relative_path)} images by path, {len(s3_url_by_filename)} by filename")
                                        
                                        for local_file in file_path_obj.rglob("*"):
                                            if local_file.is_file():
                                                relative_path = local_file.relative_to(file_path_obj).as_posix()
                                                filename = local_file.name
                                                
                                                # Try to find S3 URL by relative path first (most accurate)
                                                s3_url = s3_url_by_relative_path.get(relative_path)
                                                if not s3_url:
                                                    # Fallback: match by filename
                                                    s3_url = s3_url_by_filename.get(filename)
                                                
                                                if s3_url:
                                                    # Store multiple path formats for flexible matching
                                                    local_abs_path = str(local_file.absolute()).replace('\\', '/')
                                                    local_file_path = f"file://{local_abs_path}"
                                                    local_file_path_alt = f"file:///{local_abs_path}"  # Alternative format (Windows)
                                                    local_file_path_alt2 = f"file://{local_abs_path.replace('C:', '')}"  # Another Windows variant
                                                    
                                                    # Store all possible path formats
                                                    image_path_mapping[local_file_path] = s3_url
                                                    image_path_mapping[local_file_path_alt] = s3_url
                                                    image_path_mapping[local_file_path_alt2] = s3_url
                                                    image_path_mapping[local_file.name] = s3_url  # Just filename
                                                    image_path_mapping[relative_path] = s3_url  # Relative path
                                                    image_path_mapping[str(local_file.absolute())] = s3_url  # Absolute path without file://
                                                    
                                                    logger.info(f"[VideoGenService] ✅ Mapped image: {filename} -> {s3_url}")
                                                    logger.debug(f"[VideoGenService]   - Local paths mapped: {local_file_path}, {local_file_path_alt}, {relative_path}")
                                                else:
                                                    logger.warning(f"[VideoGenService] ⚠️  Could not find S3 URL for {local_file.name} (relative: {relative_path})")
                                        
                                        logger.info(f"[VideoGenService] ✅ Built image mapping with {len(image_path_mapping)} entries (ready for URL replacement)")
                                    
                                    # Store the base URL (directory path) and list of uploaded files
                                    # Use the first file's URL to construct base directory URL
                                    if s3_urls:
                                        # Extract base URL from first file URL
                                        first_url = s3_urls[0]
                                        # Remove filename to get directory URL
                                        base_url = "/".join(first_url.split("/")[:-1]) + "/"
                                    else:
                                        # Fallback if no files uploaded
                                        from ..config import get_settings
                                        settings = get_settings()
                                        bucket = settings.aws_bucket_name or settings.aws_s3_public_bucket
                                        base_url = f"https://{bucket}.s3.amazonaws.com/ai-videos/{video_id}/{file_key}/"

                                    # Phase B: for per_shot_tts, store an ordered shot→mp3 map in s3_urls
                                    # instead of just the directory URL. The editor reads this to render
                                    # per-shot audio clips on the timeline (aligned to shot boundaries)
                                    # rather than one continuous waveform of the concat master. Other
                                    # directory uploads (generated_images, etc.) keep the directory-URL
                                    # convention. Per-shot mp3 filenames are `shot_NNN.mp3` (3-digit
                                    # zero-padded) — see _synthesize_voice_per_shot in automation_pipeline.
                                    s3_url_value: Any = base_url
                                    if file_key == "per_shot_tts":
                                        _shot_audio_map: Dict[str, str] = {}
                                        for _u in s3_urls:
                                            _m = re.search(r'/(shot_\d{3})\.mp3(?:\?|$)', _u)
                                            if _m:
                                                _shot_audio_map[_m.group(1)] = _u
                                        if _shot_audio_map:
                                            # Sort by shot id for stable JSON ordering in the DB column.
                                            s3_url_value = dict(sorted(_shot_audio_map.items()))
                                            logger.info(
                                                f"[VideoGenService] per_shot_tts: built shot→mp3 map "
                                                f"({len(s3_url_value)} shots) for s3_urls"
                                            )
                                        else:
                                            logger.warning(
                                                f"[VideoGenService] per_shot_tts: no shot_NNN.mp3 files matched "
                                                f"in {len(s3_urls)} uploaded URLs — falling back to directory URL"
                                            )

                                    file_id = f"{video_id}-{file_key}"
                                    uploaded_files[file_key] = {
                                        "file_id": file_id,
                                        "s3_url": s3_url_value,  # Directory URL OR per_shot_tts shot→mp3 dict
                                        "files": s3_urls  # List of individual file URLs
                                    }
                                    logger.info(f"[VideoGenService] Uploaded {len(s3_urls)} files in {file_key} directory")
                                else:
                                    # Regular file upload
                                    # Special handling for time_based_frame.json - update image URLs before upload
                                    if file_key == "timeline" and file_name == "time_based_frame.json":
                                        if image_path_mapping:
                                            logger.info(f"[VideoGenService] Updating image URLs in {file_name} before upload (found {len(image_path_mapping)} image mappings)...")
                                            try:
                                                # Read the timeline JSON
                                                timeline_content = file_path_obj.read_text(encoding='utf-8')
                                                timeline_data = json.loads(timeline_content)
                                                
                                                # Handle both new format (dict with meta + entries) and old format (flat list)
                                                if isinstance(timeline_data, dict) and "entries" in timeline_data:
                                                    # New format: { "meta": {...}, "entries": [...] }
                                                    entries_list = timeline_data["entries"]
                                                    is_new_format = True
                                                    logger.info(f"[VideoGenService] Detected new timeline format with meta + entries")
                                                else:
                                                    # Old format: flat list of entries
                                                    entries_list = timeline_data
                                                    is_new_format = False
                                                    logger.info(f"[VideoGenService] Detected old timeline format (flat list)")
                                                
                                                # Update image URLs in HTML
                                                updated_count = 0
                                                total_entries = len(entries_list)
                                                
                                                for entry_idx, entry in enumerate(entries_list):
                                                    html = entry.get("html", "")
                                                    if html:
                                                        original_html = html
                                                        entry_updated = False
                                                        
                                                        # Strategy 1: Direct string replacement for all mapped paths
                                                        for local_path, s3_url in image_path_mapping.items():
                                                            # Try direct replacement (handles file:// URLs and filenames)
                                                            if local_path in html:
                                                                html = html.replace(local_path, s3_url)
                                                                updated_count += 1
                                                                entry_updated = True
                                                                logger.debug(f"[VideoGenService] Replaced {local_path} with {s3_url} in entry {entry_idx}")
                                                        
                                                        # Strategy 2: Regex replacement for src attributes (more robust)
                                                        # Find all img tags with src attributes
                                                        img_pattern = r'<img[^>]+src=["\']([^"\']+)["\'][^>]*>'
                                                        img_matches = list(re.finditer(img_pattern, html))
                                                        
                                                        for match in img_matches:
                                                            src_value = match.group(1)
                                                            matched_s3_url = None
                                                            
                                                            # Try to match against all path formats in mapping
                                                            for local_path, s3_url in image_path_mapping.items():
                                                                # Normalize paths for comparison
                                                                src_normalized = src_value.replace('\\', '/').lower()
                                                                local_normalized = local_path.replace('\\', '/').lower()
                                                                
                                                                # Check various matching strategies
                                                                if (local_normalized in src_normalized or 
                                                                    src_normalized.endswith(local_normalized.split('/')[-1]) or  # Filename match
                                                                    (local_path.startswith("file://") and src_normalized.endswith(local_normalized.replace("file://", "").split('/')[-1]))):
                                                                    matched_s3_url = s3_url
                                                                    break
                                                            
                                                            if matched_s3_url:
                                                                # Replace the src attribute value
                                                                old_src_attr = f'src="{src_value}"'
                                                                new_src_attr = f'src="{matched_s3_url}"'
                                                                html = html.replace(old_src_attr, new_src_attr)
                                                                updated_count += 1
                                                                entry_updated = True
                                                                logger.debug(f"[VideoGenService] Replaced src {src_value} with {matched_s3_url} in entry {entry_idx}")
                                                        
                                                        # Strategy 3: Regex replace file:// paths in src attributes (fallback)
                                                        file_url_pattern = r'src=["\']?(file://[^"\'\s]+)["\']?'
                                                        def replace_file_url(m):
                                                            src_path = m.group(1)
                                                            src_normalized = src_path.replace('\\', '/').lower()
                                                            # Try to find matching S3 URL by filename or path
                                                            for local_path, s3_url in image_path_mapping.items():
                                                                local_normalized = local_path.replace('\\', '/').lower()
                                                                # Match by filename or full path
                                                                if (local_normalized in src_normalized or 
                                                                    src_normalized.endswith(local_normalized.split('/')[-1])):
                                                                    return f'src="{s3_url}"'
                                                            return m.group(0)  # No match, keep original
                                                        
                                                        new_html = re.sub(file_url_pattern, replace_file_url, html)
                                                        if new_html != html:
                                                            html = new_html
                                                            updated_count += 1
                                                            entry_updated = True
                                                        
                                                        if entry_updated:
                                                            entry["html"] = html
                                                            logger.info(f"[VideoGenService] Updated HTML in timeline entry {entry_idx}")
                                                
                                                # Write updated timeline back to file
                                                if updated_count > 0:
                                                    file_path_obj.write_text(json.dumps(timeline_data, indent=2), encoding='utf-8')
                                                    logger.info(f"[VideoGenService] ✅ Updated {updated_count} image references in {file_name} across {total_entries} entries")
                                                else:
                                                    # Detect any unresolved local refs across ALL entries.
                                                    # An unresolved ref is an <img src> that is NOT a data: URI,
                                                    # NOT http(s)://, and didn't get matched by the swap above.
                                                    # That would indicate a bare-filename or file:// path the
                                                    # post-upload swap should have rewritten but didn't —
                                                    # warn so the gap shows up.
                                                    unresolved: list[str] = []
                                                    for entry in entries_list:
                                                        html_e = entry.get("html", "")
                                                        for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', html_e):
                                                            src = m.group(1)
                                                            if src.startswith(("data:", "http://", "https://")):
                                                                continue
                                                            unresolved.append(src)
                                                    if unresolved:
                                                        logger.warning(
                                                            f"[VideoGenService] ⚠️  {len(unresolved)} unresolved local image ref(s) in {file_name}: "
                                                            f"{unresolved[:3]}. Check image_path_mapping coverage."
                                                        )
                                                        if image_path_mapping:
                                                            sample_keys = list(image_path_mapping.keys())[:3]
                                                            logger.debug(f"[VideoGenService] Sample image_path_mapping keys: {sample_keys}")
                                                    else:
                                                        logger.info(f"[VideoGenService] ℹ️  All <img> sources in {file_name} are base64-embedded or already on S3 — no swap needed")
                                            except Exception as e:
                                                logger.warning(f"[VideoGenService] Failed to update image URLs in {file_name}: {e}. Uploading original file.", exc_info=True)
                                        else:
                                            logger.info(f"[VideoGenService] No image mappings found, skipping URL update in {file_name}")
                                    
                                    # Handle files that should be uploaded but not stored in main s3_urls.
                                    # Internal files use the current pipeline stage as their S3 subdir
                                    # (e.g. script_plan.json → ai-videos/<vid>/script/) so the resume-time
                                    # download path can find them by convention.
                                    # Backwards compat: narration_raw.json keeps its hardcoded "audio"
                                    # subdir because the existing download path at line 631 looks there.
                                    if file_key is None:
                                        _internal_stage = {
                                            "narration_raw.json": "audio",
                                            "narration.words.csv": "words",
                                        }.get(file_name, stage_pipeline_name)
                                        logger.info(f"[VideoGenService] Uploading internal file {file_name} to S3 stage='{_internal_stage}' (not storing in DB)...")
                                        s3_url = self.s3_service.upload_video_file(
                                            file_path=file_path_obj,
                                            video_id=video_id,
                                            stage=_internal_stage
                                        )
                                        logger.info(f"[VideoGenService] Uploaded internal file {file_name}: {s3_url} (not stored in DB)")
                                        continue  # Skip DB update for internal files
                                    
                                    logger.info(f"[VideoGenService] Uploading {file_key} from {file_path_obj}...")
                                    s3_url = self.s3_service.upload_video_file(
                                        file_path=file_path_obj,
                                        video_id=video_id,
                                        stage=file_key
                                    )
                                    file_id = f"{video_id}-{file_key}"
                                    uploaded_files[file_key] = {"file_id": file_id, "s3_url": s3_url}
                                    logger.info(f"[VideoGenService] Uploaded {file_key}: {s3_url}")
                                
                                # Update DB with this file/directory IMMEDIATELY (with retry for connection errors)
                                # Skip if file_key is None (internal files)
                                if file_key is None:
                                    continue
                                    
                                max_db_retries = 3
                                db_updated = False
                                for retry in range(max_db_retries):
                                    try:
                                        updated_record = self.repository.update_files(
                                            video_id=video_id,
                                            file_ids={file_key: file_id},
                                            s3_urls={file_key: uploaded_files[file_key]["s3_url"]}
                                        )
                                        db_updated = True
                                        break
                                    except Exception as db_error:
                                        _db_err_str = str(db_error).lower()
                                        _db_err_type = type(db_error).__name__
                                        _is_conn_err = (
                                            "server closed the connection" in _db_err_str
                                            or "ssl connection has been closed" in _db_err_str
                                            or "connection was reset" in _db_err_str
                                            or "broken pipe" in _db_err_str
                                            or "OperationalError" in _db_err_type
                                            or "PendingRollbackError" in _db_err_type
                                            or "InterfaceError" in _db_err_type
                                        )
                                        if _is_conn_err:
                                            if retry < max_db_retries - 1:
                                                logger.warning(f"[VideoGenService] Database connection error (attempt {retry + 1}/{max_db_retries}): {db_error}. Retrying...")
                                                time.sleep(1)  # Wait 1 second before retry
                                                continue
                                            else:
                                                logger.error(f"[VideoGenService] Database connection failed after {max_db_retries} attempts: {db_error}")
                                                # Continue processing even if DB update fails
                                                break
                                        else:
                                            # Non-connection error, don't retry
                                            logger.error(f"[VideoGenService] Database update failed: {db_error}")
                                            raise
                                
                                if db_updated:
                                    logger.info(f"[VideoGenService] DB updated for {file_key}. File IDs in DB: {list(updated_record.file_ids.keys()) if updated_record else 'N/A'}, S3 URLs: {list(updated_record.s3_urls.keys()) if updated_record else 'N/A'}")
                                else:
                                    logger.warning(f"[VideoGenService] DB update skipped for {file_key} due to connection issues, but file was uploaded to S3")
                                if updated_record:
                                    # Read fresh from DB to verify update
                                    fresh_record = self.repository.get_by_video_id(video_id)
                                    if fresh_record:
                                        logger.info(f"[VideoGenService] DB updated for {file_key}. File IDs in DB: {list(fresh_record.file_ids.keys()) if fresh_record.file_ids else []}, S3 URLs: {list(fresh_record.s3_urls.keys()) if fresh_record.s3_urls else []}")
                                    else:
                                        logger.warning(f"[VideoGenService] Could not verify DB update for {file_key}")
                                else:
                                    logger.warning(f"[VideoGenService] DB update returned None for {file_key}")
                            except Exception as e:
                                file_identifier = file_key if file_key else file_name
                                logger.error(f"[VideoGenService] Failed to upload {file_identifier}: {e}", exc_info=True)
                    except Exception as e:
                        logger.warning(f"[VideoGenService] Could not process file path {file_path}: {e}")
            
            if stage_has_files:
                # After HTML stage: upload shot checkpoints to S3 so a retry can resume
                # from the last saved shot without re-running Director or completed shots.
                if stage_pipeline_name == "html":
                    try:
                        _ckpt_files = []
                        _dir_plan = run_dir / "director_plan.json"
                        if _dir_plan.exists():
                            _ckpt_files.append((_dir_plan, f"ai-videos/{video_id}/checkpoints/director_plan.json"))
                        # v3 shot plan — ShotPlanner+NarrationWriter output.
                        # Persisted alongside director_plan.json so a v3 run can
                        # resume from the last saved shot without re-planning.
                        # The editor's `/shot/regenerate` endpoint also reads
                        # this to keep shot_plan + timeline in sync.
                        _shot_plan = run_dir / "shot_plan.json"
                        if _shot_plan.exists():
                            _ckpt_files.append((_shot_plan, f"ai-videos/{video_id}/checkpoints/shot_plan.json"))
                        _shot_cache_dir = run_dir / "shot_cache"
                        if _shot_cache_dir.exists():
                            for _sc_file in sorted(_shot_cache_dir.glob("shot_*.json")):
                                _ckpt_files.append((_sc_file, f"ai-videos/{video_id}/checkpoints/shot_cache/{_sc_file.name}"))
                        _sg_file = run_dir / "style_guide.json"
                        if _sg_file.exists():
                            _ckpt_files.append((_sg_file, f"ai-videos/{video_id}/checkpoints/style_guide.json"))
                        for _f, _key in _ckpt_files:
                            self.s3_service.upload_file(_f, s3_key=_key, content_type="application/json")
                        if _ckpt_files:
                            logger.info(f"[VideoGenService] Uploaded {len(_ckpt_files)} checkpoint files to S3 for {video_id}")
                    except Exception as _ckpt_err:
                        logger.warning(f"[VideoGenService] Failed to upload checkpoints to S3: {_ckpt_err}")


                # Coverage gate — a run that shipped a fraction of its shots is
                # not COMPLETED. A real run planned 28 shots and delivered 20:
                # 8 generated fine, failed at timeline placement, and were
                # dropped, while 2 more shipped as empty fallback frames. The
                # run reported COMPLETED with an empty error_message, so the
                # only way to discover a film missing its certificate reveal
                # and its closing shot was to open the editor and look.
                if stage_name == "HTML":
                    try:
                        _cov = _timeline_coverage(run_dir)
                        if _cov and _cov["missing"]:
                            _msg = (
                                f"Shipped {_cov['present']} of {_cov['planned']} shots — "
                                f"missing/blank: {_cov['missing']}"
                            )
                            logger.error(f"[VideoGenService] {video_id}: {_msg}")
                            # Status stays COMPLETED — the film is watchable, and
                            # PARTIAL is a value the frontend does not handle. The
                            # point is that the shortfall stops being invisible.
                            self.repository.record_warning(video_id, _msg)
                            try:
                                # update_metadata REPLACES the whole column: a
                                # bare {"shot_coverage": ...} wiped every run
                                # that tripped this gate (user_selections, host,
                                # lesson plan + billing...). Merge instead.
                                _vrec_cov = self.repository.get_by_video_id(video_id)
                                _emeta_cov = dict((_vrec_cov.extra_metadata or {}) if _vrec_cov else {})
                                _emeta_cov["shot_coverage"] = _cov
                                self.repository.update_metadata(video_id, _emeta_cov)
                            except Exception:
                                pass
                    except Exception as _cov_err:
                        logger.warning(f"[VideoGenService] coverage check failed: {_cov_err}")

                # Update stage status — wrap in try/except so a stale-session error
                # doesn't abort the entire pipeline after files were already uploaded.
                try:
                    self.repository.update_stage(
                        video_id=video_id,
                        stage=stage_name,
                        status="COMPLETED"
                    )
                except Exception as stage_update_err:
                    logger.error(
                        f"[VideoGenService] Failed to update stage {stage_name} in DB: {stage_update_err}. "
                        "Files may have been uploaded but stage is not marked complete.",
                        exc_info=True
                    )
                # Resume manifest: the stage is done (status/current_stage cannot
                # say this — a non-combine run busy in TTS reads COMPLETED at
                # SCRIPT). A combine HTML pass also completed TTS and WORDS.
                # Not when the stage raised: the loop still uploads partial
                # files (and marks the row) but the stage did not finish.
                if not pipeline_error:
                    self._mark_completed_stages(
                        video_id,
                        [stage_name] + (["TTS", "WORDS"] if (_phase_b_combine and stage_name == "HTML") else []),
                    )
                if checkpoint_uploader is not None:
                    try:
                        from .video_checkpoint import PREAMBLE_FILES, enqueue_existing
                        _ck_names = ["cost_breakdown_by_stage.json"]
                        if stage_name == "SCRIPT":
                            # Plans that only live on this pod + the final
                            # reference context: a cross-pod resume needs them.
                            _ck_names += list(PREAMBLE_FILES) + ["reference_context.json", "lesson_plan.json"]
                        enqueue_existing(checkpoint_uploader, video_id, run_dir, _ck_names)
                    except Exception as _ck_err:  # noqa: BLE001
                        logger.warning(f"[VideoGenService] checkpoint enqueue failed: {_ck_err}")

                # After HTML stage: build per-sentence audio clips from the
                # already-uploaded narration.mp3 + words.json so the editor's
                # script tab has them. Best-effort; never fail the video
                # because clip building failed — sentences[] is purely additive.
                if stage_pipeline_name == "html":
                    self._build_sentence_clips_safe(video_id)

                logger.info(f"[VideoGenService] Stage {stage_name} completed. Uploaded {len(uploaded_files)} files.")
                
                yield {
                    "type": "progress",
                    "stage": stage_name,
                    "message": f"Completed {stage_name}",
                    "percentage": percentage,
                    "video_id": video_id,
                    "files": uploaded_files
                }
            else:
                # Stage didn't produce files - log but continue checking next stages
                # (earlier stages might have completed even if later ones failed)
                logger.info(f"[VideoGenService] Stage {stage_name} did not produce files (may have failed or not reached)")
                # Don't break - continue checking remaining stages for partial results
        
        # Final verification: log what's actually in the database
        final_record = self.repository.get_by_video_id(video_id)
        if final_record:
            logger.info(f"[VideoGenService] Final DB state for {video_id}:")
            logger.info(f"  - Stage: {final_record.current_stage}, Status: {final_record.status}")
            logger.info(f"  - File IDs: {list(final_record.file_ids.keys()) if final_record.file_ids else []}")
            logger.info(f"  - S3 URLs: {list(final_record.s3_urls.keys()) if final_record.s3_urls else []}")
        else:
            logger.warning(f"[VideoGenService] No record found in DB for {video_id}")
        
        # If pipeline had error, mark as failed
        _agg_terminal = _get_run_state_aggregator()
        if pipeline_error:
            logger.error(f"[VideoGenService] Pipeline error: {pipeline_error}")
            video_record = self.repository.get_by_video_id(video_id)
            if video_record:
                # Update error message but keep current stage
                self.repository.mark_failed(
                    video_id=video_id,
                    error_message=pipeline_error,
                    current_stage=video_record.current_stage  # Keep the last completed stage
                )
            else:
                # No record exists, create failed record
                self.repository.mark_failed(
                    video_id=video_id,
                    error_message=pipeline_error
                )
            if _agg_terminal is not None:
                _agg_terminal.end_run(video_id, "FAILED")
                try:
                    _final_snap = _agg_terminal.serialize_for_db(video_id)
                    if _final_snap:
                        self.repository.update_live_snapshot(video_id, _final_snap)
                except Exception:
                    pass

            # Clear the cooperative-stop registry BEFORE the terminal yield —
            # consumers may break on the error event, in which case GeneratorExit
            # lands at this yield and code after it never runs.
            cancellation_registry.clear(video_id)

            yield {
                "type": "error",
                "message": f"Video generation encountered an error: {pipeline_error}. Partial files may have been saved.",
                "video_id": video_id,
                "error_details": pipeline_error,
                "stage": video_record.current_stage if video_record else "PENDING"
            }
        elif _agg_terminal is not None:
            # Loop finished without setting pipeline_error → mark the live
            # snapshot as completed so the polling endpoint stops showing the
            # stage spinner. The DB record's status is the authoritative
            # source on retrospective queries; the aggregator's flip here
            # keeps the live view in sync without a separate DB read.
            _agg_terminal.end_run(video_id, "COMPLETED")
            try:
                _final_snap = _agg_terminal.serialize_for_db(video_id)
                if _final_snap:
                    self.repository.update_live_snapshot(video_id, _final_snap)
            except Exception:
                pass

        # Clean up the cooperative-stop registry entry. Idempotent — safe even
        # if we already cleared on a PipelineCancelled return earlier.
        cancellation_registry.clear(video_id)

    # Note: _process_pipeline_outputs is now handled inline in _run_pipeline_stages
    # for real-time database updates at each stage

    def _build_sentence_clips_safe(self, video_id: str) -> None:
        """Best-effort: build per-sentence audio clips and patch them into
        the video's timeline JSON. Called once per video after the HTML
        stage uploads finish.

        Swallows all errors and logs them — sentences[] is purely additive
        for the editor's script tab; a failure here must never break video
        generation. Skips silently if the render server isn't configured.
        """
        import logging
        logger = logging.getLogger(__name__)
        try:
            from ..config import get_settings
            from .render_service import RenderService
            from .sentence_clip_service import SentenceClipService

            settings = get_settings()
            if not settings.render_server_url:
                logger.info(
                    "[VideoGenService] Skipping sentence-clip build for %s — render server not configured",
                    video_id,
                )
                return

            svc = SentenceClipService(
                s3_service=self.s3_service,
                render_service=RenderService(
                    render_server_url=settings.render_server_url,
                    render_key=settings.render_server_key,
                ),
                repository=self.repository,
                video_gen_root=self.video_gen_root,
            )
            result = svc.build_for_video(video_id)
            if result.ok:
                logger.info(
                    "[VideoGenService] Built %d sentence clip(s) for %s",
                    result.count, video_id,
                )
            else:
                logger.info(
                    "[VideoGenService] Sentence-clip build skipped for %s: %s",
                    video_id, result.skipped_reason,
                )
        except Exception as exc:
            logger.warning(
                "[VideoGenService] Sentence-clip build failed for %s: %s",
                video_id, exc, exc_info=True,
            )

    def get_video_status(self, video_id: str) -> Optional[Dict[str, Any]]:
        """
        Get current status of video generation.

        Args:
            video_id: Video identifier

        Returns:
            Video status dictionary or None if not found. Includes a `live`
            field carrying the v3 RunStateAggregator snapshot — read from
            process memory while the run is active, falling back to the
            persisted snapshot in ``extra_metadata.live`` for history views.
            The DB-side ``status`` field always wins for the top-level
            status string; ``live.status`` is allowed to lag (it's a
            snapshot of what the in-process aggregator believed last).
        """
        video_record = self.repository.get_by_video_id(video_id)
        if not video_record:
            return None

        result = video_record.to_dict()

        # Attach live snapshot. In-memory wins; DB fallback for history /
        # post-restart reads. Tolerates aggregator load failure (returns
        # None) so a broken aggregator never breaks status reads.
        live: Optional[Dict[str, Any]] = None
        aggregator = _get_run_state_aggregator()
        if aggregator is not None:
            try:
                live = aggregator.snapshot(video_id)
            except Exception:
                live = None
        if live is None:
            meta = result.get("metadata") or {}
            live = meta.get("live") if isinstance(meta, dict) else None
        if live is not None:
            # Reflect the authoritative DB status onto the snapshot so the
            # FE doesn't have to reconcile two status strings.
            db_status = result.get("status")
            if db_status:
                live["status"] = db_status
            result["live"] = live

        # Assist mode: surface the pending decision as a convenience top-level
        # field so polling clients can rehydrate the conversation card without
        # digging into metadata.assist. Set only while paused (AWAITING_INPUT).
        _meta = result.get("metadata") or {}
        _assist = _meta.get("assist") if isinstance(_meta, dict) else None
        if isinstance(_assist, dict) and _assist.get("pending_decision"):
            result["pending_decision"] = _assist.get("pending_decision")

        return result


    # ──────────────────────────────────────────────────────────────────────
    # Preloaded runtime catalog — what every regenerated shot can rely on
    # already being on the page.
    #
    # The render harness (`generate_video.py`) injects a fixed set of CDN
    # libraries + helper functions + base CSS into every shot's host
    # document. Without telling the LLM about this surface, regen routinely:
    #   • re-imports GSAP / D3 / etc. via <script src=…> (clobbers globals)
    #   • invents libraries that aren't loaded (chart.js, three.js, jQuery)
    #   • re-authors typography classes that already exist
    #   • uses setTimeout / window.addEventListener('load', …), neither of
    #     which work in the renderer's shadow-DOM-backed seek model
    #
    # This block is appended to BOTH the rich-context and legacy regen
    # prompts so the constraint applies regardless of timeline vintage.
    # Source of truth for what's actually preloaded:
    #   ai-video-gen-main/generate_video.py (search for "<!-- GSAP -->")
    # ──────────────────────────────────────────────────────────────────────
    _PRELOADED_RUNTIME_BLOCK = """
## PRELOADED RUNTIME (already loaded — DO NOT include script/style tags for these)

Globally available JS libraries — use without imports / script tags:
- GSAP 3.12.5 + MotionPathPlugin (named eases only — power3.out, expo.out, back.out, etc.)
- MorphSVGPlugin: STUB ONLY (premium plugin not on public CDN). Won't morph — pick a different effect.
- Mermaid 10 — wrap diagrams in `<div class="mermaid">…</div>`
- KaTeX 0.16.9 — call `window.renderMath(selector?)` after inserting LaTeX (`$x^2$` / `$$\\\\frac{a}{b}$$`)
- Prism 1.29.0 + autoloader — call `window.highlightCode()` after inserting `<pre><code class="language-js">`
- D3 v7 (window.d3) — for custom SVG charts / scales
- Howler 2.2.4 (window.Howl) — audio (rarely needed; pipeline handles narration)
- Vivus 0.4.6 — call `window.animateSVG(idOrElement, duration, callback?)` for SVG draw-on
- Rough Notation (window.RoughNotation) — annotate.show() handwritten highlights
- Anime.js 3.2.1 — IMPORTANT: register seekable timelines, never autoplay:
    `window._animeR({ instance: anime({ autoplay: false, ... }), startMs: 500 });`
  Anime instances that don't go through `_animeR` will play in real time and desync from the rendered video.
- Iconify — use the web component: `<iconify-icon icon="mdi:rocket"></iconify-icon>` (275k+ icons)

Helper functions on `window`:
- `window.renderMath(selector?)` — KaTeX wrapper, defaults to body
- `window.highlightCode()` — Prism wrapper, scans the whole doc
- `window.animateSVG(idOrEl, duration, callback?)` — Vivus draw-on

Loaded fonts (Google Fonts, ready to use): Montserrat, Inter, Fira Code, Noto Sans

Built-in CSS classes (reuse — don't re-author equivalents):
- Typography:  .text-display (64px display), .text-h2 (48px h2), .text-body (28px body), .text-label (18px uppercase mono)
- Layouts:     .full-screen-center, .layout-split (1fr 1fr), .image-split-layout
- Hero shots:  .image-hero (with `.image-hero > img` getting Ken Burns), .image-text-overlay (with .gradient-bottom / .gradient-full / .gradient-center modifiers)
- Video bg:    .video-hero (full-screen stock video)
- Lower third: .lower-third + .lt-accent-bar / .lt-content / .lt-label / .lt-text
- Process viz: .process-flow + .process-node, .equation-build-row + .eq-term / .eq-sep
- Patterns:    .key-takeaway, .wrong-right-container + .wrong-box / .right-box
- Inline:      .highlight (yellow marker), .emphasis (primary-colored bold)
- Mermaid:     .mermaid (auto-centered)
- Ken Burns motion (apply to `.image-hero > img`): .kb-zoom-in, .kb-zoom-out, .kb-pan-left, .kb-pan-right, .kb-pan-up, .kb-zoom-pan-tl
- Entrance:    .shot-enter (CSS fade-in)

Built-in CSS variables (always defined):
- --primary-color, --accent-color, --text-color, --text-secondary, --background-color
- --kb-duration (controls Ken Burns animation length)

Prefer these tokens / classes over hardcoded values. They're how the rest of the run stays visually consistent.

## RUNTIME GUARDRAILS (your shot fails or desyncs if you violate these)

DO NOT include `<script src="…">` for any library above — they're already loaded once at the document level. A second copy will redefine `window.gsap` / `window.d3` etc. mid-render and break sibling shots.
DO NOT use libraries that aren't in the list — chart.js, three.js, fabric.js, pdf.js, jQuery, lodash, react, vue are NOT loaded.
DO NOT use `setTimeout` for animation timing — the render server steps through `gsap.globalTimeline` (and `_animeSeek`) frame-by-frame. setTimeout-driven motion will fire at real-world wall time, not video time, so it'll appear at the wrong frame in the rendered MP4.
DO NOT wrap inline scripts in `window.addEventListener('load', …)` or `DOMContentLoaded` — the host document already fired those events before your shot was mounted into its shadow root.
DO NOT touch `document.head`, `document.body`, `#camera-wrapper`, `#world-layer`, or `#ui-layer` — those are owned by the render harness.
DO NOT inject `<style>` rules that override the built-in classes globally (e.g. redefining `.text-display`). Scope custom CSS to inner classes inside `#shot-root`.
DO NOT hardcode fonts other than the four loaded above — anything else triggers a flash-of-unstyled-text in the rendered video.
"""

    def _lookup_shot_html_model(
        self,
        video_id: str,
        target_frame: Optional[Dict[str, Any]],
        raw_timeline: Optional[Dict[str, Any]],
        status: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """Find the model that authored this shot's HTML, if persisted.

        Checks in order:
          1. target_frame['html_model']            (direct on the frame)
          2. raw_timeline['meta']['shots'][i]['html_model']
                                                    (v3 meta.shots[])
          3. S3 director_plan.json / shot_plan.json shot entry's html_model
                                                    (initial-gen artifact)

        `status` is the result of `self.get_video_status(video_id)` — passed
        in by the caller to avoid a second roundtrip when regenerate already
        called it. If omitted, this method calls it itself.

        Returns None if no persisted model is found (caller falls back).

        Frame regenerate no longer calls this (2026-10-13: regens run on the
        'video_regenerate' registry default, not the authoring model); kept
        for forensics on which model wrote a shot.
        """
        if target_frame and target_frame.get("html_model"):
            return target_frame["html_model"]

        # Try both field names — the codebase mixes `shot_idx` (newer entries)
        # and `shot_index` (older paths via _coerce_shot_index).
        shot_idx = None
        if target_frame:
            shot_idx = target_frame.get("shot_idx")
            if shot_idx is None:
                shot_idx = target_frame.get("shot_index")

        def _shot_key(s: Dict[str, Any]) -> Any:
            return s.get("shot_idx") if s.get("shot_idx") is not None else s.get("shot_index")

        # 2. meta.shots[] (pipeline v3) or meta.sentences[]-keyed lookup
        if raw_timeline and isinstance(raw_timeline.get("meta"), dict):
            meta_shots = raw_timeline["meta"].get("shots") or []
            for s in meta_shots:
                if not isinstance(s, dict):
                    continue
                if shot_idx is not None and _shot_key(s) == shot_idx:
                    if s.get("html_model"):
                        return s["html_model"]

        # 3. Director plan / shot plan on S3 — last resort.
        try:
            if status is None:
                status = self.get_video_status(video_id)
            s3_urls = (status or {}).get("s3_urls", {}) if status else {}
            plan_url = s3_urls.get("shot_plan") or s3_urls.get("director_plan")
            if not plan_url:
                return None
            with tempfile.TemporaryDirectory() as td:
                plan_path = Path(td) / "plan.json"
                if not self.s3_service.download_file(plan_url, plan_path):
                    return None
                plan = json.loads(plan_path.read_text(encoding="utf-8"))
                shots = plan.get("shots") if isinstance(plan, dict) else None
                if not shots:
                    return None
                # Positional lookup first (cheapest, accurate for v3 plans
                # where shots[] indexes line up with shot_idx).
                if (
                    shot_idx is not None
                    and isinstance(shot_idx, int)
                    and 0 <= shot_idx < len(shots)
                ):
                    hit = (shots[shot_idx] or {}).get("html_model")
                    if hit:
                        return hit
                # Fallback: scan by either field name.
                for s in shots:
                    if isinstance(s, dict) and _shot_key(s) == shot_idx:
                        if s.get("html_model"):
                            return s["html_model"]
        except Exception:
            return None
        return None

    def _build_regen_context(
        self,
        timeline_data: Any,
        frame_index: int,
        timeline_meta: Optional[Dict[str, Any]] = None,
        visual_preferences: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Extract run-level + neighbour-level context for the frame-regen LLM.

        Returns a dict with:
          - palette, style_guide, shot_pack (run-level, from timeline meta)
          - target_shot_type (from the frame's _shot_type, when present)
          - neighbour_shots (list of {position, shot_type, narration, visual_desc} for
            up to 2 prev + 2 next shots)

        Empty / missing fields degrade gracefully — old timelines (pre-2026-05)
        without `_narration_excerpt` or `meta.shot_pack` simply yield an empty
        context dict and the regen prompt falls back to the legacy minimal form.
        """
        meta = timeline_meta or {}
        if not isinstance(meta, dict):
            meta = {}

        # Normalize to entries list
        entries = (
            timeline_data["entries"]
            if isinstance(timeline_data, dict) and "entries" in timeline_data
            else timeline_data
        )
        if not isinstance(entries, list):
            entries = []

        ctx: Dict[str, Any] = {}
        palette = meta.get("palette") if isinstance(meta.get("palette"), dict) else None
        if palette:
            ctx["palette"] = palette
        style_guide = meta.get("style_guide") if isinstance(meta.get("style_guide"), dict) else None
        if style_guide:
            ctx["style_guide"] = style_guide
        shot_pack = meta.get("shot_pack") if isinstance(meta.get("shot_pack"), dict) else None
        if shot_pack:
            ctx["shot_pack"] = shot_pack
        ctx["dimensions"] = meta.get("dimensions") or {"width": 1920, "height": 1080}

        # Target shot's stash fields (kept in published timeline since 2026-05)
        if 0 <= frame_index < len(entries):
            target = entries[frame_index]
            ctx["target_shot_type"] = target.get("_shot_type") or ""
            ctx["target_narration"] = target.get("_narration_excerpt") or ""
            ctx["target_visual_description"] = target.get("_visual_description") or ""
            ctx["target_template_id"] = target.get("_template_id") or ""

        # Window of up to 2 prev + 2 next shots — gives the LLM continuity
        # signal without ballooning the prompt.
        neighbours: List[Dict[str, Any]] = []
        for offset in (-2, -1, 1, 2):
            j = frame_index + offset
            if 0 <= j < len(entries) and j != frame_index:
                e = entries[j]
                neighbours.append({
                    "position": "prev" if offset < 0 else "next",
                    "offset": offset,
                    "shot_type": e.get("_shot_type") or "",
                    "narration": (e.get("_narration_excerpt") or "")[:160],
                    "visual_desc": (e.get("_visual_description") or "")[:160],
                })
        if neighbours:
            ctx["neighbours"] = neighbours

        # Slice D: surface user visual preferences so the regen system prompt
        # can carry the same text-density caps and family bias the original
        # generation honored. Empty / all-None → ignored downstream.
        if visual_preferences:
            ctx["visual_preferences"] = visual_preferences

        return ctx

    def _build_regen_prompt(
        self,
        context: Dict[str, Any],
        original_html: str,
        user_prompt: str,
    ) -> tuple[str, str]:
        """Build the (system, user) prompt pair for frame regeneration.

        Composes run-level brand context + neighbour summary + skill catalog
        into the system prompt so the regenerated shot stays consistent with
        the rest of the timeline. Falls back to the legacy minimal prompt
        when context is empty (old timelines).
        """
        import json as _json

        # If we have no run context at all (legacy timeline), use the original
        # minimal prompt — never regress.
        if not context.get("palette") and not context.get("shot_pack"):
            system = (
                "You are an expert HTML/CSS developer for educational videos. "
                "Modify the provided HTML frame based on the user's request.\n\n"
                "RULES:\n"
                "1. Keep the HTML structure valid and responsive.\n"
                "2. PRESERVE all existing image tags <img src='...'> exactly. "
                "Do not change image sources.\n"
                "3. Apply requested text or CSS changes.\n"
                "4. Return ONLY the new HTML code. No markdown, no explanations.\n"
                + self._PRELOADED_RUNTIME_BLOCK
            )
            user = (
                f"ORIGINAL HTML:\n{original_html}\n\n"
                f"USER INSTRUCTION:\n{user_prompt}\n\nGenerate the updated HTML:"
            )
            return system, user

        # Rich context path — build a designer-grade system prompt.
        #
        # Until 2026-05 this method maintained its own per-shot teaching block
        # in parallel with the one initial-gen uses. The May audit (rubric v3,
        # bbox-lint, pacing profile, background_treatment, whitespace-safe
        # accent words, branded easing, 3D perspective layers, SVG filter
        # teaching, second-beat motion) only landed in `shot_type_cards.
        # build_per_shot_system_prompt` — regen never saw those fixes, which
        # is the single largest reason regen output was visibly worse than
        # initial-gen output.
        #
        # We now call the canonical builder first, then append regen-specific
        # context (run brand tokens, neighbours, original HTML, edit
        # instruction). One prompt builder, two callers.
        sections: List[str] = []

        target_shot_type = context.get("target_shot_type", "")
        dims = context.get("dimensions") or {}
        _w = int(dims.get("width", 1920) or 1920)
        _h = int(dims.get("height", 1080) or 1080)

        # Always use the aspirational preamble for regen. Per the May 2026
        # audit, both CORE_PREAMBLE and CORE_PREAMBLE_ASPIRATIONAL carry the
        # foundational rules (whitespace-safe accent words, background
        # contract, second-beat motion). Aspirational only differs by
        # relaxing some stylistic bans — which is the right trade for an
        # edit where the user may want exactly that kind of break. Earlier
        # tier-heuristic was a dead branch (`context['run']` was never set).
        canonical_block: Optional[str] = None
        if target_shot_type:
            try:
                if str(self.video_gen_root) not in sys.path:
                    sys.path.insert(0, str(self.video_gen_root))
                from shot_type_cards import (  # type: ignore
                    build_per_shot_system_prompt as _bpssp,
                )
                canonical_block = _bpssp(
                    target_shot_type, _w, _h,
                    aspirational=True,
                )
            except Exception as _bpssp_err:
                # Best-effort: regen continues with the legacy inlined block
                # below if the canonical builder isn't importable for any
                # reason. Log so the gap is visible in stage logs instead of
                # silently degrading regen quality.
                import logging as _lg
                _lg.getLogger(__name__).warning(
                    "[VideoGenService] Frame regen could not import "
                    f"build_per_shot_system_prompt (continuing with legacy "
                    f"teaching block): {_bpssp_err}"
                )

        sections.append(
            "You are the editor for an existing AI-generated educational video. "
            "A specific shot needs to be modified. The rest of the timeline is "
            "FROZEN — your edit must look stylistically continuous with its "
            "neighbours. Honor the canonical teaching block (CORE_PREAMBLE / "
            "shot type card / DO-NOT rules / TEXT BOUND BOX / OUTPUT FORMAT) "
            "exactly as initial generation does — regen is held to the same "
            "post-render rubric (bbox-lint + vision review v3 + brand-asset + "
            "animation density). Your output will be graded on those gates."
        )

        if canonical_block:
            sections.append("\n## CANONICAL SHOT TEACHING (same block as initial gen)\n")
            sections.append(canonical_block)

        sections.append("\n## RUN CONTEXT (do not violate)")

        palette = context.get("palette") or {}
        if palette:
            sections.append(
                "\n**Brand palette** (use the CSS variables, not raw hex):\n"
                f"  --brand-primary: {palette.get('primary', '?')}\n"
                f"  --brand-accent: {palette.get('accent', '?')}\n"
                f"  --brand-text: {palette.get('text', '?')}\n"
                f"  --brand-text-secondary: {palette.get('text_secondary', '?')}\n"
                f"  --brand-bg: {palette.get('background', '?')}"
            )

        sg = context.get("style_guide") or {}
        if sg:
            sections.append(
                "\n**Run style guide**:\n"
                f"  Background type: {sg.get('background_type') or 'n/a'}\n"
                f"  Layout theme:    {sg.get('layout_theme') or 'n/a'}\n"
                f"  Motion strategy: {sg.get('motion_strategy') or 'n/a'}"
            )

        sp = context.get("shot_pack") or {}
        if sp:
            # Compact serialization — JSON is fine; the LLM reads it
            sections.append(
                "\n**Shot pack — single source of design truth for this video** "
                "(use these tokens verbatim):\n```json\n"
                + _json.dumps(sp, indent=2, ensure_ascii=False)
                + "\n```\n"
                "Rules:\n"
                "- COLORS: use only color_tokens CSS vars (var(--brand-primary) etc.). Never hardcode brand hex.\n"
                "- TYPOGRAPHY: use font_scale values. Never invent your own size.\n"
                "- SPACING: use spacing tokens; safe_area for outer padding.\n"
                "- EASES: use ease tokens in GSAP tweens."
            )

        target_shot_type = context.get("target_shot_type", "")
        target_narration = context.get("target_narration", "")
        target_visual = context.get("target_visual_description", "")
        target_template = context.get("target_template_id", "")
        if target_shot_type or target_narration or target_visual or target_template:
            sections.append("\n## TARGET FRAME (the one being edited)")
            if target_shot_type:
                sections.append(f"  Shot type: {target_shot_type}")
            if target_template:
                sections.append(
                    f"  Originally rendered from template: `{target_template}`. "
                    "Your edit can stay template-shaped or break free — your call, "
                    "but visual consistency with the rest of the timeline is non-negotiable."
                )
            if target_narration:
                sections.append(f"  Narration excerpt: \"{target_narration[:280]}\"")
            if target_visual:
                sections.append(f"  Original visual direction: \"{target_visual[:240]}\"")

        neighbours = context.get("neighbours") or []
        if neighbours:
            sections.append("\n## NEIGHBOURING SHOTS (for continuity reference)")
            for n in neighbours:
                label = "Previous" if n["position"] == "prev" else "Next"
                shot_type = n.get("shot_type") or "?"
                narr = n.get("narration") or ""
                vis = n.get("visual_desc") or ""
                line = f"- {label} (offset {n['offset']:+d}, {shot_type}):"
                if narr:
                    line += f" narration=\"{narr}\""
                if vis:
                    line += f" visual=\"{vis}\""
                sections.append(line)
            sections.append(
                "\nDo NOT redesign — your edit should feel like the same designer "
                "produced the surrounding shots."
            )

        # Visual preferences (Slice D) — text-density caps + family hint inherited
        # from the original run. The regen LLM can't change shot_type meaningfully
        # (it rewrites HTML in place), so the block we inject is the per-shot
        # text-density variant. Empty / all-auto → no-op.
        _vp_regen = context.get("visual_preferences") or {}
        if _vp_regen:
            try:
                if str(self.video_gen_root) not in sys.path:
                    sys.path.insert(0, str(self.video_gen_root))
                from prompts import build_visual_preferences_shot_block as _bvpsb  # type: ignore
                _vp_block = _bvpsb(_vp_regen, target_shot_type or "")
                if _vp_block:
                    sections.append(_vp_block)
            except Exception as _vp_imp_err:
                # Best-effort — regen continues without the block. Log instead
                # of swallowing silently so we notice if the helper moves /
                # gets renamed and the regen path silently drops the bias.
                # `_build_regen_prompt` doesn't define a method-local logger
                # like other methods in this file; pull one inline so we don't
                # NameError on the warning path.
                import logging as _logging_vp
                _logging_vp.getLogger(__name__).warning(
                    f"[VideoGenService] Frame regen visual prefs helper "
                    f"unavailable (continuing without block): {_vp_imp_err}"
                )

        # Skill catalog — only when we know the target shot type and the registry imports
        if target_shot_type:
            try:
                if str(self.video_gen_root) not in sys.path:
                    sys.path.insert(0, str(self.video_gen_root))
                from skill_registry import build_catalog_for_shot  # type: ignore
                # Use ultra catalog as a reasonable upper bound; the regen LLM
                # can reach for any skill the original run could have.
                canvas = "portrait" if (
                    int(context.get("dimensions", {}).get("width", 1920))
                    < int(context.get("dimensions", {}).get("height", 1080))
                ) else "landscape"
                catalog = build_catalog_for_shot(target_shot_type, "ultra", canvas)
                if catalog and catalog.strip():
                    sections.append("\n## SKILL CATALOG (drop <skill> tags as needed)")
                    sections.append(catalog)
            except Exception:
                pass  # registry import / catalog build is best-effort

        # ── REGEN DELTA BLOCK ────────────────────────────────────────────
        # Things the LLM needs to know about EDITING (not authoring) a shot.
        # These don't belong in the canonical per-shot teaching (initial gen
        # has no "original HTML" to edit), so they live here.
        regen_delta: List[str] = []
        regen_delta.append("\n## REGEN-SPECIFIC RULES (editing an existing shot)")

        # 1. Tell the LLM about SVG <filter>/<defs> IDs already in the HTML so
        #    it doesn't redeclare them (which silently overrides the originals
        #    if IDs collide) and doesn't strip them (which breaks any element
        #    that references them via filter="url(#…)").
        try:
            svg_filter_ids = sorted(set(
                re.findall(
                    r'<(?:filter|linearGradient|radialGradient|symbol|clipPath|mask|pattern)\s+[^>]*\bid=["\']([^"\']+)["\']',
                    original_html or "",
                )
            ))
        except Exception:
            svg_filter_ids = []
        if svg_filter_ids:
            regen_delta.append(
                "\n**SVG defs already declared in the original HTML** (do NOT "
                "redeclare; reference via `url(#id)` if needed; do NOT strip "
                "unless replacing the consuming element):"
            )
            for sid in svg_filter_ids[:24]:
                regen_delta.append(f"  - #{sid}")
            if len(svg_filter_ids) > 24:
                regen_delta.append(f"  - …and {len(svg_filter_ids) - 24} more")

        # 2. The shot has its own scoped id prefix (e.g. `s3_panel`, `s3_w1`).
        #    Tell the LLM to keep that prefix — the timeline-wide CSS scoping
        #    assumes per-shot id namespaces.
        try:
            id_prefix_match = re.search(r'id=["\']([a-zA-Z]+\d+)_', original_html or "")
            id_prefix = id_prefix_match.group(1) if id_prefix_match else None
        except Exception:
            id_prefix = None
        if id_prefix:
            regen_delta.append(
                f"\n**ID prefix in use**: `{id_prefix}_*` — keep this prefix on "
                "any new elements you add. Other shots in the timeline use "
                "different prefixes; do NOT collide."
            )

        regen_delta.append(
            "\n**Edit discipline**\n"
            "- Make the smallest change that fulfils the user instruction. "
            "Rewriting unaffected sections raises drift risk and gets caught "
            "by the post-regen vision reviewer.\n"
            "- Preserve element IDs that already exist in the HTML. The "
            "render harness, audio-sync layer, and editor's transform overlay "
            "all key off these IDs.\n"
            "- If the user instruction is ambiguous (\"the image\", \"the "
            "text\"), prefer the element that occupies the largest screen "
            "area in the original HTML."
        )

        sections.append("\n".join(regen_delta))

        sections.append(
            "\n## OUTPUT RULES\n"
            "1. PRESERVE existing `<img src=\"...\">` and `<video src=\"...\">` tags exactly — "
            "do not change `src`, `data-img-source`, `data-reference-url`, "
            "`data-img-prompt`, `data-video-query`, `data-subject-id`, "
            "`data-skill`, or `data-aivideo` attributes unless the user "
            "instruction explicitly asks for it. These attributes drive "
            "downstream asset resolution; reordering or removing them "
            "silently breaks the image/video cascade.\n"
            "2. Use the brand CSS variables from RUN CONTEXT — never hardcode brand colors.\n"
            "3. Reuse the shot pack's font_scale and spacing tokens — never pick your own.\n"
            "4. Keep the outer wrapper as `<div id=\"shot-root\" style=\"position:relative;width:100%;height:100%;overflow:hidden\">…</div>`.\n"
            "5. Use named GSAP eases (power3.out / back.out / expo.out) — never `linear` unless intentional.\n"
            "6. Never use `setTimeout`. Use `gsap.delayedCall` or tween `delay:` values.\n"
            "7. Never wrap inline scripts in `window.addEventListener('load', …)` — won't fire in the render server's shadow DOM.\n"
            "8. Return ONLY the new HTML code. No markdown fences, no commentary."
        )

        # Append the preloaded-runtime catalog so the LLM knows what's
        # already global (and what isn't). Keeps regen results from adding
        # `<script src=…>` for libraries the render harness already loaded
        # OR pulling in libraries that aren't loaded at all.
        sections.append(self._PRELOADED_RUNTIME_BLOCK)

        system = "\n".join(sections)
        user = (
            f"ORIGINAL HTML:\n{original_html}\n\n"
            f"USER INSTRUCTION:\n{user_prompt}\n\n"
            f"Return the updated HTML with the run context honored."
        )
        return system, user

    def regenerate_video_thumbnails(
        self,
        video_id: str,
        institute_id: Optional[str] = None,
    ) -> None:
        """Re-run the 4-option thumbnail batch for an existing video.

        Runs synchronously (intended to be invoked via FastAPI BackgroundTasks).
        Reuses what's already persisted on the video row — prompt for the
        title, prior `thumbnails.intent`/`orientation` if set — so we don't
        need to reload the original script_plan or director_plan from disk.

        On success persists the new set via `repository.update_thumbnails`.
        Cost is bundled into the original video budget — no extra ledger line.
        """
        import sys as _sys
        import logging as _logging
        _logger_t = _logging.getLogger(__name__)

        try:
            record = self.repository.get_by_video_id(video_id)
            if not record:
                _logger_t.warning(f"[Thumbs] regenerate: video {video_id} not found")
                return

            from ..config import get_settings as _gs
            api_key = (_gs().openrouter_api_key or "").strip()
            if not api_key:
                _logger_t.error("[Thumbs] regenerate: OPENROUTER_API_KEY not set")
                return

            existing_thumbs = dict(record.thumbnails or {})
            prior_intent = existing_thumbs.get("intent")
            prior_orientation = existing_thumbs.get("orientation")

            # The user_selections snapshot carries the original avatar pick.
            # We pull it once and reuse for both orientation fallback and the
            # avatar-face thread-through below — saves loading the dict twice.
            _meta = dict(record.extra_metadata or {})
            _sel = _meta.get("user_selections") or {}

            # Best-effort: derive orientation from prior thumbnails, else fall
            # back to the user_selections snapshot the pipeline writes to meta.
            orientation = prior_orientation
            if not orientation:
                orientation = _sel.get("orientation") or "landscape"
            orientation = "portrait" if orientation == "portrait" else "landscape"

            # Carry the host face into regenerate. First-time generation pulls
            # this from self._current_avatar_image_url; regenerate has no
            # pipeline instance, so we read the snapshot the original run
            # persisted to user_selections.avatar_image_url. Without this the
            # regenerated thumbnail loses the host identity, which is exactly
            # the regression the first-run fix was meant to close.
            _avatar_face_url = _sel.get("avatar_image_url") if isinstance(_sel, dict) else None
            if not isinstance(_avatar_face_url, str) or not _avatar_face_url.strip():
                _avatar_face_url = None

            # Title comes from the user's original prompt. We deliberately
            # don't try to recover the script_plan's polished title here —
            # it's stored on disk in the run dir and not always available
            # across deploys. The prompt is always on the row.
            title = (record.prompt or "").strip() or "New video"

            # Synthesize a minimal script_plan for the generator.
            stub_script_plan: Dict[str, Any] = {
                "title": title,
                "intent": prior_intent or "explainer",
                "visual_style": "realistic cinematic photograph",
            }

            # v1: regenerate produces thumbnails from the script title +
            # intent alone — we don't reload the original Director plan or
            # script_plan from S3. The hero subject is derived from the title;
            # for the like-for-like fidelity of the first batch you'd need to
            # snapshot the full script_plan to S3 at generation time and
            # re-fetch it here.
            director_plan: Optional[Dict[str, Any]] = None

            # Load the standalone thumbnail generator.
            _sys.path.insert(0, str(self.video_gen_root))
            try:
                from thumbnail_generator import (
                    run as _run_thumb,
                    make_standalone_seedream_call,
                )
            except Exception as _imp_err:
                _logger_t.error(f"[Thumbs] regenerate import failed: {_imp_err}")
                return

            seedream_call = make_standalone_seedream_call(api_key)

            # The video record's `prompt` field carries the user's original
            # input — same authoritative topic signal we pass on first-time
            # generation. Threading it through makes regenerate honor the
            # actual topic instead of drifting to generic clickbait.
            thumb_set = _run_thumb(
                seedream_call=seedream_call,
                run_id=video_id,
                script_plan=stub_script_plan,
                director_plan=director_plan,
                orientation=orientation,
                subjects_list=[],
                avatar_face_url=_avatar_face_url,
                original_prompt=(record.prompt or "").strip() or None,
                llm_chat=None,
            )

            if not thumb_set or not thumb_set.get("options"):
                _logger_t.warning(f"[Thumbs] regenerate produced no options for {video_id}")
                return

            try:
                self.repository.update_thumbnails(video_id, thumb_set)
                _logger_t.info(
                    f"[Thumbs] regenerated {len(thumb_set['options'])} options "
                    f"for {video_id}"
                )
            except Exception as _persist_err:
                _logger_t.error(f"[Thumbs] regenerate persist failed: {_persist_err}")
        except Exception as e:
            _logger_t.error(f"[Thumbs] regenerate crashed for {video_id}: {e}")

    async def regenerate_video_frame(
        self,
        video_id: str,
        timestamp: float,
        user_prompt: str,
        db_session: Optional[Session] = None,
        institute_id: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Regenerate HTML content for a specific frame based on user prompt.
        
        Args:
            video_id: Video identifier
            timestamp: Timestamp in seconds to identify the frame
            user_prompt: User's instruction for modification
            
        Returns:
            Dict containing original_html and new_html
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # 1. Get video status to find timeline URL
        status = self.get_video_status(video_id)
        if not status or "timeline" not in status.get("s3_urls", {}):
            raise ValueError(f"Timeline not found for video {video_id}. Generate HTML stage first.")
            
        timeline_url = status["s3_urls"]["timeline"]
        
        # 2. Download and parse timeline
        with tempfile.TemporaryDirectory() as temp_dir:
            timeline_path = Path(temp_dir) / "time_based_frame.json"
            if not self.s3_service.download_file(timeline_url, timeline_path):
                raise RuntimeError("Failed to download timeline file")
                
            raw = json.loads(timeline_path.read_text(encoding='utf-8'))

            # Handle both timeline formats:
            #   plain array: [{...}, ...]
            #   wrapped:     {"entries": [...], "meta": {...}}
            timeline_data = raw["entries"] if isinstance(raw, dict) and "entries" in raw else raw

            # 3. Find the target frame by index (when timestamp is an int index)
            #    or by time range using inTime/exitTime (or legacy start_time/end_time).
            target_frame = None
            frame_index = -1

            # Accept both int and float whole numbers as direct frame indices
            is_index = (
                isinstance(timestamp, (int, float))
                and float(timestamp) == float(int(timestamp))
                and 0 <= int(timestamp) < len(timeline_data)
            )
            if is_index:
                idx = int(timestamp)
                target_frame = timeline_data[idx]
                frame_index = idx
            else:
                # Find frame where inTime <= timestamp < exitTime
                for idx, frame in enumerate(timeline_data):
                    start = float(
                        frame.get("inTime") or frame.get("start_time") or frame.get("start") or 0
                    )
                    end = float(
                        frame.get("exitTime") or frame.get("end_time") or frame.get("end") or 99999
                    )
                    if start <= timestamp < end:
                        target_frame = frame
                        frame_index = idx
                        break

            if not target_frame:
                # Fallback to last frame
                if timeline_data:
                    target_frame = timeline_data[-1]
                    frame_index = len(timeline_data) - 1
                else:
                    raise ValueError("Empty timeline")
            
            original_html = target_frame.get("html", "")

            # 4. Build run-context-aware regen prompt. Reads palette / style_guide
            #    / shot_pack from timeline meta and pulls neighbour shots'
            #    narration_excerpt + visual_description so the regenerated frame
            #    stays stylistically continuous with the rest of the timeline.
            #    Falls back to a minimal prompt for legacy timelines that don't
            #    carry these fields.
            timeline_meta = (
                raw["meta"] if isinstance(raw, dict) and isinstance(raw.get("meta"), dict) else {}
            )
            # Slice D: pull resolved visual preferences from extra_metadata.
            # Prefer the post-merge resolved view (includes free-text overrides
            # the original prompt expressed); fall back to raw slider state.
            _vp_regen: Dict[str, Any] = {}
            try:
                _video_rec = self.repository.get_by_video_id(video_id)
                _emeta = (_video_rec.extra_metadata or {}) if _video_rec else {}
                _vp_regen = (
                    (_emeta.get("intent_outcomes") or {}).get("visual_preferences_resolved")
                    or _emeta.get("visual_preferences")
                    or {}
                )
            except Exception:
                _vp_regen = {}
            regen_context = self._build_regen_context(
                timeline_data, frame_index, timeline_meta,
                visual_preferences=_vp_regen,
            )
            system_prompt, user_message = self._build_regen_prompt(
                regen_context, original_html, user_prompt
            )

            # 5. Call LLM to regenerate HTML
            from ..config import get_settings

            import requests
            settings = get_settings()

            if not settings.openrouter_api_key:
                raise ValueError("OpenRouter API key not configured")

            # ── DOM-PATCH FAST PATH ─────────────────────────────────────
            # Before paying the price of a full LLM call, classify the user's
            # intent. If they want a small targeted edit (image swap, text
            # change, color tweak), apply it deterministically with no LLM —
            # the deterministic patcher is faster, cheaper, and doesn't
            # introduce the kind of drift that made Flash regen output worse
            # than the original on full-HTML rewrites.
            #
            # On any failure (classifier down, classifier says "full_remake",
            # patcher couldn't apply the op, parsing failed), we fall through
            # to the canonical LLM path unchanged.
            classification: Optional[Dict[str, Any]] = None
            applied_ops: Optional[List[Dict[str, Any]]] = None
            try:
                from .regen_intent_classifier import (
                    classify_intent as _classify_intent,
                    build_shot_summary as _build_summary,
                    is_patch_safe_to_apply as _patch_safe,
                )
                from .regen_dom_patcher import (
                    build_shot_summary_from_html as _summary_from_html,
                    apply as _dom_apply,
                )
                _summary_kwargs = _summary_from_html(
                    original_html,
                    shot_type=regen_context.get("target_shot_type"),
                )
                _shot_summary = _build_summary(**_summary_kwargs)
                classification = _classify_intent(
                    user_instruction=user_prompt,
                    shot_summary=_shot_summary,
                    openrouter_api_key=settings.openrouter_api_key,
                )
                if classification:
                    logger.info(
                        f"🧭 Regen intent={classification['intent']} "
                        f"confidence={classification.get('confidence')} "
                        f"ops={len(classification.get('patch_ops') or [])} "
                        f"frame={frame_index}"
                    )
                if classification and _patch_safe(classification):
                    patch_result = _dom_apply(
                        original_html, classification["patch_ops"]
                    )
                    if patch_result:
                        new_html_patched, applied_ops = patch_result
                        logger.info(
                            f"⚡ Regen DOM-patched frame={frame_index} "
                            f"ops_applied={len(applied_ops)} "
                            f"(skipped full LLM)"
                        )
                        return {
                            "video_id": video_id,
                            "frame_index": frame_index,
                            "timestamp": timestamp,
                            "original_html": original_html,
                            "new_html": new_html_patched,
                            "resolved_model": None,  # no LLM used
                            "regen_path": "dom_patch",
                            "classification": classification,
                            "applied_ops": applied_ops,
                        }
            except Exception as _fast_path_err:
                logger.warning(
                    "[VideoGenService] Regen fast path failed, falling through "
                    f"to LLM: {_fast_path_err}"
                )
                # classification may still be partially populated; the LLM
                # path will echo whatever we have back in the response.

            # ── Model resolution (3-step, in priority order) ──
            # 1. Explicit request override (FE "Advanced > Model" dropdown).
            # 2. Registry default for use_case='video_regenerate' from
            #    ai_model_defaults (admin-tunable; see migrations).
            # 3. Hard fallback — GLM_DEFAULT.
            # The html_model persisted on old shots is deliberately NOT used:
            # it pinned regens of older videos to Gemini 3.7 Flash / 2.5 Pro.
            resolved_model: Optional[str] = None
            model_source = "fallback"

            if model_override:
                resolved_model = model_override
                model_source = "request_override"

            if not resolved_model and db_session is not None:
                try:
                    from .ai_models_service import AIModelsService
                    registry = AIModelsService(db_session)
                    registry_default = registry.get_default_model_id_for_use_case(
                        "video_regenerate"
                    )
                    if registry_default:
                        resolved_model = registry_default
                        model_source = "registry_default"
                except Exception as e:
                    logger.warning(f"Regen model registry lookup failed: {e}")

            if not resolved_model:
                resolved_model = GLM_DEFAULT
                model_source = "hard_fallback"

            logger.info(
                f"🎨 Regen frame={frame_index} model={resolved_model} "
                f"source={model_source}"
            )

            from .llm_router import post_chat_sync

            response = post_chat_sync(
                api_key=settings.openrouter_api_key,
                payload={
                    "model": resolved_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    "temperature": 0.7
                },
                timeout=90  # M27: increased from 30s — LLM cold-start can take 60-90s
            )

            if response.status_code != 200:
                logger.error(f"LLM Error: {response.text}")
                raise RuntimeError("Failed to regenerate HTML via AI")
                
            new_html = response.json()["choices"][0]["message"]["content"].strip()

            # Extract HTML from markdown code fence if the LLM wrapped its response.
            # Handles both ```html ... ``` and ``` ... ``` anywhere in the response.
            fence_match = re.search(r'```(?:html)?\s*\n?([\s\S]*?)\n?\s*```', new_html, re.IGNORECASE)
            if fence_match:
                new_html = fence_match.group(1).strip()
            else:
                new_html = new_html.strip()
            
            # If the classifier wanted a patch but no op was applicable
            # (e.g. animation-span text target → patcher correctly bailed),
            # surface that distinction in regen_path so the FE can show a
            # more accurate toast.
            _path = "full_remake"
            if classification and classification.get("intent") == "targeted_patch":
                _path = "full_remake_fallback"

            return {
                "video_id": video_id,
                "frame_index": frame_index,
                "timestamp": timestamp,
                "original_html": original_html,
                "new_html": new_html,
                "resolved_model": resolved_model,
                "regen_path": _path,
                "classification": classification,
                "applied_ops": None,
            }

    async def update_video_frame(
        self,
        video_id: str,
        frame_index: int,
        new_html: str,
        in_time: float | None = None,
        exit_time: float | None = None,
        z: int | None = None,
        entry_id: str | None = None,
        entry_meta: Dict[str, Any] | None = None,
        html_model: str | None = None,
        expected_revision: int | None = None,
    ) -> Dict[str, Any]:
        """
        Update a specific frame's HTML in the timeline and save back to S3.

        Args:
            video_id: Video identifier
            frame_index: Index of the frame to update
            new_html: The valid HTML content
            expected_revision: optimistic-lock check against meta.revision
                (see timeline_revision.py); raises TimelineRevisionConflict
                on mismatch before anything is written

        Returns:
            Success status
        """
        import logging
        logger = logging.getLogger(__name__)
        
        status = self.get_video_status(video_id)
        if not status or "timeline" not in status.get("s3_urls", {}):
            raise ValueError(f"Timeline not found for video {video_id}")
            
        timeline_url = status["s3_urls"]["timeline"]
        
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "time_based_frame.json"
            
            # Download
            if not self.s3_service.download_file(timeline_url, file_path):
                raise RuntimeError("Failed to download timeline file")
            
            # Read
            data = json.loads(file_path.read_text(encoding='utf-8'))

            # Handle both timeline formats:
            #   - plain array:              [{"html": ...}, ...]
            #   - wrapped object:           {"entries": [...], "meta": {...}}
            entries = data["entries"] if isinstance(data, dict) and "entries" in data else data

            # Update
            if frame_index < 0 or frame_index >= len(entries):
                raise IndexError(f"Frame index {frame_index} out of range (0-{len(entries)-1})")

            entry = entries[frame_index]
            if entry_id is not None and entry.get("id") != entry_id:
                # The caller's index view has drifted from the server (a
                # concurrent reorder/delete landed since it last loaded the
                # timeline). entry_id is the stable address — recover by id
                # instead of overwriting whatever now sits at the stale index.
                match_idx = next(
                    (i for i, e in enumerate(entries)
                     if isinstance(e, dict) and e.get("id") == entry_id),
                    None,
                )
                if match_idx is None:
                    raise ValueError(
                        f"Entry {entry_id} not found in timeline for video "
                        f"{video_id} (stale index {frame_index}) — the timeline "
                        f"changed since it was loaded; reload the editor and retry"
                    )
                logger.warning(
                    "update_video_frame: entry_id %s found at index %d, not "
                    "the requested index %d — updating by id",
                    entry_id, match_idx, frame_index,
                )
                frame_index = match_idx
                entry = entries[match_idx]
            entry["html"] = new_html
            if in_time is not None:
                entry["inTime"] = in_time
            if exit_time is not None:
                entry["exitTime"] = exit_time
            if z is not None:
                entry["z"] = z
            # Persist the model that authored the HTML, when sent. Editor
            # uses this to make "Remake with AI" sticky — next regen on this
            # entry resolves to the same model the user picked this time.
            # None = leave existing value untouched (raw HTML edits / Code
            # tab saves don't change which model authored the shot).
            if html_model is not None:
                entry["html_model"] = html_model
            # Merge entry_meta (free-form per-entry metadata) — preserve any
            # keys the caller didn't include so we don't clobber unrelated
            # state set by other tools writing into the same entry.
            if entry_meta is not None and isinstance(entry_meta, dict):
                existing_meta = entry.get("entry_meta")
                if not isinstance(existing_meta, dict):
                    existing_meta = {}
                merged = {**existing_meta, **entry_meta}
                # Empty string display_name → drop the key entirely so the
                # entry reverts to its auto-derived friendly name.
                if "display_name" in merged and merged["display_name"] in (None, ""):
                    merged.pop("display_name", None)
                entry["entry_meta"] = merged

            # Optimistic lock: verify the client's loaded revision and bump.
            # Raises TimelineRevisionConflict (router → 409) before anything
            # is written when another session has modified the timeline.
            from .timeline_revision import check_and_bump_revision
            new_revision = check_and_bump_revision(data, expected_revision)

            # Write (data already points to the modified entries when wrapped)
            file_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
            
            # Upload back
            # We use upload_file directly to S3
            # We need to constructing the S3 key again or reuse internal logic
            # S3Service.upload_file expects a key.
            # TIMELINE URL: https://bucket.s3.amazonaws.com/ai-videos/{video_id}/timeline/time_based_frame.json
            # KEY: ai-videos/{video_id}/timeline/time_based_frame.json
            
            from ..config import get_settings
            settings = get_settings()
            bucket = settings.aws_bucket_name
            
            # Extract key from URL
            # simplistic extraction: find "ai-videos/..."
            if f"/{bucket}/" in timeline_url:
                # Path style
                key = timeline_url.split(f"/{bucket}/")[-1]
            elif f"{bucket}.s3" in timeline_url:
                # Virtual host style
                # URL: https://BUCKET.s3.region.amazonaws.com/KEY
                # We need to strip the domain part
                # Find first slash after domain
                match = re.search(r'\.com/(.+)$', timeline_url)
                if match:
                    key = match.group(1)
                else:
                     # Fallback manual construction
                     key = f"ai-videos/{video_id}/timeline/time_based_frame.json"
            else:
                 key = f"ai-videos/{video_id}/timeline/time_based_frame.json"
            
            # Upload
            try:
                self.s3_service.s3_client.upload_file(
                    str(file_path),
                    bucket,
                    key,
                    ExtraArgs={'ContentType': 'application/json'}
                )
                
                # Invalidate CloudFront? (Not handled here, assuming direct S3 usage or short TTL)
                
            except Exception as e:
                logger.error(f"Failed to upload updated timeline: {e}")
                raise RuntimeError(f"Failed to save changes to S3: {e}")
                
            return {
                "status": "success",
                "video_id": video_id,
                "updated_frame_index": frame_index,
                "revision": new_revision,
                "message": "Frame updated successfully. Player should reflect changes immediately."
            }


    async def reorder_video_frame(
        self,
        video_id: str,
        entry_id: str,
        to_index: int,
        expected_revision: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Move a frame to a new positional index in the timeline.

        Looked up by entry_id (the only safe key — positional indices shift
        after every reorder, so a client-provided from_index can race the
        server's view). The entry is spliced from its current position and
        inserted at `to_index`, clamped to [0, len-1]. All other fields
        (html, inTime/exitTime, z, meta.total_duration) are left untouched.

        Atomic on the server side — the timeline JSON is reloaded, modified
        in memory, and re-uploaded as one S3 PUT. No partial-failure window
        where the timeline could end up missing an entry.
        """
        import logging
        logger = logging.getLogger(__name__)

        if not entry_id:
            raise ValueError("entry_id is required for reorder")

        from ..config import get_settings
        with tempfile.TemporaryDirectory() as temp_dir:
            data, entries, _meta, is_wrapped, key, file_path = self._load_timeline(video_id, temp_dir)
            settings = get_settings()
            bucket = settings.aws_bucket_name

            from_index = -1
            for i, e in enumerate(entries):
                if e.get("id") == entry_id:
                    from_index = i
                    break
            if from_index < 0:
                raise ValueError(
                    f"Entry '{entry_id}' not found in video '{video_id}'"
                )

            # Clamp to_index to a valid range. The post-splice length is
            # len(entries) (we re-insert what we just removed), so the
            # valid insert range is [0, len-1].
            clamped_to = max(0, min(to_index, len(entries) - 1))
            if clamped_to == from_index:
                logger.info(
                    "reorder_video_frame: entry %s already at index %d, no-op",
                    entry_id, from_index,
                )
                return {
                    "status": "success",
                    "video_id": video_id,
                    "entry_id": entry_id,
                    "from_index": from_index,
                    "to_index": from_index,
                    "message": "Frame already at target index (no-op).",
                }

            moved = entries.pop(from_index)
            entries.insert(clamped_to, moved)

            if is_wrapped:
                data["entries"] = entries
            else:
                data = entries

            from .timeline_revision import check_and_bump_revision
            new_revision = check_and_bump_revision(data, expected_revision)

            self._save_timeline(data, file_path, bucket, key)

            return {
                "status": "success",
                "video_id": video_id,
                "entry_id": entry_id,
                "from_index": from_index,
                "to_index": clamped_to,
                "revision": new_revision,
                "message": "Frame reordered successfully.",
            }


    async def delete_video_frame(
        self,
        video_id: str,
        entry_id: Optional[str] = None,
        frame_index: Optional[int] = None,
        expected_revision: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Remove a frame from the timeline and save back to S3.

        Lookup precedence:
          1. `entry_id` (preferred — order-independent)
          2. `frame_index` (fallback for callers that only know position)

        meta.total_duration is intentionally NOT recomputed here. Trimming the
        timeline's effective length is a separate concern (the renderer reads
        total_duration to drive the audio mix, and silently shrinking it could
        cut a still-active narration sentence). If the caller wants to shrink,
        they should call /frame/update on remaining entries or update meta
        explicitly.

        meta.sentences[] is also left as-is — sentences are tied to the global
        narration audio, not to entries.
        """
        import logging
        logger = logging.getLogger(__name__)

        if entry_id is None and frame_index is None:
            raise ValueError("Either entry_id or frame_index must be provided.")

        from ..config import get_settings
        with tempfile.TemporaryDirectory() as temp_dir:
            data, entries, meta, is_wrapped, key, file_path = self._load_timeline(video_id, temp_dir)
            settings = get_settings()
            bucket = settings.aws_bucket_name

            removed_idx = -1
            removed_id: Optional[str] = None

            if entry_id is not None:
                for i, e in enumerate(entries):
                    if e.get("id") == entry_id:
                        removed_idx = i
                        removed_id = entry_id
                        break
                if removed_idx < 0 and frame_index is not None:
                    logger.warning(
                        "delete_video_frame: entry_id %s not found, falling back to frame_index %d",
                        entry_id, frame_index,
                    )

            if removed_idx < 0 and frame_index is not None:
                if frame_index < 0 or frame_index >= len(entries):
                    raise IndexError(
                        f"Frame index {frame_index} out of range (0-{len(entries)-1})"
                    )
                removed_idx = frame_index
                removed_id = entries[frame_index].get("id")

            if removed_idx < 0:
                raise ValueError(
                    f"Entry '{entry_id}' not found in video '{video_id}' "
                    "and no fallback frame_index provided."
                )

            entries.pop(removed_idx)

            if is_wrapped:
                data["entries"] = entries
            else:
                data = entries

            from .timeline_revision import check_and_bump_revision
            new_revision = check_and_bump_revision(data, expected_revision)

            self._save_timeline(data, file_path, bucket, key)

            return {
                "status": "success",
                "video_id": video_id,
                "entry_id": removed_id,
                "frame_index": removed_idx,
                "revision": new_revision,
                "message": "Frame deleted successfully.",
            }

    async def add_video_frame(
        self,
        video_id: str,
        html: str,
        in_time: Optional[float],
        exit_time: Optional[float],
        z: int = 0,
        entry_id: Optional[str] = None,
        html_start_x: Optional[int] = None,
        html_start_y: Optional[int] = None,
        html_end_x: Optional[int] = None,
        html_end_y: Optional[int] = None,
        entry_meta: Optional[Dict[str, Any]] = None,
        expected_revision: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Insert a new frame/entry into the video timeline and save back to S3.

        For time_driven videos: in_time and exit_time define when the frame appears.
        For user_driven videos: the frame is appended at the end of the entries array.

        If exit_time exceeds the current meta.total_duration, the meta is updated so
        the renderer extends the video accordingly.

        Returns the new entry's id and its position in the entries array.
        """
        import logging
        logger = logging.getLogger(__name__)

        if in_time is not None and exit_time is not None and in_time >= exit_time:
            raise ValueError(f"in_time ({in_time}) must be less than exit_time ({exit_time})")

        status = self.get_video_status(video_id)
        if not status or "timeline" not in status.get("s3_urls", {}):
            raise ValueError(f"Timeline not found for video {video_id}")

        timeline_url = status["s3_urls"]["timeline"]

        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "time_based_frame.json"

            if not self.s3_service.download_file(timeline_url, file_path):
                raise RuntimeError("Failed to download timeline file")

            data = json.loads(file_path.read_text(encoding='utf-8'))

            # Handle both timeline formats
            is_wrapped = isinstance(data, dict) and "entries" in data
            entries = data["entries"] if is_wrapped else data
            meta = data.get("meta", {}) if is_wrapped else {}

            # Resolve default video dimensions from meta so position keys are always present
            _dims = meta.get("dimensions", {})
            _default_w = int(_dims.get("width", 1920))
            _default_h = int(_dims.get("height", 1080))

            # Build the new entry — always include position keys so _load_timeline validation passes
            new_id = entry_id or f"shot-{uuid4().hex[:8]}"
            _sx = html_start_x if html_start_x is not None else 0
            _sy = html_start_y if html_start_y is not None else 0
            _ex = html_end_x if html_end_x is not None else _default_w
            _ey = html_end_y if html_end_y is not None else _default_h
            new_entry: Dict[str, Any] = {
                "id": new_id,
                "html": html,
                "z": z,
                "htmlStartX": _sx,
                "htmlStartY": _sy,
                "htmlEndX": _ex,
                "htmlEndY": _ey,
            }

            if in_time is not None:
                new_entry["inTime"] = in_time
            if exit_time is not None:
                new_entry["exitTime"] = exit_time

            # Attach entry_meta when the client provided one. Treat the
            # empty-string display_name sentinel as "no override" and skip
            # storing it — same semantic as update_video_frame's merge path.
            if entry_meta is not None and isinstance(entry_meta, dict) and entry_meta:
                clean_meta = dict(entry_meta)
                if "display_name" in clean_meta and clean_meta["display_name"] in (None, ""):
                    clean_meta.pop("display_name", None)
                if clean_meta:
                    new_entry["entry_meta"] = clean_meta

            # Insert sorted by inTime so the timeline stays ordered (time_driven).
            # For user_driven (no inTime), simply append.
            if in_time is not None:
                insert_idx = len(entries)
                for i, e in enumerate(entries):
                    e_in = e.get("inTime", e.get("start", float("inf")))
                    if isinstance(e_in, (int, float)) and e_in > in_time:
                        insert_idx = i
                        break
                entries.insert(insert_idx, new_entry)
                frame_index = insert_idx
            else:
                entries.append(new_entry)
                frame_index = len(entries) - 1

            # Extend meta.total_duration if the new shot goes beyond it
            if exit_time is not None and is_wrapped:
                current_total = meta.get("total_duration") or 0
                if exit_time > current_total:
                    meta["total_duration"] = exit_time
                    data["meta"] = meta

            # Write back
            if is_wrapped:
                data["entries"] = entries
            else:
                data = entries

            from .timeline_revision import check_and_bump_revision
            new_revision = check_and_bump_revision(data, expected_revision)

            file_path.write_text(json.dumps(data, indent=2), encoding='utf-8')

            # Extract S3 key (same logic as update_video_frame)
            from ..config import get_settings
            settings = get_settings()
            bucket = settings.aws_bucket_name

            if f"/{bucket}/" in timeline_url:
                key = timeline_url.split(f"/{bucket}/")[-1]
            elif f"{bucket}.s3" in timeline_url:
                match = re.search(r'\.com/(.+)$', timeline_url)
                key = match.group(1) if match else f"ai-videos/{video_id}/timeline/time_based_frame.json"
            else:
                key = f"ai-videos/{video_id}/timeline/time_based_frame.json"

            try:
                self.s3_service.s3_client.upload_file(
                    str(file_path),
                    bucket,
                    key,
                    ExtraArgs={'ContentType': 'application/json'}
                )
            except Exception as e:
                logger.error(f"Failed to upload updated timeline: {e}")
                raise RuntimeError(f"Failed to save new frame to S3: {e}")

            return {
                "status": "success",
                "video_id": video_id,
                "entry_id": new_id,
                "frame_index": frame_index,
                "revision": new_revision,
                "message": "Frame added successfully.",
            }

    # ── Audio track helpers ──────────────────────────────────────────────────

    def _load_timeline(self, video_id: str, temp_dir: str):
        """Download timeline JSON and return (data, entries, meta, is_wrapped, key)."""
        import re as _re
        from ..config import get_settings
        import logging as _logging
        logger = _logging.getLogger(__name__)

        status = self.get_video_status(video_id)
        if not status or "timeline" not in status.get("s3_urls", {}):
            raise ValueError(f"Timeline not found for video {video_id}")

        timeline_url = status["s3_urls"]["timeline"]
        file_path = Path(temp_dir) / "time_based_frame.json"

        if not self.s3_service.download_file(timeline_url, file_path):
            raise RuntimeError("Failed to download timeline file")

        data = json.loads(file_path.read_text(encoding='utf-8'))
        is_wrapped = isinstance(data, dict) and "entries" in data
        entries = data["entries"] if is_wrapped else data
        meta = data.get("meta", {}) if is_wrapped else {}

        settings = get_settings()
        bucket = settings.aws_bucket_name
        if f"/{bucket}/" in timeline_url:
            key = timeline_url.split(f"/{bucket}/")[-1]
        elif f"{bucket}.s3" in timeline_url:
            match = _re.search(r'\.com/(.+)$', timeline_url)
            key = match.group(1) if match else f"ai-videos/{video_id}/timeline/time_based_frame.json"
        else:
            key = f"ai-videos/{video_id}/timeline/time_based_frame.json"

        return data, entries, meta, is_wrapped, key, file_path

    def _save_timeline(self, data, file_path: Path, bucket: str, key: str):
        """Serialize timeline data and upload to S3."""
        import logging as _logging
        logger = _logging.getLogger(__name__)
        file_path.write_text(json.dumps(data, indent=2), encoding='utf-8')
        try:
            self.s3_service.s3_client.upload_file(
                str(file_path), bucket, key,
                ExtraArgs={'ContentType': 'application/json'}
            )
        except Exception as e:
            logger.error(f"Failed to upload timeline: {e}")
            raise RuntimeError(f"Failed to save timeline to S3: {e}")

    async def add_audio_track(
        self,
        video_id: str,
        label: str,
        url: str,
        volume: float = 1.0,
        delay: float = 0.0,
        fade_in: float = 0.0,
        fade_out: float = 0.0,
        track_id: Optional[str] = None,
        loop: bool = False,
    ) -> Dict[str, Any]:
        """Insert a new audio track into meta.audio_tracks and save back to S3."""
        from ..config import get_settings
        with tempfile.TemporaryDirectory() as temp_dir:
            data, entries, meta, is_wrapped, key, file_path = self._load_timeline(video_id, temp_dir)
            settings = get_settings()
            bucket = settings.aws_bucket_name

            new_id = track_id or f"track-{uuid4().hex[:8]}"
            new_track = {
                "id": new_id, "label": label, "url": url,
                "volume": volume, "delay": delay, "fadeIn": fade_in, "fadeOut": fade_out,
                "loop": bool(loop),
            }

            if is_wrapped:
                tracks = meta.get("audio_tracks", [])
                tracks.append(new_track)
                meta["audio_tracks"] = tracks
                data["meta"] = meta
            else:
                # Upgrade plain array to wrapped format so we can store meta
                data = {"entries": entries, "meta": {"audio_tracks": [new_track]}}

            self._save_timeline(data, file_path, bucket, key)
            return {"status": "success", "video_id": video_id, "track_id": new_id, "message": "Audio track added."}

    async def update_audio_track(
        self,
        video_id: str,
        track_id: str,
        label: Optional[str] = None,
        url: Optional[str] = None,
        volume: Optional[float] = None,
        delay: Optional[float] = None,
        fade_in: Optional[float] = None,
        fade_out: Optional[float] = None,
        loop: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Update an existing audio track in meta.audio_tracks."""
        from ..config import get_settings
        with tempfile.TemporaryDirectory() as temp_dir:
            data, entries, meta, is_wrapped, key, file_path = self._load_timeline(video_id, temp_dir)
            settings = get_settings()
            bucket = settings.aws_bucket_name

            if not is_wrapped:
                raise ValueError(f"Timeline for {video_id} has no meta section — track not found.")

            tracks = meta.get("audio_tracks", [])
            track = next((t for t in tracks if t.get("id") == track_id), None)
            if not track:
                raise ValueError(f"Audio track '{track_id}' not found in video '{video_id}'")

            if label is not None:
                track["label"] = label
            if url is not None:
                track["url"] = url
            if volume is not None:
                track["volume"] = volume
            if delay is not None:
                track["delay"] = delay
            if fade_in is not None:
                track["fadeIn"] = fade_in
            if fade_out is not None:
                track["fadeOut"] = fade_out
            if loop is not None:
                track["loop"] = bool(loop)

            data["meta"] = meta
            self._save_timeline(data, file_path, bucket, key)
            return {"status": "success", "video_id": video_id, "track_id": track_id, "message": "Audio track updated."}

    async def delete_audio_track(self, video_id: str, track_id: str) -> Dict[str, Any]:
        """Remove an audio track from meta.audio_tracks and save back to S3."""
        from ..config import get_settings
        with tempfile.TemporaryDirectory() as temp_dir:
            data, entries, meta, is_wrapped, key, file_path = self._load_timeline(video_id, temp_dir)
            settings = get_settings()
            bucket = settings.aws_bucket_name

            if not is_wrapped:
                raise ValueError(f"Timeline for {video_id} has no meta section — track not found.")

            tracks = meta.get("audio_tracks", [])
            new_tracks = [t for t in tracks if t.get("id") != track_id]
            if len(new_tracks) == len(tracks):
                raise ValueError(f"Audio track '{track_id}' not found in video '{video_id}'")

            meta["audio_tracks"] = new_tracks
            data["meta"] = meta
            self._save_timeline(data, file_path, bucket, key)
            return {"status": "success", "video_id": video_id, "track_id": track_id, "message": "Audio track deleted."}

    def get_institute_generations(self, institute_id: str, limit: int = 10, offset: int = 0) -> list[Dict[str, Any]]:
        """
        Get the last N content generations for an institute.

        Args:
            institute_id: Institute identifier
            limit: Maximum number of records to return
            offset: Number of records to skip (for pagination)

        Returns:
            List of video generation records as dictionaries
        """
        records = self.repository.get_history_by_institute(
            institute_id=institute_id,
            limit=limit,
            offset=offset
        )
        return [record.to_dict() for record in records]
