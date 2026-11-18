import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    CaretLeft,
    CaretRight,
    Check,
    ClockCounterClockwise,
    DownloadSimple,
    Lightning,
    PaperPlaneTilt,
    PencilLine,
} from '@phosphor-icons/react';
import { Card, CardContent } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { formatDate, formatDateTime } from '@/lib/formatters';
import { getInstituteId } from '@/constants/helper';
import { stashEvalReturnUrl } from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { handleGetStudentReportExportPDF } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { ReleaseSubmissionDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/ReleaseSubmissionDialog';
import {
    HideResultDialog,
    SendUpdateDialog,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/ResultActionDialogs';
import { StatusPill } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/StatusPill';
import { acceptAiMarks, parseApiError } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { allRows, draftRevisions, formatMarkOutOf, releaseTokenOf } from '@/services/submission-review/marks';
import { markingLabel, resultLabel } from '@/services/submission-review/labels';
import { neighboursOf, useSubmissionNavStore } from '@/services/submission-review/nav-store';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { canEditMarks } from './actions';
import { CheckWithAiButton } from './CheckWithAiButton';

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
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const navIds = useSubmissionNavStore((s) => s.attemptIds);
    const nav = neighboursOf(navIds, outline.attempt_id);
    const [releaseOpen, setReleaseOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [hideOpen, setHideOpen] = useState(false);

    const rows = allRows(outline.sections);
    const released = outline.release.status === 'RELEASED';
    const editable = canEditMarks(outline);
    const copy = outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED';
    const marking = markingLabel(outline.marking, outline.counts);
    const result = resultLabel(
        !released ? 'NOT_RELEASED' : outline.release.changed_since_release ? 'RELEASED_CHANGED' : 'RELEASED'
    );

    const acceptAll = useMutation({
        // The drafts on screen, with their revisions: one the AI changed since is not accepted unseen.
        mutationFn: () => {
            const revisions = draftRevisions(rows);
            return acceptAiMarks(outline.attempt_id, Object.keys(revisions), releaseTokenOf(outline.release), revisions);
        },
        onSuccess: (res) => {
            toast.success(t('header.acceptedAi', { count: res.accepted }));
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
        },
        onError: (e) => {
            if (parseApiError(e)?.code === 'STALE_REVISION') {
                toast.error(t('header.acceptStale'));
                invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
                return;
            }
            toast.error(parseApiError(e)?.message || t('header.acceptFailed'));
        },
    });

    const download = useMutation({
        mutationFn: () => handleGetStudentReportExportPDF(outline.assessment_id, instituteId, outline.attempt_id),
        onSuccess: (blob: Blob) => {
            const objectUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.setAttribute('download', `Report_${(outline.learner.name || 'learner').replace(/[^\w.-]+/g, '_')}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(objectUrl);
        },
        onError: () => toast.error(t('header.downloadFailed')),
    });

    const openSheetTool = () => {
        stashEvalReturnUrl(window.location.href);
        navigate({
            to: '/evaluation/evaluate/$assessmentId/$attemptId/$examType',
            params: { assessmentId: outline.assessment_id, attemptId: outline.attempt_id, examType: 'EXAM' },
        });
    };

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

                <div className="flex flex-wrap items-center gap-2">
                    {editable && (
                        <MyButton
                            type="button"
                            buttonType={quickMode ? 'primary' : 'secondary'}
                            scale="medium"
                            className="gap-1.5 sm:min-w-0"
                            aria-pressed={quickMode}
                            onClick={() => onQuickMode(!quickMode)}
                        >
                            <Lightning size={16} />
                            {t('actions.quickMarks')}
                        </MyButton>
                    )}
                    <CheckWithAiButton outline={outline} onStarted={onAiStarted} />
                    {outline.permissions.can_release &&
                        (released ? (
                            <>
                                {/* Only when marks changed since the learner was last told. */}
                                {outline.release.changed_since_release && (
                                    <MyButton
                                        type="button"
                                        buttonType="primary"
                                        scale="medium"
                                        className="gap-1.5 sm:min-w-0"
                                        onClick={() => setSendOpen(true)}
                                    >
                                        <PaperPlaneTilt size={16} />
                                        {t('actions.sendUpdatedResult')}
                                    </MyButton>
                                )}
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="medium"
                                    className="sm:min-w-0"
                                    onClick={() => setHideOpen(true)}
                                >
                                    {t('actions.hideResultAgain')}
                                </MyButton>
                            </>
                        ) : (
                            <MyButton
                                type="button"
                                buttonType="primary"
                                scale="medium"
                                className="gap-1.5 sm:min-w-0"
                                onClick={() => setReleaseOpen(true)}
                            >
                                <PaperPlaneTilt size={16} weight="fill" />
                                {t('actions.releaseResult')}
                            </MyButton>
                        ))}
                    {editable && outline.counts.ai_draft > 0 && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 sm:min-w-0"
                            disabled={acceptAll.isPending}
                            onClick={() => acceptAll.mutate()}
                        >
                            <Check size={16} />
                            {t('actions.acceptAllAi', { count: outline.counts.ai_draft })}
                        </MyButton>
                    )}
                    {editable && copy && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="gap-1.5 sm:min-w-0"
                            onClick={openSheetTool}
                        >
                            <PencilLine size={16} />
                            {t('actions.markOnSheet')}
                        </MyButton>
                    )}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="gap-1.5 sm:min-w-0"
                        onClick={onHistory}
                    >
                        <ClockCounterClockwise size={16} />
                        {t('actions.history')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="gap-1.5 sm:min-w-0"
                        disabled={download.isPending}
                        onClick={() => download.mutate()}
                    >
                        <DownloadSimple size={16} />
                        {download.isPending ? t('header.downloading') : t('actions.downloadReport')}
                    </MyButton>
                </div>
            </CardContent>
            <ReleaseSubmissionDialog
                attemptId={outline.attempt_id}
                assessmentId={outline.assessment_id}
                learnerName={outline.learner.name}
                releaseToken={outline.release.token}
                aiDrafts={outline.counts.ai_draft}
                open={releaseOpen}
                onOpenChange={setReleaseOpen}
                onMarkNow={onMarkNow}
            />
            <SendUpdateDialog
                attemptId={outline.attempt_id}
                assessmentId={outline.assessment_id}
                learnerName={outline.learner.name}
                open={sendOpen}
                onOpenChange={setSendOpen}
            />
            <HideResultDialog
                attemptId={outline.attempt_id}
                assessmentId={outline.assessment_id}
                learnerName={outline.learner.name}
                open={hideOpen}
                onOpenChange={setHideOpen}
            />
        </Card>
    );
};
