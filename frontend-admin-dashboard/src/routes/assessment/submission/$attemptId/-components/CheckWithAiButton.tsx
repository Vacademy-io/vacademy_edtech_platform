import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkle } from '@phosphor-icons/react';
import { Dialog } from '@/components/ui/dialog';
import { MyButton } from '@/components/design-system/button';
import { triggerAIEvaluation } from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-services/ai-evaluation-services';
import {
    ReCheckWithAIConfirm,
    useAiCheckCost,
} from '@/routes/assessment/assessment-list/assessment-details/$assessmentId/$examType/$assesssmentType/$assessmentTab/-components/submission-review/ai-check-confirm';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { allRows } from '@/services/submission-review/marks';
import type { SubmissionOutline } from '@/services/submission-review/types';
import { canEditMarks } from './actions';

const WRITTEN_TYPES = new Set(['LONG_ANSWER', 'CBE_RESPONSE']);

export const isRunActive = (status: string | null | undefined): boolean =>
    !!status && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(status.toUpperCase());

/**
 * Phase 1a "Check with AI": the short-term whole-attempt AI check (the same call as the
 * row menu's "Evaluate with AI"), with its price first. Before release only; while a run
 * is going the button waits.
 */
export const CheckWithAiButton = ({
    outline,
    onStarted,
    retry = false,
}: {
    outline: SubmissionOutline;
    /** The new run's id (the page shows its progress). */
    onStarted?: (processId: string) => void;
    /** "Retry" on an "AI couldn't mark" banner: the same priced check, small, before release only. */
    retry?: boolean;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const [confirmOpen, setConfirmOpen] = useState(false);

    const copy = outline.kind === 'HANDWRITTEN' || outline.kind === 'SCANNED';
    const rows = allRows(outline.sections);
    const written = rows.filter((r) => WRITTEN_TYPES.has((r.question_type ?? '').toUpperCase()));
    const teacherMarked = (copy ? rows : written).filter(
        (r) => r.marked_by_kind === 'TEACHER' || r.marked_by_kind === 'AI_REVIEWED'
    ).length;
    const offered = copy || written.length > 0;
    const cost = useAiCheckCost(offered && canEditMarks(outline), copy ? undefined : written.length);

    const start = useMutation({
        mutationFn: () => triggerAIEvaluation([outline.attempt_id]),
        onSuccess: (processIds) => {
            const processId = processIds[0];
            setConfirmOpen(false);
            if (!processId) {
                toast.error(t('ai.notStarted'));
                return;
            }
            toast.success(t('ai.started'));
            invalidateAttempt(queryClient, outline.attempt_id, outline.assessment_id);
            onStarted?.(processId);
        },
        onError: (error) => {
            const data = (error as { response?: { data?: { ex?: string; message?: string } } })?.response?.data;
            toast.error(data?.ex || data?.message || t('ai.notStarted'));
        },
    });

    if (!offered || !canEditMarks(outline)) return null;
    if (outline.release.status === 'RELEASED') {
        return retry ? null : <span className="text-caption text-neutral-500">{t('ai.afterRelease')}</span>;
    }
    const running = isRunActive(outline.ai_run?.status);
    const label = retry
        ? t('ai.retry')
        : copy
        ? cost.creditsPerPage != null
            ? t('ai.buttonCopy', { credits: cost.creditsPerPage })
            : t('ai.buttonPlain')
        : cost.credits != null
          ? t('ai.buttonTyped', { credits: cost.credits })
          : t('ai.buttonPlain');

    return (
        <>
            <MyButton
                type="button"
                buttonType="secondary"
                scale={retry ? 'small' : 'medium'}
                className="gap-1.5 sm:min-w-0"
                disabled={running || start.isPending || cost.isLoading}
                title={running ? t('ai.running') : undefined}
                onClick={() => setConfirmOpen(true)}
            >
                <Sparkle size={16} />
                {label}
            </MyButton>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                {confirmOpen && (
                    <ReCheckWithAIConfirm
                        student={{ full_name: outline.learner.name }}
                        cost={cost}
                        isStarting={start.isPending}
                        typedAnswers={!copy}
                        firstCheck={!outline.ai_run}
                        note={teacherMarked > 0 ? t('ai.teacherMarksKept', { count: teacherMarked }) : null}
                        onConfirm={() => start.mutate()}
                        onClose={() => setConfirmOpen(false)}
                    />
                )}
            </Dialog>
        </>
    );
};
