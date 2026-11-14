import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { VideoStage, ContentType, getContentTypeLabel } from '../-services/video-generation';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../-utils/credits';
import {
    FileText,
    Microphone,
    TextAlignLeft,
    Code,
    CheckCircle,
    CircleNotch,
    CaretDown,
    CaretUp,
    Copy,
    Check,
    Clock,
    SpeakerHigh,
    Lightning,
    Warning,
    Square,
} from '@phosphor-icons/react';

interface GenerationProgressProps {
    currentStage: VideoStage;
    percentage: number;
    message?: string;
    contentType?: ContentType;
    scriptUrl?: string;
    audioUrl?: string;
    wordsUrl?: string;
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
    shotPlan?: Array<{
        shot_index: number;
        shot_type: string;
        start_time: number;
        end_time: number;
        duration_s: number;
        narration_excerpt?: string;
    }>;
    /** Hand the workspace's `handleAbort` here to surface a Stop button.
     *  Undefined → button is hidden (e.g. during completion / failure). */
    onAbort?: () => void;
}

const STAGES: {
    id: VideoStage;
    label: string;
    icon: React.ReactNode;
    description: string;
}[] = [
    {
        id: 'SCRIPT',
        label: 'Script',
        icon: <FileText className="size-4" />,
        description: 'Writing narration',
    },
    {
        id: 'TTS',
        label: 'Audio',
        icon: <Microphone className="size-4" />,
        description: 'Synthesizing voice',
    },
    {
        id: 'WORDS',
        label: 'Timing',
        icon: <TextAlignLeft className="size-4" />,
        description: 'Word alignment',
    },
    {
        id: 'HTML',
        label: 'Visuals',
        icon: <Code className="size-4" />,
        description: 'Generating slides',
    },
];

function getStageIndex(stage: VideoStage): number {
    return STAGES.findIndex((s) => s.id === stage);
}

function useRemoteText(url: string | undefined) {
    const [text, setText] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!url) return;
        setLoading(true);
        setError(false);
        fetch(url)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.text();
            })
            .then(setText)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [url]);

    return { text, loading, error };
}

// ── Script panel ──────────────────────────────────────────────────────────────
function ScriptContent({ url }: { url: string }) {
    const { text, loading, error } = useRemoteText(url);
    const [copied, setCopied] = useState(false);
    const [expanded, setExpanded] = useState(false);

    if (loading)
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch className="size-3 animate-spin" /> Loading script…
            </div>
        );
    if (error) return <p className="text-xs text-destructive">Could not load script.</p>;
    if (!text) return null;

    // The script file may be a JSON plan_data object or plain text.
    let display = text;
    try {
        const parsed = JSON.parse(text);
        // Extract narration text from common keys
        display =
            parsed.script ||
            parsed.narration ||
            parsed.narration_script ||
            parsed.text ||
            // If none found, pretty-print the whole thing
            JSON.stringify(parsed, null, 2);
    } catch {
        // plain text – use as-is
    }

    const PREVIEW_LEN = 500;
    const isLong = display.length > PREVIEW_LEN;

    const handleCopy = async () => {
        await navigator.clipboard.writeText(display);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-2">
            <div className="relative">
                <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground">
                    {expanded ? display : display.slice(0, PREVIEW_LEN)}
                    {!expanded && isLong && '…'}
                </pre>
                <Button
                    size="icon"
                    variant="ghost"
                    className="absolute right-1.5 top-1.5 size-6"
                    onClick={handleCopy}
                    title="Copy script"
                >
                    {copied ? (
                        <Check className="size-3 text-green-600" />
                    ) : (
                        <Copy className="size-3" />
                    )}
                </Button>
            </div>
            {isLong && (
                <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setExpanded((e) => !e)}
                >
                    {expanded ? 'Show less' : 'Show full script'}
                </Button>
            )}
        </div>
    );
}

// ── Audio panel ───────────────────────────────────────────────────────────────
function AudioContent({ url }: { url: string }) {
    return (
        <div className="space-y-1.5">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls className="h-9 w-full" preload="metadata">
                <source src={url} type="audio/mpeg" />
                Your browser does not support the audio element.
            </audio>
            <p className="text-2xs text-muted-foreground">
                AI-synthesised narration — word-level timing will be computed next.
            </p>
        </div>
    );
}

// ── Word timing panel ─────────────────────────────────────────────────────────
function WordsContent({ url }: { url: string }) {
    const { text, loading, error } = useRemoteText(url);

    if (loading)
        return (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <CircleNotch className="size-3 animate-spin" /> Loading timing data…
            </div>
        );
    if (error) return <p className="text-xs text-destructive">Could not load timing data.</p>;
    if (!text) return null;

    let words: Array<{ word: string; start: number; end: number }> = [];
    try {
        words = JSON.parse(text);
    } catch {
        return <p className="text-xs text-destructive">Invalid word timing format.</p>;
    }
    if (!Array.isArray(words) || words.length === 0)
        return <p className="text-xs text-muted-foreground">No timing data found.</p>;

    const totalDuration = words[words.length - 1]?.end ?? 0;
    const sample = words.slice(0, 48);

    return (
        <div className="space-y-2">
            {/* Stats row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                    <TextAlignLeft className="size-3" />
                    {words.length} words
                </span>
                <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {totalDuration.toFixed(1)}s
                </span>
            </div>

            {/* Word chips */}
            <div className="flex flex-wrap gap-1">
                {sample.map((w, i) => (
                    <span
                        key={i}
                        className="inline-flex items-baseline gap-0.5 rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-2xs text-blue-800"
                    >
                        {w.word}
                        <span className="text-2xs text-blue-400">{w.start.toFixed(1)}s</span>
                    </span>
                ))}
                {words.length > 48 && (
                    <span className="px-1.5 py-0.5 text-2xs text-muted-foreground">
                        +{words.length - 48} more
                    </span>
                )}
            </div>
        </div>
    );
}

// ── Collapsible stage-result panel ────────────────────────────────────────────
function StagePanel({
    title,
    icon,
    defaultOpen,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen ?? false);

    return (
        <div className="overflow-hidden rounded-lg border border-green-200 bg-green-50/30 duration-200 animate-in fade-in slide-in-from-top-2">
            <button
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-green-50/70"
            >
                <div className="flex items-center gap-2">
                    <CheckCircle className="size-3.5 shrink-0 text-green-600" />
                    <span className="text-green-700">{icon}</span>
                    <span className="text-sm font-medium">{title}</span>
                </div>
                {open ? (
                    <CaretUp className="size-3.5 text-muted-foreground" />
                ) : (
                    <CaretDown className="size-3.5 text-muted-foreground" />
                )}
            </button>
            {open && <div className="border-t border-green-100 px-3 pb-3 pt-2">{children}</div>}
        </div>
    );
}

// ── Shot progress panel (shown during HTML stage) ─────────────────────────────
function ShotProgress({
    shotsCompleted,
    shotsTotal,
    cumulativeTokens,
    recentErrors,
    shotPlan,
}: {
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
    shotPlan?: Array<{
        shot_index: number;
        shot_type: string;
        start_time: number;
        end_time: number;
        duration_s: number;
        narration_excerpt?: string;
    }>;
}) {
    const { t } = useTranslation('videoApiStudioCredits');
    const [errorsOpen, setErrorsOpen] = useState(false);
    const [planOpen, setPlanOpen] = useState(false);
    // Live USD→credits rate for the running-cost strip below.
    const ratio = useEffectiveCreditRatio();
    const shotPct =
        shotsTotal && shotsCompleted != null ? Math.round((shotsCompleted / shotsTotal) * 100) : 0;
    const hasErrors = (recentErrors?.length ?? 0) > 0;
    const hasPlan = (shotPlan?.length ?? 0) > 0;

    return (
        <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            {/* Shot progress bar */}
            {shotsTotal != null && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-blue-700">
                            {shotsCompleted != null
                                ? `Shot ${shotsCompleted} / ${shotsTotal}`
                                : `Planning ${shotsTotal} shots…`}
                        </span>
                        <span className="tabular-nums text-blue-500">{shotPct}%</span>
                    </div>
                    <Progress value={shotPct} className="h-1" />
                </div>
            )}

            {/* Shot plan pills — done / current / pending */}
            {hasPlan && (
                <div>
                    <button
                        onClick={() => setPlanOpen((o) => !o)}
                        className="flex items-center gap-1.5 text-2xs text-blue-600 hover:text-blue-700"
                    >
                        <Code className="size-3" />
                        Shot plan ({shotPlan!.length} shots)
                        {planOpen ? (
                            <CaretUp className="size-3" />
                        ) : (
                            <CaretDown className="size-3" />
                        )}
                    </button>
                    {planOpen && (
                        <div className="mt-2 space-y-1">
                            {shotPlan!.map((s) => {
                                const done =
                                    shotsCompleted != null && s.shot_index < shotsCompleted;
                                const current =
                                    shotsCompleted != null && s.shot_index === shotsCompleted;
                                return (
                                    <div
                                        key={s.shot_index}
                                        className={`flex items-start gap-2 rounded px-2 py-1 text-2xs ${
                                            done
                                                ? 'bg-green-50 text-green-800'
                                                : current
                                                  ? 'bg-blue-100 text-blue-800'
                                                  : 'bg-white/60 text-muted-foreground'
                                        }`}
                                    >
                                        <span className="mt-0.5 shrink-0">
                                            {done ? (
                                                <CheckCircle className="size-3 text-green-500" />
                                            ) : current ? (
                                                <CircleNotch className="size-3 animate-spin text-blue-500" />
                                            ) : (
                                                <Clock className="size-3 opacity-40" />
                                            )}
                                        </span>
                                        <span className="shrink-0 font-medium">
                                            {s.shot_index + 1}.
                                        </span>
                                        <span
                                            className={`shrink-0 rounded px-1 text-2xs font-medium ${
                                                done
                                                    ? 'bg-green-100 text-green-700'
                                                    : current
                                                      ? 'bg-blue-200 text-blue-700'
                                                      : 'bg-muted text-muted-foreground'
                                            }`}
                                        >
                                            {s.shot_type.replace(/_/g, ' ')}
                                        </span>
                                        <span className="text-muted-foreground/70">
                                            {s.duration_s.toFixed(1)}s
                                        </span>
                                        {s.narration_excerpt && (
                                            <span className="min-w-0 truncate italic opacity-60">
                                                "{s.narration_excerpt.slice(0, 60)}
                                                {s.narration_excerpt.length > 60 ? '…' : ''}"
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Token / cost strip */}
            {cumulativeTokens && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                        <Lightning className="size-3 text-amber-500" />
                        {cumulativeTokens.total_tokens.toLocaleString()} tokens
                    </span>
                    {cumulativeTokens.estimated_cost_usd != null && (
                        <span className="font-mono text-2xs">
                            ≈{' '}
                            {formatCredits(
                                usdToCredits(cumulativeTokens.estimated_cost_usd, ratio),
                                { precision: 1, t }
                            )}
                        </span>
                    )}
                    <span className="text-muted-foreground/60">
                        {cumulativeTokens.prompt_tokens.toLocaleString()} in /{' '}
                        {cumulativeTokens.completion_tokens.toLocaleString()} out
                    </span>
                </div>
            )}

            {/* Recent errors */}
            {hasErrors && (
                <div>
                    <button
                        onClick={() => setErrorsOpen((o) => !o)}
                        className="flex items-center gap-1.5 text-2xs text-amber-600 hover:text-amber-700"
                    >
                        <Warning className="size-3" />
                        {recentErrors!.length} shot{' '}
                        {recentErrors!.length === 1 ? 'issue' : 'issues'}
                        {errorsOpen ? (
                            <CaretUp className="size-3" />
                        ) : (
                            <CaretDown className="size-3" />
                        )}
                    </button>
                    {errorsOpen && (
                        <ul className="mt-1.5 space-y-1">
                            {recentErrors!.map((e, i) => (
                                <li
                                    key={i}
                                    className="rounded bg-amber-50 px-2 py-1 text-2xs text-amber-800"
                                >
                                    <span className="font-medium">Shot {e.shot_index + 1}</span>
                                    {e.shot_type && (
                                        <span className="ml-1 text-amber-600">({e.shot_type})</span>
                                    )}
                                    {e.retrying && (
                                        <span className="ml-1 text-blue-500">retrying…</span>
                                    )}
                                    <span className="ml-1 text-amber-700">
                                        — {e.error.slice(0, 120)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GenerationProgress({
    currentStage,
    percentage,
    message,
    contentType = 'VIDEO',
    scriptUrl,
    audioUrl,
    wordsUrl,
    shotsCompleted,
    shotsTotal,
    cumulativeTokens,
    recentErrors,
    shotPlan,
    onAbort,
}: GenerationProgressProps) {
    const { t } = useTranslation('videoApiStudioVideoGeneration');
    const currentIndex = getStageIndex(currentStage);
    const contentLabel = getContentTypeLabel(contentType, t);

    const scriptReady = !!scriptUrl;
    const audioReady = !!audioUrl;
    const wordsReady = !!wordsUrl;
    const showShotProgress =
        currentStage === 'HTML' &&
        (shotsTotal != null || cumulativeTokens != null || (shotPlan?.length ?? 0) > 0);

    const [stopping, setStopping] = useState(false);

    const handleStopClick = () => {
        if (!onAbort || stopping) return;
        // Confirm so a stray click doesn't waste a generation. Refund makes
        // it cheaper than a real loss but the user still pays in time and
        // (for partial work) a small amount of unrefundable LLM cost on the
        // ≤ 8 in-flight shots that finish after we send the stop.
        const ok = window.confirm(
            'Stop this generation? Any credits charged so far will be refunded.'
        );
        if (!ok) return;
        setStopping(true);
        onAbort();
        // The workspace tears down state right after onAbort, which unmounts
        // this component — so we don't need to reset `stopping` ourselves.
    };

    return (
        <div className="w-full space-y-5">
            {/* ── Progress bar ── */}
            <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">
                        Generating {contentLabel.replace(/^[^\s]+\s/, '')}…
                    </span>
                    <div className="flex items-center gap-2">
                        <span className="tabular-nums text-muted-foreground">{percentage}%</span>
                        {onAbort && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleStopClick}
                                disabled={stopping}
                                className="h-7 gap-1 border-red-200 px-2 text-xs text-red-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                                title="Stop the in-flight generation and refund credits"
                            >
                                {stopping ? (
                                    <>
                                        <CircleNotch className="size-3 animate-spin" />
                                        Stopping…
                                    </>
                                ) : (
                                    <>
                                        <Square className="size-3 fill-current" />
                                        Stop
                                    </>
                                )}
                            </Button>
                        )}
                    </div>
                </div>
                <Progress value={percentage} className="h-1.5" />
            </div>

            {/* ── Stage stepper ── */}
            <div className="flex items-start">
                {STAGES.map((stage, index) => {
                    const isCompleted = index < currentIndex;
                    const isCurrent = index === currentIndex;
                    const isPending = index > currentIndex;
                    const isLast = index === STAGES.length - 1;

                    return (
                        <div key={stage.id} className="flex flex-1 items-start">
                            <div className="flex flex-1 flex-col items-center gap-1">
                                <div
                                    className={`
                                        flex size-7 items-center justify-center rounded-full text-xs font-bold transition-all
                                        ${isCompleted ? 'bg-green-500 text-white' : ''}
                                        ${isCurrent ? 'bg-blue-500 text-white ring-2 ring-blue-200' : ''}
                                        ${isPending ? 'bg-muted text-muted-foreground' : ''}
                                    `}
                                >
                                    {isCompleted ? (
                                        <CheckCircle className="size-3.5" />
                                    ) : isCurrent ? (
                                        <CircleNotch className="size-3.5 animate-spin" />
                                    ) : (
                                        stage.icon
                                    )}
                                </div>
                                <div className="text-center">
                                    <div
                                        className={`text-xs font-medium leading-none ${
                                            isCurrent
                                                ? 'text-blue-600'
                                                : isCompleted
                                                  ? 'text-green-600'
                                                  : 'text-muted-foreground'
                                        }`}
                                    >
                                        {stage.label}
                                    </div>
                                    {isCurrent && (
                                        <div className="mt-0.5 text-2xs leading-none text-blue-400">
                                            {stage.description}
                                        </div>
                                    )}
                                </div>
                            </div>
                            {!isLast && (
                                <div
                                    className={`mx-1 mt-3.5 h-px flex-1 ${
                                        index < currentIndex ? 'bg-green-400' : 'bg-muted'
                                    }`}
                                />
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ── Status message ── */}
            {message && (
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-center text-xs text-blue-700">
                    {message}
                </div>
            )}

            {/* ── Shot progress + token usage (HTML phase only) ── */}
            {showShotProgress && (
                <ShotProgress
                    shotsCompleted={shotsCompleted}
                    shotsTotal={shotsTotal}
                    cumulativeTokens={cumulativeTokens}
                    recentErrors={recentErrors}
                    shotPlan={shotPlan}
                />
            )}

            {/* ── Stage result panels (appear progressively as each stage finishes) ── */}
            <div className="space-y-2">
                {scriptReady && (
                    <StagePanel
                        title="Script Generated"
                        icon={<FileText className="size-3.5" />}
                        defaultOpen={!audioReady}
                    >
                        <ScriptContent url={scriptUrl} />
                    </StagePanel>
                )}

                {audioReady && (
                    <StagePanel
                        title="Audio Ready"
                        icon={<SpeakerHigh className="size-3.5" />}
                        defaultOpen={!wordsReady}
                    >
                        <AudioContent url={audioUrl} />
                    </StagePanel>
                )}

                {wordsReady && (
                    <StagePanel
                        title="Word Timing Ready"
                        icon={<TextAlignLeft className="size-3.5" />}
                        defaultOpen={currentStage === 'WORDS' || currentStage === 'HTML'}
                    >
                        <WordsContent url={wordsUrl} />
                    </StagePanel>
                )}
            </div>
        </div>
    );
}
