import { useTranslation } from 'react-i18next';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { StatusPill } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/StatusPill';
import { allRows, formatMarkOutOf } from '@/services/submission-review/marks';
import { markingLabel, resultLabel } from '@/services/submission-review/labels';
import { neighboursOf, useSubmissionNavStore } from '@/services/submission-review/nav-store';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { SubmissionActions } from './SubmissionActions';

/**
 * W2 header: who and what, Prev / Next through the list the page was opened from, the
 * score, the counts, the release line and the actions (contract §9.7).
 */
export const SubmissionHeader = ({
    outline,
    quickMode,
    onQuickMode,
    onHistory,
    onNavigate,
    onAiStarted,
    onMarkNow,
}: {
    outline: SubmissionOutline;
    quickMode: boolean;
    onQuickMode: (on: boolean) => void;
    onHistory: () => void;
    /** Go to another attempt (keeps the mode and filter). */
    onNavigate: (attemptId: string) => void;
    onAiStarted: (processId: string) => void;
    /** "Mark them now" in the release dialog. */
    onMarkNow: () => void;
}) => {
    const { t } = useTranslation(['assessmentSubmissionReview', 'assessmentSubmissionReviewList']);
    const navIds = useSubmissionNavStore((s) => s.attemptIds);
    const nav = neighboursOf(navIds, outline.attempt_id);

    const rows = allRows(outline.sections);
    const released = outline.release.status === 'RELEASED';
    const marking = markingLabel(outline.marking, outline.counts);
    const result = resultLabel(
        !released ? 'NOT_RELEASED' : outline.release.changed_since_release ? 'RELEASED_CHANGED' : 'RELEASED'
    );

    const kindLabel = t(`kind.${outline.kind}`);
    return (
        <Card className="border-neutral-200 shadow-sm">
            <CardContent className="flex flex-col gap-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="truncate text-h3 font-semibold text-neutral-900">
                            {t('header.title', {
                                name: outline.learner.name,
                                test: outline.assessment_name,
                            })}
                        </h1>
                        <p className="mt-0.5 text-body text-neutral-500">
                            {[
                                outline.attempts_total > 1
                                    ? t('header.attempt', { n: outline.attempt_number, m: outline.attempts_total })
                                    : null,
                                outline.submitted_at
                                    ? t('header.submitted', { date: formatDateTime(outline.submitted_at) })
                                    : null,
                                kindLabel,
                                t('header.sections', { count: outline.sections.length }),
                                t('header.questions', { count: rows.length }),
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </p>
                    </div>
                    {nav && (
                        <div className="flex shrink-0 items-center gap-1">
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="gap-1 sm:min-w-0"
                                disabled={!nav.prev}
                                onClick={() => nav.prev && onNavigate(nav.prev)}
                            >
                                <CaretLeft size={14} className="rtl:rotate-180" />
                                {t('header.prev')}
                            </MyButton>
                            <span className="px-1 text-caption tabular-nums text-neutral-500">
                                {t('header.position', { n: nav.index + 1, m: navIds.length })}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                className="gap-1 sm:min-w-0"
                                disabled={!nav.next}
                                onClick={() => nav.next && onNavigate(nav.next)}
                            >
                                {t('header.next')}
                                <CaretRight size={14} className="rtl:rotate-180" />
                            </MyButton>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body">
                    <span className="text-subtitle font-semibold text-neutral-900" data-testid="submission-score">
                        {t('header.score', { score: formatMarkOutOf(outline.total, outline.max_total) })}
                    </span>
                    <StatusPill tone={marking.tone}>{t(`assessmentSubmissionReviewList:${marking.key}`, marking.params)}</StatusPill>
                    <span className="text-neutral-600">
                        {[
                            outline.counts.needs_marking > 0 ? t('header.countNeeds', { count: outline.counts.needs_marking }) : null,
                            outline.counts.ai_draft > 0 ? t('header.countAi', { count: outline.counts.ai_draft }) : null,
                            t('header.countMarked', { count: outline.counts.marked }),
                            outline.counts.not_answered > 0
                                ? t('header.countNotAnswered', { count: outline.counts.not_answered })
                                : null,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                    <StatusPill tone={result.tone}>
                        {released && outline.release.released_at && !outline.release.changed_since_release
                            ? t('header.releasedOn', { date: formatDate(outline.release.released_at) })
                            : t(`assessmentSubmissionReviewList:${result.key}`)}
                    </StatusPill>
                </div>

                <SubmissionActions
                    outline={outline}
                    quickMode={quickMode}
                    onQuickMode={onQuickMode}
                    onHistory={onHistory}
                    onAiStarted={onAiStarted}
                    onMarkNow={onMarkNow}
                />
            </CardContent>
        </Card>
    );
};
