import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, Info, Sparkle, WarningCircle, XCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { formatNumber } from '../../-utils/format';
import type { AiDraftJob } from '../../-stores/ai-draft-store';

/**
 * Step 2 of "Plan with AI": the draft being written.
 *
 * Reads the job from the draft store. With a server job it shows "Day 3 of 7 drafted"
 * and a real progress bar; against an older AI service (one synchronous call) it shows
 * an indeterminate state. Always: an elapsed timer, "usually 1–3 minutes", Cancel, and
 * the promise that closing the dialog keeps the draft going.
 *
 * A failed, cancelled or interrupted job shows why, whether credits were charged, and
 * Retry / Back to brief.
 */

export interface GeneratingStepProps {
    job: AiDraftJob;
    /** Ask to stop (the shell confirms first). */
    onCancel: () => void;
    /** Try the same brief again (a fresh attempt). */
    onRetry: () => void;
    /** Leave the job and edit the brief. */
    onBack: () => void;
    cancelling?: boolean;
}

/** "1:05" for 65 s; "12:00" for 720 s. */
export function formatElapsed(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(s / 60);
    return `${minutes}:${String(s % 60).padStart(2, '0')}`;
}

function useElapsed(startedAt: number, running: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    return Math.max(0, (now - startedAt) / 1000);
}

export function GeneratingStep({
    job,
    onCancel,
    onRetry,
    onBack,
    cancelling,
}: GeneratingStepProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const running = job.status === 'RUNNING';
    const elapsed = useElapsed(job.startedAt, running);

    if (!running) {
        const cancelled = job.status === 'CANCELLED';
        const message =
            job.error ??
            (job.errorKey ? t(job.errorKey, { count: job.credits }) : t('wizard.errors.draft'));
        return (
            <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-12 text-center">
                <span
                    className={cn(
                        'flex size-12 items-center justify-center rounded-full',
                        cancelled
                            ? 'bg-neutral-100 text-neutral-600'
                            : 'bg-danger-50 text-danger-600'
                    )}
                >
                    {cancelled ? (
                        <XCircle size={24} aria-hidden />
                    ) : (
                        <WarningCircle size={24} aria-hidden />
                    )}
                </span>
                <div className="space-y-1" role={cancelled ? 'status' : 'alert'}>
                    <p className="text-subtitle font-semibold text-neutral-900">
                        {cancelled
                            ? t('wizard.job.cancelledTitle')
                            : job.status === 'INTERRUPTED'
                              ? t('wizard.job.interruptedTitle')
                              : t('wizard.job.failedTitle')}
                    </p>
                    <p className="text-body text-neutral-600">{message}</p>
                    {!cancelled && job.mode === 'job' && (
                        <p className="text-caption text-neutral-500">
                            {t('wizard.job.notCharged')}
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                    <MyButton type="button" buttonType="secondary" scale="medium" onClick={onBack}>
                        {t('wizard.back')}
                    </MyButton>
                    <MyButton type="button" scale="medium" onClick={onRetry}>
                        <ArrowClockwise size={16} aria-hidden /> {t('wizard.job.retry')}
                    </MyButton>
                </div>
            </div>
        );
    }

    const total = Math.max(1, job.daysTotal);
    const done = job.daysDone != null ? Math.min(job.daysDone, total) : null;
    const determinate = job.mode === 'job' && done != null && done > 0;
    const percent = determinate ? Math.round((done / total) * 100) : null;

    return (
        <div className="mx-auto flex max-w-lg flex-col items-center gap-5 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 text-primary-500">
                <Sparkle size={24} weight="fill" className="animate-pulse" aria-hidden />
            </span>
            <div className="space-y-1">
                <p className="text-subtitle font-semibold text-neutral-900" aria-live="polite">
                    {determinate
                        ? t('wizard.job.progress', {
                              done: formatNumber(done, lang),
                              total: formatNumber(total, lang),
                          })
                        : t('wizard.generating', { count: total })}
                </p>
                <p className="text-caption text-neutral-500">
                    <span className="tabular-nums">{formatElapsed(elapsed)}</span>
                    {' · '}
                    {t('wizard.job.usually')}
                </p>
            </div>

            <div className="w-full">
                {percent != null ? (
                    // A plain track + fill (not ui/Progress: its root forces a white
                    // track, and its translateX fill runs the wrong way in RTL).
                    <div
                        className="h-2 w-full overflow-hidden rounded-full bg-primary-50"
                        role="progressbar"
                        aria-label={t('wizard.job.progressLabel')}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={percent}
                        aria-valuetext={t('wizard.job.progress', {
                            done: formatNumber(done ?? 0, lang),
                            total: formatNumber(total, lang),
                        })}
                    >
                        <div
                            className="h-full rounded-full bg-primary-500 transition-all"
                            style={{ inlineSize: `${percent}%` }} // design-lint-ignore: runtime percentage
                        />
                    </div>
                ) : (
                    // No per-day progress yet: an indeterminate bar (the whole track pulses),
                    // never a partial fill that would read as a real percentage.
                    <div
                        className="h-2 w-full animate-pulse rounded-full bg-primary-200"
                        role="progressbar"
                        aria-label={t('wizard.job.progressLabel')}
                        aria-busy="true"
                    />
                )}
            </div>

            <p className="flex items-start gap-2 rounded-md bg-neutral-50 px-3 py-2 text-start text-caption text-neutral-600">
                <Info size={14} className="mt-0.5 shrink-0 text-neutral-500" aria-hidden />
                <span>
                    {job.mode === 'job' ? t('wizard.job.background') : t('wizard.job.foreground')}
                </span>
            </p>

            <MyButton
                type="button"
                buttonType="secondary"
                scale="medium"
                disable={cancelling}
                onClick={onCancel}
            >
                <XCircle size={16} aria-hidden /> {t('wizard.job.cancel')}
            </MyButton>
        </div>
    );
}
