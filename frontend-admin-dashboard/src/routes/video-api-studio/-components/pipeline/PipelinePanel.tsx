import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    CheckCircle,
    Code,
    Copy,
    Check,
    DownloadSimple,
    ArrowSquareOut,
    Link,
    CircleNotch,
    Pencil,
    ArrowsClockwise,
    Terminal,
    Lightning,
    Clock,
    FilmStrip,
    Warning,
    Octagon,
    X,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    clearRenderedVideo,
    getRenderStatus,
    requestVideoRender,
    type RenderSettings,
} from '../../-services/video-generation';
import { RenderSettingsDialog } from '../RenderSettingsDialog';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../../-utils/credits';
import type { PipelineEventLogEntry, PipelineState } from './-utils/derive-pipeline-state';
import { buildNodeLabels, type PipelineNodeId } from './-utils/stage-vocab';
import { ThumbnailPickerPanel } from './ThumbnailPickerPanel';
import { DeveloperAuditSheet } from './DeveloperAuditSheet';
import { useVideoStatus } from './-utils/use-video-status';
import { useTimelineJson } from './-utils/use-timeline-json';

// ─── Render-job persistence (lifted from VideoResult.tsx) ────────────────
const RENDER_JOB_KEY_PREFIX = 'render-job-';
const MAX_RENDER_AGE_MS = 90 * 60 * 1000;

function saveRenderJob(videoId: string, jobId: string) {
    const key = `${RENDER_JOB_KEY_PREFIX}${videoId}`;
    localStorage.setItem(key, JSON.stringify({ jobId, startedAt: Date.now() }));
}
function loadRenderJob(videoId: string): { jobId: string; startedAt: number } | null {
    try {
        const raw = localStorage.getItem(`${RENDER_JOB_KEY_PREFIX}${videoId}`);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Date.now() - data.startedAt > MAX_RENDER_AGE_MS) {
            clearRenderJob(videoId);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}
function clearRenderJob(videoId: string) {
    localStorage.removeItem(`${RENDER_JOB_KEY_PREFIX}${videoId}`);
}

type RenderState = 'idle' | 'submitting' | 'rendering' | 'done' | 'error';

interface PipelinePanelProps {
    state: PipelineState;
    apiKey?: string;
    /**
     * Live SSE event log — passed in from the parent so the Developer
     * audit drawer can show the chronological pathway. Absent on
     * history-loaded runs (drawer falls back to a synthesized path).
     */
    eventLog?: PipelineEventLogEntry[];
    /** Cancel an in-flight production (live runs only). Hides when omitted. */
    onAbort?: () => void;
    /** Retry a halted production. Hides when omitted. */
    onRetry?: () => void;
    /**
     * Override the default "Edit" navigation. Defaults to the admin route
     * (`/video-api-studio/edit/$videoId`); vim passes its own handler so the
     * user stays inside the vim shell at `/vim/edit/$videoId`.
     */
    onEdit?: (params: {
        videoId: string;
        htmlUrl: string;
        audioUrl: string;
        wordsUrl: string;
        apiKey: string;
        orientation: string;
    }) => void;
}

export function PipelinePanel({
    state,
    apiKey,
    eventLog,
    onAbort,
    onRetry,
    onEdit,
}: PipelinePanelProps) {
    const { videoId, status, contentType, orientation, artifactUrls, stats } = state;
    const { t } = useTranslation(['videoApiStudioPipelinePanel', 'videoApiStudioCredits']);
    // `stage-vocab` is a separate namespace — resolved explicitly via `t`'s
    // fully-qualified `videoApiStudioStageVocab:key` lookups regardless of
    // this component's own default namespace.
    const nodeLabels = useMemo(() => buildNodeLabels(t), [t]);
    const isPortrait = orientation === 'portrait';
    // Live USD→credits rate for AI video cost tooltips (Veo per-shot range,
    // per-video cap). Falls back to the seed 150× when offline.
    const ratio = useEffectiveCreditRatio();
    const aiVideoTooltip = t('stats.aiVideoTooltip', {
        min: formatCredits(usdToCredits(0.12, ratio), { suffix: '', t }),
        max: formatCredits(usdToCredits(0.4, ratio), { suffix: '', t }),
        cap: formatCredits(usdToCredits(1.5, ratio), { suffix: 'credits', t }),
    });
    const showDownload =
        (contentType === 'VIDEO' || contentType === 'SLIDES' || !!artifactUrls.audio) && !!apiKey;

    // ── Render polling state (mirrors VideoResult behavior so existing
    // render flow keeps working from this new panel) ────────────────────
    const [renderState, setRenderState] = useState<RenderState>('idle');
    const [videoDownloadUrl, setVideoDownloadUrl] = useState<string | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [renderProgress, setRenderProgress] = useState(0);
    // We need to track the in-flight render job in localStorage but don't
    // currently surface its ID in the UI (the existing render-status polling
    // reads from the saved job). Using a ref keeps the value addressable
    // without the unused-var lint nag.
    const renderJobIdRef = useRef<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const startRenderPolling = useCallback(
        (jobId: string) => {
            if (!apiKey) return;
            if (pollingRef.current) clearInterval(pollingRef.current);
            let attempts = 0;
            const MAX_ATTEMPTS = 180;
            pollingRef.current = setInterval(async () => {
                attempts++;
                if (attempts > MAX_ATTEMPTS) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setRenderState('error');
                    setRenderError(t('render.timedOut'));
                    clearRenderJob(videoId);
                    return;
                }
                try {
                    const s = await getRenderStatus(jobId, apiKey, videoId);
                    setRenderProgress(s.progress ?? 0);
                    if (s.status === 'completed' && s.video_url) {
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        setVideoDownloadUrl(s.video_url);
                        setRenderState('done');
                        setRenderProgress(100);
                        clearRenderJob(videoId);
                        toast.success(t('render.readyToast'));
                    } else if (s.status === 'failed') {
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        setRenderState('error');
                        setRenderError(s.error || t('render.failedGeneric'));
                        clearRenderJob(videoId);
                        toast.error(t('render.failedToast'));
                    }
                } catch {
                    /* will retry */
                }
            }, 10_000);
        },
        [apiKey, videoId]
    );

    // Recover render-job state on mount: prefer saved-localStorage job,
    // and surface any pre-rendered MP4 as a download link.
    useEffect(() => {
        if (artifactUrls.videoMp4) {
            setVideoDownloadUrl(artifactUrls.videoMp4);
            setRenderState('done');
            setRenderProgress(100);
            clearRenderJob(videoId);
            return;
        }
        const saved = loadRenderJob(videoId);
        if (saved && apiKey) {
            getRenderStatus(saved.jobId, apiKey, videoId)
                .then((s) => {
                    if (s.status === 'completed' && s.video_url) {
                        setVideoDownloadUrl(s.video_url);
                        setRenderState('done');
                        setRenderProgress(100);
                        clearRenderJob(videoId);
                    } else if (s.status === 'failed') {
                        setRenderState('error');
                        setRenderError(s.error || t('render.failedGeneric'));
                        clearRenderJob(videoId);
                    } else {
                        renderJobIdRef.current = saved.jobId;
                        setRenderState('rendering');
                        setRenderProgress(s.progress ?? 0);
                        startRenderPolling(saved.jobId);
                    }
                })
                .catch(() => clearRenderJob(videoId));
        }
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
        // intentionally only re-run if videoId changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [videoId, artifactUrls.videoMp4, apiKey]);

    const handleRequestRender = useCallback(
        async (settings?: RenderSettings) => {
            if (!apiKey || renderState === 'submitting' || renderState === 'rendering') return;
            setRenderState('submitting');
            setRenderError(null);
            setRenderProgress(0);
            try {
                const res = await requestVideoRender(videoId, apiKey, settings);
                renderJobIdRef.current = res.job_id;
                setRenderState('rendering');
                saveRenderJob(videoId, res.job_id);
                toast.info(t('render.startedToast'));
                startRenderPolling(res.job_id);
            } catch (err) {
                setRenderState('error');
                setRenderError(err instanceof Error ? err.message : t('render.failedToStart'));
                toast.error(t('render.failedToStartToast'));
            }
        },
        [apiKey, renderState, startRenderPolling, videoId, t]
    );

    const handleClearRender = useCallback(async () => {
        if (!apiKey) return;
        try {
            await clearRenderedVideo(videoId, apiKey);
            setVideoDownloadUrl(null);
            setRenderState('idle');
            renderJobIdRef.current = null;
            setRenderProgress(0);
            setRenderError(null);
            clearRenderJob(videoId);
            toast.success(t('render.clearedToast'));
        } catch (err) {
            toast.error(err instanceof Error ? err.message : t('render.failedToClear'));
        }
    }, [videoId, apiKey, t]);

    // ── Stages list (synced to PipelineState slot states) ────────────────
    // v3 swaps the v2 Beats/Screenplay/Narration/Storyboard chain for the
    // ShotPlanner + NarrationWriter pair — same surface area, different
    // node set. Research / Talent / Score / Filming stay common to both.
    const stagesList = useMemo(() => {
        const isV3 = state.pipelineVersion === 'v3';
        const linearOrder: PipelineNodeId[] = [
            ...(state.research ? (['research'] as PipelineNodeId[]) : []),
            ...(isV3
                ? ([
                      ...(state.shotPlanner ? ['shotPlanner'] : []),
                      ...(state.narrationWriter ? ['narrationWriter'] : []),
                  ] as PipelineNodeId[])
                : ([
                      ...(state.beats ? ['beats'] : []),
                      'screenplay',
                      'narration',
                      'storyboard',
                  ] as PipelineNodeId[])),
            'filming',
            ...(state.talent ? (['talent'] as PipelineNodeId[]) : []),
            ...(state.score ? (['score'] as PipelineNodeId[]) : []),
            'finalCut',
        ];
        return linearOrder.map((id) => {
            const slot = (state as unknown as Record<string, { state: string }>)[id];
            return { id, slotState: slot?.state ?? 'scheduled' };
        });
    }, [state]);

    // ── AI video credit subtotal (v3 + AI-video-on runs only) ───────────
    // Sums `_ai_video_cost_credits` across every Veo-driven scene. Surfaces
    // in the Production schedule footer so users see exactly how much of
    // the per-video AI budget was spent (capped at ≈225 credits by BE).
    const aiVideoCreditsSpent = useMemo(() => {
        let total = 0;
        let touched = false;
        for (const s of state.scenes) {
            if (typeof s.aiVideoCostCredits === 'number') {
                total += s.aiVideoCostCredits;
                touched = true;
            }
        }
        return touched ? total : null;
    }, [state.scenes]);
    const aiVideoShotCount = useMemo(
        () =>
            state.scenes.filter(
                (s) => s.shotType === 'AI_VIDEO_HERO' || s.aiVideoCostCredits != null
            ).length,
        [state.scenes]
    );

    // ── Share URL + embed code ───────────────────────────────────────────
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const timeline = artifactUrls.timeline;
    const shareableUrl = timeline
        ? `${baseUrl}/content/${videoId}?timeline=${encodeURIComponent(timeline)}${
              artifactUrls.audio ? `&audio=${encodeURIComponent(artifactUrls.audio)}` : ''
          }${artifactUrls.words ? `&words=${encodeURIComponent(artifactUrls.words)}` : ''}`
        : '';
    const embedCode = shareableUrl
        ? `<iframe\n  src="${shareableUrl}"\n  width="100%"\n  height="600"\n  frameborder="0"\n  allowfullscreen\n  allow="autoplay; fullscreen"\n  style="border-radius: 12px; overflow: hidden;"\n></iframe>`
        : '';
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedEmbed, setCopiedEmbed] = useState(false);
    const handleCopyUrl = async () => {
        if (!shareableUrl) return;
        try {
            await navigator.clipboard.writeText(shareableUrl);
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
        } catch {
            /* ignore */
        }
    };
    const handleCopyEmbed = async () => {
        if (!embedCode) return;
        try {
            await navigator.clipboard.writeText(embedCode);
            setCopiedEmbed(true);
            setTimeout(() => setCopiedEmbed(false), 2000);
        } catch {
            /* ignore */
        }
    };

    // ── Developer audit drawer ──
    // Cached reads — share React Query keys with PipelineFlow's hooks, so
    // mounting the panel doesn't trigger duplicate network requests.
    const [devOpen, setDevOpen] = useState(false);
    const { data: statusResp } = useVideoStatus(videoId, apiKey);
    const { data: timelineJson } = useTimelineJson(videoId, artifactUrls.timeline);

    const navigate = useNavigate();
    const handleEditClick = useCallback(() => {
        if (!timeline) return;
        const editParams = {
            videoId,
            htmlUrl: timeline,
            audioUrl: artifactUrls.audio ?? '',
            wordsUrl: artifactUrls.words ?? '',
            apiKey: apiKey ?? '',
            orientation: orientation ?? 'landscape',
        };
        if (onEdit) {
            onEdit(editParams);
            return;
        }
        navigate({
            to: '/video-api-studio/edit/$videoId',
            params: { videoId },
            search: {
                htmlUrl: editParams.htmlUrl,
                audioUrl: editParams.audioUrl,
                wordsUrl: editParams.wordsUrl,
                avatarUrl: '',
                apiKey: editParams.apiKey,
                orientation: editParams.orientation,
                // No specific shot to focus on — opens at the first scene.
                focusTime: undefined,
            },
        });
    }, [
        navigate,
        videoId,
        timeline,
        artifactUrls.audio,
        artifactUrls.words,
        apiKey,
        orientation,
        onEdit,
    ]);

    return (
        <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
            {/* Status badge + abort/retry */}
            <div className="flex items-center gap-2">
                {status === 'wrapped' ? (
                    <Badge
                        variant="outline"
                        className="h-5 gap-1 border-green-200 bg-green-50 text-green-700"
                    >
                        <CheckCircle className="size-3" /> {t('statusBadge.wrapped')}
                    </Badge>
                ) : status === 'halted' ? (
                    <Badge
                        variant="outline"
                        className="h-5 gap-1 border-red-200 bg-red-50 text-red-700"
                    >
                        <Warning className="size-3" /> {t('statusBadge.halted')}
                    </Badge>
                ) : (
                    <Badge
                        variant="outline"
                        className="h-5 gap-1 border-blue-200 bg-blue-50 text-blue-700"
                    >
                        <CircleNotch className="size-3 animate-spin" /> {t('statusBadge.inProduction')}
                    </Badge>
                )}
                {/* In-flight cancel. Aborts the SSE stream + clears the
                    persisted pending key. The BE background task may keep
                    running — we surface that nuance via the toast in the
                    parent handler. */}
                {status === 'in_production' && onAbort && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onAbort}
                        className="ml-auto h-7 gap-1.5 text-2xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                        <Octagon className="size-3" />
                        {t('actions.stopProduction')}
                    </Button>
                )}
                {/* Developer / Audit drawer trigger. Always available so
                    support / engineering can pull the full pathway for any
                    run without going through CLI tools. Sits right of the
                    status badge so it's discoverable but unobtrusive. */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDevOpen(true)}
                    title={t('actions.auditTooltip')}
                    className={`h-7 gap-1.5 text-2xs text-muted-foreground hover:text-foreground ${
                        status === 'in_production' && onAbort ? '' : 'ml-auto'
                    }`}
                >
                    <Terminal className="size-3" />
                    {t('actions.audit')}
                </Button>
            </div>
            <DeveloperAuditSheet
                open={devOpen}
                onOpenChange={setDevOpen}
                state={state}
                statusResp={statusResp}
                timelineJson={timelineJson}
                eventLog={eventLog}
                apiKey={apiKey}
            />

            {/* Halted banner with retry CTA */}
            {status === 'halted' && (
                <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                    <div className="flex items-center gap-1.5 font-medium">
                        <Warning className="size-3.5" />
                        {t('haltedBanner.title')}
                    </div>
                    <p className="text-2xs leading-relaxed text-red-900/80">
                        {t('haltedBanner.description')}
                    </p>
                    {onRetry && (
                        <Button
                            variant="default"
                            size="sm"
                            onClick={onRetry}
                            className="h-7 gap-1.5 bg-red-600 text-2xs text-white hover:bg-red-700"
                        >
                            <ArrowsClockwise className="size-3" />
                            {t('haltedBanner.retry')}
                        </Button>
                    )}
                </div>
            )}

            {/* Stages list */}
            <div className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('stagesList.heading')}
                </div>
                <ul className="space-y-1 text-xs">
                    {stagesList.map(({ id, slotState }) => (
                        <li key={id} className="flex items-center gap-2 rounded px-1 py-0.5">
                            {slotState === 'wrapped' ? (
                                <CheckCircle className="size-3 shrink-0 text-green-600" />
                            ) : slotState === 'in_production' ? (
                                <CircleNotch className="size-3 shrink-0 animate-spin text-blue-600" />
                            ) : slotState === 'cut' || slotState === 'reshoot' ? (
                                <Warning
                                    className={`size-3 shrink-0 ${slotState === 'cut' ? 'text-red-600' : 'text-amber-600'}`}
                                />
                            ) : (
                                <Clock className="size-3 shrink-0 text-muted-foreground/40" />
                            )}
                            <span
                                className={
                                    slotState === 'scheduled'
                                        ? 'text-muted-foreground'
                                        : 'text-foreground'
                                }
                            >
                                {nodeLabels[id]}
                            </span>
                            {id === 'filming' && <FilmingCounter state={state} />}
                            {id === 'talent' && <TalentCounter state={state} />}
                            {id === 'score' && <ScoreCounter state={state} />}
                            {id === 'research' && <ResearchCounter state={state} />}
                            {id === 'shotPlanner' && <ShotPlannerCounter state={state} />}
                            {id === 'narrationWriter' && <NarrationWriterCounter state={state} />}
                        </li>
                    ))}
                </ul>
                {state.pipelineVersion === 'v3' && (
                    <div className="mt-2 border-t pt-2 text-2xs text-muted-foreground">
                        {t('stagesList.pipelineLabel')}{' '}
                        <span className="font-mono text-foreground">v3</span> ·{' '}
                        {t('stagesList.shotPlannerFirst')}
                    </div>
                )}
            </div>

            {/* Production stats */}
            {(stats.cumulativeTokens || stats.tokenUsage) && (
                <div className="rounded-lg border bg-card p-3 shadow-sm">
                    <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('stats.heading')}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
                        <dt className="text-muted-foreground">{t('stats.tokens')}</dt>
                        <dd className="tabular-nums">
                            <Lightning className="me-0.5 inline size-3 text-amber-500" />
                            {(
                                stats.cumulativeTokens?.total_tokens ??
                                stats.tokenUsage?.total_tokens ??
                                0
                            ).toLocaleString()}
                        </dd>
                        {(stats.cumulativeTokens?.estimated_cost_usd ??
                            stats.tokenUsage?.estimated_cost_usd) != null && (
                            <>
                                <dt className="text-muted-foreground">{t('stats.estCost')}</dt>
                                <dd className="font-medium text-emerald-600">
                                    $
                                    {(
                                        stats.cumulativeTokens?.estimated_cost_usd ??
                                        stats.tokenUsage?.estimated_cost_usd ??
                                        0
                                    ).toFixed(4)}
                                </dd>
                            </>
                        )}
                        {stats.tokenUsage?.image_count ? (
                            <>
                                <dt className="text-muted-foreground">{t('stats.stills')}</dt>
                                <dd>{stats.tokenUsage.image_count}</dd>
                            </>
                        ) : null}
                        {aiVideoShotCount > 0 && (
                            <>
                                <dt className="text-muted-foreground">{t('stats.aiVideo')}</dt>
                                <dd title={aiVideoTooltip} className="font-medium text-violet-700">
                                    ✨ {t('stats.aiVideoShots', { count: aiVideoShotCount })}
                                    {aiVideoCreditsSpent != null && (
                                        <span className="ml-1 font-mono tabular-nums text-violet-500">
                                            ({formatCredits(aiVideoCreditsSpent, { precision: 0, t })})
                                        </span>
                                    )}
                                </dd>
                            </>
                        )}
                    </dl>
                </div>
            )}

            {/* Thumbnail picker — only renders when the video has a thumbnail
                set persisted (i.e. the pipeline reached the Director stage). */}
            <ThumbnailPickerPanel videoId={videoId} apiKey={apiKey} />

            {/* Artifact URLs */}
            <div className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('assets.heading')}
                </div>
                <ul className="space-y-1 text-2xs">
                    {artifactUrls.script && (
                        <ArtifactLink
                            label={t('assets.screenplay')}
                            url={artifactUrls.script}
                            suffix=".txt"
                        />
                    )}
                    {artifactUrls.audio && (
                        <ArtifactLink
                            label={t('assets.narration')}
                            url={artifactUrls.audio}
                            suffix=".mp3"
                        />
                    )}
                    {artifactUrls.words && (
                        <ArtifactLink
                            label={t('assets.wordTimings')}
                            url={artifactUrls.words}
                            suffix=".json"
                        />
                    )}
                    {artifactUrls.timeline && (
                        <ArtifactLink
                            label={t('assets.finalCut')}
                            url={artifactUrls.timeline}
                            suffix=".json"
                        />
                    )}
                    {!artifactUrls.script && !artifactUrls.audio && !artifactUrls.timeline && (
                        <li className="text-muted-foreground">{t('assets.empty')}</li>
                    )}
                </ul>
            </div>

            {/* Actions */}
            <div className="rounded-lg border bg-card p-3 shadow-sm">
                <div className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t('actionsCard.heading')}
                </div>
                <div className="space-y-2">
                    {/* Share */}
                    {shareableUrl && (
                        <div className="space-y-1">
                            <label className="flex items-center gap-1.5 text-2xs font-medium text-foreground">
                                <Link className="size-3" />
                                {t('share.label')}
                            </label>
                            <div className="flex w-full items-center rounded-md border bg-background px-2 py-0.5 shadow-sm">
                                <Input
                                    value={shareableUrl}
                                    readOnly
                                    className="h-7 flex-1 border-0 bg-transparent p-0 font-mono text-2xs shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                    onClick={(e) => e.currentTarget.select()}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCopyUrl}
                                    className="ml-1 size-6 shrink-0"
                                    title={t('share.copyLinkTitle')}
                                >
                                    {copiedUrl ? (
                                        <Check className="size-3.5 text-green-600" />
                                    ) : (
                                        <Copy className="size-3.5" />
                                    )}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Embed */}
                    {embedCode && (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-full justify-start gap-2"
                                >
                                    <Code className="size-3.5" />
                                    {t('embed.getEmbedCode')}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80" align="end" side="left">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-medium">
                                            {t('embed.heading')}
                                        </h4>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={handleCopyEmbed}
                                            className="h-6 gap-1 text-2xs"
                                        >
                                            {copiedEmbed ? (
                                                <>
                                                    <Check className="size-3 text-green-600" />
                                                    {t('embed.copied')}
                                                </>
                                            ) : (
                                                <>
                                                    <Copy className="size-3" />
                                                    {t('embed.copy')}
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                    <pre className="max-h-44 overflow-auto rounded border bg-muted p-2 font-mono text-2xs text-muted-foreground">
                                        {embedCode}
                                    </pre>
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}

                    {/* Edit */}
                    {timeline && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-full justify-start gap-2"
                            onClick={handleEditClick}
                        >
                            <Pencil className="size-3.5" />
                            {t('edit.openInEditor')}
                        </Button>
                    )}

                    {/* Render MP4 */}
                    {showDownload && timeline && (
                        <div className="space-y-1.5">
                            {renderState === 'done' && videoDownloadUrl ? (
                                <div className="flex items-center gap-1.5">
                                    <a
                                        href={videoDownloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex h-8 flex-1 items-center gap-1.5 rounded-md border bg-green-50 px-2 text-xs font-medium text-green-700 hover:bg-green-100"
                                    >
                                        <DownloadSimple className="size-3.5" />
                                        {t('render.downloadMp4')}
                                        <ArrowSquareOut className="ml-auto size-3" />
                                    </a>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-8 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={handleClearRender}
                                        title={t('render.clearTitle')}
                                    >
                                        <X className="size-3.5" />
                                    </Button>
                                </div>
                            ) : renderState === 'rendering' || renderState === 'submitting' ? (
                                <div className="space-y-1.5 rounded-md border bg-muted/40 p-2">
                                    <div className="flex items-center gap-1.5">
                                        <CircleNotch className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                                        <span className="text-2xs text-muted-foreground">
                                            {renderState === 'submitting'
                                                ? t('render.startingRender')
                                                : renderProgress > 0
                                                  ? t('render.masteringPercent', {
                                                        percent: Math.round(renderProgress),
                                                    })
                                                  : t('render.mastering')}
                                        </span>
                                    </div>
                                    {renderState === 'rendering' && (
                                        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                            <div
                                                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                                                style={{ width: `${Math.max(2, renderProgress)}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-full justify-start gap-2"
                                    onClick={() => setSettingsOpen(true)}
                                >
                                    <FilmStrip className="size-3.5" />
                                    {t('render.masterTheCut')}
                                </Button>
                            )}
                            {renderState === 'error' && renderError && (
                                <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-1.5">
                                    <p className="text-2xs text-destructive">{renderError}</p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 text-2xs"
                                        onClick={() => setSettingsOpen(true)}
                                    >
                                        {t('render.retry')}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {showDownload && (
                <RenderSettingsDialog
                    open={settingsOpen}
                    onOpenChange={setSettingsOpen}
                    onConfirm={handleRequestRender}
                    isPortrait={isPortrait}
                />
            )}
        </div>
    );
}

/**
 * "Filming X/N" counter shown next to the Filming row in the production
 * schedule. Prefers `state.scenes[]` (Phase 2 — accurate per-scene status)
 * with a fallback to `state.filming.partialData` (legacy free-tier path).
 */
function FilmingCounter({ state }: { state: PipelineState }) {
    if (state.scenes.length > 0) {
        const wrapped = state.scenes.filter((s) => s.state === 'wrapped').length;
        const total = state.scenes.length;
        // When everything's wrapped, the row is already green-checked — drop
        // the counter to avoid redundant N/N noise.
        if (state.filming.state === 'wrapped' && wrapped === total) return null;
        return (
            <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                {wrapped}/{total}
            </span>
        );
    }
    if (state.filming.state === 'in_production' && state.filming.partialData?.shotsTotal != null) {
        return (
            <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                {state.filming.partialData.shotsCompleted ?? 0}/
                {state.filming.partialData.shotsTotal}
            </span>
        );
    }
    return null;
}

/**
 * "Recording N/M takes" counter for the Talent stages-list row. Mirrors
 * `<FilmingCounter>`. Hidden once both counters reach parity to avoid
 * redundant N/N noise next to the green check.
 */
function TalentCounter({ state }: { state: PipelineState }) {
    const slot = state.talent;
    if (!slot) return null;
    if (slot.state === 'in_production' && slot.partialData?.total) {
        return (
            <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                {slot.partialData.completed ?? 0}/{slot.partialData.total}
            </span>
        );
    }
    if (slot.state === 'wrapped' && slot.data.total) {
        // Already green-checked — drop the redundant counter.
        return null;
    }
    return null;
}

function ScoreCounter({ state }: { state: PipelineState }) {
    const slot = state.score;
    if (!slot) return null;
    if (slot.state === 'in_production' && slot.partialData?.segmentsTotal) {
        return (
            <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
                {slot.partialData.segmentsCompleted ?? 0}/{slot.partialData.segmentsTotal}
            </span>
        );
    }
    return null;
}

/**
 * "N sources" / "M screenshots" hint next to the Research row. Wrapped
 * runs may still be missing details (live derivation gives no payload),
 * so the counter prefers any field that exists.
 */
function ResearchCounter({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioPipelinePanel');
    const slot = state.research;
    if (!slot) return null;
    let data: { sources?: unknown[]; screenshots?: unknown[]; urlsAttempted?: unknown[] } | null =
        null;
    if (slot.state === 'wrapped') data = slot.data;
    else if (slot.state === 'in_production') data = slot.partialData ?? null;
    if (!data) return null;
    const counts = [
        data.sources?.length
            ? t('counters.sources', { count: data.sources.length })
            : null,
        data.screenshots?.length
            ? t('counters.screenshots', { count: data.screenshots.length })
            : null,
        !data.sources?.length && !data.screenshots?.length && data.urlsAttempted?.length
            ? t('counters.urls', { count: data.urlsAttempted.length })
            : null,
    ].filter(Boolean);
    if (counts.length === 0) return null;
    return (
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
            {counts.join(' · ')}
        </span>
    );
}

/**
 * "8 shots · 2 intrinsic" hint next to the ShotPlanner stages-list row.
 * Wrapped + counter both show because the count is fundamentally what the
 * planner produced (vs Talent / Score where the row's progress IS the count).
 */
function ShotPlannerCounter({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioPipelinePanel');
    const slot = state.shotPlanner;
    if (!slot || slot.state !== 'wrapped') return null;
    const { shotCount, intrinsicCount } = slot.data;
    if (shotCount === 0) return null;
    return (
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
            {t('counters.shots', { count: shotCount })}
            {intrinsicCount > 0 ? ` · ${t('counters.intrinsic', { count: intrinsicCount })}` : ''}
        </span>
    );
}

function NarrationWriterCounter({ state }: { state: PipelineState }) {
    const { t } = useTranslation('videoApiStudioPipelinePanel');
    const slot = state.narrationWriter;
    if (!slot || slot.state !== 'wrapped') return null;
    const { totalWords, skippedIntrinsicCount } = slot.data;
    if (totalWords === 0 && skippedIntrinsicCount === 0) return null;
    return (
        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
            {t('counters.words', { count: totalWords })}
            {skippedIntrinsicCount > 0
                ? ` · ${t('counters.silent', { count: skippedIntrinsicCount })}`
                : ''}
        </span>
    );
}

function ArtifactLink({ label, url, suffix }: { label: string; url: string; suffix: string }) {
    return (
        <li className="flex items-center gap-1.5">
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center gap-1 truncate rounded px-1 py-0.5 text-foreground hover:bg-muted hover:text-blue-700"
            >
                <ArrowSquareOut className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{label}</span>
                <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">
                    {suffix}
                </span>
            </a>
        </li>
    );
}
