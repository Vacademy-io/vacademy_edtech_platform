"""
Schemas for AI Video Generation API.
"""
from __future__ import annotations

import logging
from typing import Optional, Dict, Any, List, Literal
from pydantic import BaseModel, Field, model_validator

_log = logging.getLogger(__name__)


class VideoCostPreviewRequest(BaseModel):
    """
    Request for the pre-generation credit/cost preview. Mirrors VideoGenerationRequest
    but allows omitting prompt/files (estimate is heuristic, doesn't need them).
    """
    quality_tier: str = "ultra"
    model: Optional[str] = None
    target_duration: str = "2-3 minutes"
    target_audience: str = "General/Adult"
    orientation: Literal["landscape", "portrait"] = "landscape"
    visual_style: str = "standard"
    voice_gender: str = "female"
    tts_provider: str = "standard"
    voice_id: Optional[str] = None
    language: str = "English"
    generate_avatar: bool = False
    background_music_enabled: Optional[bool] = None
    sound_effects_enabled: bool = True
    content_type: str = "VIDEO"
    captions_enabled: bool = True
    html_quality: str = "advanced"
    review_mode: bool = False
    attachments_count: int = 0
    host: Optional["HostConfig"] = None
    lesson: Optional["LessonConfig"] = None
    # When true, the estimator adds an AI video (Veo) upper-bound row to
    # the breakdown so the FE pre-submit panel surfaces the worst-case
    # spend. Ultra/super_ultra tiers only — silently ignored otherwise.
    ai_video_enabled: bool = False
    ai_video_audio_enabled: bool = False
    # Dialogue scenes (storybook/drama) — the dominant cost line when on.
    # The estimator adds an expected-scenes × per-second-rate row, capped
    # at the tier's dialogue budget.
    dialogue_scenes_enabled: bool = False
    dialogue_mode: str = "storybook"
    dialogue_clip_model: str = "seedance-2.0"


class VideoCostPreviewResponse(BaseModel):
    selections: Dict[str, Any]
    estimate: Dict[str, Any]
    balance: Dict[str, Any]


# Upper bound on indexed input assets per run. Images are cheap (one metadata
# JSON each) so the ceiling is set by prompt budget, not media cost; the
# per-image OCR block scales down as the count rises. Videos stay capped at
# MAX_INPUT_VIDEOS in the service layer.
MAX_INPUT_ASSETS = 20
MAX_INPUT_VIDEOS = 5


class ReferenceFileItem(BaseModel):
    """A reference file (image or PDF) attached to a generation request."""
    url: str = Field(..., description="Public S3 URL of the file")
    name: str = Field(..., description="Original filename (e.g., 'diagram.png')")
    type: Literal["image", "pdf"] = Field(..., description="File type: 'image' or 'pdf'")


# ---------------------------------------------------------------------------
# Per-stage model overrides
# ---------------------------------------------------------------------------
# The video pipeline has ~17 distinct LLM stages. By default each stage uses
# the model assigned in the `ai_model_stage_assignments` matrix (per
# quality_tier × stage_id). User overrides on this DTO replace the matrix
# value for stages whose `user_overridable` flag is true:
#   shot_planner, narration_writer, per_shot_html, act_planner, regen_html,
#   plus v2-legacy director / script_generation / script_review.
# Vision review + utility prompts (cultural_context, headline_thumbnail,
# host_description, etc.) ignore the override — they're pinned to admin
# defaults to protect cost + quality.
#
# Resolution order per stage:
#   1. overrides.per_stage[stage] if set     → source="user_per_stage"
#   2. overrides.default if set              → source="user_default"
#   3. matrix row (admin default)            → source="matrix"

class ModelOverrides(BaseModel):
    """Per-stage user model overrides for an AI video run."""
    default: Optional[str] = Field(
        default=None,
        max_length=200,
        description=(
            "Mass-pick model for every user-overridable stage. Equivalent to "
            "the legacy single `model` field on VideoGenerationRequest."
        ),
    )
    per_stage: Optional[Dict[str, str]] = Field(
        default=None,
        description=(
            "Per-stage explicit overrides. Keys must be user-overridable stage "
            "IDs from `app.constants.pipeline_stages.PipelineStage`; unknown or "
            "non-overridable keys are silently ignored. Wins over `default`."
        ),
    )

    @model_validator(mode="after")
    def _validate_model_strings(self) -> "ModelOverrides":
        """Light validation — reject empty / oversized / non-string entries.

        Full DB validation (model exists in `ai_models`, is_active=TRUE,
        `recommended_for @> 'video'`) happens at the service layer via
        AIModelsService — this is the FIRST line of defense at the boundary
        to keep obviously bad payloads out of the resolver path.
        """
        if self.default is not None:
            v = self.default.strip()
            if not v:
                self.default = None
            elif "/" not in v:  # all known model_ids are 'provider/model'
                raise ValueError(
                    f"model_overrides.default '{self.default}' is not a valid "
                    f"model identifier (expected 'provider/model' shape)."
                )
            else:
                self.default = v
        if self.per_stage:
            cleaned: Dict[str, str] = {}
            for k, val in self.per_stage.items():
                if not isinstance(val, str):
                    continue
                vs = val.strip()
                if not vs:
                    continue
                if len(vs) > 200:
                    raise ValueError(
                        f"model_overrides.per_stage[{k!r}] exceeds 200 chars."
                    )
                if "/" not in vs:
                    raise ValueError(
                        f"model_overrides.per_stage[{k!r}] '{val}' is not a "
                        f"valid model identifier (expected 'provider/model')."
                    )
                cleaned[str(k)] = vs
            self.per_stage = cleaned or None
        return self


# ---------------------------------------------------------------------------
# Host (on-screen narrator) — first-class concept added in this round.
# Two host kinds:
#   • avatar — AI talking head (per-shot Seedream image-to-image conditioned on
#     the user's face image, then fal.ai turns each (image + audio slice) into
#     a lip-synced video).
#   • raw    — splice clips from already-indexed input videos (uses
#     face_segments[].free_regions for overlay placement). Plumbing only this
#     round; generation path returns 501 until we ship raw-host logic.
#
# Tier-gated: ultra / super_ultra only. Lower tiers reject at the API layer.
# ---------------------------------------------------------------------------

AvatarModelLiteral = Literal[
    "fal-ai/kling-video/ai-avatar/v2/standard",
    "fal-ai/kling-video/ai-avatar/v2/pro",
    "fal-ai/heygen/avatar4/image-to-video",
    "veed/fabric-1.0",
    "fal-ai/flashtalk",
    # LTX 2.3 audio-to-video. General audio-driven generator (not a dedicated
    # lip-sync avatar) — supports a tunable `avatar_fps`.
    "fal-ai/ltx-2.3-quality/audio-to-video",
    # Seedance 2.0 reference-to-video. Audio-capable (reference image + driving
    # audio → video). Per-second priced, ≤15s audio cap, no fps param.
    "bytedance/seedance-2.0/reference-to-video",
]

# Provider for studio_avatar / saved-avatar resolution. Single source of truth —
# referenced by HostAvatarPlan.provider in routing.py and by
# vimotion_resolver._ALLOWED_PROVIDERS so the resolver allow-list cannot drift.
AvatarProviderLiteral = Literal["custom", "argil", "veed"]


class HostAvatarConfig(BaseModel):
    """Avatar-host inputs. Required when host.type='avatar'.

    Two valid shapes:

    1. **Custom (legacy)** — caller supplies `face_image_url` (+ optional
       `details_prompt`, `avatar_model`, `quality`). Pipeline runs the full
       Seedream image-to-image → Kling/Fabric talking-head path.

    2. **Saved (vim)** — caller supplies `saved_avatar_id`. Server resolves
       the studio_avatar row, fills `face_image_url`/`details_prompt`/voice
       overrides from it, and (for non-custom providers) routes per-shot
       generation to the matching fal.ai built-in catalog endpoint
       (Argil / VEED Avatars), skipping Seedream entirely.
    """
    face_image_url: Optional[str] = Field(
        default=None,
        description="Public S3 URL of a clear, front-facing face photo. Required for custom avatars; ignored for built-ins (Argil/VEED) since identity is locked to the catalog enum.",
    )
    details_prompt: str = Field(
        default="",
        description="User-supplied description of the host: clothing, demeanour, background hints. Threaded into per-shot Seedream prompts (custom only).",
    )
    avatar_model: AvatarModelLiteral = Field(
        default="fal-ai/kling-video/ai-avatar/v2/standard",
        description="fal.ai model used for custom-avatar talking-head video. Ignored when the resolved provider is argil or veed (their endpoints are fixed).",
    )
    quality: Literal["480p", "720p"] = Field(
        default="480p",
        description="Avatar video resolution. Same per-second price for both qualities.",
    )
    avatar_fps: Optional[int] = Field(
        default=None,
        ge=1,
        le=60,
        description=(
            "Output frames-per-second. Only used by audio-to-video models that "
            "expose it (LTX 2.3 `fal-ai/ltx-2.3-quality/audio-to-video`); "
            "ignored by the dedicated lip-sync avatars (Kling/HeyGen/Fabric/"
            "FlashTalk). None → the model's own default (24)."
        ),
    )
    saved_avatar_id: Optional[str] = Field(
        default=None,
        description="Vimotion studio_avatar.id — when set, server-resolves provider/face_image_url/voice from the row and overrides the matching fields in this config.",
    )
    use_avatar_voice: bool = Field(
        default=True,
        description="When a saved avatar carries voice metadata (voice_id/provider/language/gender), apply it on top of the request's voice fields. Set false to keep the request's voice and ignore the avatar's saved voice.",
    )


class HostRawConfig(BaseModel):
    """Raw-host inputs. Required when host.type='raw'. Generation path is plumbed only this round."""
    input_video_ids: List[str] = Field(
        ...,
        min_length=1,
        description="One or more already-indexed input video IDs (must be COMPLETED). Director picks clips from these.",
    )


class HostConfig(BaseModel):
    """Optional on-screen host. ultra / super_ultra only."""
    type: Literal["avatar", "raw"] = Field(
        default="avatar",
        description="'avatar' = AI talking head per shot. 'raw' = clips from indexed input videos.",
    )
    host_in_video_percentage: int = Field(
        default=100, ge=0, le=100,
        description=(
            "Percentage of shots that feature the host on screen. "
            "100 = host on screen for every shot. "
            "Lower values = host appears in N% of shots, picked by the Director "
            "with emphasis weighting (Hook, Recap, CTA, high-emphasis beats). "
            "Narration audio plays continuously regardless."
        ),
    )
    avatar: Optional[HostAvatarConfig] = None
    raw: Optional[HostRawConfig] = None

    @model_validator(mode="after")
    def _validate(self):
        if self.type == "avatar" and not self.avatar:
            raise ValueError("host.avatar is required when host.type == 'avatar'")
        if self.type == "raw" and not self.raw:
            raise ValueError("host.raw is required when host.type == 'raw'")
        # Avatar identity must come from somewhere: either a face image URL
        # (custom path) or a saved_avatar_id the server can resolve to one.
        # Resolution happens server-side at request entry, before the
        # pipeline runs — so validation here just enforces that *some*
        # identity hook is present.
        if self.type == "avatar" and self.avatar is not None:
            if not self.avatar.face_image_url and not self.avatar.saved_avatar_id:
                raise ValueError(
                    "host.avatar requires either face_image_url (custom upload) "
                    "or saved_avatar_id (resolved server-side)."
                )
        return self


class LessonTeacherConfig(BaseModel):
    """The on-screen teacher of a lesson — a Spatius avatar the institute may
    use (platform stock or its own, as listed by GET /tutor/options)."""
    avatar_id: str = Field(..., min_length=8, max_length=160, description="Spatius avatar id.")
    name: Optional[str] = Field(default=None, max_length=60, description="Shown on the teacher panel.")
    title: Optional[str] = Field(default=None, max_length=60, description="e.g. 'Maths teacher'.")


class LessonConfig(BaseModel):
    """Lesson mode: an education video taught by a teacher at a board.

    The planner paces it as a lesson (6-20 s sections, no shot cap, hook →
    concepts → worked example → recap), the narration is written as a
    teacher, and — when `teacher` is set — a Spatius avatar appears beside
    the board in a per-section layout."""
    enabled: bool = True
    teacher: Optional[LessonTeacherConfig] = Field(
        default=None, description="None = board-only lesson (no on-screen teacher).",
    )
    layout: Literal["auto", "corner", "bubble", "side", "presenter", "board"] = Field(
        default="auto",
        description=(
            "Where the teacher sits. corner = small cut-out bottom-right; bubble = round "
            "270 px bubble bottom-right; side = slim right panel (25%); presenter = right "
            "panel (36%); board = no teacher. 'auto' lets the planner choose per section "
            "(presenter for the hook, side for explanations, corner for dense boards)."
        ),
    )
    subject: Optional[str] = Field(default=None, max_length=80, description="e.g. 'Mathematics', 'Physics'.")
    include_worked_example: bool = True
    include_recap: bool = True


# ---------------------------------------------------------------------------
# Visual preferences — soft per-family bias hints + on-screen text density.
#
# Set either by the FE Advanced Settings sliders OR detected from the user's
# prompt by the IntentRouter free-text scanner (free-text wins on overlap).
# Slice A only PERSISTS these signals into extra_metadata; Slices B/C/D
# inject them into the Script LLM, Director, and per-shot HTML prompts.
# ---------------------------------------------------------------------------

FamilyBias = Literal["no", "auto", "high"]
TextDensity = Literal["minimal", "low", "auto", "rich"]


class VisualPreferences(BaseModel):
    """Soft per-family bias hints + on-screen text density.

    All fields are optional. None = "field not set" (caller can treat as
    "auto"). Slices B/C/D distinguish "explicitly set to auto" from
    "untouched" so logging/observability can show what the user actually
    requested vs what we inferred.
    """
    stock_video: Optional[FamilyBias] = Field(
        default=None,
        description="Bias for VIDEO_HERO + IMAGE_HERO with stock footage / real video.",
    )
    ai_imagery: Optional[FamilyBias] = Field(
        default=None,
        description="Bias for shots with AI-generated images (Seedream).",
    )
    svg_illustrated: Optional[FamilyBias] = Field(
        default=None,
        description="Bias for INFOGRAPHIC_SVG / KINETIC_TITLE / ANNOTATION_MAP.",
    )
    motion_graphics: Optional[FamilyBias] = Field(
        default=None,
        description=(
            "Bias for TEXT_DIAGRAM / PROCESS_STEPS / DATA_STORY / "
            "EQUATION_BUILD / ANIMATED_ASSET / KINETIC_TEXT."
        ),
    )
    app_ui_mockup: Optional[FamilyBias] = Field(
        default=None,
        description="Bias for DEVICE_MOCKUP (HTML-rendered app/web/mobile UI).",
    )
    ai_video: Optional[FamilyBias] = Field(
        default=None,
        description=(
            "Bias for AI_VIDEO_HERO and inline <aivideo> clips (fal.ai Veo). "
            "Ultra+ tiers only; even when set, requires per-run "
            "ai_video_enabled=true to actually trigger Veo calls."
        ),
    )
    text_density: Optional[TextDensity] = Field(
        default=None,
        description=(
            "On-screen visible text density (does NOT affect narration length). "
            "minimal = title-only on hooks, no body anywhere. "
            "low = short headlines, no body, drop subtitles. "
            "auto = pipeline default. "
            "rich = full headlines + supporting labels (current behavior). "
            "On minimal/low, KINETIC_TEXT is forbidden by the Director."
        ),
    )
    visual_style_mode: Optional[str] = Field(
        default=None,
        description=(
            "Overall visual aesthetic for the whole video (overrides auto-detection). "
            "'educational' = clean flat 'whiteboard' look (the default for lectures). "
            "'marketing' = premium modern brand-film look — depth, choreographed motion, "
            "finishing, imagery-forward, keywords-only on-screen text. "
            "'bold' = marketing + high-energy social-ad styling. "
            "None = auto-detect from content (marketing/product/ad → marketing, else educational)."
        ),
    )


# Content types supported by the generation pipeline
ContentTypeEnum = Literal[
    "VIDEO",              # Time-synced HTML overlays with audio (default)
    "QUIZ",               # Question-based assessments  
    "STORYBOOK",          # Page-by-page narratives
    "INTERACTIVE_GAME",   # Self-contained HTML games
    "PUZZLE_BOOK",        # Collection of puzzles
    "SIMULATION",         # Physics/economic sandboxes
    "FLASHCARDS",         # Spaced-repetition cards
    "MAP_EXPLORATION",    # Interactive SVG maps
    # New content types
    "WORKSHEET",          # Printable/interactive homework
    "CODE_PLAYGROUND",    # Interactive code exercises
    "TIMELINE",           # Chronological event visualization
    "CONVERSATION",       # Language learning dialogues
    "SLIDES"              # HTML-based presentation / PPT-style slide deck
]


class BrandOverrides(BaseModel):
    """Per-video overrides that layer ON TOP of the resolved brand kit (or the
    institute defaults when no kit is selected) for a single generation.

    Set by the FE "Override for this video" panel next to the brand-kit picker.
    These are one-shot — the FE does not persist them across videos.

    Merge semantics (applied in video_generation_service._run_pipeline_stages):
      * palette — shallow field-level merge over the kit's palette (only the
        provided color keys win; the rest fall through to the kit / institute).
      * intro / outro / watermark — when provided, the whole section replaces
        that section of the resolved branding for this run.
      * system_prompt — when provided (non-empty), REPLACES the kit's
        system_prompt entirely for this run (per the product decision).
    """
    palette: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Color overrides { primary?, secondary?, accent?, background? }. Field-level merge over the kit palette.",
    )
    intro: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Intro override { enabled, duration_seconds, html }. Replaces the kit/institute intro for this run.",
    )
    outro: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Outro override { enabled, duration_seconds, html }. Replaces the kit/institute outro for this run.",
    )
    watermark: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Watermark override { enabled, position, opacity, html, ... }. Replaces the kit/institute watermark for this run.",
    )
    system_prompt: Optional[str] = Field(
        default=None,
        max_length=4000,
        description=(
            "Free-text director instructions for THIS video. When set, REPLACES "
            "the brand kit's system_prompt for this run. Works with or without a "
            "brand kit selected."
        ),
    )


class DecisionAnswerRequest(BaseModel):
    """Body for POST /external/video/v1/{video_id}/decision — answer an assist gate.

    The user resolves a pending decision (surfaced via a `decision_required` SSE
    event) by selecting an option, editing the draft, typing free-form steering,
    or deferring to the AI. The backend records the answer, writes the per-gate
    sidecar artifact, and resumes the next generation leg.
    """

    decision_id: str = Field(..., description="Must match the pending decision's id (idempotency guard).")
    gate_type: str = Field(..., description="Gate being answered: shot_plan | narration | visual_casting | …")
    mode: str = Field(
        ...,
        description=(
            "select | edit | freeform | auto | auto_all. "
            "'auto' = let the AI decide this one; 'auto_all' = let the AI decide this "
            "and all remaining decisions of the same gate type."
        ),
    )
    answer: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Gate-specific answer. select: {selected_option_id}. "
            "edit(shot_plan): {shots:[...]}. edit(narration): {shots:[{shot_index,narration_text}], full_script}. "
            "edit(visual_casting): {selections:[{shot_index,candidate_id}]}. "
            "freeform: {text}. auto/auto_all: {}."
        ),
    )


class VideoGenerationRequest(BaseModel):
    """Request for generating AI video or interactive content."""

    prompt: str = Field(..., description="Text prompt for content generation")
    content_type: ContentTypeEnum = Field(
        default="VIDEO",
        description="Type of content to generate. Determines navigation mode and required libraries."
    )
    language: str = Field(default="English", description="Language for content (e.g., English, Spanish, French)")
    captions_enabled: bool = Field(default=True, description="Enable/disable captions (primarily for VIDEO type)")
    html_quality: str = Field(default="advanced", description="HTML quality mode: 'classic' (frames/animation only) or 'advanced' (all features)")
    video_id: Optional[str] = Field(default=None, description="Optional content ID (generated if not provided)")
    target_audience: str = Field(
        default="General/Adult", 
        description="Target audience for age-appropriate content. Examples: 'Class 3 (Ages 7-8)', 'Class 9-10 (Ages 14-15)', 'College/Adult'"
    )
    target_duration: str = Field(
        default="2-3 minutes", 
        description="Target duration for VIDEO type. For other types, controls content length."
    )
    institute_id: Optional[str] = Field(
        default=None,
        description="Institute identifier (optional, for logging/context)"
    )
    user_id: Optional[str] = Field(
        default=None,
        description="User identifier (optional, for logging/context)"
    )
    # ── Assist mode (conversational, human-in-the-loop) ──────────────
    assist_mode: bool = Field(
        default=False,
        description=(
            "When True, the pipeline pauses at enabled decision gates (shot plan, "
            "narration, visual casting, …), emits a `decision_required` SSE event, "
            "persists the pending decision, and stops the leg cleanly until the user "
            "answers via POST /external/video/v1/{video_id}/decision. Generalises "
            "the legacy review_mode. Default False = fully autonomous (Auto mode)."
        ),
    )
    assist_gates: Optional[List[str]] = Field(
        default=None,
        description=(
            "Which decision gates to enable when assist_mode is True. Subset of "
            "['creative_concept','shot_plan','styleframe','asset_request','narration',"
            "'cast','visual_casting','shot_look','contact_sheet','voice','music','avatar']. "
            "None → the default gate set (see decision_gates.DEFAULT_ASSIST_GATES)."
        ),
    )
    assist_granularity: str = Field(
        default="per_decision",
        description=(
            "How finely assist mode pauses: 'per_decision' (pause at each individual "
            "choice, incl. per-shot) or 'batched' (consolidate same-kind choices). "
            "v1 uses per_decision; 'batched' reserved for a future option."
        ),
    )
    model: Optional[str] = Field(
        default=None,
        description=(
            "DEPRECATED single-model override. When set without `model_overrides`, "
            "the service-layer resolver collapses it to `ModelOverrides(default=model)` "
            "so it applies only to user-overridable critical stages. Prefer "
            "`model_overrides` going forward."
        ),
    )
    model_overrides: Optional["ModelOverrides"] = Field(
        default=None,
        description=(
            "Per-stage user model overrides. `default` mass-applies to every "
            "user-overridable stage (ShotPlanner, NarrationWriter, per-shot HTML, "
            "act planner, regen HTML, plus v2-legacy script/director stages). "
            "`per_stage` overrides individual stages (per_stage wins over default). "
            "Vision review + small utility prompts ignore both and stay on admin "
            "defaults. Omit entirely to use admin defaults for everything."
        ),
    )
    quality_tier: str = Field(
        default="ultra",
        description="Quality tier: 'free', 'standard', 'premium', 'ultra', 'super_ultra'. Controls two-pass script review, HTML validation, image prompt enhancement, crossfade transitions, kinetic text shots, and other quality features."
    )
    brand_kit_id: Optional[str] = Field(
        default=None,
        description=(
            "Vimotion brand_kit.id — when set, the kit's palette/fonts/layout/intro/outro/watermark "
            "REPLACE the institute-wide VIDEO_STYLE + VIDEO_BRANDING for this run (no merge). Server "
            "resolves the row scoped by institute_id; an unresolved id falls back to institute defaults. "
            "The kit's system_prompt (free-text director instructions) is also resolved here and injected "
            "into the planner/narration/per-shot prompts."
        )
    )
    brand_overrides: Optional["BrandOverrides"] = Field(
        default=None,
        description=(
            "Per-video overrides layered on top of the resolved brand kit (or the "
            "institute defaults when no kit). palette is field-merged; "
            "intro/outro/watermark replace those branding sections for this run; "
            "system_prompt REPLACES the kit's director instructions for this run. "
            "One-shot — the FE does not persist these across videos."
        ),
    )
    voice_gender: str = Field(
        default="female",
        description="Voice gender for TTS (VIDEO/STORYBOOK): 'male' or 'female'. Default is 'female'."
    )
    tts_provider: str = Field(
        default="standard",
        description="TTS tier: 'standard' (Microsoft Edge TTS, free) or 'premium' (Google Cloud / Sarvam AI). Premium auto-routes: Indian languages → Sarvam AI, global languages → Google Cloud TTS."
    )
    voice_id: Optional[str] = Field(
        default=None,
        description="Specific voice ID for premium TTS. For Sarvam (Indian): e.g. 'ritu', 'shubh', 'priya'. For Google: e.g. 'en-US-Journey-F'. If not provided, a default voice is chosen based on language and gender."
    )
    generate_avatar: bool = Field(
        default=False,
        description="Whether to generate a talking head avatar. Defaults to False."
    )
    avatar_image_url: Optional[str] = Field(
        default=None,
        description="URL of a face/portrait image for the speaking avatar. If not provided, a default teacher image is used. Only applies to VIDEO content type."
    )
    reference_files: Optional[List[ReferenceFileItem]] = Field(
        default=None,
        description="List of reference files (images/PDFs) to include in generation"
    )
    routing_overrides: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Sparse override for the auto-routing plan. "
            "Example: {'tools': {'scrape_url': false}, 'config': {'mute_tts_on_source_clips': true}}. "
            "User toggles win over router decisions."
        )
    )
    orientation: Literal["landscape", "portrait"] = Field(
        default="landscape",
        description="Video orientation: 'landscape' (1920x1080, 16:9) or 'portrait' (1080x1920, 9:16)"
    )
    visual_style: str = Field(
        default="standard",
        description=(
            "DEPRECATED — accepted for API back-compat but no longer gates behavior. "
            "The Director LLM now picks theme, background, and animation language "
            "per-shot based on content, and can shift styles across a long video's "
            "timeline. Kept on the request schema so existing clients don't break."
        )
    )
    sound_effects_enabled: bool = Field(
        default=True,
        description=(
            "Enable automatic sound effects (transitions, chimes, impacts) baked "
            "into the video timeline. When True (default at premium+), the Sound "
            "Planner derives cues from shot types, sync points, skill audio events "
            "and narration emphasis — no extra Director burden. When False, all "
            "cues are suppressed regardless of tier."
        )
    )
    input_video_id: Optional[str] = Field(
        default=None,
        description=(
            "ID of a COMPLETED indexed video (from ai_input_videos table). "
            "When provided, the Director can plan SOURCE_CLIP shots that play "
            "clips from the source video with HTML overlays on top. "
            "Deprecated — use input_video_ids instead. Kept for backward compat."
        )
    )
    input_video_ids: Optional[List[str]] = Field(
        default=None,
        description=(
            "List of COMPLETED indexed video IDs (max 5). The Director can plan "
            "SOURCE_CLIP shots referencing any of these via source_video_index. "
            "Supersedes input_video_id when both are provided."
        )
    )
    input_video_audio: Optional[str] = Field(
        default=None,
        description=(
            "Audio source when input videos are set. "
            "'original' = use source video audio as narration (single video only). "
            "'tts' = generate AI narration (script+TTS run normally). "
            "Forced to 'tts' when multiple input videos are provided."
        )
    )
    background_music_enabled: Optional[bool] = Field(
        default=None,
        description=(
            "Enable auto-generated background music (Google Lyria). "
            "None = use tier default (on for ultra/super_ultra, off otherwise). "
            "True/False overrides. Requires ultra+ tier — ignored on lower tiers. "
            "The generated score appears as a single 'Background Music' entry in "
            "meta.audio_tracks[] and is editable/deletable via the audio tracks UI."
        )
    )
    background_music_volume: Optional[float] = Field(
        default=None, ge=0.0, le=1.0,
        description=(
            "Initial volume multiplier (0.0-1.0) for the generated background music "
            "track. If omitted, uses the tier default (0.20). Users can adjust post-"
            "generation via the audio-tracks UI."
        )
    )
    sub_shots_enabled: bool = Field(
        default=False,
        description=(
            "Experimental: when True, the pipeline runs a quick decomposer on each "
            "shot and may split dense shots into 2 focused sub-shots before HTML "
            "generation. Improves visual precision on motion-heavy scenes at the "
            "cost of one extra small LLM call per qualifying shot."
        )
    )
    dialogue_scenes_enabled: bool = Field(
        default=False,
        description=(
            "Storybook/drama mode: when True, the plan may include DIALOGUE_SCENE "
            "shots — fully AI-generated clips (Seedance 2.0) where characters speak "
            "on camera, lip-synced to per-character TTS lines in consistent voices. "
            "The clip carries its own audio (master narration silent in that window). "
            "Adds generation cost (~$0.30/s of dialogue clip at 720p, capped per video)."
        )
    )
    dialogue_clip_model: Literal["seedance-2.0", "omni-flash"] = Field(
        default="seedance-2.0",
        description=(
            "Only meaningful when dialogue_scenes_enabled=True. Which video model "
            "films the DIALOGUE_SCENE clips. 'seedance-2.0' (default) = voice-locked: "
            "characters lip-sync to OUR per-character TTS, so voices stay identical "
            "across scenes and sequel videos (~$0.30/s at 720p). 'omni-flash' = "
            "Gemini Omni Flash: the model speaks the lines itself — cheaper "
            "(~$0.13/s) and strong visuals, but voices are model-invented per clip "
            "and may drift between scenes; clips cap at 10s (vs 15s)."
        )
    )
    dialogue_mode: Literal["storybook", "drama"] = Field(
        default="storybook",
        description=(
            "Only meaningful when dialogue_scenes_enabled=True. 'storybook' = narrator "
            "carries the video with 1-4 dialogue scenes at dramatic moments. 'drama' = "
            "PURE dialogue film: every shot is a DIALOGUE_SCENE, no narrator, background "
            "music off (clips carry their own ambience), higher clip budget."
        )
    )
    cast_id: Optional[str] = Field(
        default=None,
        description=(
            "Reuse a saved cast (see /cast endpoints): the planner keeps these exact "
            "characters (names + verbatim portraits), the pipeline reuses their stored "
            "reference sheets (same faces) and voice mapping (same voices) — a series "
            "of storybook/drama videos with a consistent cast."
        )
    )
    mute_tts_on_source_clips: bool = Field(
        default=False,
        description=(
            "When True and audio is 'tts', source video audio is mixed INTO the "
            "TTS narration during SOURCE_CLIP shots (muting TTS during those clips). "
            "Default False: TTS narration plays continuously throughout the video; "
            "source video clips are visual-only. Use True for podcast-style videos "
            "where you want to hear the speaker. Use False for marketing/explainer "
            "videos where the TTS script is the main content."
        )
    )
    lesson: Optional[LessonConfig] = Field(
        default=None,
        description=(
            "Lesson mode for education videos: lesson pacing, a teacher's narration and "
            "(optionally) a Spatius teacher beside the board. Not combinable with `host`."
        ),
    )
    host: Optional[HostConfig] = Field(
        default=None,
        description=(
            "Optional on-screen host (narrator). Available on ultra / super_ultra "
            "tiers only — request is rejected on lower tiers when host is set. "
            "When set, the script is rewritten in 1st person and the host appears "
            "in `host_in_video_percentage`%% of shots, full-frame, with motion "
            "graphics overlaid in free regions."
        )
    )
    visual_preferences: Optional[VisualPreferences] = Field(
        default=None,
        description=(
            "Soft per-family bias hints + on-screen text density. Set by the FE "
            "Advanced Settings sliders. Free-text phrases in the prompt "
            "(e.g. 'use more SVG diagrams', 'less text on screen') override "
            "individual fields via the IntentRouter free-text scanner."
        ),
    )

    # ---------------------------------------------------------------------
    # AI video generation (fal.ai veo3.1/lite) — ultra+ only, opt-in per run
    # ---------------------------------------------------------------------
    ai_video_enabled: bool = Field(
        default=False,
        description=(
            "Enable AI video generation (fal.ai Veo) for this run. Ultra and "
            "super_ultra tiers only; ignored on lower tiers. When true, the "
            "Director may emit AI_VIDEO_HERO shots and per-shot HTML may "
            "include inline <aivideo> tags. Each call costs $0.24-$0.40; "
            "circuit-broken at $1.50 per video."
        ),
    )
    ai_video_audio_enabled: bool = Field(
        default=False,
        description=(
            "When ai_video_enabled is on, this lets Veo clips bring their own "
            "audio (generate_audio=true on the Veo call). Master narration is "
            "silenced during those shots. Veo audio is $0.05/s instead of "
            "$0.03/s; only meaningful with ai_video_enabled=true."
        ),
    )
    ai_video_model: Optional[str] = Field(
        default=None,
        description=(
            "Optional override for the AI video model. Defaults to "
            "'fal-ai/veo3.1/lite'. Currently the only supported value; the "
            "field exists so future models slot in without a schema change."
        ),
    )

    @model_validator(mode="after")
    def _normalize_input_videos(self):
        """Normalize input_video_id → input_video_ids and enforce multi-source rules."""
        # Backward compat: wrap singular into list
        if self.input_video_id and not self.input_video_ids:
            self.input_video_ids = [self.input_video_id]
        # If both set, list takes precedence
        if self.input_video_ids:
            # Polymorphic asset ids: this list carries both indexed videos and
            # indexed images and the schema cannot tell them apart (kind lives
            # on the row). The old flat cap of 5 was sized for videos — each is
            # a large download plus an index job — and silently truncated an
            # image-led run to 5 stills, which is not enough to walk a product
            # flow. Ceiling raised for images; the video-specific cap is
            # enforced in the service layer, where `kind` is known.
            self.input_video_ids = self.input_video_ids[:MAX_INPUT_ASSETS]
            # Set singular to first for backward compat downstream
            self.input_video_id = self.input_video_ids[0]
            # Multi-source forces TTS (can't splice different audio tracks)
            if len(self.input_video_ids) > 1 and self.input_video_audio == "original":
                _log.warning(
                    "Multi-source input videos force TTS audio "
                    "(cannot splice multiple source audio tracks)"
                )
                self.input_video_audio = "tts"
        return self

    class Config:
        json_schema_extra = {
            "example": {
                "prompt": "Explain the concept of quantum entanglement to a 5 year old",
                "content_type": "VIDEO",
                "language": "English",
                "captions_enabled": True,
                "html_quality": "advanced",
                "video_id": "quantum-entanglement-101",
                "target_audience": "Class 3 (Ages 7-8)",
                "target_duration": "5 minutes",
                "voice_gender": "female",
                "tts_provider": "standard",
                "voice_id": None,
                "avatar_image_url": None,
                "orientation": "landscape",
                "reference_files": [
                    {"url": "https://bucket.s3.amazonaws.com/file1.png", "name": "diagram.png", "type": "image"},
                    {"url": "https://bucket.s3.amazonaws.com/file2.pdf", "name": "notes.pdf", "type": "pdf"}
                ]
            }
        }


class VideoGenerationResumeRequest(BaseModel):
    """Request for resuming video generation from a checkpoint."""
    
    video_id: str = Field(..., description="Video ID to resume")
    generate_avatar: bool = Field(
        default=False,
        description="Whether to generate a talking head avatar. Defaults to False."
    )
    avatar_image_url: Optional[str] = Field(
        default=None,
        description="URL of a face/portrait image for the speaking avatar. If not provided, a default teacher image is used."
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "video_id": "quantum-entanglement-101",
                "avatar_image_url": None
            }
        }


class VideoStatusResponse(BaseModel):
    """Response for video/content generation status."""

    id: str
    video_id: str
    current_stage: str
    status: str
    content_type: str = Field(default="VIDEO", description="Content type: VIDEO, QUIZ, STORYBOOK, etc.")
    file_ids: Dict[str, Optional[str]]
    # Values are USUALLY a single URL string (one S3 object per stage). Some
    # keys carry richer shapes that we MUST not reject at the schema layer:
    #   • `per_shot_tts`: dict mapping `shot_NNN` → mp3 URL (Phase B
    #     per-shot TTS, 2026-05).
    #   • Future v3 keys (shot_plan checkpoint metadata, brand kit refs,
    #     etc.) may carry nested dict / list shapes.
    # The previous tighter type `Optional[Union[str, Dict[str, str]]]`
    # bombed history/status endpoints with HTTP 500 whenever Pydantic
    # couldn't validate against the str variant first. `Any` makes the
    # value schema permissive — clients still get the right shape on the
    # wire, the API just stops failing on additive backend changes.
    # Downstream readers should `isinstance(v, str)` / `isinstance(v, dict)`
    # when they expect a specific shape.
    s3_urls: Dict[str, Any]
    prompt: Optional[str]
    language: str
    error_message: Optional[str]
    metadata: Dict[str, Any]
    thumbnails: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Intent-aware thumbnail set generated after Director plan completes. "
            "Shape: {selected_id, intent, orientation, generated_at, "
            "options:[{id, image_url, headline, layout, subject_focus, intent_style}]}. "
            "Empty {} until the thumbnail stage runs."
        ),
    )
    token_usage: Optional[Dict[str, Any]] = Field(
        None,
        description="Token/cost breakdown for this generation (prompt_tokens, completion_tokens, estimated_cost_usd, model, etc.)"
    )
    generation_progress: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Real-time sub-stage progress, updated every ~250ms during generation and persisted to DB. "
            "Fields: "
            "sub_stage (str — current label e.g. 'Shot 4/18 ready (VIDEO_HERO)'), "
            "shots_completed (int), shots_total (int), "
            "shot_plan (list[{shot_index, shot_type, duration_s, start_time, end_time, narration_excerpt}] "
            "— full Director plan, set once when planning completes), "
            "shots_history (list[{shot_index, shot_type, duration_s, start_time, end_time, "
            "model, token_delta:{prompt_tokens,completion_tokens,estimated_cost_usd}, "
            "cumulative_tokens}] — every completed shot, capped at 200, for post-run analysis), "
            "cumulative_tokens ({prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd} "
            "— running total updated after every shot), "
            "last_shot ({shot_index, shot_type, duration_s} — quick access to last completed shot), "
            "errors (list[{shot_index, shot_type, error, retrying, attempt, timestamp}] — shot errors, capped at 50), "
            "last_event (raw last pipeline event dict)."
        )
    )
    live: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "v3 live-progress snapshot from RunStateAggregator. Single source of truth "
            "for the polling-based FE pipeline view. Shape: "
            "{status, active_stage, active_substage, director_thought, started_at, "
            "last_event_at, finished_at, stages:{<stage_id>:{state, started_at, wrapped_at, message, detail}}, "
            "shots:[{idx, shot_type, intent_role, audio_policy, background_treatment, transition_in, "
            "narration_brief, duration_estimate_s, state, substage, attempts, regen_log, external_call_ids, "
            "cost_usd, tokens_in, tokens_out, started_at, wrapped_at, elapsed_s, last_error}], "
            "recurring_motifs, external_calls:[{id, provider, op, state, shot_idx, request_id, "
            "started_at, finished_at, elapsed_s, poll_count, eta_s, error}], "
            "costs:{spent_usd, spent_credits, cap_usd, cap_credits, tokens_*}, "
            "event_log:[{at, type, stage, shot_idx, message, detail}] (last 50)}. "
            "Read from process memory while the run is active; falls back to the "
            "persisted snapshot in extra_metadata.live on history reads."
        )
    )
    pending_decision: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Convenience mirror of metadata.assist.pending_decision. Set only when "
            "status == 'AWAITING_INPUT' (assist mode paused at a gate). Carries the "
            "full decision_required payload (decision_id, gate_type, prompt, options, "
            "payload, …) so polling clients can rehydrate the conversation card "
            "without digging into metadata.assist."
        ),
    )
    created_at: Optional[str]
    updated_at: Optional[str]
    completed_at: Optional[str]

    class Config:
        json_schema_extra = {
            "example": {
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "video_id": "quantum-entanglement-101",
                "current_stage": "HTML",
                "status": "COMPLETED",
                "content_type": "VIDEO",
                "file_ids": {
                    "script": "file-uuid-1",
                    "audio": "file-uuid-2",
                    "words": "file-uuid-3",
                    "timeline": "file-uuid-4"
                },
                "s3_urls": {
                    "script": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/script/script.txt",
                    "audio": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/audio/narration.mp3",
                    "words": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/words/narration.words.json",
                    "timeline": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/timeline/time_based_frame.json"
                },
                "prompt": "Explain the concept of quantum entanglement to a 5 year old",
                "language": "English",
                "error_message": None,
                "metadata": {},
                "created_at": "2024-01-15T10:30:00Z",
                "updated_at": "2024-01-15T10:35:00Z",
                "completed_at": "2024-01-15T10:35:00Z"
            }
        }


class VideoUrlsResponse(BaseModel):
    """Response for video HTML and audio URLs."""

    video_id: str
    html_url: Optional[str] = Field(None, description="URL to HTML timeline file (time_based_frame.json)")
    audio_url: Optional[str] = Field(None, description="URL to audio file (narration.mp3)")
    words_url: Optional[str] = Field(None, description="URL to time-synced words JSON for captions")
    avatar_url: Optional[str] = Field(None, description="URL to avatar talking-head video (MP4)")
    video_url: Optional[str] = Field(None, description="URL to rendered MP4 video (from render server)")
    status: str = Field(..., description="Current video generation status (PENDING, IN_PROGRESS, COMPLETED, FAILED, STALLED)")
    current_stage: str = Field(..., description="Current generation stage")
    updated_at: Optional[str] = Field(None, description="Last time the record was updated (ISO 8601)")
    error_message: Optional[str] = Field(None, description="Error message if generation failed or stalled")
    render_job_id: Optional[str] = Field(None, description="Active render job ID (for tracking render progress)")
    audio_tracks: Optional[List[Dict[str, Any]]] = Field(None, description="Extra audio tracks from meta.audio_tracks")
    thumbnails: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Intent-aware thumbnail set (Vimotion). "
            "Shape: {selected_id, intent, orientation, generated_at, options:[...]}."
        ),
    )

    class Config:
        json_schema_extra = {
            "example": {
                "video_id": "quantum-entanglement-101",
                "html_url": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/timeline/time_based_frame.json",
                "audio_url": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/audio/narration.mp3",
                "words_url": "https://bucket.s3.amazonaws.com/ai-videos/quantum-entanglement-101/audio/words.json",
                "avatar_url": None,
                "status": "COMPLETED",
                "current_stage": "HTML",
                "updated_at": "2024-01-15T10:35:00Z",
                "error_message": None
            }
        }


class ThumbnailOption(BaseModel):
    """A single thumbnail candidate generated by the pipeline."""
    id: str = Field(..., description="Stable option id (e.g. 'thumb_1').")
    image_url: str = Field(..., description="S3 URL of the base image (no rendered text).")
    headline: str = Field("", description="Short headline (≤6 words) to overlay client-side.")
    layout: str = Field(
        "bottom_band",
        description="Overlay layout hint: 'top_left'|'center'|'bottom_band'|'none'.",
    )
    subject_focus: str = Field(
        "object",
        description="Compositional axis: 'person'|'object'|'motif'|'type_led'.",
    )
    intent_style: str = Field(..., description="Intent classification that drove this option.")


class ThumbnailSet(BaseModel):
    """The full thumbnail set persisted on the video row."""
    selected_id: Optional[str] = Field(None, description="Currently selected option id.")
    intent: Optional[str] = Field(None, description="Detected intent ('ad'|'explainer'|...).")
    orientation: Optional[str] = Field(None, description="'landscape'|'portrait'.")
    generated_at: Optional[int] = Field(None, description="Epoch ms when the set was generated.")
    options: List[ThumbnailOption] = Field(default_factory=list)


class UpdateThumbnailRequest(BaseModel):
    """Swap which thumbnail option is selected."""
    selected_id: str = Field(..., description="Option id from the set's `options` list.")


class RegenerateThumbnailsResponse(BaseModel):
    """Response after kicking off a thumbnail regen."""
    video_id: str
    status: str = Field(..., description="'queued'|'completed'|'failed'.")
    message: Optional[str] = None


class RegenerateFrameRequest(BaseModel):
    """Request for regenerating a specific frame's HTML."""
    video_id: str = Field(..., description="Video ID")
    timestamp: float = Field(..., description="Timestamp of the frame in seconds")
    user_prompt: str = Field(..., description="User's instruction for modification")
    institute_id: Optional[str] = Field(None, description="Institute ID (optional)")
    model: Optional[str] = Field(
        None,
        description=(
            "Optional model_id override (e.g. 'google/gemini-2.5-pro'). When omitted, "
            "the service resolves in order: per-shot html_model persisted at gen time → "
            "ai_model_defaults['video_regenerate'] → hard fallback."
        ),
    )


class RegenerateFrameResponse(BaseModel):
    """Response with new HTML content."""
    video_id: str
    frame_index: int
    timestamp: float
    original_html: str
    new_html: str
    resolved_model: Optional[str] = Field(
        None,
        description=(
            "The model_id actually used for this regeneration. Named "
            "`resolved_model` not `model_used` because Pydantic v2 reserves "
            "the `model_*` namespace."
        ),
    )
    regen_path: Optional[str] = Field(
        None,
        description=(
            "How the regen was produced: 'dom_patch' (deterministic, no LLM), "
            "'full_remake' (canonical LLM path), or 'full_remake_fallback' "
            "(classifier wanted a patch but no op was applicable). FE uses "
            "this to show 'Updated background video' vs 'Rewriting whole shot' "
            "toasts."
        ),
    )
    classification: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Output of the intent classifier when it ran. Shape: "
            "{ intent: 'targeted_patch'|'full_remake', confidence: 0-1, "
            "rationale: str, patch_ops: [{target, selector_hint, new_value, "
            "confidence}] }. Omitted when classifier was skipped (e.g. legacy "
            "timeline) or failed."
        ),
    )
    applied_ops: Optional[List[Dict[str, Any]]] = Field(
        None,
        description=(
            "Patch operations actually applied on the `dom_patch` path. "
            "Each entry: { target, selector, before, after, ok }. Used by "
            "the editor to show what changed (e.g. for the undo stack)."
        ),
    )


class UpdateFrameRequest(BaseModel):
    """Request for updating a specific frame's HTML and optionally its timing."""
    video_id: str = Field(..., description="Video ID")
    frame_index: int = Field(..., description="Index of the frame to update")
    new_html: str = Field(..., description="New HTML content")
    in_time: Optional[float] = Field(None, description="New start time in seconds (time_driven)")
    exit_time: Optional[float] = Field(None, description="New end time in seconds (time_driven)")
    z: Optional[int] = Field(None, description="Z-index layer")
    entry_id: Optional[str] = Field(None, description="Client entry ID for verification")
    entry_meta: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Free-form per-entry metadata (e.g. {'display_name': 'Welcome'}). "
            "Merged into the entry's existing entry_meta — keys not present in "
            "the payload are preserved. Pass an empty object to no-op."
        ),
    )
    html_model: Optional[str] = Field(
        None,
        description=(
            "Optional model_id that authored this HTML. Sent by the editor "
            "when accepting a regen so the next 'Remake with AI' on this "
            "entry resolves to the same model. Stored on the timeline entry "
            "alongside `html`. None = leave existing value untouched."
        ),
    )
    expected_revision: Optional[int] = Field(
        None,
        description=(
            "Optimistic-lock check: the meta.revision the client loaded. On "
            "mismatch the request fails with HTTP 409 and nothing is written. "
            "Omit to skip the check (the write still bumps the revision)."
        ),
    )


class AddFrameRequest(BaseModel):
    """Request for inserting a new frame into the timeline."""
    video_id: str = Field(..., description="Video ID")
    html: str = Field(..., description="HTML content for the new frame")
    # Time-driven fields (optional — omit for user_driven videos)
    in_time: Optional[float] = Field(None, description="Start time in seconds (time_driven)")
    exit_time: Optional[float] = Field(None, description="End time in seconds (time_driven)")
    # Optional explicit ID so the frontend can correlate the response
    entry_id: Optional[str] = Field(None, description="Client-generated entry ID (optional)")
    z: Optional[int] = Field(0, description="Z-index layer (0=base, 500+=overlay)")
    # Position / bounding box (defaults to full-screen when omitted)
    html_start_x: Optional[int] = Field(None, description="Left edge in pixels (default 0)")
    html_start_y: Optional[int] = Field(None, description="Top edge in pixels (default 0)")
    html_end_x: Optional[int] = Field(None, description="Right edge in pixels (default video width)")
    html_end_y: Optional[int] = Field(None, description="Bottom edge in pixels (default video height)")
    entry_meta: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Free-form per-entry metadata (e.g. {'display_name': 'Welcome'}) "
            "to attach to the new entry. An empty `display_name` is treated "
            "as 'no override' and omitted from the stored entry_meta."
        ),
    )
    expected_revision: Optional[int] = Field(
        None,
        description=(
            "Optimistic-lock check: the meta.revision the client loaded. On "
            "mismatch the request fails with HTTP 409 and nothing is written. "
            "Omit to skip the check (the write still bumps the revision)."
        ),
    )


class AddFrameResponse(BaseModel):
    status: str
    video_id: str
    entry_id: str
    frame_index: int
    message: str


class DeleteFrameRequest(BaseModel):
    """Request for removing a frame from the timeline.

    Prefer `entry_id` — it's order-independent. `frame_index` is accepted as
    a fallback for callers that only know the position. If both are given,
    `entry_id` wins and `frame_index` is treated as a hint.
    """
    video_id: str = Field(..., description="Video ID")
    entry_id: Optional[str] = Field(None, description="Stable entry ID to remove")
    frame_index: Optional[int] = Field(
        None, description="Position of the frame to remove (fallback when entry_id is missing)"
    )
    expected_revision: Optional[int] = Field(
        None,
        description=(
            "Optimistic-lock check: the meta.revision the client loaded. On "
            "mismatch the request fails with HTTP 409 and nothing is written. "
            "Omit to skip the check (the write still bumps the revision)."
        ),
    )


class DeleteFrameResponse(BaseModel):
    status: str
    video_id: str
    entry_id: Optional[str]
    frame_index: int
    message: str


class ReorderFrameRequest(BaseModel):
    """Request for moving a frame to a new position in the timeline.

    Identifies the entry by `entry_id` (the only safe key — positional
    indices shift after every reorder, so a positional source index from
    the client can race the server's view). `to_index` is clamped to
    [0, len(entries) - 1].

    Used by the editor's drag-to-reorder UI. The backend re-saves the
    timeline JSON with the entry spliced to the new position; no other
    fields are changed.
    """
    video_id: str = Field(..., description="Video ID")
    entry_id: str = Field(..., description="Stable entry ID to move")
    to_index: int = Field(..., description="Target 0-based index in the post-move timeline")
    expected_revision: Optional[int] = Field(
        None,
        description=(
            "Optimistic-lock check: the meta.revision the client loaded. On "
            "mismatch the request fails with HTTP 409 and nothing is written. "
            "Omit to skip the check (the write still bumps the revision)."
        ),
    )


class ReorderFrameResponse(BaseModel):
    status: str
    video_id: str
    entry_id: str
    from_index: int
    to_index: int
    message: str


# ── Audio track schemas ──────────────────────────────────────────────────────

class AudioTrackItem(BaseModel):
    """An extra audio track stored in meta.audio_tracks[]."""
    id: str = Field(..., description="Unique track ID (e.g. 'track-1')")
    label: str = Field(..., description="Display label (e.g. 'Background Music')")
    url: str = Field(..., description="Public S3 URL of the audio file")
    volume: float = Field(default=1.0, ge=0.0, le=2.0, description="Playback volume multiplier (0–2)")
    delay: float = Field(default=0.0, ge=0.0, description="Seconds to wait before starting")
    fade_in: float = Field(default=0.0, ge=0.0, description="Fade-in duration in seconds")
    fade_out: float = Field(default=0.0, ge=0.0, description="Fade-out duration in seconds")
    loop: bool = Field(default=False, description="Repeat the track until video end (render applies a tail fade at total_duration)")


class AddAudioTrackRequest(BaseModel):
    video_id: str = Field(..., description="Video ID")
    label: str = Field(..., description="Track display label")
    url: str = Field(..., description="Public S3 URL of the audio file")
    volume: float = Field(default=1.0, ge=0.0, le=2.0)
    delay: float = Field(default=0.0, ge=0.0)
    fade_in: float = Field(default=0.0, ge=0.0)
    fade_out: float = Field(default=0.0, ge=0.0)
    loop: bool = Field(default=False, description="Repeat the track until video end")
    track_id: Optional[str] = Field(None, description="Client-provided track ID (auto-generated if absent)")


class UpdateAudioTrackRequest(BaseModel):
    video_id: str = Field(..., description="Video ID")
    track_id: str = Field(..., description="Track ID to update")
    label: Optional[str] = None
    url: Optional[str] = None
    volume: Optional[float] = Field(None, ge=0.0, le=2.0)
    delay: Optional[float] = Field(None, ge=0.0)
    fade_in: Optional[float] = Field(None, ge=0.0)
    fade_out: Optional[float] = Field(None, ge=0.0)
    loop: Optional[bool] = Field(None, description="Repeat the track until video end (None = leave unchanged)")


class DeleteAudioTrackRequest(BaseModel):
    video_id: str = Field(..., description="Video ID")
    track_id: str = Field(..., description="Track ID to delete")


class AudioTrackResponse(BaseModel):
    status: str
    video_id: str
    track_id: str
    message: str
