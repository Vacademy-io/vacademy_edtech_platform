import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    CheckCircle,
    Copy,
    Check,
    Code,
    LinkSimple,
    DownloadSimple,
    CircleNotch,
    ArrowSquareOut,
    Pencil,
    X,
} from '@phosphor-icons/react';
import { AIContentPlayer } from '@/components/ai-video-player/AIContentPlayer';
import {
    ContentType,
    VideoOrientation,
    getContentTypeLabel,
    requiresAudio,
    requestVideoRender,
    getVideoUrls,
    getVideoStatus,
    getRenderStatus,
    clearRenderedVideo,
    type RenderSettings,
    type TokenUsage,
    type GenerationProgress,
} from '../-services/video-generation';
import { LatexRenderer } from './LatexRenderer';
import { RenderSettingsDialog } from './RenderSettingsDialog';
import { toast } from 'sonner';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../-utils/credits';

// ---------------------------------------------------------------------------
// localStorage helpers for render job persistence
// ---------------------------------------------------------------------------

const RENDER_JOB_KEY_PREFIX = 'render-job-';
const MAX_RENDER_AGE_MS = 90 * 60 * 1000; // 90 minutes

function saveRenderJob(videoId: string, jobId: string) {
    const key = `${RENDER_JOB_KEY_PREFIX}${videoId}`;
    localStorage.setItem(key, JSON.stringify({ jobId, startedAt: Date.now() }));
    console.log(
        `[VideoResult] Saved render job to localStorage: videoId=${videoId}, jobId=${jobId}`
    );
}

function loadRenderJob(videoId: string): { jobId: string; startedAt: number } | null {
    try {
        const raw = localStorage.getItem(`${RENDER_JOB_KEY_PREFIX}${videoId}`);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Date.now() - data.startedAt > MAX_RENDER_AGE_MS) {
            clearRenderJob(videoId);
            console.log(`[VideoResult] Stale render job cleared for videoId=${videoId}`);
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

// ---------------------------------------------------------------------------

interface VideoResultProps {
    videoId: string;
    htmlUrl: string;
    audioUrl?: string;
    wordsUrl?: string;
    contentType?: ContentType;
    orientation?: VideoOrientation;
    prompt: string;
    apiKey?: string;
    tokenUsage?: TokenUsage | null;
}

type RenderState = 'idle' | 'submitting' | 'rendering' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Generation Details — token / shot / error breakdown shown after video is ready
// ---------------------------------------------------------------------------

function GenerationDetails({
    tokenUsage,
    genProgress,
}: {
    tokenUsage?: TokenUsage | null;
    genProgress: GenerationProgress | null;
}) {
    const { t } = useTranslation('videoApiStudioCredits');
    const [shotsOpen, setShotsOpen] = useState(false);
    const [errorsOpen, setErrorsOpen] = useState(false);
    // Backend reports cumulative LLM cost in USD; we display credits only.
    const ratio = useEffectiveCreditRatio();

    // Prefer the richer cumulative_tokens from generation_progress if available
    const totalPrompt =
        genProgress?.cumulative_tokens?.prompt_tokens ?? tokenUsage?.prompt_tokens ?? 0;
    const totalCompletion =
        genProgress?.cumulative_tokens?.completion_tokens ?? tokenUsage?.completion_tokens ?? 0;
    const totalTokens =
        genProgress?.cumulative_tokens?.total_tokens ?? tokenUsage?.total_tokens ?? 0;
    const estCost =
        genProgress?.cumulative_tokens?.estimated_cost_usd ??
        tokenUsage?.estimated_cost_usd ??
        null;

    // Sort shots by index for stable display (backend stores reverse-chronological)
    const shotsHistory = (genProgress?.shots_history ?? [])
        .slice()
        .sort((a, b) => a.shot_index - b.shot_index);
    const errors = genProgress?.errors ?? [];

    return (
        <details className="rounded-xl border bg-card shadow-sm" open>
            <summary className="cursor-pointer select-none rounded-xl px-4 py-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50">
                Generation Details
            </summary>
            <div className="space-y-3 px-4 pb-4 pt-2">
                {/* Top-line summary */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-2xs">
                    {tokenUsage?.model && (
                        <>
                            <dt className="text-muted-foreground">Model</dt>
                            <dd className="truncate font-mono">
                                {tokenUsage.model.split('/').pop()}
                            </dd>
                        </>
                    )}
                    <dt className="text-muted-foreground">LLM tokens</dt>
                    <dd>
                        {totalTokens.toLocaleString()}
                        <span className="ml-1 text-muted-foreground/70">
                            ({totalPrompt.toLocaleString()} in / {totalCompletion.toLocaleString()}{' '}
                            out)
                        </span>
                    </dd>
                    {(tokenUsage?.image_count ?? 0) > 0 && (
                        <>
                            <dt className="text-muted-foreground">Images</dt>
                            <dd>{tokenUsage!.image_count}</dd>
                        </>
                    )}
                    {(tokenUsage?.tts_character_count ?? 0) > 0 && (
                        <>
                            <dt className="text-muted-foreground">TTS chars</dt>
                            <dd>{tokenUsage!.tts_character_count.toLocaleString()}</dd>
                        </>
                    )}
                    {genProgress?.shots_total != null && (
                        <>
                            <dt className="text-muted-foreground">Shots</dt>
                            <dd>
                                {genProgress.shots_completed ?? 0} / {genProgress.shots_total}
                            </dd>
                        </>
                    )}
                    {estCost != null && (
                        <>
                            <dt className="font-medium text-foreground">Est. cost</dt>
                            <dd className="font-medium text-emerald-600">
                                {formatCredits(usdToCredits(estCost, ratio), { t })}
                            </dd>
                        </>
                    )}
                </dl>

                {/* Per-shot breakdown */}
                {shotsHistory.length > 0 && (
                    <div className="border-t pt-2">
                        <button
                            onClick={() => setShotsOpen((o) => !o)}
                            className="flex w-full items-center justify-between text-2xs font-medium text-muted-foreground hover:text-foreground"
                        >
                            <span>Per-shot breakdown ({shotsHistory.length})</span>
                            <span>{shotsOpen ? '▲' : '▼'}</span>
                        </button>
                        {shotsOpen && (
                            <div className="mt-2 max-h-64 overflow-y-auto rounded border bg-muted/20">
                                <table className="w-full text-2xs">
                                    <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                                        <tr>
                                            <th className="px-2 py-1 text-left font-medium">#</th>
                                            <th className="px-2 py-1 text-left font-medium">
                                                Type
                                            </th>
                                            <th className="px-2 py-1 text-right font-medium">
                                                Dur
                                            </th>
                                            <th className="px-2 py-1 text-right font-medium">
                                                Tokens
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {shotsHistory.map((s) => {
                                            const td = s.token_delta;
                                            const tTotal =
                                                (td?.prompt_tokens ?? 0) +
                                                (td?.completion_tokens ?? 0);
                                            return (
                                                <tr
                                                    key={s.shot_index}
                                                    className="border-t border-border/50"
                                                >
                                                    <td className="px-2 py-1 font-mono">
                                                        {s.shot_index + 1}
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        {s.shot_type.replace(/_/g, ' ')}
                                                    </td>
                                                    <td className="px-2 py-1 text-right tabular-nums">
                                                        {s.duration_s.toFixed(1)}s
                                                    </td>
                                                    <td className="px-2 py-1 text-right tabular-nums">
                                                        {tTotal.toLocaleString()}
                                                        {td && (
                                                            <span className="ml-1 text-muted-foreground/60">
                                                                ({td.prompt_tokens.toLocaleString()}
                                                                /
                                                                {td.completion_tokens.toLocaleString()}
                                                                )
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Error log */}
                {errors.length > 0 && (
                    <div className="border-t pt-2">
                        <button
                            onClick={() => setErrorsOpen((o) => !o)}
                            className="flex w-full items-center justify-between text-2xs font-medium text-amber-700 hover:text-amber-900"
                        >
                            <span>Warnings & retries ({errors.length})</span>
                            <span>{errorsOpen ? '▲' : '▼'}</span>
                        </button>
                        {errorsOpen && (
                            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                                {errors.map((e, i) => (
                                    <li
                                        key={i}
                                        className="rounded bg-amber-50 px-2 py-1 text-2xs text-amber-800"
                                    >
                                        <span className="font-medium">Shot {e.shot_index + 1}</span>
                                        {e.shot_type && (
                                            <span className="ml-1 text-amber-600">
                                                ({e.shot_type})
                                            </span>
                                        )}
                                        {e.retrying && (
                                            <span className="ml-1 text-blue-600">
                                                · retry {e.attempt ?? '?'}
                                            </span>
                                        )}
                                        <div className="mt-0.5 font-mono text-2xs text-amber-700">
                                            {e.error.slice(0, 240)}
                                            {e.error.length > 240 && '…'}
                                        </div>
                                        {e.timestamp && (
                                            <div className="text-2xs text-muted-foreground">
                                                {new Date(e.timestamp).toLocaleTimeString()}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </div>
        </details>
    );
}

export function VideoResult({
    videoId,
    htmlUrl,
    audioUrl,
    wordsUrl,
    contentType = 'VIDEO',
    orientation = 'landscape',
    prompt,
    apiKey,
    tokenUsage,
}: VideoResultProps) {
    const { t } = useTranslation('videoApiStudioVideoGeneration');
    const isPortrait = orientation === 'portrait';
    const playerWidth = isPortrait ? 1080 : 1920;
    const playerHeight = isPortrait ? 1920 : 1080;
    const [copiedUrl, setCopiedUrl] = useState(false);
    const [copiedEmbed, setCopiedEmbed] = useState(false);
    const [renderState, setRenderState] = useState<RenderState>('idle');
    const [videoDownloadUrl, setVideoDownloadUrl] = useState<string | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [renderProgress, setRenderProgress] = useState<number>(0);
    const [renderJobId, setRenderJobId] = useState<string | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [genProgress, setGenProgress] = useState<GenerationProgress | null>(null);
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Fetch rich generation details (shots_history, errors, cumulative tokens) once
    useEffect(() => {
        if (!apiKey || !videoId) return;
        getVideoStatus(videoId, apiKey)
            .then((resp) => {
                if (resp?.generation_progress) setGenProgress(resp.generation_progress);
            })
            .catch((err) => console.warn('[VideoResult] getVideoStatus failed:', err));
    }, [videoId, apiKey]);

    const showDownload = (contentType === 'VIDEO' || requiresAudio(contentType)) && !!apiKey;

    // ------------------------------------------------------------------
    // Polling logic
    // ------------------------------------------------------------------

    const startRenderPolling = useCallback(
        (jobId: string) => {
            if (!apiKey) return;
            if (pollingRef.current) clearInterval(pollingRef.current);
            let attempts = 0;
            const MAX_ATTEMPTS = 180; // 30 min at 10s
            const key = apiKey;
            console.log(`[VideoResult] Starting render polling for jobId=${jobId}`);
            pollingRef.current = setInterval(async () => {
                attempts++;
                if (attempts > MAX_ATTEMPTS) {
                    if (pollingRef.current) clearInterval(pollingRef.current);
                    setRenderState('error');
                    setRenderError('Render timed out. Please try again.');
                    clearRenderJob(videoId);
                    console.warn(`[VideoResult] Render polling timed out for jobId=${jobId}`);
                    return;
                }
                try {
                    const status = await getRenderStatus(jobId, key, videoId);
                    console.log(
                        `[VideoResult] Poll #${attempts} jobId=${jobId}:`,
                        status.status,
                        `progress=${status.progress}`
                    );
                    setRenderProgress(status.progress ?? 0);
                    if (status.status === 'completed' && status.video_url) {
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        setVideoDownloadUrl(status.video_url);
                        setRenderState('done');
                        setRenderProgress(100);
                        clearRenderJob(videoId);
                        toast.success('Video ready for download!');
                    } else if (status.status === 'failed') {
                        if (pollingRef.current) clearInterval(pollingRef.current);
                        setRenderState('error');
                        setRenderError(status.error || 'Render failed');
                        clearRenderJob(videoId);
                        toast.error('Video render failed');
                    }
                } catch (err) {
                    console.warn(`[VideoResult] Poll error for jobId=${jobId}:`, err);
                    // ignore — will retry next interval
                }
            }, 10_000);
        },
        [apiKey, videoId]
    );

    // ------------------------------------------------------------------
    // Mount: check API for existing video / active render, fallback to localStorage
    // ------------------------------------------------------------------

    useEffect(() => {
        if (!apiKey) return;

        console.log(`[VideoResult] Mount: checking video state for videoId=${videoId}`);

        getVideoUrls(videoId, apiKey)
            .then((urls) => {
                console.log('[VideoResult] getVideoUrls response:', JSON.stringify(urls));

                if (urls.video_url) {
                    console.log('[VideoResult] Video already rendered, showing download');
                    setVideoDownloadUrl(urls.video_url);
                    setRenderState('done');
                    setRenderProgress(100);
                    clearRenderJob(videoId);
                } else if (urls.render_job_id) {
                    console.log(
                        `[VideoResult] Active render_job_id from API: ${urls.render_job_id}`
                    );
                    setRenderJobId(urls.render_job_id);
                    setRenderState('rendering');
                    saveRenderJob(videoId, urls.render_job_id);
                    startRenderPolling(urls.render_job_id);
                } else {
                    // API returned no video_url and no render_job_id — check localStorage
                    const saved = loadRenderJob(videoId);
                    if (saved) {
                        console.log(
                            `[VideoResult] Found saved render job in localStorage: jobId=${saved.jobId}`
                        );
                        // Verify the job is still alive
                        getRenderStatus(saved.jobId, apiKey, videoId)
                            .then((status) => {
                                console.log(
                                    `[VideoResult] Saved job status:`,
                                    status.status,
                                    `progress=${status.progress}`
                                );
                                if (status.status === 'completed' && status.video_url) {
                                    setVideoDownloadUrl(status.video_url);
                                    setRenderState('done');
                                    setRenderProgress(100);
                                    clearRenderJob(videoId);
                                } else if (status.status === 'failed') {
                                    setRenderState('error');
                                    setRenderError(status.error || 'Render failed');
                                    clearRenderJob(videoId);
                                } else if (
                                    status.status === 'queued' ||
                                    status.status === 'running'
                                ) {
                                    setRenderJobId(saved.jobId);
                                    setRenderState('rendering');
                                    setRenderProgress(status.progress ?? 0);
                                    startRenderPolling(saved.jobId);
                                } else {
                                    // unknown status — clear stale entry
                                    console.log(
                                        `[VideoResult] Unknown status for saved job, clearing`
                                    );
                                    clearRenderJob(videoId);
                                }
                            })
                            .catch((err) => {
                                console.warn(
                                    '[VideoResult] Failed to check saved render job:',
                                    err
                                );
                                clearRenderJob(videoId);
                            });
                    } else {
                        console.log('[VideoResult] No active render found (API or localStorage)');
                    }
                }
            })
            .catch((err) => {
                console.error('[VideoResult] getVideoUrls failed:', err);
                // Still try localStorage fallback
                const saved = loadRenderJob(videoId);
                if (saved) {
                    console.log(
                        `[VideoResult] API failed but found localStorage job: ${saved.jobId}`
                    );
                    setRenderJobId(saved.jobId);
                    setRenderState('rendering');
                    startRenderPolling(saved.jobId);
                }
            });
    }, [videoId, apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollingRef.current) clearInterval(pollingRef.current);
        };
    }, []);

    // ------------------------------------------------------------------
    // Render request (triggered from settings dialog)
    // ------------------------------------------------------------------

    const handleRequestRender = useCallback(
        async (settings?: RenderSettings) => {
            if (!apiKey || renderState === 'submitting' || renderState === 'rendering') return;

            console.log('[VideoResult] Requesting render with settings:', settings);
            setRenderState('submitting');
            setRenderError(null);
            setRenderProgress(0);

            try {
                const result = await requestVideoRender(videoId, apiKey, settings);
                const jobId = result.job_id;
                console.log(`[VideoResult] Render submitted, jobId=${jobId}`);
                setRenderJobId(jobId);
                setRenderState('rendering');
                saveRenderJob(videoId, jobId);
                toast.info('Video rendering started. This may take a few minutes.');
                startRenderPolling(jobId);
            } catch (error) {
                console.error('[VideoResult] Render request failed:', error);
                setRenderState('error');
                setRenderError(error instanceof Error ? error.message : 'Failed to start render');
                toast.error('Failed to start video render');
            }
        },
        [videoId, apiKey, renderState, startRenderPolling]
    );

    // ------------------------------------------------------------------
    // Clear cached render so the user can re-render with new settings
    // ------------------------------------------------------------------

    const handleClearRender = useCallback(async () => {
        if (!apiKey) return;
        try {
            await clearRenderedVideo(videoId, apiKey);
            setVideoDownloadUrl(null);
            setRenderState('idle');
            setRenderJobId(null);
            setRenderProgress(0);
            setRenderError(null);
            clearRenderJob(videoId);
            toast.success('Cached video cleared. You can render again.');
        } catch (error) {
            console.error('[VideoResult] Failed to clear render:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to clear cached video');
        }
    }, [videoId, apiKey]);

    // Build the shareable URL
    const baseUrl = window.location.origin;
    const shareableUrl = `${baseUrl}/content/${videoId}?timeline=${encodeURIComponent(htmlUrl)}${audioUrl ? `&audio=${encodeURIComponent(audioUrl)}` : ''}${wordsUrl ? `&words=${encodeURIComponent(wordsUrl)}` : ''}`;

    const embedCode = `<iframe
  src="${shareableUrl}"
  width="100%"
  height="600"
  frameborder="0"
  allowfullscreen
  allow="autoplay; fullscreen"
  style="border-radius: 12px; overflow: hidden;"
></iframe>`;

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(shareableUrl);
            setCopiedUrl(true);
            setTimeout(() => setCopiedUrl(false), 2000);
        } catch (error) {
            console.error('Failed to copy URL:', error);
        }
    };

    const handleCopyEmbed = async () => {
        try {
            await navigator.clipboard.writeText(embedCode);
            setCopiedEmbed(true);
            setTimeout(() => setCopiedEmbed(false), 2000);
        } catch (error) {
            console.error('Failed to copy embed code:', error);
        }
    };

    const navigate = useNavigate();

    const handleEditClick = useCallback(() => {
        navigate({
            to: '/video-api-studio/edit/$videoId',
            params: { videoId },
            search: {
                htmlUrl,
                audioUrl: audioUrl ?? '',
                wordsUrl: wordsUrl ?? '',
                avatarUrl: '',
                apiKey: apiKey ?? '',
                orientation: orientation ?? 'landscape',
                // No specific shot to focus on — opens at the first scene.
                focusTime: undefined,
            },
        });
    }, [navigate, videoId, htmlUrl, audioUrl, wordsUrl, apiKey, orientation]);

    const contentLabel = getContentTypeLabel(contentType, t);

    return (
        <div className="flex w-full flex-col items-start gap-4 xl:flex-row">
            {/* Left Column: Content Player */}
            <div className="w-full min-w-0 grow xl:w-2/3">
                <div
                    className="flex w-full overflow-hidden rounded-xl border-2 bg-black shadow-lg"
                    style={{
                        aspectRatio: isPortrait ? '9/16' : '16/9',
                        maxHeight: 'calc(100vh - 200px)',
                    }}
                >
                    <AIContentPlayer
                        timelineUrl={htmlUrl}
                        audioUrl={audioUrl}
                        wordsUrl={wordsUrl}
                        width={playerWidth}
                        height={playerHeight}
                        onDownloadClick={
                            showDownload && renderState === 'idle'
                                ? () => setSettingsOpen(true)
                                : videoDownloadUrl
                                  ? () => window.open(videoDownloadUrl, '_blank')
                                  : undefined
                        }
                    />
                </div>
            </div>

            {/* Right Column: Prompt, Status & Actions */}
            <div className="w-full shrink-0 space-y-4 xl:w-1/3">
                <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm">
                    {/* Status & Content Label */}
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="shrink-0 text-xs font-medium">
                            {contentLabel}
                        </Badge>
                        <Badge
                            variant="outline"
                            className="h-5 gap-1 border-green-200 bg-green-50 text-green-700"
                        >
                            <CheckCircle className="size-3" />
                            Ready
                        </Badge>
                    </div>

                    {/* Prompt Text */}
                    <div className="space-y-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Origin Prompt
                        </p>
                        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 text-sm text-foreground">
                            <LatexRenderer
                                text={prompt}
                                className="max-h-48 overflow-y-auto whitespace-pre-wrap"
                            />
                        </div>
                    </div>

                    <hr className="border-border" />

                    {/* Actions Form */}
                    <div className="space-y-3">
                        {/* Share URL */}
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                <LinkSimple className="size-3.5" />
                                Shareable URL
                            </label>
                            <div className="flex w-full items-center rounded-md border bg-background px-2 py-0.5 shadow-sm">
                                <Input
                                    value={shareableUrl}
                                    readOnly
                                    className="h-8 flex-1 border-0 bg-transparent p-0 font-mono text-xs shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                    onClick={(e) => e.currentTarget.select()}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleCopyUrl}
                                    className="ml-1 size-7 shrink-0"
                                    title="Copy Link"
                                >
                                    {copiedUrl ? (
                                        <Check className="size-4 text-green-600" />
                                    ) : (
                                        <Copy className="size-4" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Embed Code Trigger */}
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                <Code className="size-3.5" />
                                Embed Content
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 w-full justify-start gap-2 shadow-sm"
                                    >
                                        <Code className="size-4" />
                                        Get Embed Code
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 sm:w-96" align="end" side="left">
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-sm font-medium">Embed Code</h4>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={handleCopyEmbed}
                                                className="h-7 gap-1.5 text-xs"
                                            >
                                                {copiedEmbed ? (
                                                    <>
                                                        <Check className="size-3 text-green-600" />
                                                        Copied!
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy className="size-3" />
                                                        Copy
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                        <pre className="max-h-48 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs text-muted-foreground">
                                            {embedCode}
                                        </pre>
                                        <p className="text-xs text-muted-foreground">
                                            Paste this code into your website to embed the content.
                                        </p>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </div>

                        {/* Edit Content */}
                        <div className="space-y-1.5">
                            <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                <Pencil className="size-3.5" />
                                Edit Content
                            </label>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 w-full justify-start gap-2 shadow-sm"
                                onClick={handleEditClick}
                            >
                                <Pencil className="size-4" />
                                Open in Editor
                            </Button>
                        </div>

                        {/* Download as Video */}
                        {showDownload && (
                            <div className="space-y-1.5">
                                <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                    <DownloadSimple className="size-3.5" />
                                    Download Video
                                </label>

                                {renderState === 'done' && videoDownloadUrl ? (
                                    <div className="flex items-center gap-1.5">
                                        <a
                                            href={videoDownloadUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex h-9 flex-1 items-center gap-2 rounded-md border bg-green-50 px-3 text-sm font-medium text-green-700 transition-colors hover:bg-green-100"
                                        >
                                            <DownloadSimple className="size-4" />
                                            Download MP4
                                            <ArrowSquareOut className="ml-auto size-3" />
                                        </a>
                                        <Button
                                            variant="outline"
                                            size="icon"
                                            className="size-9 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                            onClick={handleClearRender}
                                            title="Clear cached video to re-render"
                                        >
                                            <X className="size-4" />
                                        </Button>
                                    </div>
                                ) : renderState === 'rendering' || renderState === 'submitting' ? (
                                    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                                        <div className="flex items-center gap-2">
                                            <CircleNotch className="size-4 shrink-0 animate-spin text-muted-foreground" />
                                            <span className="text-xs text-muted-foreground">
                                                {renderState === 'submitting'
                                                    ? 'Starting render...'
                                                    : `Rendering video... ${renderProgress > 0 ? `${Math.round(renderProgress)}%` : ''}`}
                                            </span>
                                        </div>
                                        {renderState === 'rendering' && (
                                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                                <div
                                                    className="h-full rounded-full bg-violet-500 transition-all duration-500"
                                                    style={{
                                                        width: `${Math.max(2, renderProgress)}%`,
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 w-full justify-start gap-2 shadow-sm"
                                        onClick={() => setSettingsOpen(true)}
                                    >
                                        <DownloadSimple className="size-4" />
                                        Render & Download MP4
                                    </Button>
                                )}

                                {renderState === 'error' && renderError && (
                                    <div className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                                        <p className="text-xs text-destructive">{renderError}</p>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => setSettingsOpen(true)}
                                        >
                                            Retry
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {/* Generation Details */}
                {(tokenUsage || genProgress) && (
                    <GenerationDetails tokenUsage={tokenUsage} genProgress={genProgress} />
                )}
            </div>

            {/* Render settings dialog */}
            <RenderSettingsDialog
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onConfirm={handleRequestRender}
                isPortrait={isPortrait}
            />
        </div>
    );
}
