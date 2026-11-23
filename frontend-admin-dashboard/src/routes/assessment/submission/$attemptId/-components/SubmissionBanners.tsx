import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleNotch, Info, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { formatDate } from '@/lib/formatters';
import { useStopEvaluation } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import { allRows, formatMark } from '@/services/submission-review/marks';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { CheckWithAiButton, isRunActive } from './CheckWithAiButton';

const Banner = ({
    tone,
    icon,
    children,
    action,
}: {
    tone: 'warning' | 'info' | 'danger' | 'neutral';
    icon: ReactNode;
    children: ReactNode;
    action?: ReactNode;
}) => {
    const classes = {
        warning: 'border-warning-200 bg-warning-50 text-warning-700',
        info: 'border-info-200 bg-info-50 text-info-700',
        danger: 'border-danger-200 bg-danger-50 text-danger-700',
        neutral: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    }[tone];
    return (
        <div className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border px-4 py-3 ${classes}`}>
            <div className="flex min-w-0 flex-1 items-start gap-2 text-body">
                <span className="mt-0.5 shrink-0">{icon}</span>
                <div className="min-w-0">{children}</div>
            </div>
            {action}
        </div>
    );
};

/**
 * The page's warnings: released with unmarked answers (the Prepper case), marks changed
 * since release, the AI run in progress (with Stop), release waiting for marking, an
 * imported total, and a stored total that differs from the paper's rules.
 */
export const SubmissionBanners = ({
    outline,
    onAiStarted,
}: {
    outline: SubmissionOutline;
    /** A Retry started a new AI run (the page follows it). */
    onAiStarted?: (processId: string) => void;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const rows = allRows(outline.sections);
    const released = outline.release.status === 'RELEASED';
    const needs = rows.filter((r) => r.state === 'NEEDS_MARKING');
    const run = outline.ai_run;
    const running = isRunActive(run?.status);

    const stop = useMutation({
        ...useStopEvaluation(),
        onSuccess: () => {
            toast.success(t('ai.stopped'));
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
        },
        onError: () => toast.error(t('ai.stopFailed')),
    });

    return (
        <div className="flex flex-col gap-2">
            {released && needs.length > 0 && (
                <Banner tone="warning" icon={<WarningCircle size={18} weight="fill" />}>
                    {t('banners.releasedWithUnmarked', {
                        date: outline.release.released_at ? formatDate(outline.release.released_at) : '',
                        count: needs.length,
                        name: outline.learner.name,
                        questions: needs.map((r) => t('row.number', { number: r.question_number })).join(', '),
                    })}
                </Banner>
            )}
            {released && outline.release.changed_since_release && (
                <Banner tone="info" icon={<Info size={18} />}>
                    {t('banners.changedSinceRelease', { name: outline.learner.name })}
                </Banner>
            )}
            {running && run && (
                <Banner
                    tone="info"
                    icon={<CircleNotch size={18} className="animate-spin" />}
                    action={
                        outline.permissions.can_edit && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                disabled={stop.isPending}
                                onClick={() => stop.mutate(run.process_id)}
                            >
                                {stop.isPending ? t('ai.stopping') : t('ai.stop')}
                            </MyButton>
                        )
                    }
                >
                    {run.questions_total
                        ? t('banners.aiRunningProgress', {
                              done: run.questions_completed ?? 0,
                              total: run.questions_total,
                          })
                        : t('banners.aiRunning')}
                </Banner>
            )}
            {!running && run?.status === 'FAILED' && (
                <Banner
                    tone="danger"
                    icon={<WarningCircle size={18} weight="fill" />}
                    action={<CheckWithAiButton outline={outline} onStarted={onAiStarted} retry />}
                >
                    {t('banners.aiFailed', { reason: run.error_message || t('state.aiFailedFallback') })}
                </Banner>
            )}
            {!running && run?.status !== 'FAILED' && outline.counts.ai_failed > 0 && (
                <Banner
                    tone="danger"
                    icon={<WarningCircle size={18} weight="fill" />}
                    action={<CheckWithAiButton outline={outline} onStarted={onAiStarted} retry />}
                >
                    {t('banners.aiFailedSome', { count: outline.counts.ai_failed })}
                </Banner>
            )}
            {!released && outline.release.release_when_marked && (
                <Banner tone="info" icon={<Info size={18} />}>
                    {t('banners.releaseWhenMarked', { name: outline.learner.name })}
                </Banner>
            )}
            {outline.total_only && (
                <Banner tone="neutral" icon={<Info size={18} />}>
                    {t('banners.totalOnly', {
                        total: formatMark(outline.stored_total ?? outline.total),
                        max: formatMark(outline.max_total),
                    })}
                </Banner>
            )}
            {!outline.total_only &&
                outline.stored_total != null &&
                Math.abs(outline.stored_total - outline.total) > 0.005 && (
                    <Banner tone="neutral" icon={<Info size={18} />}>
                        {t('banners.totalDiffers', {
                            stored: formatMark(outline.stored_total),
                            total: formatMark(outline.total),
                        })}
                    </Banner>
                )}
        </div>
    );
};
