import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    CheckCircle,
    Flask,
    Hourglass,
    ShieldCheck,
    WarningCircle,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { clsx } from 'clsx';
import { cn } from '@/lib/utils';

/**
 * "Test game" / "Test deck": runs a task's HTML the way the learner app does, and
 * shows what the page reports when it finishes and what that would pay.
 *
 * - The HTML runs in an iframe with `sandbox="allow-scripts"` and NO
 *   `allow-same-origin`, so it gets an opaque origin: it cannot read this page, the
 *   admin's session, cookies or storage. Only messages from THIS frame's window are
 *   read, so another frame on the page can't fake a result.
 * - The protocol is the learner runtime's: `postMessage({type:'vacademy:complete',
 *   score, maxScore})`. Nothing else is listened for.
 * - Points use the server's rule (EngagementLearnerService, case GAME): the reported
 *   score is clamped to 0..the task's max score (the page's own maxScore is only a
 *   fallback when the task has none), completion points are always paid, and the
 *   score bonus `round(correctPoints × score / max)` is paid only when unverified
 *   scores are rewarded (institute setting) — a teacher can't mark a game verifiable.
 */

export const GAME_COMPLETE_MESSAGE = 'vacademy:complete';

/** Shown to the teacher when a game never reports; the exact call the page must make. */
export const GAME_COMPLETE_SNIPPET =
    "parent.postMessage({ type: 'vacademy:complete', score, maxScore }, '*')";

/** How long a run may go without a result before the "no result yet" hint appears. */
const STALL_MS = 60_000;

export interface GameRunResult {
    /** What the page sent, before clamping (null when it sent no usable number). */
    reported: number | null;
    /** The score the server would store. */
    score: number;
    /** The max shown: the task's, else the page's own (null when neither has one). */
    max: number | null;
    /** True when the reported score was outside 0..max and got clamped. */
    clamped: boolean;
    completion: number;
    bonus: number;
    total: number;
}

function finiteOrNull(value: unknown): number | null {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
}

/** The server's GAME payout for a reported result. Pure; exported for tests and reuse. */
export function scoreGameRun({
    reportedScore,
    reportedMax,
    taskMax,
    completionPoints,
    correctPoints,
    bonusEnabled,
}: {
    reportedScore: unknown;
    reportedMax?: unknown;
    taskMax?: number | null;
    completionPoints: number;
    correctPoints: number;
    bonusEnabled: boolean;
}): GameRunResult {
    const reported = finiteOrNull(reportedScore);
    const raw = reported ?? 0;
    const itemMax = taskMax != null && taskMax > 0 ? taskMax : null;
    // Server: max = item.maxScore ?? reported. The page's own maxScore is only used
    // for display when the task has none, never for the payout.
    const max = itemMax ?? (reported != null ? Math.max(reported, 0) : null);
    const score = max == null ? Math.max(0, raw) : Math.max(0, Math.min(raw, max));
    const completion = Math.max(0, completionPoints);
    const bonus =
        bonusEnabled && max != null && max > 0
            ? Math.round(Math.max(0, correctPoints) * (score / max))
            : 0;
    // Display the task's max; without one, the page's own claim (the payout above still
    // follows the server, which scores against the reported value).
    const shownMax = itemMax ?? finiteOrNull(reportedMax);
    return {
        reported,
        score,
        max: shownMax,
        clamped: itemMax != null && reported != null && reported !== score,
        completion,
        bonus,
        total: completion + bonus,
    };
}

export interface SandboxHarnessProps {
    /** The page to run, verbatim (a full document or a fragment). */
    html: string;
    /** Only changes the wording: a game, or a deck built as an HTML page. */
    kind?: 'game' | 'deck';
    /** The task's max score (GAME `maxScore`). */
    maxScore?: number | null;
    completionPoints?: number;
    correctPoints?: number;
    /** Whether a self-reported score earns the bonus (the institute's setting). */
    bonusEnabled?: boolean;
    /** Start with the test frame open. */
    defaultOpen?: boolean;
    className?: string;
}

export function SandboxHarness({
    html,
    kind = 'game',
    maxScore,
    completionPoints = 0,
    correctPoints = 0,
    bonusEnabled = false,
    defaultOpen = false,
    className,
}: SandboxHarnessProps) {
    const { t } = useTranslation('engagement');
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const [open, setOpen] = useState(defaultOpen);
    const [runId, setRunId] = useState(0);
    const [message, setMessage] = useState<{ score: unknown; maxScore: unknown } | null>(null);
    const [stalled, setStalled] = useState(false);
    const hasHtml = html.trim().length > 0;

    // Listen only while a run is on screen, and only to this frame.
    useEffect(() => {
        if (!open) return;
        const onMessage = (event: MessageEvent) => {
            if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
            const data = event.data as { type?: unknown; score?: unknown; maxScore?: unknown };
            if (!data || typeof data !== 'object' || data.type !== GAME_COMPLETE_MESSAGE) return;
            setMessage({ score: data.score, maxScore: data.maxScore });
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [open]);

    // A fresh run (open, restart, or new HTML) clears the last result.
    useEffect(() => {
        setMessage(null);
        setStalled(false);
        if (!open) return;
        const timer = window.setTimeout(() => setStalled(true), STALL_MS);
        return () => window.clearTimeout(timer);
    }, [open, runId, html]);

    const result = message
        ? scoreGameRun({
              reportedScore: message.score,
              reportedMax: message.maxScore,
              taskMax: maxScore,
              completionPoints,
              correctPoints,
              bonusEnabled,
          })
        : null;

    const testLabel =
        kind === 'deck' ? t('preview.harness.testDeck') : t('preview.harness.testGame');

    if (!open) {
        return (
            <div className={cn('flex flex-col items-start gap-1.5', className)}>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={!hasHtml}
                    onClick={() => {
                        setRunId((n) => n + 1);
                        setOpen(true);
                    }}
                >
                    <Flask size={16} aria-hidden="true" />
                    {testLabel}
                </MyButton>
                {!hasHtml && (
                    <p className="text-caption text-neutral-500">{t('preview.harness.noHtml')}</p>
                )}
            </div>
        );
    }

    return (
        <section
            aria-label={testLabel}
            className={cn(
                'overflow-hidden rounded-lg border border-neutral-200 bg-white',
                className
            )}
        >
            <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-1.5">
                <p className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-neutral-700">
                    <Flask size={14} className="shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{testLabel}</span>
                </p>
                <div className="flex shrink-0 items-center gap-1">
                    <MyButton
                        type="button"
                        buttonType="text"
                        scale="small"
                        onClick={() => setRunId((n) => n + 1)}
                    >
                        <ArrowClockwise size={14} aria-hidden="true" />
                        {t('preview.harness.restart')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="medium"
                        aria-label={t('preview.harness.close')}
                        title={t('preview.harness.close')}
                        onClick={() => setOpen(false)}
                    >
                        <X size={16} aria-hidden="true" />
                    </MyButton>
                </div>
            </div>

            {/* The result sits above the frame, so it shows without scrolling past the game. */}
            <div
                role="status"
                aria-live="polite"
                // clsx, not cn: tailwind-merge reads text-body as a colour and drops it.
                className={clsx(
                    'flex items-start gap-2 border-b px-3 py-2.5 text-body',
                    result
                        ? 'border-success-100 bg-success-50 text-success-700'
                        : stalled
                          ? 'border-warning-100 bg-warning-50 text-warning-700'
                          : 'border-neutral-100 bg-neutral-50 text-neutral-600'
                )}
            >
                {result ? (
                    <CheckCircle
                        size={18}
                        weight="fill"
                        className="mt-0.5 shrink-0"
                        aria-hidden="true"
                    />
                ) : stalled ? (
                    <WarningCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : (
                    <Hourglass size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 space-y-0.5">
                    {result ? (
                        <HarnessResultLines
                            result={result}
                            bonusEnabled={bonusEnabled}
                            correctPoints={correctPoints}
                            taskMax={maxScore}
                        />
                    ) : stalled ? (
                        <p>
                            {t('preview.harness.stall')}{' '}
                            <code className="break-all rounded-sm bg-white px-1 text-caption text-neutral-700">
                                {GAME_COMPLETE_SNIPPET}
                            </code>
                        </p>
                    ) : (
                        <p>
                            {kind === 'deck'
                                ? t('preview.harness.waitingDeck')
                                : t('preview.harness.waiting')}
                        </p>
                    )}
                </div>
            </div>

            <iframe
                key={runId}
                ref={frameRef}
                title={t('preview.harness.frameTitle')}
                // No allow-same-origin: an opaque origin keeps the page away from the app.
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={html}
                className="block h-96 w-full border-0 bg-white"
            />

            <p className="flex items-start gap-1.5 border-t border-neutral-100 px-3 py-2 text-caption text-neutral-500">
                <ShieldCheck
                    size={14}
                    className="mt-0.5 shrink-0 text-success-600"
                    aria-hidden="true"
                />
                <span className="min-w-0">{t('preview.harness.sandboxNote')}</span>
            </p>
        </section>
    );
}

function HarnessResultLines({
    result,
    bonusEnabled,
    correctPoints,
    taskMax,
}: {
    result: GameRunResult;
    bonusEnabled: boolean;
    correctPoints: number;
    taskMax?: number | null;
}) {
    const { t } = useTranslation('engagement');
    const showBonus = bonusEnabled && correctPoints > 0 && result.max != null;
    return (
        <>
            <p className="font-semibold tabular-nums">
                {result.reported == null
                    ? t('preview.harness.noScore', { completion: result.completion })
                    : result.max == null
                      ? t('preview.harness.receivedNoMax', {
                            score: result.score,
                            completion: result.completion,
                        })
                      : showBonus
                        ? t('preview.harness.received', {
                              score: result.score,
                              max: result.max,
                              completion: result.completion,
                              bonus: result.bonus,
                          })
                        : t('preview.harness.receivedNoBonus', {
                              score: result.score,
                              max: result.max,
                              completion: result.completion,
                          })}
            </p>
            {result.clamped && result.max != null && (
                <p className="text-caption">
                    {t('preview.harness.clamped', { reported: result.reported, max: result.max })}
                </p>
            )}
            {!bonusEnabled && correctPoints > 0 && (
                <p className="text-caption">{t('preview.harness.bonusOff')}</p>
            )}
            {bonusEnabled && correctPoints > 0 && (taskMax == null || taskMax <= 0) && (
                <p className="text-caption">{t('preview.harness.missingMax')}</p>
            )}
        </>
    );
}
