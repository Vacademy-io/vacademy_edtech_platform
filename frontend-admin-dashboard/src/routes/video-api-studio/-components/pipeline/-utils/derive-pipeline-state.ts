/**
 * Derive a single normalized PipelineState from either the live SSE-driven
 * `currentGeneration` shape OR the polled `/status` + `/urls` shape. The
 * downstream components (PipelineFlow, PipelinePanel) consume this without
 * caring which source it came from — so the same UI works during live
 * generation and after completion.
 */

import type { TFunction } from 'i18next';
import type {
    ContentType,
    GenerateVideoRequest,
    ShotPlanItem,
    TokenUsage,
    VideoLiveProgress,
    VideoOrientation,
    VideoStage,
    VideoStatusMetadata,
    VideoStatusResponse,
    VideoStatusUserSelections,
} from '../../../-services/video-generation';
import {
    NODE_STAGE,
    STAGE_ORDER,
    SUB_STAGE_BY_NODE,
    type PipelineNodeId,
    type PipelineStage,
} from './stage-vocab';

const NS = 'videoApiStudioDerivePipelineState';

/**
 * Translated "X cut from production" / halt error text for a `NodeSlot`'s
 * `error` field (rendered verbatim by `NodeDetailSheet`). Falls back to the
 * English literal when `t` isn't threaded through by the caller, so callers
 * that haven't been migrated yet keep working exactly as before.
 */
function cutError(t: TFunction | undefined, key: string, fallback: string): string {
    return t ? t(`${NS}:${key}`) : fallback;
}

// ── Slot shapes ──────────────────────────────────────────────────────────

export type NodeState = 'scheduled' | 'in_production' | 'wrapped' | 'reshoot' | 'cut';

export type NodeSlot<A> =
    | { state: 'scheduled' }
    | { state: 'in_production'; subStatus?: string; partialData?: Partial<A> }
    | { state: 'wrapped'; data: A }
    | { state: 'reshoot' | 'cut'; error: string };

export interface PitchArtifact {
    prompt: string;
    referenceCount: number;
    /**
     * Full snapshot of what the user requested at gen-start. BE writes this
     * once to `extra_metadata.user_selections`, so it's available from the
     * first poll. Powers the Pitch sheet's Configuration + Advanced sections.
     * Optional because older videos pre-date the snapshot.
     */
    userSelections?: VideoStatusUserSelections;
}
/** Screenshot / scraped image captured by `scrape_url`. */
export interface ResearchScreenshot {
    url: string;
    name?: string;
}

/** Web-search source — host + url synthesized into the script context. */
export interface ResearchSource {
    url: string;
    host?: string;
    title?: string;
    thumbUrl?: string;
}

export interface ResearchArtifact {
    /** True when the router enabled `scrape_url`. */
    scrapedAny: boolean;
    /** True when the router enabled `web_search`. */
    searchedAny: boolean;
    /** URLs the scraper attempted to capture. */
    urlsAttempted?: string[];
    /** Captured screenshots / inline images surfaced to the user. */
    screenshots?: ResearchScreenshot[];
    /** First ~4kb of scraped page text (fed into the screenplay prompt). */
    scrapedExcerpt?: string;
    /** Web-search natural-language answer (capped at ~2kb on the BE). */
    searchAnswer?: string;
    /** Cited sources from `web_search` — host+url tuples. */
    sources?: ResearchSource[];
    /** User's search query, derived by the intent router. */
    searchQuery?: string;
}
export interface ScreenplayArtifact {
    scriptUrl?: string;
}
/**
 * BeatPlanner output — populated when the v2 pipeline runs the explicit
 * beat-planning stage before Script Generator. Each beat carries a duration
 * estimate (in seconds) and an intent role so the Director can plan shots
 * from the beat outline rather than from word timings alone.
 */
export interface BeatsArtifact {
    /** Number of beats the planner emitted. */
    count: number;
    /** Optional preview list; capped to 12 (the planner's max_beats). */
    beats?: Array<{
        label?: string;
        intentRole?: string;
        visualTypeHint?: string;
        durationEstimateS?: number;
        intendedNarration?: string;
    }>;
    /** WPM used for duration estimates (currently 150 wpm; calibrated per voice). */
    wpm?: number;
}
export interface NarrationArtifact {
    audioUrl?: string;
    wordsUrl?: string;
    wordCount?: number;
}

// ── v3 slot shapes ──────────────────────────────────────────────────────
//
// v3 pipeline collapses the Beats/Script/Director chain into two LLM hops:
// ShotPlanner (does everything Director did + plan-level recurring motifs +
// per-shot intent_role/background_treatment/transition_in/audio_policy) and
// NarrationWriter (authors the per-shot narration text; intrinsic_only shots
// get an empty string and skip TTS).

/** Plan-level recurring motif emitted by ShotPlanner (v3 only). */
export interface RecurringMotif {
    description: string;
    screenPosition?: string;
    whenVisible?: string;
}

export interface ShotPlannerArtifact {
    /** Total shot count the planner emitted. */
    shotCount: number;
    /** Shots with `audio_policy=intrinsic_only` (Veo audio / source clip). */
    intrinsicCount: number;
    /** Shots with `audio_policy=narration_only`. */
    narratedCount: number;
    /** Cross-shot continuity contracts the planner wrote. May be empty. */
    recurringMotifs: RecurringMotif[];
    /** Distribution by intent_role (`hook`, `body`, `close`, etc.). */
    intentRoleBreakdown?: Record<string, number>;
    /** Distribution by background_treatment (`brand_solid`, etc.). */
    backgroundBreakdown?: Record<string, number>;
    /** Raw `shot_plan.json` S3 URL when persisted. Absent today; planned. */
    shotPlanUrl?: string;
}

export interface NarrationWriterArtifact {
    /** Total words NarrationWriter authored across all shots. */
    totalWords: number;
    /** Per-shot word counts (index → words). 0 for skipped intrinsic shots. */
    perShotWordCounts: number[];
    /** Number of shots whose narration_text was empty (intrinsic_only). */
    skippedIntrinsicCount: number;
    /** Master narration mp3 (the concat). */
    narrationMp3Url?: string;
    /** Master word timings JSON. */
    narrationWordsUrl?: string;
}
export interface StoryboardArtifact {
    scenes: Array<{
        index: number;
        shotType: string;
        startTime: number;
        endTime: number;
        durationS: number;
        narrationExcerpt?: string;
    }>;
}
export interface FilmingArtifact {
    shotsCompleted: number;
    shotsTotal: number;
}

/**
 * One scene node — derived from `shotPlan[i]` (live) or `gp.shot_plan[i]`
 * (polled). Thumbnails (`imageUrl` / `videoUrl`) are populated lazily by
 * parsing the final timeline.json once it's fetched; until then the scene
 * still renders with its narration excerpt + state ring.
 */
export interface SceneSlot {
    state: NodeState;
    index: number;
    shotType: string;
    narrationExcerpt?: string;
    durationS: number;
    startTime: number;
    endTime: number;
    imageUrl?: string;
    videoUrl?: string;
    error?: string;
    // ── v3 metadata (optional; absent on v2 runs) ─────────────────────
    /** Planner's intent for this shot's narration — distinct from `narrationText`. */
    narrationBrief?: string;
    /** Full per-shot narration NarrationWriter authored. */
    narrationText?: string;
    /** Render-time audio routing: drives the per-window narration mute. */
    audioPolicy?: 'narration_only' | 'intrinsic_only';
    /** ShotPlanner background classification (drives cross-shot contract). */
    backgroundTreatment?: string;
    /** Pre-picked transition keyword (`crossfade`, `circle_iris`, …). */
    transitionIn?: string;
    /** Role in the narrative arc (`hook`, `body`, `close`, `product_proof`). */
    intentRole?: string;
    /** Per-shot mp3 URL (v3 only). Absent when `audioPolicy === 'intrinsic_only'`. */
    audioUrl?: string;
    /** Per-shot word-timings JSON URL. */
    audioWordsUrl?: string;
    /** Per-shot narration plain-text URL. */
    audioScriptUrl?: string;
    /** Per-shot audio duration (sec) from the TTS pass. */
    audioDurationS?: number;
    /** True on intrinsic_only shots — no per-shot TTS was generated. */
    audioSkipped?: boolean;
    // ── AI video (Veo) metadata, populated from timeline.json meta.shots[] ──
    aiVideoOn?: boolean;
    aiVideoRequestId?: string;
    aiVideoUrl?: string;
    aiVideoCostCredits?: number;
    aiVideoCostUsd?: number;
    aiVideoElapsedS?: number;
    aiVideoSegments?: Array<{
        segIdx: number;
        videoUrl?: string;
        durationS?: number;
        requestId?: string;
        cacheHit?: boolean;
    }>;
    /**
     * Per-shot live snapshot from the BE RunStateAggregator. Carries the
     * mid-render substage, regen counters, and any third-party calls active
     * on this shot. Populated when `status.live.shots[idx]` exists.
     */
    liveDetail?: SceneLiveDetail;
}

/** Mid-render live detail for a single scene. Cleared once the run wraps. */
export interface SceneLiveDetail {
    /** html_gen | density | bbox_lint | brand_asset | vision_review | screenshot | tts | media_polling */
    substage?: string | null;
    /** Sum of all regen attempts across all gates — drives the scene-card counter chip. */
    regenCount: number;
    /** Per-step regen counts, e.g. {vision_regen: 2, bbox_regen: 1}. */
    attempts?: Record<string, number>;
    /** Verdict log entries — full timeline of every regen decision. */
    regenLog?: Array<{
        step: string;
        attempt: number;
        verdict: string;
        reason?: string | null;
        at: number;
    }>;
    /** External-call records cross-referenced from `live.external_calls`. */
    externalCalls?: Array<{
        id: string;
        provider: string;
        op: string;
        state: 'queued' | 'polling' | 'done' | 'failed';
        pollCount?: number;
        startedAt?: number;
        finishedAt?: number | null;
        elapsedS?: number | null;
        error?: string | null;
    }>;
    elapsedS?: number | null;
    lastError?: string | null;
    costUsd?: number;
}
/**
 * One avatar take rendered for a host shot. Sourced from
 * `extra_metadata.host.outputs.shot_artifacts[]` post-completion. Live runs
 * don't expose per-shot URLs through SSE — only counters — so the array is
 * empty until status fetch.
 */
export interface TalentTake {
    shotIndex: number;
    hostImageUrl?: string;
    avatarVideoUrl?: string;
    durationS?: number;
    status?: string;
    error?: string;
}

export interface TalentArtifact {
    completed: number;
    total: number;
    takes?: TalentTake[];
}

export interface ScoreArtifact {
    /** Final merged-track S3 URL, present once the run wraps. */
    audioUrl?: string;
    /** Display label from `meta.audio_tracks[]` (e.g. "Background Music"). */
    label?: string;
    segmentsTotal?: number;
    segmentsCompleted?: number;
}
export interface FinalCutArtifact {
    timelineUrl: string;
    audioUrl?: string;
    wordsUrl?: string;
    contentType: ContentType;
    orientation: VideoOrientation;
}

export interface PipelineState {
    /**
     * `awaiting_review` covers review-mode runs that have wrapped at SCRIPT
     * but haven't been kicked through to TTS yet — the user must accept /
     * edit the script before the pipeline resumes. Today consumers don't
     * fully differentiate it from `in_production`; consumer migration in
     * the next phase will add review-specific UI affordances.
     */
    status: 'in_production' | 'wrapped' | 'halted' | 'awaiting_review';
    videoId: string;
    prompt: string;
    contentType: ContentType;
    orientation: VideoOrientation;
    /**
     * Which pipeline architecture this run used. v3 replaces the
     * Beats/Screenplay/Narration/Storyboard chain with ShotPlanner +
     * NarrationWriter; the diagram + stages list swap node sets accordingly.
     * Defaults to v2 when the BE doesn't surface it.
     */
    pipelineVersion: 'v2' | 'v3';
    pitch: NodeSlot<PitchArtifact>;
    research?: NodeSlot<ResearchArtifact>;
    /**
     * BeatPlanner stage — present only when the run fires `beats_planning` /
     * `beats_done` sub-stage events (the v2 pipeline path, enabled when the
     * tier has `beat_planner_enabled` set). When absent the diagram skips
     * the Beats node entirely.
     */
    beats?: NodeSlot<BeatsArtifact>;
    screenplay: NodeSlot<ScreenplayArtifact>;
    narration: NodeSlot<NarrationArtifact>;
    storyboard: NodeSlot<StoryboardArtifact>;
    /**
     * v3-only stage — ShotPlanner replaces Director (+ absorbs BeatPlanner +
     * Script Generator). Populated when `pipelineVersion === 'v3'`. On v2
     * runs this slot is absent and the v2 chain renders instead.
     */
    shotPlanner?: NodeSlot<ShotPlannerArtifact>;
    /**
     * v3-only stage — NarrationWriter authors per-shot narration in a single
     * LLM hop after the plan is locked.
     */
    narrationWriter?: NodeSlot<NarrationWriterArtifact>;
    /**
     * Per-scene slots — populated when the Director's shot plan is known.
     * When empty (free / standard tier without a director), the diagram
     * falls back to the single `filming` counter node instead.
     */
    scenes: SceneSlot[];
    /**
     * Aggregate counter — kept as fallback for runs without a shot plan,
     * and used by the right-panel "Filming X/N" stages-list row regardless
     * of whether scene nodes are rendered.
     */
    filming: NodeSlot<FilmingArtifact>;
    talent?: NodeSlot<TalentArtifact>;
    score?: NodeSlot<ScoreArtifact>;
    finalCut: NodeSlot<FinalCutArtifact>;
    stats: {
        elapsedMs?: number;
        cumulativeTokens?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            estimated_cost_usd?: number | null;
        };
        tokenUsage?: TokenUsage | null;
    };
    /** S3 URLs flattened for the right-panel artifact links card */
    artifactUrls: {
        script?: string;
        audio?: string;
        words?: string;
        timeline?: string;
        videoMp4?: string;
    };
    /**
     * v3 live-progress detail — present when the BE `status.live` snapshot
     * is available. Drives the auto-focus camera, the director-thinking
     * ticker below the diagram, and any future cost/external-call surfaces.
     */
    liveActiveStage?: string | null;
    liveActiveSubstage?: string | null;
    liveDirectorThought?: string | null;
    liveStarted?: number | null;
    liveLastEventAt?: number | null;
    liveCosts?: {
        spentUsd?: number;
        spentCredits?: number;
        capUsd?: number | null;
        capCredits?: number | null;
    };
}

// ── Live source: CurrentGeneration (SSE-driven, consoleState='generating') ──

/** The shape consumed from `console/index.lazy.tsx` `CurrentGeneration`. */
export interface LiveCurrentGeneration {
    videoId: string;
    prompt: string;
    contentType: ContentType;
    orientation?: VideoOrientation;
    stage: VideoStage;
    percentage: number;
    message: string;
    htmlUrl?: string;
    audioUrl?: string;
    wordsUrl?: string;
    scriptUrl?: string;
    /** Final rendered MP4 URL — set when /urls/{video_id} returned video_url
     *  (i.e. a previous render already completed). Lets the pipeline panel
     *  show the "Download MP4" CTA on refresh without polling render status. */
    videoMp4Url?: string;
    options: Omit<GenerateVideoRequest, 'prompt'>;
    tokenUsage?: TokenUsage | null;
    shotsCompleted?: number;
    shotsTotal?: number;
    cumulativeTokens?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        estimated_cost_usd?: number | null;
    };
    recentErrors?: Array<{
        shot_index: number;
        shot_type?: string;
        error: string;
        retrying: boolean;
    }>;
    shotPlan?: ShotPlanItem[];
    /**
     * v3 only — plan-level recurring motifs from the ShotPlanner. Captured
     * from the `shot_planning_done` sub_stage event.
     */
    recurringMotifs?: Array<{
        description: string;
        screen_position?: string;
        when_visible?: string;
    }>;
    /** v3 only — words NarrationWriter authored. From `narration_writing_done`. */
    narrationWordCount?: number;
    /**
     * v3 only — pipeline version snapshot, captured from the request's
     * options.pipeline_version (when the FE sent one) or backfilled from
     * /status.metadata.pipeline_version on history rehydration.
     */
    pipelineVersion?: 'v2' | 'v3';
    /** Latest `shot_planning*` sub_stage seen on the wire. */
    shotPlannerSubStage?: string;
    /** Latest `narration_writing*` sub_stage seen on the wire. */
    narrationWriterSubStage?: string;
    /**
     * Universal "latest sub_stage on the wire" — set by the SSE handler on
     * every `sub_stage` event, regardless of which family it belongs to.
     * Replaces the substring-match-on-`message` lookup that
     * `detectActiveSubStage` used to do (which broke because the message
     * had underscores replaced with spaces). Consumers should prefer this
     * field; `detectActiveSubStage` is kept as a fallback only.
     */
    currentSubStage?: string;
    /**
     * In-memory append-only log of every SSE event seen during this
     * session. Capped at `EVENT_LOG_CAP` entries on the writer side.
     * Drives the Developer / Audit drawer; persists only for the duration
     * of the tab session (resume from history reconstructs from BE
     * snapshots instead).
     */
    eventLog?: PipelineEventLogEntry[];
    /** Avatar-host counters captured from SSE — see CurrentGeneration in the console. */
    hostShotCount?: number;
    hostShotCompleted?: number;
    hostBatchDone?: boolean;
    hostSubStage?: string;
    /** Background-music counters captured from SSE. */
    musicSegmentsTotal?: number;
    musicSegmentsCompleted?: number;
    musicDone?: boolean;
    musicUrl?: string;
    musicSubStage?: string;
    /** Filled when the run starts (set by parent — we don't read Date.now()
     *  inside derivation to keep it pure). */
    startedAtMs?: number;
}

/**
 * One captured SSE event for the Developer / Audit drawer. The shape is
 * intentionally loose so any event type can be persisted without a new
 * variant; the drawer renders whichever fields are present.
 */
export interface PipelineEventLogEntry {
    /** Monotonic timestamp (ms since session start, not epoch). */
    tsMs: number;
    /** SSE `type` field (`progress` | `sub_stage` | `shot_done` | …). */
    eventType: string;
    /** SSE `sub_stage` field when `eventType === 'sub_stage'`. */
    subStage?: string;
    /** Pipeline stage from the event when present. */
    stage?: string;
    /** Human-readable message — the prefixed form the console wrote. */
    message?: string;
    /** Shot index when the event is per-shot (`shot_done`, `shot_error`, `avatar_*`). */
    shotIndex?: number;
    /** When the event carried a token delta, the prompt/completion totals. */
    tokenDelta?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        estimated_cost_usd?: number | null;
    };
    /** When the event carried a shot_count (director_done / shot_planning_done). */
    shotCount?: number;
    /** Capture an error message verbatim. */
    error?: string;
}

/** Soft cap to keep `eventLog` from ballooning on chatty long runs. */
export const EVENT_LOG_CAP = 500;

/**
 * Match the freshest sub_stage hint out of `currentGeneration.message`. The
 * BE doesn't expose sub_stage as a top-level field on the live SSE event —
 * it shows up in the human-readable message, e.g. "🎙️ avatar_batch_start"
 * after our 🎙️ prefix. We keep the lookup loose: substring match in the
 * message.
 */
function detectActiveSubStage(message: string | undefined): string | null {
    if (!message) return null;
    const m = message.toLowerCase();
    for (const sub of Object.keys(SUB_STAGE_BY_NODE)) {
        if (m.includes(sub)) return sub;
    }
    return null;
}

function isPipelineHaltedFromErrors(errors?: LiveCurrentGeneration['recentErrors']): boolean {
    if (!errors) return false;
    // Any non-retrying error => halt
    return errors.some((e) => !e.retrying);
}

/** Linear-node state derivation. */
function stateForLinearNode(
    pipelineStage: PipelineStage,
    activeSubStage: string | null,
    hasArtifact: boolean,
    nodeId: PipelineNodeId,
    nodeStage: PipelineStage
): NodeState {
    if (hasArtifact) return 'wrapped';
    if (activeSubStage && SUB_STAGE_BY_NODE[activeSubStage] === nodeId) return 'in_production';
    if (STAGE_ORDER.indexOf(pipelineStage) > STAGE_ORDER.indexOf(nodeStage)) return 'wrapped';
    if (pipelineStage === nodeStage) return 'in_production';
    return 'scheduled';
}

/**
 * Match http(s)://… URLs in a free-form prompt. Loose by design — the BE's
 * intent router uses a similar regex (`web_content_capture_service.extract_urls`)
 * to decide whether to enable `scrape_url`.
 */
const URL_REGEX = /https?:\/\/[^\s)<>"']+/gi;

function promptContainsUrl(prompt: string | undefined): boolean {
    if (!prompt) return false;
    URL_REGEX.lastIndex = 0;
    return URL_REGEX.test(prompt);
}

/**
 * Live-only Research slot. We don't have SSE coverage of the intent router,
 * so we infer presence from the prompt OR from explicit routing overrides.
 * Once the script is done, Research is "wrapped" by definition (it always
 * runs before SCRIPT). PipelineFlow then enriches with sources / excerpts
 * from `metadata.intent_outcomes` for already-finished videos.
 */
function derivedResearchLive(args: {
    prompt: string;
    routingOverrides?: { tools?: { scrape_url?: boolean; web_search?: boolean } };
    scriptDone: boolean;
    runWrapped: boolean;
    halted: boolean;
    pipelineStage: PipelineStage;
    t?: TFunction;
}): NodeSlot<ResearchArtifact> | undefined {
    const hasUrl = promptContainsUrl(args.prompt);
    const overrides = args.routingOverrides?.tools;
    const explicitScrape = overrides?.scrape_url === true;
    const explicitSearch = overrides?.web_search === true;
    const explicitSkip = overrides?.scrape_url === false && overrides?.web_search === false;

    // Hide entirely when nothing about the prompt or overrides suggests
    // research will run — keeps the diagram compact for plain prompts.
    if (explicitSkip) return undefined;
    if (!hasUrl && !explicitScrape && !explicitSearch) return undefined;

    if (args.runWrapped || args.scriptDone) {
        // Wrapped without payload — enrichedState fills sources/screenshots
        // when status metadata loads.
        return {
            state: 'wrapped',
            data: {
                scrapedAny: hasUrl || explicitScrape,
                searchedAny: explicitSearch,
                urlsAttempted: hasUrl ? extractPromptUrls(args.prompt) : undefined,
            },
        };
    }
    if (args.halted) {
        return { state: 'cut', error: cutError(args.t, 'errors.researchCut', 'Research cut from production') };
    }
    // Pre-script — research either is or about to be running.
    if (
        args.pipelineStage === 'PENDING' ||
        STAGE_ORDER.indexOf(args.pipelineStage) <= STAGE_ORDER.indexOf('SCRIPT')
    ) {
        return { state: 'in_production' };
    }
    return { state: 'scheduled' };
}

function extractPromptUrls(prompt: string): string[] {
    URL_REGEX.lastIndex = 0;
    return prompt.match(URL_REGEX) ?? [];
}

/**
 * Live-only Beats slot. Visible only when the BE actually fired BeatPlanner
 * sub-stage events — we infer that from `activeSubStage` matching
 * `beats_planning` / `beats_done` OR (heuristic) when the pipeline has
 * advanced past PENDING AND we know the run uses v2 from its tier config.
 *
 * Phase A: pure detection from sub_stage. History replay (status path) will
 * mirror this once the BE surfaces a beats_v2.json URL in `s3_urls` — until
 * then completed runs won't show the Beats node even if BeatPlanner ran.
 */
function derivedBeatsLive(args: {
    activeSubStage: string | null;
    scriptDone: boolean;
    runWrapped: boolean;
    halted: boolean;
    /** Hint: if the script step appears in_production OR the run is mid-SCRIPT
     *  and we've ALREADY seen a beats_* event during this session. */
    sawBeatsEver: boolean;
    t?: TFunction;
}): NodeSlot<BeatsArtifact> | undefined {
    const beatsActive = args.activeSubStage === 'beats_planning';
    if (!beatsActive && !args.sawBeatsEver) return undefined;

    if (args.runWrapped || args.scriptDone) {
        return { state: 'wrapped', data: { count: 0 } };
    }
    if (args.halted) {
        return {
            state: 'cut',
            error: cutError(args.t, 'errors.beatsCut', 'Beat planning cut from production'),
        };
    }
    if (beatsActive) {
        return { state: 'in_production' };
    }
    return { state: 'scheduled' };
}

// ── Phase 3 helpers: Talent / Score slot derivation ──────────────────────

/**
 * Talent slot from live counters. Returns `undefined` when the user didn't
 * request a host AND we haven't seen any avatar_* sub_stage — i.e. there's
 * nothing to show, so the node is hidden entirely.
 */
function derivedTalent(args: {
    requested: boolean;
    sawStage: boolean;
    runWrapped: boolean;
    halted: boolean;
    hostShotCount?: number;
    hostShotCompleted?: number;
    hostBatchDone?: boolean;
    hostSubStage?: string;
    t?: TFunction;
}): NodeSlot<TalentArtifact> | undefined {
    const { requested, sawStage, runWrapped, halted } = args;
    if (!requested && !sawStage) return undefined;

    const total = args.hostShotCount ?? 0;
    const done = args.hostShotCompleted ?? 0;
    const wrapped = args.hostBatchDone || (runWrapped && requested);

    if (wrapped) {
        return { state: 'wrapped', data: { completed: total || done, total: total || done } };
    }
    if (halted) {
        return { state: 'cut', error: cutError(args.t, 'errors.talentCut', 'Talent cut from production') };
    }
    if (sawStage) {
        return {
            state: 'in_production',
            subStatus: args.hostSubStage,
            partialData: { completed: done, total },
        };
    }
    // Requested but no events yet — show as scheduled.
    return { state: 'scheduled' };
}

// ── v3 helpers ───────────────────────────────────────────────────────────

/**
 * Detect v3 from any signal we have: an explicit `pipeline_version`, the
 * presence of v3 sub_stages, or v3-shaped fields in a shot plan item. Returns
 * `'v3'` only on positive signal — unknown defaults to `'v2'` so the existing
 * graph keeps rendering for legacy runs.
 */
function detectPipelineVersion(args: {
    explicit?: 'v2' | 'v3';
    activeSubStage?: string | null;
    shotPlan?: ShotPlanItem[];
}): 'v2' | 'v3' {
    if (args.explicit === 'v3' || args.explicit === 'v2') return args.explicit;
    const sub = args.activeSubStage ?? '';
    if (sub.startsWith('shot_planning') || sub.startsWith('narration_writing')) {
        return 'v3';
    }
    if (args.shotPlan?.some((s) => s.narration_brief != null || s.audio_policy != null)) {
        return 'v3';
    }
    return 'v2';
}

function shotPlannerArtifactFromShots(
    shots: ShotPlanItem[],
    motifs?: Array<{ description: string; screen_position?: string; when_visible?: string }>
): ShotPlannerArtifact {
    let intrinsic = 0;
    let narrated = 0;
    const intentRoleBreakdown: Record<string, number> = {};
    const backgroundBreakdown: Record<string, number> = {};
    for (const s of shots) {
        if (s.audio_policy === 'intrinsic_only') intrinsic++;
        else narrated++;
        if (s.intent_role) {
            intentRoleBreakdown[s.intent_role] = (intentRoleBreakdown[s.intent_role] ?? 0) + 1;
        }
        if (s.background_treatment) {
            backgroundBreakdown[s.background_treatment] =
                (backgroundBreakdown[s.background_treatment] ?? 0) + 1;
        }
    }
    return {
        shotCount: shots.length,
        intrinsicCount: intrinsic,
        narratedCount: narrated,
        recurringMotifs: (motifs ?? []).map((m) => ({
            description: m.description,
            screenPosition: m.screen_position,
            whenVisible: m.when_visible,
        })),
        intentRoleBreakdown: Object.keys(intentRoleBreakdown).length
            ? intentRoleBreakdown
            : undefined,
        backgroundBreakdown: Object.keys(backgroundBreakdown).length
            ? backgroundBreakdown
            : undefined,
    };
}

function narrationWriterArtifactFromShots(
    shots: ShotPlanItem[],
    totalWordsOverride?: number,
    masterMp3?: string,
    masterWords?: string
): NarrationWriterArtifact {
    const perShotWordCounts: number[] = [];
    let skippedIntrinsic = 0;
    let totalWords = 0;
    for (const s of shots) {
        if (s.audio_skipped || s.audio_policy === 'intrinsic_only') {
            perShotWordCounts.push(0);
            skippedIntrinsic++;
            continue;
        }
        const text = (s.narration_text ?? s.narration_excerpt ?? '').trim();
        const n = text ? text.split(/\s+/).length : 0;
        perShotWordCounts.push(n);
        totalWords += n;
    }
    return {
        totalWords: totalWordsOverride ?? totalWords,
        perShotWordCounts,
        skippedIntrinsicCount: skippedIntrinsic,
        narrationMp3Url: masterMp3,
        narrationWordsUrl: masterWords,
    };
}

/**
 * Build a fully-populated `SceneSlot` from a single `ShotPlanItem` + the
 * derived scene `state`. Handles both v2 (only the base fields) and v3
 * (all the extra metadata). Pure — caller decides the scene's NodeState.
 */
function sceneFromShot(
    s: ShotPlanItem,
    arrayIdx: number,
    state: NodeState,
    err?: string
): SceneSlot {
    const idx = typeof s.shot_index === 'number' ? s.shot_index : arrayIdx;
    return {
        state,
        index: idx,
        shotType: s.shot_type,
        narrationExcerpt: s.narration_excerpt ?? s.narration_text,
        durationS: s.duration_s,
        startTime: s.start_time,
        endTime: s.end_time,
        narrationBrief: s.narration_brief,
        narrationText: s.narration_text,
        audioPolicy: s.audio_policy,
        backgroundTreatment: s.background_treatment,
        transitionIn: s.transition_in,
        intentRole: s.intent_role,
        audioUrl: s.audio_url,
        audioWordsUrl: s.audio_words_url,
        audioScriptUrl: s.audio_script_url,
        audioDurationS: s.audio_duration_s,
        audioSkipped: s.audio_skipped,
        error: state === 'cut' ? err : undefined,
    };
}

function derivedScore(args: {
    sawStage: boolean;
    runWrapped: boolean;
    halted: boolean;
    musicSegmentsTotal?: number;
    musicSegmentsCompleted?: number;
    musicDone?: boolean;
    musicUrl?: string;
    musicSubStage?: string;
    t?: TFunction;
}): NodeSlot<ScoreArtifact> | undefined {
    const { sawStage, runWrapped, halted } = args;
    if (!sawStage && !args.musicUrl) return undefined;

    if (args.musicDone || (runWrapped && (args.musicUrl || sawStage))) {
        return {
            state: 'wrapped',
            data: {
                audioUrl: args.musicUrl,
                segmentsTotal: args.musicSegmentsTotal,
                segmentsCompleted: args.musicSegmentsCompleted ?? args.musicSegmentsTotal,
            },
        };
    }
    if (halted) {
        return { state: 'cut', error: cutError(args.t, 'errors.scoreCut', 'Score cut from production') };
    }
    return {
        state: 'in_production',
        subStatus: args.musicSubStage,
        partialData: {
            segmentsTotal: args.musicSegmentsTotal,
            segmentsCompleted: args.musicSegmentsCompleted,
        },
    };
}

export function derivePipelineFromLive(
    cg: LiveCurrentGeneration,
    nowMs: number = Date.now(),
    t?: TFunction
): PipelineState {
    const pipelineStage = (cg.stage as PipelineStage) ?? 'PENDING';
    // Prefer the universal `currentSubStage` field that the SSE handler
    // writes on every `sub_stage` event. Fall back to the legacy
    // substring-match-on-`message` for resilience with older event shapes
    // — but the substring path is structurally broken (the console
    // replaces underscores with spaces when prefixing messages, so
    // `shot_planning` never matches "🎬 shot planning"). Once every
    // call site is migrated, the fallback can be deleted.
    const activeSub = cg.currentSubStage ?? detectActiveSubStage(cg.message);
    const halted = isPipelineHaltedFromErrors(cg.recentErrors);
    const orientation: VideoOrientation = cg.orientation ?? 'landscape';

    // ── Master flag: is the run unambiguously finished? ──────────────────
    // For videos opened from history, generation_progress fields like
    // shotPlan/shotsCompleted/shotsTotal aren't populated — we only have
    // the artifact URLs. When the timeline + audio (when needed) are
    // present, the pipeline must have completed every upstream stage. So
    // every node retroactively becomes `wrapped`, regardless of which
    // sub_stage signals are missing.
    const audioReady = !!cg.audioUrl || cg.contentType === 'SLIDES';
    const runWrapped = !!cg.htmlUrl && audioReady;

    // Pitch is always wrapped — the prompt exists from t=0.
    const pitch: NodeSlot<PitchArtifact> = {
        state: 'wrapped',
        data: {
            prompt: cg.prompt,
            referenceCount: 0,
        },
    };

    const screenplayState: NodeState = runWrapped
        ? 'wrapped'
        : stateForLinearNode(
              pipelineStage,
              activeSub,
              !!cg.scriptUrl,
              'screenplay',
              NODE_STAGE.screenplay
          );
    const screenplay: NodeSlot<ScreenplayArtifact> =
        screenplayState === 'wrapped'
            ? { state: 'wrapped', data: { scriptUrl: cg.scriptUrl } }
            : screenplayState === 'in_production'
              ? { state: 'in_production' }
              : { state: 'scheduled' };

    const narrationState: NodeState = runWrapped
        ? 'wrapped'
        : stateForLinearNode(
              pipelineStage,
              activeSub,
              !!cg.audioUrl,
              'narration',
              NODE_STAGE.narration
          );
    const narration: NodeSlot<NarrationArtifact> =
        narrationState === 'wrapped'
            ? {
                  state: 'wrapped',
                  data: { audioUrl: cg.audioUrl, wordsUrl: cg.wordsUrl },
              }
            : narrationState === 'in_production'
              ? { state: 'in_production' }
              : { state: 'scheduled' };

    // Storyboard wraps when shotPlan arrives (director_done), filming has
    // obviously begun (shotsCompleted > 0), or the run is fully wrapped.
    const inHtmlStage = pipelineStage === 'HTML';
    const storyboardKnown = !!cg.shotPlan?.length || (cg.shotsCompleted ?? 0) > 0;
    const storyboardState: NodeState =
        runWrapped || storyboardKnown
            ? 'wrapped'
            : inHtmlStage
              ? 'in_production'
              : STAGE_ORDER.indexOf(pipelineStage) > STAGE_ORDER.indexOf('HTML')
                ? 'wrapped'
                : 'scheduled';
    const storyboard: NodeSlot<StoryboardArtifact> =
        storyboardState === 'wrapped' && cg.shotPlan?.length
            ? {
                  state: 'wrapped',
                  data: {
                      scenes: cg.shotPlan.map((s, arrayIdx) => ({
                          index: typeof s.shot_index === 'number' ? s.shot_index : arrayIdx,
                          shotType: s.shot_type,
                          startTime: s.start_time,
                          endTime: s.end_time,
                          durationS: s.duration_s,
                          narrationExcerpt: s.narration_excerpt,
                      })),
                  },
              }
            : storyboardState === 'wrapped'
              ? { state: 'wrapped', data: { scenes: [] } }
              : storyboardState === 'in_production'
                ? { state: 'in_production' }
                : { state: 'scheduled' };

    // Filming = the act of all scenes wrapping. Aggregate counter (used as
    // fallback when scene-level data is missing).
    const total = cg.shotsTotal ?? cg.shotPlan?.length ?? 0;
    const done = cg.shotsCompleted ?? 0;
    const filmingDone = (total > 0 && done >= total) || runWrapped;
    const filmingActive = inHtmlStage && (storyboardKnown || total > 0);
    const filmingState: NodeState = filmingDone
        ? 'wrapped'
        : halted
          ? 'cut'
          : filmingActive
            ? 'in_production'
            : 'scheduled';
    const filming: NodeSlot<FilmingArtifact> =
        filmingState === 'wrapped'
            ? { state: 'wrapped', data: { shotsCompleted: total, shotsTotal: total } }
            : filmingState === 'in_production'
              ? {
                    state: 'in_production',
                    partialData: { shotsCompleted: done, shotsTotal: total },
                }
              : filmingState === 'cut'
                ? {
                      state: 'cut',
                      error:
                          cg.recentErrors?.find((e) => !e.retrying)?.error ||
                          cutError(t, 'errors.productionHalted', 'Production halted'),
                  }
                : { state: 'scheduled' };

    // Per-scene slots — only populated when shotPlan is known. Each scene's
    // state is derived from its index relative to `done` + any matching
    // `recentErrors`. v3 metadata (narration_brief, audio_policy, etc.) is
    // carried through `sceneFromShot` automatically. Thumbnails are merged
    // post-derivation via `PipelineFlow.enrichedState`.
    const scenes: SceneSlot[] = (cg.shotPlan ?? []).map((s, arrayIdx) => {
        const idx = typeof s.shot_index === 'number' ? s.shot_index : arrayIdx;
        const errEntry = cg.recentErrors?.find((e) => e.shot_index === idx);
        let sceneState: NodeState = 'scheduled';
        if (runWrapped) sceneState = 'wrapped';
        else if (errEntry && !errEntry.retrying) sceneState = 'cut';
        else if (errEntry && errEntry.retrying) sceneState = 'reshoot';
        else if (idx < done) sceneState = 'wrapped';
        else if (idx === done && inHtmlStage) sceneState = 'in_production';
        return sceneFromShot(s, arrayIdx, sceneState, errEntry?.error);
    });

    // Final Cut wraps when timeline + audio (when needed) are present —
    // i.e. exactly the runWrapped condition.
    const finalCut: NodeSlot<FinalCutArtifact> = runWrapped
        ? {
              state: 'wrapped',
              data: {
                  timelineUrl: cg.htmlUrl!,
                  audioUrl: cg.audioUrl,
                  wordsUrl: cg.wordsUrl,
                  contentType: cg.contentType,
                  orientation,
              },
          }
        : halted
          ? { state: 'cut', error: cutError(t, 'errors.productionHalted', 'Production halted') }
          : { state: 'in_production' };

    // ── Research (Phase 4) ───────────────────────────────────────────────
    // The pre-script intent router doesn't emit SSE events, so live state is
    // limited to "is there a URL the BE will probably scrape?" The richer
    // payload (sources / screenshots / excerpt) is enriched post-hoc from
    // `metadata.intent_outcomes` in PipelineFlow's enrichedState memo.
    const research = derivedResearchLive({
        prompt: cg.prompt,
        routingOverrides: cg.options.routing_overrides,
        scriptDone: !!cg.scriptUrl,
        runWrapped,
        halted,
        pipelineStage,
        t,
    });

    // ── Beats (v2 pipeline) ──────────────────────────────────────────────
    // Visible while BeatPlanner is running (activeSub === 'beats_planning').
    // Stays as `wrapped` once the script step is done (BeatPlanner runs
    // before _draft_script, so script_done implies beats are done too).
    // Hidden entirely on legacy v1 runs that never emitted beats_*.
    const beats = derivedBeatsLive({
        activeSubStage: activeSub,
        scriptDone: !!cg.scriptUrl,
        runWrapped,
        halted,
        // Active OR script_done implies we definitely saw beats fire on v2.
        sawBeatsEver: activeSub === 'beats_planning' || activeSub === 'beats_done',
        t,
    });

    // ── Talent / Score (Phase 3) ─────────────────────────────────────────
    // Show the Talent branch when the user requested a host avatar OR the BE
    // has emitted any avatar_* sub_stage event (covers the resume-from-history
    // case where `cg.options.host` may be missing but the SSE replay still
    // contains the stage events).
    const hostType = cg.options.host?.type;
    const talentRequested = hostType === 'avatar';
    const hostStageSeen = !!cg.hostSubStage;
    const talent = derivedTalent({
        requested: talentRequested,
        sawStage: hostStageSeen,
        runWrapped,
        halted,
        hostShotCount: cg.hostShotCount,
        hostShotCompleted: cg.hostShotCompleted,
        hostBatchDone: cg.hostBatchDone,
        hostSubStage: cg.hostSubStage,
        t,
    });

    // Music gating: live `cg.options` doesn't carry `background_music_enabled`
    // (FE GenerateVideoRequest doesn't expose it), so we only know music is in
    // the pipeline once we see a `background_music_*` sub_stage event. That
    // matches the live UX — there's nothing to show before the first event.
    const musicStageSeen = !!cg.musicSubStage;
    const score = derivedScore({
        sawStage: musicStageSeen,
        runWrapped,
        halted,
        musicSegmentsTotal: cg.musicSegmentsTotal,
        musicSegmentsCompleted: cg.musicSegmentsCompleted,
        musicDone: cg.musicDone,
        musicUrl: cg.musicUrl,
        musicSubStage: cg.musicSubStage,
        t,
    });

    const status: PipelineState['status'] = halted
        ? 'halted'
        : runWrapped
          ? 'wrapped'
          : 'in_production';

    // ── v3 slot derivation ───────────────────────────────────────────────
    // Pipeline version is positively detected from the request payload OR
    // from v3-only signals (v3 sub_stages or v3 fields on the shot plan).
    // Defaults to v2 — the legacy chain stays the rendered fallback.
    const pipelineVersion = detectPipelineVersion({
        explicit: cg.pipelineVersion,
        activeSubStage: activeSub,
        shotPlan: cg.shotPlan,
    });
    const isV3 = pipelineVersion === 'v3';

    let shotPlanner: NodeSlot<ShotPlannerArtifact> | undefined;
    let narrationWriter: NodeSlot<NarrationWriterArtifact> | undefined;
    if (isV3) {
        const haveShots = !!cg.shotPlan?.length;
        // Use the dedicated SSE-captured sub_stage fields, not the
        // substring-match-on-`message` derivation. The console replaces
        // underscores with spaces when building the prefixed message
        // (`🎬 shot planning`), so `detectActiveSubStage` would miss
        // `shot_planning` in the message string. Same pattern as the
        // avatar/music branches, which use `hostSubStage` / `musicSubStage`.
        const plannerSub = cg.shotPlannerSubStage;
        const plannerActive = plannerSub === 'shot_planning';
        const plannerDone = plannerSub === 'shot_planning_done' || haveShots;
        if (plannerDone) {
            shotPlanner = {
                state: 'wrapped',
                data: shotPlannerArtifactFromShots(cg.shotPlan ?? [], cg.recurringMotifs),
            };
        } else if (plannerActive) {
            shotPlanner = { state: 'in_production' };
        } else if (halted) {
            shotPlanner = {
                state: 'cut',
                error: cutError(t, 'errors.shotPlanningCut', 'Shot planning cut from production'),
            };
        } else {
            shotPlanner = { state: 'scheduled' };
        }

        const writerSub = cg.narrationWriterSubStage;
        const writerActive = writerSub === 'narration_writing';
        const writerDone =
            writerSub === 'narration_writing_done' ||
            (cg.shotPlan?.some(
                (s) => typeof s.narration_text === 'string' && s.narration_text.length > 0
            ) ??
                false);
        if (writerDone || runWrapped) {
            narrationWriter = {
                state: 'wrapped',
                data: narrationWriterArtifactFromShots(
                    cg.shotPlan ?? [],
                    cg.narrationWordCount,
                    cg.audioUrl,
                    cg.wordsUrl
                ),
            };
        } else if (writerActive) {
            narrationWriter = { state: 'in_production' };
        } else if (halted) {
            narrationWriter = {
                state: 'cut',
                error: cutError(
                    t,
                    'errors.narrationWritingCut',
                    'Narration writing cut from production'
                ),
            };
        } else if (plannerDone) {
            // Planner done but writer hasn't started — scheduled.
            narrationWriter = { state: 'scheduled' };
        } else {
            narrationWriter = { state: 'scheduled' };
        }
    }

    return {
        status,
        videoId: cg.videoId,
        prompt: cg.prompt,
        contentType: cg.contentType,
        orientation,
        pipelineVersion,
        pitch,
        screenplay,
        narration,
        storyboard,
        scenes,
        filming,
        ...(research ? { research } : {}),
        ...(beats ? { beats } : {}),
        ...(shotPlanner ? { shotPlanner } : {}),
        ...(narrationWriter ? { narrationWriter } : {}),
        ...(talent ? { talent } : {}),
        ...(score ? { score } : {}),
        finalCut,
        stats: {
            elapsedMs: cg.startedAtMs ? nowMs - cg.startedAtMs : undefined,
            cumulativeTokens: cg.cumulativeTokens,
            tokenUsage: cg.tokenUsage,
        },
        artifactUrls: {
            script: cg.scriptUrl,
            audio: cg.audioUrl,
            words: cg.wordsUrl,
            timeline: cg.htmlUrl,
            videoMp4: cg.videoMp4Url,
        },
    };
}

// ── Canonical source: VideoStatusResponse (status-first model) ──────────
//
// Single derivation that produces a `PipelineState` from `/status` alone —
// the dual-path (live SSE → currentGeneration vs. polled status) collapses
// here. URLs come from `status.s3_urls`, configuration from
// `status.metadata.user_selections`, Research/Talent/Score enrichment from
// `status.metadata.{intent_outcomes,host,audio_tracks}`.
//
// Live runs feed this via `useVideoState`'s React Query polling; SSE only
// triggers re-fetches and is not the data channel. History-restored runs go
// through the same path with no separate hydration step.

export function derivePipelineFromStatus(
    status: VideoStatusResponse,
    opts?: {
        /** When provided, drives the "Elapsed" counter. Caller pins this once
         *  at submit time so derivation stays pure. */
        startedAtMs?: number;
        /** Fallbacks when the BE status payload omits a field (mostly
         *  defensive — modern /status responses include all three). */
        promptOverride?: string;
        contentTypeOverride?: ContentType;
        orientationOverride?: VideoOrientation;
    },
    nowMs: number = Date.now(),
    t?: TFunction
): PipelineState {
    const gp = status.generation_progress ?? null;
    const meta = status.metadata ?? null;
    const userSel: VideoStatusUserSelections = meta?.user_selections ?? {};
    const pipelineStage = (status.current_stage as PipelineStage) ?? 'PENDING';

    // ── BE-driven top-level status ─────────────────────────────────────
    // Trust `status.status` as the source of truth; the old "infer from URL
    // presence" trick is brittle once /status returns URLs incrementally.
    const beStatus = status.status;
    const halted = beStatus === 'FAILED' || beStatus === 'STALLED' || beStatus === 'CANCELLED';
    const beCompleted = beStatus === 'COMPLETED';

    // S3 URLs flattened from `s3_urls` (BE returns every populated key).
    const s3 = status.s3_urls ?? {};
    const scriptUrl = s3.script;
    const audioUrl = s3.audio;
    const wordsUrl = s3.words;
    const timelineUrl = s3.timeline;
    const videoMp4Url = s3.video;

    // Content metadata: prefer caller override, then user_selections snapshot,
    // then the status's top-level content_type / language. `prompt` follows
    // the same precedence.
    const contentType: ContentType =
        opts?.contentTypeOverride ?? userSel.content_type ?? status.content_type ?? 'VIDEO';
    const orientation: VideoOrientation =
        opts?.orientationOverride ?? userSel.orientation ?? 'landscape';
    const prompt = opts?.promptOverride ?? status.prompt ?? userSel.prompt ?? '';

    // Review-mode detection: a run that wraps at SCRIPT and was explicitly
    // target_stage='SCRIPT' is awaiting user review, not done. The console's
    // `reviewing` state subscribes to this.
    const targetStage = userSel.target_stage;
    const awaitingReview = beCompleted && targetStage === 'SCRIPT' && pipelineStage === 'SCRIPT';

    // The "everything upstream is done" flag — drives retroactive wrapping
    // when the BE status hits COMPLETED. For SLIDES content_type the audio
    // gate is bypassed (no narration produced).
    const audioReadyOrNotRequired = !!audioUrl || contentType === 'SLIDES';
    const runWrapped = beCompleted && !awaitingReview && !!timelineUrl && audioReadyOrNotRequired;

    // ── Pitch ─────────────────────────────────────────────────────────
    // Always wrapped — the prompt exists from t=0. Phase 2 will expand
    // PitchArtifact to carry the full user_selections snapshot.
    const pitch: NodeSlot<PitchArtifact> = {
        state: 'wrapped',
        data: { prompt, referenceCount: userSel.reference_files_count ?? 0 },
    };

    // ── Screenplay ────────────────────────────────────────────────────
    const screenplay: NodeSlot<ScreenplayArtifact> =
        scriptUrl || runWrapped || awaitingReview
            ? { state: 'wrapped', data: { scriptUrl } }
            : pipelineStage === 'SCRIPT'
              ? { state: 'in_production' }
              : STAGE_ORDER.indexOf(pipelineStage) > STAGE_ORDER.indexOf('SCRIPT')
                ? { state: 'wrapped', data: {} }
                : { state: 'scheduled' };

    // ── Narration ─────────────────────────────────────────────────────
    const narration: NodeSlot<NarrationArtifact> =
        audioUrl || runWrapped
            ? { state: 'wrapped', data: { audioUrl, wordsUrl } }
            : pipelineStage === 'TTS' || pipelineStage === 'WORDS'
              ? { state: 'in_production' }
              : STAGE_ORDER.indexOf(pipelineStage) > STAGE_ORDER.indexOf('TTS')
                ? { state: 'wrapped', data: {} }
                : { state: 'scheduled' };

    // ── Storyboard ────────────────────────────────────────────────────
    const shotPlan = gp?.shot_plan ?? [];
    const shotsCompleted = gp?.shots_completed ?? 0;
    const shotsTotal = gp?.shots_total ?? 0;
    const storyboardScenes = shotPlan.map((s, arrayIdx) => ({
        index: typeof s.shot_index === 'number' ? s.shot_index : arrayIdx,
        shotType: s.shot_type,
        startTime: s.start_time,
        endTime: s.end_time,
        durationS: s.duration_s,
        narrationExcerpt: s.narration_excerpt,
    }));
    const storyboard: NodeSlot<StoryboardArtifact> =
        shotPlan.length > 0 || runWrapped
            ? { state: 'wrapped', data: { scenes: storyboardScenes } }
            : pipelineStage === 'HTML'
              ? { state: 'in_production' }
              : { state: 'scheduled' };

    // ── Filming (aggregate counter; also drives the legacy free-tier node) ──
    const filming: NodeSlot<FilmingArtifact> = runWrapped
        ? {
              state: 'wrapped',
              data: { shotsCompleted: shotsTotal || shotsCompleted, shotsTotal },
          }
        : halted
          ? {
                state: 'cut',
                error:
                    status.error_message ||
                    cutError(t, 'errors.productionHalted', 'Production halted'),
            }
          : pipelineStage === 'HTML' && shotsTotal > 0
            ? { state: 'in_production', partialData: { shotsCompleted, shotsTotal } }
            : { state: 'scheduled' };

    // ── Per-scene slots ───────────────────────────────────────────────
    const errors = gp?.errors ?? [];
    const scenes: SceneSlot[] = shotPlan.map((s, arrayIdx) => {
        const idx = typeof s.shot_index === 'number' ? s.shot_index : arrayIdx;
        const errEntry = errors.find((e) => e.shot_index === idx);
        let sceneState: NodeState = 'scheduled';
        if (runWrapped) sceneState = 'wrapped';
        else if (errEntry && !errEntry.retrying) sceneState = 'cut';
        else if (errEntry && errEntry.retrying) sceneState = 'reshoot';
        else if (idx < shotsCompleted) sceneState = 'wrapped';
        else if (idx === shotsCompleted && pipelineStage === 'HTML') sceneState = 'in_production';
        return sceneFromShot(s, arrayIdx, sceneState, errEntry?.error);
    });

    // ── Final Cut ─────────────────────────────────────────────────────
    const finalCut: NodeSlot<FinalCutArtifact> = runWrapped
        ? {
              state: 'wrapped',
              data: {
                  timelineUrl: timelineUrl!,
                  audioUrl,
                  wordsUrl,
                  contentType,
                  orientation,
              },
          }
        : halted
          ? {
                state: 'cut',
                error:
                    status.error_message ||
                    cutError(t, 'errors.productionHalted', 'Production halted'),
            }
          : { state: awaitingReview ? 'scheduled' : 'in_production' };

    // ── Research (from metadata.intent_outcomes) ──────────────────────
    // intent_outcomes is written ONCE at gen start before any pipeline stage
    // runs — so the moment /status is polled, sources / screenshots / excerpts
    // are available. Absorbs the PipelineFlow.enrichedState research branch.
    const research = derivedResearchFromStatus({
        prompt,
        intent: meta?.intent_outcomes,
        routingOverrides: userSel.routing_overrides,
        pipelineStage,
        runWrapped,
        halted,
        t,
    });

    // ── Talent (from metadata.host) ───────────────────────────────────
    // Host outputs are accumulated server-side as the avatar batch runs.
    // Phase 3 BE work will flush per-shot. Until then, the artifacts arrive
    // at batch end — same UX as today for already-finished videos.
    const talent = derivedTalentFromStatus({
        userSelHostType: userSel.host?.type,
        userSelGenerateAvatar: userSel.generate_avatar,
        metaHost: meta?.host,
        runWrapped,
        halted,
        t,
    });

    // ── Score (from user_selections + metadata.audio_tracks) ──────────
    // The merged Lyria track is in timeline.json today (`meta.audio_tracks`);
    // Phase 3 BE work will mirror it into status.metadata.audio_tracks. We
    // read defensively from status — if missing, PipelineFlow's existing
    // `useBackgroundMusicTrack` hook continues to backfill the URL until BE
    // exposure lands.
    const score = derivedScoreFromStatus({
        userSelEnabled: userSel.background_music_enabled,
        metaEnabled: meta?.background_music_enabled,
        audioTracks: meta?.audio_tracks,
        runWrapped,
        halted,
        t,
    });

    const tokenUsage = status.token_usage ?? null;
    const cumulativeTokens = gp?.cumulative_tokens;

    const pipelineStatus: PipelineState['status'] = awaitingReview
        ? 'awaiting_review'
        : halted
          ? 'halted'
          : runWrapped
            ? 'wrapped'
            : 'in_production';

    // ── Pipeline version + v3 slots ───────────────────────────────────
    // Either user_selections OR top-level metadata may carry it. Falls back
    // to v3 detection from v3-shaped shot plan items / sub_stage so older
    // BE builds that don't expose pipeline_version still render correctly.
    const explicitVersion = userSel.pipeline_version ?? meta?.pipeline_version ?? undefined;
    const pipelineVersion = detectPipelineVersion({
        explicit: explicitVersion,
        activeSubStage: gp?.sub_stage,
        shotPlan: shotPlan,
    });
    const isV3 = pipelineVersion === 'v3';

    let shotPlanner: NodeSlot<ShotPlannerArtifact> | undefined;
    let narrationWriter: NodeSlot<NarrationWriterArtifact> | undefined;
    if (isV3) {
        const haveShots = shotPlan.length > 0;
        const sub = gp?.sub_stage ?? '';
        const plannerActive = sub === 'shot_planning';
        const plannerDone =
            sub === 'shot_planning_done' ||
            haveShots ||
            STAGE_ORDER.indexOf(pipelineStage) >= STAGE_ORDER.indexOf('TTS');
        if (halted && !plannerDone) {
            shotPlanner = {
                state: 'cut',
                error: cutError(t, 'errors.shotPlanningCut', 'Shot planning cut from production'),
            };
        } else if (plannerDone) {
            shotPlanner = {
                state: 'wrapped',
                data: shotPlannerArtifactFromShots(shotPlan, gp?.recurring_motifs),
            };
        } else if (plannerActive) {
            shotPlanner = { state: 'in_production' };
        } else {
            shotPlanner = { state: 'scheduled' };
        }

        const writerActive = sub === 'narration_writing';
        const writerDone =
            sub === 'narration_writing_done' ||
            shotPlan.some(
                (s) => typeof s.narration_text === 'string' && s.narration_text.length > 0
            ) ||
            !!audioUrl ||
            runWrapped;
        if (halted && !writerDone) {
            narrationWriter = {
                state: 'cut',
                error: cutError(
                    t,
                    'errors.narrationWritingCut',
                    'Narration writing cut from production'
                ),
            };
        } else if (writerDone) {
            narrationWriter = {
                state: 'wrapped',
                data: narrationWriterArtifactFromShots(
                    shotPlan,
                    gp?.narration_word_count,
                    audioUrl,
                    wordsUrl
                ),
            };
        } else if (writerActive) {
            narrationWriter = { state: 'in_production' };
        } else {
            narrationWriter = { state: 'scheduled' };
        }
    }

    const derived: PipelineState = {
        status: pipelineStatus,
        videoId: status.video_id,
        prompt,
        contentType,
        orientation,
        pipelineVersion,
        pitch,
        screenplay,
        narration,
        storyboard,
        scenes,
        filming,
        ...(research ? { research } : {}),
        ...(shotPlanner ? { shotPlanner } : {}),
        ...(narrationWriter ? { narrationWriter } : {}),
        ...(talent ? { talent } : {}),
        ...(score ? { score } : {}),
        finalCut,
        stats: {
            elapsedMs: opts?.startedAtMs ? nowMs - opts.startedAtMs : undefined,
            cumulativeTokens,
            tokenUsage,
        },
        artifactUrls: {
            script: scriptUrl,
            audio: audioUrl,
            words: wordsUrl,
            timeline: timelineUrl,
            videoMp4: videoMp4Url,
        },
    };

    // ── v3 live-snapshot enrichment ────────────────────────────────────
    // When the BE returns a `live` payload, fold per-shot substage / regen /
    // external-call detail into each `SceneSlot.liveDetail`, set the active
    // stage + director thought on the state, and override scene state from
    // live.shots[].state (which is the freshest signal during in_progress
    // runs). The base derivation above remains the source for everything
    // else — URLs, talent, score, costs (cumulative_tokens), etc. — so
    // this enrichment is purely additive.
    const live = status.live;
    if (live) {
        derived.liveActiveStage = live.active_stage ?? null;
        derived.liveActiveSubstage = live.active_substage ?? null;
        derived.liveDirectorThought = live.director_thought ?? null;
        derived.liveStarted = live.started_at ?? null;
        derived.liveLastEventAt = live.last_event_at ?? null;
        if (live.costs) {
            derived.liveCosts = {
                spentUsd: live.costs.spent_usd,
                spentCredits: live.costs.spent_credits,
                capUsd: live.costs.cap_usd ?? null,
                capCredits: live.costs.cap_credits ?? null,
            };
        }
        // Index external calls so we can attach them per-shot without an
        // O(n×m) scan inside the map below.
        const externalCallsByShot = new Map<number, VideoLiveProgress['external_calls']>();
        for (const c of live.external_calls ?? []) {
            const idx = typeof c.shot_idx === 'number' ? c.shot_idx : null;
            if (idx === null) continue;
            const bucket = externalCallsByShot.get(idx) ?? [];
            bucket.push(c);
            externalCallsByShot.set(idx, bucket);
        }
        // Merge per-shot live state into the scenes array. The base
        // derivation populated `derived.scenes` from generation_progress;
        // we overlay (don't replace) so URLs / narration excerpts stay.
        const liveByIdx = new Map<number, VideoLiveProgress['shots'][number]>();
        for (const s of live.shots ?? []) liveByIdx.set(s.idx, s);
        derived.scenes = derived.scenes.map((scene) => {
            const lv = liveByIdx.get(scene.index);
            if (!lv) return scene;
            const ec = externalCallsByShot.get(scene.index) ?? [];
            const merged: SceneSlot = {
                ...scene,
                // Fill in decisions from live when the base derivation
                // didn't have them (common for in-flight runs).
                intentRole: scene.intentRole ?? lv.intent_role ?? undefined,
                audioPolicy: (scene.audioPolicy ?? lv.audio_policy ?? undefined) as SceneSlot['audioPolicy'],
                backgroundTreatment: scene.backgroundTreatment ?? lv.background_treatment ?? undefined,
                transitionIn: scene.transitionIn ?? lv.transition_in ?? undefined,
                narrationBrief: scene.narrationBrief ?? lv.narration_brief ?? undefined,
                // Live state overrides — `wrapped`/`reshoot`/`cut` from
                // the aggregator wins because it's emitted at terminal
                // transitions before generation_progress lands.
                state: liveStateToNodeState(lv.state, scene.state),
                liveDetail: {
                    substage: lv.substage ?? null,
                    attempts: lv.attempts ?? undefined,
                    regenLog: lv.regen_log,
                    regenCount: sumRegenAttempts(lv.attempts),
                    externalCalls: ec.map((c) => ({
                        id: c.id,
                        provider: c.provider,
                        op: c.op,
                        state: c.state,
                        pollCount: c.poll_count,
                        startedAt: c.started_at,
                        finishedAt: c.finished_at ?? null,
                        elapsedS: c.elapsed_s ?? null,
                        error: c.error ?? null,
                    })),
                    elapsedS: lv.elapsed_s ?? null,
                    lastError: lv.last_error ?? null,
                    costUsd: lv.cost_usd,
                },
            };
            return merged;
        });
    }

    return derived;
}

function liveStateToNodeState(
    live: VideoLiveProgress['shots'][number]['state'],
    fallback: NodeState,
): NodeState {
    switch (live) {
        case 'wrapped':
            return 'wrapped';
        case 'in_progress':
            return 'in_production';
        case 'cut':
            return 'cut';
        case 'reshoot':
            return 'reshoot';
        case 'pending':
            return fallback === 'wrapped' ? 'wrapped' : 'scheduled';
        default:
            return fallback;
    }
}

function sumRegenAttempts(attempts?: Record<string, number>): number {
    if (!attempts) return 0;
    let total = 0;
    for (const v of Object.values(attempts)) total += v || 0;
    return total;
}

// ── Helpers for derivePipelineFromStatus ────────────────────────────────
//
// Three internal helpers absorb the enrichment logic previously held in
// PipelineFlow's `enrichedState` memo. Hoisting them here gives a single
// shape contract for any consumer of `/status` and avoids the dual
// "live state + memo enrichment" path.

function derivedResearchFromStatus(args: {
    prompt: string;
    intent: VideoStatusMetadata['intent_outcomes'];
    routingOverrides?: Record<string, unknown> | null;
    pipelineStage: PipelineStage;
    runWrapped: boolean;
    halted: boolean;
    t?: TFunction;
}): NodeSlot<ResearchArtifact> | undefined {
    const { intent, runWrapped, halted, pipelineStage, prompt } = args;
    const hasUrl = promptContainsUrl(prompt);
    const overrides = (
        args.routingOverrides as
            | { tools?: { scrape_url?: boolean; web_search?: boolean } }
            | undefined
    )?.tools;
    const explicitScrape = overrides?.scrape_url === true;
    const explicitSearch = overrides?.web_search === true;
    const explicitSkip = overrides?.scrape_url === false && overrides?.web_search === false;

    const toolsEnabled = intent?.tools_enabled ?? [];
    const scrapeArt = intent?.scrape_url_artifacts;
    const searchArt = intent?.web_search_artifacts;
    const intentHappened =
        toolsEnabled.includes('scrape_url') ||
        toolsEnabled.includes('web_search') ||
        !!scrapeArt ||
        !!searchArt;

    if (explicitSkip) return undefined;
    if (!intentHappened && !hasUrl && !explicitScrape && !explicitSearch) return undefined;

    const enrichedData: ResearchArtifact = {
        scrapedAny: !!scrapeArt && !scrapeArt.error,
        searchedAny: !!searchArt && !searchArt.error,
        urlsAttempted:
            scrapeArt?.urls_attempted ?? (hasUrl ? extractPromptUrls(prompt) : undefined),
        screenshots: (scrapeArt?.files_captured ?? [])
            .filter((f) => !!f.url)
            .map((f) => ({ url: f.url as string, name: f.name })),
        scrapedExcerpt: scrapeArt?.text_excerpt,
        searchAnswer: searchArt?.answer,
        sources: (searchArt?.sources ?? [])
            .filter((s) => !!s.url)
            .map((s) => ({ url: s.url as string, host: s.host, title: s.title })),
        searchQuery: searchArt?.query,
    };

    if (halted)
        return {
            state: 'cut',
            error: cutError(args.t, 'errors.researchCut', 'Research cut from production'),
        };

    // Research runs entirely pre-SCRIPT. Once the pipeline has moved past
    // SCRIPT (or the run is wrapped), it's done. While in PENDING/SCRIPT,
    // it's actively running and its artifacts may be partial.
    const isPreOrInScript =
        pipelineStage === 'PENDING' ||
        STAGE_ORDER.indexOf(pipelineStage) <= STAGE_ORDER.indexOf('SCRIPT');

    if (runWrapped || !isPreOrInScript) {
        return { state: 'wrapped', data: enrichedData };
    }
    return { state: 'in_production', partialData: enrichedData };
}

function derivedTalentFromStatus(args: {
    userSelHostType?: 'avatar' | 'raw';
    userSelGenerateAvatar?: boolean;
    metaHost?: VideoStatusMetadata['host'];
    runWrapped: boolean;
    halted: boolean;
    t?: TFunction;
}): NodeSlot<TalentArtifact> | undefined {
    const { userSelHostType, userSelGenerateAvatar, metaHost, runWrapped, halted } = args;
    const requested = userSelHostType === 'avatar' || userSelGenerateAvatar === true;
    const hostEnabled = metaHost ? metaHost.enabled !== false : false;
    const isAvatarBlock =
        metaHost?.type === 'avatar' || (metaHost && !metaHost.type && !!metaHost.avatar);

    if (!requested && !(hostEnabled && isAvatarBlock)) return undefined;

    const outputs = metaHost?.outputs;
    const takes = (outputs?.shot_artifacts ?? []).map((a) => ({
        shotIndex: a.shot_index,
        hostImageUrl: a.host_image_url,
        avatarVideoUrl: a.avatar_video_url,
        durationS: a.duration_s_actual ?? a.duration_s,
        status: a.status,
        error: a.error,
    }));
    const completedTakes = takes.filter(
        (t) => t.status === 'completed' || !!t.avatarVideoUrl || !!t.hostImageUrl
    );
    const total = outputs?.host_shot_count ?? takes.length ?? 0;

    if (halted)
        return {
            state: 'cut',
            error: cutError(args.t, 'errors.talentCut', 'Talent cut from production'),
        };
    if (runWrapped || completedTakes.length > 0) {
        return {
            state: 'wrapped',
            data: {
                completed: completedTakes.length || total,
                total: total || completedTakes.length,
                takes,
            },
        };
    }
    // Phase 3 will populate partialData.takes here once BE flushes per-shot.
    // Until then, "requested but not yet wrapped" shows as scheduled.
    return { state: 'scheduled' };
}

function derivedScoreFromStatus(args: {
    userSelEnabled?: boolean | null;
    metaEnabled?: boolean | null;
    audioTracks?: VideoStatusMetadata['audio_tracks'];
    runWrapped: boolean;
    halted: boolean;
    t?: TFunction;
}): NodeSlot<ScoreArtifact> | undefined {
    const enabled = args.userSelEnabled === true || args.metaEnabled === true;
    const bgTrack = (args.audioTracks ?? []).find((track) => track?.id === 'background-music');
    const url = bgTrack?.url;

    if (!enabled && !url) return undefined;
    if (args.halted)
        return {
            state: 'cut',
            error: cutError(args.t, 'errors.scoreCut', 'Score cut from production'),
        };
    if (args.runWrapped || url) {
        return { state: 'wrapped', data: { audioUrl: url, label: bgTrack?.label } };
    }
    // Phase 3 BE work will surface segment counters; until then "enabled but
    // not yet wrapped" shows as scheduled.
    return { state: 'scheduled' };
}
