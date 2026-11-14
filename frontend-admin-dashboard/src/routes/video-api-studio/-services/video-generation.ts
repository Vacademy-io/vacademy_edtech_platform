import { AI_SERVICE_BASE_URL } from '@/constants/urls';
import type { TFunction } from 'i18next';
import type {
    BrandPalette,
    IntroOutroConfig,
    WatermarkConfig,
} from '@/features/vimotion/api/dashboardTypes';

/**
 * Namespace for this module's translated display strings — see
 * src/locales/en/videoApiStudioVideoGeneration.json. The `buildXxx(t)`
 * factories below re-derive their English-source constants (CONTENT_TYPES,
 * QUALITY_TIERS, etc.) with translated `label`/`description`/`hint` text.
 * The raw constants stay untouched (same values, English fallback text) so
 * existing consumers outside this rollout wave keep working unmodified;
 * call sites that render these lists to users should prefer the `buildXxx(t)`
 * version instead. Enum `value`s are never translated — they're used for
 * state, equality checks, and the request payload sent to the backend.
 */
const NS = 'videoApiStudioVideoGeneration';

/**
 * Per-video brand overrides — a one-shot layer on top of the resolved brand kit
 * (or institute defaults) for a single generation. Mirrors the backend
 * `BrandOverrides` schema. palette is field-merged; intro/outro/watermark replace
 * those branding sections; system_prompt REPLACES the kit's director instructions.
 */
export interface BrandOverrides {
    palette?: BrandPalette;
    intro?: IntroOutroConfig;
    outro?: IntroOutroConfig;
    watermark?: WatermarkConfig;
    system_prompt?: string;
}

export type VideoStage = 'PENDING' | 'SCRIPT' | 'TTS' | 'WORDS' | 'HTML' | 'RENDER';
export type VideoStatusType =
    | 'PENDING'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'FAILED'
    | 'STALLED'
    | 'CANCELLED'
    // Assist mode: paused at a decision gate, waiting on the user. The pending
    // decision lives in metadata.assist.pending_decision (mirrored to the
    // top-level pending_decision field on /status).
    | 'AWAITING_INPUT';

export type VoiceGender = 'female' | 'male';
export type TtsProvider = 'standard' | 'premium';

/**
 * A single TTS voice option returned by the /tts/voices API
 */
export interface TtsVoice {
    id: string;
    name: string;
    provider: 'edge' | 'google' | 'sarvam';
    sample_url: string;
}

/**
 * Response from GET /tts/voices
 */
export interface TtsVoicesResponse {
    tier: string;
    provider: string;
    language: string;
    gender: string;
    voices: TtsVoice[];
}

/**
 * All supported content types from the API
 */
export type ContentType =
    | 'VIDEO' // Time-synced HTML overlays with audio (default)
    | 'QUIZ' // Question-based assessments
    | 'STORYBOOK' // Page-by-page narratives
    | 'INTERACTIVE_GAME' // Self-contained HTML games
    | 'PUZZLE_BOOK' // Collection of puzzles (crossword, word search)
    | 'SIMULATION' // Physics/economic sandboxes
    | 'FLASHCARDS' // Spaced-repetition cards
    | 'MAP_EXPLORATION' // Interactive SVG maps
    | 'WORKSHEET' // Printable/interactive homework
    | 'CODE_PLAYGROUND' // Interactive code exercises
    | 'TIMELINE' // Chronological event visualization
    | 'CONVERSATION' // Language learning dialogues
    | 'SLIDES'; // HTML presentation / PPT-style slide deck

/**
 * Navigation modes for content playback
 */
export type NavigationMode = 'time_driven' | 'user_driven' | 'self_contained';

/**
 * Mapping of content types to navigation modes
 */
export const CONTENT_TYPE_NAVIGATION: Record<ContentType, NavigationMode> = {
    VIDEO: 'time_driven',
    QUIZ: 'user_driven',
    STORYBOOK: 'user_driven',
    INTERACTIVE_GAME: 'self_contained',
    PUZZLE_BOOK: 'user_driven',
    SIMULATION: 'self_contained',
    FLASHCARDS: 'user_driven',
    MAP_EXPLORATION: 'user_driven',
    WORKSHEET: 'user_driven',
    CODE_PLAYGROUND: 'self_contained',
    TIMELINE: 'user_driven',
    CONVERSATION: 'user_driven',
    SLIDES: 'user_driven',
};

/**
 * Content type options with labels and emojis for UI
 */
export const CONTENT_TYPES = [
    {
        value: 'VIDEO' as ContentType,
        label: '📹 Video',
        description: 'Narrated videos with animations and visuals',
    },
    {
        value: 'SLIDES' as ContentType,
        label: '🖼️ Slides',
        description: 'Slide decks with images, charts, and diagrams',
    },
    {
        value: 'QUIZ' as ContentType,
        label: '❓ Quiz',
        description: 'Interactive quizzes to test knowledge',
    },
    {
        value: 'STORYBOOK' as ContentType,
        label: '📚 Storybook',
        description: 'Illustrated stories to flip through',
    },
    {
        value: 'INTERACTIVE_GAME' as ContentType,
        label: '🎮 Interactive Game',
        description: 'Playable games that teach through interaction',
    },
    {
        value: 'PUZZLE_BOOK' as ContentType,
        label: '🧩 Puzzle Book',
        description: 'Crosswords, word searches, and brain teasers',
    },
    {
        value: 'SIMULATION' as ContentType,
        label: '🔬 Simulation',
        description: 'Hands-on science and physics simulations',
    },
    {
        value: 'FLASHCARDS' as ContentType,
        label: '📇 Flashcards',
        description: 'Study flashcards for quick memorization',
    },
    {
        value: 'MAP_EXPLORATION' as ContentType,
        label: '🗺️ Map Exploration',
        description: 'Interactive maps to click and explore',
    },
    {
        value: 'WORKSHEET' as ContentType,
        label: '📝 Worksheet',
        description: 'Practice worksheets with exercises and answers',
    },
    {
        value: 'CODE_PLAYGROUND' as ContentType,
        label: '💻 Code Playground',
        description: 'Coding challenges with a live editor',
    },
    {
        value: 'TIMELINE' as ContentType,
        label: '⏳ Timeline',
        description: 'Interactive, scrollable event timelines',
    },
    {
        value: 'CONVERSATION' as ContentType,
        label: '💬 Conversation',
        description: 'Real-world conversation simulations',
    },
] as const;

export interface ContentTypeOption {
    value: ContentType;
    label: string;
    description: string;
}

/** Translated `label`/`description` for CONTENT_TYPES — same order/values. */
export function buildContentTypes(t: TFunction): ContentTypeOption[] {
    return [
        {
            value: 'VIDEO',
            label: `📹 ${t(`${NS}:contentTypes.video.label`)}`,
            description: t(`${NS}:contentTypes.video.description`),
        },
        {
            value: 'SLIDES',
            label: `🖼️ ${t(`${NS}:contentTypes.slides.label`)}`,
            description: t(`${NS}:contentTypes.slides.description`),
        },
        {
            value: 'QUIZ',
            label: `❓ ${t(`${NS}:contentTypes.quiz.label`)}`,
            description: t(`${NS}:contentTypes.quiz.description`),
        },
        {
            value: 'STORYBOOK',
            label: `📚 ${t(`${NS}:contentTypes.storybook.label`)}`,
            description: t(`${NS}:contentTypes.storybook.description`),
        },
        {
            value: 'INTERACTIVE_GAME',
            label: `🎮 ${t(`${NS}:contentTypes.interactiveGame.label`)}`,
            description: t(`${NS}:contentTypes.interactiveGame.description`),
        },
        {
            value: 'PUZZLE_BOOK',
            label: `🧩 ${t(`${NS}:contentTypes.puzzleBook.label`)}`,
            description: t(`${NS}:contentTypes.puzzleBook.description`),
        },
        {
            value: 'SIMULATION',
            label: `🔬 ${t(`${NS}:contentTypes.simulation.label`)}`,
            description: t(`${NS}:contentTypes.simulation.description`),
        },
        {
            value: 'FLASHCARDS',
            label: `📇 ${t(`${NS}:contentTypes.flashcards.label`)}`,
            description: t(`${NS}:contentTypes.flashcards.description`),
        },
        {
            value: 'MAP_EXPLORATION',
            label: `🗺️ ${t(`${NS}:contentTypes.mapExploration.label`)}`,
            description: t(`${NS}:contentTypes.mapExploration.description`),
        },
        {
            value: 'WORKSHEET',
            label: `📝 ${t(`${NS}:contentTypes.worksheet.label`)}`,
            description: t(`${NS}:contentTypes.worksheet.description`),
        },
        {
            value: 'CODE_PLAYGROUND',
            label: `💻 ${t(`${NS}:contentTypes.codePlayground.label`)}`,
            description: t(`${NS}:contentTypes.codePlayground.description`),
        },
        {
            value: 'TIMELINE',
            label: `⏳ ${t(`${NS}:contentTypes.timeline.label`)}`,
            description: t(`${NS}:contentTypes.timeline.description`),
        },
        {
            value: 'CONVERSATION',
            label: `💬 ${t(`${NS}:contentTypes.conversation.label`)}`,
            description: t(`${NS}:contentTypes.conversation.description`),
        },
    ];
}

export type VideoOrientation = 'landscape' | 'portrait';
export type QualityTier = 'free' | 'standard' | 'premium' | 'ultra' | 'super_ultra';
// Deprecated: the Director now picks theme/background/animation per-shot.
// Type kept for reading historical metadata from past runs.
export type VisualStyle = 'standard' | 'illustrated_svg' | 'product_showcase';

// ─── Visual preferences (Slice A/B/C/D back-end → Slice E front-end) ──
// Soft per-family bias hints + on-screen text density. The user picks via
// Advanced Settings sliders; the BE merges with a deterministic free-text
// scan of the prompt (free-text wins on overlap). Unset / null fields mean
// "no opinion" — the pipeline behaves as today on those families.
export type FamilyBias = 'no' | 'auto' | 'high';
export type TextDensity = 'minimal' | 'low' | 'auto' | 'rich';

export interface VisualPreferences {
    /** Bias for VIDEO_HERO + IMAGE_HERO with stock footage / real video. */
    stock_video?: FamilyBias | null;
    /** Bias for shots with AI-generated images (Seedream). */
    ai_imagery?: FamilyBias | null;
    /** Bias for INFOGRAPHIC_SVG / KINETIC_TITLE / ANNOTATION_MAP. */
    svg_illustrated?: FamilyBias | null;
    /** Bias for TEXT_DIAGRAM / PROCESS_STEPS / DATA_STORY / EQUATION_BUILD / ANIMATED_ASSET / KINETIC_TEXT. */
    motion_graphics?: FamilyBias | null;
    /** Bias for DEVICE_MOCKUP (HTML-rendered app/web/mobile UI). */
    app_ui_mockup?: FamilyBias | null;
    /**
     * Bias for AI_VIDEO_HERO and inline `<aivideo>` clips (fal.ai Veo).
     * Ultra+ tiers only — even when set, the run-level `ai_video_enabled`
     * flag must be on for Veo to actually fire.
     */
    ai_video?: FamilyBias | null;
    /**
     * On-screen text density. Does NOT affect narration length — only the
     * amount of visible text in each shot. On `minimal`/`low` the Director
     * forbids KINETIC_TEXT and the per-shot HTML caps headline word count.
     */
    text_density?: TextDensity | null;
    /**
     * Overall visual aesthetic for the whole video (overrides auto-detection).
     * `educational` = clean flat "whiteboard" look; `marketing` = premium
     * modern brand-film look (depth, motion, finishing, keywords-only text);
     * `bold` = marketing + high-energy social-ad styling. `null`/`auto` =
     * auto-detect from content (marketing/product → marketing, else educational).
     */
    visual_style_mode?: VisualStyleMode | null;
}

/** Overall video aesthetic — see `visual_style_mode`. */
export type VisualStyleMode = 'auto' | 'educational' | 'marketing' | 'bold';

/** Ordered list of family slider keys — drives the Advanced Settings UI. */
export const VISUAL_PREFERENCE_FAMILIES = [
    { key: 'stock_video', label: 'Stock video / real footage' },
    { key: 'ai_imagery', label: 'AI-generated imagery' },
    { key: 'svg_illustrated', label: 'SVG / illustrated diagrams' },
    { key: 'motion_graphics', label: 'Motion graphics' },
    { key: 'app_ui_mockup', label: 'App / device UI mockups' },
    { key: 'ai_video', label: 'AI-generated video (Veo)' },
] as const satisfies ReadonlyArray<{
    key: keyof Omit<VisualPreferences, 'text_density' | 'visual_style_mode'>;
    label: string;
}>;

export interface VisualPreferenceFamilyOption {
    key: (typeof VISUAL_PREFERENCE_FAMILIES)[number]['key'];
    label: string;
}

/** Translated `label` for VISUAL_PREFERENCE_FAMILIES — same order/keys. */
export function buildVisualPreferenceFamilies(t: TFunction): VisualPreferenceFamilyOption[] {
    return [
        { key: 'stock_video', label: t(`${NS}:visualPreferenceFamilies.stockVideo`) },
        { key: 'ai_imagery', label: t(`${NS}:visualPreferenceFamilies.aiImagery`) },
        { key: 'svg_illustrated', label: t(`${NS}:visualPreferenceFamilies.svgIllustrated`) },
        { key: 'motion_graphics', label: t(`${NS}:visualPreferenceFamilies.motionGraphics`) },
        { key: 'app_ui_mockup', label: t(`${NS}:visualPreferenceFamilies.appUiMockup`) },
        { key: 'ai_video', label: t(`${NS}:visualPreferenceFamilies.aiVideo`) },
    ];
}

/** Default AI video model when none is specified. Phase 3 only ships
 *  fal-ai/veo3.1/lite; the dropdown exists for future model additions. */
export const AI_VIDEO_MODELS = [
    {
        value: 'fal-ai/veo3.1',
        label: 'Veo 3.1 — Best quality',
        hint: 'Top photoreal fidelity + prompt adherence. ~$0.20/s (≈$1.60 per 8s clip).',
    },
    {
        value: 'fal-ai/veo3.1/fast',
        label: 'Veo 3.1 Fast — Balanced',
        hint: 'Full-model quality, cheaper. ~$0.10/s (≈$0.80 per 8s clip).',
    },
    {
        value: 'fal-ai/veo3.1/lite',
        label: 'Veo 3.1 Lite — Budget',
        hint: 'Lowest fidelity, cheapest. ~$0.03/s (≈$0.24 per 8s clip).',
    },
] as const;
export type AiVideoModel = (typeof AI_VIDEO_MODELS)[number]['value'];

export interface AiVideoModelOption {
    value: AiVideoModel;
    label: string;
    hint: string;
}

/** Translated `label`/`hint` for AI_VIDEO_MODELS — same order/values. */
export function buildAiVideoModels(t: TFunction): AiVideoModelOption[] {
    return [
        {
            value: 'fal-ai/veo3.1',
            label: t(`${NS}:aiVideoModels.veo31.label`),
            hint: t(`${NS}:aiVideoModels.veo31.hint`),
        },
        {
            value: 'fal-ai/veo3.1/fast',
            label: t(`${NS}:aiVideoModels.veo31Fast.label`),
            hint: t(`${NS}:aiVideoModels.veo31Fast.hint`),
        },
        {
            value: 'fal-ai/veo3.1/lite',
            label: t(`${NS}:aiVideoModels.veo31Lite.label`),
            hint: t(`${NS}:aiVideoModels.veo31Lite.hint`),
        },
    ];
}

// ── Per-stage model overrides (V200 — DB-backed routing) ─────────────────
// Backend canonical stage IDs the user can override at request time. Keep in
// lockstep with `app/constants/pipeline_stages.py` USER_OVERRIDABLE_STAGES.
// Non-overridable stages (vision_review, cultural_context, etc.) are pinned
// to admin defaults and stay off this list — sending them is a silent no-op.
//
// v2-legacy stage IDs (`director`, `script_generation`, `script_review`) are
// no longer surfaced in the UI now that v3 is the only supported pipeline.
// The BE still accepts them in `per_stage` for back-compat, so any clients
// that still send them keep working — they just resolve to matrix rows that
// the v3 runtime never reads.
export type UserOverridableStage =
    | 'shot_planner'
    | 'narration_writer'
    | 'per_shot_html'
    | 'act_planner'
    | 'regen_html';

// Display order + labels for the ModelOverridesPanel "advanced" expander.
// Same shape as AI_VIDEO_MODELS — readonly tuple so dropdowns stay
// well-typed and constant.
export const USER_OVERRIDABLE_STAGE_META: readonly {
    value: UserOverridableStage;
    label: string;
    hint?: string;
}[] = [
    { value: 'shot_planner', label: 'Shot planning', hint: 'Plans the whole video shot-by-shot.' },
    {
        value: 'narration_writer',
        label: 'Narration writing',
        hint: 'Authors per-shot narration text.',
    },
    {
        value: 'per_shot_html',
        label: 'Per-shot HTML',
        hint: 'Generates HTML for every shot — biggest token bucket.',
    },
    {
        value: 'act_planner',
        label: 'Act planner',
        hint: 'Decomposes intent into acts before shot planning.',
    },
    {
        value: 'regen_html',
        label: 'HTML regeneration',
        hint: 'Corrective regen for failed validation passes.',
    },
] as const;

export interface UserOverridableStageOption {
    value: UserOverridableStage;
    label: string;
    hint?: string;
}

/** Translated `label`/`hint` for USER_OVERRIDABLE_STAGE_META — same order/values. */
export function buildUserOverridableStageMeta(t: TFunction): UserOverridableStageOption[] {
    return [
        {
            value: 'shot_planner',
            label: t(`${NS}:overridableStages.shotPlanner.label`),
            hint: t(`${NS}:overridableStages.shotPlanner.hint`),
        },
        {
            value: 'narration_writer',
            label: t(`${NS}:overridableStages.narrationWriter.label`),
            hint: t(`${NS}:overridableStages.narrationWriter.hint`),
        },
        {
            value: 'per_shot_html',
            label: t(`${NS}:overridableStages.perShotHtml.label`),
            hint: t(`${NS}:overridableStages.perShotHtml.hint`),
        },
        {
            value: 'act_planner',
            label: t(`${NS}:overridableStages.actPlanner.label`),
            hint: t(`${NS}:overridableStages.actPlanner.hint`),
        },
        {
            value: 'regen_html',
            label: t(`${NS}:overridableStages.regenHtml.label`),
            hint: t(`${NS}:overridableStages.regenHtml.hint`),
        },
    ];
}

export interface ModelOverrides {
    /** Mass-pick model — applied to every user-overridable stage. */
    default?: string;
    /** Per-stage explicit overrides. Wins over `default` for individual stages.
     *  Keys must be `UserOverridableStage` values; unknown / non-overridable
     *  keys are silently ignored by the backend. */
    per_stage?: Partial<Record<UserOverridableStage, string>>;
}

/** Returns true when the user has expressed any non-default opinion. */
export function hasActiveVisualPreferences(prefs: VisualPreferences | undefined | null): boolean {
    if (!prefs) return false;
    return Object.values(prefs).some((v) => v != null && v !== 'auto');
}

export interface ReferenceFile {
    url: string;
    name: string;
    type: 'image' | 'pdf';
}

// ── Host (on-screen narrator) ──────────────────────────────────────────
// Mirrors the BE schema in app/schemas/video_generation.py (HostConfig).
// Available on ultra / super_ultra only — lower tiers reject at the API edge.

export type AvatarModel =
    | 'fal-ai/kling-video/ai-avatar/v2/standard'
    | 'fal-ai/kling-video/ai-avatar/v2/pro'
    | 'fal-ai/heygen/avatar4/image-to-video'
    | 'veed/fabric-1.0'
    | 'fal-ai/flashtalk'
    | 'fal-ai/ltx-2.3-quality/audio-to-video'
    | 'bytedance/seedance-2.0/reference-to-video';

export type AvatarQuality = '480p' | '720p';

export type HostType = 'avatar' | 'raw';

export interface HostAvatarConfig {
    /**
     * Public S3 URL of a clear, front-facing face photo. Used as the per-shot
     * Seedream image-to-image reference for custom avatars. Optional when
     * `saved_avatar_id` is set — server resolves the saved row's face_image_url
     * (custom provider) or skips the field entirely (argil/veed providers).
     */
    face_image_url?: string;
    /** Free-form description: clothing, demeanour, background hints. Threaded into per-shot avatar image prompts. */
    details_prompt?: string;
    /** fal.ai model. Default Kling v2 (≈8.4 credits/sec @ current rate; see
     *  `useCreditRate()` for the live multiplier). Ignored for argil/veed
     *  providers (their endpoints are fixed). */
    avatar_model?: AvatarModel;
    /** Avatar video resolution. Same per-second price for both. */
    quality?: AvatarQuality;
    /**
     * Output frames-per-second (1–60). Only used by audio-to-video models that
     * expose it (LTX 2.3); ignored by the dedicated lip-sync avatars
     * (Kling/HeyGen/Fabric/FlashTalk). Omit → model default (24).
     */
    avatar_fps?: number;
    /**
     * Vimotion studio_avatar.id — when set, server resolves the saved row and
     * overrides face_image_url / provider / voice metadata. Vim's host picker
     * sends only this; admin's free-form face-upload path leaves it undefined.
     */
    saved_avatar_id?: string;
    /**
     * When the saved avatar carries voice metadata (voice_id / provider /
     * language / gender), apply it on top of the request's voice_* fields.
     * Default true. Set false to keep the request's voice and ignore the
     * avatar's saved voice. Only meaningful with `saved_avatar_id`.
     */
    use_avatar_voice?: boolean;
}

export interface HostRawConfig {
    /** Already-indexed input video IDs (mode='podcast'). Plumbed only — BE rejects raw with a clear message until shipped. */
    input_video_ids: string[];
}

/** Where the lesson teacher sits. `auto` lets the planner pick per section. */
export type LessonLayout = 'auto' | 'corner' | 'bubble' | 'side' | 'presenter' | 'board';

/**
 * Lesson mode — an education video taught by a teacher at a board: lesson
 * pacing (6-20 s sections, hook → concepts → worked example → recap), a
 * teacher's narration and, with `teacher`, a Spatius avatar beside the board.
 * Not combinable with `host`.
 */
export interface LessonConfig {
    enabled: boolean;
    /** Spatius avatar from GET /tutor/options `avatars`. Omit for a board-only lesson. */
    teacher?: { avatar_id: string; name?: string; title?: string };
    layout?: LessonLayout;
    subject?: string;
    include_worked_example?: boolean;
    include_recap?: boolean;
}

export interface HostConfig {
    type: HostType;
    /** Percentage of shots showing host on screen (0-100). Narration audio always plays. */
    host_in_video_percentage: number;
    avatar?: HostAvatarConfig;
    raw?: HostRawConfig;
}

// `perSecondUsd` is the source-of-truth price from fal.ai's pricing page.
// UI labels render this via `usdToCredits(perSecondUsd, ratio)` from
// `useEffectiveCreditRatio()` — never display the raw USD value to users.
export const AVATAR_MODELS: Array<{ value: AvatarModel; label: string; perSecondUsd: number }> = [
    {
        value: 'fal-ai/flashtalk',
        label: 'FlashTalk (fast, budget)',
        perSecondUsd: 0.02,
    },
    {
        value: 'fal-ai/kling-video/ai-avatar/v2/standard',
        label: 'Kling AI Avatar v2 (Standard)',
        perSecondUsd: 0.0562,
    },
    {
        value: 'veed/fabric-1.0',
        label: 'VEED Fabric 1.0',
        perSecondUsd: 0.08,
    },
    {
        value: 'fal-ai/heygen/avatar4/image-to-video',
        label: 'HeyGen Avatar 4',
        perSecondUsd: 0.1,
    },
    {
        value: 'fal-ai/kling-video/ai-avatar/v2/pro',
        label: 'Kling AI Avatar v2 (Pro)',
        perSecondUsd: 0.115,
    },
    {
        // LTX 2.3 audio-to-video. General audio-driven generator with a tunable
        // FPS, NOT a dedicated lip-sync avatar. Priced PER-MEGAPIXEL on fal; the
        // value below is a representative per-second at 480p · 24fps
        // (854×480×24 × $0.0024075/MP) — actual cost scales with resolution × fps.
        value: 'fal-ai/ltx-2.3-quality/audio-to-video',
        label: 'LTX 2.3 (audio-to-video)',
        perSecondUsd: 0.0237,
    },
    {
        // Seedance 2.0 reference-to-video. Audio-capable (reference image +
        // driving audio → video) with native audio + camera control. Priced
        // PER-SECOND — $0.3034/s @720p (the picker caps avatars at 480p/720p).
        // Note: ≤15s audio cap per shot, and it is the priciest host model.
        value: 'bytedance/seedance-2.0/reference-to-video',
        label: 'Seedance 2.0 (reference-to-video)',
        perSecondUsd: 0.3034,
    },
];

export interface AvatarModelOption {
    value: AvatarModel;
    label: string;
    perSecondUsd: number;
}

/** Translated `label` for AVATAR_MODELS — same order/values/prices. */
export function buildAvatarModels(t: TFunction): AvatarModelOption[] {
    return [
        { value: 'fal-ai/flashtalk', label: t(`${NS}:avatarModels.flashtalk`), perSecondUsd: 0.02 },
        {
            value: 'fal-ai/kling-video/ai-avatar/v2/standard',
            label: t(`${NS}:avatarModels.klingStandard`),
            perSecondUsd: 0.0562,
        },
        { value: 'veed/fabric-1.0', label: t(`${NS}:avatarModels.veedFabric`), perSecondUsd: 0.08 },
        {
            value: 'fal-ai/heygen/avatar4/image-to-video',
            label: t(`${NS}:avatarModels.heygenAvatar4`),
            perSecondUsd: 0.1,
        },
        {
            value: 'fal-ai/kling-video/ai-avatar/v2/pro',
            label: t(`${NS}:avatarModels.klingPro`),
            perSecondUsd: 0.115,
        },
        {
            value: 'fal-ai/ltx-2.3-quality/audio-to-video',
            label: t(`${NS}:avatarModels.ltx23`),
            perSecondUsd: 0.0237,
        },
        {
            value: 'bytedance/seedance-2.0/reference-to-video',
            label: t(`${NS}:avatarModels.seedance20`),
            perSecondUsd: 0.3034,
        },
    ];
}

export interface GenerateVideoRequest {
    prompt: string;
    content_type?: ContentType; // NEW: Default "VIDEO"
    language: string;
    voice_gender: VoiceGender;
    tts_provider: TtsProvider;
    voice_id?: string; // Specific voice for premium TTS (Sarvam/Google voice name)
    captions_enabled: boolean;
    html_quality: 'classic' | 'advanced';
    target_audience: string;
    target_duration: string;
    /** @deprecated Use `model_overrides` instead. Kept for backwards compat —
     *  when set without `model_overrides`, the BE collapses it to
     *  `ModelOverrides(default=model)` so it only applies to user-overridable
     *  critical stages (vision review + utility prompts stay on admin defaults). */
    model: string;
    /** Per-stage model overrides (V200 DB-backed routing). When omitted, every
     *  stage uses its admin-configured default from `ai_model_stage_assignments`.
     *  `default` mass-applies to all user-overridable stages; `per_stage` wins
     *  over `default` for specific stages. Vision review + utility prompts
     *  ignore this entirely (pinned to admin defaults). */
    model_overrides?: ModelOverrides;
    quality_tier: QualityTier;
    video_id?: string; // Optional: auto-generated if not provided
    reference_files?: ReferenceFile[];
    orientation?: VideoOrientation;
    visual_style?: VisualStyle;
    target_stage?: VideoStage; // Stop at this stage (default: HTML). Use 'SCRIPT' for review mode.
    /** @deprecated Use input_video_ids instead */
    input_video_id?: string;
    /** List of indexed input video IDs (max 5). Director plans SOURCE_CLIP shots from any of them. */
    input_video_ids?: string[];
    /** Audio source: 'original' (single video only) or 'tts' (AI narration). Forced to 'tts' for multi-source. */
    input_video_audio?: 'original' | 'tts';
    /** When true and audio=tts: TTS mutes during SOURCE_CLIP shots so source audio plays instead. */
    mute_tts_on_source_clips?: boolean;
    /** Experimental: split dense shots into 2 focused sub-shots before HTML generation. */
    sub_shots_enabled?: boolean;
    dialogue_scenes_enabled?: boolean;
    dialogue_mode?: 'storybook' | 'drama';
    /** Which model films dialogue clips: seedance-2.0 = voice-locked lip-sync (default); omni-flash = cheaper, self-voiced. */
    dialogue_clip_model?: 'seedance-2.0' | 'omni-flash';
    /** Reuse a saved cast — same characters, faces, and voices as a prior video. */
    cast_id?: string;
    /** Sparse override for the auto-routing plan. User toggles win over router decisions. */
    routing_overrides?: RoutingOverrides;
    /** Optional on-screen host (narrator). Available on ultra / super_ultra only; rejected at the API edge on lower tiers. */
    host?: HostConfig;
    /** Lesson mode (education videos with a teacher at a board). Mutually exclusive with `host`. */
    lesson?: LessonConfig;
    /**
     * Vimotion brand_kit.id — when set, the kit's palette/fonts/layout/intro/outro/watermark
     * REPLACE the institute-wide style/branding for this run (no merge). Server resolves
     * scoped by institute_id; an unresolved id falls back to institute defaults.
     */
    brand_kit_id?: string;
    /**
     * Per-video overrides layered on top of the resolved brand kit (or institute
     * defaults when no kit) for THIS generation only. palette is field-merged;
     * intro/outro/watermark replace those branding sections; system_prompt REPLACES
     * the kit's director instructions for this run. One-shot — NOT persisted across
     * videos (excluded from the saved options blob + "Reuse settings").
     */
    brand_overrides?: BrandOverrides;
    /**
     * Soft per-family bias hints + on-screen text density. Set by the FE
     * Advanced Settings sliders. Free-text phrases in the prompt
     * (e.g. "use more SVG diagrams", "less text on screen") override the
     * matching field via the IntentRouter free-text scanner.
     */
    visual_preferences?: VisualPreferences;
    /**
     * Enable AI video generation (fal.ai Veo) for this run. Ultra and
     * super_ultra tiers only — backend downgrades to false on other tiers
     * with a warning. Each AI video shot costs ≈18–60 credits @ current
     * rate (USD source: $0.12–$0.40); the run is circuit-broken at the
     * per-video credit cap (≈225 credits @ current rate, USD source: $1.50).
     */
    ai_video_enabled?: boolean;
    /**
     * When ai_video_enabled is on, lets AI video clips bring their own audio.
     * Master narration is silenced during those shots. Veo audio is ≈7.5
     * credits/sec instead of ≈4.5 credits/sec (USD source: $0.05/s vs
     * $0.03/s); only meaningful with ai_video_enabled=true.
     */
    ai_video_audio_enabled?: boolean;
    /**
     * Optional override for the AI video model. Defaults to
     * 'fal-ai/veo3.1/lite'. Currently the only supported value.
     */
    ai_video_model?: AiVideoModel;
    // ── Assist mode (conversational, human-in-the-loop) ──────────────
    /**
     * When true, the pipeline pauses at enabled decision gates, emits a
     * `decision_required` SSE event, and waits for the user to answer via
     * POST /external/video/v1/decision/{videoId}. The new default in the UI;
     * generalises the legacy review-mode. Default false = Auto mode.
     */
    assist_mode?: boolean;
    /**
     * Which gates pause when assist_mode is on. Subset of GateType. Omit for
     * the default set (shot_plan, narration, visual_casting, shot_look).
     */
    assist_gates?: GateType[];
    /** 'per_decision' (default) | 'batched'. */
    assist_granularity?: string;
}

// ── Assist mode types (conversational decision gates) ────────────────────

export type GateType =
    | 'creative_concept'
    | 'shot_plan'
    | 'styleframe'
    | 'narration'
    | 'visual_casting'
    | 'shot_look'
    | 'contact_sheet'
    | 'asset_request'
    | 'cast'
    | 'dailies'
    | 'voice'
    | 'music'
    | 'avatar';

/**
 * The per-run design identity presented at the styleframe gate — the visual
 * signature (fonts, motion, finishing, color arc) every shot follows.
 */
export interface DesignIdentity {
    identity_name: string;
    typography: {
        pairing: string;
        display: string;
        display_css: string;
        display_weight: number;
        body: string;
        body_css: string;
        locked_by_brand: boolean;
    };
    motion: { personality: string };
    finishing: {
        grain: 'none' | 'soft' | 'film';
        vignette: 'none' | 'soft' | 'medium';
        light: 'none' | 'glow';
    };
    color_arc_note: string;
    image_art_direction: string;
    rationale: string;
    /** Hero styleframe render; null when this run skipped the render. */
    styleframe_url: string | null;
}

/** Styleframe gate edit — send ONLY the fields the user actually changed. */
export interface DesignIdentityEdit {
    font_pairing?: string;
    motion_personality?: string;
    finishing?: { grain?: string; vignette?: string; light?: string };
    color_arc_note?: string;
    image_art_direction?: string;
}

/** One character on the cast gate (cast gate payload.characters[]). */
export interface CastGateCharacter {
    name: string;
    visual_description?: string;
    voice_hint?: string;
    /** Reference portrait; null when generation failed (upload instead). */
    sheet_url?: string | null;
    /** The voice currently assigned to this character; null/absent = auto. */
    voice_id?: string | null;
}

/** One selectable dialogue voice (cast gate payload.voice_options[]). */
export interface CastVoiceOption {
    voice_id: string;
    label: string;
    gender: 'male' | 'female';
}

/** One filmed dialogue clip awaiting review (dailies gate payload.clips[]). */
export interface DailiesClip {
    shot_index: number;
    clip_url: string;
    scene_description: string;
    /** The spoken lines in this clip (already concatenated by the BE). */
    lines: string;
    duration_s: number;
    cost_usd: number;
    /** Automated QC verdict; null when QC didn't run for this clip. */
    qc: { pass: boolean; issues: string[] } | null;
}

/** One agent-initiated ask (asset_request gate payload.requests[]). */
export interface AssetRequestItem {
    index: number;
    shot_index?: number | null;
    kind: 'screenshot' | 'photo' | 'data' | 'inspiration';
    ask: string;
    why?: string;
    /** Present only for kind='inspiration'. */
    options?: string[];
}

/** One shot on the contact sheet (contact_sheet gate payload.shots[]). */
export interface ContactSheetShot {
    shot_index: number;
    shot_type?: string;
    narration_excerpt?: string;
    /** Mid-run frame screenshot; null when the vision reviewer didn't capture one. */
    thumb_url?: string | null;
}

export interface DecisionOption {
    option_id: string;
    label: string;
    summary?: string;
    is_recommended?: boolean;
    /** Optional preview thumbnail for option cards. */
    preview_url?: string;
}

/** A stock/AI media candidate shown in the visual-casting gate. */
export interface VisualCastingCandidate {
    candidate_id: string;
    kind: 'image' | 'video';
    url: string;
    thumb?: string;
    provider?: string | null;
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    alt?: string | null;
    is_recommended?: boolean;
}

/** One media slot to cast — a media query (often one per shot). */
export interface VisualCastingGroup {
    /** The search query the pipeline emitted (the forcing key). */
    query: string;
    kind: 'image' | 'video';
    /** Shot this query belongs to, when known (for display). */
    shot_index?: number;
    candidates: VisualCastingCandidate[];
    recommended_candidate_id?: string;
}

/**
 * One editable shot row in the shot-plan / narration gates. Looser than
 * ShotPlanItem because the BE summary uses `duration_estimate_s` (planner
 * estimate) rather than the post-TTS `duration_s`.
 */
export type ShotPlanRow = Partial<ShotPlanItem> & {
    shot_index: number;
    narration_text?: string;
    duration_estimate_s?: number;
    // ── DIALOGUE_SCENE rows (acted scenes) ──
    /** The acted exchange — one entry per spoken line. */
    dialogue?: Array<{ character: string; line: string }>;
    scene_description?: string;
    action_description?: string;
    character_names?: string[];
    /** 'continuous' = same setting as the previous scene; 'new' = fresh setup. */
    scene_continuity?: 'continuous' | 'new';
    emotional_beat?: string;
    time_of_day?: string;
};

/**
 * Gate-specific structured payload the decision cards render. Loose union keyed
 * by gate_type; cards narrow on `decision.gate_type`.
 */
export interface DecisionPayload {
    /** shot_plan: editable compact shot rows. */
    shots?: ShotPlanRow[];
    /** narration: full concatenated script for the textarea fallback. */
    full_script?: string;
    /** creative_concept: the drafted creative direction. */
    concept?: Record<string, unknown>;
    /** visual_casting: candidate media for this shot (single-shot form). */
    candidates?: VisualCastingCandidate[];
    query?: string;
    recommended_candidate_id?: string;
    /** visual_casting (batched): one group per media query across the video. */
    groups?: VisualCastingGroup[];
    /** narration: alternative opening hooks, each labeled by technique. */
    hook_variants?: Array<{ technique: string; text: string }>;
    /** creative_concept: 2 contrasting alternative directions beside the draft. */
    alternatives?: Array<Record<string, string>>;
    /** asset_request: the planner's asks (upload / answer / pick / skip each). */
    requests?: AssetRequestItem[];
    /** cast: the characters awaiting portrait approval. */
    characters?: CastGateCharacter[];
    /** cast: selectable dialogue voices (absent → no voice picker). */
    voice_options?: CastVoiceOption[];
    /** dailies: the filmed dialogue clips awaiting approval / re-film notes. */
    clips?: DailiesClip[];
    /** styleframe: the drafted design identity awaiting approval. */
    identity?: DesignIdentity;
    /** styleframe: selectable font pairings. */
    pairing_options?: Array<{ key: string; label: string; vibe: string }>;
    /** styleframe: selectable motion personalities. */
    motion_options?: Array<{ key: string; label: string; vibe: string }>;
    [key: string]: unknown;
}

/**
 * The `decision_required` SSE event — the agent asking the user to resolve a
 * gate. Also the shape stored in metadata.assist.pending_decision and surfaced
 * via /status.pending_decision.
 */
export interface DecisionRequest {
    type: 'decision_required';
    video_id?: string;
    decision_id: string;
    gate_type: GateType;
    /** Set for per-shot gates (visual_casting / shot_look). */
    shot_index?: number | null;
    /** The agent's question, rendered as a chat bubble. */
    prompt: string;
    options: DecisionOption[];
    recommended_option_id?: string | null;
    allow_freeform: boolean;
    allow_edit: boolean;
    created_at?: string;
    expires_at?: string;
    payload?: DecisionPayload;
}

/** The user's answer to a pending decision (POST /decision/{videoId} body's union). */
export type DecisionAnswer =
    | { kind: 'accept_recommended' }
    | { kind: 'choose_option'; option_id: string }
    | { kind: 'freeform'; text: string }
    | { kind: 'auto' }
    | { kind: 'auto_all' }
    | { kind: 'edit'; gate_type: 'shot_plan'; shots: ShotPlanRow[] }
    | { kind: 'edit'; gate_type: 'creative_concept'; concept: Record<string, string> }
    | { kind: 'edit'; gate_type: 'contact_sheet'; regens: Array<{ shot_index: number; note: string }> }
    | {
          kind: 'edit';
          gate_type: 'cast';
          characters: Array<{ name: string; url?: string; regen_note?: string; voice_id?: string }>;
      }
    | {
          kind: 'edit';
          gate_type: 'dailies';
          // Only the clips the user sent back — shot_index + what the re-take must fix.
          clips: Array<{ shot_index: number; redo_note: string }>;
      }
    | {
          kind: 'edit';
          gate_type: 'asset_request';
          responses: Array<{
              index: number;
              url?: string;
              text?: string;
              choice?: string;
              skipped?: boolean;
          }>;
      }
    | { kind: 'edit'; gate_type: 'narration'; modified_script: string; shots?: Array<{ shot_index: number; narration_text: string }> }
    | { kind: 'edit'; gate_type: 'styleframe'; identity: DesignIdentityEdit }
    | {
          kind: 'edit';
          gate_type: 'visual_casting';
          // null candidate_id = "let AI decide" for that query. `query` is the
          // backend forcing key; `url` is the chosen candidate's media URL.
          selections: Array<{
              query: string;
              candidate_id: string | null;
              url?: string;
              shot_index?: number;
          }>;
      };

/** One resolved turn in the assist conversation transcript (FE-only state). */
export interface AssistTurn {
    decision_id: string;
    gate_type: GateType;
    prompt: string;
    /** Human summary of what the user answered (rendered in the transcript). */
    answer_summary: string;
    answered_at: number;
}

// ── Intent Router types ─────────────────────────────────────────────────

export type RoutingToolName = 'scrape_url' | 'web_search';

export interface RoutingToolDecision {
    name: RoutingToolName;
    enabled: boolean;
    params?: Record<string, unknown>;
    reason?: string;
    source?: 'router' | 'user';
}

export interface RoutingConfig {
    mute_tts_on_source_clips: boolean;
    source_clip_priority: 'low' | 'medium' | 'high';
    infographic_mode: 'side' | 'overlay' | 'sequential';
    narration_fit_to_source: boolean;
    coverage_min_pct: number;
}

export interface RoutingPlan {
    tools: RoutingToolDecision[];
    config: RoutingConfig;
    explanation: string;
}

export interface RoutingOverrides {
    tools?: Partial<Record<RoutingToolName, boolean>>;
    config?: Partial<RoutingConfig>;
}

export interface RoutePreviewRequest {
    prompt: string;
    input_video_count?: number;
    attached_file_count?: number;
    orientation?: VideoOrientation;
    content_type?: ContentType;
}

export async function fetchRoutePreview(
    apiKey: string,
    body: RoutePreviewRequest
): Promise<RoutingPlan> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/route-preview`, {
        method: 'POST',
        headers: {
            'X-Institute-Key': apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`route-preview failed: ${response.status}`);
    }
    return (await response.json()) as RoutingPlan;
}

export const QUALITY_TIERS: Array<{
    value: QualityTier;
    label: string;
    description: string;
    badge?: string;
}> = [
    {
        value: 'free',
        label: 'Free',
        description: 'Fast generation, basic quality',
    },
    {
        value: 'standard',
        label: 'Standard',
        description: 'Smart visuals with diversity & validation',
    },
    {
        value: 'premium',
        label: 'Premium',
        description: 'Script review + image enhancement',
    },
    {
        value: 'ultra',
        label: 'Ultra',
        description: 'Best quality — all enhancements enabled',
        badge: 'Default',
    },
    {
        value: 'super_ultra',
        label: 'Super Ultra',
        description: 'Crossfade transitions + kinetic text shots with frame-perfect word sync',
        badge: 'New',
    },
];

export interface QualityTierOption {
    value: QualityTier;
    label: string;
    description: string;
    badge?: string;
}

/** Translated `label`/`description`/`badge` for QUALITY_TIERS — same order/values. */
export function buildQualityTiers(t: TFunction): QualityTierOption[] {
    return [
        {
            value: 'free',
            label: t(`${NS}:qualityTiers.free.label`),
            description: t(`${NS}:qualityTiers.free.description`),
        },
        {
            value: 'standard',
            label: t(`${NS}:qualityTiers.standard.label`),
            description: t(`${NS}:qualityTiers.standard.description`),
        },
        {
            value: 'premium',
            label: t(`${NS}:qualityTiers.premium.label`),
            description: t(`${NS}:qualityTiers.premium.description`),
        },
        {
            value: 'ultra',
            label: t(`${NS}:qualityTiers.ultra.label`),
            description: t(`${NS}:qualityTiers.ultra.description`),
            badge: t(`${NS}:qualityTiers.ultra.badge`),
        },
        {
            value: 'super_ultra',
            label: t(`${NS}:qualityTiers.superUltra.label`),
            description: t(`${NS}:qualityTiers.superUltra.description`),
            badge: t(`${NS}:qualityTiers.superUltra.badge`),
        },
    ];
}

export interface ProgressEvent {
    type: 'progress';
    stage: VideoStage;
    message: string;
    percentage: number;
    video_id: string;
    content_type?: ContentType; // NEW: Included in events
    files?: {
        script?: { file_id: string; s3_url: string };
        audio?: { file_id: string; s3_url: string };
        words?: { file_id: string; s3_url: string };
        timeline?: { file_id: string; s3_url: string };
        video?: { file_id: string; s3_url: string };
    };
}

export interface CompletedEvent {
    type: 'completed';
    video_id?: string;
    content_type?: ContentType; // NEW: Included in events
    files: {
        video?: string;
        script?: string;
        audio?: string;
        timeline?: string;
        words?: string;
    };
    percentage: number;
}

export interface InfoEvent {
    type: 'info';
    message: string;
    video_id?: string;
    content_type?: ContentType;
}

export interface ErrorEvent {
    type: 'error';
    message: string;
    stage?: VideoStage;
    video_id?: string;
}

/** Emitted by the backend when the user cancels via POST /cancel/{video_id}.
 *  Distinct from `error` so the FE can show a friendlier "Stopped" UI and
 *  skip the failure-recovery / retry suggestions. */
export interface CancelledEvent {
    type: 'cancelled';
    message?: string;
    video_id?: string;
}

/**
 * Per-shot plan entry. Carries the union of v2 (Director) + v3 (ShotPlanner +
 * NarrationWriter) fields. v2 runs only populate the first six fields; v3
 * runs add `narration_brief`, `audio_policy`, `background_treatment`,
 * `transition_in`, `intent_role`, and the pre-computed per-shot audio URLs.
 * The FE consumes both shapes uniformly — every v3 field is optional.
 *
 * `audio_policy` controls how the master narration interacts with the shot
 * during render: `narration_only` (default) plays the voiceover normally;
 * `intrinsic_only` mutes the voiceover in the shot's window so the shot's
 * own audio (Veo-generated, source clip) plays alone.
 */
export interface ShotPlanItem {
    shot_index: number;
    shot_type: string;
    start_time: number;
    end_time: number;
    duration_s: number;
    /** Truncated narration the Director / NarrationWriter assigned. */
    narration_excerpt?: string;
    // ── v3 fields (ShotPlanner + NarrationWriter) ──
    /** What the planner wants this shot to say — distinct from `narration_text`. */
    narration_brief?: string;
    /** Full per-shot narration authored by NarrationWriter. Empty on intrinsic_only shots. */
    narration_text?: string;
    audio_policy?: 'narration_only' | 'intrinsic_only';
    /** brand_solid | brand_textured | brand_gradient | media_hero | etc. */
    background_treatment?: string;
    /** transition_picker.py key — `crossfade`, `circle_iris`, `slide_left`, etc. */
    transition_in?: string;
    /** ShotPlanner intent role — `hook`, `body`, `close`, `product_proof`, etc. */
    intent_role?: string;
    /** Pre-computed per-shot TTS mp3 URL. Absent on `intrinsic_only` (audio_skipped). */
    audio_url?: string;
    /** Pre-computed per-shot word timings JSON URL. */
    audio_words_url?: string;
    /** Pre-computed per-shot narration script (plain text) URL. */
    audio_script_url?: string;
    /** Per-shot audio duration in seconds, as reported by the TTS pass. */
    audio_duration_s?: number;
    /** True when the shot is `intrinsic_only` and no per-shot TTS was generated. */
    audio_skipped?: boolean;
}

/** Sub-stage progress event emitted during long phases (e.g. director_planning, shot_done) */
export interface SubStageEvent {
    type: 'sub_stage';
    sub_stage: string;
    message?: string;
    video_id?: string;
    /** Director / ShotPlanner shot count — present on `director_done` or `shot_planning_done`. */
    shot_count?: number;
    /** Full plan — present on `director_done` (v2) or `shot_planning_done` (v3). */
    shot_plan?: ShotPlanItem[];
    /**
     * v3 only: plan-level recurring visual motifs (logo placement, repeated
     * UI element, etc.) that span multiple shots. Emitted on
     * `shot_planning_done`.
     */
    recurring_motifs?: Array<{
        description: string;
        screen_position?: string;
        when_visible?: string;
    }>;
    /** v3 only: total words in the authored narration, emitted on `narration_writing_done`. */
    narration_word_count?: number;
    /** Per-shot index for avatar_* sub-stages */
    shot_index?: number;
    /** Per-shot total for avatar_* sub-stages */
    host_shot_count?: number;
    /** Per-shot completed count for avatar_* sub-stages */
    host_shot_completed?: number;
    /** Error string for avatar_failed sub-stage */
    error?: string;
    /** Lyria chunk index for background_music_segment */
    segment_index?: number;
    /** Lyria total chunks for background_music_segment */
    segment_total?: number;
    /** Final S3 URL of the merged track for background_music_done */
    url?: string;
    /** Per-shot token cost — only present on script/html stage completion sub-stages */
    token_delta?: {
        prompt_tokens: number;
        completion_tokens: number;
        estimated_cost_usd?: number | null;
    };
}

/** Emitted after each shot's HTML is generated */
export interface ShotDoneEvent {
    type: 'shot_done';
    shot_index: number;
    total_shots: number;
    shot_type?: string;
    duration_s?: number;
    start_time?: number;
    end_time?: number;
    model?: string;
    message?: string;
    video_id?: string;
    token_delta?: {
        prompt_tokens: number;
        completion_tokens: number;
        estimated_cost_usd?: number | null;
    };
    cumulative_tokens?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        estimated_cost_usd?: number | null;
    };
}

/** Emitted when a shot fails (with retrying=true) or permanently fails (retrying=false) */
export interface ShotErrorEvent {
    type: 'shot_error';
    shot_index: number;
    total_shots?: number;
    shot_type?: string;
    error?: string;
    retrying: boolean;
    attempt?: number;
    max_attempts?: number;
    message?: string;
    video_id?: string;
}

export type SSEEvent =
    | ProgressEvent
    | CompletedEvent
    | InfoEvent
    | ErrorEvent
    | CancelledEvent
    | SubStageEvent
    | ShotDoneEvent
    | ShotErrorEvent
    | DecisionRequest;

export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    image_count: number;
    tts_character_count: number;
    stock_count?: number;
    estimated_cost_usd: number | null;
    model: string | null;
    recorded_at: string;
}

export interface VideoUrls {
    video_id: string;
    html_url: string | null;
    audio_url: string | null;
    words_url: string | null;
    avatar_url?: string | null;
    video_url?: string | null;
    status: VideoStatusType;
    current_stage: VideoStage;
    updated_at?: string | null;
    error_message?: string | null;
    render_job_id?: string | null;
    token_usage?: TokenUsage | null;
}

export interface GenerationProgress {
    sub_stage?: string;
    shots_completed?: number;
    shots_total?: number;
    /**
     * Full per-shot plan. v2 runs populate the legacy fields only; v3 runs
     * include the richer ShotPlanner + NarrationWriter metadata (audio_policy,
     * narration_brief, background_treatment, etc.). See `ShotPlanItem`.
     */
    shot_plan?: ShotPlanItem[];
    /**
     * v3 only — plan-level recurring motifs the ShotPlanner emitted.
     * Surfaced in the ShotPlanner detail sheet for cross-shot continuity.
     */
    recurring_motifs?: Array<{
        description: string;
        screen_position?: string;
        when_visible?: string;
    }>;
    /** v3 only — total words NarrationWriter authored across all shots. */
    narration_word_count?: number;
    shots_history?: Array<{
        shot_index: number;
        shot_type: string;
        duration_s: number;
        start_time: number;
        end_time: number;
        model?: string;
        token_delta?: {
            prompt_tokens: number;
            completion_tokens: number;
            estimated_cost_usd?: number | null;
        };
        cumulative_tokens?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            estimated_cost_usd?: number | null;
        };
    }>;
    errors?: Array<{
        shot_index: number;
        shot_type?: string;
        error: string;
        retrying: boolean;
        attempt?: number;
        timestamp: string;
    }>;
    cumulative_tokens?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        estimated_cost_usd?: number | null;
    };
    last_shot?: ShotDoneEvent;
    last_event?: Record<string, unknown>;
}

/**
 * Avatar host snapshot persisted at `extra_metadata.host` once the AvatarBatch
 * sub-stage runs. Mirrors the BE `_emeta["host"]` block. Only the fields the
 * FE currently reads are typed — additional cost/diagnostics fields exist on
 * the BE block but aren't surfaced here.
 */
export interface VideoMetadataHostBlock {
    enabled?: boolean;
    type?: 'avatar' | 'raw';
    avatar?: {
        face_image_url?: string;
        avatar_model?: string;
        quality?: '480p' | '720p';
    };
    outputs?: {
        host_shot_count?: number;
        total_host_seconds?: number;
        shot_artifacts?: Array<{
            shot_index: number;
            host_image_url?: string;
            avatar_video_url?: string;
            duration_s?: number;
            duration_s_actual?: number;
            status?: string;
            error?: string;
        }>;
        errors?: Array<{ shot_index: number; error?: string; stage?: string }>;
    };
}

/**
 * Snapshot of pre-script `scrape_url` outcomes. BE writes this from
 * WebContentCaptureService.capture_urls() into `intent_outcomes`.
 */
export interface VideoMetadataScrapeArtifacts {
    urls_attempted?: string[];
    files_captured?: Array<{
        url?: string;
        name?: string;
        type?: string;
    }>;
    files_count?: number;
    screenshot_count?: number;
    inline_image_count?: number;
    text_chars?: number;
    text_excerpt?: string;
    error?: string;
}

/** Snapshot of pre-script `web_search` outcomes. */
export interface VideoMetadataSearchArtifacts {
    query?: string;
    answer?: string;
    answer_chars?: number;
    sources?: Array<{
        url?: string;
        host?: string;
        title?: string;
        snippet?: string;
    }>;
    sources_count?: number;
    error?: string;
}

/**
 * Pre-script preamble outcomes — what the intent router decided to do and
 * what the resulting tool calls captured. Persisted at
 * `extra_metadata.intent_outcomes`.
 */
export interface VideoMetadataIntentOutcomes {
    tools_enabled?: string[];
    scrape_url_artifacts?: VideoMetadataScrapeArtifacts | null;
    web_search_artifacts?: VideoMetadataSearchArtifacts | null;
    video_type?: Record<string, unknown>;
    routing_plan?: Record<string, unknown>;
}

/**
 * Snapshot of the GenerateVideoRequest the BE persisted at gen start —
 * everything the pipeline view's Pitch / Configuration card displays. BE
 * writes this once at `extra_metadata.user_selections` after the intent
 * router resolves, so it's available from the first poll onward (no SSE
 * dependency).
 */
export interface VideoStatusUserSelections {
    prompt?: string;
    content_type?: ContentType;
    quality_tier?: QualityTier;
    model?: string;
    /** Canonical uppercase target stage (SCRIPT/TTS/WORDS/HTML/RENDER). Lets
     *  the FE distinguish review-mode runs from full runs without SSE state. */
    target_stage?: VideoStage;
    target_duration?: string;
    target_audience?: string;
    orientation?: VideoOrientation;
    language?: string;
    voice_gender?: VoiceGender;
    tts_provider?: TtsProvider;
    voice_id?: string | null;
    html_quality?: 'classic' | 'advanced';
    captions_enabled?: boolean;
    generate_avatar?: boolean;
    avatar_image_url?: string | null;
    sound_effects_enabled?: boolean | null;
    background_music_enabled?: boolean | null;
    background_music_volume?: number | null;
    sub_shots_enabled?: boolean;
    dialogue_scenes_enabled?: boolean;
    dialogue_mode?: 'storybook' | 'drama';
    dialogue_clip_model?: 'seedance-2.0' | 'omni-flash';
    /** Reuse a saved cast — same characters, faces, and voices as a prior video. */
    cast_id?: string;
    mute_tts_on_source_clips_kwarg?: boolean;
    input_video_ids?: string[];
    input_video_audio?: 'original' | 'tts' | null;
    reference_files_count?: number;
    routing_overrides?: Record<string, unknown> | null;
    /** Top-level mirror of HostConfig — full shape on the request type. */
    host?: {
        type?: 'avatar' | 'raw';
        host_in_video_percentage?: number;
        avatar?: Record<string, unknown>;
        raw?: Record<string, unknown>;
    };
    visual_preferences?: Record<string, unknown> | null;
    /**
     * Which AI video pipeline architecture this run used: `'v2'` (legacy:
     * BeatPlanner → ScriptGenerator → Director → per-shot HTML) or `'v3'`
     * (ShotPlanner-first: ShotPlanner → NarrationWriter → per-shot TTS →
     * per-shot HTML). v3 is opt-in via env or tier override; absent / unknown
     * is treated as v2 by the FE for back-compat.
     */
    pipeline_version?: 'v2' | 'v3';
}

/**
 * Subset of `extra_metadata` the FE pipeline view reads. Returned inside
 * `VideoStatusResponse.metadata` (BE writes `metadata` via `extra_metadata`).
 */
export interface VideoStatusMetadata {
    user_selections?: VideoStatusUserSelections;
    host?: VideoMetadataHostBlock;
    /** Top-level legacy mirror of background_music_enabled. */
    background_music_enabled?: boolean | null;
    intent_outcomes?: VideoMetadataIntentOutcomes;
    /** Background-music track URL once the BE writes the merged Lyria track
     *  to metadata. Not populated today — comes online when Phase 3 BE work
     *  flushes music outputs to /status. Read defensively. */
    audio_tracks?: Array<{ id?: string; url?: string; label?: string }>;
    /**
     * Top-level mirror of `user_selections.pipeline_version` — BE may write
     * it here too. Either source is authoritative; FE checks both.
     */
    pipeline_version?: 'v2' | 'v3';
    [key: string]: unknown;
}

export interface VideoStatusResponse {
    id: string;
    video_id: string;
    current_stage: VideoStage;
    status: VideoStatusType;
    content_type?: ContentType;
    /** Original prompt as persisted on the video record. */
    prompt?: string | null;
    language?: string;
    /** BE returns every populated key; FE reads defensively via lookup. */
    s3_urls: {
        script?: string;
        audio?: string;
        words?: string;
        timeline?: string;
        avatar?: string;
        video?: string;
        [key: string]: string | undefined;
    };
    file_ids?: Record<string, string | null | undefined>;
    error_message?: string | null;
    created_at: string;
    updated_at?: string | null;
    completed_at?: string | null;
    /** Real-time sub-stage breakdown — populated while generation is in progress and after completion */
    generation_progress?: GenerationProgress | null;
    /** BE-side `extra_metadata` — see VideoStatusMetadata for the surface area we read. */
    metadata?: VideoStatusMetadata | null;
    token_usage?: TokenUsage | null;
    /**
     * v3 live-progress snapshot. Single source of truth for the pipeline
     * view — both live runs and history reads consume this shape. Read
     * from the BE's in-memory RunStateAggregator while the run is active;
     * falls back to the persisted snapshot in extra_metadata.live for
     * post-restart and history reads. Absent for legacy v1/v2 runs.
     */
    live?: VideoLiveProgress | null;
    /**
     * Assist mode: the pending decision the run is paused on. Set only while
     * status === 'AWAITING_INPUT'. Convenience mirror of
     * metadata.assist.pending_decision so polling can rehydrate the card.
     */
    pending_decision?: DecisionRequest | null;
}

/**
 * v3 live-progress snapshot returned by `GET /status/{video_id}.live`.
 * Mirrors `LiveProgress` in ai_service/.../run_state_aggregator.py.
 */
export interface VideoLiveProgress {
    status: VideoStatusType;
    active_stage: VideoLiveStageId;
    active_substage?: string | null;
    director_thought?: string | null;
    started_at?: number | null;
    last_event_at?: number | null;
    finished_at?: number | null;
    stages: Record<VideoLiveStageId, VideoLiveStageProgress>;
    shots: VideoLiveShotProgress[];
    recurring_motifs?: Array<Record<string, unknown>>;
    external_calls?: VideoLiveExternalCall[];
    costs?: VideoLiveCosts;
    /** Rolling log; capped at 50 events on the wire. */
    event_log?: VideoLiveEvent[];
}

export type VideoLiveStageId =
    | 'pitch'
    | 'research'
    | 'shotPlanner'
    | 'narrationWriter'
    | 'filming'
    | 'talent'
    | 'score'
    | 'finalCut';

export interface VideoLiveStageProgress {
    state: 'pending' | 'in_progress' | 'wrapped' | 'failed';
    started_at?: number | null;
    wrapped_at?: number | null;
    message?: string | null;
    detail?: Record<string, unknown>;
}

export interface VideoLiveShotProgress {
    idx: number;
    shot_type?: string | null;
    intent_role?: string | null;
    audio_policy?: string | null;
    background_treatment?: string | null;
    transition_in?: string | null;
    narration_brief?: string | null;
    duration_estimate_s?: number | null;
    state: 'pending' | 'in_progress' | 'wrapped' | 'cut' | 'reshoot';
    /** One of: html_gen | density | bbox_lint | brand_asset | vision_review | screenshot | tts | media_polling */
    substage?: string | null;
    /** Map of step → attempt count, e.g. {vision_regen: 2, bbox_regen: 1}. */
    attempts?: Record<string, number>;
    regen_log?: Array<{
        step: string;
        attempt: number;
        verdict: string;
        reason?: string | null;
        at: number;
    }>;
    external_call_ids?: string[];
    cost_usd?: number;
    tokens_in?: number;
    tokens_out?: number;
    started_at?: number | null;
    wrapped_at?: number | null;
    elapsed_s?: number | null;
    last_error?: string | null;
}

export interface VideoLiveExternalCall {
    id: string;
    provider: string;
    op: string;
    state: 'queued' | 'polling' | 'done' | 'failed';
    shot_idx?: number | null;
    request_id?: string | null;
    started_at?: number;
    finished_at?: number | null;
    elapsed_s?: number | null;
    poll_count?: number;
    eta_s?: number | null;
    error?: string | null;
}

export interface VideoLiveCosts {
    spent_usd?: number;
    spent_credits?: number;
    cap_usd?: number | null;
    cap_credits?: number | null;
    tokens_prompt?: number;
    tokens_completion?: number;
    tokens_total?: number;
    estimated_cost_usd?: number;
}

export interface VideoLiveEvent {
    at: number;
    type: string;
    stage?: string | null;
    shot_idx?: number | null;
    message?: string | null;
    detail?: Record<string, unknown>;
}

/** A single intent-aware thumbnail option generated by the pipeline. */
export interface ThumbnailOption {
    id: string;
    image_url: string;
    headline: string;
    /** Layout hint for the FE overlay: 'top_left' | 'center' | 'bottom_band' | 'none'. */
    layout: string;
    /** Compositional axis: 'person' | 'object' | 'motif' | 'type_led'. */
    subject_focus: string;
    /** Intent classification that drove this option ('ad'|'explainer'|...). */
    intent_style: string;
}

/** The full thumbnail set persisted on a video. Empty options[] until the
 *  background batch finishes. */
export interface ThumbnailSet {
    selected_id?: string | null;
    intent?: string | null;
    orientation?: 'landscape' | 'portrait' | null;
    generated_at?: number | null;
    options: ThumbnailOption[];
}

export interface HistoryItem {
    id: string;
    video_id: string;
    prompt: string;
    content_type: ContentType; // NEW: Track content type
    status: 'pending' | 'generating' | 'completed' | 'failed';
    stage: VideoStage;
    created_at: string;
    html_url?: string;
    audio_url?: string;
    video_url?: string;
    timeline_url?: string;
    words_url?: string;
    options: Omit<GenerateVideoRequest, 'prompt'>;
    token_usage?: TokenUsage | null;
    /** Vimotion: intent-aware thumbnail set (empty options[] until ready). */
    thumbnails?: ThumbnailSet | null;
}

const HISTORY_STORAGE_KEY = 'vacademy_video_generation_history';

/**
 * Cross-tab handoff for the "Reuse settings from this video" action on the
 * Recent grid. RecentTab writes a snapshot to sessionStorage and navigates
 * to the Create tab; VideoConsoleWorkspace consumes the handoff in its
 * useState initializers and clears it in a useEffect. One-shot.
 *
 * Per-run fields (reference_files / input_video_ids / routing_overrides)
 * are intentionally stripped before write — re-attaching another run's
 * uploads to a fresh prompt would surprise the user. The user's tonal
 * choices (tier, voice, host, brand kit, visual mix) are what get carried.
 */
export const REUSE_SETTINGS_HANDOFF_KEY = 'vimotion_reuse_settings';

export interface ReuseSettingsHandoff {
    prompt: string;
    options: Partial<Omit<GenerateVideoRequest, 'prompt'>>;
}

/** Fields that must NOT carry over via "Reuse settings". Stripped at write time. */
const REUSE_BLOCKED_FIELDS = [
    'reference_files',
    'input_video_ids',
    'input_video_audio',
    'mute_tts_on_source_clips',
    'routing_overrides',
    // Per-video brand overrides are a deliberate one-shot act — never carry them
    // into the next video via "Reuse settings".
    'brand_overrides',
] as const;

/**
 * Strip per-run fields from an options object before staging it for the
 * "Reuse settings" handoff. Returns a shallow clone — the input is not
 * mutated.
 */
export function buildReuseSettingsPayload(
    prompt: string,
    options: Partial<Omit<GenerateVideoRequest, 'prompt'>>
): ReuseSettingsHandoff {
    const cleaned: Partial<Omit<GenerateVideoRequest, 'prompt'>> = { ...options };
    for (const key of REUSE_BLOCKED_FIELDS) {
        delete (cleaned as Record<string, unknown>)[key];
    }
    return { prompt, options: cleaned };
}

export const LANGUAGES = [
    // English variants
    { value: 'English (US)', label: 'English (US)', group: 'English' },
    { value: 'English (UK)', label: 'English (UK)', group: 'English' },
    { value: 'English (Australia)', label: 'English (Australia)', group: 'English' },
    { value: 'English (India)', label: 'English (India)', group: 'English' },
    // European
    { value: 'Spanish', label: 'Spanish', group: 'European' },
    { value: 'Spanish (US)', label: 'Spanish (US)', group: 'European' },
    { value: 'Portuguese (Brazil)', label: 'Portuguese (Brazil)', group: 'European' },
    { value: 'Portuguese (Portugal)', label: 'Portuguese (Portugal)', group: 'European' },
    { value: 'French', label: 'French', group: 'European' },
    { value: 'French (Canada)', label: 'French (Canada)', group: 'European' },
    { value: 'German', label: 'German', group: 'European' },
    { value: 'Italian', label: 'Italian', group: 'European' },
    { value: 'Dutch', label: 'Dutch', group: 'European' },
    { value: 'Dutch (Belgium)', label: 'Dutch (Belgium)', group: 'European' },
    { value: 'Danish', label: 'Danish', group: 'European' },
    { value: 'Finnish', label: 'Finnish', group: 'European' },
    { value: 'Norwegian', label: 'Norwegian', group: 'European' },
    { value: 'Swedish', label: 'Swedish', group: 'European' },
    { value: 'Icelandic', label: 'Icelandic', group: 'European' },
    { value: 'Polish', label: 'Polish', group: 'European' },
    { value: 'Russian', label: 'Russian', group: 'European' },
    { value: 'Ukrainian', label: 'Ukrainian', group: 'European' },
    { value: 'Czech', label: 'Czech', group: 'European' },
    { value: 'Slovak', label: 'Slovak', group: 'European' },
    { value: 'Hungarian', label: 'Hungarian', group: 'European' },
    { value: 'Romanian', label: 'Romanian', group: 'European' },
    { value: 'Bulgarian', label: 'Bulgarian', group: 'European' },
    { value: 'Greek', label: 'Greek', group: 'European' },
    { value: 'Catalan', label: 'Catalan', group: 'European' },
    // Middle East / Africa
    { value: 'Arabic', label: 'Arabic', group: 'Middle East / Africa' },
    { value: 'Hebrew', label: 'Hebrew', group: 'Middle East / Africa' },
    { value: 'Turkish', label: 'Turkish', group: 'Middle East / Africa' },
    { value: 'Afrikaans', label: 'Afrikaans', group: 'Middle East / Africa' },
    // Asian
    { value: 'Japanese', label: 'Japanese', group: 'Asian' },
    { value: 'Korean', label: 'Korean', group: 'Asian' },
    { value: 'Chinese', label: 'Chinese (Mandarin)', group: 'Asian' },
    { value: 'Chinese (Taiwan)', label: 'Chinese (Taiwan)', group: 'Asian' },
    { value: 'Thai', label: 'Thai', group: 'Asian' },
    { value: 'Vietnamese', label: 'Vietnamese', group: 'Asian' },
    { value: 'Indonesian', label: 'Indonesian', group: 'Asian' },
    { value: 'Malay', label: 'Malay', group: 'Asian' },
    { value: 'Filipino', label: 'Filipino', group: 'Asian' },
    // Indian
    { value: 'Hindi', label: 'Hindi', group: 'Indian' },
    { value: 'Bengali', label: 'Bengali', group: 'Indian' },
    { value: 'Tamil', label: 'Tamil', group: 'Indian' },
    { value: 'Telugu', label: 'Telugu', group: 'Indian' },
    { value: 'Marathi', label: 'Marathi', group: 'Indian' },
    { value: 'Kannada', label: 'Kannada', group: 'Indian' },
    { value: 'Gujarati', label: 'Gujarati', group: 'Indian' },
    { value: 'Malayalam', label: 'Malayalam', group: 'Indian' },
    { value: 'Urdu', label: 'Urdu', group: 'Indian' },
] as const;

export const VOICE_GENDERS = [
    { value: 'female', label: 'Female' },
    { value: 'male', label: 'Male' },
] as const;

export interface VoiceGenderOption {
    value: VoiceGender;
    label: string;
}

/** Translated `label` for VOICE_GENDERS — same order/values. */
export function buildVoiceGenders(t: TFunction): VoiceGenderOption[] {
    return [
        { value: 'female', label: t(`${NS}:voiceGenders.female`) },
        { value: 'male', label: t(`${NS}:voiceGenders.male`) },
    ];
}

export const TTS_PROVIDERS = [
    {
        value: 'standard' as TtsProvider,
        label: 'Standard',
        description: 'Microsoft Edge TTS (Free)',
    },
    {
        value: 'premium' as TtsProvider,
        label: 'Premium',
        description: 'Google Cloud / Sarvam AI (2x credits)',
    },
] as const;

export interface TtsProviderOption {
    value: TtsProvider;
    label: string;
    description: string;
}

/** Translated `label`/`description` for TTS_PROVIDERS — same order/values. */
export function buildTtsProviders(t: TFunction): TtsProviderOption[] {
    return [
        {
            value: 'standard',
            label: t(`${NS}:ttsProviders.standard.label`),
            description: t(`${NS}:ttsProviders.standard.description`),
        },
        {
            value: 'premium',
            label: t(`${NS}:ttsProviders.premium.label`),
            description: t(`${NS}:ttsProviders.premium.description`),
        },
    ];
}

export const TARGET_AUDIENCES = [
    'Class 1-2 (Ages 6-7)',
    'Class 3-4 (Ages 8-9)',
    'Class 5 (Ages 10-11)',
    'Class 6-8 (Ages 11-14)',
    'Class 9-10 (Ages 14-16)',
    'Class 11-12 (Ages 16-18)',
    'Undergraduate',
    'Graduate/Professional',
    'General/Adult',
];

/** value → translation-key suffix, for display only. The raw TARGET_AUDIENCES
 *  strings stay as-is since they're sent verbatim as `target_audience` on the
 *  request payload and persisted in saved history — only the rendered label
 *  is translated (mirrors the ai-center QUESTION_TYPE_LABEL_KEYS pattern). */
const TARGET_AUDIENCE_KEYS: Record<string, string> = {
    'Class 1-2 (Ages 6-7)': 'class1to2',
    'Class 3-4 (Ages 8-9)': 'class3to4',
    'Class 5 (Ages 10-11)': 'class5',
    'Class 6-8 (Ages 11-14)': 'class6to8',
    'Class 9-10 (Ages 14-16)': 'class9to10',
    'Class 11-12 (Ages 16-18)': 'class11to12',
    Undergraduate: 'undergraduate',
    'Graduate/Professional': 'graduateProfessional',
    'General/Adult': 'generalAdult',
};

/** Translated display label for a TARGET_AUDIENCES value; falls back to the
 *  raw English value for anything not in the map. */
export function getTargetAudienceLabel(audience: string, t: TFunction): string {
    const key = TARGET_AUDIENCE_KEYS[audience];
    return key ? t(`${NS}:targetAudiences.${key}`) : audience;
}

/** `{ value, label }` pairs for rendering the audience picker — `value` stays
 *  the raw English string (the actual request field); `label` is translated. */
export function buildTargetAudienceOptions(
    t: TFunction
): Array<{ value: string; label: string }> {
    return TARGET_AUDIENCES.map((value) => ({ value, label: getTargetAudienceLabel(value, t) }));
}

export const TARGET_DURATIONS = [
    '30 seconds',
    '1 minute',
    '2-3 minutes',
    '5 minutes',
    // The jump from 5 to 10 minutes was the whole mid-length range. A script
    // that runs ~7 minutes of voiceover had to be forced into a 5-minute plan
    // (which drops beats) or a 10-minute one (which pads them). The backend
    // averages the numbers in the string, so '5-7 minutes' targets 360s.
    '5-7 minutes',
    '7-8 minutes',
    '10 minutes',
];

/** value → translation-key suffix, for display only — see TARGET_AUDIENCE_KEYS. */
const TARGET_DURATION_KEYS: Record<string, string> = {
    '30 seconds': 'seconds30',
    '1 minute': 'minute1',
    '2-3 minutes': 'minutes2to3',
    '5 minutes': 'minutes5',
    '10 minutes': 'minutes10',
    // '5-7 minutes' / '7-8 minutes' are intentionally absent: getTargetDurationLabel
    // falls back to the raw English string, which is the correct display until
    // the locale files carry a translation.
};

/** Translated display label for a TARGET_DURATIONS value; falls back to the
 *  raw English value for anything not in the map. */
export function getTargetDurationLabel(duration: string, t: TFunction): string {
    const key = TARGET_DURATION_KEYS[duration];
    return key ? t(`${NS}:targetDurations.${key}`) : duration;
}

/** `{ value, label }` pairs for rendering the duration picker — `value` stays
 *  the raw English string (the actual request field); `label` is translated. */
export function buildTargetDurationOptions(
    t: TFunction
): Array<{ value: string; label: string }> {
    return TARGET_DURATIONS.map((value) => ({ value, label: getTargetDurationLabel(value, t) }));
}

export const DEFAULT_OPTIONS: Omit<GenerateVideoRequest, 'prompt'> = {
    content_type: 'VIDEO',
    language: 'English (US)',
    voice_gender: 'female',
    tts_provider: 'standard',
    voice_id: undefined,
    captions_enabled: true,
    html_quality: 'advanced',
    target_audience: 'General/Adult',
    target_duration: '2-3 minutes',
    model: '',
    quality_tier: 'ultra',
    orientation: 'landscape',
    visual_style: 'standard',
    // AI video flags default OFF (ultra+ users opt in per run). Backend
    // downgrades these to false on tier-ineligible runs even when sent.
    ai_video_enabled: false,
    ai_video_audio_enabled: false,
    // model_overrides intentionally omitted (undefined) — the request body
    // serializer drops undefined keys so the BE applies admin defaults
    // for every stage.
};

export function generateVideoId(): string {
    return `vid_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Fetch available TTS voices from the API for a given language, gender, and tier.
 */
export async function fetchTtsVoices(
    language: string,
    gender: VoiceGender,
    tier: TtsProvider
): Promise<TtsVoicesResponse> {
    const params = new URLSearchParams({ language, gender, tier });
    const resp = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/tts/voices?${params}`);
    if (!resp.ok) throw new Error(`Failed to fetch TTS voices: ${resp.status}`);
    return resp.json();
}

/**
 * Response metadata from generation API
 */
export interface GenerationResponse {
    videoId: string;
    contentType: ContentType;
    abort: () => void;
}

/**
 * Generate content (video, quiz, storybook, etc.)
 */
/** Fallback message when a 402 response carries no `detail` — translated
 *  when `t` is passed (real callers thread their bound `t` through), English
 *  otherwise so older/untranslated call sites keep working. */
function insufficientCreditsFallback(t?: TFunction): string {
    return t ? t(`${NS}:errors.insufficientCredits`) : 'Insufficient credits';
}

/** Fallback message when a 429 response carries no `detail` — see
 *  `insufficientCreditsFallback`. */
function rateLimitFallback(t?: TFunction): string {
    return t
        ? t(`${NS}:errors.rateLimited`)
        : 'Too many requests. Please wait a moment and try again.';
}

export function generateVideo(
    request: GenerateVideoRequest,
    apiKey: string,
    onProgress: (event: SSEEvent) => void,
    onError: (error: Error) => void,
    onHeadersReceived?: (headers: { videoId: string; contentType: ContentType }) => void,
    t?: TFunction
): GenerationResponse {
    const videoId = request.video_id || generateVideoId();
    const controller = new AbortController();
    const contentType = request.content_type || 'VIDEO';

    const { target_stage, ...requestBody } = request;
    const body = {
        ...requestBody,
        video_id: videoId,
        content_type: contentType,
    };

    const targetStage = target_stage || 'HTML';
    fetch(
        `${AI_SERVICE_BASE_URL}/external/video/v1/generate?target_stage=${encodeURIComponent(targetStage)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Institute-Key': apiKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        }
    )
        .then(async (response) => {
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                if (response.status === 402) {
                    // Parse detail from FastAPI error response
                    let detail = insufficientCreditsFallback(t);
                    try {
                        const parsed = JSON.parse(errorText);
                        detail = parsed.detail || detail;
                    } catch {
                        // use raw text
                        detail = errorText || detail;
                    }
                    const err = new Error(detail);
                    err.name = 'InsufficientCreditsError';
                    throw err;
                }
                if (response.status === 429) {
                    let detail = rateLimitFallback(t);
                    try {
                        const parsed = JSON.parse(errorText);
                        detail = parsed.detail || detail;
                    } catch {
                        detail = errorText || detail;
                    }
                    const err = new Error(detail);
                    err.name = 'RateLimitError';
                    throw err;
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            // Read content type from response headers
            const responseVideoId = response.headers.get('X-Video-ID') || videoId;
            const responseContentType =
                (response.headers.get('X-Content-Type') as ContentType) || contentType;

            // Notify caller of headers
            if (onHeadersReceived) {
                onHeadersReceived({
                    videoId: responseVideoId,
                    contentType: responseContentType,
                });
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const data = JSON.parse(jsonStr) as SSEEvent;
                            onProgress(data);
                        } catch (e) {
                            console.warn('SSE parse error:', e, 'Line:', line);
                        }
                    }
                }
            }
        })
        .catch((error) => {
            if (error.name !== 'AbortError') {
                onError(error);
            }
        });

    return {
        abort: () => controller.abort(),
        videoId,
        contentType,
    };
}

export async function getVideoUrls(videoId: string, apiKey: string): Promise<VideoUrls> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/urls/${videoId}`, {
        headers: {
            'X-Institute-Key': apiKey,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get video URLs: ${response.statusText}`);
    }

    return response.json();
}

// ---------------------------------------------------------------------------
// Resume generation (after script review)
// ---------------------------------------------------------------------------

export interface ResumeVideoRequest {
    videoId: string;
    targetStage?: string;
    modifiedScript?: string;
    /** Original generation options — forwarded so the pipeline uses the same settings */
    options?: Omit<GenerateVideoRequest, 'prompt'>;
}

/**
 * Resume a paused generation (e.g. after script review).
 * Returns SSE stream identical to generateVideo().
 */
export function resumeVideo(
    request: ResumeVideoRequest,
    apiKey: string,
    onProgress: (event: SSEEvent) => void,
    onError: (error: Error) => void,
    t?: TFunction
): { abort: () => void } {
    const controller = new AbortController();

    const opts = request.options;
    const body: Record<string, unknown> = {
        target_stage: request.targetStage || 'HTML',
        // Forward original generation settings so the pipeline uses consistent params
        voice_gender: opts?.voice_gender || 'female',
        tts_provider: opts?.tts_provider || 'standard',
        voice_id: opts?.voice_id || null,
        captions_enabled: opts?.captions_enabled ?? true,
        html_quality: opts?.html_quality || 'advanced',
        target_audience: opts?.target_audience || 'General/Adult',
        target_duration: opts?.target_duration || '2-3 minutes',
        model: opts?.model || null,
        sound_effects_enabled: true,
        sub_shots_enabled: opts?.sub_shots_enabled ?? false,
        dialogue_scenes_enabled: opts?.dialogue_scenes_enabled ?? false,
        dialogue_mode: opts?.dialogue_mode ?? 'storybook',
        dialogue_clip_model: opts?.dialogue_clip_model ?? 'seedance-2.0',
        cast_id: opts?.cast_id,
    };
    if (request.modifiedScript !== undefined) {
        body.modified_script = request.modifiedScript;
    }

    fetch(
        `${AI_SERVICE_BASE_URL}/external/video/v1/resume/${encodeURIComponent(request.videoId)}`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Institute-Key': apiKey,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        }
    )
        .then(async (response) => {
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                if (response.status === 402) {
                    const err = new Error(
                        (() => {
                            try {
                                return JSON.parse(errorText).detail;
                            } catch {
                                return errorText || insufficientCreditsFallback(t);
                            }
                        })()
                    );
                    err.name = 'InsufficientCreditsError';
                    throw err;
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const data = JSON.parse(jsonStr) as SSEEvent;
                            onProgress(data);
                        } catch (e) {
                            console.warn('SSE parse error:', e, 'Line:', line);
                        }
                    }
                }
            }
        })
        .catch((error) => {
            if (error.name !== 'AbortError') {
                onError(error);
            }
        });

    return { abort: () => controller.abort() };
}

// ---------------------------------------------------------------------------
// Assist mode — answer a pending decision gate and resume
// ---------------------------------------------------------------------------

/** Map a typed FE answer into the backend /decision body's {mode, answer}. */
export function decisionAnswerToBody(
    decisionId: string,
    gateType: GateType,
    answer: DecisionAnswer
): { decision_id: string; gate_type: GateType; mode: string; answer: Record<string, unknown> } {
    let mode = 'select';
    let payload: Record<string, unknown> = {};
    switch (answer.kind) {
        case 'accept_recommended':
            mode = 'select';
            break;
        case 'choose_option':
            mode = 'select';
            payload = { selected_option_id: answer.option_id };
            break;
        case 'freeform':
            mode = 'freeform';
            payload = { text: answer.text };
            break;
        case 'auto':
            mode = 'auto';
            break;
        case 'auto_all':
            mode = 'auto_all';
            break;
        case 'edit':
            mode = 'edit';
            if (answer.gate_type === 'shot_plan') {
                payload = { shots: answer.shots };
            } else if (answer.gate_type === 'narration') {
                payload = { full_script: answer.modified_script, shots: answer.shots };
            } else if (answer.gate_type === 'creative_concept') {
                payload = { concept: answer.concept };
            } else if (answer.gate_type === 'contact_sheet') {
                payload = { regens: answer.regens };
            } else if (answer.gate_type === 'asset_request') {
                payload = { responses: answer.responses };
            } else if (answer.gate_type === 'cast') {
                payload = { characters: answer.characters };
            } else if (answer.gate_type === 'dailies') {
                payload = { clips: answer.clips };
            } else if (answer.gate_type === 'styleframe') {
                payload = { identity: answer.identity };
            } else {
                payload = { selections: answer.selections };
            }
            break;
    }
    return { decision_id: decisionId, gate_type: gateType, mode, answer: payload };
}

/**
 * Answer a pending assist-mode decision and resume generation. Mirrors
 * resumeVideo's SSE reader — POSTs the answer to /decision/{videoId} and streams
 * the next leg through the same onProgress handler (which gets `decision_required`
 * again at the next gate, or `completed` at the end).
 */
export function submitDecision(
    videoId: string,
    decisionId: string,
    gateType: GateType,
    answer: DecisionAnswer,
    apiKey: string,
    onProgress: (event: SSEEvent) => void,
    onError: (error: Error) => void,
    t?: TFunction
): { abort: () => void } {
    const controller = new AbortController();
    const body = decisionAnswerToBody(decisionId, gateType, answer);

    fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/decision/${encodeURIComponent(videoId)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Institute-Key': apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
    })
        .then(async (response) => {
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                if (response.status === 402) {
                    const err = new Error(
                        (() => {
                            try {
                                return JSON.parse(errorText).detail;
                            } catch {
                                return errorText || insufficientCreditsFallback(t);
                            }
                        })()
                    );
                    err.name = 'InsufficientCreditsError';
                    throw err;
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            onProgress(JSON.parse(jsonStr) as SSEEvent);
                        } catch (e) {
                            console.warn('SSE parse error:', e, 'Line:', line);
                        }
                    }
                }
            }
        })
        .catch((error) => {
            if (error.name !== 'AbortError') {
                onError(error);
            }
        });

    return { abort: () => controller.abort() };
}

/**
 * On-demand stock search for the visual-casting card — when the AI's candidates
 * don't fit, the user can re-search with their own terms. Returns candidates in
 * the same shape the gate emits.
 */
export async function searchStock(
    kind: 'image' | 'video',
    query: string,
    apiKey: string,
    orientation: 'landscape' | 'portrait' = 'landscape'
): Promise<VisualCastingCandidate[]> {
    try {
        const res = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/stock/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Institute-Key': apiKey },
            body: JSON.stringify({ kind, query, orientation }),
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { candidates?: VisualCastingCandidate[] };
        return data.candidates ?? [];
    } catch {
        return [];
    }
}

/**
 * Pull the pending decision out of a /status response (polling rehydration).
 * Reads the top-level convenience mirror first, then metadata.assist. Returns
 * null when the run isn't paused at a gate.
 */
export function readAwaitingDecisionFromStatus(
    status: VideoStatusResponse | VideoUrls | null | undefined
): DecisionRequest | null {
    if (!status) return null;
    const top = (status as { pending_decision?: DecisionRequest | null }).pending_decision;
    if (top && top.decision_id) return top;
    const assist = (status as { metadata?: { assist?: { pending_decision?: DecisionRequest | null } } | null })
        .metadata?.assist?.pending_decision;
    if (assist && assist.decision_id) return assist;
    return null;
}

/**
 * Retry a FAILED or STALLED video generation from the last saved checkpoint.
 * Returns the same SSE stream as generateVideo — pipe it through the same onProgress handler.
 */
export function retryVideo(
    videoId: string,
    apiKey: string,
    onProgress: (event: SSEEvent) => void,
    onError: (error: Error) => void,
    t?: TFunction
): { abort: () => void } {
    const controller = new AbortController();

    fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/retry/${encodeURIComponent(videoId)}`, {
        method: 'POST',
        headers: { 'X-Institute-Key': apiKey },
        signal: controller.signal,
    })
        .then(async (response) => {
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                if (response.status === 402) {
                    const err = new Error(
                        (() => {
                            try {
                                return JSON.parse(errorText).detail;
                            } catch {
                                return errorText || insufficientCreditsFallback(t);
                            }
                        })()
                    );
                    err.name = 'InsufficientCreditsError';
                    throw err;
                }
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) continue;
                        try {
                            const data = JSON.parse(jsonStr) as SSEEvent;
                            onProgress(data);
                        } catch (e) {
                            console.warn('SSE parse error (retry):', e, 'Line:', line);
                        }
                    }
                }
            }
        })
        .catch((error) => {
            if (error.name !== 'AbortError') {
                onError(error);
            }
        });

    return { abort: () => controller.abort() };
}

/**
 * Fetch the raw script text from its S3 URL.
 */
export async function fetchScriptText(scriptUrl: string): Promise<string> {
    const resp = await fetch(scriptUrl);
    if (!resp.ok) throw new Error(`Failed to fetch script: ${resp.statusText}`);
    return resp.text();
}

// ---------------------------------------------------------------------------
// Render settings
// ---------------------------------------------------------------------------

export type RenderResolution = '720p' | '1080p';
export type RenderFps = 15 | 20 | 25 | 30 | 45 | 60;
export type CaptionSize = 'S' | 'M' | 'L';
export type CaptionPosition = 'top' | 'bottom';
export type CaptionStyle = 'phrase' | 'karaoke';
export type CaptionFontFamily = 'system' | 'inter' | 'montserrat' | 'noto-sans' | 'fira-code';
export type CaptionPreset = 'youtube' | 'tiktok' | 'karaoke' | 'cinema' | 'branded' | 'custom';

export interface RenderSettings {
    resolution: RenderResolution;
    fps: RenderFps;
    captions: boolean;
    captionPosition: CaptionPosition;
    captionTextColor: string;
    captionBgColor: string;
    captionBgOpacity: number; // 0-100
    captionSize: CaptionSize;
    /** Phrase shows the whole line; karaoke highlights the active word. */
    captionStyle: CaptionStyle;
    /** 'system' (default) or one of the four harness-loaded Google Fonts. */
    captionFontFamily: CaptionFontFamily;
    /** 400 / 500 / 600 / 700 / 800 / 900. Default 400. */
    captionFontWeight: number;
    /** Outline width in "px at 1920w canvas". 0 = no stroke. */
    captionTextStrokeWidth: number;
    /** Hex color for the outline. Ignored when width is 0. */
    captionTextStrokeColor: string;
    /** Hex color used for the active word in karaoke style. */
    captionHighlightColor: string;
    /** Informational — UI shows which preset is currently selected. */
    captionPreset?: CaptionPreset;
    watermark: boolean;
}

// Defaults upgraded 2026-07: 95% of users ship the default render, and
// 720p/20fps visibly stutters GSAP motion while plain phrase captions in the
// system font read as unfinished. New default = 1080p/30fps + the 'karaoke'
// caption preset (word-highlight, Inter 600, stroke, no box — the modern
// social-video look). Values mirror CAPTION_PRESETS.karaoke in
// caption-presets.ts — keep in lockstep. Saved user settings still win
// (RenderSettingsDialog overlays localStorage over these).
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
    resolution: '1080p',
    fps: 30,
    captions: true,
    captionPosition: 'bottom',
    captionTextColor: '#ffffff', // design-lint-ignore: functional hex sent as caption_text_color to the render API / native color-input value, not a CSS class
    captionBgColor: '#000000', // design-lint-ignore: functional hex sent as caption_bg_color to the render API / native color-input value, not a CSS class
    captionBgOpacity: 0,
    captionSize: 'L',
    captionStyle: 'karaoke',
    captionFontFamily: 'inter',
    captionFontWeight: 600,
    captionTextStrokeWidth: 4,
    captionTextStrokeColor: '#000000', // design-lint-ignore: functional hex sent as caption_text_stroke_color to the render API / native color-input value, not a CSS class
    captionHighlightColor: '#fbbf24', // design-lint-ignore: functional hex sent as caption_highlight_color to the render API / native color-input value, not a CSS class
    captionPreset: 'karaoke',
    watermark: true,
};

export async function requestVideoRender(
    videoId: string,
    apiKey: string,
    settings?: RenderSettings
): Promise<{ job_id: string; status: string }> {
    const headers: Record<string, string> = {
        'X-Institute-Key': apiKey,
    };
    let body: string | undefined;

    if (settings) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({
            resolution: settings.resolution,
            fps: settings.fps,
            show_captions: settings.captions,
            show_branding: settings.watermark,
            caption_position: settings.captionPosition,
            caption_text_color: settings.captionTextColor,
            caption_bg_color: settings.captionBgColor,
            caption_bg_opacity: settings.captionBgOpacity,
            caption_size: settings.captionSize,
            caption_style: settings.captionStyle,
            caption_font_family: settings.captionFontFamily,
            caption_font_weight: settings.captionFontWeight,
            caption_text_stroke_width: settings.captionTextStrokeWidth,
            caption_text_stroke_color: settings.captionTextStrokeColor,
            caption_highlight_color: settings.captionHighlightColor,
            caption_preset: settings.captionPreset,
        });
    }

    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/render/${videoId}`, {
        method: 'POST',
        headers,
        body,
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to request render: ${text}`);
    }

    return response.json();
}

export interface RenderStatus {
    job_id: string;
    video_id: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
    progress: number | null;
    video_url: string | null;
    error: string | null;
}

export async function getRenderStatus(
    jobId: string,
    apiKey: string,
    videoId?: string
): Promise<RenderStatus> {
    // Pass video_id as a query param so the backend watchdog can detect
    // stuck render jobs (jobs queued > RENDER_TIMEOUT_SECONDS), mark them
    // failed, and refund credits. Without video_id the watchdog is a no-op.
    const url = videoId
        ? `${AI_SERVICE_BASE_URL}/external/video/v1/render/status/${jobId}?video_id=${encodeURIComponent(videoId)}`
        : `${AI_SERVICE_BASE_URL}/external/video/v1/render/status/${jobId}`;
    const response = await fetch(url, {
        headers: {
            'X-Institute-Key': apiKey,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get render status: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Stop an in-flight generation pipeline server-side.
 *
 * The backend signals the pipeline thread to abort at its next safe
 * checkpoint, transitions the video to `CANCELLED`, refunds all credits
 * charged so far for it, and pushes a `cancelled` SSE event.
 *
 * Idempotent: returns `{ stopped: false }` if the video already finished
 * (completed / failed / previously cancelled). 404 if the videoId doesn't
 * exist.
 */
export async function cancelGeneration(
    videoId: string,
    apiKey: string
): Promise<{ status: string; video_id: string; stopped: boolean }> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/cancel/${videoId}`, {
        method: 'POST',
        headers: { 'X-Institute-Key': apiKey },
    });
    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Cancel failed: ${text}`);
    }
    return response.json();
}

/**
 * Clear the cached rendered MP4 for a video so it can be re-rendered.
 * Removes `video` from s3_urls and `render_job_id` from metadata.
 */
export async function clearRenderedVideo(videoId: string, apiKey: string): Promise<void> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/render/${videoId}`, {
        method: 'DELETE',
        headers: {
            'X-Institute-Key': apiKey,
        },
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to clear rendered video: ${text}`);
    }
}

export async function getVideoStatus(
    videoId: string,
    apiKey: string
): Promise<VideoStatusResponse> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/status/${videoId}`, {
        headers: {
            'X-Institute-Key': apiKey,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get video status: ${response.statusText}`);
    }

    return response.json();
}

export function getHistory(): HistoryItem[] {
    try {
        const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

export function saveToHistory(item: HistoryItem): void {
    const history = getHistory();
    const existingIndex = history.findIndex((h) => h.video_id === item.video_id);

    if (existingIndex >= 0) {
        history[existingIndex] = item;
    } else {
        history.unshift(item);
    }

    // Keep only last 50 items
    const trimmed = history.slice(0, 50);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
}

export function deleteFromHistory(videoId: string): void {
    const history = getHistory().filter((h) => h.video_id !== videoId);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
}

export function clearHistory(): void {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
}

/**
 * Get navigation mode for a content type
 */
export function getNavigationMode(contentType: ContentType): NavigationMode {
    return CONTENT_TYPE_NAVIGATION[contentType] || 'time_driven';
}

/**
 * Check if content type requires audio
 */
export function requiresAudio(contentType: ContentType): boolean {
    return getNavigationMode(contentType) === 'time_driven';
}

/**
 * Get content type label for display, translated via `t`.
 */
export function getContentTypeLabel(contentType: ContentType, t: TFunction): string {
    const found = buildContentTypes(t).find((ct) => ct.value === contentType);
    return found?.label || contentType;
}

interface RemoteHistoryItem {
    id: string;
    video_id: string;
    current_stage: VideoStage;
    status: VideoStatusType;
    content_type: ContentType;
    file_ids: Record<string, string>;
    s3_urls: {
        audio?: string;
        words?: string;
        script?: string;
        timeline?: string;
        branding_meta?: string;
        generated_images?: string;
    };
    prompt: string;
    language: string;
    error_message: string | null;
    metadata: Record<string, unknown>;
    thumbnails?: ThumbnailSet | Record<string, never> | null;
    token_usage?: TokenUsage | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

/** Map backend status strings (uppercase) to FE HistoryItem status. */
function mapRemoteStatus(status: string): HistoryItem['status'] {
    switch (status.toUpperCase()) {
        case 'COMPLETED':
            return 'completed';
        case 'FAILED':
            return 'failed';
        case 'STALLED':
            return 'failed';
        case 'IN_PROGRESS':
            return 'generating';
        case 'PENDING':
            return 'pending';
        default:
            return 'pending';
    }
}

export async function getRemoteHistory(
    apiKey: string,
    limit: number = 20,
    offset: number = 0
): Promise<HistoryItem[]> {
    const response = await fetch(
        `${AI_SERVICE_BASE_URL}/external/video/v1/history?limit=${limit}&offset=${offset}`,
        {
            headers: {
                'X-Institute-Key': apiKey,
                accept: 'application/json',
            },
        }
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch history: ${response.statusText}`);
    }

    const data: RemoteHistoryItem[] = await response.json();

    return data.map((item) => {
        // Pull persisted fields out of item.metadata when present. The pipeline
        // writes the original request snapshot to metadata.user_selections (and
        // a subset to top-level legacy keys) so history can reconstruct the
        // original generation settings faithfully.
        const meta = (item.metadata || {}) as Record<string, unknown>;
        const sel =
            (meta.user_selections as Record<string, unknown> | undefined) ||
            ({} as Record<string, unknown>);

        const pickStr = (key: string, fallback: string): string => {
            const v = sel[key] ?? meta[key];
            return typeof v === 'string' ? v : fallback;
        };
        const pickBool = (key: string, fallback: boolean): boolean => {
            const v = sel[key] ?? meta[key];
            return typeof v === 'boolean' ? v : fallback;
        };
        const pickStrOrUndef = (key: string): string | undefined => {
            const v = sel[key] ?? meta[key];
            return typeof v === 'string' ? v : undefined;
        };

        const orientation = pickStr('orientation', 'landscape') as VideoOrientation;
        const qualityTier = pickStr('quality_tier', 'ultra') as QualityTier;
        const visualStyle = pickStr('visual_style', 'standard') as VisualStyle;
        const voiceGender = pickStr('voice_gender', 'female') as VoiceGender;
        const ttsProvider = pickStr('tts_provider', 'standard') as TtsProvider;
        const htmlQuality = pickStr('html_quality', 'advanced') as 'classic' | 'advanced';

        // Visual preferences (Slice A back-end → Slice E history pre-fill).
        // The pipeline writes the raw slider state under
        // `meta.user_selections.visual_preferences` and a top-level mirror at
        // `meta.visual_preferences`. We prefer the nested view for newer runs
        // and fall back to the top-level for legacy paths. Old runs without
        // either return undefined → sliders default to "auto" everywhere.
        const visualPreferencesRaw =
            (sel.visual_preferences as Record<string, unknown> | undefined) ??
            (meta.visual_preferences as Record<string, unknown> | undefined);
        const visualPreferences: VisualPreferences | undefined =
            visualPreferencesRaw && typeof visualPreferencesRaw === 'object'
                ? (visualPreferencesRaw as VisualPreferences)
                : undefined;

        // Thumbnails come down as either an empty `{}` (pre-generation) or
        // the full set. Normalise to either a populated ThumbnailSet or null.
        const rawThumbs = item.thumbnails;
        let thumbnails: ThumbnailSet | null = null;
        if (
            rawThumbs &&
            typeof rawThumbs === 'object' &&
            Array.isArray((rawThumbs as ThumbnailSet).options) &&
            (rawThumbs as ThumbnailSet).options.length > 0
        ) {
            thumbnails = rawThumbs as ThumbnailSet;
        }

        return {
            id: item.id,
            video_id: item.video_id,
            prompt: item.prompt,
            content_type: item.content_type,
            status: mapRemoteStatus(item.status),
            stage: item.current_stage,
            created_at: item.created_at,
            html_url: item.s3_urls.timeline,
            audio_url: item.s3_urls.audio,
            words_url: item.s3_urls.words,
            options: {
                content_type: item.content_type,
                language: pickStr('language', item.language),
                voice_gender: voiceGender,
                tts_provider: ttsProvider,
                voice_id: pickStrOrUndef('voice_id'),
                captions_enabled: pickBool('captions_enabled', true),
                html_quality: htmlQuality,
                target_audience: pickStr('target_audience', 'General/Adult'),
                target_duration: pickStr('target_duration', '2-3 minutes'),
                model: pickStr('model', ''),
                quality_tier: qualityTier,
                orientation,
                visual_style: visualStyle,
                ...(visualPreferences ? { visual_preferences: visualPreferences } : {}),
                // Phase 3b/4/5 AI video flags — surfaced so re-runs from
                // history rehydrate the user's original choice. Defaults
                // false; backend gates against tier eligibility.
                ai_video_enabled: pickBool('ai_video_enabled', false),
                ai_video_audio_enabled: pickBool('ai_video_audio_enabled', false),
                ai_video_model: pickStrOrUndef('ai_video_model') as AiVideoModel | undefined,
                // V200 per-stage overrides — rehydrate from saved metadata
                // (user_selections.model_overrides, falling back to
                // meta.model_overrides). Old records without model_overrides
                // fall back to the legacy `model` string which the BE
                // collapses into ModelOverrides(default=model) server-side.
                ...(() => {
                    const v = sel['model_overrides'] ?? meta['model_overrides'];
                    return v && typeof v === 'object'
                        ? { model_overrides: v as ModelOverrides }
                        : {};
                })(),
            },
            token_usage: item.token_usage ?? null,
            thumbnails,
        };
    });
}

// ---------------------------------------------------------------------------
// Frame regeneration
// ---------------------------------------------------------------------------

export interface RegenerateFramePatchOp {
    target: string;
    selector_hint?: string;
    new_value?: string;
    confidence?: number;
}

export interface RegenerateFrameClassification {
    intent: 'targeted_patch' | 'full_remake';
    patch_ops?: RegenerateFramePatchOp[];
    rationale?: string;
    confidence?: number;
}

export interface RegenerateFrameAppliedOp {
    target: string;
    selector: string;
    before: string;
    after: string;
    ok: boolean;
}

export interface RegenerateFrameResponse {
    video_id: string;
    frame_index: number;
    timestamp: number;
    original_html: string;
    new_html: string;
    /** model_id actually used. `null` when the DOM-patch fast path ran (no LLM). */
    resolved_model?: string | null;
    /** 'dom_patch' (deterministic), 'full_remake' (canonical LLM), or
     *  'full_remake_fallback' (classifier wanted a patch but no op was applicable). */
    regen_path?: 'dom_patch' | 'full_remake' | 'full_remake_fallback';
    classification?: RegenerateFrameClassification | null;
    applied_ops?: RegenerateFrameAppliedOp[] | null;
}

export interface RegenerateFrameOptions {
    /** Optional model override. When omitted, the BE uses the same model that
     *  authored the shot (persisted at gen time), then registry default for
     *  use_case='video_regenerate', then a hard fallback. */
    model?: string;
}

/**
 * Ask the AI to regenerate a single frame's HTML using a user prompt.
 * Pass the entry's inTime (seconds) as `timestamp` for time_driven videos,
 * or the entry's array index for user_driven/self_contained.
 * Returns the new HTML for preview — call frame/update to persist.
 */
export async function regenerateFrame(
    videoId: string,
    apiKey: string,
    timestamp: number,
    userPrompt: string,
    options?: RegenerateFrameOptions
): Promise<RegenerateFrameResponse> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/frame/regenerate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Institute-Key': apiKey,
        },
        body: JSON.stringify({
            video_id: videoId,
            timestamp,
            user_prompt: userPrompt,
            ...(options?.model ? { model: options.model } : {}),
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to regenerate frame: ${text}`);
    }

    return response.json();
}

// ---------------------------------------------------------------------------
// Saved casts (storybook/drama) — same characters + voices across a series
// ---------------------------------------------------------------------------

export interface VideoCastCharacter {
    name: string;
    visual_description?: string;
    voice_hint?: string;
    voice_gender?: string;
    /** Reference portrait; null when the source run never generated one. */
    sheet_url?: string | null;
}

export interface VideoCast {
    cast_id: string;
    name: string;
    characters: VideoCastCharacter[];
    source_video_id?: string | null;
    created_at?: string | null;
}

export async function listCasts(apiKey: string): Promise<VideoCast[]> {
    const res = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/cast/list`, {
        headers: { 'X-Institute-Key': apiKey },
    });
    if (!res.ok) throw new Error(`Failed to list casts: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.casts) ? data.casts : [];
}

export async function saveCastFromVideo(
    videoId: string,
    apiKey: string,
    name?: string
): Promise<VideoCast> {
    const res = await fetch(
        `${AI_SERVICE_BASE_URL}/external/video/v1/cast/save-from-video/${encodeURIComponent(videoId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Institute-Key': apiKey },
            body: JSON.stringify({ name: name ?? null }),
        }
    );
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Failed to save cast: ${text}`);
    }
    return res.json();
}

export async function deleteCast(castId: string, apiKey: string): Promise<void> {
    const res = await fetch(
        `${AI_SERVICE_BASE_URL}/external/video/v1/cast/${encodeURIComponent(castId)}`,
        { method: 'DELETE', headers: { 'X-Institute-Key': apiKey } }
    );
    if (!res.ok) throw new Error(`Failed to delete cast: ${res.status}`);
}

/**
 * Persist a single frame's HTML back to the timeline. Companion to
 * `regenerateFrame`: call this with the `frame_index` + `new_html` returned
 * from regenerate (or any locally-edited HTML) to commit the change.
 *
 * The pipeline view's "Regenerate this scene" panel uses this to accept
 * the AI's new HTML directly — no roundtrip through the editor's save path.
 */
export async function updateFrame(
    videoId: string,
    apiKey: string,
    frameIndex: number,
    newHtml: string,
    options?: { htmlModel?: string }
): Promise<void> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/frame/update`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Institute-Key': apiKey,
        },
        body: JSON.stringify({
            video_id: videoId,
            frame_index: frameIndex,
            new_html: newHtml,
            // Stamp the model that authored this HTML — read at regen time
            // so the next "Remake with AI" uses the same model.
            ...(options?.htmlModel ? { html_model: options.htmlModel } : {}),
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to update frame: ${text}`);
    }
}

// ---------------------------------------------------------------------------
// Pre-generation cost preview
// ---------------------------------------------------------------------------

export interface VideoCostPreviewRequest {
    quality_tier: QualityTier;
    model?: string;
    target_duration: string;
    target_audience: string;
    orientation: VideoOrientation;
    visual_style?: VisualStyle;
    voice_gender: VoiceGender;
    tts_provider: TtsProvider;
    voice_id?: string;
    language: string;
    generate_avatar: boolean;
    background_music_enabled: boolean | null;
    sound_effects_enabled: boolean;
    content_type: ContentType;
    captions_enabled: boolean;
    html_quality: 'classic' | 'advanced';
    review_mode: boolean;
    attachments_count: number;
    /** Optional on-screen host. Adds avatar synthesis cost lines on ultra+ tiers. */
    host?: HostConfig;
    /** Lesson mode — with a teacher, adds the Spatius teacher cost row (8 credits/min). */
    lesson?: LessonConfig;
    /** When true (ultra+ only), the estimator adds an AI video (Veo)
     *  upper-bound row to the breakdown. Mirrors the runtime flag. */
    ai_video_enabled?: boolean;
    ai_video_audio_enabled?: boolean;
    /** Dialogue scenes (storybook/drama) — adds the acted-clips cost row,
     *  capped at the tier's dialogue budget. Mirrors the runtime flags. */
    dialogue_scenes_enabled?: boolean;
    dialogue_mode?: 'storybook' | 'drama';
    dialogue_clip_model?: 'seedance-2.0' | 'omni-flash';
}

export interface VideoCostPreviewBreakdownRow {
    component: string;
    detail: string;
    cost_usd: number;
    credits: number;
}

export interface VideoCostPreviewResponse {
    selections: {
        quality_tier: string;
        model: string | null;
        target_duration: string;
        duration_band: string;
        target_audience: string;
        orientation: string;
        visual_style: string;
        voice: { gender: string; provider: string; voice_id: string | null };
        language: string;
        generate_avatar: boolean;
        background_music_enabled: boolean;
        sound_effects_enabled: boolean;
        content_type: string;
        captions_enabled: boolean;
        html_quality: string;
        review_mode: boolean;
        attachments_count: number;
    };
    estimate: {
        expected_credits: number;
        low_credits: number;
        high_credits: number;
        expected_cost_usd: number;
        low_cost_usd: number;
        high_cost_usd: number;
        breakdown: VideoCostPreviewBreakdownRow[];
        duration_band: string;
        assumptions: string[];
        model_registered: boolean;
    };
    balance: {
        current: number | null;
        after_expected: number | null;
        after_high: number | null;
        sufficient: boolean;
        sufficient_for_high: boolean;
    };
}

export async function previewVideoCost(
    payload: VideoCostPreviewRequest,
    apiKey: string
): Promise<VideoCostPreviewResponse> {
    const response = await fetch(`${AI_SERVICE_BASE_URL}/external/video/v1/preview-cost`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Institute-Key': apiKey,
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to preview cost: ${text}`);
    }
    return response.json();
}
