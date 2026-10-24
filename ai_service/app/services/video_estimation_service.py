"""
Video generation cost/credit estimator.

Used by the pre-generation preview to show users what their selections will cost
before they commit. Token / image / TTS-character counts are heuristic baselines
keyed by (quality_tier, duration_band). Prices are the ones the runtime charges
(video_generation_service billing): LLM rows at the stage-matrix model's
ai_models rates through credit_pricing 'video'; images at the image model's
ai_models.image_price_per_unit × the credit ratio; premium TTS at the
provider_rates vendor rate; the lesson teacher at spatius/video's
video_price_per_second; Edge TTS, Pexels stock and music are free to the user.

The baselines are seed values — refine after we have ≥10 completed videos per
bucket via `refresh_baselines_from_history()`.
"""
from __future__ import annotations

import logging
import math
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Tuple, List, Dict, Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..constants.model_defaults import GLM_DEFAULT
from .ai_video_constants import AI_VIDEO_PER_VIDEO_COST_CAP_USD
from .credit_service import CreditService
from .provider_rates import IMAGE_FALLBACK_MODEL_ID, image_cost_usd, tts_cost_usd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Heuristic baselines: expected counts per (tier, duration_band)
# ---------------------------------------------------------------------------
# Numbers are medians from observed runs (seeded from the heart-anatomy
# super_ultra@2:21min run: 152K in / 192K out / 8 images / ~1500 TTS chars)
# and scaled by quality_tier and duration. Variance band: ±30% on tokens,
# ±20% on images, fixed TTS chars (audio length is deterministic).

DurationBand = str  # one of: "<1 minute", "1-2 minutes", "2-3 minutes", "3-5 minutes", "5+ minutes"
Tier = str          # one of: "free", "standard", "premium", "ultra", "super_ultra"


def _normalize_duration_band(target_duration: str) -> DurationBand:
    """Map free-form duration strings (e.g. '2-3 minutes', '5 minutes', '90 seconds')
    to one of the canonical bands used in the baseline table."""
    if not target_duration:
        return "2-3 minutes"
    s = target_duration.strip().lower()
    nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", s)]
    if not nums:
        return "2-3 minutes"
    minutes = max(nums) if "second" not in s else max(nums) / 60.0
    if minutes < 1:
        return "<1 minute"
    if minutes <= 2:
        return "1-2 minutes"
    if minutes <= 3:
        return "2-3 minutes"
    if minutes <= 5:
        return "3-5 minutes"
    return "5+ minutes"


# Seed numbers — keep this table tight.
# Recalibrated 2026-10-13 from the GLM-only lesson vid_lesson_sq_2245 (150 s):
# html stage 435,899 in / 509,663 out tokens (~2,900 / ~3,400 per narrated
# second), script stage ~60k / ~90k (~400 / ~600 per second), 17 AI images
# (~1 per 9 s). Every tier now runs every LLM step on the same GLM model, so
# tiers differ only by the extra passes they turn on (seg multiplier:
# free 0.9, standard 1.1, premium 1.15, ultra 1.3, super_ultra 1.45; script
# ×1.2 on ultra, ×1.5 on super_ultra). Free is stock-only (old image counts).
# The table it replaces predated per-stage billing and asked for ~1/5 of what
# a run is now charged — and the start-of-run check requires this estimate.
# "dir_*" = the script/Director stage (shown as its own row on Director tiers);
# "seg_*" = per-shot HTML + vision review. Scale by band median seconds.
# {"dir_in", "dir_out", "seg_in", "seg_out", "img", "tts"}
_VIDEO_BASELINES: Dict[Tuple[Tier, DurationBand], Dict[str, int]] = {
    # free — no Director row (script folded into seg); stock-only, no vision review
    ("free",        "<1 minute"):    {"dir_in":      0, "dir_out":      0, "seg_in":  135000, "seg_out":  165000, "img":  0, "tts":  500},
    ("free",        "1-2 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  271000, "seg_out":  329000, "img":  1, "tts":  900},
    ("free",        "2-3 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  452000, "seg_out":  549000, "img":  1, "tts": 1500},
    ("free",        "3-5 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  722000, "seg_out":  878000, "img":  2, "tts": 2400},
    ("free",        "5+ minutes"):   {"dir_in":      0, "dir_out":      0, "seg_in": 1084000, "seg_out": 1318000, "img":  2, "tts": 3600},
    # standard — no Director row (script folded into seg); + vision review
    ("standard",    "<1 minute"):    {"dir_in":      0, "dir_out":      0, "seg_in":  162000, "seg_out":  195000, "img":  5, "tts":  500},
    ("standard",    "1-2 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  323000, "seg_out":  391000, "img": 10, "tts":  900},
    ("standard",    "2-3 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  538000, "seg_out":  651000, "img": 17, "tts": 1500},
    ("standard",    "3-5 minutes"):  {"dir_in":      0, "dir_out":      0, "seg_in":  862000, "seg_out": 1042000, "img": 27, "tts": 2400},
    ("standard",    "5+ minutes"):   {"dir_in":      0, "dir_out":      0, "seg_in": 1292000, "seg_out": 1562000, "img": 41, "tts": 3600},
    # premium — script/Director row + per-shot HTML; + best-of-2
    ("premium",     "<1 minute"):    {"dir_in":  18000, "dir_out":  27000, "seg_in":  150000, "seg_out":  176000, "img":  5, "tts":  500},
    ("premium",     "1-2 minutes"):  {"dir_in":  36000, "dir_out":  54000, "seg_in":  300000, "seg_out":  352000, "img": 10, "tts":  900},
    ("premium",     "2-3 minutes"):  {"dir_in":  60000, "dir_out":  90000, "seg_in":  500000, "seg_out":  586000, "img": 17, "tts": 1500},
    ("premium",     "3-5 minutes"):  {"dir_in":  96000, "dir_out": 144000, "seg_in":  800000, "seg_out":  938000, "img": 27, "tts": 2400},
    ("premium",     "5+ minutes"):   {"dir_in": 144000, "dir_out": 216000, "seg_in": 1201000, "seg_out": 1408000, "img": 41, "tts": 3600},
    # ultra — + hero shots at "max", best-of-3, creativity critic
    ("ultra",       "<1 minute"):    {"dir_in":  22000, "dir_out":  32000, "seg_in":  170000, "seg_out":  199000, "img":  5, "tts":  500},
    ("ultra",       "1-2 minutes"):  {"dir_in":  43000, "dir_out":  65000, "seg_in":  339000, "seg_out":  398000, "img": 10, "tts":  900},
    ("ultra",       "2-3 minutes"):  {"dir_in":  72000, "dir_out": 108000, "seg_in":  566000, "seg_out":  663000, "img": 17, "tts": 1500},
    ("ultra",       "3-5 minutes"):  {"dir_in": 115000, "dir_out": 173000, "seg_in":  905000, "seg_out": 1061000, "img": 27, "tts": 2400},
    ("ultra",       "5+ minutes"):   {"dir_in": 173000, "dir_out": 259000, "seg_in": 1357000, "seg_out": 1591000, "img": 41, "tts": 3600},
    # super_ultra — two-pass Director + the ultra extras
    ("super_ultra", "<1 minute"):    {"dir_in":  27000, "dir_out":  40000, "seg_in":  189000, "seg_out":  222000, "img":  5, "tts":  500},
    ("super_ultra", "1-2 minutes"):  {"dir_in":  54000, "dir_out":  81000, "seg_in":  378000, "seg_out":  444000, "img": 10, "tts":  900},
    ("super_ultra", "2-3 minutes"):  {"dir_in":  90000, "dir_out": 135000, "seg_in":  631000, "seg_out":  740000, "img": 17, "tts": 1500},
    ("super_ultra", "3-5 minutes"):  {"dir_in": 144000, "dir_out": 216000, "seg_in": 1009000, "seg_out": 1183000, "img": 27, "tts": 2400},
    ("super_ultra", "5+ minutes"):   {"dir_in": 216000, "dir_out": 324000, "seg_in": 1514000, "seg_out": 1775000, "img": 41, "tts": 3600},
}

# Tiers that run a Director pass before per-shot generation.
_DIRECTOR_TIERS = {"premium", "ultra", "super_ultra"}

# Variance multipliers for the low/high band.
_TOKEN_VARIANCE = 0.30
_IMAGE_VARIANCE = 0.20

# Constants for unit costs not represented as token rates.
# Support visuals use the pipeline's default image model; the avatar host's
# per-shot identity images use Seedream (both priced from ai_models).
_VIDEO_IMAGE_MODEL_ID: str = IMAGE_FALLBACK_MODEL_ID
_HOST_IMAGE_MODEL_ID: str = "bytedance-seed/seedream-4.5"
_BACKGROUND_MUSIC_FLAT_USD: float = 0.10  # Lyria call (rough) — our cost, not charged
# Lesson teacher (Spatius Video API): the vendor bills the returned video,
# which runs ~1.8 s past the narration (closing transition), at $0.045/min.
_LESSON_TEACHER_MODEL_ID: str = "spatius/video"
_LESSON_TEACHER_USD_PER_SECOND_FALLBACK: float = 0.045 / 60.0
_LESSON_TEACHER_TAIL_SECONDS: float = 1.8
_INDIAN_LANGUAGES = {
    "hindi", "bengali", "tamil", "telugu", "marathi", "kannada",
    "gujarati", "malayalam", "punjabi", "odia", "english (india)",
}


# ---------------------------------------------------------------------------
# Pricing helpers
# ---------------------------------------------------------------------------
def _get_llm_pricing(db: Session, model: str) -> Optional[Tuple[float, float, bool]]:
    """Returns (input_per_1m, output_per_1m, is_free) or None if model not registered."""
    try:
        row = db.execute(
            text(
                "SELECT input_price_per_1m, output_price_per_1m, is_free "
                "FROM ai_models WHERE model_id = :m AND is_active = TRUE LIMIT 1"
            ),
            {"m": model},
        ).fetchone()
    except Exception as e:
        logger.warning(f"[VideoEstimation] LLM pricing lookup failed: {e}")
        return None
    if not row:
        return None
    return (
        float(row.input_price_per_1m or 0),
        float(row.output_price_per_1m or 0),
        bool(row.is_free),
    )


def _get_image_unit_price(db: Session, model_id: str = _VIDEO_IMAGE_MODEL_ID) -> float:
    """Per-image USD — the same lookup the runtime billing uses."""
    return image_cost_usd(model_id, db=db)


def _get_video_second_price(db: Session, model_id: str) -> Optional[float]:
    """Per-second USD cost for video models (avatar synthesis). NULL → not registered."""
    try:
        row = db.execute(
            text(
                "SELECT video_price_per_second FROM ai_models "
                "WHERE model_id = :m AND is_active = TRUE LIMIT 1"
            ),
            {"m": model_id},
        ).fetchone()
        if row and row.video_price_per_second is not None:
            return float(row.video_price_per_second)
    except Exception as e:
        logger.warning(f"[VideoEstimation] Video pricing lookup failed: {e}")
    return None


def _duration_seconds_from_band(band: str) -> float:
    """Median seconds for a duration band — used for host-cost extrapolation."""
    return {
        "<1 minute":   45.0,
        "1-2 minutes": 90.0,
        "2-3 minutes": 150.0,
        "3-5 minutes": 240.0,
        "5+ minutes":  360.0,
    }.get(band, 150.0)


def _resolve_default_video_model(db: Session) -> Optional[str]:
    """Same fallback chain video_generation_service uses."""
    try:
        from .ai_models_service import AIModelsService
        return AIModelsService(db).get_models_for_use_case("video").default_model.model_id
    except Exception as e:
        logger.warning(f"[VideoEstimation] default model lookup failed: {e}")
        return None


def _resolve_stage_models(
    db: Session, quality_tier: str, model: Optional[str]
) -> Tuple[str, str]:
    """(planning model, per-shot model) the run will actually use: the stage
    matrix for the tier with the user's `model` layered on the user-overridable
    stages (exactly as the runtime builds it), else the 'video' default, else
    GLM_DEFAULT."""
    stage_map: Dict[str, Any] = {}
    try:
        from .ai_models_service import AIModelsService
        stage_map = AIModelsService(db).get_stage_model_map(
            use_case="video",
            quality_tier=quality_tier,
            overrides=({"default": model} if model else None),
        ) or {}
    except Exception as e:
        logger.warning(f"[VideoEstimation] stage model lookup failed: {e}")

    def _stage(*stage_ids: str) -> Optional[str]:
        for sid in stage_ids:
            rm = stage_map.get(sid)
            mid = getattr(rm, "model_id", None) if rm is not None else None
            if mid:
                return str(mid)
        return None

    default = (model if not stage_map else None) or _resolve_default_video_model(db) or GLM_DEFAULT
    planning = _stage("director", "shot_planner", "script_generation") or default
    per_shot = _stage("per_shot_html") or default
    return planning, per_shot


def _resolve_tts_provider(tts_provider: str, language: str) -> str:
    """The TTS vendor the pipeline will use — mirrors its own resolution
    (premium + an Indian language → Sarvam, premium otherwise → Google)."""
    p = (tts_provider or "").strip().lower()
    if p == "premium":
        return "sarvam" if (language or "").strip().lower() in _INDIAN_LANGUAGES else "google"
    if p in ("google", "sarvam", "smallest"):
        return p
    return "edge"


# ---------------------------------------------------------------------------
# Cost computation
# ---------------------------------------------------------------------------
def _llm_cost_usd(input_per_1m: float, output_per_1m: float, prompt_tokens: int, completion_tokens: int) -> float:
    return (prompt_tokens / 1_000_000) * input_per_1m + (completion_tokens / 1_000_000) * output_per_1m


def _credits_from_usd(pricing: Dict[str, Any], cost_usd: float, ratio: Decimal) -> Decimal:
    """Mirror credit_service.calculate_credits' real-cost path:
    max(min_charge, base_cost + usd × ratio), with `pricing` being the
    credit_pricing row the runtime reads (CreditService._get_pricing).

    `ratio` is the live USD→credits multiplier; pass the resolved ratio in
    once per estimation run rather than looking it up per line item.
    """
    calculated = Decimal(str(pricing["base_cost"])) + (Decimal(str(cost_usd)) * ratio)
    result = max(Decimal(str(pricing["min_charge"])), calculated)
    return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _metered_credits(cost_usd: float, ratio: Decimal) -> Decimal:
    """usd × ratio with no base cost — what CreditService.usd_to_credits charges
    for images, premium TTS and the lesson teacher (precomputed_credits)."""
    if cost_usd <= 0:
        return Decimal("0")
    return (Decimal(str(cost_usd)) * ratio).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def estimate_video_generation(
    db: Session,
    *,
    # Defaults let the pre-flight (CreditService.check_video_tier_credits)
    # pass only the selections it has; the preview endpoint passes them all.
    institute_id: Optional[str] = None,
    model: Optional[str] = None,
    quality_tier: str = "standard",
    target_duration: str = "2-3 minutes",
    target_audience: str = "General",
    orientation: str = "landscape",
    voice_gender: str = "female",
    tts_provider: str = "standard",
    voice_id: Optional[str] = None,
    language: str = "English",
    generate_avatar: bool = False,
    background_music_enabled: Optional[bool] = None,
    sound_effects_enabled: bool = False,
    content_type: str = "VIDEO",
    visual_style: str = "standard",
    captions_enabled: bool = True,
    html_quality: str = "advanced",
    review_mode: bool = False,
    attachments_count: int = 0,
    host: Optional[Dict[str, Any]] = None,
    # Lesson mode (schemas.LessonConfig dump, or the persisted lesson plan).
    # With a teacher, adds the Spatius teacher row — vendor seconds ×
    # spatius/video's price × the credit ratio, as the runtime charges.
    lesson: Optional[Dict[str, Any]] = None,
    # Opt-in: when True (and tier is ultra/super_ultra) the estimator adds
    # an AI video upper-bound row to the breakdown so the pre-submit
    # preview surfaces the worst-case Veo spend. Mirrors the runtime
    # `ai_video_enabled` flag — the runtime cap is the per-video circuit
    # breaker in QUALITY_TIERS, not a per-shot guess.
    ai_video_enabled: bool = False,
    ai_video_audio_enabled: bool = False,
    # Dialogue scenes (storybook/drama) — the dominant cost line when on:
    # each scene is a fal video-gen call ($0.3034/s Seedance 720p, ~$0.13/s
    # Omni). The estimator surfaces expected scenes × ~8s × rate, capped at
    # the tier's dialogue budget ($6 storybook / $20 drama defaults).
    dialogue_scenes_enabled: bool = False,
    dialogue_mode: str = "storybook",
    dialogue_clip_model: str = "seedance-2.0",
) -> Dict[str, Any]:
    """
    Estimate credits and USD cost for a video generation request, plus echo back
    the resolved selections so the FE confirmation modal can display them.
    """
    # Resolve the models the run will use (mirror the runtime: stage matrix
    # with the user's model on the overridable stages).
    planning_model, effective_model = _resolve_stage_models(db, quality_tier, model)
    duration_band = _normalize_duration_band(target_duration)

    # Resolve the live USD→credits ratio once per estimation. Per-line-item
    # lookups would hammer the cache for no benefit — the value is stable
    # for the duration of one estimate call.
    credit_service = CreditService(db)
    rate_ratio = credit_service._effective_usd_to_credit_ratio()
    _pricing_cache: Dict[str, Dict[str, Any]] = {}

    def _pricing(request_type: str) -> Dict[str, Any]:
        # The credit_pricing row the runtime reads (DB, then code default).
        if request_type not in _pricing_cache:
            _pricing_cache[request_type] = credit_service._get_pricing(request_type)
        return _pricing_cache[request_type]

    baseline = _VIDEO_BASELINES.get((quality_tier, duration_band))
    if not baseline:
        # Unknown tier — fall back to ultra of the same band, then ultra/2-3
        baseline = (
            _VIDEO_BASELINES.get(("ultra", duration_band))
            or _VIDEO_BASELINES["ultra", "2-3 minutes"]
        )

    uses_director = quality_tier in _DIRECTOR_TIERS
    dir_in_tokens  = baseline["dir_in"]
    dir_out_tokens = baseline["dir_out"]
    seg_in_tokens  = baseline["seg_in"]
    seg_out_tokens = baseline["seg_out"]
    image_count    = baseline["img"]
    tts_chars      = baseline["tts"]

    # Lyria background music defaults: on for ultra/super_ultra unless explicitly disabled.
    bg_music_on = (
        background_music_enabled
        if background_music_enabled is not None
        else quality_tier in ("ultra", "super_ultra")
    )

    # --- Cost components -------------------------------------------------
    def _rates(m: str) -> Tuple[float, float, Optional[Tuple[float, float, bool]]]:
        p = _get_llm_pricing(db, m) if m else None
        if not p:
            # Model not registered — flag it; use 0 rates so estimate is conservative-low
            return 0.0, 0.0, None
        return (0.0, 0.0, p) if p[2] else (p[0], p[1], p)

    in_rate, out_rate, llm_pricing = _rates(effective_model)
    if planning_model == effective_model:
        dir_in_rate, dir_out_rate = in_rate, out_rate
    else:
        dir_in_rate, dir_out_rate, _ = _rates(planning_model)

    image_unit = _get_image_unit_price(db)
    thumbnail_count = 1 if str(content_type or "VIDEO").upper() == "VIDEO" else 0
    host_image_unit = _get_image_unit_price(db, _HOST_IMAGE_MODEL_ID)
    tts_vendor = _resolve_tts_provider(tts_provider, language)

    # Host (avatar) cost: per-second × estimated host-on-screen seconds.
    # host_in_video_percentage of the median duration for the band yields the
    # rough seconds we'll bill at the avatar model's per-second rate. Only
    # priced for avatar host on ultra/super_ultra (matches feature gating).
    host_cost_row: Optional[Dict[str, Any]] = None
    host_extra_image_count = 0
    host_extra_image_usd = 0.0
    if (
        isinstance(host, dict)
        and host.get("type") == "avatar"
        and quality_tier in ("ultra", "super_ultra")
    ):
        avatar_cfg = host.get("avatar") or {}
        host_model = avatar_cfg.get("avatar_model") or "fal-ai/kling-video/ai-avatar/v2/standard"
        host_pct = max(0, min(100, int(host.get("host_in_video_percentage", 100))))
        approx_seconds = _duration_seconds_from_band(duration_band) * (host_pct / 100.0)

        # Resolve saved_avatar_id → provider + name for a friendly preview
        # label. Cost numbers stay on the Kling rate (we accepted overpayment
        # up front rather than reshape pricing tables). The detail string
        # used to expose the fal.ai endpoint slug
        # (`fal-ai/kling-video/ai-avatar/v2/standard`), which is misleading
        # for users who picked a built-in catalog avatar — they see Kling
        # despite Argil being the actual route.
        saved_avatar_id = avatar_cfg.get("saved_avatar_id")
        host_provider = "custom"
        avatar_name: Optional[str] = None
        if saved_avatar_id and institute_id:
            try:
                from .vimotion_resolver import resolve_studio_avatar
                _resolved = resolve_studio_avatar(saved_avatar_id, institute_id)
                if _resolved:
                    host_provider = (_resolved.get("provider") or "custom").lower()
                    avatar_name = (_resolved.get("name") or "").strip() or None
            except Exception as _re:
                logger.warning(
                    f"[Estimation] saved_avatar_id={saved_avatar_id!r} resolve "
                    f"failed for display ({_re}); falling back to generic label."
                )

        # Friendly label: "Custom avatar — Matteo" / "Preset avatar — Matteo".
        # Falls back to a bare label when the avatar wasn't resolved (e.g.
        # admin's free-form face upload — no studio_avatar row to read a
        # name from).
        if host_provider in ("argil", "veed"):
            host_detail = (
                f"Preset avatar — {avatar_name}" if avatar_name else "Preset avatar"
            )
        else:
            host_detail = (
                f"Custom avatar — {avatar_name}" if avatar_name else "Custom avatar"
            )

        if host_model == "fal-ai/ltx-2.3-quality/audio-to-video":
            # LTX 2.3 is priced PER-MEGAPIXEL of generated video
            # (width × height × frames × $0.0024075/MP), not per-second. Derive an
            # effective per-second from the chosen quality (resolution proxy) × fps
            # so the estimate stays in the per-second shape the rest of this
            # function expects. Approximate: the actual output sizes to the host
            # image's aspect (resolution="auto"); 480p/720p are stand-ins here.
            _ltx_fps = int(avatar_cfg.get("avatar_fps") or 24)
            _ltx_w, _ltx_h = (1280, 720) if (avatar_cfg.get("quality") == "720p") else (854, 480)
            host_per_sec = round(0.0024075 * (_ltx_w * _ltx_h * _ltx_fps) / 1_000_000.0, 6)
        elif host_model == "bytedance/seedance-2.0/reference-to-video":
            # Seedance reference-to-video is priced PER-SECOND by resolution
            # ($0.3034/s @480p–720p, $0.682/s @1080p). The avatar quality picker
            # only exposes 480p/720p, so the 720p rate is representative.
            host_per_sec = 0.682 if (avatar_cfg.get("quality") == "1080p") else 0.3034
        else:
            host_per_sec = _get_video_second_price(db, host_model)
        if host_per_sec is not None and approx_seconds > 0:
            host_usd = approx_seconds * host_per_sec
            host_cost_row = {
                "component": "Avatar video synthesis (host)",
                "detail": host_detail,
                "cost_usd": round(host_usd, 4),
                "credits": float(_credits_from_usd(_pricing("avatar_video"), host_usd, rate_ratio)),
            }
            # Per-shot avatar reference image gen (Seedream image-to-image).
            # Built-in catalog providers (argil/veed) skip Seedream entirely
            # — identity is locked to the catalog enum, no per-shot host
            # image is rendered. Suppress that line item for them.
            if host_provider == "custom":
                host_extra_image_count = max(1, int(approx_seconds / 6.0))
                host_extra_image_usd = host_extra_image_count * host_image_unit

    # Lesson teacher (Spatius Video API): what the runtime charges — the
    # vendor's video seconds × spatius/video's price × the credit ratio.
    lesson_cost_row: Optional[Dict[str, Any]] = None
    if isinstance(lesson, dict) and lesson.get("enabled", True) and (lesson.get("teacher") or {}).get("avatar_id"):
        _teacher_s = math.ceil(_duration_seconds_from_band(duration_band) + _LESSON_TEACHER_TAIL_SECONDS)
        _teacher_rate = _get_video_second_price(db, _LESSON_TEACHER_MODEL_ID)
        if not _teacher_rate:
            _teacher_rate = _LESSON_TEACHER_USD_PER_SECOND_FALLBACK
        _teacher_usd = _teacher_s * _teacher_rate
        lesson_cost_row = {
            "component": "Lesson teacher (Spatius avatar)",
            "detail": f"~{_teacher_s}s of teacher video · ${_teacher_rate * 60:.3f} per minute",
            "cost_usd": round(_teacher_usd, 4),
            "credits": float(_metered_credits(_teacher_usd, rate_ratio)),
        }

    def _components(
        d_in: int, d_out: int, s_in: int, s_out: int, imgs: int
    ) -> List[Dict[str, Any]]:
        img_usd = imgs * image_unit
        tts_usd = tts_cost_usd(tts_vendor, tts_chars)
        bg_usd = _BACKGROUND_MUSIC_FLAT_USD if bg_music_on else 0.0

        rows: List[Dict[str, Any]] = []
        if uses_director and (d_in or d_out):
            dir_usd = _llm_cost_usd(dir_in_rate, dir_out_rate, d_in, d_out)
            rows.append({
                "component": "LLM — Director pass",
                "detail": f"~{d_in:,} in / ~{d_out:,} out tokens · {planning_model or 'default model'}",
                "cost_usd": round(dir_usd, 4),
                "credits": float(_credits_from_usd(_pricing("video"), dir_usd, rate_ratio)),
            })

        seg_label = "LLM — per-shot generation" if uses_director else "LLM — script + segment shots"
        seg_usd = _llm_cost_usd(in_rate, out_rate, s_in, s_out)
        rows.append({
            "component": seg_label,
            "detail": f"~{s_in:,} in / ~{s_out:,} out tokens · {effective_model or 'default model'}",
            "cost_usd": round(seg_usd, 4),
            "credits": float(_credits_from_usd(_pricing("video"), seg_usd, rate_ratio)),
        })

        rows += [
            {
                "component": "Image generation",
                "detail": f"~{imgs} images · {_VIDEO_IMAGE_MODEL_ID.split('/')[-1]}",
                "cost_usd": round(img_usd, 4),
                # Per image: unit price × ratio (precomputed at runtime, no base).
                "credits": float(_metered_credits(image_unit, rate_ratio) * imgs),
            },
            {
                "component": f"TTS ({tts_provider})",
                "detail": (
                    f"~{tts_chars:,} characters · {tts_vendor}"
                    + (" (free voice, not charged)" if tts_vendor == "edge" else "")
                ),
                "cost_usd": round(tts_usd, 4),
                "credits": float(_metered_credits(tts_usd, rate_ratio)),
            },
        ]
        if thumbnail_count:
            # The pipeline makes one AI thumbnail per VIDEO run (thumbnail
            # generator, Recraft; Seedream with a custom avatar face), billed
            # as an image event like any other.
            rows.append({
                "component": "Thumbnail",
                "detail": f"{thumbnail_count} image · {_VIDEO_IMAGE_MODEL_ID.split('/')[-1]}",
                "cost_usd": round(thumbnail_count * image_unit, 4),
                "credits": float(_metered_credits(image_unit, rate_ratio) * thumbnail_count),
            })
        if bg_music_on:
            rows.append({
                "component": "Background music (Lyria)",
                "detail": "auto-generated track · included, not charged",
                "cost_usd": round(bg_usd, 4),
                "credits": 0.0,
            })
        if lesson_cost_row:
            rows.append(dict(lesson_cost_row))
        # Host (avatar) cost — appended last so the FE can render it as a
        # distinct line item below the standard breakdown.
        if host_cost_row:
            rows.append(host_cost_row)
            if host_extra_image_count > 0 and host_extra_image_usd > 0:
                rows.append({
                    "component": "Avatar reference images (host)",
                    "detail": f"~{host_extra_image_count} images · seedream-4.5 (per-shot identity)",
                    "cost_usd": round(host_extra_image_usd, 4),
                    "credits": float(_metered_credits(host_image_unit, rate_ratio) * host_extra_image_count),
                })

        # AI video (Veo) upper-bound row — present only when the user
        # opted-in AND the tier supports it. Veo spend is unpredictable
        # (Director picks AI_VIDEO_HERO shots at runtime), so we surface
        # the per-video circuit-breaker cap as the worst case. Same
        # number across low/expected/high — variance doesn't apply here
        # since the cap is fixed.
        if ai_video_enabled and quality_tier in ("ultra", "super_ultra"):
            _av_cap_usd = AI_VIDEO_PER_VIDEO_COST_CAP_USD
            rows.append({
                "component": "AI video (worst case)",
                "detail": (
                    "fal.ai Veo · upper bound = per-video cap. Actual spend "
                    "depends on Director's per-shot decisions."
                    + (
                        " Veo audio enabled (≈+67% per second)."
                        if ai_video_audio_enabled
                        else ""
                    )
                ),
                "cost_usd": round(_av_cap_usd, 4),
                "credits": float(_credits_from_usd(_pricing("ai_video"), _av_cap_usd, rate_ratio)),
            })

        # Dialogue scenes (storybook/drama) — the dominant line item when on.
        # Expected = typical scene count × ~8s clip × the model's per-second
        # rate, honestly capped at the tier's dialogue budget (the runtime
        # circuit breaker). Same number across low/expected/high — the cap,
        # not the band, bounds this spend.
        if dialogue_scenes_enabled:
            _is_drama = str(dialogue_mode or "").lower() == "drama"
            _is_omni = str(dialogue_clip_model or "").lower() == "omni-flash"
            _rate = 0.13 if _is_omni else 0.3034          # $/s of 720p output
            _scenes = 4.5 if _is_drama else 2.5           # planner: drama 3-6, storybook 1-4
            _cap = 20.0 if _is_drama else 6.0             # dialogue_scene_cost_cap_usd defaults
            _dlg_usd = min(_scenes * 8.0 * _rate, _cap)
            _model_label = "Gemini Omni Flash" if _is_omni else "Seedance 2.0"
            rows.append({
                "component": "Dialogue scenes (acted clips)",
                "detail": (
                    f"{'Drama' if _is_drama else 'Storybook'} · {_model_label} · "
                    f"~{int(_scenes)} scenes × ~8s × ${_rate:.2f}/s — hard-capped at "
                    f"${_cap:.0f} by the tier's dialogue budget."
                ),
                "cost_usd": round(_dlg_usd, 4),
                "credits": float(_credits_from_usd(_pricing("ai_video"), _dlg_usd, rate_ratio)),
            })
        return rows

    def _scale(v: int, factor: float) -> int:
        return max(0, int(round(v * factor)))

    expected = _components(dir_in_tokens, dir_out_tokens, seg_in_tokens, seg_out_tokens, image_count)
    low = _components(
        _scale(dir_in_tokens, 1 - _TOKEN_VARIANCE),
        _scale(dir_out_tokens, 1 - _TOKEN_VARIANCE),
        _scale(seg_in_tokens, 1 - _TOKEN_VARIANCE),
        _scale(seg_out_tokens, 1 - _TOKEN_VARIANCE),
        _scale(image_count, 1 - _IMAGE_VARIANCE),
    )
    high = _components(
        _scale(dir_in_tokens, 1 + _TOKEN_VARIANCE),
        _scale(dir_out_tokens, 1 + _TOKEN_VARIANCE),
        _scale(seg_in_tokens, 1 + _TOKEN_VARIANCE),
        _scale(seg_out_tokens, 1 + _TOKEN_VARIANCE),
        _scale(image_count, 1 + _IMAGE_VARIANCE),
    )

    def _sum(rows: List[Dict[str, Any]], k: str) -> float:
        return round(sum(float(r[k]) for r in rows), 4)

    expected_credits = _sum(expected, "credits")
    expected_cost_usd = _sum(expected, "cost_usd")

    estimate = {
        "expected_credits": expected_credits,
        "low_credits": _sum(low, "credits"),
        "high_credits": _sum(high, "credits"),
        "expected_cost_usd": expected_cost_usd,
        "low_cost_usd": _sum(low, "cost_usd"),
        "high_cost_usd": _sum(high, "cost_usd"),
        "breakdown": expected,
        "duration_band": duration_band,
        "assumptions": [
            f"Baseline counts are medians for {quality_tier} @ {duration_band} videos.",
            (
                "Includes Director pass (shot planning) + per-shot HTML generation."
                if uses_director
                else "Uses segment-based shot generation (no Director pass)."
            ),
            f"Range reflects ±{int(_TOKEN_VARIANCE * 100)}% variance on tokens, ±{int(_IMAGE_VARIANCE * 100)}% on image count.",
            f"Current rate: $1 USD → {rate_ratio:.0f} credits (DB-driven, see credit_rate_config).",
        ],
        "model_registered": llm_pricing is not None,
    }
    if not estimate["model_registered"] and effective_model:
        estimate["assumptions"].append(
            f"Model '{effective_model}' is not in ai_models — LLM cost shown as $0. Add it to get an accurate estimate."
        )

    selections = {
        "quality_tier": quality_tier,
        "model": effective_model or None,
        "target_duration": target_duration,
        "duration_band": duration_band,
        "target_audience": target_audience,
        "orientation": orientation,
        "visual_style": visual_style,
        "voice": {"gender": voice_gender, "provider": tts_provider, "voice_id": voice_id},
        "language": language,
        "generate_avatar": generate_avatar,
        "background_music_enabled": bg_music_on,
        "sound_effects_enabled": sound_effects_enabled,
        "content_type": content_type,
        "captions_enabled": captions_enabled,
        "html_quality": html_quality,
        "review_mode": review_mode,
        "attachments_count": attachments_count,
        "host": host if isinstance(host, dict) else None,
    }

    # --- Balance lookup --------------------------------------------------
    balance: Dict[str, Any] = {
        "current": None,
        "after_expected": None,
        "after_high": None,
        "sufficient": True,
        "sufficient_for_high": True,
    }
    if institute_id:
        try:
            bal = credit_service.get_balance(institute_id)
            if bal:
                current = float(bal.current_balance)
                balance["current"] = current
                balance["after_expected"] = round(current - expected_credits, 2)
                balance["after_high"] = round(current - estimate["high_credits"], 2)
                balance["sufficient"] = current >= expected_credits
                balance["sufficient_for_high"] = current >= estimate["high_credits"]
        except Exception as e:
            logger.warning(f"[VideoEstimation] balance lookup failed: {e}")

    return {"selections": selections, "estimate": estimate, "balance": balance}
