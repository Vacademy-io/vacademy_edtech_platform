import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    Check,
    ClockCounterClockwise,
    DownloadSimple,
    Lightning,
    PaperPlaneTilt,
    PencilLine,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { getInstituteId } from '@/constants/helper';
import { stashEvalReturnUrl } from '@/routes/evaluation/evaluation-tool/-utils/eval-return';
import { handleGetStudentReportExportPDF } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/assessment-details-services';
import { ReleaseSubmissionDialog } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/ReleaseSubmissionDialog';
import {
    HideResultDialog,
    SendUpdateDialog,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/ResultActionDialogs';
import { acceptAiMarks, parseApiError } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { allRows, draftRevisions, releaseTokenOf } from '@/services/submission-review/marks';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { canEditMarks } from './actions';
import { CheckWithAiButton } from './CheckWithAiButton';

/**
 * The submission's actions (Quick marks, Check with AI, Release / Send update / Hide, Accept
 * all AI, Mark on sheet, History, Download report) with their dialogs. One component for
 * the Submission page header and the Submissions list's side view, so both offer the same.
 */
export const SubmissionActions = ({
    outline,
    quickMode = false,
    onQuickMode,
    onHistory,
    onAiStarted,
    onMarkNow,
    scale = 'medium',
    className,
}: {
    outline: SubmissionOutline;
    quickMode?: boolean;
    onQuickMode: (on: boolean) => void;
    onHistory: () => void;
    onAiStarted: (processId: string) => void;
    /** "Mark them now" in the release dialog. */
    onMarkNow: () => void;
    scale?: 'small' | 'medium';
    className?: string;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const instituteId = getInstituteId();
    const [releaseOpen, setReleaseOpen] = useState(false);
    const [sendOpen, setSendOpen] = useState(false);
    const [hideOpen, setHideOpen] = useState(false);

    const rows = allRows(outline.sections);
    const released = outline.release.status === 'RELEASED';
    const editable = canEditMarks(outline);
    const copy = outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED';

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

    return (
        <div className={cn('flex flex-wrap items-center gap-2', className)}>
            {editable && (
                <MyButton
                    type="button"
                    buttonType={quickMode ? 'primary' : 'secondary'}
                    scale={scale}
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
                                scale={scale}
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
                            scale={scale}
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
                        scale={scale}
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
                    scale={scale}
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
                    scale={scale}
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
                scale={scale}
                className="gap-1.5 sm:min-w-0"
                onClick={onHistory}
            >
                <ClockCounterClockwise size={16} />
                {t('actions.history')}
            </MyButton>
            <MyButton
                type="button"
                buttonType="secondary"
                scale={scale}
                className="gap-1.5 sm:min-w-0"
                disabled={download.isPending}
                onClick={() => download.mutate()}
            >
                <DownloadSimple size={16} />
                {download.isPending ? t('header.downloading') : t('actions.downloadReport')}
            </MyButton>
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
        </div>
    );
};
