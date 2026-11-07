import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Video, CircleNotch, ClockCounterClockwise as HistoryIcon } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { getInstituteId } from '@/constants/helper';
import {
    listApiKeys,
    ApiKey,
    getFirstAvailableFullKey,
    generateApiKey,
    storeFullApiKey,
} from '../-services/api-keys';
import {
    GenerateVideoRequest,
    HistoryItem,
    VideoStage,
    SSEEvent,
    ContentType,
    VideoOrientation,
    TokenUsage,
    RoutingOverrides,
    ShotPlanItem,
    generateVideo,
    regenerateFrame,
    saveCastFromVideo,
    updateFrame,
    resumeVideo,
    retryVideo,
    submitDecision,
    readAwaitingDecisionFromStatus,
    fetchScriptText,
    getVideoUrls,
    getVideoStatus,
    getRemoteHistory,
    cancelGeneration,
    DEFAULT_OPTIONS,
    REUSE_SETTINGS_HANDOFF_KEY,
    type ReuseSettingsHandoff,
    type DecisionRequest,
    type DecisionAnswer,
    type AssistTurn,
    type GateType,
} from '../-services/video-generation';
import { HistorySidebar } from './HistorySidebar';
import { ScriptReview } from './ScriptReview';
import { AssistChat, type PostEditItem } from './assist/AssistChat';
import { buildTurnSummary, reconstructAssistTranscript } from './assist/-utils/decision-copy';
import { buildStageRows } from './assist/-utils/stage-rows';
import { AssistModeToggle } from '../console/-components/AssistModeToggle';
import { PipelineLayout } from './pipeline/PipelineLayout';
import {
    derivePipelineFromLive,
    EVENT_LOG_CAP,
    type LiveCurrentGeneration,
    type PipelineEventLogEntry,
} from './pipeline/-utils/derive-pipeline-state';
import { CenteredHero } from '../console/-components/CenteredHero';
import { IntentChips } from '../console/-components/IntentChips';
import { Composer } from '../console/-components/Composer';
import { AttachmentItem } from '../console/-components/ContextTray';

interface VideoConsoleWorkspaceProps {
    /**
     * When true, render the History sidebar (mobile drawer + desktop rail) and
     * its mobile access button. Vim hosts the workspace inside its own dashboard
     * shell with a separate Recent tab and turns this off.
     */
    showHistorySidebar?: boolean;
    /**
     * If set, on mount the workspace fetches this video's URLs/status and
     * lands in `complete` state — i.e. drops the user straight on the
     * production view (PipelineLayout) for that video. Used by vim's Recent
     * tab to deep-link a card into the production view without requiring a
     * History sidebar to host the click.
     */
    initialVideoId?: string;
    /**
     * Forwarded to PipelineLayout's "Edit" affordance. When set, replaces the
     * default admin-route navigation. Vim passes a handler that targets
     * `/vim/edit/$videoId`.
     */
    onEdit?: (params: {
        videoId: string;
        htmlUrl: string;
        audioUrl: string;
        wordsUrl: string;
        apiKey: string;
        orientation: string;
    }) => void;
    /**
     * When true, the Composer's settings popover swaps its free-form Style /
     * Branding / face-upload UI for the vim-only saved-Brand-Kit and saved-Avatar
     * pickers. Submit is also blocked when host is enabled without a
     * saved_avatar_id, with a toast linking to the Avatars tab.
     */
    vimMode?: boolean;
}

/** Map internal stage names to user-friendly labels */
function buildStageLabels(t: TFunction): Record<string, string> {
    return {
        PENDING: t('stageLabels.pending'),
        SCRIPT: t('stageLabels.script'),
        TTS: t('stageLabels.tts'),
        WORDS: t('stageLabels.words'),
        HTML: t('stageLabels.html'),
        AVATAR: t('stageLabels.avatar'),
        RENDER: t('stageLabels.render'),
    };
}
function friendlyStage(stage: string, t: TFunction): string {
    return buildStageLabels(t)[stage] || stage;
}

/** Estimate overall percentage from the current pipeline stage (used during polling) */
function stageToPercentage(stage: string): number {
    const map: Record<string, number> = {
        PENDING: 5,
        SCRIPT: 25,
        TTS: 50,
        WORDS: 70,
        HTML: 90,
        AVATAR: 95,
        RENDER: 98,
    };
    return map[stage] ?? 0;
}

/**
 * Polling-time HTML-stage percentage. The HTML stage owns 60–95% of the bar;
 * within that window we interpolate by `shots_completed / shots_total` so the
 * progress bar advances per-shot instead of sticking at 90% the whole HTML phase.
 */
function computeHtmlPercentage(
    shotsCompleted: number | undefined,
    shotsTotal: number | undefined
): number {
    if (!shotsTotal || shotsTotal <= 0) return stageToPercentage('HTML'); // 90 fallback
    const ratio = Math.min(1, Math.max(0, (shotsCompleted ?? 0) / shotsTotal));
    return Math.round(60 + ratio * 35); // 60..95
}

/** Unified cap for the "live" recent-errors list shown in the progress UI. */
const RECENT_ERRORS_CAP = 10;

/**
 * Append an entry to the in-memory SSE event log, applying the
 * `EVENT_LOG_CAP` slice on overflow. Used by every SSE branch that wants to
 * record an event for the Developer / Audit drawer. Pure — caller owns the
 * `prev` array and assignment.
 */
function appendEventLog(
    prev: PipelineEventLogEntry[] | undefined,
    entry: PipelineEventLogEntry
): PipelineEventLogEntry[] {
    const next = prev ? [...prev, entry] : [entry];
    return next.length > EVENT_LOG_CAP ? next.slice(-EVENT_LOG_CAP) : next;
}

/** Map backend uppercase status to HistoryItem.status used by the sidebar. */
function mapVideoStatusToRow(status: string): HistoryItem['status'] {
    switch (status.toUpperCase()) {
        case 'COMPLETED':
            return 'completed';
        case 'FAILED':
        case 'STALLED':
            return 'failed';
        case 'IN_PROGRESS':
            return 'generating';
        case 'PENDING':
        default:
            return 'pending';
    }
}

type ConsoleState = 'idle' | 'generating' | 'reviewing' | 'assisting' | 'complete';

/** Gates enabled by default when assist mode is on (mirrors the BE default). */
const DEFAULT_ASSIST_GATES: GateType[] = [
    'shot_plan',
    'styleframe',
    'narration',
    // Approve/replace character portraits BEFORE dialogue clips are filmed —
    // the only place a user can bind real faces ("Use my image") to the cast.
    'cast',
    // Review every filmed dialogue clip (with QC verdicts) BEFORE the final
    // cut — approve or send clips back for a charged re-take.
    'dailies',
    'visual_casting',
    'shot_look',
];

interface CurrentGeneration {
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
    /** Final rendered MP4 URL — set when /urls/{video_id} returns video_url
     *  (i.e. a previous render already completed). Surfaces the "Download MP4"
     *  CTA on refresh without re-polling render status. */
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
    /**
     * Per-shot plan. Carries both v2 (Director) and v3 (ShotPlanner +
     * NarrationWriter) field sets — the v3 fields (narration_brief,
     * audio_policy, background_treatment, transition_in, intent_role, plus
     * pre-computed per-shot audio URLs) are optional. Both pipelines emit
     * the plan via the `shot_plan` payload on either `director_done` (v2)
     * or `shot_planning_done` (v3) sub_stage events.
     */
    shotPlan?: ShotPlanItem[];
    /**
     * v3 only — pipeline architecture flag captured from the request body
     * (when the FE sent `pipeline_version`) so the diagram swaps to the
     * ShotPlanner-first graph immediately, before the first SSE event.
     */
    pipelineVersion?: 'v2' | 'v3';
    /**
     * v3 only — plan-level recurring motifs captured from
     * `shot_planning_done`. Drives the ShotPlanner detail sheet.
     */
    recurringMotifs?: Array<{
        description: string;
        screen_position?: string;
        when_visible?: string;
    }>;
    /** v3 only — total words NarrationWriter authored. From `narration_writing_done`. */
    narrationWordCount?: number;
    /**
     * Assist mode: the decision the agent is currently asking the user to
     * resolve, or null between gates. Set by the `decision_required` SSE case
     * (or polling rehydration); drives the `generating → assisting` transition.
     */
    pendingDecision?: DecisionRequest | null;
    /** Assist mode: resolved Q&A turns this session, for the conversation transcript. */
    assistTranscript?: AssistTurn[];
    /** Latest `shot_planning*` sub_stage seen — used as the node's active sub-status. */
    shotPlannerSubStage?: string;
    /** Latest `narration_writing*` sub_stage seen — used as the node's active sub-status. */
    narrationWriterSubStage?: string;
    /**
     * Universal "latest sub_stage on the wire" — set on every `sub_stage`
     * event regardless of family. Replaces the substring-match-on-`message`
     * lookup that `detectActiveSubStage` was doing (and silently failing
     * at for every sub_stage whose message text used spaces). Consumers
     * read this field via `LiveCurrentGeneration.currentSubStage`.
     */
    currentSubStage?: string;
    /**
     * Append-only log of every SSE event seen during this session. Powers
     * the Developer / Audit drawer's "Pipeline path" timeline so users can
     * see exactly which events fired in what order with what payload. Lives
     * in memory only — on tab reload the BE-persisted state takes over.
     */
    eventLog?: PipelineEventLogEntry[];
    /**
     * Avatar-host counters captured from `avatar_*` sub_stage events. The BE
     * doesn't push these on `progress`/`completed` events — only on per-shot
     * `sub_stage` events — so we accumulate them onto `currentGeneration` so
     * the pipeline view can keep rendering Talent state after the message
     * field has rolled to a different stage.
     */
    hostShotCount?: number;
    hostShotCompleted?: number;
    /** True after `avatar_batch_done` fires — drives the Talent node to wrapped. */
    hostBatchDone?: boolean;
    /** Latest `avatar_*` sub_stage seen — used as the Talent node's active sub-status. */
    hostSubStage?: string;
    /**
     * Background-music counters from `background_music_*` sub_stage events.
     * Same rationale as above: BE only emits these on transient sub_stage
     * events, but the Score node needs to keep rendering its progress.
     */
    musicSegmentsTotal?: number;
    musicSegmentsCompleted?: number;
    musicDone?: boolean;
    /** S3 URL of the merged background-music track — only present after `background_music_done`. */
    musicUrl?: string;
    musicSubStage?: string;
}

/** Persisted across page navigations so polling can resume after SSE disconnect */
const PENDING_GENERATION_KEY = 'video-console-pending-gen';
/**
 * Persisted so VideoResult can restore in-flight render polling state after a
 * reload (the render job ID lives in render-job-{videoId} but VideoResult only
 * mounts when the parent has a complete `currentGeneration` to hand off).
 *
 * TTL'd to match the render-job lifetime — restoring an hours-old completed
 * video on a fresh tab open isn't useful, just surprising.
 */
const COMPLETE_GENERATION_KEY = 'video-console-complete-gen';
const COMPLETE_GENERATION_TTL_MS = 90 * 60 * 1000; // 90 min — matches MAX_RENDER_AGE_MS in VideoResult

interface PersistedCompleteGeneration {
    savedAt: number;
    generation: CurrentGeneration;
}

/** Content types that produce no audio — html_url alone is sufficient for "complete" */
const NO_AUDIO_TYPES = new Set<ContentType>(['SLIDES']);
const needsAudio = (contentType?: ContentType | string) =>
    !NO_AUDIO_TYPES.has(contentType as ContentType);

interface PendingGeneration {
    videoId: string;
    prompt: string;
    contentType: ContentType;
    options: Omit<GenerateVideoRequest, 'prompt'>;
    /** The target_stage at generation time — so polling knows if SCRIPT completion is expected */
    targetStage?: VideoStage;
}

export function VideoConsoleWorkspace({
    showHistorySidebar = true,
    initialVideoId,
    onEdit,
    vimMode = false,
}: VideoConsoleWorkspaceProps = {}) {
    const { t } = useTranslation('videoApiStudioVideoConsoleWorkspace');
    const instituteId = getInstituteId();

    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [isLoadingKeys, setIsLoadingKeys] = useState(true);
    const [isAutoGenerating, setIsAutoGenerating] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [historyPage, setHistoryPage] = useState(0);
    const [historyHasMore, setHistoryHasMore] = useState(true);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [consoleState, setConsoleState] = useState<ConsoleState>('idle');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);

    // Review mode state
    const [reviewModeEnabled, setReviewModeEnabled] = useState(false);
    const [reviewScript, setReviewScript] = useState('');

    // Assist mode (conversational, human-in-the-loop) — the new default. When
    // on, the BE pauses at decision gates and the FE drives a chat surface.
    const [assistModeEnabled, setAssistModeEnabled] = useState(true);
    const [enabledGates] = useState<GateType[]>(DEFAULT_ASSIST_GATES);
    // Opens the production diagram in a side drawer while in the chat surface.
    const [showAssistProgress, setShowAssistProgress] = useState(false);
    // True while a /decision leg is opening (disables the cards).
    const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
    // Post-completion conversational editor state ("redo shot 3 — …").
    const [postEdits, setPostEdits] = useState<PostEditItem[]>([]);
    const [playerReloadKey, setPlayerReloadKey] = useState(0);
    const [castSaved, setCastSaved] = useState(false);

    // One-shot consume of the "Reuse settings" handoff written by a Recent
    // card. Read in a `useState` initializer so it's available before the
    // prompt/options initializers run; cleared in a `useEffect` after mount
    // so we don't side-effect during render (safe under StrictMode's double-
    // invoke). The handoff carries the previous run's prompt + tonal options
    // (tier / voice / host / brand kit / visual mix), with per-run fields
    // like reference_files stripped at write time.
    const [reuseHandoff] = useState<ReuseSettingsHandoff | null>(() => {
        try {
            const raw = sessionStorage.getItem(REUSE_SETTINGS_HANDOFF_KEY);
            return raw ? (JSON.parse(raw) as ReuseSettingsHandoff) : null;
        } catch {
            return null;
        }
    });
    useEffect(() => {
        if (reuseHandoff) {
            sessionStorage.removeItem(REUSE_SETTINGS_HANDOFF_KEY);
            toast.success(t('toasts.settingsCopied'), {
                description: t('toasts.settingsCopiedDescription'),
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount
    }, []);

    // Lifted state for prompt and options. Reuse-handoff wins over the
    // localStorage stickiness — when the user explicitly chose "Reuse settings"
    // on a Recent card, that intent is fresher than last session's state.
    const [prompt, setPrompt] = useState(
        () => reuseHandoff?.prompt ?? localStorage.getItem('video-studio-prompt') ?? ''
    );
    const [options, setOptions] = useState<Omit<GenerateVideoRequest, 'prompt'>>(() => {
        let initial: Omit<GenerateVideoRequest, 'prompt'>;
        if (reuseHandoff?.options) {
            initial = { ...DEFAULT_OPTIONS, ...reuseHandoff.options };
        } else {
            const saved = localStorage.getItem('video-studio-options');
            if (saved) {
                try {
                    initial = { ...DEFAULT_OPTIONS, ...JSON.parse(saved) };
                } catch (e) {
                    console.error('Failed to parse saved options:', e);
                    initial = DEFAULT_OPTIONS;
                }
            } else {
                initial = DEFAULT_OPTIONS;
            }
        }
        // Vimotion-specific normalizations. Same browser may carry stale
        // localStorage from an admin-mode session — clean it up at init so
        // hidden-in-vimMode fields don't ship in the wire payload.
        //   • content_type → VIDEO  (P2-13: selector hidden in vimMode)
        //   • model → undefined     (P2-12: V200 stage-routing matrix is
        //     authoritative for vimMode; legacy top-level `model` is admin-
        //     only). Setting to undefined ensures JSON.stringify drops the
        //     key entirely from the request body.
        if (vimMode) {
            const patch: Partial<Omit<GenerateVideoRequest, 'prompt'>> = {};
            if (initial.content_type !== 'VIDEO') patch.content_type = 'VIDEO';
            if (initial.model) patch.model = undefined;
            if (Object.keys(patch).length > 0) {
                initial = { ...initial, ...patch };
            }
        }
        return initial;
    });

    // Persist prompt and options
    useEffect(() => {
        localStorage.setItem('video-studio-prompt', prompt);
    }, [prompt]);

    useEffect(() => {
        // brand_overrides is a per-video, one-shot field — never persist it so it
        // doesn't silently stick to the next video / survive a reload.
        const { brand_overrides: _omitBrandOverrides, ...persistable } = options;
        localStorage.setItem('video-studio-options', JSON.stringify(persistable));
    }, [options]);

    const [currentGeneration, setCurrentGeneration] = useState<CurrentGeneration | null>(null);
    const [isLoadingVideoUrls, setIsLoadingVideoUrls] = useState(false);

    // Composer state lifted to the parent so attachments, selected source videos,
    // ignored URLs, and routing overrides survive the idle → generating → idle
    // remount cycle (Composer unmounts during generating/reviewing).
    const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
    const [selectedInputVideoIds, setSelectedInputVideoIds] = useState<string[]>([]);
    const [inputVideoAudio, setInputVideoAudio] = useState<'original' | 'tts'>('tts');
    const [muteTtsDuringSourceClips, setMuteTtsDuringSourceClips] = useState(false);
    const [ignoredUrls, setIgnoredUrls] = useState<Set<string>>(new Set());
    const [routingOverrides, setRoutingOverrides] = useState<RoutingOverrides>({});

    const abortRef = useRef<(() => void) | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /**
     * Mirror of `currentGeneration` for synchronous reads from inside async
     * SSE callbacks (their closure captures the stateful value at the time the
     * callback was created — stale by the time the event fires).
     */
    const currentGenerationRef = useRef<CurrentGeneration | null>(null);

    // Load API keys
    useEffect(() => {
        const loadKeys = async () => {
            if (!instituteId) return;
            setIsLoadingKeys(true);
            try {
                const keys = await listApiKeys(instituteId);
                setApiKeys(keys.filter((k) => k.status === 'active'));
            } catch (error) {
                console.error('Error loading API keys:', error);
            } finally {
                setIsLoadingKeys(false);
            }
        };
        loadKeys();
    }, [instituteId]);

    // Auto-generate API key if none available
    useEffect(() => {
        const activeKey = getFirstAvailableFullKey(apiKeys);
        if (!isLoadingKeys && !activeKey && !isAutoGenerating && instituteId) {
            const autoGenerate = async () => {
                setIsAutoGenerating(true);
                try {
                    const newKeyName = `Console Key ${new Date().toLocaleDateString()}`;
                    const result = await generateApiKey(instituteId, newKeyName);
                    storeFullApiKey(result.id, result.key);

                    // Refresh keys
                    const keys = await listApiKeys(instituteId);
                    setApiKeys(keys.filter((k) => k.status === 'active'));
                    toast.success(t('toasts.apiKeyAutoGenerated'));
                } catch (error) {
                    console.error('Error auto-generating key:', error);
                    // Don't show toast here as the error screen will show up
                } finally {
                    setIsAutoGenerating(false);
                }
            };
            autoGenerate();
        }
    }, [isLoadingKeys, apiKeys, instituteId, isAutoGenerating, t]);

    // Get the full API key from localStorage (stored when key was generated).
    // Memoize so referential identity is stable across renders — otherwise every
    // render would re-create fetchHistoryPage and re-fire the history effects.
    const activeApiKey = useMemo(() => getFirstAvailableFullKey(apiKeys), [apiKeys]);

    const HISTORY_PAGE_SIZE = 20;

    // Fetch history for the current page
    const fetchHistoryPage = useCallback(
        async (page: number) => {
            if (!activeApiKey) return;
            setIsLoadingHistory(true);
            try {
                const items = await getRemoteHistory(
                    activeApiKey,
                    HISTORY_PAGE_SIZE,
                    page * HISTORY_PAGE_SIZE
                );
                setHistory(items);
                setHistoryHasMore(items.length >= HISTORY_PAGE_SIZE);
            } catch (error) {
                console.error('Failed to load history:', error);
            } finally {
                setIsLoadingHistory(false);
            }
        },
        [activeApiKey]
    );

    // Initial / page-change fetch. The polling effect below only updates rows
    // already on the page; this fills the page when the user changes pages or
    // the API key becomes available.
    useEffect(() => {
        if (!activeApiKey) return;
        fetchHistoryPage(historyPage);
    }, [activeApiKey, historyPage, fetchHistoryPage]);

    // Stable string of in-flight ids so the polling effect only restarts when
    // the *set* of in-flight rows changes — not on every history mutation.
    const inflightIdsKey = useMemo(
        () =>
            history
                .filter((h) => h.status === 'pending' || h.status === 'generating')
                .map((h) => h.video_id)
                .sort()
                .join(','),
        [history]
    );

    // Per-item status polling. For each in-flight row, hit /status/{id} every
    // 10s and patch just that row. Only do a full-page refetch when a row
    // transitions to a terminal state (so URLs / token_usage land from the
    // history endpoint).
    useEffect(() => {
        if (!activeApiKey || !inflightIdsKey) return;
        const ids = inflightIdsKey.split(',').filter(Boolean);
        if (ids.length === 0) return;

        let cancelled = false;

        const tick = async () => {
            const results = await Promise.all(
                ids.map((id) =>
                    getVideoStatus(id, activeApiKey)
                        .then((status) => ({ id, status, ok: true as const }))
                        .catch(() => ({ id, status: null, ok: false as const }))
                )
            );
            if (cancelled) return;

            const successful = results.filter(
                (r): r is { id: string; status: NonNullable<typeof r.status>; ok: true } => r.ok
            );
            if (successful.length === 0) return;

            let anyTerminal = false;
            for (const r of successful) {
                const mapped = mapVideoStatusToRow(r.status.status);
                if (mapped === 'completed' || mapped === 'failed') {
                    anyTerminal = true;
                    break;
                }
            }

            setHistory((prev) =>
                prev.map((row) => {
                    const r = successful.find((x) => x.id === row.video_id);
                    if (!r) return row;
                    return {
                        ...row,
                        status: mapVideoStatusToRow(r.status.status),
                        stage: r.status.current_stage,
                    };
                })
            );

            if (anyTerminal) {
                fetchHistoryPage(historyPage);
            }
        };

        tick();
        const interval = setInterval(tick, 10000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [activeApiKey, inflightIdsKey, historyPage, fetchHistoryPage]);

    const handlePageChange = useCallback((page: number) => {
        setHistoryPage(page);
    }, []);

    // Estimate total pages (we know there are more if current page is full)
    const historyTotalPages = historyHasMore ? historyPage + 2 : historyPage + 1;

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (abortRef.current) abortRef.current();
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    /**
     * Poll /urls/{videoId} until html_url + audio_url are available.
     * Used when SSE connection is lost (page navigation) or when opening a
     * still-generating history item.
     */
    const startPollingForVideo = useCallback((pending: PendingGeneration, apiKey: string) => {
        // Cancel any existing poll
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }

        setConsoleState('generating');
        setSelectedHistoryId(pending.videoId);
        setCurrentGeneration({
            videoId: pending.videoId,
            prompt: pending.prompt,
            contentType: pending.contentType,
            orientation: (pending.options?.orientation as VideoOrientation) || 'landscape',
            stage: 'PENDING',
            percentage: 0,
            message: t('progressMessages.reconnecting'),
            options: pending.options,
        });

        let pollCount = 0;
        // Stop polling after ~12 minutes (72 × 10 s) — server restart or stuck job
        const MAX_POLL_ATTEMPTS = 72;

        const poll = async () => {
            pollCount++;

            if (pollCount > MAX_POLL_ATTEMPTS) {
                if (pollingRef.current) clearInterval(pollingRef.current);
                pollingRef.current = null;
                localStorage.removeItem(PENDING_GENERATION_KEY);
                setConsoleState('idle');
                setCurrentGeneration(null);
                toast.error(t('toasts.generationTakingWhile'));
                return;
            }

            try {
                const [urls, statusResp] = await Promise.all([
                    getVideoUrls(pending.videoId, apiKey),
                    getVideoStatus(pending.videoId, apiKey).catch(() => null),
                ]);
                const genProg = statusResp?.generation_progress ?? null;
                // /urls doesn't return script_url; pull it from /status.s3_urls.script
                // so the GenerationProgress's "Script" panel shows up during polling.
                const scriptUrlFromStatus =
                    (statusResp?.s3_urls as Record<string, string | undefined> | undefined)
                        ?.script ?? undefined;

                // Assist mode: the run is paused at a decision gate. Rehydrate the
                // pending decision (the generating→assisting useEffect picks it up)
                // and stop polling — the user drives the next leg via /decision.
                const awaitingDecision =
                    readAwaitingDecisionFromStatus(statusResp) ??
                    readAwaitingDecisionFromStatus(urls);
                if (awaitingDecision) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setCurrentGeneration((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  stage: (urls.current_stage as VideoStage) || 'SCRIPT',
                                  message: awaitingDecision.prompt,
                                  pendingDecision: awaitingDecision,
                                  assistTranscript: prev.assistTranscript ?? [],
                              }
                            : prev
                    );
                    return;
                }

                if (urls.html_url && (urls.audio_url || !needsAudio(pending.contentType))) {
                    // Success — fill URLs into state and let the auto-complete useEffect
                    // perform the consoleState transition + toast (single source of truth).
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setCurrentGeneration((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  stage: (urls.current_stage as VideoStage) || 'HTML',
                                  percentage: 100,
                                  message: '',
                                  htmlUrl: urls.html_url!,
                                  audioUrl: urls.audio_url ?? prev.audioUrl,
                                  wordsUrl: urls.words_url ?? prev.wordsUrl,
                                  scriptUrl: scriptUrlFromStatus ?? prev.scriptUrl,
                                  cumulativeTokens:
                                      genProg?.cumulative_tokens ?? prev.cumulativeTokens,
                                  shotsCompleted: genProg?.shots_completed ?? prev.shotsCompleted,
                                  shotsTotal: genProg?.shots_total ?? prev.shotsTotal,
                                  shotPlan: genProg?.shot_plan ?? prev.shotPlan,
                              }
                            : null
                    );
                } else if (urls.status === 'FAILED') {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    localStorage.removeItem(PENDING_GENERATION_KEY);
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                    toast.error(
                        urls.error_message ||
                            t('toasts.generationFailedAtStep', {
                                stage: friendlyStage(urls.current_stage, t),
                            })
                    );
                } else if (urls.status === 'STALLED') {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    localStorage.removeItem(PENDING_GENERATION_KEY);
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                    toast.error(
                        urls.error_message ||
                            t('toasts.generationStuckAtStep', {
                                stage: friendlyStage(urls.current_stage, t),
                            })
                    );
                } else if (urls.status === 'COMPLETED' && !urls.html_url) {
                    // A review-mode run (target_stage=SCRIPT) parks HERE on purpose
                    // once the screenplay is written: the backend marks SCRIPT
                    // COMPLETED with no html_url. Detect that FIRST — before any
                    // "still transitioning" heuristic — because the backend leaves
                    // generation_progress.sub_stage populated ("Shot plan + narration
                    // ready…") after the stop, which would otherwise look like active
                    // work and mask the review handoff (the bug that left review runs
                    // spinning forever on the polling-fallback path).
                    const wasReviewModeStop =
                        pending.targetStage === 'SCRIPT' || urls.current_stage === 'SCRIPT';

                    if (wasReviewModeStop) {
                        // Script artifact ready → drop straight into the editable
                        // review UI (ScriptReview) instead of routing through History.
                        if (scriptUrlFromStatus) {
                            if (pollingRef.current) clearInterval(pollingRef.current);
                            pollingRef.current = null;
                            localStorage.removeItem(PENDING_GENERATION_KEY);
                            setCurrentGeneration((prev) =>
                                prev
                                    ? {
                                          ...prev,
                                          stage: 'SCRIPT',
                                          percentage: 100,
                                          scriptUrl: scriptUrlFromStatus,
                                          message: '',
                                      }
                                    : null
                            );
                            fetchScriptText(scriptUrlFromStatus)
                                .then((text) => {
                                    setReviewScript(text);
                                    setConsoleState('reviewing');
                                    toast.success(t('toasts.scriptReady'));
                                })
                                .catch((err) => {
                                    console.error('Failed to fetch script:', err);
                                    toast.error(t('toasts.scriptLoadFailed'));
                                    setConsoleState('idle');
                                    setCurrentGeneration(null);
                                });
                            return;
                        }
                        // SCRIPT is COMPLETED but the script URL hasn't surfaced in
                        // /status yet — keep polling (do NOT fall through to the
                        // transition spinner, which would imply we're building visuals).
                        setCurrentGeneration((prev) =>
                            prev
                                ? { ...prev, stage: 'SCRIPT', message: t('progressMessages.finalizingScript') }
                                : null
                        );
                        return;
                    }

                    // Non-review runs: COMPLETED without html_url means a pre-HTML
                    // sub-stage finished and the pipeline is transitioning toward
                    // visuals. Two activity signals: the stage bucket, or live
                    // generation_progress (sub_stage / shots in flight).
                    const PRE_HTML_STAGES = new Set(['PENDING', 'SCRIPT', 'TTS', 'AUDIO', 'WORDS']);
                    const stageIsTransitioning = PRE_HTML_STAGES.has(urls.current_stage);
                    const progressSignalsActive =
                        genProg != null &&
                        (genProg.sub_stage != null || (genProg.shots_total ?? 0) > 0);
                    const isTransitioning = stageIsTransitioning || progressSignalsActive;

                    if (isTransitioning) {
                        const msg =
                            genProg?.shots_completed != null && genProg?.shots_total
                                ? t('progressMessages.generatingVisualsShot', {
                                      completed: genProg.shots_completed,
                                      total: genProg.shots_total,
                                  })
                                : genProg?.sub_stage
                                  ? genProg.sub_stage.replace(/_/g, ' ')
                                  : t('progressMessages.stageComplete', {
                                        stage: friendlyStage(urls.current_stage, t),
                                    });
                        const hasShots = (genProg?.shots_total ?? 0) > 0;
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: hasShots
                                          ? 'HTML'
                                          : (urls.current_stage as VideoStage) || prev.stage,
                                      percentage: hasShots
                                          ? computeHtmlPercentage(
                                                genProg?.shots_completed,
                                                genProg?.shots_total
                                            )
                                          : stageToPercentage(urls.current_stage),
                                      message: msg,
                                      scriptUrl: scriptUrlFromStatus ?? prev.scriptUrl,
                                      shotsCompleted:
                                          genProg?.shots_completed ?? prev.shotsCompleted,
                                      shotsTotal: genProg?.shots_total ?? prev.shotsTotal,
                                      cumulativeTokens:
                                          genProg?.cumulative_tokens ?? prev.cumulativeTokens,
                                      shotPlan: genProg?.shot_plan ?? prev.shotPlan,
                                  }
                                : null
                        );
                        return;
                    }

                    if (pollingRef.current) clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    localStorage.removeItem(PENDING_GENERATION_KEY);
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                    toast.error(
                        urls.error_message ||
                            t('toasts.generationStoppedAtStep', {
                                stage: friendlyStage(urls.current_stage, t),
                            })
                    );
                } else {
                    // Still IN_PROGRESS — update stage + sub-stage progress from DB.
                    // When shots are in flight, override stage to HTML even if the urls
                    // endpoint still reports WORDS (transitioning window).
                    const hasShots = (genProg?.shots_total ?? 0) > 0;
                    const effectiveStage: VideoStage = hasShots
                        ? 'HTML'
                        : (urls.current_stage as VideoStage) || 'PENDING';
                    const subStageMsg = genProg
                        ? genProg.shots_completed != null && genProg.shots_total
                            ? t('progressMessages.generatingVisualsShot', {
                                  completed: genProg.shots_completed,
                                  total: genProg.shots_total,
                              })
                            : genProg.sub_stage
                              ? genProg.sub_stage.replace(/_/g, ' ')
                              : t('progressMessages.stageInProgress', {
                                    stage: friendlyStage(urls.current_stage, t),
                                })
                        : t('progressMessages.stageInProgress', {
                              stage: friendlyStage(urls.current_stage, t),
                          });

                    setCurrentGeneration((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  stage: effectiveStage,
                                  // Per-shot progress when in HTML stage; stage-bucket otherwise.
                                  percentage: hasShots
                                      ? computeHtmlPercentage(
                                            genProg?.shots_completed,
                                            genProg?.shots_total
                                        )
                                      : stageToPercentage(effectiveStage),
                                  message: subStageMsg,
                                  htmlUrl: urls.html_url ?? prev.htmlUrl,
                                  audioUrl: urls.audio_url ?? prev.audioUrl,
                                  wordsUrl: urls.words_url ?? prev.wordsUrl,
                                  scriptUrl: scriptUrlFromStatus ?? prev.scriptUrl,
                                  shotsCompleted: genProg?.shots_completed ?? prev.shotsCompleted,
                                  shotsTotal: genProg?.shots_total ?? prev.shotsTotal,
                                  cumulativeTokens:
                                      genProg?.cumulative_tokens ?? prev.cumulativeTokens,
                                  shotPlan: genProg?.shot_plan ?? prev.shotPlan,
                                  recentErrors: genProg?.errors
                                      ? genProg.errors.slice(-RECENT_ERRORS_CAP).map((e) => ({
                                            shot_index: e.shot_index,
                                            shot_type: e.shot_type,
                                            error: e.error,
                                            retrying: e.retrying,
                                        }))
                                      : prev.recentErrors,
                              }
                            : null
                    );
                }
            } catch (err) {
                console.warn('[Polling] Error fetching video URLs:', err);
            }
        };

        poll(); // immediate first check
        pollingRef.current = setInterval(poll, 10_000);
    }, [t]);

    /**
     * On mount: if we previously stored a pending generation (SSE dropped),
     * resume polling so the user doesn't see a blank screen.
     */
    useEffect(() => {
        if (!activeApiKey) return;
        // Don't interrupt an active SSE session
        if (consoleState === 'generating') return;

        const raw = localStorage.getItem(PENDING_GENERATION_KEY);
        if (raw) {
            try {
                const pending: PendingGeneration = JSON.parse(raw);
                startPollingForVideo(pending, activeApiKey);
            } catch {
                localStorage.removeItem(PENDING_GENERATION_KEY);
            }
            return;
        }

        // Restore completed generation (so VideoResult mounts and can resume render progress).
        // Drop entries older than COMPLETE_GENERATION_TTL_MS — past that window the
        // render-job recovery they exist for is no longer relevant, and silently
        // landing the user back on a stale video is worse than starting fresh.
        const completeRaw = localStorage.getItem(COMPLETE_GENERATION_KEY);
        if (completeRaw && consoleState === 'idle' && !currentGeneration) {
            try {
                const parsed = JSON.parse(completeRaw) as
                    | PersistedCompleteGeneration
                    | CurrentGeneration; // tolerate the legacy un-wrapped shape
                const isWrapped =
                    typeof (parsed as PersistedCompleteGeneration).savedAt === 'number' &&
                    !!(parsed as PersistedCompleteGeneration).generation;
                if (isWrapped) {
                    const wrapper = parsed as PersistedCompleteGeneration;
                    const age = Date.now() - wrapper.savedAt;
                    if (age > COMPLETE_GENERATION_TTL_MS) {
                        localStorage.removeItem(COMPLETE_GENERATION_KEY);
                    } else if (wrapper.generation.videoId && wrapper.generation.htmlUrl) {
                        setCurrentGeneration(wrapper.generation);
                        setConsoleState('complete');
                    }
                } else {
                    // Legacy entries pre-date the TTL wrapper — discard them so the
                    // user gets a clean idle state instead of an indefinitely-stale
                    // video. They'll naturally be re-persisted in the new shape on
                    // their next completion.
                    localStorage.removeItem(COMPLETE_GENERATION_KEY);
                }
            } catch {
                localStorage.removeItem(COMPLETE_GENERATION_KEY);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeApiKey]); // intentionally run only when key first becomes available

    // Persist complete state so VideoResult can restore render progress after reload
    useEffect(() => {
        if (consoleState === 'complete' && currentGeneration?.htmlUrl) {
            const wrapper: PersistedCompleteGeneration = {
                savedAt: Date.now(),
                generation: currentGeneration,
            };
            localStorage.setItem(COMPLETE_GENERATION_KEY, JSON.stringify(wrapper));
        } else if (consoleState === 'idle') {
            localStorage.removeItem(COMPLETE_GENERATION_KEY);
        }
    }, [consoleState, currentGeneration]);

    // Mirror currentGeneration into a ref so async SSE callbacks can read the
    // *latest* value synchronously (their closure captures stale state otherwise).
    useEffect(() => {
        currentGenerationRef.current = currentGeneration;
    }, [currentGeneration]);

    // Assist mode: flip generating → assisting when a gate opens (kept out of
    // the SSE reducer to keep reducers pure, mirroring the complete-transition
    // effect below).
    useEffect(() => {
        if (consoleState !== 'generating') return;
        if (!currentGeneration?.pendingDecision) return;
        setConsoleState('assisting');
    }, [consoleState, currentGeneration?.pendingDecision]);

    // Live production-schedule rows for the chat's status bubble — derived from
    // the same PipelineState the diagram uses, so the two stay consistent.
    const assistStageRows = useMemo(
        () =>
            currentGeneration
                ? buildStageRows(
                      derivePipelineFromLive(
                          currentGeneration satisfies LiveCurrentGeneration,
                          undefined,
                          t
                      ),
                      t
                  )
                : undefined,
        [currentGeneration, t]
    );

    // Assist mode: rebuild the conversation transcript when a finished video
    // loads fresh (Recent / deep-link / reload) — the in-memory transcript is
    // gone, but the backend's answered-decisions ledger has every turn. Covers
    // all load paths in one place; no-op for non-assist runs (empty ledger).
    useEffect(() => {
        if (consoleState !== 'complete') return;
        const cg = currentGenerationRef.current;
        if (!cg || !activeApiKey) return;
        if (cg.assistTranscript && cg.assistTranscript.length > 0) return;
        const vid = cg.videoId;
        let cancelled = false;
        getVideoStatus(vid, activeApiKey)
            .then((status) => {
                if (cancelled) return;
                const turns = reconstructAssistTranscript(status, t);
                if (turns.length === 0) return;
                setCurrentGeneration((prev) =>
                    prev && prev.videoId === vid ? { ...prev, assistTranscript: turns } : prev
                );
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [consoleState, currentGeneration?.videoId, activeApiKey, t]);

    /**
     * Single source of truth for the `generating → complete` transition.
     *
     * Watches `currentGeneration` and fires exactly once when the necessary URLs
     * become available, regardless of which code path filled them in (SSE
     * `progress`, SSE `completed`, polling success, retry stream). Avoids:
     *   - double toasts from setState reducers being non-pure
     *   - StrictMode double invocation issues
     *   - inconsistencies across the 4 code paths that used to each trigger
     *     the transition manually.
     */
    useEffect(() => {
        if (consoleState !== 'generating') return;
        const cg = currentGeneration;
        if (!cg?.htmlUrl) return;
        if (needsAudio(cg.contentType) && !cg.audioUrl) return;
        setConsoleState('complete');
        toast.success(t('toasts.contentGenerated'));
        localStorage.removeItem(PENDING_GENERATION_KEY);
    }, [consoleState, currentGeneration, t]);

    const handleGenerate = useCallback(
        async (request: GenerateVideoRequest) => {
            if (!activeApiKey) {
                toast.error(t('toasts.noApiKey'));
                return;
            }

            // ── Host pre-flight validation (fail fast on the FE so users don't
            //    burn a request to discover what they should have fixed locally).
            if (request.host) {
                const tierOk =
                    request.quality_tier === 'ultra' || request.quality_tier === 'super_ultra';
                if (!tierOk) {
                    toast.error(t('toasts.hostTierRequired'));
                    return;
                }
                if (request.host.type === 'avatar') {
                    // Identity comes from one of two paths:
                    //   • saved_avatar_id → BE resolves face_image_url (custom)
                    //     or external_avatar_id (argil/veed) from the studio_avatar
                    //     row, so a missing face_image_url here is fine.
                    //   • free-form upload → face_image_url is the only source.
                    const savedId = request.host.avatar?.saved_avatar_id?.trim();
                    const faceUrl = request.host.avatar?.face_image_url?.trim();
                    if (!savedId && !faceUrl) {
                        toast.error(t('toasts.hostFaceImageRequired'));
                        return;
                    }
                }
                if (request.host.type === 'raw') {
                    toast.error(t('toasts.hostRawUnsupported'));
                    return;
                }
            }

            // Cancel any active poll (new generation takes over)
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
                pollingRef.current = null;
            }

            // Reset state
            setConsoleState('generating');
            setSelectedHistoryId(null);

            // Per-video brand overrides are one-shot. This generation already
            // captured them in `request`, so clear them from the live options now
            // — the next video starts clean from the kit (matches the
            // non-persisted localStorage behavior + the "reset each video" rule).
            if (options.brand_overrides) {
                setOptions((prev) => {
                    if (!prev.brand_overrides) return prev;
                    const { brand_overrides: _omit, ...rest } = prev;
                    return rest;
                });
            }

            const contentType = request.content_type || 'VIDEO';

            const updateHistoryState = (newItem: HistoryItem) => {
                setHistory((prev) => {
                    const index = prev.findIndex((h) => h.video_id === newItem.video_id);
                    if (index >= 0) {
                        const newHistory = [...prev];
                        newHistory[index] = { ...prev[index], ...newItem };
                        return newHistory;
                    } else {
                        return [newItem, ...prev];
                    }
                });
            };

            // Always set target_stage explicitly — never trust whatever may be in options/localStorage.
            // Assist mode subsumes review mode: when assist is on, always target
            // HTML and let the BE pause at decision gates; otherwise honor the
            // legacy "Review script first" toggle.
            const finalRequest: GenerateVideoRequest = {
                ...request,
                target_stage: !assistModeEnabled && reviewModeEnabled ? 'SCRIPT' : 'HTML',
                assist_mode: assistModeEnabled,
                assist_gates: assistModeEnabled ? enabledGates : undefined,
            };

            // Hoisted so SSE callback closures capture a defined value. Used both for
            // the in-memory CurrentGeneration.options and the persisted PENDING_GENERATION_KEY.
            const pendingOptions: Omit<GenerateVideoRequest, 'prompt'> = {
                content_type: contentType,
                orientation: request.orientation || options.orientation || 'landscape',
                language: request.language,
                voice_gender: request.voice_gender,
                tts_provider: request.tts_provider,
                voice_id: request.voice_id,
                captions_enabled: request.captions_enabled,
                html_quality: request.html_quality,
                target_audience: request.target_audience,
                target_duration: request.target_duration,
                model: request.model,
                quality_tier: request.quality_tier,
            };

            // Pinned at SSE-callback creation so every event log entry shares
            // the same t0. Drives the Developer / Audit drawer's relative
            // timestamps ("00:03.456 ShotPlanner started"). Survives across
            // setCurrentGeneration callbacks via closure.
            const genStartMs = Date.now();

            const { abort, videoId } = generateVideo(
                finalRequest,
                activeApiKey,
                (event: SSEEvent) => {
                    if (event.type === 'progress') {
                        // Extract URLs from files if available
                        const audioUrl = event.files?.audio?.s3_url;
                        const timelineUrl = event.files?.timeline?.s3_url;
                        const wordsUrl = event.files?.words?.s3_url;
                        const scriptUrl = event.files?.script?.s3_url;

                        // Spread prev so `shotsCompleted/shotsTotal/cumulativeTokens/
                        // recentErrors/shotPlan` set by other event branches survive
                        // a stage-transition `progress` event.
                        setCurrentGeneration((prev) => {
                            const newEntry: PipelineEventLogEntry = {
                                tsMs: Date.now() - genStartMs,
                                eventType: 'progress',
                                stage: event.stage,
                                message: event.message,
                            };
                            if (!prev) {
                                return {
                                    videoId,
                                    prompt: request.prompt,
                                    contentType,
                                    orientation:
                                        request.orientation ||
                                        (options.orientation as VideoOrientation) ||
                                        'landscape',
                                    stage: event.stage,
                                    percentage: event.percentage,
                                    message: event.message,
                                    htmlUrl: timelineUrl,
                                    audioUrl,
                                    wordsUrl,
                                    scriptUrl,
                                    options: pendingOptions,
                                    startedAtMs: genStartMs,
                                    eventLog: [newEntry],
                                };
                            }
                            return {
                                ...prev,
                                stage: event.stage,
                                percentage: event.percentage,
                                message: event.message,
                                htmlUrl: timelineUrl || prev.htmlUrl,
                                audioUrl: audioUrl || prev.audioUrl,
                                wordsUrl: wordsUrl || prev.wordsUrl,
                                scriptUrl: scriptUrl || prev.scriptUrl,
                                eventLog: appendEventLog(prev.eventLog, newEntry),
                            };
                        });

                        // Update history in state
                        updateHistoryState({
                            id: videoId,
                            video_id: videoId,
                            prompt: request.prompt,
                            content_type: contentType,
                            status: 'generating',
                            stage: event.stage,
                            created_at: new Date().toISOString(),
                            html_url: timelineUrl,
                            audio_url: audioUrl,
                            words_url: wordsUrl,
                            options: pendingOptions,
                        });
                        // The complete-transition is handled by a single useEffect
                        // watching currentGeneration.htmlUrl/audioUrl — no inline
                        // setConsoleState here. Keeps reducers pure.
                    } else if (event.type === 'decision_required') {
                        // Assist mode: the BE paused at a gate. Stash the pending
                        // decision; a useEffect flips generating → assisting (keeps
                        // reducers pure). The SSE leg ends right after this event.
                        localStorage.removeItem(PENDING_GENERATION_KEY);
                        const decision = event;
                        setCurrentGeneration((prev) =>
                            prev
                                ? { ...prev, pendingDecision: decision, message: decision.prompt }
                                : {
                                      videoId,
                                      prompt: request.prompt,
                                      contentType,
                                      orientation:
                                          request.orientation ||
                                          (options.orientation as VideoOrientation) ||
                                          'landscape',
                                      stage: 'SCRIPT',
                                      percentage: 100,
                                      message: decision.prompt,
                                      options: pendingOptions,
                                      pendingDecision: decision,
                                      assistTranscript: [],
                                  }
                        );
                    } else if (event.type === 'completed') {
                        // Review mode: if we stopped at SCRIPT, transition to reviewing.
                        // (Special path — useEffect-based completion only handles the
                        // happy-path HTML→complete transition.)
                        if (reviewModeEnabled && finalRequest.target_stage === 'SCRIPT') {
                            localStorage.removeItem(PENDING_GENERATION_KEY);
                            setCurrentGeneration((prev) =>
                                prev ? { ...prev, stage: 'SCRIPT', percentage: 100 } : null
                            );
                            // CompletedEvent.files has direct URL strings (not {file_id, s3_url}).
                            const scriptUrl = event.files?.script;
                            if (scriptUrl) {
                                fetchScriptText(scriptUrl)
                                    .then((text) => {
                                        setReviewScript(text);
                                        setConsoleState('reviewing');
                                        toast.success(t('toasts.scriptReady'));
                                    })
                                    .catch((err) => {
                                        console.error('Failed to fetch script:', err);
                                        toast.error(t('toasts.scriptLoadFailed'));
                                        setConsoleState('idle');
                                    });
                            } else {
                                toast.error(t('toasts.scriptUrlUnavailable'));
                                setConsoleState('idle');
                            }
                            return;
                        }

                        // Normal flow: ensure URLs are present in state, then let the
                        // auto-complete useEffect (which watches currentGeneration)
                        // fire setConsoleState('complete') exactly once.
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: 'HTML',
                                      percentage: 100,
                                      htmlUrl: prev.htmlUrl || event.files?.timeline,
                                      audioUrl: prev.audioUrl || event.files?.audio,
                                      wordsUrl: prev.wordsUrl || event.files?.words,
                                      scriptUrl: prev.scriptUrl || event.files?.script,
                                      eventLog: appendEventLog(prev.eventLog, {
                                          tsMs: Date.now() - genStartMs,
                                          eventType: 'completed',
                                          message: 'pipeline wrapped',
                                      }),
                                  }
                                : null
                        );

                        updateHistoryState({
                            id: videoId,
                            video_id: videoId,
                            prompt: request.prompt,
                            content_type: contentType,
                            status: 'completed',
                            stage: 'HTML',
                            created_at: new Date().toISOString(),
                            html_url: event.files?.timeline,
                            audio_url: event.files?.audio,
                            words_url: event.files?.words,
                            options: pendingOptions,
                        });
                    } else if (event.type === 'sub_stage') {
                        setCurrentGeneration((prev) => {
                            if (!prev) return null;
                            const updates: Partial<CurrentGeneration> = {};
                            // Universal "current sub_stage" — drives the
                            // derive layer without the broken substring
                            // match. Append-only event log captures the
                            // raw event so the Developer / Audit drawer
                            // can show the pathway chronologically.
                            if (event.sub_stage) {
                                updates.currentSubStage = event.sub_stage;
                            }
                            updates.eventLog = appendEventLog(prev.eventLog, {
                                tsMs: Date.now() - genStartMs,
                                eventType: 'sub_stage',
                                subStage: event.sub_stage,
                                message: event.message,
                                shotIndex:
                                    typeof event.shot_index === 'number'
                                        ? event.shot_index
                                        : undefined,
                                shotCount:
                                    typeof event.shot_count === 'number'
                                        ? event.shot_count
                                        : undefined,
                                tokenDelta: event.token_delta
                                    ? {
                                          prompt_tokens: event.token_delta.prompt_tokens,
                                          completion_tokens: event.token_delta.completion_tokens,
                                          estimated_cost_usd: event.token_delta.estimated_cost_usd,
                                      }
                                    : undefined,
                                error: typeof event.error === 'string' ? event.error : undefined,
                            });
                            // Avatar-host sub-stages live INSIDE the HTML stage. Pin
                            // the stage so the progress UI doesn't regress, and
                            // prefix the message with 🎙️ so host work reads
                            // distinctly from regular shot generation.
                            const sub = event.sub_stage || '';
                            const isHostSubStage = sub.startsWith('avatar_');
                            const isMusicSubStage = sub.startsWith('background_music_');
                            const isShotPlannerSubStage = sub.startsWith('shot_planning');
                            const isNarrationWriterSubStage = sub.startsWith('narration_writing');
                            if (isShotPlannerSubStage) {
                                // v3 ShotPlanner — runs in the SCRIPT stage.
                                // Promote the run to v3 the moment we see this
                                // (so the diagram swaps even if the request body
                                // didn't carry pipeline_version explicitly).
                                updates.stage = 'SCRIPT';
                                updates.message = event.message
                                    ? `🎬 ${event.message}`
                                    : `🎬 ${sub.replace(/_/g, ' ')}`;
                                updates.shotPlannerSubStage = sub;
                                updates.pipelineVersion = 'v3';
                                if (event.shot_plan) {
                                    updates.shotPlan = event.shot_plan;
                                }
                                if (event.recurring_motifs) {
                                    updates.recurringMotifs = event.recurring_motifs;
                                }
                                if (typeof event.shot_count === 'number') {
                                    updates.shotsTotal = event.shot_count;
                                }
                            } else if (isNarrationWriterSubStage) {
                                // v3 NarrationWriter — still SCRIPT-stage, runs
                                // right after ShotPlanner. The done event carries
                                // a final shot_plan with `narration_text` filled
                                // (one of two stages that can update the plan
                                // mid-run; the other is shot_planning_done).
                                updates.stage = 'SCRIPT';
                                updates.message = event.message
                                    ? `✍️ ${event.message}`
                                    : `✍️ ${sub.replace(/_/g, ' ')}`;
                                updates.narrationWriterSubStage = sub;
                                updates.pipelineVersion = 'v3';
                                if (event.shot_plan) {
                                    updates.shotPlan = event.shot_plan;
                                }
                                if (typeof event.narration_word_count === 'number') {
                                    updates.narrationWordCount = event.narration_word_count;
                                }
                            } else if (isHostSubStage) {
                                updates.stage = 'HTML';
                                updates.percentage = computeHtmlPercentage(
                                    prev.shotsCompleted,
                                    prev.shotsTotal
                                );
                                updates.message = event.message
                                    ? `🎙️ ${event.message}`
                                    : `🎙️ ${sub.replace(/_/g, ' ')}`;
                                updates.hostSubStage = sub;
                                if (typeof event.host_shot_count === 'number') {
                                    updates.hostShotCount = event.host_shot_count;
                                }
                                if (typeof event.host_shot_completed === 'number') {
                                    updates.hostShotCompleted = event.host_shot_completed;
                                }
                                if (sub === 'avatar_batch_done') {
                                    updates.hostBatchDone = true;
                                    updates.hostShotCompleted =
                                        event.host_shot_count ??
                                        event.host_shot_completed ??
                                        prev.hostShotCount ??
                                        prev.hostShotCompleted;
                                }
                            } else if (isMusicSubStage) {
                                updates.message = event.message
                                    ? `🎼 ${event.message}`
                                    : `🎼 ${sub.replace(/_/g, ' ')}`;
                                updates.musicSubStage = sub;
                                if (typeof event.segment_total === 'number') {
                                    updates.musicSegmentsTotal = event.segment_total;
                                }
                                if (typeof event.segment_index === 'number') {
                                    // segment_index is 0-based; +1 reads as "segment N of M".
                                    updates.musicSegmentsCompleted = event.segment_index + 1;
                                }
                                if (sub === 'background_music_done') {
                                    updates.musicDone = true;
                                    if (typeof event.url === 'string') {
                                        updates.musicUrl = event.url;
                                    }
                                    if (
                                        prev.musicSegmentsTotal &&
                                        (prev.musicSegmentsCompleted ?? 0) < prev.musicSegmentsTotal
                                    ) {
                                        updates.musicSegmentsCompleted = prev.musicSegmentsTotal;
                                    }
                                }
                            } else if (event.message) {
                                updates.message = event.message;
                            }
                            // Per-shot avatar failure → record into recentErrors.
                            if (sub === 'avatar_failed') {
                                const failIdx =
                                    typeof event.shot_index === 'number' ? event.shot_index : -1;
                                const failErr =
                                    typeof event.error === 'string'
                                        ? event.error
                                        : 'fal.ai render failed';
                                const existing = prev.recentErrors ?? [];
                                updates.recentErrors = [
                                    ...existing,
                                    {
                                        shot_index: failIdx,
                                        shot_type: 'AVATAR',
                                        error: failErr,
                                        retrying: false,
                                    },
                                ].slice(-RECENT_ERRORS_CAP);
                            }
                            // director_done (v2) carries shot_count and shot_plan
                            // and marks the boundary into the HTML stage. v3
                            // shot_planning_done / narration_writing_done also
                            // carry these fields but stay in SCRIPT — handled
                            // in their own branches above, so we explicitly
                            // skip the v2-style HTML promotion for them.
                            const isV3PlanningSubStage =
                                isShotPlannerSubStage || isNarrationWriterSubStage;
                            if (event.shot_count != null && !isV3PlanningSubStage) {
                                updates.shotsTotal = event.shot_count;
                                updates.stage = 'HTML';
                                updates.percentage = computeHtmlPercentage(
                                    prev.shotsCompleted,
                                    event.shot_count
                                );
                            }
                            if (event.shot_plan && !isV3PlanningSubStage) {
                                updates.shotPlan = event.shot_plan;
                            }
                            return { ...prev, ...updates };
                        });
                    } else if (event.type === 'shot_done') {
                        const shotMsg = event.total_shots
                            ? t('progressMessages.generatingVisualsShot', {
                                  completed: event.shot_index + 1,
                                  total: event.total_shots,
                              })
                            : event.message || t('progressMessages.generatingVisuals');
                        setCurrentGeneration((prev) => {
                            if (!prev) return null;
                            const completed = (event.shot_index ?? 0) + 1;
                            const total = event.total_shots ?? prev.shotsTotal;
                            return {
                                ...prev,
                                stage: 'HTML',
                                percentage: computeHtmlPercentage(completed, total),
                                message: shotMsg,
                                shotsCompleted: completed,
                                shotsTotal: total,
                                cumulativeTokens: event.cumulative_tokens ?? prev.cumulativeTokens,
                                eventLog: appendEventLog(prev.eventLog, {
                                    tsMs: Date.now() - genStartMs,
                                    eventType: 'shot_done',
                                    shotIndex: event.shot_index,
                                    message: event.shot_type
                                        ? `shot ${event.shot_index} · ${event.shot_type}`
                                        : `shot ${event.shot_index} wrapped`,
                                    tokenDelta: event.token_delta
                                        ? {
                                              prompt_tokens: event.token_delta.prompt_tokens,
                                              completion_tokens:
                                                  event.token_delta.completion_tokens,
                                              estimated_cost_usd:
                                                  event.token_delta.estimated_cost_usd,
                                          }
                                        : undefined,
                                }),
                            };
                        });
                    } else if (event.type === 'shot_error') {
                        const errEntry = {
                            shot_index: event.shot_index,
                            shot_type: event.shot_type,
                            error: event.error || '',
                            retrying: event.retrying,
                        };
                        setCurrentGeneration((prev) => {
                            if (!prev) return null;
                            const existing = prev.recentErrors ?? [];
                            return {
                                ...prev,
                                message:
                                    event.retrying && event.message ? event.message : prev.message,
                                recentErrors: [...existing, errEntry].slice(-RECENT_ERRORS_CAP),
                                eventLog: appendEventLog(prev.eventLog, {
                                    tsMs: Date.now() - genStartMs,
                                    eventType: 'shot_error',
                                    shotIndex: event.shot_index,
                                    error: event.error || '',
                                    message: event.retrying ? 'retrying' : 'permanent failure',
                                }),
                            };
                        });
                    } else if (event.type === 'cancelled') {
                        // BE acknowledged the stop (this fires for either:
                        // a) the user's own Stop click — handleAbort already
                        //    tore down local state, so this is a no-op echo,
                        // or b) a sibling tab watching the same generation
                        //    that needs to update its UI when the cancel was
                        //    initiated elsewhere). Idempotent state cleanup.
                        localStorage.removeItem(PENDING_GENERATION_KEY);
                        setCurrentGeneration(null);
                        setConsoleState('idle');
                        updateHistoryState({
                            id: videoId,
                            video_id: videoId,
                            prompt: request.prompt,
                            content_type: contentType,
                            status: 'failed', // history sidebar lacks a 'cancelled' status
                            stage: 'PENDING',
                            created_at: new Date().toISOString(),
                            options: pendingOptions,
                        });
                    } else if (event.type === 'error') {
                        // Use the ref so we read the *latest* state (the closure value
                        // is stale by the time SSE error events arrive). If we already
                        // have html+audio, we keep the player on screen; the
                        // auto-complete useEffect picks up the htmlUrl and transitions.
                        const errorStage = event.stage;
                        const cg = currentGenerationRef.current;
                        const recoverable =
                            errorStage === 'HTML' &&
                            !!cg?.htmlUrl &&
                            (!!cg.audioUrl || !needsAudio(contentType));

                        localStorage.removeItem(PENDING_GENERATION_KEY);
                        if (recoverable) {
                            toast.error(t('toasts.generationIssueRecoverable'));
                            setCurrentGeneration((prev) =>
                                prev
                                    ? {
                                          ...prev,
                                          message: t('progressMessages.generationCompletedWithIssues'),
                                      }
                                    : null
                            );
                        } else {
                            toast.error(event.message || t('toasts.generationFailed'));
                            setCurrentGeneration(null);
                            setConsoleState('idle');
                        }

                        updateHistoryState({
                            id: videoId,
                            video_id: videoId,
                            prompt: request.prompt,
                            content_type: contentType,
                            status: recoverable ? 'completed' : 'failed',
                            stage: errorStage || 'PENDING',
                            created_at: new Date().toISOString(),
                            options: pendingOptions,
                        });
                    }
                },
                (error) => {
                    // Terminal errors (the BE never started the pipeline) → clean key,
                    // go idle. The pipeline will not be running, so polling can't recover.
                    if (
                        error.name === 'InsufficientCreditsError' ||
                        error.name === 'RateLimitError'
                    ) {
                        localStorage.removeItem(PENDING_GENERATION_KEY);
                        if (error.name === 'InsufficientCreditsError') {
                            toast.error(error.message || t('toasts.insufficientCredits'), {
                                description: t('toasts.insufficientCreditsDescription'),
                                duration: 8000,
                            });
                        } else {
                            toast.error(error.message || t('toasts.rateLimitExceeded'), {
                                description: t('toasts.rateLimitDescription'),
                                duration: 8000,
                            });
                        }
                        setConsoleState('idle');
                        setCurrentGeneration(null);
                        return;
                    }

                    // Transient error (network drop, mid-stream EOF, proxy timeout).
                    // The BE background task continues — keep PENDING_GENERATION_KEY
                    // and fall back to /status + /urls polling so the UI recovers.
                    toast.error(t('toasts.connectionLost'), {
                        description: error.message,
                        duration: 5000,
                    });
                    const pendingRaw = localStorage.getItem(PENDING_GENERATION_KEY);
                    if (pendingRaw && activeApiKey) {
                        try {
                            const pending = JSON.parse(pendingRaw) as PendingGeneration;
                            startPollingForVideo(pending, activeApiKey);
                            return;
                        } catch {
                            localStorage.removeItem(PENDING_GENERATION_KEY);
                        }
                    }
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                },
                undefined,
                t
            );

            abortRef.current = abort;

            // Persist so polling can resume if the user navigates away or SSE drops.
            localStorage.setItem(
                PENDING_GENERATION_KEY,
                JSON.stringify({
                    videoId,
                    prompt: request.prompt,
                    contentType,
                    options: pendingOptions,
                    targetStage: finalRequest.target_stage || 'HTML',
                } satisfies PendingGeneration)
            );

            // Initialize generation state
            setCurrentGeneration({
                videoId,
                prompt: request.prompt,
                contentType,
                orientation:
                    request.orientation || (options.orientation as VideoOrientation) || 'landscape',
                stage: 'PENDING',
                percentage: 0,
                message: t('progressMessages.startingGeneration'),
                options: pendingOptions,
            });

            // Save initial history entry
            updateHistoryState({
                id: videoId,
                video_id: videoId,
                prompt: request.prompt,
                content_type: contentType,
                status: 'pending',
                stage: 'PENDING',
                created_at: new Date().toISOString(),
                options: pendingOptions,
            });
        },
        // currentGeneration intentionally omitted from deps — the closure reads it
        // only inside async callbacks where staleness is acceptable; including it
        // would cause every progress event to trigger a re-render of the consumer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [activeApiKey, reviewModeEnabled, options.orientation, startPollingForVideo]
    );

    const handleSelectHistory = useCallback(
        async (item: HistoryItem) => {
            setSelectedHistoryId(item.video_id);

            // Pre-fill the form's visual_preferences sliders from this past
            // run so "make a similar one" is one click away. Narrow merge —
            // we deliberately do NOT bulldoze the rest of the in-progress
            // form (orientation, voice, prompt, attachments, …) so the user
            // can browse history without losing what they were composing.
            // When the past run had no preference set, we clear the sliders
            // back to the all-auto state.
            const itemPrefs = item.options?.visual_preferences;
            setOptions((prev) =>
                itemPrefs
                    ? { ...prev, visual_preferences: itemPrefs }
                    : (() => {
                          if (!prev.visual_preferences) return prev;
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { visual_preferences: _drop, ...rest } = prev;
                          return rest;
                      })()
            );

            // If we have URLs locally, use them directly
            if (item.html_url && (item.audio_url || !needsAudio(item.content_type))) {
                setCurrentGeneration({
                    videoId: item.video_id,
                    prompt: item.prompt,
                    contentType: item.content_type || 'VIDEO',
                    orientation: (item.options?.orientation as VideoOrientation) || 'landscape',
                    stage: item.stage,
                    percentage: 100,
                    message: '',
                    htmlUrl: item.html_url,
                    audioUrl: item.audio_url,
                    wordsUrl: item.words_url,
                    videoMp4Url: item.video_url,
                    options: item.options,
                    tokenUsage: item.token_usage ?? null,
                });
                setConsoleState('complete');
                return;
            }

            // If completed but no URLs locally, try to fetch from API
            if (
                (item.status === 'completed' || item.stage === 'HTML' || item.stage === 'RENDER') &&
                activeApiKey
            ) {
                setIsLoadingVideoUrls(true);
                setConsoleState('idle');
                setCurrentGeneration(null);

                try {
                    const urls = await getVideoUrls(item.video_id, activeApiKey);

                    // Handle terminal failure / stalled states immediately
                    if (urls.status === 'FAILED' || urls.status === 'STALLED') {
                        setIsLoadingVideoUrls(false);
                        setConsoleState('idle');
                        setCurrentGeneration(null);
                        toast.error(
                            urls.error_message ||
                                t(
                                    urls.status === 'STALLED'
                                        ? 'toasts.generationStalledAtStep'
                                        : 'toasts.generationFailedAtStep',
                                    { stage: friendlyStage(urls.current_stage, t) }
                                )
                        );
                        return;
                    }

                    // Backend can return status=COMPLETED with null URLs when the job
                    // finished at a mid-stage (e.g. current_stage=SCRIPT). Only show the
                    // player when the required URLs are actually present.
                    if (!urls.html_url || (!urls.audio_url && needsAudio(item.content_type))) {
                        setIsLoadingVideoUrls(false);
                        // COMPLETED + pre-HTML stage = pipeline transitioning, not stopped.
                        // COMPLETED + HTML+ stage with no html_url = truly stopped early.
                        const PRE_HTML_STAGES = new Set([
                            'PENDING',
                            'SCRIPT',
                            'TTS',
                            'AUDIO',
                            'WORDS',
                        ]);
                        const stoppedEarly =
                            urls.status === 'COMPLETED' && !PRE_HTML_STAGES.has(urls.current_stage);
                        if (stoppedEarly) {
                            toast.error(
                                urls.error_message ||
                                    t('toasts.generationStoppedAtStep', {
                                        stage: friendlyStage(urls.current_stage, t),
                                    })
                            );
                            setConsoleState('idle');
                            setCurrentGeneration(null);
                            return;
                        }
                        // Still generating (IN_PROGRESS or COMPLETED at a transitioning stage) — start polling
                        toast.info(t('toasts.stillGenerating'));
                        startPollingForVideo(
                            {
                                videoId: item.video_id,
                                prompt: item.prompt,
                                contentType: item.content_type || 'VIDEO',
                                options: item.options,
                            },
                            activeApiKey
                        );
                        return;
                    }

                    // Update history with fetched URLs
                    const updatedItem: HistoryItem = {
                        ...item,
                        html_url: urls.html_url,
                        audio_url: urls.audio_url ?? undefined,
                        words_url: urls.words_url ?? undefined,
                        video_url: urls.video_url ?? undefined,
                        status: 'completed',
                    };

                    setHistory((prev) =>
                        prev.map((h) => (h.video_id === item.video_id ? updatedItem : h))
                    );

                    setCurrentGeneration({
                        videoId: item.video_id,
                        prompt: item.prompt,
                        contentType: item.content_type || 'VIDEO',
                        orientation: (item.options?.orientation as VideoOrientation) || 'landscape',
                        stage: urls.current_stage || item.stage,
                        percentage: 100,
                        message: '',
                        htmlUrl: urls.html_url,
                        audioUrl: urls.audio_url ?? undefined,
                        wordsUrl: urls.words_url ?? undefined,
                        videoMp4Url: urls.video_url ?? undefined,
                        options: item.options,
                        tokenUsage: item.token_usage ?? null,
                    });
                    setConsoleState('complete');
                    toast.success(t('toasts.contentLoaded'));
                } catch (error) {
                    console.error('Failed to fetch content URLs:', error);
                    toast.error(t('toasts.loadDetailsFailed'));
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                } finally {
                    setIsLoadingVideoUrls(false);
                }
                return;
            }

            // For pending/generating items: start polling so the UI stays alive
            if ((item.status === 'generating' || item.status === 'pending') && activeApiKey) {
                startPollingForVideo(
                    {
                        videoId: item.video_id,
                        prompt: item.prompt,
                        contentType: item.content_type || 'VIDEO',
                        options: item.options,
                    },
                    activeApiKey
                );
                return;
            }

            // Failed items with no content to show — give the user a clear hint
            // that the row was clicked and explain why nothing rendered.
            setConsoleState('idle');
            setCurrentGeneration(null);
            if (item.status === 'failed') {
                toast.error(t('toasts.retryFromRowHint'));
            }
        },
        [activeApiKey, startPollingForVideo, t]
    );

    // Deep-link prefill: when the parent passes `initialVideoId` (e.g. vim's
    // Recent → production view flow), load that video's URLs/status as soon as
    // the API key is ready. Reuses handleSelectHistory's existing fetch path —
    // it falls into the COMPLETED branch and ends up in `consoleState='complete'`
    // rendering PipelineLayout. Tracked via a ref so a re-render with the same
    // id doesn't re-trigger the fetch.
    const prefilledVideoIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!initialVideoId || !activeApiKey) return;
        if (prefilledVideoIdRef.current === initialVideoId) return;
        prefilledVideoIdRef.current = initialVideoId;
        // `options` must be non-null — derivePipelineFromLive reads
        // `cg.options.routing_overrides` (and friends) without optional chaining.
        // A real history item would carry these from generate-time; the stub
        // is a minimal placeholder until handleSelectHistory swaps in fetched data.
        const stub: HistoryItem = {
            id: initialVideoId,
            video_id: initialVideoId,
            status: 'completed',
            stage: 'HTML',
            prompt: '',
            content_type: 'VIDEO',
            created_at: '',
            options: { ...DEFAULT_OPTIONS },
        };
        handleSelectHistory(stub);
    }, [initialVideoId, activeApiKey, handleSelectHistory]);

    const handleDeleteHistory = useCallback(
        (videoId: string) => {
            // Optimistically remove from UI
            setHistory((prev) => prev.filter((h) => h.video_id !== videoId));

            if (videoId === selectedHistoryId) {
                setSelectedHistoryId(null);
                setCurrentGeneration(null);
                setConsoleState('idle');
            }
        },
        [selectedHistoryId]
    );

    const handleNewVideo = useCallback(() => {
        // If a generation is in flight, also cancel it server-side. Otherwise
        // the backend would keep running (and charging) after the user moved
        // on. Fire-and-forget — UI teardown happens regardless.
        const vid = currentGeneration?.videoId;
        if (vid && activeApiKey && consoleState === 'generating') {
            void cancelGeneration(vid, activeApiKey).catch(() => {
                /* swallow — user already moved on */
            });
        }
        if (abortRef.current) {
            abortRef.current();
            abortRef.current = null;
        }
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
        localStorage.removeItem(PENDING_GENERATION_KEY);
        setSelectedHistoryId(null);
        setCurrentGeneration(null);
        setReviewScript('');
        // Clear composer context so the next generation starts clean.
        setAttachments((prev) => {
            for (const a of prev) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
            return [];
        });
        setSelectedInputVideoIds([]);
        setIgnoredUrls(new Set());
        setRoutingOverrides({});
        setConsoleState('idle');
    }, [currentGeneration, activeApiKey, consoleState]);

    /**
     * Cancel an in-flight production from the pipeline panel.
     *
     * Three things happen here:
     *   1. POST /cancel/{video_id} — server-side: signals the pipeline to
     *      stop at its next safe checkpoint, marks the video CANCELLED, and
     *      refunds all credits charged so far. This is fire-and-forget from
     *      the UI's perspective; we move on without awaiting it.
     *   2. Local SSE abort + polling teardown so the UI flips immediately.
     *   3. Clear the persisted pending key + composer state.
     *
     * Composer context (prompt, attachments, routing) is preserved so the
     * user can re-submit with tweaks rather than starting from blank.
     */
    const handleAbort = useCallback(() => {
        const vid = currentGeneration?.videoId;
        // Fire the BE cancel without blocking the UI teardown. Toast on
        // success/failure separately so user gets confirmation that credits
        // were actually refunded server-side.
        if (vid && activeApiKey) {
            void cancelGeneration(vid, activeApiKey)
                .then((res) => {
                    if (res.stopped) {
                        toast.success(t('toasts.generationStoppedRefunded'));
                    } else {
                        toast.info(
                            t('toasts.alreadyStatusNothingToRefund', {
                                status: res.status.toLowerCase(),
                            })
                        );
                    }
                })
                .catch((err: unknown) => {
                    toast.error(
                        err instanceof Error
                            ? t('toasts.stopFailedWithMessage', { message: err.message })
                            : t('toasts.stopFailedGeneric')
                    );
                });
        }
        if (abortRef.current) {
            abortRef.current();
            abortRef.current = null;
        }
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
        }
        localStorage.removeItem(PENDING_GENERATION_KEY);
        setSelectedHistoryId(null);
        setCurrentGeneration(null);
        setReviewScript('');
        setConsoleState('idle');
    }, [currentGeneration, activeApiKey, t]);

    // Assist mode: answer the pending decision and resume the next leg.
    const handleSubmitDecision = useCallback(
        (answer: DecisionAnswer) => {
            const cg = currentGenerationRef.current;
            if (!activeApiKey || !cg?.pendingDecision) return;
            const resolved = cg.pendingDecision;
            const resumeVideoId = cg.videoId;

            // Append the resolved turn, clear the pending decision, flip back to
            // generating (the next gate's decision_required re-enters assisting).
            const turn: AssistTurn = {
                decision_id: resolved.decision_id,
                gate_type: resolved.gate_type,
                prompt: resolved.prompt,
                answer_summary: buildTurnSummary(resolved, answer, t),
                answered_at: Date.now(),
            };
            setCurrentGeneration((prev) =>
                prev
                    ? {
                          ...prev,
                          pendingDecision: null,
                          assistTranscript: [...(prev.assistTranscript ?? []), turn],
                      }
                    : prev
            );
            setIsSubmittingDecision(true);
            setConsoleState('generating');

            const { abort } = submitDecision(
                resumeVideoId,
                resolved.decision_id,
                resolved.gate_type,
                answer,
                activeApiKey,
                (event: SSEEvent) => {
                    if (event.type === 'decision_required') {
                        const next = event;
                        setIsSubmittingDecision(false);
                        setCurrentGeneration((prev) =>
                            prev ? { ...prev, pendingDecision: next, message: next.prompt } : prev
                        );
                    } else if (event.type === 'progress') {
                        setIsSubmittingDecision(false);
                        const audioUrl = event.files?.audio?.s3_url;
                        const wordsUrl = event.files?.words?.s3_url;
                        const scriptUrl = event.files?.script?.s3_url;
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: event.stage,
                                      percentage: event.percentage,
                                      message: event.message,
                                      // Do NOT set htmlUrl from a mid-leg progress event: the
                                      // auto-complete effect flips to "ready" as soon as htmlUrl
                                      // is present, so a progress-event timeline URL would mark a
                                      // still-running (and possibly about-to-fail) leg complete.
                                      // Only the terminal `completed` event sets the final timeline.
                                      audioUrl: audioUrl || prev.audioUrl,
                                      wordsUrl: wordsUrl || prev.wordsUrl,
                                      scriptUrl: scriptUrl || prev.scriptUrl,
                                  }
                                : null
                        );
                    } else if (event.type === 'sub_stage') {
                        setCurrentGeneration((prev) =>
                            prev ? { ...prev, message: event.message || prev.message } : prev
                        );
                    } else if (event.type === 'shot_done') {
                        setCurrentGeneration((prev) => {
                            if (!prev) return null;
                            const completed = (event.shot_index ?? 0) + 1;
                            const total = event.total_shots ?? prev.shotsTotal;
                            return {
                                ...prev,
                                stage: 'HTML',
                                percentage: computeHtmlPercentage(completed, total),
                                message: event.message || prev.message,
                                shotsCompleted: completed,
                                shotsTotal: total,
                                cumulativeTokens: event.cumulative_tokens ?? prev.cumulativeTokens,
                            };
                        });
                    } else if (event.type === 'completed') {
                        setIsSubmittingDecision(false);
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: 'HTML',
                                      percentage: 100,
                                      pendingDecision: null,
                                      htmlUrl: prev.htmlUrl || event.files?.timeline,
                                      audioUrl: prev.audioUrl || event.files?.audio,
                                      wordsUrl: prev.wordsUrl || event.files?.words,
                                  }
                                : null
                        );
                        setHistory((prev) =>
                            prev.map((h) =>
                                h.video_id === resumeVideoId
                                    ? { ...h, status: 'completed', stage: 'HTML' }
                                    : h
                            )
                        );
                    } else if (event.type === 'error') {
                        setIsSubmittingDecision(false);
                        toast.error(event.message || t('toasts.generationFailed'));
                        setConsoleState('idle');
                        setCurrentGeneration(null);
                        // A failed leg must never linger as a "complete" video — clear
                        // any persisted completion so it can't resurrect on reload.
                        localStorage.removeItem(COMPLETE_GENERATION_KEY);
                    }
                },
                (error) => {
                    setIsSubmittingDecision(false);
                    if (error.name === 'InsufficientCreditsError') {
                        toast.error(error.message);
                    } else {
                        toast.error(t('toasts.couldNotContinue', { message: error.message }));
                    }
                    // Re-surface the decision so the user can retry.
                    setCurrentGeneration((prev) =>
                        prev ? { ...prev, pendingDecision: resolved } : prev
                    );
                    setConsoleState('assisting');
                },
                t
            );
            abortRef.current = abort;
        },
        [activeApiKey, t]
    );

    // Reset the post-completion editor whenever a different video takes the stage.
    useEffect(() => {
        setPostEdits([]);
        setPlayerReloadKey(0);
        setCastSaved(false);
    }, [currentGeneration?.videoId]);

    /** Post-completion conversational editor: parse "shot N" from the message,
     *  regenerate that frame's HTML with the note (existing /frame/regenerate),
     *  persist via /frame/update, and refresh the inline player. */
    const handlePostEdit = useCallback(
        async (text: string) => {
            const cg = currentGenerationRef.current;
            if (!cg?.videoId || !activeApiKey || !cg.htmlUrl) return;
            const id = `pe_${Date.now()}`;
            setPostEdits((prev) => [...prev, { id, request: text, reply: '', busy: true }]);
            const finish = (reply: string) =>
                setPostEdits((prev) =>
                    prev.map((p) => (p.id === id ? { ...p, busy: false, reply } : p))
                );
            try {
                const m = text.match(/shot\s*#?\s*(\d+)/i);
                if (!m) {
                    finish(t('postEdit.askWhichShot'));
                    return;
                }
                const shotNum = parseInt(m[1] ?? '0', 10);
                const resp = await fetch(cg.htmlUrl);
                const data = await resp.json();
                const entries: Array<Record<string, unknown>> = Array.isArray(data)
                    ? data
                    : (data?.entries ?? []);
                const content = entries.filter(
                    (e) => !String(e.id ?? '').startsWith('branding-')
                );
                // Prefer the entry's own shot index — array position drifts
                // when overlay entries (lower-thirds) or sub-shots exist.
                const entry =
                    content.find((e) => Number(e.index) === shotNum - 1) ??
                    content[shotNum - 1];
                if (!entry) {
                    finish(
                        t('postEdit.shotNotFound', { shotNum, count: content.length })
                    );
                    return;
                }
                const ts = Number(entry.inTime ?? entry.start ?? 0) + 0.05;
                const regen = await regenerateFrame(cg.videoId, activeApiKey, ts, text);
                await updateFrame(cg.videoId, activeApiKey, regen.frame_index, regen.new_html, {
                    htmlModel: regen.resolved_model ?? undefined,
                });
                setPlayerReloadKey((k) => k + 1);
                finish(t('postEdit.shotUpdated', { shotNum }));
            } catch (err) {
                finish(
                    err instanceof Error
                        ? t('postEdit.shotUpdateFailed', { message: err.message })
                        : t('postEdit.shotUpdateFailedGeneric')
                );
            }
        },
        [activeApiKey, t]
    );

    /** Save this run's dialogue cast (characters + portraits + voices) for
     *  reuse in the next video of the series. One-click; auto-named. */
    const handleSaveCast = useCallback(async () => {
        const cg = currentGenerationRef.current;
        if (!cg?.videoId || !activeApiKey) return;
        try {
            const cast = await saveCastFromVideo(cg.videoId, activeApiKey);
            toast.success(t('toasts.castSaved', { name: cast.name }));
            setCastSaved(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('toasts.castSaveFailed'));
        }
    }, [activeApiKey, t]);

    // Resume generation after script review
    const handleResumeFromReview = useCallback(() => {
        if (!activeApiKey || !currentGeneration) return;

        // Capture values from currentGeneration before entering the closure
        const resumeVideoId = currentGeneration.videoId;
        const resumeOptions = currentGeneration.options;

        setConsoleState('generating');

        const { abort } = resumeVideo(
            {
                videoId: resumeVideoId,
                modifiedScript: reviewScript,
                targetStage: 'HTML',
                options: resumeOptions,
            },
            activeApiKey,
            (event: SSEEvent) => {
                if (event.type === 'progress') {
                    const audioUrl = event.files?.audio?.s3_url;
                    const timelineUrl = event.files?.timeline?.s3_url;
                    const wordsUrl = event.files?.words?.s3_url;
                    const scriptUrl = event.files?.script?.s3_url;

                    // Spread prev so per-shot/cumulative state survives stage transitions.
                    // Auto-complete useEffect handles consoleState=complete.
                    setCurrentGeneration((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  stage: event.stage,
                                  percentage: event.percentage,
                                  message: event.message,
                                  htmlUrl: timelineUrl || prev.htmlUrl,
                                  audioUrl: audioUrl || prev.audioUrl,
                                  wordsUrl: wordsUrl || prev.wordsUrl,
                                  scriptUrl: scriptUrl || prev.scriptUrl,
                              }
                            : null
                    );

                    setHistory((prev) =>
                        prev.map((h) =>
                            h.video_id === resumeVideoId
                                ? {
                                      ...h,
                                      status: 'generating' as const,
                                      stage: event.stage,
                                      html_url: timelineUrl || h.html_url,
                                      audio_url: audioUrl || h.audio_url,
                                      words_url: wordsUrl || h.words_url,
                                  }
                                : h
                        )
                    );
                } else if (event.type === 'completed') {
                    setCurrentGeneration((prev) =>
                        prev
                            ? {
                                  ...prev,
                                  stage: 'HTML',
                                  percentage: 100,
                                  htmlUrl: prev.htmlUrl || event.files?.timeline,
                                  audioUrl: prev.audioUrl || event.files?.audio,
                                  wordsUrl: prev.wordsUrl || event.files?.words,
                              }
                            : null
                    );
                    setHistory((prev) =>
                        prev.map((h) =>
                            h.video_id === resumeVideoId
                                ? { ...h, status: 'completed', stage: 'HTML' }
                                : h
                        )
                    );
                } else if (event.type === 'shot_done') {
                    const shotMsg = event.total_shots
                        ? t('progressMessages.generatingVisualsShot', {
                              completed: event.shot_index + 1,
                              total: event.total_shots,
                          })
                        : event.message || t('progressMessages.generatingVisuals');
                    setCurrentGeneration((prev) => {
                        if (!prev) return null;
                        const completed = (event.shot_index ?? 0) + 1;
                        const total = event.total_shots ?? prev.shotsTotal;
                        return {
                            ...prev,
                            stage: 'HTML',
                            percentage: computeHtmlPercentage(completed, total),
                            message: shotMsg,
                            shotsCompleted: completed,
                            shotsTotal: total,
                            cumulativeTokens: event.cumulative_tokens ?? prev.cumulativeTokens,
                        };
                    });
                } else if (event.type === 'error') {
                    toast.error(event.message || t('toasts.generationFailed'));
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                }
            },
            (error) => {
                toast.error(t('toasts.resumeFailed', { message: error.message }));
                setConsoleState('reviewing'); // go back to review state
            },
            t
        );

        abortRef.current = abort;
    }, [activeApiKey, currentGeneration, reviewScript, t]);

    const handleDiscardReview = useCallback(() => {
        setReviewScript('');
        setCurrentGeneration(null);
        setConsoleState('idle');
    }, []);

    // Retry a failed generation — resumes from last checkpoint via SSE stream
    const handleRetry = useCallback(
        (videoId: string) => {
            if (!activeApiKey) return;

            const failedItem = history.find((h) => h.video_id === videoId);
            setCurrentGeneration({
                videoId,
                prompt: failedItem?.prompt || '',
                stage: 'HTML',
                percentage: 0,
                message: t('progressMessages.resumingCheckpoint'),
                contentType: (failedItem?.content_type as ContentType) || 'VIDEO',
                options: failedItem?.options || DEFAULT_OPTIONS,
            });
            setConsoleState('generating');

            const { abort } = retryVideo(
                videoId,
                activeApiKey,
                (event: SSEEvent) => {
                    if (event.type === 'progress') {
                        const audioUrl = event.files?.audio?.s3_url;
                        const timelineUrl = event.files?.timeline?.s3_url;
                        const wordsUrl = event.files?.words?.s3_url;
                        const scriptUrl = event.files?.script?.s3_url;

                        // Auto-complete useEffect handles the consoleState transition.
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: event.stage,
                                      percentage: event.percentage,
                                      message: event.message,
                                      htmlUrl: timelineUrl || prev.htmlUrl,
                                      audioUrl: audioUrl || prev.audioUrl,
                                      wordsUrl: wordsUrl || prev.wordsUrl,
                                      scriptUrl: scriptUrl || prev.scriptUrl,
                                  }
                                : null
                        );
                        setHistory((prev) =>
                            prev.map((h) =>
                                h.video_id === videoId
                                    ? { ...h, status: 'generating' as const, stage: event.stage }
                                    : h
                            )
                        );
                    } else if (event.type === 'completed') {
                        setCurrentGeneration((prev) =>
                            prev
                                ? {
                                      ...prev,
                                      stage: 'HTML',
                                      percentage: 100,
                                      htmlUrl: prev.htmlUrl || event.files?.timeline,
                                      audioUrl: prev.audioUrl || event.files?.audio,
                                      wordsUrl: prev.wordsUrl || event.files?.words,
                                  }
                                : null
                        );
                        setHistory((prev) =>
                            prev.map((h) =>
                                h.video_id === videoId
                                    ? { ...h, status: 'completed', stage: 'HTML' }
                                    : h
                            )
                        );
                    } else if (event.type === 'shot_done') {
                        const shotMsg = event.total_shots
                            ? t('progressMessages.generatingVisualsShot', {
                                  completed: event.shot_index + 1,
                                  total: event.total_shots,
                              })
                            : event.message || t('progressMessages.generatingVisuals');
                        setCurrentGeneration((prev) => {
                            if (!prev) return null;
                            const completed = (event.shot_index ?? 0) + 1;
                            const total = event.total_shots ?? prev.shotsTotal;
                            return {
                                ...prev,
                                stage: 'HTML',
                                percentage: computeHtmlPercentage(completed, total),
                                message: shotMsg,
                                shotsCompleted: completed,
                                shotsTotal: total,
                                cumulativeTokens: event.cumulative_tokens ?? prev.cumulativeTokens,
                            };
                        });
                    } else if (event.type === 'error') {
                        toast.error(event.message || t('toasts.retryFailed'));
                        setConsoleState('idle');
                        setCurrentGeneration(null);
                        setHistory((prev) =>
                            prev.map((h) =>
                                h.video_id === videoId ? { ...h, status: 'failed' as const } : h
                            )
                        );
                    }
                },
                (error) => {
                    toast.error(t('toasts.retryFailedWithMessage', { message: error.message }));
                    setConsoleState('idle');
                    setCurrentGeneration(null);
                },
                t
            );

            abortRef.current = abort;
        },
        [activeApiKey, history, t]
    );

    // No API keys or no stored full key - redirect to main page
    const hasActiveKeys = apiKeys.filter((k) => k.status === 'active').length > 0;

    if (isAutoGenerating) {
        return (
            <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4" /* design-lint-ignore: viewport-relative floor for full-page empty/loading state, no token matches 60vh */>
                <CircleNotch className="size-12 animate-spin text-violet-600" />
                <p className="text-muted-foreground">{t('setupScreen.settingUp')}</p>
            </div>
        );
    }

    if (!isLoadingKeys && (!hasActiveKeys || !activeApiKey)) {
        return (
            <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4" /* design-lint-ignore: viewport-relative floor for full-page empty/loading state, no token matches 60vh */>
                <div className="text-center">
                    <Video className="mx-auto mb-4 size-16 text-muted-foreground" />
                    <h1 className="mb-2 text-2xl font-bold">
                        {!hasActiveKeys
                            ? t('noKeyScreen.noKeysTitle')
                            : t('noKeyScreen.keyUnavailableTitle')}
                    </h1>
                    <p className="mb-6 text-muted-foreground">
                        {!hasActiveKeys
                            ? t('noKeyScreen.noKeysDescription')
                            : t('noKeyScreen.keyUnavailableDescription')}
                    </p>
                    <Button onClick={() => window.history.back()}>
                        {t('noKeyScreen.goToApiStudio')}
                    </Button>
                </div>
            </div>
        );
    }

    const isGenerating = consoleState === 'generating';

    return (
        <div className="relative flex size-full overflow-hidden bg-background">
            {/* Mobile History Drawer */}
            {showHistorySidebar && (
                <Sheet open={isMobileHistoryOpen} onOpenChange={setIsMobileHistoryOpen}>
                    <SheetContent side="left" className="w-72 p-0">
                        <SheetTitle className="sr-only">{t('history.sheetTitle')}</SheetTitle>
                        <HistorySidebar
                            history={history}
                            selectedId={selectedHistoryId}
                            onSelect={(item) => {
                                handleSelectHistory(item);
                                setIsMobileHistoryOpen(false);
                            }}
                            onDelete={handleDeleteHistory}
                            onRetry={handleRetry}
                            onNewVideo={() => {
                                handleNewVideo();
                                setIsMobileHistoryOpen(false);
                            }}
                            isCollapsed={false}
                            onToggleCollapse={() => setIsMobileHistoryOpen(false)}
                            currentPage={historyPage}
                            totalPages={historyTotalPages}
                            onPageChange={handlePageChange}
                            isLoadingHistory={isLoadingHistory}
                        />
                    </SheetContent>
                </Sheet>
            )}

            {/* Collapsible History Sidebar (desktop only) */}
            {showHistorySidebar && (
                <div
                    className="hidden shrink-0 flex-col border-r bg-white dark:bg-card md:flex"
                    style={{
                        width: isSidebarOpen ? 280 : 48,
                        transition: 'width 0.25s ease',
                        overflow: 'hidden',
                    }}
                >
                    <HistorySidebar
                        history={history}
                        selectedId={selectedHistoryId}
                        onSelect={handleSelectHistory}
                        onDelete={handleDeleteHistory}
                        onRetry={handleRetry}
                        onNewVideo={handleNewVideo}
                        isCollapsed={!isSidebarOpen}
                        onToggleCollapse={() => setIsSidebarOpen((prev) => !prev)}
                        currentPage={historyPage}
                        totalPages={historyTotalPages}
                        onPageChange={handlePageChange}
                        isLoadingHistory={isLoadingHistory}
                    />
                </div>
            )}

            {/* Main Content */}
            <div className="flex min-w-0 flex-1 flex-col bg-secondary/10">
                {/* Mobile: History access button (shown only on mobile, hidden on md+) */}
                {showHistorySidebar && history.length > 0 && (
                    <div className="flex items-center border-b px-3 py-1.5 md:hidden">
                        <button
                            onClick={() => setIsMobileHistoryOpen(true)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <HistoryIcon className="size-3.5" />
                            {t('history.buttonLabel', { count: history.length })}
                        </button>
                    </div>
                )}

                {/* Content Area */}
                <div className="pb-keyboard scroll-pb-keyboard flex-1 overflow-y-auto overflow-x-hidden scroll-smooth p-2 sm:p-3">
                    {consoleState === 'idle' && !currentGeneration && !isLoadingVideoUrls && (
                        <div className="duration-200 animate-in fade-in zoom-in-95">
                            <CenteredHero
                                composer={
                                  <div className="flex w-full flex-col items-center gap-3">
                                    <AssistModeToggle
                                        assistModeEnabled={assistModeEnabled}
                                        onAssistModeChange={setAssistModeEnabled}
                                        disabled={isGenerating}
                                    />
                                    <Composer
                                        onGenerate={handleGenerate}
                                        isGenerating={isGenerating}
                                        disabled={!activeApiKey}
                                        prompt={prompt}
                                        onPromptChange={setPrompt}
                                        options={options}
                                        onOptionsChange={setOptions}
                                        reviewModeEnabled={reviewModeEnabled}
                                        onReviewModeChange={setReviewModeEnabled}
                                        apiKey={activeApiKey}
                                        variant="hero"
                                        attachments={attachments}
                                        onAttachmentsChange={setAttachments}
                                        selectedInputVideoIds={selectedInputVideoIds}
                                        onSelectedInputVideoIdsChange={setSelectedInputVideoIds}
                                        inputVideoAudio={inputVideoAudio}
                                        onInputVideoAudioChange={setInputVideoAudio}
                                        muteTtsDuringSourceClips={muteTtsDuringSourceClips}
                                        onMuteTtsDuringSourceClipsChange={
                                            setMuteTtsDuringSourceClips
                                        }
                                        ignoredUrls={ignoredUrls}
                                        onIgnoredUrlsChange={setIgnoredUrls}
                                        routingOverrides={routingOverrides}
                                        onRoutingOverridesChange={setRoutingOverrides}
                                        vimMode={vimMode}
                                    />
                                  </div>
                                }
                                intentChips={
                                    <IntentChips
                                        selected={options.content_type || 'VIDEO'}
                                        onSelect={(type) =>
                                            setOptions(
                                                (prev: Omit<GenerateVideoRequest, 'prompt'>) => ({
                                                    ...prev,
                                                    content_type: type,
                                                })
                                            )
                                        }
                                        onSamplePromptSelect={(p) => setPrompt(p)}
                                    />
                                }
                            />
                        </div>
                    )}

                    {isLoadingVideoUrls && (
                        <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center duration-300 animate-in fade-in">
                            <div className="relative">
                                <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-2xl" />
                                <div className="relative rounded-2xl border border-violet-100/50 bg-gradient-to-br from-violet-100 to-indigo-50 p-6 shadow-sm">
                                    <CircleNotch className="size-12 animate-spin text-violet-600" />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <h2 className="text-lg font-semibold text-foreground">
                                    {t('loadingVideoScreen.title')}
                                </h2>
                                <p className="text-sm text-muted-foreground">
                                    {t('loadingVideoScreen.description')}
                                </p>
                            </div>
                        </div>
                    )}

                    {consoleState === 'reviewing' && currentGeneration && (
                        <ScriptReview
                            script={reviewScript}
                            prompt={currentGeneration.prompt}
                            onScriptChange={setReviewScript}
                            onResume={handleResumeFromReview}
                            onDiscard={handleDiscardReview}
                        />
                    )}

                    {/* The conversation is the ONE surface for the whole
                        lifecycle in both Auto and Assist — status while working,
                        decision cards at gates (Assist only), the finished video
                        at the end. The production diagram is an optional drawer
                        behind "Show progress". */}
                    {(consoleState === 'generating' ||
                        consoleState === 'assisting' ||
                        consoleState === 'complete') &&
                        currentGeneration && (
                            <div className="h-full">
                                <AssistChat
                                    prompt={currentGeneration.prompt}
                                    pending={currentGeneration.pendingDecision ?? null}
                                    transcript={currentGeneration.assistTranscript ?? []}
                                    isSubmitting={isSubmittingDecision}
                                    statusMessage={currentGeneration.message}
                                    percentage={currentGeneration.percentage}
                                    shotsCompleted={currentGeneration.shotsCompleted}
                                    shotsTotal={currentGeneration.shotsTotal}
                                    stages={assistStageRows}
                                    isComplete={consoleState === 'complete'}
                                    timelineUrl={currentGeneration.htmlUrl}
                                    audioUrl={currentGeneration.audioUrl}
                                    wordsUrl={currentGeneration.wordsUrl}
                                    orientation={currentGeneration.orientation}
                                    onSubmit={handleSubmitDecision}
                                    onShowProgress={() => setShowAssistProgress(true)}
                                    apiKey={activeApiKey ?? undefined}
                                    onPostEdit={handlePostEdit}
                                    onSaveCast={
                                        currentGeneration.options?.dialogue_scenes_enabled && !castSaved
                                            ? handleSaveCast
                                            : undefined
                                    }
                                    postEdits={postEdits}
                                    playerReloadKey={playerReloadKey}
                                    onAbort={
                                        consoleState !== 'complete' ? handleAbort : undefined
                                    }
                                    onEdit={
                                        onEdit && currentGeneration.htmlUrl && activeApiKey
                                            ? () =>
                                                  onEdit({
                                                      videoId: currentGeneration.videoId,
                                                      htmlUrl: currentGeneration.htmlUrl!,
                                                      audioUrl: currentGeneration.audioUrl ?? '',
                                                      wordsUrl: currentGeneration.wordsUrl ?? '',
                                                      apiKey: activeApiKey,
                                                      orientation:
                                                          currentGeneration.orientation ??
                                                          'landscape',
                                                  })
                                            : undefined
                                    }
                                    vimMode={vimMode}
                                />
                            </div>
                        )}
                </div>

                {/* No docked Composer at the bottom while a video is in
                    production or being inspected. Starting a new
                    generation is intentionally a deliberate action — the
                    "New Video" button in the History sidebar is the
                    canonical entry point. Keeping the input here invited
                    accidental new runs while the user was still reading
                    through the current production. */}
            </div>

            {/* Assist mode: the production diagram in a side drawer (secondary
                "what's happening" view behind the chat). */}
            <Sheet open={showAssistProgress} onOpenChange={setShowAssistProgress}>
                <SheetContent side="right" className="w-full p-0 sm:max-w-3xl">
                    <SheetTitle className="sr-only">{t('productionProgress.sheetTitle')}</SheetTitle>
                    {currentGeneration && (
                        <div className="h-full overflow-hidden">
                            <PipelineLayout
                                state={derivePipelineFromLive(
                                    currentGeneration satisfies LiveCurrentGeneration,
                                    undefined,
                                    t
                                )}
                                apiKey={activeApiKey ?? undefined}
                                eventLog={currentGeneration.eventLog}
                            />
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
