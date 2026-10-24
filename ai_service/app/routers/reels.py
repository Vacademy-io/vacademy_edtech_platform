"""
Router for the Reels-from-Long-Video pipeline.

Three-gate funnel (see REELS_FROM_VIDEO plan §3):
  POST /external/reels/v1/scan       — Gate 1, heuristic scoring, free
  POST /external/reels/v1/preview    — Gate 2, cheap LLM enrichment (Phase 2)
  POST /external/reels/v1/render     — Gate 3, full render (Phase 2)
  GET  /external/reels/v1/{id}
  GET  /external/reels/v1/{id}/status
  GET  /external/reels/v1/list
  DELETE /external/reels/v1/{id}

This file implements Gate 1 fully. Gates 2 + 3 ship in subsequent slices.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Any, List, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import db_dependency
from ..dependencies import get_institute_from_api_key
from ..models.ai_input_asset import AiInputAsset
from ..repositories.ai_input_asset_repository import AiInputAssetRepository
from ..repositories.ai_reel_repository import (
    AiReelCandidateRepository,
    AiReelRepository,
)
from uuid import uuid4
from ..schemas.reels import (
    AddReelFrameRequest,
    CutSpan,
    DeleteReelFrameRequest,
    EnrichedCandidate,
    PreviewRequest,
    PreviewResponse,
    ReelCandidate,
    ReelFrameResponse,
    ReelResponse,
    ReelStatusResponse,
    RenderRequest,
    ScanRequest,
    ScanResponse,
    ScoreAxes,
    ScoreBreakdown,
    StageProgress,
    UpdateReelFrameRequest,
    WordImportance,
)
from ..config import get_settings
from ..services.use_case_chat import models_for
from ..services.reels_engagement_service import (
    ScoringRequest,
    score_windows,
    window_transcript_text,
)
from ..services.reels_preview_service import (
    MAX_USER_CUT_SPAN_S,
    MIN_CUT_SPAN_S,
    ReelsPreviewService,
    preview_models,
)
from ..services.reels_rerank_service import (
    MAX_SELECTION_WINDOWS,
    SELECTION_USE_CASE,
    apply_selection,
    select_top_candidates,
)
from ..services.reels_render_orchestrator import (
    RenderContext,
    dispatch_render,
    register_all_stages,
)
from ..services.reels_thumbnail_service import ReelsThumbnailService

# Install real stage handlers on top of the orchestrator's no-op defaults.
# `register_all_stages()` imports every stage module — adding a new stage
# means updating ONE place (the helper in the orchestrator) instead of
# duplicating import lines here.
register_all_stages()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/external/reels/v1", tags=["reels"])


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# How many top-ranked candidates get a thumbnail generated in the background
# after /scan returns. Higher = more polish, more compute per scan.
THUMBNAIL_TOP_N = 15

# Timeout for fetching video_context.json from S3. The artifact is small
# (~1-2 MB for a 1hr source) so 20s is generous.
CONTEXT_FETCH_TIMEOUT_S = 20

# Hard cap on the fetched video_context.json size. Real files are 1-2MB for
# a 1hr source; 10MB is 10× headroom. Beyond this, treat as corrupt/hostile
# rather than OOM the worker.
CONTEXT_FETCH_MAX_BYTES = 10 * 1024 * 1024

# Per-candidate token estimates used for /preview credit pre-flight + deduct.
# Numbers calibrated against actual Haiku roundtrips on a 24s podcast clip
# (transcript window + system prompt ≈ 1500 prompt tokens; title+rationale+
# word_importance JSON ≈ 500 completion tokens). Real usage can drift; we
# accept that — it's a fixed estimate by design, not a per-call meter.
_PREVIEW_PROMPT_TOKENS = 1500
_PREVIEW_COMPLETION_TOKENS = 500
# Pricing tier driver: the first model of the /preview chain
# (`reels_preview_service.preview_models()` — env override, else the
# 'reels_preview' use case). A wrong value means credits get costed at the
# wrong tier, not a functional break.

# /scan LLM selection. The heuristic scorer is a PREFILTER that hands this
# many diverse windows (full transcripts attached) to one LLM call, which
# hard-selects + orders the final request.scan_limit the user sees. The
# prefilter list is a prefix-stable superset: `_diversify` picks greedily,
# so its first scan_limit picks are identical whether keep_n is scan_limit
# or this cap — the heuristic fallback is exactly the old /scan result.
_SELECTION_PREFILTER_CAP = MAX_SELECTION_WINDOWS  # 60
# Model comes from the DB registry (ai_model_defaults 'reels_selection', set
# in the super-admin portal) so ops can retune without a deploy; with no row
# the chain is the platform default (GLM) + the non-GLM tail. The call goes
# through llm_router.chat_with_chain, which gives GLM reasoning effort low and
# a max_tokens allowance on both gateway legs. REELS_SELECTION_LLM_MODEL, when
# set, is tried first (emergency override).
_SELECTION_USE_CASE = SELECTION_USE_CASE
_SELECTION_LLM_MODEL_ENV = "REELS_SELECTION_LLM_MODEL"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _config_hash(input_asset_id: str, req: ScanRequest) -> str:
    """Idempotency key for the /scan cache. Stable across equivalent requests."""
    payload = {
        "input_asset_id": input_asset_id,
        "target_duration_sec": req.target_duration_sec,
        "duration_tolerance_sec": req.duration_tolerance_sec,
        "scan_limit": req.scan_limit,
        "aspect": req.aspect,
        "topic_keywords": sorted(k.lower().strip() for k in (req.topic_keywords or [])),
        "must_include_ranges": sorted(
            [r.t_start, r.t_end] for r in (req.must_include_ranges or [])
        ),
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


# Cut-plan override validation knobs (Phase 2 B3). Hoisted module-level so
# tests can introspect and the validator stays callable in isolation.
_CUT_OVERRIDE_MAX_TOTAL_FRACTION = 0.40
# PB3 (2026-05-22): tolerate small float-precision drift on window bounds —
# a FE-built span from word.t_end may land at 23.999999998 while the
# candidate stored 24.0 (or vice-versa). 1ms is well below MIN_CUT_SPAN_S
# (0.08s) so it can't mask a real issue.
_CUT_OVERRIDE_BOUNDARY_EPS = 1e-3


def _validate_cut_plan_overrides(
    overrides: list[CutSpan],
    source_window: dict,
    enriched_snapshot: Optional[dict],
) -> list[dict]:
    """Validate FE-supplied user-toggled cuts against window bounds and the
    enriched payload's protected (importance>=2) words. On success, returns
    a sorted list of cut dicts ready to merge into `enriched_snapshot.cut_plan`.

    Validation contract (raises HTTPException 400 with a specific message on
    the first violation found):
      * Each span: kind=='user', MIN_CUT_SPAN_S <= duration <= MAX_USER_CUT_SPAN_S
      * Span lies entirely within source_window (±BOUNDARY_EPS for float slop)
      * Overrides don't overlap each other
      * No override overlaps any word with importance >= 2
      * Total override duration <= 40% of window duration
    """
    if not overrides:
        return []

    win_start = float(source_window.get("t_start", 0.0))
    win_end = float(source_window.get("t_end", 0.0))
    win_duration = win_end - win_start
    if win_duration <= 0:
        raise HTTPException(
            status_code=400,
            detail="cut_plan_overrides: source_window is invalid",
        )

    sorted_overrides = sorted(overrides, key=lambda c: c.t_start)
    total_duration = 0.0
    prev_end = float("-inf")
    for i, span in enumerate(sorted_overrides):
        if span.kind != "user":
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: kind must be 'user', "
                    f"got '{span.kind}'"
                ),
            )
        dur = span.t_end - span.t_start
        if dur < MIN_CUT_SPAN_S:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: duration {dur:.3f}s is below "
                    f"MIN_CUT_SPAN_S ({MIN_CUT_SPAN_S}s)"
                ),
            )
        if dur > MAX_USER_CUT_SPAN_S:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: duration {dur:.3f}s exceeds "
                    f"MAX_USER_CUT_SPAN_S ({MAX_USER_CUT_SPAN_S}s)"
                ),
            )
        # PB3: epsilon tolerance on window bounds to absorb float drift.
        if (
            span.t_start < win_start - _CUT_OVERRIDE_BOUNDARY_EPS
            or span.t_end > win_end + _CUT_OVERRIDE_BOUNDARY_EPS
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: span "
                    f"[{span.t_start:.3f}, {span.t_end:.3f}] is outside "
                    f"source_window [{win_start:.3f}, {win_end:.3f}]"
                ),
            )
        if span.t_start < prev_end:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: span "
                    f"[{span.t_start:.3f}, {span.t_end:.3f}] overlaps a "
                    f"prior override"
                ),
            )
        prev_end = span.t_end
        total_duration += dur

    max_total = win_duration * _CUT_OVERRIDE_MAX_TOTAL_FRACTION
    if total_duration > max_total:
        raise HTTPException(
            status_code=400,
            detail=(
                f"cut_plan_overrides: total duration {total_duration:.3f}s "
                f"exceeds {int(_CUT_OVERRIDE_MAX_TOTAL_FRACTION * 100)}% of "
                f"window ({max_total:.3f}s) — re-scan with different params instead"
            ),
        )

    # Protected-word check: word_importance comes from /preview enrichment.
    # If the candidate was never enriched (legacy / pre-Preview path), we
    # skip this check rather than reject — those reels lack importance data
    # so we can't validate. The FE shouldn't allow Edit-cuts mode without
    # enrichment, but we don't enforce it server-side.
    word_importance = (enriched_snapshot or {}).get("word_importance") or []
    for i, span in enumerate(sorted_overrides):
        for w in word_importance:
            try:
                w_start = float(w.get("t_start", 0.0))
                w_end = float(w.get("t_end", 0.0))
                w_imp = int(w.get("importance", 2))
            except (TypeError, ValueError):
                continue
            if w_imp < 2:
                continue
            if w_end <= span.t_start or w_start >= span.t_end:
                continue
            raise HTTPException(
                status_code=400,
                detail=(
                    f"cut_plan_overrides[{i}]: span "
                    f"[{span.t_start:.3f}, {span.t_end:.3f}] overlaps "
                    f"protected word '{w.get('word', '?')}' "
                    f"(importance={w_imp})"
                ),
            )

    return [
        {
            "t_start": span.t_start,
            "t_end": span.t_end,
            "kind": "user",
        }
        for span in sorted_overrides
    ]


def _render_config_hash(req: RenderRequest) -> str:
    """Stable hash of a /render request body — drives idempotent dedup.

    Two POSTs with identical config + candidate produce the same hash. The
    /render handler uses this to find any already-in-flight reel for the
    same (institute, candidate, hash) before creating a new one. A user
    double-click on "Render this clip" thus maps to one reel row + one
    background task, not two.

    Excludes `input_asset_id` because the candidate's FK already pins it.
    Uses pydantic's dump (with mode='json') so Literal types serialize
    consistently with how they're stored in `AiReel.config`.
    """
    body = req.model_dump(mode="json", exclude={"input_asset_id"})
    serialized = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


async def _fetch_context_json(context_url: str) -> dict:
    """Fetch video_context.json from S3 and parse. Streams with a hard size
    cap so a corrupt/hostile artifact can't OOM the worker.

    Raises HTTPException on any failure (network, oversize, malformed JSON).
    """
    if not context_url:
        raise HTTPException(
            status_code=409,
            detail="Source asset has no context_json_url — indexing may not have completed.",
        )
    try:
        async with httpx.AsyncClient(timeout=CONTEXT_FETCH_TIMEOUT_S) as client:
            async with client.stream("GET", context_url) as resp:
                resp.raise_for_status()
                # Early reject if the server reports a too-large content-length.
                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > CONTEXT_FETCH_MAX_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Indexed metadata is implausibly large "
                            f"({int(declared) // (1024 * 1024)}MB > "
                            f"{CONTEXT_FETCH_MAX_BYTES // (1024 * 1024)}MB cap)."
                        ),
                    )
                buf = bytearray()
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    buf.extend(chunk)
                    if len(buf) > CONTEXT_FETCH_MAX_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                f"Indexed metadata exceeded "
                                f"{CONTEXT_FETCH_MAX_BYTES // (1024 * 1024)}MB cap during download — "
                                f"likely a corrupt artifact."
                            ),
                        )
                return json.loads(bytes(buf))
    except HTTPException:
        raise
    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch video_context.json from {context_url}: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch indexed metadata for source asset: {e}",
        )
    except json.JSONDecodeError as e:
        logger.error(f"video_context.json at {context_url} is not valid JSON: {e}")
        raise HTTPException(
            status_code=502,
            detail="Indexed metadata for source asset is corrupt.",
        )


def _validate_source_asset(asset: Optional[AiInputAsset], institute_id: str) -> AiInputAsset:
    """Common preconditions: exists, belongs to caller, completed video, podcast mode.

    Phase 1 only supports podcast-mode sources. Demo-mode (screen recordings)
    lacks face_segments, prosody signals, and clean transcript structure that
    the scorer was tuned for — letting it through would produce uniformly
    poor candidates that frustrate users. Better to surface the limitation
    explicitly.
    """
    if asset is None or asset.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Input asset not found")
    if asset.kind != "video":
        raise HTTPException(
            status_code=400,
            detail=f"Reels can only be made from video assets (got kind={asset.kind!r})",
        )
    if asset.status != "COMPLETED":
        raise HTTPException(
            status_code=409,
            detail=f"Source asset is not ready (status={asset.status!r}). Wait for indexing to complete.",
        )
    if asset.mode != "podcast":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Reels are only supported for podcast-mode sources in this release "
                f"(got mode={asset.mode!r}). Re-index this asset with mode='podcast' "
                f"if it's talking-head footage."
            ),
        )
    return asset


async def _populate_thumbnails(
    source_url: str,
    candidate_ids_and_midpoints: list[tuple[str, float]],
) -> None:
    """Background task: generate thumbnails for top-N and patch the rows.

    Errors are swallowed — thumbnails are non-essential.
    """
    if not candidate_ids_and_midpoints:
        return
    try:
        thumb_svc = ReelsThumbnailService()
        results = await thumb_svc.generate_batch(source_url, candidate_ids_and_midpoints)
    except Exception as e:
        logger.warning(f"Thumbnail batch failed: {e}")
        return

    if not any(results.values()):
        return

    repo = AiReelCandidateRepository()
    for cid, url in results.items():
        if not url:
            continue
        try:
            repo.set_thumbnail(cid, url)
        except Exception as e:
            logger.warning(f"Persist thumbnail URL failed for {cid}: {e}")


# ---------------------------------------------------------------------------
# POST /scan — Gate 1
# ---------------------------------------------------------------------------

@router.post("/scan", response_model=ScanResponse)
async def scan_reel_candidates(
    request: ScanRequest,
    background_tasks: BackgroundTasks,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Gate 1: score candidate reel windows over an indexed source video.

    Returns ranked candidates with 4-axis scores. Sub-second on a warm
    cache. A cold scan downloads + heuristic-prefilters the source, then
    makes ONE cheap LLM call that selects + orders the final top-N from the
    prefilter (heuristic order is the fallback) — expect seconds, bounded
    by the selection timeout. Thumbnails for the top candidates are
    generated asynchronously and appear on a subsequent /scan call
    (idempotent via config_hash).
    """
    # 1. Validate the source asset.
    asset_repo = AiInputAssetRepository(session=db)
    asset = asset_repo.get_by_id(request.input_asset_id)
    asset = _validate_source_asset(asset, institute_id)

    # 2. Compute the idempotency key.
    cfg_hash = _config_hash(request.input_asset_id, request)

    # 3. Cache hit?
    candidate_repo = AiReelCandidateRepository(session=db)
    cached = candidate_repo.find_cached(request.input_asset_id, cfg_hash)
    if cached:
        candidates = [_candidate_row_to_response(row) for row in cached]
        return ScanResponse(
            input_asset_id=request.input_asset_id,
            config_hash=cfg_hash,
            candidates=candidates,
            total_returned=len(cached),
            cache_ttl_seconds=3600,
        )

    # 4. Cold scan: fetch context, score, persist.
    cold_scan_t0 = time.monotonic()
    context = await _fetch_context_json(asset.context_json_url or "")

    scoring_req = ScoringRequest(
        target_duration_sec=request.target_duration_sec,
        duration_tolerance_sec=request.duration_tolerance_sec,
        # Prefilter wide: the LLM selection below picks the final
        # request.scan_limit out of this superset (see the constant's note
        # on prefix stability — truncating this list to scan_limit IS the
        # legacy pure-heuristic result).
        scan_limit=max(request.scan_limit, _SELECTION_PREFILTER_CAP),
        topic_keywords=tuple(request.topic_keywords or ()),
        must_include_ranges=tuple(
            (r.t_start, r.t_end) for r in (request.must_include_ranges or [])
        ),
    )

    scored = score_windows(context, scoring_req)
    if not scored:
        # No usable windows — return empty result rather than 500. FE will
        # show "We couldn't find good clips" with the option to relax filters.
        return ScanResponse(
            input_asset_id=request.input_asset_id,
            config_hash=cfg_hash,
            candidates=[],
            total_returned=0,
            cache_ttl_seconds=3600,
        )

    # LLM selection pass: the heuristic list above is a prefilter. One
    # cheap/fast LLM call reads every window's FULL transcript (plus the
    # request's real target duration + topic keywords) and hard-selects +
    # orders the final request.scan_limit. The heuristic order is the
    # fallback whenever the call fails, times out, or returns garbage —
    # selection never blocks /scan.
    selected = None
    try:
        settings = get_settings()
        if settings.openrouter_api_key and len(scored) > 1:
            transcript = context.get("transcript") or []
            selection_input = [
                {
                    "id": f"c{i}",
                    # Un-elided in-window text; the 140-char display snippet
                    # is the fallback for word-timestamp-less sources.
                    "transcript": (
                        window_transcript_text(
                            transcript, cs.source_t_start, cs.source_t_end
                        )
                        or cs.transcript_snippet
                    ),
                    "t_start": cs.source_t_start,
                    "t_end": cs.source_t_end,
                    "predicted_duration_s": cs.predicted_output_duration_s,
                    "scores": {
                        "hook": cs.score.hook,
                        "pacing": cs.score.pacing,
                        "info": cs.score.info,
                        "loop": cs.score.loop,
                        "topic": cs.score.topic,
                        "composite": cs.score.composite,
                    },
                }
                for i, cs in enumerate(scored)
            ]
            models = models_for(_SELECTION_USE_CASE, env=_SELECTION_LLM_MODEL_ENV, db=db)
            model = models[0]
            llm_t0 = time.monotonic()
            ordered = await select_top_candidates(
                candidates=selection_input,
                select_n=request.scan_limit,
                target_duration_sec=request.target_duration_sec,
                topic_keywords=tuple(request.topic_keywords or ()),
                api_key=settings.openrouter_api_key,
                models=models,
            )
            llm_elapsed = time.monotonic() - llm_t0
            if ordered:
                selected = apply_selection(scored, ordered, request.scan_limit) or None
            if selected:
                logger.info(
                    f"[reels.scan] LLM selection: {len(selected)}/{len(scored)} "
                    f"windows in {llm_elapsed:.1f}s (model={model})"
                )
            else:
                logger.warning(
                    f"[reels.scan] LLM selection unusable after {llm_elapsed:.1f}s "
                    f"(model={model}) — heuristic order stands"
                )
    except Exception as exc:
        # Selection is best-effort. Never block /scan on failure — the
        # heuristic ranking stands. Log but don't raise.
        logger.warning(f"[reels.scan] LLM selection failed: {exc}")
    if selected:
        scored = selected
    else:
        # Pure-heuristic fallback. Ranks already run 1..N in list order, so
        # truncation preserves a contiguous 1..scan_limit ranking.
        scored = scored[: request.scan_limit]

    # Persist rows so /preview and /render can reference them by id.
    rows = [
        {
            "rank": cs.rank,
            "source_t_start": cs.source_t_start,
            "source_t_end": cs.source_t_end,
            "source_duration_s": cs.source_duration_s,
            "predicted_output_duration_s": cs.predicted_output_duration_s,
            "score": {
                "hook": cs.score.hook,
                "pacing": cs.score.pacing,
                "info": cs.score.info,
                "loop": cs.score.loop,
                "topic": cs.score.topic,
                "composite": cs.score.composite,
            },
            "breakdown": {
                **(cs.score.breakdown or {}),
                # /preview replays the scan's exact targeting + keywords —
                # the candidate row is the only artifact that survives
                # between /scan and /preview, so the request knobs ride
                # along here. Not exposed to the FE: the breakdown
                # whitelist in `_candidate_row_to_response` filters it out.
                "scan_config": {
                    "target_duration_sec": request.target_duration_sec,
                    "duration_tolerance_sec": request.duration_tolerance_sec,
                    "topic_keywords": list(request.topic_keywords or []),
                },
            },
            "transcript_snippet": cs.transcript_snippet,
            "thumbnail_strip_url": None,
        }
        for cs in scored
    ]
    persisted = candidate_repo.bulk_create(
        institute_id=institute_id,
        input_asset_id=request.input_asset_id,
        config_hash=cfg_hash,
        rows=rows,
    )

    # 5. Schedule background thumbnail generation for top-N.
    # Use the public assets_urls.source_video if present — it's a browser-
    # compatible re-encode produced by the indexer. Fall back to source_url
    # (the user's original upload) if not.
    source_url_for_thumbs = (
        (asset.assets_urls or {}).get("source_video")
        or asset.source_url
    )
    if source_url_for_thumbs:
        top_n = persisted[:THUMBNAIL_TOP_N]
        midpoints = [
            (str(row.id), (row.source_t_start + row.source_t_end) / 2.0)
            for row in top_n
        ]
        background_tasks.add_task(
            _populate_thumbnails, source_url_for_thumbs, midpoints
        )

    # 6. Build response. The duration log is the latency budget watchdog —
    # the LLM selection turned a sub-second endpoint into a multi-second
    # one, and this line is how ops sees that creep past the FE's patience.
    logger.info(
        f"[reels.scan] cold scan done in {time.monotonic() - cold_scan_t0:.1f}s "
        f"(returned={len(persisted)}, llm_selected={bool(selected)})"
    )
    response_candidates = [_candidate_row_to_response(row) for row in persisted]
    return ScanResponse(
        input_asset_id=request.input_asset_id,
        config_hash=cfg_hash,
        candidates=response_candidates,
        total_returned=len(response_candidates),
        cache_ttl_seconds=3600,
    )


def _candidate_row_to_response(row) -> ReelCandidate:
    """ai_reel_candidates row → ReelCandidate response model."""
    score_dict = row.score or {}
    bd_dict = row.breakdown or {}
    axes = ScoreAxes(
        hook=score_dict.get("hook", 0.0),
        pacing=score_dict.get("pacing", 0.0),
        info=score_dict.get("info", 0.0),
        loop=score_dict.get("loop", 0.0),
        # A3: legacy rows from before topic axis won't have it — default 0
        # so they parse, but their composite was already computed without it.
        topic=score_dict.get("topic", 0.0),
        composite=score_dict.get("composite", 0.0),
    )
    breakdown = ScoreBreakdown(**{
        k: bd_dict.get(k) for k in (
            "opener_quality", "energy_first_2_5s", "first_sentence_complete",
            "silence_fraction", "emphasis_density", "predicted_after_silence_s",
            "unique_content_words_per_s", "numeric_token_count",
            "first_last_mfcc_similarity", "has_verbal_cta_end",
            "word_cut_savings_needed_s", "word_cut_savings_pct",
            "speaker_moves_in_window",
            # End-quality (Issue 4A — added 2026-05-21)
            "end_quality_score", "end_last_word", "end_terminator",
            "start_first_word", "start_bad_opener",
            # A5 — dead-zone diagnostic (added 2026-05-22)
            "face_coverage_fraction",
            # A4 — info-density ratio (added 2026-05-22)
            "info_density_ratio",
            # A2 — LLM rerank reason + factor (added 2026-05-22)
            "llm_rerank_factor", "llm_rerank_reason",
            # A3 — topic-coherence diagnostics (added 2026-05-22)
            "topic_top5_share", "topic_top_token",
        )
    })
    return ReelCandidate(
        candidate_id=str(row.id),
        rank=row.rank,
        source_t_start=row.source_t_start,
        source_t_end=row.source_t_end,
        source_duration_s=row.source_duration_s,
        predicted_output_duration_s=row.predicted_output_duration_s,
        score=axes,
        breakdown=breakdown,
        transcript_snippet=row.transcript_snippet or "",
        thumbnail_strip_url=row.thumbnail_strip_url,
        low_confidence=axes.composite < 60,
    )


def _enriched_dict_to_response(candidate_id: str, enriched: dict) -> EnrichedCandidate:
    """Map persisted `enriched` JSONB → EnrichedCandidate response model."""
    words = [
        WordImportance(
            word=str(w.get("word", "")),
            t_start=float(w.get("t_start", 0.0)),
            t_end=float(w.get("t_end", 0.0)),
            importance=int(w.get("importance", 2)),
            keyword_type=w.get("keyword_type"),
            emoji=w.get("emoji"),
        )
        for w in (enriched.get("word_importance") or [])
        if isinstance(w, dict)
    ]
    cuts = [
        CutSpan(
            t_start=float(c.get("t_start", 0.0)),
            t_end=float(c.get("t_end", 0.0)),
            kind=c.get("kind", "word"),
        )
        for c in (enriched.get("cut_plan") or [])
        if isinstance(c, dict)
    ]
    return EnrichedCandidate(
        candidate_id=candidate_id,
        method=enriched.get("method"),
        title=str(enriched.get("title") or "Untitled"),
        rationale=str(enriched.get("rationale") or ""),
        word_importance=words,
        cut_plan=cuts,
        predicted_output_duration_s=float(enriched.get("predicted_output_duration_s") or 0.0),
        transcript_corrections=enriched.get("transcript_corrections") or [],
    )


# ---------------------------------------------------------------------------
# POST /preview — Gate 2
# ---------------------------------------------------------------------------

@router.post("/preview", response_model=PreviewResponse)
async def preview_reel_candidates(
    request: PreviewRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Gate 2: enrich N user-picked scan candidates with title + rationale +
    word-importance + cut-plan. One Haiku-class LLM call per candidate
    (skipped if the candidate is already enriched within its TTL).

    Returns one EnrichedCandidate per requested candidate_id. Order matches
    request order. If a candidate id is unknown or doesn't belong to the
    caller's institute, that entry is silently dropped — partial responses
    are allowed.
    """
    if not request.candidate_ids:
        return PreviewResponse(enriched=[])

    candidate_repo = AiReelCandidateRepository(session=db)
    rows = candidate_repo.get_by_ids(request.candidate_ids)

    # Filter to the caller's institute + the asset they specified. Silent
    # drop on mismatch — we don't want to leak existence of other institutes'
    # candidates via different status codes.
    rows = [
        r for r in rows
        if r.institute_id == institute_id
        and str(r.input_asset_id) == request.input_asset_id
    ]
    if not rows:
        return PreviewResponse(enriched=[])

    # Cache-hit predicate. We treat ONLY enrichments with `method == "llm"`
    # as valid cache hits. `heuristic_fallback` rows are cache MISSES — the
    # LLM was unavailable at the time of the original /preview (transient
    # OpenRouter outage, transient model parse error, etc.) and we should
    # retry on every subsequent /preview until the LLM succeeds. Without
    # this, a single transient failure poisons the candidate's enrichment
    # forever — every /render off it ships with the garbage fallback title
    # ("a there was a person you") + empty cut_plan + zero keyword tags.
    # The audited reel-9ad0255f2bb6 is exactly this case.
    def _needs_llm_enrich(r) -> bool:
        if not r.enriched:
            return True
        return (r.enriched or {}).get("method") != "llm"

    # Pre-flight credit gate. The LLM-burning subset is rows that need a
    # fresh LLM call — null-enriched rows + cached heuristic-fallback rows.
    # We charge for the rows that WILL hit the network. Estimate
    # ~_PREVIEW_PROMPT_TOKENS prompt + ~_PREVIEW_COMPLETION_TOKENS completion
    # per candidate; under-estimating costs the user nothing extra (the
    # deduct path uses the same numbers), over-estimating means they'd get
    # a misleading "insufficient credits" message.
    miss_count = sum(1 for r in rows if _needs_llm_enrich(r))
    # Priced at the model the enrichment chain tries first.
    preview_pricing_model = preview_models()[0] if miss_count > 0 else ""
    if miss_count > 0:
        from ..services.credit_service import CreditService
        from ..schemas.credits import CreditCheckRequest
        estimate_tokens = miss_count * (_PREVIEW_PROMPT_TOKENS + _PREVIEW_COMPLETION_TOKENS)
        credit_check = CreditService(db).check_credits(CreditCheckRequest(
            institute_id=institute_id,
            request_type="reels_preview",
            model=preview_pricing_model,
            estimated_tokens=estimate_tokens,
        ))
        if not credit_check.has_sufficient_credits:
            raise HTTPException(status_code=402, detail=credit_check.message)

    # We need the source's video_context.json for word-level data + emphasis
    # marks. Fetch ONCE per /preview call regardless of how many candidates.
    asset_repo = AiInputAssetRepository(session=db)
    asset = asset_repo.get_by_id(request.input_asset_id)
    asset = _validate_source_asset(asset, institute_id)
    context = await _fetch_context_json(asset.context_json_url or "")

    # Target / tolerance / topic_keywords come from the `scan_config` blob
    # the /scan handler persists into each candidate's breakdown. Legacy
    # rows (created before scan_config existed) fall back to the
    # candidate's own predicted duration as the target with the scan-
    # default 3s tolerance and no keywords.
    preview_svc = ReelsPreviewService()

    # Split rows into cache hits (cheap, sync) and misses (need LLM).
    # Each row carries its index so we can reassemble in request order.
    # `_needs_llm_enrich` matches the credit-gate predicate above — a
    # cached `heuristic_fallback` row counts as a miss so we retry.
    cache_hits: list[tuple[int, EnrichedCandidate]] = []
    miss_rows: list[tuple[int, Any]] = []
    for i, row in enumerate(rows):
        if _needs_llm_enrich(row):
            miss_rows.append((i, row))
        else:
            cache_hits.append((i, _enriched_dict_to_response(str(row.id), row.enriched)))

    # Run all cache-miss enrichments concurrently. Each candidate is an
    # independent LLM call + DB write; gathering parallelizes the LLM hops
    # (the slow part) so p95 doesn't grow linearly with picks.
    async def _enrich_one(row) -> tuple[Any, dict]:
        scan_cfg = (row.breakdown or {}).get("scan_config") or {}
        try:
            target = int(scan_cfg.get("target_duration_sec") or 0)
        except (TypeError, ValueError):
            target = 0
        if target <= 0:
            target = int(round(row.predicted_output_duration_s or 25))
        try:
            tolerance = int(scan_cfg.get("duration_tolerance_sec") or 0)
        except (TypeError, ValueError):
            tolerance = 0
        if tolerance <= 0:
            tolerance = 3
        topic_keywords = tuple(
            k for k in (scan_cfg.get("topic_keywords") or ())
            if isinstance(k, str) and k.strip()
        )
        payload = await preview_svc.enrich(
            candidate_row=row,
            context=context,
            target_duration_sec=target,
            duration_tolerance_sec=tolerance,
            topic_keywords=topic_keywords,
        )
        return row, payload.to_dict()

    miss_results: list[tuple[int, EnrichedCandidate]] = []
    successful_llm_picks = 0
    if miss_rows:
        outcomes = await asyncio.gather(
            *(_enrich_one(r) for _, r in miss_rows),
            return_exceptions=True,
        )
        for (i, row), outcome in zip(miss_rows, outcomes):
            if isinstance(outcome, BaseException):
                # One candidate failed — log and skip rather than nuke the
                # whole batch. The FE will see partial results. Skipped
                # candidates are NOT billed (the cost is per LLM roundtrip).
                logger.warning(f"Enrich failed for candidate {row.id}: {outcome}")
                continue
            _, enriched_dict = outcome
            try:
                candidate_repo.set_enriched(str(row.id), enriched_dict)
            except Exception as e:
                logger.warning(f"Failed to persist enriched for {row.id}: {e}")
            miss_results.append((i, _enriched_dict_to_response(str(row.id), enriched_dict)))
            # Only charge when the LLM actually fired. `method == "heuristic_fallback"`
            # covers two cases — either no API key configured (no LLM call
            # ever happened, billing would be theft) OR the LLM call failed
            # mid-flight (we paid, but the user got a degraded experience).
            # Conflating both means we either over-bill the misconfig case
            # or under-bill the failure case. We choose under-billing: a
            # failed LLM call we eat the cost on, but we never bill for a
            # call that never happened.
            if enriched_dict.get("method") == "llm":
                successful_llm_picks += 1

    # Post-success credit deduction. We charge per successful LLM pick —
    # failed picks (caught above), cache hits (never entered miss_rows), and
    # heuristic-only fallbacks (no LLM call made) are all free. Best-effort:
    # a deduct failure logs but doesn't block the response (the user got
    # their result, losing tracking on one call is a smaller incident than
    # refusing to return the enrichment).
    if successful_llm_picks > 0:
        from ..services.credit_service import CreditService
        from ..schemas.credits import CreditDeductRequest
        try:
            CreditService(db).deduct_credits(CreditDeductRequest(
                institute_id=institute_id,
                request_type="reels_preview",
                model=preview_pricing_model,
                prompt_tokens=successful_llm_picks * _PREVIEW_PROMPT_TOKENS,
                completion_tokens=successful_llm_picks * _PREVIEW_COMPLETION_TOKENS,
                batch_id=request.input_asset_id,  # group every preview for an asset
            ))
        except Exception as e:
            logger.warning(
                f"[/preview] credit deduct failed for {institute_id} "
                f"({successful_llm_picks} picks): {e}"
            )

    # Reassemble in request order.
    combined: list[tuple[int, EnrichedCandidate]] = cache_hits + miss_results
    combined.sort(key=lambda pair: pair[0])
    enriched_out = [item for _, item in combined]
    return PreviewResponse(enriched=enriched_out)


def _reel_row_to_response(row) -> ReelResponse:
    """ai_reels row → ReelResponse. Mirrors AiReel.to_dict() shape but
    coerces nested lists into typed StageProgress objects."""
    d = row.to_dict()
    stages = [
        StageProgress(
            stage=s.get("stage", "UNKNOWN"),
            progress=int(s.get("progress", 0) or 0),
        )
        for s in (d.get("stages") or [])
        if isinstance(s, dict)
    ]
    return ReelResponse(
        id=d["id"],
        reel_id=d["reel_id"],
        institute_id=d["institute_id"],
        input_asset_id=d["input_asset_id"],
        candidate_id=d.get("candidate_id"),
        status=d["status"],
        current_stage=d["current_stage"],
        progress=d.get("progress", 0),
        stages=stages,
        error_message=d.get("error_message"),
        config=d.get("config") or {},
        source_window=d.get("source_window") or {},
        trim_map=d.get("trim_map"),
        s3_urls=d.get("s3_urls") or {},
        metadata=d.get("metadata") or {},
        created_at=d.get("created_at"),
        updated_at=d.get("updated_at"),
        completed_at=d.get("completed_at"),
    )


def _context_from_reel_row(row, institute_id: str) -> RenderContext:
    """Build the orchestrator's RenderContext from a persisted ai_reels row.

    Both /render (freshly created row) and /{reel_id}/retry (existing FAILED
    row) dispatch from the same persisted state: `config` carries the full
    RenderRequest plus render_config_hash + enriched_snapshot, and
    `source_window` the candidate's window. Reading from the row rather than
    the request keeps the two dispatch paths identical AND decouples the
    background task from request-scoped session state — only plain
    strings/dicts cross into the task.
    """
    return RenderContext(
        reel_pk=str(row.id),
        reel_id=row.reel_id,
        institute_id=institute_id,
        input_asset_id=str(row.input_asset_id),
        candidate_id=str(row.parent_candidate_id) if row.parent_candidate_id else None,
        config=row.config or {},
        source_window=row.source_window or {},
    )


# ---------------------------------------------------------------------------
# POST /render — Gate 3
# ---------------------------------------------------------------------------

@router.post("/render", response_model=ReelResponse)
async def render_reel(
    request: RenderRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Gate 3: trigger an async multi-stage render of one chosen candidate.

    Returns immediately with `status=IN_PROGRESS`. The FE polls
    `GET /reels/v1/{reel_id}/status` for stage-by-stage progress.

    Validation:
      - Source asset must exist, belong to caller, be a COMPLETED podcast.
      - Candidate must exist, belong to caller, reference the same source asset.
      - Candidate SHOULD be enriched (i.e., /preview was called) — we
        currently allow un-enriched candidates through with a heuristic
        cut plan generated on-the-fly later; the FE should usually call
        /preview first so the user sees the plan before paying for render.
    """
    # 1. Validate source asset.
    asset_repo = AiInputAssetRepository(session=db)
    asset = asset_repo.get_by_id(request.input_asset_id)
    asset = _validate_source_asset(asset, institute_id)

    # 2. Validate candidate.
    candidate_repo = AiReelCandidateRepository(session=db)
    candidate = candidate_repo.get_by_id(request.candidate_id)
    if (
        candidate is None
        or candidate.institute_id != institute_id
        or str(candidate.input_asset_id) != request.input_asset_id
    ):
        raise HTTPException(status_code=404, detail="Candidate not found")

    # 3. Idempotency check — dedup double-clicks before we spin up a render.
    # The hash captures the full RenderRequest minus input_asset_id (already
    # implied by the candidate). If a non-terminal reel for the same
    # (institute, candidate, hash) is already in flight, return that row.
    # Note: this protects the obvious case (user double-clicks "Render this
    # clip"). A simultaneous-within-DB-roundtrip race can still produce two
    # rows; a partial UNIQUE index would close that, but in practice the FE
    # debounce + sub-millisecond click windows make it unreachable.
    reel_repo = AiReelRepository(session=db)
    render_config_hash = _render_config_hash(request)
    existing = reel_repo.find_active_for_candidate(
        institute_id=institute_id,
        candidate_id=str(candidate.id),
        render_config_hash=render_config_hash,
    )
    if existing is not None:
        logger.info(
            f"[/render] dedup: reel {existing.reel_id} already in flight for "
            f"candidate={candidate.id} hash={render_config_hash[:8]}…"
        )
        return _reel_row_to_response(existing)

    # 4. Create the AiReel row.
    reel_id = f"reel-{uuid4().hex[:12]}"
    config_dict = request.model_dump()
    # Stash the hash inside the persisted config so find_active_for_candidate
    # can match future requests without recomputing from disparate columns.
    config_dict["render_config_hash"] = render_config_hash
    # G4: Snapshot the candidate's current `enriched` payload (title,
    # rationale, word_importance, cut_plan) into the reel's config at
    # /render time. The render reads from this snapshot, NOT from
    # candidate.enriched, so a concurrent /preview call can't quietly
    # change what the user paid to render.
    if candidate.enriched:
        config_dict["enriched_snapshot"] = candidate.enriched
    source_window = {
        "t_start": candidate.source_t_start,
        "t_end": candidate.source_t_end,
        "original_duration_s": candidate.source_duration_s,
    }

    # B3: validate + merge user-toggled cut_plan_overrides into the snapshot.
    # Downstream `_resolve_cut_plan` in reels_audio_edit_service sorts +
    # unions overlapping cuts, so we just append + sort here.
    render_extra_metadata: dict = {}
    if request.cut_plan_overrides:
        validated_overrides = _validate_cut_plan_overrides(
            request.cut_plan_overrides,
            source_window,
            config_dict.get("enriched_snapshot"),
        )
        if validated_overrides:
            snapshot = config_dict.setdefault("enriched_snapshot", {})
            existing_cuts = list(snapshot.get("cut_plan") or [])
            merged_cuts = sorted(
                existing_cuts + validated_overrides,
                key=lambda c: c.get("t_start", 0.0),
            )
            snapshot["cut_plan"] = merged_cuts
            # B5: compute effective duration + echo for the FE confirmation card.
            # PB1 fix (2026-05-22): align with FE math — `predicted_output_
            # duration_s` is PRE-speedup (plan_cuts returns 1.0x durations),
            # so subtract raw seconds directly. Dividing by `speed` mixed
            # scales with the existing baseline display.
            override_total_s = sum(
                v["t_end"] - v["t_start"] for v in validated_overrides
            )
            # PB2 fix: explicit None check so a valid 0.0 doesn't fall through
            # to source_duration_s.
            snapshot_predicted = (config_dict.get("enriched_snapshot") or {}).get(
                "predicted_output_duration_s"
            )
            base_predicted = float(
                snapshot_predicted
                if snapshot_predicted is not None
                else candidate.source_duration_s
            )
            final_predicted = max(0.0, base_predicted - override_total_s)
            render_extra_metadata["effective_cut_plan"] = merged_cuts
            render_extra_metadata["cut_plan_override_count"] = len(validated_overrides)
            render_extra_metadata["cut_plan_override_total_s"] = round(override_total_s, 3)
            render_extra_metadata["final_predicted_duration_s"] = round(final_predicted, 3)
            # Persist a copy of the user's raw overrides for audit.
            config_dict["cut_plan_overrides"] = validated_overrides

    reel = reel_repo.create(
        reel_id=reel_id,
        institute_id=institute_id,
        input_asset_id=request.input_asset_id,
        parent_candidate_id=str(candidate.id),
        config=config_dict,
        source_window=source_window,
        extra_metadata=render_extra_metadata or None,
    )

    # 4. Build the render context from the persisted row and dispatch the
    # background task. Shared with /{reel_id}/retry — see the helper's note
    # on session decoupling.
    dispatch_render(_context_from_reel_row(reel, institute_id))

    # 5. Return the row immediately. status=PENDING in the DB initially;
    # we re-read after dispatch in case the orchestrator already flipped
    # to IN_PROGRESS (race-free under asyncio single-threaded scheduling).
    db.refresh(reel)
    return _reel_row_to_response(reel)


# ---------------------------------------------------------------------------
# GET /list — list reels for the institute (optionally filtered by source asset)
# ---------------------------------------------------------------------------

@router.get("/list", response_model=List[ReelResponse])
async def list_reels(
    input_asset_id: Optional[str] = Query(
        None,
        description="Filter to reels derived from a specific source asset.",
    ),
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """List reels for the calling institute, newest first."""
    repo = AiReelRepository(session=db)
    rows = repo.list_by_institute(institute_id, input_asset_id=input_asset_id)
    return [_reel_row_to_response(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /{reel_id} — full reel record
# ---------------------------------------------------------------------------

@router.get("/{reel_id}", response_model=ReelResponse)
async def get_reel(
    reel_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Full reel record. `reel_id` is the user-facing string id (not the UUID pk).

    Includes per-stage progress, trim map, and output URLs once complete.
    """
    repo = AiReelRepository(session=db)
    row = repo.get_by_reel_id(reel_id)
    if row is None or row.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Reel not found")
    return _reel_row_to_response(row)


# ---------------------------------------------------------------------------
# GET /{reel_id}/status — lightweight poll payload
# ---------------------------------------------------------------------------

@router.get("/{reel_id}/status", response_model=ReelStatusResponse)
async def get_reel_status(
    reel_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Lightweight status poll. FE hits this every few seconds during a
    render to advance the stage-by-stage progress UI (§13.11 of plan).
    """
    repo = AiReelRepository(session=db)
    row = repo.get_by_reel_id(reel_id)
    if row is None or row.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Reel not found")
    stages = [
        StageProgress(
            stage=s.get("stage", "UNKNOWN"),
            progress=int(s.get("progress", 0) or 0),
        )
        for s in (row.stages or [])
        if isinstance(s, dict)
    ]
    return ReelStatusResponse(
        id=str(row.id),
        status=row.status,
        current_stage=row.current_stage,
        progress=row.progress or 0,
        stages=stages,
        error_message=row.error_message,
    )


# ---------------------------------------------------------------------------
# POST /{reel_id}/retry — re-dispatch a FAILED reel
# ---------------------------------------------------------------------------

@router.post("/{reel_id}/retry", response_model=ReelResponse)
async def retry_reel(
    reel_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Re-run a FAILED reel from its persisted state — same candidate, same
    config, same enriched_snapshot the user originally chose to render. No
    new LLM enrichment, no re-scan; the row's `config` already carries
    everything the pipeline needs.

    Only FAILED reels qualify: COMPLETED has nothing to redo, and
    PENDING/IN_PROGRESS is already being worked — re-dispatching would race
    the live task's row writes. The FAILED→PENDING flip is guarded in SQL
    (`reset_for_retry` re-checks status in its WHERE clause) so two
    concurrent retry clicks can't double-dispatch.

    Returns the standard reel record, reset to PENDING, so the FE resumes
    polling exactly as after /render.
    """
    repo = AiReelRepository(session=db)
    row = repo.get_by_reel_id(reel_id)
    if row is None or row.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Reel not found")
    if row.status != "FAILED":
        raise HTTPException(
            status_code=409,
            detail=f"Only FAILED reels can be retried (status={row.status})",
        )
    if not repo.reset_for_retry(str(row.id)):
        # Lost the race to a concurrent retry — that call is dispatching.
        raise HTTPException(status_code=409, detail="Reel is already being retried")

    logger.info(f"[/retry] re-dispatching reel {row.reel_id} after failure")
    dispatch_render(_context_from_reel_row(row, institute_id))

    db.refresh(row)
    return _reel_row_to_response(row)


# ---------------------------------------------------------------------------
# DELETE /{reel_id} — hard-delete a reel record
# ---------------------------------------------------------------------------

@router.delete("/{reel_id}")
async def delete_reel(
    reel_id: str,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
):
    """Delete a reel record. The reel's rendered MP4 and intermediate
    artifacts stay in S3 — only the DB row is removed. A separate lifecycle
    job sweeps orphaned artifacts.
    """
    repo = AiReelRepository(session=db)
    row = repo.get_by_reel_id(reel_id)
    if row is None or row.institute_id != institute_id:
        raise HTTPException(status_code=404, detail="Reel not found")
    repo.delete_by_id(str(row.id))
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Frame editing — POST /frame/{add,update,delete}
#
# Reused by the editor (`/vim/edit/$videoId?kind=reel`) so user edits land
# in the reel's `time_based_frame.json` rather than the AI-gen-video table.
# Sync I/O is offloaded to `asyncio.to_thread` so the loop stays responsive.
# ---------------------------------------------------------------------------

from ..services.reels_frame_service import (  # noqa: E402  (router-local import)
    ReelTimelineNotFound,
    ReelsFrameService,
)


def _frame_error_status(exc: Exception) -> int:
    """Map service errors to HTTP status codes consistently.

    `ReelTimelineNotFound` is a client error (open after assemble); plain
    `ValueError`/`IndexError` are bad-request shape; everything else is 500
    and we let FastAPI's default handler surface the message.
    """
    if isinstance(exc, ReelTimelineNotFound):
        return 409  # render not finished → conflict, not 404 (the reel exists)
    if isinstance(exc, (ValueError, IndexError)):
        return 400
    return 500


@router.post("/frame/add", response_model=ReelFrameResponse)
async def add_reel_frame(
    payload: AddReelFrameRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
) -> ReelFrameResponse:
    """Insert a new entry into the reel's timeline JSON on S3.

    Used by the editor's `saveChanges` for newly-added shots while editing
    a reel. Same request shape as `/external/video/v1/frame/add` except
    `reel_id` instead of `video_id`.
    """
    service = ReelsFrameService(repo=AiReelRepository(session=db))
    try:
        result = await asyncio.to_thread(
            service.add_frame,
            reel_id=payload.reel_id,
            institute_id=institute_id,
            html=payload.html,
            in_time=payload.in_time,
            exit_time=payload.exit_time,
            z=payload.z or 0,
            entry_id=payload.entry_id,
            html_start_x=payload.html_start_x,
            html_start_y=payload.html_start_y,
            html_end_x=payload.html_end_x,
            html_end_y=payload.html_end_y,
        )
        return ReelFrameResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=_frame_error_status(e), detail=str(e))


@router.post("/frame/update", response_model=ReelFrameResponse)
async def update_reel_frame(
    payload: UpdateReelFrameRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
) -> ReelFrameResponse:
    """Update an entry's HTML (and optionally its timing/z) in the reel's
    timeline. Persists immediately to S3 — there's no draft buffer."""
    service = ReelsFrameService(repo=AiReelRepository(session=db))
    try:
        result = await asyncio.to_thread(
            service.update_frame,
            reel_id=payload.reel_id,
            institute_id=institute_id,
            frame_index=payload.frame_index,
            new_html=payload.new_html,
            in_time=payload.in_time,
            exit_time=payload.exit_time,
            z=payload.z,
            entry_id=payload.entry_id,
        )
        return ReelFrameResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=_frame_error_status(e), detail=str(e))


@router.post("/frame/delete", response_model=ReelFrameResponse)
async def delete_reel_frame(
    payload: DeleteReelFrameRequest,
    institute_id: str = Depends(get_institute_from_api_key),
    db: Session = Depends(db_dependency),
) -> ReelFrameResponse:
    """Remove an entry from the reel's timeline. `entry_id` is order-
    independent and preferred; `frame_index` is the fallback for callers
    that only know the position."""
    service = ReelsFrameService(repo=AiReelRepository(session=db))
    try:
        result = await asyncio.to_thread(
            service.delete_frame,
            reel_id=payload.reel_id,
            institute_id=institute_id,
            entry_id=payload.entry_id,
            frame_index=payload.frame_index,
        )
        return ReelFrameResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=_frame_error_status(e), detail=str(e))
