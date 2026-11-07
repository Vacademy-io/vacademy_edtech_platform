/**
 * Movie-production terminology + sub-stage → node mapping. Single source of
 * truth so node copy stays consistent and BE sub_stage strings translate
 * deterministically into derived `PipelineState`.
 *
 * Backend sub_stage strings (sourced from automation_pipeline.py +
 * music_generator.py — see docs/ai_content/AI_VIDEO_GENERATION.md). The FE
 * never invents these; it just maps them onto the production vocabulary.
 *
 * Two graph shapes coexist:
 *   v2 → Pitch → Research? → Beats? → Screenplay → Narration → Storyboard → Scenes → Talent? / Score? → Final Cut
 *   v3 → Pitch → Research? → ShotPlanner → NarrationWriter → Scenes → Talent? / Score? → Final Cut
 * v3 collapses Beats/Screenplay/Narration/Storyboard into the ShotPlanner +
 * NarrationWriter pair (one LLM hop each instead of three).
 */

import type { TFunction } from 'i18next';

export type PipelineNodeId =
    | 'pitch'
    | 'research'
    | 'beats'
    | 'screenplay'
    | 'narration'
    | 'storyboard'
    // v3 nodes — present only when pipelineVersion === 'v3'.
    | 'shotPlanner'
    | 'narrationWriter'
    | 'filming'
    | 'talent'
    | 'score'
    | 'finalCut';

/**
 * Namespace for this module's translated display strings — see
 * src/locales/en/videoApiStudioStageVocab.json. Every consumer resolves keys
 * against this namespace explicitly (fully-qualified `${NS}:key` lookups),
 * since each is normally bound to its OWN component namespace via its own
 * `useTranslation` call. Files with no existing `useTranslation` bind one
 * directly to this namespace instead.
 */
const NS = 'videoApiStudioStageVocab';

/**
 * Movie-language label for each node. Used in node header copy + the
 * right-panel stages list. Keep concise.
 */
export function buildNodeLabels(t: TFunction): Record<PipelineNodeId, string> {
    return {
        pitch: t(`${NS}:nodeLabels.pitch`),
        research: t(`${NS}:nodeLabels.research`),
        beats: t(`${NS}:nodeLabels.beats`),
        screenplay: t(`${NS}:nodeLabels.screenplay`),
        narration: t(`${NS}:nodeLabels.narration`),
        storyboard: t(`${NS}:nodeLabels.storyboard`),
        shotPlanner: t(`${NS}:nodeLabels.shotPlanner`),
        narrationWriter: t(`${NS}:nodeLabels.narrationWriter`),
        filming: t(`${NS}:nodeLabels.filming`),
        talent: t(`${NS}:nodeLabels.talent`),
        score: t(`${NS}:nodeLabels.score`),
        finalCut: t(`${NS}:nodeLabels.finalCut`),
    };
}

/**
 * Live sub-status copy when a node is actively in production. Picked by
 * matching the BE sub_stage string OR the broad pipeline stage when no
 * sub_stage is present yet.
 */
export function buildActiveSubStatus(t: TFunction): Record<PipelineNodeId, string> {
    return {
        pitch: t(`${NS}:activeSubStatus.pitch`),
        research: t(`${NS}:activeSubStatus.research`),
        beats: t(`${NS}:activeSubStatus.beats`),
        screenplay: t(`${NS}:activeSubStatus.screenplay`),
        narration: t(`${NS}:activeSubStatus.narration`),
        storyboard: t(`${NS}:activeSubStatus.storyboard`),
        shotPlanner: t(`${NS}:activeSubStatus.shotPlanner`),
        narrationWriter: t(`${NS}:activeSubStatus.narrationWriter`),
        filming: t(`${NS}:activeSubStatus.filming`),
        talent: t(`${NS}:activeSubStatus.talent`),
        score: t(`${NS}:activeSubStatus.score`),
        finalCut: t(`${NS}:activeSubStatus.finalCut`),
    };
}

/**
 * BE sub_stage → node ownership. A sub_stage moves the matching node to
 * `in_production` (if it was scheduled) or keeps it active. The `*_done`
 * sub_stages are handled separately as "wrapped" signals.
 *
 * Source: automation_pipeline.py + music_generator.py + shot_planner.py +
 * narration_writer.py (see plan doc for line refs).
 */
export const SUB_STAGE_BY_NODE: Record<string, PipelineNodeId> = {
    // v2 stages
    beats_planning: 'beats',
    beats_done: 'beats',
    script_writing: 'screenplay',
    script_done: 'screenplay',
    tts_generating: 'narration',
    tts_done: 'narration',
    director_planning: 'storyboard',
    director_done: 'storyboard',
    html_generating: 'filming',
    html_done: 'filming',
    // v3 stages — ShotPlanner runs first (absorbs BeatPlanner +
    // ScriptGenerator + Director); NarrationWriter runs second (replaces
    // monolithic TTS planning, per-shot TTS still produces audio downstream).
    shot_planning: 'shotPlanner',
    shot_planning_done: 'shotPlanner',
    narration_writing: 'narrationWriter',
    narration_writing_done: 'narrationWriter',
    // Talent / Score (sub-stages emitted by avatar_batch + music_generator)
    avatar_batch_start: 'talent',
    avatar_image_audio_ready: 'talent',
    avatar_render_done: 'talent',
    avatar_failed: 'talent',
    avatar_batch_done: 'talent',
    background_music_start: 'score',
    background_music_segment: 'score',
    background_music_concat: 'score',
    background_music_done: 'score',
};

/** True when the sub_stage represents that node's wrapped/finished signal. */
export function isWrappingSubStage(subStage: string | null | undefined): boolean {
    if (!subStage) return false;
    return subStage.endsWith('_done') || subStage === 'avatar_batch_done';
}

/**
 * Stage ordering used by the linear-node state derivation: a node is
 * `wrapped` when the pipeline has advanced past its stage, `in_production`
 * when the stage matches, and `scheduled` otherwise.
 */
export const STAGE_ORDER = ['PENDING', 'SCRIPT', 'TTS', 'WORDS', 'HTML', 'DONE'] as const;
export type PipelineStage = (typeof STAGE_ORDER)[number];

/**
 * Which broad stage owns a given linear node. Storyboard and Filming both
 * live inside the HTML stage but are split apart by sub_stage signals.
 *
 * `beats` lives inside the SCRIPT stage (BeatPlanner runs before _draft_script
 * inside the script-writing block). It rides the same stage marker as
 * screenplay but uses `beats_planning` / `beats_done` sub-stages to flip
 * earlier than screenplay's `script_writing`.
 *
 * v3 nodes (`shotPlanner`, `narrationWriter`) live in the SCRIPT stage —
 * ShotPlanner runs in the script stage's dispatch block (replacing BeatPlanner
 * + Script Generator + Director); NarrationWriter immediately follows.
 * Per-shot TTS then runs inside the HTML stage on v3.
 */
export const NODE_STAGE: Record<
    Exclude<PipelineNodeId, 'research' | 'talent' | 'score' | 'finalCut'>,
    PipelineStage
> = {
    pitch: 'PENDING',
    beats: 'SCRIPT',
    screenplay: 'SCRIPT',
    narration: 'TTS', // WORDS is folded into Narration
    storyboard: 'HTML',
    shotPlanner: 'SCRIPT',
    narrationWriter: 'SCRIPT',
    filming: 'HTML',
};
