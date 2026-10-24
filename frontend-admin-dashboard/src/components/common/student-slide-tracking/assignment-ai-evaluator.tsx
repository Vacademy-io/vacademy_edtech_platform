import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, Sparkle, Spinner, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { getPublicUrl } from '@/services/upload_file';
import {
    AssignmentAiEvaluation,
    fetchAssignmentAiEvaluation,
    triggerAssignmentAiEvaluation,
} from '@/services/study-library/slide-operations/assignment-ai-evaluation';

const POLL_MS = 5000;

const errorMessage = (err: unknown, fallback: string): string => {
    const data = (err as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
};

/**
 * "Evaluate with AI" for one assignment submission - the assessment AI check with its
 * default model, grading the whole assignment as one answer out of its total marks. The
 * result only fills the grade form (onApply); the learner sees it once the teacher saves.
 */
export const AssignmentAiEvaluator = ({
    trackedId,
    hasFiles,
    onApply,
}: {
    trackedId: string;
    hasFiles: boolean;
    onApply: (evaluation: AssignmentAiEvaluation) => void;
}) => {
    const queryClient = useQueryClient();
    // The whole assignment is graded as one question.
    const cost = useToolCostPreview('copy_check_evaluation', { num_questions: 1 });
    const queryKey = ['ASSIGNMENT_AI_EVALUATION', trackedId];

    const { data: evaluation } = useQuery({
        queryKey,
        queryFn: () => fetchAssignmentAiEvaluation(trackedId),
        enabled: !!trackedId,
        // A failed lookup only hides the AI status line; the grade form works without it.
        retry: false,
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            return status === 'QUEUED' || status === 'PROCESSING' ? POLL_MS : false;
        },
    });

    // Fill the grade form when a check this teacher is watching finishes - not for an
    // old result found on open, which could overwrite a grade they already typed.
    const watchedRunId = useRef<string | null>(null);
    useEffect(() => {
        if (!evaluation) return;
        if (evaluation.status === 'QUEUED' || evaluation.status === 'PROCESSING') {
            watchedRunId.current = evaluation.id;
        } else if (watchedRunId.current === evaluation.id) {
            watchedRunId.current = null;
            if (evaluation.status === 'COMPLETED') {
                onApply(evaluation);
                toast.success('AI check done - review the marks, then save the grade', {
                    description: 'Not sent to the learner yet.',
                });
            }
        }
    }, [evaluation, onApply]);

    const triggerMutation = useMutation({
        mutationFn: () => triggerAssignmentAiEvaluation(trackedId),
        onSuccess: (run) => {
            queryClient.setQueryData(queryKey, run);
            if (run.status === 'FAILED') {
                toast.error(run.error_message || 'Could not start the AI check');
            } else {
                watchedRunId.current = run.id;
                toast.success('AI check started', {
                    description:
                        'You will get a notification and an email when it is ready for your review.',
                });
            }
        },
        onError: (err) => {
            toast.error(errorMessage(err, 'Could not start the AI check'));
        },
    });

    const handleViewCheckedCopy = async (fileId: string) => {
        const url = await getPublicUrl(fileId);
        if (url) window.open(url, '_blank');
    };

    const isRunning = evaluation?.status === 'QUEUED' || evaluation?.status === 'PROCESSING';
    const isDone = evaluation?.status === 'COMPLETED' || evaluation?.status === 'FAILED';

    return (
        <div className="flex flex-col gap-2">
            {isRunning && (
                <div className="flex items-center gap-2 rounded-md border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-700">
                    <Spinner size={14} className="shrink-0 animate-spin" />
                    <span>
                        {evaluation?.status === 'QUEUED'
                            ? 'Waiting in the AI queue...'
                            : 'AI is checking this copy. This takes a minute or two.'}
                    </span>
                </div>
            )}

            {evaluation?.status === 'COMPLETED' && (
                <div className="flex flex-col gap-1.5 rounded-md border border-primary-100 bg-primary-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-col gap-0.5">
                            <span className="w-fit rounded-full bg-warning-100 px-2 py-0.5 text-caption font-semibold text-warning-700">
                                Waiting for your review
                            </span>
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-700">
                                <Sparkle size={14} weight="fill" />
                                AI marks: {evaluation.marks_awarded ?? '-'}
                                {evaluation.max_marks != null && ` / ${evaluation.max_marks}`}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            {evaluation.evaluated_file_id && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    onClick={() =>
                                        handleViewCheckedCopy(evaluation.evaluated_file_id!)
                                    }
                                >
                                    <Eye size={12} /> Checked copy
                                </MyButton>
                            )}
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => onApply(evaluation)}
                            >
                                Use in grade
                            </MyButton>
                        </div>
                    </div>
                    {evaluation.feedback && (
                        <p className="line-clamp-3 text-xs text-neutral-700">
                            {evaluation.feedback}
                        </p>
                    )}
                    <p className="text-caption text-neutral-500">
                        Not sent to the learner. Check the marks and feedback, then press Save
                        Grade - only then does the learner see it.
                    </p>
                </div>
            )}

            {evaluation?.status === 'FAILED' && (
                <div className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2 text-xs text-danger-600">
                    <WarningCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{evaluation.error_message || 'The AI check failed.'}</span>
                </div>
            )}

            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="w-full"
                onClick={() => triggerMutation.mutate()}
                disabled={
                    !hasFiles || isRunning || triggerMutation.isPending || cost.sufficient === false
                }
                title={cost.sufficient === false ? 'Not enough AI credits' : undefined}
            >
                {triggerMutation.isPending ? (
                    <Spinner size={14} className="animate-spin" />
                ) : (
                    <Sparkle size={14} weight="fill" />
                )}
                {isDone ? 'Evaluate again with AI' : 'Evaluate with AI'}
                {cost.credits != null && (
                    <span className="text-caption text-neutral-500">
                        (~{cost.credits} credits)
                    </span>
                )}
            </MyButton>
        </div>
    );
};

export default AssignmentAiEvaluator;
