import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Info, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getMarkingSummary } from '@/services/submission-review/api';
import { submissionKeys } from '@/services/submission-review/query-keys';
import { useOpenSubmission } from './use-attempt-marking';

/**
 * W1 strip under the summary: "41 done · 3 need marking · 5 AI marks to check · 0 AI
 * checking", the "waiting for marking" reminder, and released results changed since.
 * "need marking" and "Show" open the Submission page and walk those learners.
 */
export const MarkingStatusLine = ({ assessmentId, refreshKey }: { assessmentId: string; refreshKey?: number }) => {
    const { t } = useTranslation('assessmentSubmissionReviewList');
    const openSubmission = useOpenSubmission();
    const { data, refetch } = useQuery({
        queryKey: submissionKeys.summary(assessmentId),
        queryFn: () => getMarkingSummary(assessmentId),
        enabled: !!assessmentId,
        staleTime: 15_000,
        retry: false,
    });

    useEffect(() => {
        if (refreshKey) void refetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshKey]);

    const s = data?.summary;
    if (!s || s.submitted === 0) return null;

    const walk = (ids: string[], source: 'needs_marking' | 'waiting') => {
        if (ids.length === 0) return;
        openSubmission(ids[0]!, {
            assessmentId,
            attemptIds: ids,
            source,
            search: source === 'needs_marking' ? { filter: 'needs_marking' } : {},
        });
    };

    const link = (label: string, onClick: () => void, disabled: boolean) => (
        <MyButton
            type="button"
            buttonType="text"
            scale="small"
            className="h-auto !p-0 font-semibold underline sm:min-w-0"
            disabled={disabled}
            onClick={onClick}
        >
            {label}
        </MyButton>
    );

    return (
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-body text-neutral-700">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="marking-status-line">
                <span>{t('strip.done', { count: s.done })}</span>
                <span aria-hidden>·</span>
                {link(
                    t('strip.needsMarking', { count: s.needs_marking }),
                    () => walk(s.needs_marking_attempt_ids, 'needs_marking'),
                    s.needs_marking === 0 || s.needs_marking_attempt_ids.length === 0
                )}
                <span aria-hidden>·</span>
                <span>{t('strip.checkAi', { count: s.check_ai })}</span>
                <span aria-hidden>·</span>
                <span>{t('strip.aiChecking', { count: s.ai_checking })}</span>
                {s.total_only > 0 && (
                    <>
                        <span aria-hidden>·</span>
                        <span>{t('strip.totalOnly', { count: s.total_only })}</span>
                    </>
                )}
            </p>
            {s.waiting_release_when_marked > 0 && (
                <p className="flex flex-wrap items-center gap-2 text-caption text-info-700">
                    <Info size={14} className="shrink-0" />
                    {t('strip.waiting', { count: s.waiting_release_when_marked })}
                    {link(t('strip.show'), () => walk(s.waiting_attempt_ids, 'waiting'), s.waiting_attempt_ids.length === 0)}
                </p>
            )}
            {s.released_changed > 0 && (
                <p className="flex items-center gap-2 text-caption text-warning-700">
                    <WarningCircle size={14} className="shrink-0" />
                    {t('strip.releasedChanged', { count: s.released_changed })}
                </p>
            )}
        </div>
    );
};
