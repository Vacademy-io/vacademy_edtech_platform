"""Pipeline stage taxonomy — the canonical enum every LLM call site in the AI
video pipeline maps to. Used by `AIModelsService.get_stage_model_map(...)` to
resolve a stage_id → model_id mapping from the `ai_model_stage_assignments`
table, and by `cost_event_tracker` to bucket cost events per stage.

The taxonomy is intentionally narrower than the set of physical call sites —
the five HTML regen prompts (html_repair / brand_asset / bbox / vision_corrective
/ animation_validator) collapse into one `regen_html` bucket because they share
intent and budget, and admins/users shouldn't have to manage five rows for the
same logical decision.

`USER_OVERRIDABLE` is the subset whose model can be replaced by a user-supplied
override on the video-generation request. Anything outside this set ignores the
override and uses the admin-configured default (matrix row in DB) — this keeps
small utility prompts from blowing up cost when a user picks a premium model
for the critical stages.
"""
from __future__ import annotations

from enum import Enum


class PipelineStage(str, Enum):
    # ── CRITICAL — defines video structure / visual quality ──────────────
    SHOT_PLANNER = "shot_planner"
    NARRATION_WRITER = "narration_writer"
    PER_SHOT_HTML = "per_shot_html"
    VISION_REVIEW = "vision_review"  # admin-pinned reviewer; not user-overridable
    # Hook/CTA/hero shots. No row = no model switch (hero shots keep the
    # per-shot model and only think harder on tiers with `hero_effort`).
    HERO_SHOT = "hero_shot"
    # v2 legacy — overridable until v2 is deleted
    DIRECTOR = "director"
    SCRIPT_GENERATION = "script_generation"
    SCRIPT_REVIEW = "script_review"

    # ── MEDIUM — improves but does not define ────────────────────────────
    ACT_PLANNER = "act_planner"
    BEAT_PLANNER = "beat_planner"  # v2 legacy
    IMAGE_PROMPT_ENHANCEMENT = "image_prompt_enhancement"
    STOCK_VIDEO_RANKING = "stock_video_ranking"
    ENTITY_EXTRACTION = "entity_extraction"
    # Per-run visual signature + LLM-authored transitions (concept tiers).
    DESIGN_IDENTITY = "design_identity"
    EDIT_CHOREOGRAPHER = "edit_choreographer"
    # Director's-eye elevation gate on hero shots (reads a screenshot).
    SHOT_CREATIVITY_CRITIC = "shot_creativity_critic"

    # ── UTILITY — small structured / glue prompts ────────────────────────
    REGEN_HTML = "regen_html"  # collapses html_repair, brand_asset, bbox, vision_corrective, animation_validator
    CULTURAL_CONTEXT = "cultural_context"
    SHOT_DECOMPOSER = "shot_decomposer"
    HOST_DESCRIPTION = "host_description"
    HEADLINE_THUMBNAIL = "headline_thumbnail"
    STOCK_PHOTO_RANKING = "stock_photo_ranking"  # vision pick in "visual" mode
    DIALOGUE_CLIP_QC = "dialogue_clip_qc"  # vision QC of AI dialogue clips


# A stage with no row in `ai_model_stage_assignments` resolves to None, and the
# call then uses the registry's video default (`ai_model_defaults`).

# Stages whose model the user can override via `model_overrides` on the
# video-generation request. Order in this set is preserved for the FE
# advanced-customization expander (matches the order in SettingsPopover).
USER_OVERRIDABLE_STAGES: frozenset[PipelineStage] = frozenset({
    PipelineStage.SHOT_PLANNER,
    PipelineStage.NARRATION_WRITER,
    PipelineStage.PER_SHOT_HTML,
    PipelineStage.DIRECTOR,
    PipelineStage.SCRIPT_GENERATION,
    PipelineStage.SCRIPT_REVIEW,
    PipelineStage.ACT_PLANNER,
    PipelineStage.REGEN_HTML,
})


# Quality-bucket classification — used by telemetry / cost forensics. Not
# read by the resolver (the resolver is bucket-agnostic — it just looks up
# the matrix row for the given stage_id).
class StageBucket(str, Enum):
    CRITICAL = "critical"
    MEDIUM = "medium"
    UTILITY = "utility"


STAGE_BUCKETS: dict[PipelineStage, StageBucket] = {
    PipelineStage.SHOT_PLANNER: StageBucket.CRITICAL,
    PipelineStage.NARRATION_WRITER: StageBucket.CRITICAL,
    PipelineStage.PER_SHOT_HTML: StageBucket.CRITICAL,
    PipelineStage.VISION_REVIEW: StageBucket.CRITICAL,
    PipelineStage.HERO_SHOT: StageBucket.CRITICAL,
    PipelineStage.DIRECTOR: StageBucket.CRITICAL,
    PipelineStage.SCRIPT_GENERATION: StageBucket.CRITICAL,
    PipelineStage.SCRIPT_REVIEW: StageBucket.CRITICAL,
    PipelineStage.ACT_PLANNER: StageBucket.MEDIUM,
    PipelineStage.BEAT_PLANNER: StageBucket.MEDIUM,
    PipelineStage.IMAGE_PROMPT_ENHANCEMENT: StageBucket.MEDIUM,
    PipelineStage.STOCK_VIDEO_RANKING: StageBucket.MEDIUM,
    PipelineStage.ENTITY_EXTRACTION: StageBucket.MEDIUM,
    PipelineStage.DESIGN_IDENTITY: StageBucket.MEDIUM,
    PipelineStage.EDIT_CHOREOGRAPHER: StageBucket.MEDIUM,
    PipelineStage.SHOT_CREATIVITY_CRITIC: StageBucket.MEDIUM,
    PipelineStage.REGEN_HTML: StageBucket.UTILITY,
    PipelineStage.CULTURAL_CONTEXT: StageBucket.UTILITY,
    PipelineStage.SHOT_DECOMPOSER: StageBucket.UTILITY,
    PipelineStage.HOST_DESCRIPTION: StageBucket.UTILITY,
    PipelineStage.HEADLINE_THUMBNAIL: StageBucket.UTILITY,
    PipelineStage.STOCK_PHOTO_RANKING: StageBucket.UTILITY,
    PipelineStage.DIALOGUE_CLIP_QC: StageBucket.UTILITY,
}


def is_user_overridable(stage: PipelineStage | str) -> bool:
    """True if a user-supplied `model_overrides` entry can replace the admin
    default for this stage. Vision review and small utility prompts always
    return False — these are pinned to admin defaults to protect quality and
    cost budgets."""
    if isinstance(stage, str):
        try:
            stage = PipelineStage(stage)
        except ValueError:
            return False
    return stage in USER_OVERRIDABLE_STAGES


__all__ = [
    "PipelineStage",
    "StageBucket",
    "USER_OVERRIDABLE_STAGES",
    "STAGE_BUCKETS",
    "is_user_overridable",
]
