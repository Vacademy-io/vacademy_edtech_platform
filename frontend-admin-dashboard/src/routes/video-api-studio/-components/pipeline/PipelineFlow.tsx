import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    NodeTypes,
    type Node,
    Panel,
    ReactFlowProvider,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type {
    NarrationWriterArtifact,
    NodeSlot,
    NodeState,
    PipelineState,
    PitchArtifact,
    ResearchArtifact,
    SceneSlot,
    ScoreArtifact,
    ShotPlannerArtifact,
    TalentArtifact,
} from './-utils/derive-pipeline-state';
import { buildPipelineGraph, type PipelineNodeData } from './-utils/build-pipeline-graph';
import { applyDagreLayout } from './-utils/apply-dagre-layout';
import {
    useBackgroundMusicTrack,
    useSceneThumbnails,
    useTimelinePalette,
    useTimelineRecurringMotifs,
    useTimelineShotMeta,
} from './-utils/use-timeline-json';
import { useVideoStatus } from './-utils/use-video-status';
import { ScenesHtmlContext } from './-utils/scenes-html-context';
import { processHtmlContent } from '@/components/ai-video-player/html-processor';
import { NodeDetailSheet, type DetailTarget } from './NodeDetailSheet';
import { PitchNode } from './nodes/PitchNode';
import { ResearchNode } from './nodes/ResearchNode';
import { BeatsNode } from './nodes/BeatsNode';
import { ScreenplayNode } from './nodes/ScreenplayNode';
import { NarrationNode } from './nodes/NarrationNode';
import { StoryboardNode } from './nodes/StoryboardNode';
import { FilmingNode } from './nodes/FilmingNode';
import { SceneNode } from './nodes/SceneNode';
import { ShotPlannerNode } from './nodes/ShotPlannerNode';
import { NarrationWriterNode } from './nodes/NarrationWriterNode';
import { TalentNode } from './nodes/TalentNode';
import { ScoreNode } from './nodes/ScoreNode';
import { FinalCutNode } from './nodes/FinalCutNode';
import { BrollLaneNode } from './nodes/BrollLaneNode';

/**
 * Map of `nodeType` → component. Defined module-scope (not inside the
 * component) so React Flow doesn't warn about re-creating the registry on
 * every render — see https://reactflow.dev/error#002. design-lint-ignore: URL fragment, not a color literal.
 */
const NODE_TYPES: NodeTypes = {
    pitch: PitchNode,
    research: ResearchNode,
    beats: BeatsNode,
    screenplay: ScreenplayNode,
    narration: NarrationNode,
    storyboard: StoryboardNode,
    shotPlanner: ShotPlannerNode,
    narrationWriter: NarrationWriterNode,
    filming: FilmingNode,
    scene: SceneNode,
    talent: TalentNode,
    score: ScoreNode,
    finalCut: FinalCutNode,
    brollLane: BrollLaneNode,
};

interface PipelineFlowProps {
    state: PipelineState;
    /**
     * Used to fetch `/status.generation_progress` for history-loaded videos
     * (where `currentGeneration.shotPlan` is `undefined`). Lets us hydrate
     * per-scene nodes for already-wrapped runs without touching the parent
     * derivation path.
     */
    apiKey?: string;
}

function PipelineFlowInner({ state, apiKey }: PipelineFlowProps) {
    const { t } = useTranslation('videoApiStudioPipelineFlow');
    const flow = useReactFlow();
    const fittedOnceRef = useRef(false);

    const [openTarget, setOpenTarget] = useState<DetailTarget | null>(null);

    const handleSheetOpenChange = useCallback((open: boolean) => {
        if (!open) setOpenTarget(null);
    }, []);

    /**
     * Fetch + parse the finished `time_based_frame.json` once the run is
     * wrapped, then enrich `state.scenes[]` with image / video URLs so
     * SceneNode thumbnails materialize without a backend change. Lazy: the
     * hook is `enabled: !!timelineUrl` so live runs don't fetch until the
     * timeline is finalized.
     */
    const { byIndex: thumbnails } = useSceneThumbnails(state.videoId, state.artifactUrls.timeline);

    /**
     * For history-loaded videos `currentGeneration` doesn't carry the
     * Director's shot plan, so `state.scenes` is empty and the diagram
     * falls back to the legacy single Filming counter. Fetching `/status`
     * gives us the canonical `generation_progress.shot_plan` (and
     * `cumulative_tokens`) so per-scene nodes can be hydrated for
     * already-finished runs too.
     */
    const { data: statusResp } = useVideoStatus(state.videoId, apiKey);
    const gp = statusResp?.generation_progress;
    const meta = statusResp?.metadata;

    // Background-music track from the timeline.json — wraps the Score node
    // for already-finished videos that used auto-generated music.
    const { track: musicTrack } = useBackgroundMusicTrack(
        state.videoId,
        state.artifactUrls.timeline
    );

    // Style-guide palette — fed into processHtmlContent below so embedded
    // iframes seed the same CSS variables the rendered MP4 used.
    const palette = useTimelinePalette(state.videoId, state.artifactUrls.timeline);

    // v3 per-shot meta + plan-level recurring motifs from timeline.json's
    // `meta.shots[]` / `meta.recurring_motifs[]`. Drives the enriched
    // SceneSlot fields (audio_policy, narration_brief, AI-video telemetry)
    // and the ShotPlanner detail sheet for history-loaded runs.
    const timelineShotMeta = useTimelineShotMeta(state.videoId, state.artifactUrls.timeline);
    const timelineMotifs = useTimelineRecurringMotifs(state.videoId, state.artifactUrls.timeline);

    const enrichedState = useMemo<PipelineState>(() => {
        let working = state;

        // 1. Synthesize scenes from /status.shot_plan when the parent
        //    derivation didn't have it (history-loaded videos).
        if (working.scenes.length === 0 && gp?.shot_plan?.length) {
            const isWrapped = working.status === 'wrapped';
            const shotsCompleted = isWrapped ? gp.shot_plan.length : gp.shots_completed ?? 0;
            const errors = gp.errors ?? [];

            const synthesized: SceneSlot[] = gp.shot_plan.map((s, arrayIdx) => {
                // Defensive: if the BE payload is missing `shot_index`,
                // fall back to array position so the React Flow node ids
                // (which key off the array slot) stay unique. Without this
                // fallback every scene gets id `scene-undefined` and they
                // collapse to a single rendered position.
                const idx = typeof s.shot_index === 'number' ? s.shot_index : arrayIdx;
                const errEntry = errors.find((e) => e.shot_index === idx);
                let sceneState: NodeState = 'scheduled';
                if (isWrapped) sceneState = 'wrapped';
                else if (errEntry && !errEntry.retrying) sceneState = 'cut';
                else if (errEntry && errEntry.retrying) sceneState = 'reshoot';
                else if (idx < shotsCompleted) sceneState = 'wrapped';
                else if (idx === shotsCompleted) sceneState = 'in_production';
                // Carry v3 fields when the BE included them on /status.shot_plan
                // (the schema docstring is incomplete but the wire data is
                // permissive Dict[str, Any], so v3 runs populate them). The
                // separate `meta.shots[]` enrichment below still wins for
                // history-loaded runs whose status didn't carry them.
                return {
                    state: sceneState,
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
                    error: sceneState === 'cut' ? errEntry?.error : undefined,
                };
            });
            working = { ...working, scenes: synthesized };
        }

        // 2. Apply timeline thumbnails into whichever scenes set we have.
        if (working.scenes.length > 0 && Object.keys(thumbnails).length > 0) {
            const merged: SceneSlot[] = working.scenes.map((s) => {
                const thumb = thumbnails[s.index];
                if (!thumb || (!thumb.imageUrl && !thumb.videoUrl)) return s;
                return {
                    ...s,
                    imageUrl: thumb.imageUrl ?? s.imageUrl,
                    videoUrl: thumb.videoUrl ?? s.videoUrl,
                };
            });
            working = { ...working, scenes: merged };
        }

        // 2b. Merge v3 per-shot meta from timeline.json into the scene slots.
        //     This is the canonical source for history-loaded v3 runs where
        //     `cg.shotPlan` never carried the v3 fields. Covers audio_policy,
        //     narration_brief/text, background_treatment, transition_in,
        //     intent_role, per-shot audio URLs, AI-video telemetry, etc.
        if (working.scenes.length > 0 && Object.keys(timelineShotMeta).length > 0) {
            const merged: SceneSlot[] = working.scenes.map((s) => {
                const m = timelineShotMeta[s.index];
                if (!m) return s;
                return {
                    ...s,
                    narrationBrief: s.narrationBrief ?? m.narration_brief,
                    narrationText: s.narrationText ?? m.narration_text,
                    audioPolicy: s.audioPolicy ?? m.audio_policy,
                    backgroundTreatment: s.backgroundTreatment ?? m.background_treatment,
                    transitionIn: s.transitionIn ?? m.transition_in,
                    intentRole: s.intentRole ?? m.intent_role,
                    audioUrl: s.audioUrl ?? m.audio_url,
                    audioWordsUrl: s.audioWordsUrl ?? m.audio_words_url,
                    audioScriptUrl: s.audioScriptUrl ?? m.audio_script_url,
                    audioDurationS: s.audioDurationS ?? m.audio_duration_s,
                    audioSkipped: s.audioSkipped ?? m.audio_skipped,
                    aiVideoOn: m._ai_video_audio_on,
                    aiVideoRequestId: m._ai_video_request_id,
                    aiVideoUrl: m._ai_video_url,
                    aiVideoCostCredits: m._ai_video_cost_credits,
                    aiVideoCostUsd: m._ai_video_cost_usd,
                    aiVideoElapsedS: m._ai_video_elapsed_s,
                    aiVideoSegments: m._ai_video_segments?.map((seg) => ({
                        segIdx: seg.seg_idx ?? 0,
                        videoUrl: seg.video_url,
                        durationS: seg.duration_s,
                        requestId: seg.request_id,
                        cacheHit: seg.cache_hit,
                    })),
                };
            });
            working = { ...working, scenes: merged };
        }

        // 2c. Backfill pipelineVersion from /status.metadata when the parent
        //     derivation didn't set it (history-loaded path before the
        //     metadata-aware derivation reaches here). Also promote to v3 if
        //     any scene carries a v3 signal (audio_policy / narration_brief)
        //     or the timeline persisted shot meta — these are positive proof
        //     this run came out of the v3 pipeline.
        const sceneHasV3Field = working.scenes.some(
            (s) => s.audioPolicy != null || s.narrationBrief != null
        );
        const statusVersion = meta?.pipeline_version ?? meta?.user_selections?.pipeline_version;
        const detectedVersion: 'v2' | 'v3' =
            statusVersion === 'v3' || statusVersion === 'v2'
                ? statusVersion
                : sceneHasV3Field || Object.keys(timelineShotMeta).length > 0
                  ? 'v3'
                  : working.pipelineVersion;
        if (detectedVersion !== working.pipelineVersion) {
            working = { ...working, pipelineVersion: detectedVersion };
        }

        // 2d. Synthesize ShotPlanner + NarrationWriter slots from timeline
        //     meta for history-loaded v3 runs (the live derivation already
        //     populates these when SSE drove the run). Use the per-shot meta
        //     when present; otherwise fall back to the (post-enrichment)
        //     scene array which has the same v3 fields after step 2b.
        if (working.pipelineVersion === 'v3' && working.scenes.length > 0) {
            if (!working.shotPlanner) {
                let intrinsic = 0;
                let narrated = 0;
                const intentRoleBreakdown: Record<string, number> = {};
                const backgroundBreakdown: Record<string, number> = {};
                for (const s of working.scenes) {
                    if (s.audioPolicy === 'intrinsic_only') intrinsic++;
                    else narrated++;
                    if (s.intentRole) {
                        intentRoleBreakdown[s.intentRole] =
                            (intentRoleBreakdown[s.intentRole] ?? 0) + 1;
                    }
                    if (s.backgroundTreatment) {
                        backgroundBreakdown[s.backgroundTreatment] =
                            (backgroundBreakdown[s.backgroundTreatment] ?? 0) + 1;
                    }
                }
                const data: ShotPlannerArtifact = {
                    shotCount: working.scenes.length,
                    intrinsicCount: intrinsic,
                    narratedCount: narrated,
                    recurringMotifs: timelineMotifs.map((m) => ({
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
                const wrapped: NodeSlot<ShotPlannerArtifact> =
                    working.status === 'wrapped' || working.status === 'in_production'
                        ? { state: 'wrapped', data }
                        : { state: 'wrapped', data };
                working = { ...working, shotPlanner: wrapped };
            }
            if (!working.narrationWriter) {
                const perShotWordCounts: number[] = [];
                let skipped = 0;
                let total = 0;
                for (const s of working.scenes) {
                    if (s.audioSkipped || s.audioPolicy === 'intrinsic_only') {
                        perShotWordCounts.push(0);
                        skipped++;
                        continue;
                    }
                    const text = (s.narrationText ?? s.narrationExcerpt ?? '').trim();
                    const n = text ? text.split(/\s+/).length : 0;
                    perShotWordCounts.push(n);
                    total += n;
                }
                const data: NarrationWriterArtifact = {
                    totalWords: total,
                    perShotWordCounts,
                    skippedIntrinsicCount: skipped,
                    narrationMp3Url: working.artifactUrls.audio,
                    narrationWordsUrl: working.artifactUrls.words,
                };
                working = {
                    ...working,
                    narrationWriter: { state: 'wrapped', data },
                };
            }
        }

        // 3. Synthesize Talent slot from extra_metadata.host. Live runs
        //    populate `state.talent` directly from SSE counters in
        //    `derivePipelineFromLive`; this branch covers history-loaded
        //    videos where the FE never saw the avatar_* events.
        const isWrapped = working.status === 'wrapped';
        const isHalted = working.status === 'halted';
        if (!working.talent && meta?.host) {
            const host = meta.host;
            const hostEnabled = host.enabled !== false; // default true when block exists
            const isAvatar = host.type === 'avatar' || (!host.type && !!host.avatar);
            if (hostEnabled && isAvatar) {
                const outputs = host.outputs;
                const total = outputs?.host_shot_count ?? outputs?.shot_artifacts?.length ?? 0;
                const takes = (outputs?.shot_artifacts ?? []).map((a) => ({
                    shotIndex: a.shot_index,
                    hostImageUrl: a.host_image_url,
                    avatarVideoUrl: a.avatar_video_url,
                    durationS: a.duration_s_actual ?? a.duration_s,
                    status: a.status,
                    error: a.error,
                }));
                const completedTakes = takes.filter(
                    (take) =>
                        take.status === 'completed' || !!take.avatarVideoUrl || !!take.hostImageUrl
                );
                let talent: NodeSlot<TalentArtifact>;
                if (isWrapped || total > 0) {
                    talent = {
                        state: 'wrapped',
                        data: {
                            completed: completedTakes.length || total,
                            total: total || completedTakes.length,
                            takes,
                        },
                    };
                } else if (isHalted) {
                    talent = { state: 'cut', error: t('errors.talentCutFromProduction') };
                } else {
                    talent = { state: 'scheduled' };
                }
                working = { ...working, talent };
            }
        }

        // 4. Synthesize Score slot from metadata.user_selections + music
        //    track. On wrapped runs the merged Lyria track lives in
        //    timeline.json's `meta.audio_tracks[]` — that's the audio URL
        //    we play in the detail sheet.
        const userSel = meta?.user_selections;
        const scoreEnabled =
            userSel?.background_music_enabled === true ||
            meta?.background_music_enabled === true ||
            !!musicTrack?.url;
        if (!working.score && scoreEnabled) {
            let score: NodeSlot<ScoreArtifact>;
            if (musicTrack?.url || isWrapped) {
                score = {
                    state: 'wrapped',
                    data: {
                        audioUrl: musicTrack?.url,
                        label: musicTrack?.label,
                    },
                };
            } else if (isHalted) {
                score = { state: 'cut', error: t('errors.scoreCutFromProduction') };
            } else {
                score = { state: 'scheduled' };
            }
            working = { ...working, score };
        } else if (working.score && working.score.state === 'wrapped' && musicTrack?.url) {
            // Live derivation already wrapped the score (from
            // background_music_done) but didn't have the canonical
            // timeline.json URL. Backfill it now.
            const data = working.score.data;
            if (!data.audioUrl) {
                working = {
                    ...working,
                    score: {
                        state: 'wrapped',
                        data: {
                            ...data,
                            audioUrl: musicTrack.url,
                            label: data.label ?? musicTrack.label,
                        },
                    },
                };
            }
        }

        // 5. Research enrichment from `intent_outcomes` (Phase 4). The pre-
        //    script intent router doesn't emit SSE events, so live runs
        //    only know "URL in prompt → research probably running". For
        //    history-loaded videos, the persisted artifacts contain the
        //    actual sources / screenshots / search payload.
        const intent = meta?.intent_outcomes;
        const toolsEnabled = intent?.tools_enabled ?? [];
        const scrapeArt = intent?.scrape_url_artifacts;
        const searchArt = intent?.web_search_artifacts;
        const researchHappened =
            toolsEnabled.includes('scrape_url') ||
            toolsEnabled.includes('web_search') ||
            !!scrapeArt ||
            !!searchArt;
        if (researchHappened) {
            const liveResearchUrls =
                working.research?.state === 'wrapped'
                    ? working.research.data.urlsAttempted
                    : undefined;
            const enrichedData: ResearchArtifact = {
                scrapedAny: !!scrapeArt && !scrapeArt.error,
                searchedAny: !!searchArt && !searchArt.error,
                urlsAttempted: scrapeArt?.urls_attempted ?? liveResearchUrls,
                screenshots: (scrapeArt?.files_captured ?? [])
                    .filter((f) => !!f.url)
                    .map((f) => ({ url: f.url as string, name: f.name })),
                scrapedExcerpt: scrapeArt?.text_excerpt,
                searchAnswer: searchArt?.answer,
                sources: (searchArt?.sources ?? [])
                    .filter((s) => !!s.url)
                    .map((s) => ({
                        url: s.url as string,
                        host: s.host,
                        title: s.title,
                    })),
                searchQuery: searchArt?.query,
            };
            const research: NodeSlot<ResearchArtifact> =
                working.research?.state === 'in_production'
                    ? { state: 'in_production', partialData: enrichedData }
                    : working.research?.state === 'cut' || working.research?.state === 'reshoot'
                      ? working.research
                      : { state: 'wrapped', data: enrichedData };
            working = { ...working, research };
        }

        // 6. Pitch + prompt enrichment — history-restored runs lose the
        //    full user_selections snapshot and sometimes lose the prompt
        //    itself (the History sidebar hydrates a thin subset). /status
        //    carries both via `metadata.user_selections` and top-level
        //    `prompt`. Fill in whichever the parent didn't have so the
        //    Pitch sheet's Brief + Configuration sections populate.
        const statusPrompt = (statusResp as { prompt?: string | null } | undefined)?.prompt;
        const userSelections = meta?.user_selections;
        const haveLocalPrompt = !!working.prompt && working.prompt.length > 0;
        const backfillPrompt = haveLocalPrompt
            ? working.prompt
            : userSelections?.prompt || statusPrompt || '';
        const pitchSlot = working.pitch;
        const needsPitchEnrichment =
            !!userSelections && pitchSlot.state === 'wrapped' && !pitchSlot.data.userSelections;
        const needsPromptBackfill = !haveLocalPrompt && backfillPrompt.length > 0;
        if (needsPromptBackfill || needsPitchEnrichment) {
            const newPitch: NodeSlot<PitchArtifact> =
                pitchSlot.state === 'wrapped'
                    ? {
                          state: 'wrapped',
                          data: {
                              prompt: backfillPrompt || pitchSlot.data.prompt,
                              referenceCount:
                                  userSelections?.reference_files_count ??
                                  pitchSlot.data.referenceCount,
                              userSelections: userSelections ?? pitchSlot.data.userSelections,
                          },
                      }
                    : pitchSlot;
            working = {
                ...working,
                prompt: backfillPrompt || working.prompt,
                contentType: working.contentType || userSelections?.content_type || 'VIDEO',
                orientation: working.orientation || userSelections?.orientation || 'landscape',
                pitch: newPitch,
            };
        }

        // 7. Stats enrichment — history-restored runs only get whatever
        //    `currentGeneration.tokenUsage` was hydrated from HistoryItem,
        //    and never get `cumulativeTokens`. /status carries both. Fill
        //    in whichever the parent didn't have so the right-rail Production
        //    Budget block + RunSummaryFooter populate consistently.
        const statusTokenUsage = (
            statusResp as { token_usage?: typeof working.stats.tokenUsage } | undefined
        )?.token_usage;
        const statusCumulative = gp?.cumulative_tokens;
        if (
            (!working.stats.cumulativeTokens && statusCumulative) ||
            (!working.stats.tokenUsage && statusTokenUsage)
        ) {
            working = {
                ...working,
                stats: {
                    ...working.stats,
                    cumulativeTokens: working.stats.cumulativeTokens ?? statusCumulative,
                    tokenUsage: working.stats.tokenUsage ?? statusTokenUsage,
                },
            };
        }

        return working;
    }, [state, gp, thumbnails, meta, musicTrack, statusResp, timelineShotMeta, timelineMotifs, t]);

    /**
     * React Flow's `onNodeClick` is the canonical hook for "user clicked
     * node X" — DOM-level onClick on the custom node shell is unreliable
     * inside React Flow's event-handling wrapper.
     *
     * Final Cut is the embedded player + fullscreen-button combo; its own
     * controls handle clicks, so we explicitly skip the sheet for it.
     */
    const handleNodeClick = useCallback(
        (_event: React.MouseEvent, node: Node<PipelineNodeData>) => {
            const kind = node.data?.kind;
            // brollLane is a visual-only wrapper — `selectable:false` on
            // the node already suppresses RF clicks, but guard explicitly
            // in case RF semantics shift in a future upgrade.
            if (!kind || kind === 'finalCut' || kind === 'brollLane') return;
            if (kind === 'scene') {
                // Always return inside this branch so the narrowed `kind`
                // below is guaranteed not to be 'scene'.
                if (typeof node.data.sceneIndex === 'number') {
                    setOpenTarget({ kind: 'scene', sceneIndex: node.data.sceneIndex });
                }
                return;
            }
            setOpenTarget({ kind });
        },
        []
    );

    const { nodes, edges } = useMemo(() => {
        const built = buildPipelineGraph(enrichedState);
        const positioned = applyDagreLayout(built.nodes, built.edges, {
            rankdir: 'LR',
            rankSep: 60,
            nodeSep: 24,
            nodeSizeOverrides: built.nodeSizeOverrides,
        });

        // Post-process: when scene nodes exist, override their positions to
        // a deterministic horizontal row anchored to Storyboard's position.
        // Reasoning: dagre's LR layout for a long sequential chain
        // (Pitch→…→Storyboard→S0→S1→…→Sn→FinalCut) computed positions that
        // we couldn't visually verify were correct — most scenes ended up
        // either off-screen, at (0,0), or stacked. Manual positioning
        // guarantees every scene gets a unique spot and the
        // Storyboard→FinalCut visual span scales with N.
        const sceneNodes = positioned.filter((n) => n.data?.kind === 'scene');
        if (sceneNodes.length > 0) {
            // v2 anchors off Storyboard; v3 anchors off NarrationWriter (the
            // node that directly precedes the scene strip on v3). Whichever
            // exists in `positioned` is the "upstream of scenes" reference.
            const upstreamNode =
                positioned.find((n) => n.id === 'storyboard') ??
                positioned.find((n) => n.id === 'narrationWriter');
            const finalCut = positioned.find((n) => n.id === 'finalCut');
            if (upstreamNode && finalCut) {
                const sceneW = built.nodeSizeOverrides['scene-0']?.width ?? 200;
                const sceneH = built.nodeSizeOverrides['scene-0']?.height ?? 220;
                const sbW = built.nodeSizeOverrides[upstreamNode.id]?.width ?? 280;
                const sbH = built.nodeSizeOverrides[upstreamNode.id]?.height ?? 180;
                // Alias for the rest of the block — the layout math doesn't
                // care whether it's storyboard or narrationWriter.
                const storyboard = upstreamNode;
                const sceneSpacing = 50;
                // Start scenes just to the right of Storyboard, at the
                // same vertical center as the linear chain so the flow
                // stays visually horizontal.
                let x = storyboard.position.x + sbW + 80;
                const sceneY = storyboard.position.y + (sbH - sceneH) / 2;
                const sceneRowEndX = (() => {
                    let cursor = x;
                    sceneNodes.forEach(() => {
                        cursor += sceneW + sceneSpacing;
                    });
                    return cursor;
                })();
                sceneNodes
                    .sort((a, b) => {
                        const ai = (a.data as { sceneIndex?: number }).sceneIndex ?? 0;
                        const bi = (b.data as { sceneIndex?: number }).sceneIndex ?? 0;
                        return ai - bi;
                    })
                    .forEach((node) => {
                        node.position = { x, y: sceneY };
                        x += sceneW + sceneSpacing;
                    });
                // Place Final Cut right after the last scene, aligned
                // vertically with the linear chain.
                const fcW = built.nodeSizeOverrides.finalCut?.width ?? 480;
                const fcH = built.nodeSizeOverrides.finalCut?.height ?? 280;
                finalCut.position = {
                    x: x + 20,
                    y: storyboard.position.y + (sbH - fcH) / 2,
                };
                // Ensure the linear-chain nodes also share that y so the
                // whole top row aligns. v2: research, beats, screenplay,
                // narration. v3: research, shotPlanner, narrationWriter.
                // All optional — only realigned if present in `positioned`.
                [
                    'pitch',
                    'research',
                    'beats',
                    'screenplay',
                    'narration',
                    'shotPlanner',
                    'narrationWriter',
                ].forEach((id) => {
                    const n = positioned.find((p) => p.id === id);
                    const w = built.nodeSizeOverrides[id]?.width ?? 260;
                    const h = built.nodeSizeOverrides[id]?.height ?? 140;
                    if (n)
                        n.position = {
                            x: n.position.x,
                            y: storyboard.position.y + (sbH - h) / 2,
                        };
                    // Width referenced just to avoid unused-var lint.
                    void w;
                });
                void fcW;

                // ── Talent + Score (Phase 3): secondary row below the
                // scene strip. Both run in parallel as edges
                // Storyboard→Talent / Score→FinalCut. Centering them under
                // the scene strip keeps the two converging arrows readable.
                const talentNode = positioned.find((n) => n.id === 'talent');
                const scoreNode = positioned.find((n) => n.id === 'score');
                const branchY = sceneY + sceneH + 60;
                const branchNodeW = 260;
                const branchSpacing = 60;
                const branches = [talentNode, scoreNode].filter(Boolean);
                if (branches.length > 0) {
                    const sceneStripStart = storyboard.position.x + sbW + 80;
                    const sceneStripWidth = sceneRowEndX - sceneStripStart;
                    const totalBranchWidth =
                        branches.length * branchNodeW + (branches.length - 1) * branchSpacing;
                    let bx = sceneStripStart + (sceneStripWidth - totalBranchWidth) / 2;
                    // If the scene strip is narrower than the branch row,
                    // anchor branches at the strip start instead so they
                    // never start to the left of Storyboard.
                    if (bx < sceneStripStart) bx = sceneStripStart;
                    branches.forEach((n) => {
                        if (!n) return;
                        const w = built.nodeSizeOverrides[n.id]?.width ?? branchNodeW;
                        n.position = { x: bx, y: branchY };
                        bx += w + branchSpacing;
                    });

                    // Wrap the branch row in a dashed "B-roll lanes"
                    // container so the fan-out from Storyboard / fan-in
                    // to FinalCut reads as a deliberate group rather than
                    // two free-floating nodes. Sized off the actual
                    // positioned branch geometry (not the unstyled defaults)
                    // and rendered with a low zIndex so branch clicks still
                    // hit the underlying TalentNode / ScoreNode.
                    const present = branches.filter((n): n is NonNullable<typeof n> => !!n);
                    const xs = present.map((n) => n.position.x);
                    const rights = present.map(
                        (n) => n.position.x + (built.nodeSizeOverrides[n.id]?.width ?? branchNodeW)
                    );
                    const ys = present.map((n) => n.position.y);
                    const bottoms = present.map(
                        (n) => n.position.y + (built.nodeSizeOverrides[n.id]?.height ?? 140)
                    );
                    const PAD = 24;
                    const laneX = Math.min(...xs) - PAD;
                    const laneY = Math.min(...ys) - PAD;
                    const laneW = Math.max(...rights) - Math.min(...xs) + PAD * 2;
                    const laneH = Math.max(...bottoms) - Math.min(...ys) + PAD * 2;
                    // Insert FIRST so the rendered DOM order keeps the
                    // lane behind the branch cards as a fallback for
                    // browsers that ignore the zIndex on transformed
                    // children. zIndex on the React Flow node style is
                    // additionally honored by RF's stacking context.
                    positioned.unshift({
                        id: 'broll-lane',
                        type: 'brollLane',
                        position: { x: laneX, y: laneY },
                        data: {
                            kind: 'brollLane',
                            // The lane is purely visual; it doesn't read
                            // PipelineState. PipelineNodeData requires a
                            // `state` field, so fall through with the
                            // current state to satisfy the type without
                            // an extra cast at the consumer.
                            state: enrichedState,
                            width: laneW,
                            height: laneH,
                        } as unknown as PipelineNodeData & { width: number; height: number },
                        selectable: false,
                        draggable: false,
                        focusable: false,
                        style: { zIndex: -1 },
                    });
                }
            }
        }

        return { nodes: positioned, edges: built.edges };
    }, [enrichedState]);

    // Re-fit when the structural set of node states changes. Stable in
    // steady-state since the dependency only flips on real state changes.
    const stateSignature = useMemo(
        () =>
            nodes
                .map((n) => `${n.id}:${(n.data as { state: { status?: string } }).state.status}`)
                .join('|') + `:${nodes.length}`,
        [nodes]
    );
    useEffect(() => {
        if (nodes.length === 0) return;
        const id = requestAnimationFrame(() => {
            flow.fitView({ padding: 0.08, duration: fittedOnceRef.current ? 350 : 200 });
            fittedOnceRef.current = true;
        });
        return () => cancelAnimationFrame(id);
    }, [flow, nodes.length, stateSignature]);

    // ── Auto-focus on the active stage / scene during live runs ──────────
    // When the BE pushes a new `live.active_stage` (or a single scene flips
    // to `in_production` during Filming), softly pan the camera to that
    // node. The user can opt out by interacting with the canvas — once they
    // pan or zoom manually, `followLive` flips off until they hit the
    // "Follow live" button (rendered alongside the canvas controls).
    const followLiveRef = useRef(true);
    const lastFocusKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!followLiveRef.current) return;
        if (state.status !== 'in_production') return;
        const activeStage = state.liveActiveStage;
        if (!activeStage) return;

        // Prefer focusing on the single in-progress scene when Filming is
        // active and exactly one scene is currently running — that's the
        // most informative view.
        let focusNodeId: string | null = null;
        if (activeStage === 'filming' && state.scenes.length > 0) {
            const running = state.scenes.filter((s) => s.state === 'in_production');
            const only = running.length === 1 ? running[0] : undefined;
            if (only) {
                focusNodeId = `scene-${only.index}`;
            }
        }
        if (!focusNodeId) focusNodeId = activeStage;

        const target = nodes.find((n) => n.id === focusNodeId);
        if (!target) return;

        // Deduplicate: don't re-pan on every poll if the focus hasn't moved.
        if (lastFocusKeyRef.current === focusNodeId) return;
        lastFocusKeyRef.current = focusNodeId;

        const id = requestAnimationFrame(() => {
            flow.fitView({
                nodes: [target],
                padding: 0.3,
                duration: 500,
                maxZoom: 0.9,
            });
        });
        return () => cancelAnimationFrame(id);
    }, [flow, state.liveActiveStage, state.status, state.scenes, nodes]);

    // Show MiniMap once the diagram has many scene nodes — otherwise the
    // user can't see where they are after zooming in. Threshold = 8 since
    // the linear chain alone is already 6 nodes.
    const showMiniMap = nodes.length > 8;

    // Side-channel: per-scene HTML, fully processed via the same pipeline
    // `AIContentPlayer` uses (libs + base styles + palette CSS variables +
    // content-type-specific styles). Without this step the raw timeline
    // entries render blank because they're fragments designed to live
    // inside that scaffold. Memoized so context consumers don't churn
    // unless the timeline JSON or palette changed.
    const htmlByIndex = useMemo(() => {
        const out: Record<number, string | undefined> = {};
        for (const [idx, thumb] of Object.entries(thumbnails)) {
            const raw = thumb.html;
            if (!raw) continue;
            out[Number(idx)] = processHtmlContent(raw, state.contentType, false, palette);
        }
        return out;
    }, [thumbnails, state.contentType, palette]);

    return (
        <ScenesHtmlContext.Provider value={htmlByIndex}>
            {/* Suppress React Flow's default `.selected` outline. We render
                our own state-driven ring on `<BaseNodeShell>` / `<SceneNode>`,
                and a default box-shadow ring on top would double up.
                Scoped to this component via the parent class. */}
            <style>{`
                .pipeline-flow .react-flow__node.selected,
                .pipeline-flow .react-flow__node:focus,
                .pipeline-flow .react-flow__node:focus-visible {
                    outline: none;
                    box-shadow: none;
                }
            `}</style>
            <ReactFlow
                className="pipeline-flow"
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                fitView
                // Scene-heavy runs (10–30+ shots in a single rank) need a
                // small min-zoom to fit-view the whole column. Below this
                // the legend's still readable thanks to the chunky icons.
                minZoom={0.15}
                maxZoom={1.4}
                proOptions={{ hideAttribution: true }}
                nodesDraggable={false}
                nodesConnectable={false}
                // selectable + draggable need to coexist for `onNodeClick` to
                // dispatch reliably across React Flow versions. We override
                // the visual selection state above so a "selected" highlight
                // isn't visible.
                elementsSelectable
                zoomOnScroll
                panOnScroll={false}
                defaultEdgeOptions={{ type: 'smoothstep' }}
                onNodeClick={handleNodeClick}
                onMoveStart={() => {
                    // Any manual pan/zoom opts the user out of the auto-
                    // focus camera. Stays off until the run flips to a new
                    // status (the ref isn't reset between snapshots).
                    followLiveRef.current = false;
                }}
            >
                <Background gap={24} size={1} color="hsl(var(--border))" />
                <Controls position="bottom-left" showInteractive={false} />
                {showMiniMap && <MiniMap pannable zoomable className="!bg-white" />}
                <Panel
                    position="top-right"
                    className="m-3 rounded-md border bg-white px-2 py-1 text-2xs text-muted-foreground shadow-sm"
                >
                    {t('hint.clickAnyStageForDetails')}
                </Panel>
                {/* Director-thinking ticker: a single live line of "what is
                    the pipeline doing right now" sourced from
                    state.liveDirectorThought (set by the BE on shot_decisions /
                    director_thinking events) with a fallback to the active
                    stage label. Only shown while the run is in production. */}
                {state.status === 'in_production' && (state.liveDirectorThought || state.liveActiveStage) && (
                    <Panel
                        position="bottom-center"
                        className="m-3 max-w-xl truncate rounded-full border bg-white/95 px-3 py-1.5 text-xs text-foreground shadow-md backdrop-blur"
                    >
                        <span className="mr-2 inline-block size-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />
                        <span className="font-medium text-muted-foreground">
                            {t('directorTicker.label')}
                        </span>{' '}
                        <span className="text-foreground/90">
                            {state.liveDirectorThought ??
                                t('directorTicker.workingOn', { stage: state.liveActiveStage })}
                        </span>
                    </Panel>
                )}
            </ReactFlow>
            <NodeDetailSheet
                target={openTarget}
                state={enrichedState}
                onOpenChange={handleSheetOpenChange}
                apiKey={apiKey}
            />
        </ScenesHtmlContext.Provider>
    );
}

/**
 * Wrap with `ReactFlowProvider` so we can use `useReactFlow()` for
 * imperative fit-view. Without this, the hook throws.
 */
export function PipelineFlow(props: PipelineFlowProps) {
    return (
        <ReactFlowProvider>
            <div className="size-full min-h-[480px]"> {/* design-lint-ignore: no minHeight token in tailwind.config for this px value; Tailwind's default minHeight scale has no numeric steps */}
                <PipelineFlowInner {...props} />
            </div>
        </ReactFlowProvider>
    );
}

// Internal helper exports for testing / re-use
export { applyDagreLayout, buildPipelineGraph };
export type { PipelineNodeData };
