import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { editMarks, parseApiError } from '@/services/submission-review/api';
import { invalidateAttempt } from '@/services/submission-review/query-keys';
import { isKeywordSuggestion } from '@/services/submission-review/labels';
import { formatMark, keywordKeepMarks, releaseTokenOf } from '@/services/submission-review/marks';
import type { QuestionRow, SubmissionOutline } from '@/services/submission-review/types';
import { canEditMarks } from './actions';

/**
 * "Keep X / Y" is a one-click teacher write, offered before release only: after release a
 * change needs a reason and tags the learner's result Revised, so Edit marks does it there.
 */
export const canKeepKeyword = (row: QuestionRow, outline: SubmissionOutline): boolean =>
    isKeywordSuggestion(row) && outline.release.status !== 'RELEASED' && canEditMarks(outline);

/** "Keyword match suggested 2 / 5" under a keyword-scored answer that still needs marking. */
export const KeywordSuggestedText = ({
    row,
    className,
}: {
    row: QuestionRow;
    className?: string;
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    if (!isKeywordSuggestion(row)) return null;
    return (
        <span
            className={cn('text-caption text-neutral-600', className)}
            data-testid="keyword-suggested"
        >
            {t('row.keywordSuggested', {
                marks: formatMark(row.marks),
                max: formatMark(row.max_marks),
            })}
        </span>
    );
};

type KeepVars = {
    row: QuestionRow;
    attemptId: string;
    assessmentId?: string;
    release: ReturnType<typeof releaseTokenOf>;
};

/**
 * Confirms a keyword suggestion with a normal teacher edit (A3) of the same mark, which the
 * server saves as Marked by the teacher. A negative keyword score is sent as 0 ("Use 0"):
 * a long answer cannot go below 0.
 *
 * The attempt travels in the mutation's variables, not the outline on screen: the teacher
 * can move to another learner before the response arrives (the side view and Prev / Next
 * keep this hook), and the refresh must hit the attempt that was edited. The keep stays
 * busy until that attempt's outline is refetched, so the stale button cannot be clicked
 * again (a second click would carry the old revision and fail with a 409).
 */
export const useKeepKeyword = (
    outline: SubmissionOutline | undefined,
    opts?: { onKept?: (attemptId: string) => void }
) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const queryClient = useQueryClient();
    const mutation = useMutation({
        mutationFn: ({ row, attemptId, release }: KeepVars) =>
            editMarks(attemptId, row.section_id, row.question_id, {
                marks: keywordKeepMarks(row),
                expected_revision: row.revision,
                expected_release: release,
            }),
        onSuccess: async (_res, { row, attemptId, assessmentId }) => {
            toast.success(
                t('actions.keptKeyword', {
                    number: row.question_number,
                    marks: formatMark(keywordKeepMarks(row)),
                    max: formatMark(row.max_marks),
                })
            );
            opts?.onKept?.(attemptId);
            // Returned to the mutation: it stays pending until the refetched rows are in.
            await invalidateAttempt(queryClient, attemptId, assessmentId);
        },
        onError: (e, { attemptId, assessmentId }) => {
            const code = parseApiError(e)?.code;
            if (code === 'STALE_REVISION' || code === 'RELEASE_CHANGED') {
                toast.error(t('actions.keepStale'));
                invalidateAttempt(queryClient, attemptId, assessmentId);
                return;
            }
            toast.error(parseApiError(e)?.message || t('actions.keepFailed'));
        },
    });
    const keep = (row: QuestionRow) => {
        if (!outline) return;
        mutation.mutate({
            row,
            attemptId: outline.attempt_id,
            assessmentId: outline.assessment_id,
            release: releaseTokenOf(outline.release),
        });
    };
    // Busy only on the attempt being kept: another learner's same question is not.
    const keepingKey =
        mutation.isPending && outline && mutation.variables?.attemptId === outline.attempt_id
            ? mutation.variables.row.key
            : null;
    return { keep, keepingKey, isPending: mutation.isPending };
};

/** "Keep 2 / 5" (or "Use 0" for a negative keyword score). */
export const KeepKeywordButton = ({
    row,
    onKeep,
    busy,
    buttonType = 'primary',
}: {
    row: QuestionRow;
    onKeep: (row: QuestionRow) => void;
    busy: boolean;
    buttonType?: 'primary' | 'secondary';
}) => {
    const { t } = useTranslation('assessmentSubmissionReview');
    const negative = row.marks < 0;
    const label = negative
        ? t('actions.useZero')
        : t('actions.keepKeyword', {
              marks: formatMark(keywordKeepMarks(row)),
              max: formatMark(row.max_marks),
          });
    return (
        <MyButton
            type="button"
            buttonType={buttonType}
            scale="small"
            className="gap-1 sm:min-w-0"
            disabled={busy}
            title={
                negative ? t('actions.useZeroHint', { marks: formatMark(row.marks) }) : undefined
            }
            onClick={() => onKeep(row)}
            data-testid={`keep-keyword-${row.key}`}
        >
            <Check size={14} weight="bold" />
            {label}
        </MyButton>
    );
};
