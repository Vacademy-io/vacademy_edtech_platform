import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    CheckCircle,
    Coins,
    FileX,
    Files,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { cn } from '@/lib/utils';
import {
    fetchAssignmentAiBulk,
    triggerAssignmentAiBulk,
} from '@/services/study-library/slide-operations/assignment-ai-evaluation';

export const ASSIGNMENT_AI_BULK_KEY = 'ASSIGNMENT_AI_BULK';

const plural = (count: number, one: string, other: string) => (count === 1 ? one : other);

const errorMessage = (err: unknown, fallback: string): string => {
    const data = (err as { response?: { data?: { ex?: string; message?: string } } })?.response
        ?.data;
    return data?.ex || data?.message || fallback;
};

/**
 * Check the assignment copies the learners submitted, all at once - the assignment
 * twin of the assessment "Check submitted copies with AI". Each learner's latest
 * submission that no teacher graded yet is queued, checked a few at a time in the
 * background with the default model, and the teacher gets one email + bell alert
 * when the batch is done. The AI marks only fill each grade form.
 */
export const AssignmentCheckSubmittedDialog = ({
    open,
    onOpenChange,
    slideId,
    packageSessionId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    slideId: string;
    /** The batch of learners being viewed; undefined = every learner on the slide. */
    packageSessionId?: string;
}) => {
    const queryClient = useQueryClient();
    const [includeChecked, setIncludeChecked] = useState(false);

    const preview = useQuery({
        queryKey: [ASSIGNMENT_AI_BULK_KEY, slideId, packageSessionId, includeChecked],
        queryFn: () => fetchAssignmentAiBulk(slideId, packageSessionId, includeChecked),
        enabled: open && !!slideId,
        staleTime: 0,
    });
    const p = preview.data;
    const toCheck = p?.to_check ?? 0;
    const withCopy = p ? p.submissions - p.no_files : 0;

    // The whole assignment is one question; each copy is charged on its own.
    const cost = useToolCostPreview(
        'copy_check_evaluation',
        { num_questions: 1 },
        open && toCheck > 0,
        Math.max(toCheck, 1)
    );

    const start = useMutation({
        mutationFn: () => triggerAssignmentAiBulk(slideId, packageSessionId, includeChecked),
        onSuccess: () => {
            toast.success(
                plural(
                    toCheck,
                    `${toCheck} submitted copy queued - the check runs in the background`,
                    `${toCheck} submitted copies queued - the checks run in the background`
                )
            );
            queryClient.invalidateQueries({ queryKey: [ASSIGNMENT_AI_BULK_KEY] });
            queryClient.invalidateQueries({ queryKey: ['ASSIGNMENT_AI_EVALUATION'] });
            onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(err, 'Could not start the AI check')),
    });

    const canStart =
        toCheck > 0 &&
        !!p?.total_marks_set &&
        !preview.isFetching &&
        !start.isPending &&
        cost.sufficient !== false;

    return (
        <MyDialog
            heading="Check submitted copies with AI"
            open={open}
            onOpenChange={(next) => {
                if (start.isPending) return;
                onOpenChange(next);
            }}
            dialogWidth="max-w-xl"
        >
            <div className="flex flex-col gap-4 p-4 sm:p-6">
                <p className="text-sm text-neutral-600">
                    Every copy the learners submitted on this assignment is queued for the AI
                    check, a few at a time, in the background. You will get an email and a bell
                    alert when it is done. The AI marks only fill each grade form - learners see
                    nothing until you save the grade.
                </p>

                {preview.isLoading ? (
                    <DashboardLoader height="6rem" />
                ) : preview.isError || !p ? (
                    <p className="flex items-start gap-2 rounded-md bg-danger-50 p-3 text-sm text-danger-700">
                        <WarningCircle size={18} className="mt-px shrink-0" />
                        Could not look up the submitted copies. Close and try again.
                    </p>
                ) : (
                    <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm">
                        <Row
                            icon={<Files size={18} className="text-primary-500" />}
                            label={plural(
                                withCopy,
                                `${withCopy} learner has submitted a copy`,
                                `${withCopy} learners have submitted a copy`
                            )}
                            hint={
                                p.no_files > 0
                                    ? plural(
                                          p.no_files,
                                          `${p.no_files} more submission has no uploaded file and is left out`,
                                          `${p.no_files} more submissions have no uploaded file and are left out`
                                      )
                                    : undefined
                            }
                        />
                        {p.already_graded > 0 && (
                            <Row
                                icon={<CheckCircle size={18} className="text-success-600" />}
                                label={`${p.already_graded} already graded by a teacher`}
                                hint="Left as they are"
                            />
                        )}
                        {p.already_ai_checked > 0 && (
                            <Row
                                icon={<CheckCircle size={18} className="text-primary-500" />}
                                label={`${p.already_ai_checked} already checked by AI`}
                                hint={
                                    includeChecked
                                        ? 'Will be checked again - the new marks replace the old ones'
                                        : 'Left as they are'
                                }
                            />
                        )}
                        {p.in_progress > 0 && (
                            <Row
                                icon={
                                    <ArrowsClockwise
                                        size={18}
                                        className="animate-spin text-primary-500"
                                    />
                                }
                                label={`${p.in_progress} being checked right now`}
                                hint="Not queued a second time"
                            />
                        )}
                        <Row
                            icon={
                                toCheck > 0 ? (
                                    <Sparkle size={18} weight="fill" className="text-primary-500" />
                                ) : (
                                    <FileX size={18} className="text-neutral-400" />
                                )
                            }
                            label={
                                toCheck > 0
                                    ? plural(
                                          toCheck,
                                          `${toCheck} copy will be checked`,
                                          `${toCheck} copies will be checked`
                                      )
                                    : 'Nothing to check - every submitted copy is graded, checked or in progress'
                            }
                            emphasis
                        />
                    </ul>
                )}

                {p && p.already_ai_checked > 0 && (
                    <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <Checkbox
                            checked={includeChecked}
                            onCheckedChange={(v) => setIncludeChecked(v === true)}
                        />
                        {plural(
                            p.already_ai_checked,
                            `Also re-check the ${p.already_ai_checked} copy that is already checked`,
                            `Also re-check the ${p.already_ai_checked} copies that are already checked`
                        )}
                    </label>
                )}

                {p && !p.total_marks_set && (
                    <p className="flex items-start gap-2 rounded-md bg-warning-50 p-3 text-sm text-warning-700">
                        <WarningCircle size={18} className="mt-px shrink-0" />
                        Set Total Marks on this assignment first - the AI marks out of it.
                    </p>
                )}

                <div
                    className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm',
                        cost.sufficient === false
                            ? 'border-danger-200 bg-danger-50 text-danger-700'
                            : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    )}
                >
                    <span className="flex items-center gap-2">
                        <Coins size={16} className="text-primary-500" />
                        {toCheck === 0
                            ? 'No copies to check.'
                            : cost.credits == null
                              ? 'Working out the cost...'
                              : `${toCheck} ${plural(toCheck, 'copy', 'copies')} · about ${cost.credits} credits`}
                    </span>
                    {cost.currentBalance != null && (
                        <span className="text-caption text-neutral-500">
                            Balance: {cost.currentBalance} credits
                        </span>
                    )}
                </div>
                {cost.sufficient === false && (
                    <p className="flex items-start gap-2 text-caption text-danger-600">
                        <WarningCircle size={16} className="mt-px shrink-0" />
                        Not enough AI credits for this check.
                    </p>
                )}

                <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        disabled={start.isPending}
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        disabled={!canStart}
                        onClick={() => start.mutate()}
                    >
                        {start.isPending
                            ? 'Queuing...'
                            : `Check ${toCheck} ${plural(toCheck, 'copy', 'copies')}`}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};

const Row = ({
    icon,
    label,
    hint,
    emphasis,
}: {
    icon: React.ReactNode;
    label: string;
    hint?: string;
    emphasis?: boolean;
}) => (
    <li className="flex items-start gap-3 px-3 py-2">
        <span className="mt-px shrink-0">{icon}</span>
        <span className="min-w-0 flex-1">
            <span
                className={cn(
                    'block',
                    emphasis ? 'font-semibold text-neutral-900' : 'text-neutral-800'
                )}
            >
                {label}
            </span>
            {hint && <span className="block text-caption text-neutral-500">{hint}</span>}
        </span>
    </li>
);

export default AssignmentCheckSubmittedDialog;
