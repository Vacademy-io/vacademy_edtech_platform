import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowClockwise,
    ListChecks,
    PencilSimple,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AddEditCriteriaDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AddEditCriteriaDialog';
import type { CriteriaJson } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/criteria-services';
import {
    COPY_CHECK_CRITERIA_KEY,
    criteriaStatus,
    criteriaToCopyCheckRubric,
    getCopyCheckCriteria,
    saveCopyCheckCriteria,
    toEditableCriteria,
    toRubric,
    type CopyCheckCriteriaQuestion,
    type CriteriaStatus,
} from '@/services/copy-check-criteria';

const STATUS_CHIP: Record<CriteriaStatus, StatusType> = {
    SET: 'SUCCESS',
    FROM_QUESTION: 'WARNING',
    AI: 'INFO',
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** "Content (2) · Expression (1)" for a question's criteria, or null when it has none. */
const criteriaLine = (q: CopyCheckCriteriaQuestion): string | null => {
    const rubric = q.rubric ?? toRubric(q.question_criteria, q.max_marks);
    if (!rubric || rubric.rubric.length === 0) return null;
    return rubric.rubric
        .map((c) => `${c.criteria_name} (${fmt(Number(c.max_marks) || 0)})`)
        .join(' · ');
};

const errorMessage = (error: unknown, fallback: string): string => {
    const data = (error as { response?: { data?: { message?: string } } })?.response?.data;
    return data?.message || fallback;
};

/**
 * Every question of the paper with the criteria the AI checks it by, and an editor for
 * each. A saved change is used for every copy checked from then on.
 */
export const CopyCheckCriteriaDialog = ({
    open,
    onOpenChange,
    assessmentId,
    subject,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    subject?: string;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState<CopyCheckCriteriaQuestion | null>(null);
    const query = useQuery({
        queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId],
        queryFn: () => getCopyCheckCriteria(assessmentId),
        enabled: open && Boolean(assessmentId),
        staleTime: 30 * 1000,
    });
    const questions = useMemo(() => query.data?.questions ?? [], [query.data]);
    const counts = useMemo(() => {
        const c: Record<CriteriaStatus, number> = { SET: 0, FROM_QUESTION: 0, AI: 0 };
        questions.forEach((q) => (c[criteriaStatus(q)] += 1));
        return c;
    }, [questions]);

    const save = useMutation({
        mutationFn: (rubrics: Parameters<typeof saveCopyCheckCriteria>[1]) =>
            saveCopyCheckCriteria(assessmentId, rubrics, query.data?.rubric_version),
        onSuccess: (_version, rubrics) => {
            toast.success(t('criteria.saved', { count: Object.keys(rubrics).length }));
            queryClient.invalidateQueries({ queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId] });
        },
        onError: (error) => {
            toast.error(errorMessage(error, t('criteria.saveFailed')));
            queryClient.invalidateQueries({ queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId] });
        },
    });

    const applyQuestionCriteria = () => {
        const rubrics: Record<string, NonNullable<ReturnType<typeof toRubric>>> = {};
        questions
            .filter((q) => criteriaStatus(q) === 'FROM_QUESTION')
            .forEach((q) => {
                const rubric = toRubric(q.question_criteria, q.max_marks);
                if (rubric) rubrics[q.question_id] = rubric;
            });
        if (Object.keys(rubrics).length > 0) save.mutate(rubrics);
    };

    const onSaveOne = (q: CopyCheckCriteriaQuestion, criteria: CriteriaJson) => {
        save.mutate({
            [q.question_id]: criteriaToCopyCheckRubric(criteria, q.max_marks, q.rubric),
        });
    };

    return (
        <>
            <MyDialog
                open={open}
                onOpenChange={onOpenChange}
                heading={t('criteria.dialogTitle')}
                dialogWidth="max-w-4xl"
                footer={
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('criteria.done')}
                    </MyButton>
                }
            >
                <div className="flex flex-col gap-4 p-4">
                    <p className="text-body text-neutral-600">{t('criteria.dialogIntro')}</p>

                    {query.isLoading && (
                        <div className="flex flex-col gap-3">
                            {[0, 1, 2, 3].map((i) => (
                                <Skeleton key={i} className="h-20 w-full rounded-md" />
                            ))}
                        </div>
                    )}

                    {query.isError && (
                        <div className="flex items-start gap-3 rounded-md border border-danger-200 bg-danger-50 p-3">
                            <WarningCircle size={20} className="mt-0.5 shrink-0 text-danger-600" />
                            <div className="flex flex-1 flex-col gap-2">
                                <p className="text-body text-danger-700">
                                    {errorMessage(query.error, t('criteria.loadFailed'))}
                                </p>
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    className="w-fit"
                                    onClick={() => query.refetch()}
                                >
                                    <ArrowClockwise size={16} /> {t('criteria.retry')}
                                </MyButton>
                            </div>
                        </div>
                    )}

                    {query.isSuccess && questions.length === 0 && (
                        <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-body text-neutral-500">
                            {t('criteria.noQuestions')}
                        </p>
                    )}

                    {query.isSuccess && questions.length > 0 && (
                        <>
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusChip
                                    status="SUCCESS"
                                    textSize="text-caption"
                                    text={t('criteria.countSet', { count: counts.SET })}
                                />
                                {counts.FROM_QUESTION > 0 && (
                                    <StatusChip
                                        status="WARNING"
                                        textSize="text-caption"
                                        text={t('criteria.countFromQuestion', {
                                            count: counts.FROM_QUESTION,
                                        })}
                                    />
                                )}
                                {counts.AI > 0 && (
                                    <StatusChip
                                        status="INFO"
                                        showIcon={false}
                                        textSize="text-caption"
                                        text={t('criteria.countAi', { count: counts.AI })}
                                    />
                                )}
                                {counts.FROM_QUESTION > 0 && (
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        className="ml-auto"
                                        disabled={save.isPending}
                                        onClick={applyQuestionCriteria}
                                    >
                                        {t('criteria.useQuestionCriteria', {
                                            count: counts.FROM_QUESTION,
                                        })}
                                    </MyButton>
                                )}
                            </div>

                            <ul className="flex flex-col gap-2">
                                {questions.map((q) => {
                                    const status = criteriaStatus(q);
                                    const line = criteriaLine(q);
                                    return (
                                        <li
                                            key={q.question_id}
                                            className={cn(
                                                'flex items-start gap-3 rounded-md border p-3',
                                                status === 'SET'
                                                    ? 'border-neutral-200 bg-white'
                                                    : 'border-neutral-200 bg-neutral-50'
                                            )}
                                        >
                                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-caption font-semibold text-primary-600">
                                                Q{q.number}
                                            </span>
                                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-caption text-neutral-500">
                                                        {t('criteria.marks', {
                                                            marks: fmt(q.max_marks),
                                                            count: q.max_marks,
                                                        })}
                                                    </span>
                                                    <StatusChip
                                                        status={STATUS_CHIP[status]}
                                                        showIcon={status !== 'AI'}
                                                        textSize="text-caption"
                                                        text={t(`criteria.status.${status}`)}
                                                    />
                                                </div>
                                                <p className="line-clamp-2 text-body text-neutral-800">
                                                    {q.text || t('criteria.noText')}
                                                </p>
                                                <p className="flex items-center gap-1 text-caption text-neutral-500">
                                                    {line ? (
                                                        line
                                                    ) : (
                                                        <>
                                                            <Sparkle
                                                                size={14}
                                                                className="text-primary-400"
                                                            />
                                                            {t('criteria.aiWillWrite')}
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                            <MyButton
                                                buttonType="secondary"
                                                scale="small"
                                                disabled={save.isPending}
                                                onClick={() => setEditing(q)}
                                            >
                                                <PencilSimple size={16} />
                                                {status === 'AI'
                                                    ? t('criteria.add')
                                                    : t('criteria.edit')}
                                            </MyButton>
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                </div>
            </MyDialog>

            {editing && (
                <AddEditCriteriaDialog
                    open
                    question={{
                        id: editing.question_id,
                        text: editing.text,
                        question_type: editing.question_type,
                        max_marks: editing.max_marks,
                        subject,
                    }}
                    existingCriteria={toEditableCriteria(
                        editing.rubric ?? editing.question_criteria,
                        editing.max_marks
                    )}
                    onSave={(criteria) => onSaveOne(editing, criteria)}
                    onClose={() => setEditing(null)}
                />
            )}
        </>
    );
};

/**
 * "Evaluation criteria" in the copy-check dialogs: how many questions the AI checks by
 * saved criteria, and the way in to see and change them.
 */
export const CopyCheckCriteriaPanel = ({
    assessmentId,
    subject,
    disabled,
}: {
    assessmentId: string;
    subject?: string;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const [open, setOpen] = useState(false);
    const query = useQuery({
        queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId],
        queryFn: () => getCopyCheckCriteria(assessmentId),
        enabled: Boolean(assessmentId),
        staleTime: 30 * 1000,
    });
    const questions = query.data?.questions ?? [];
    const set = questions.filter((q) => criteriaStatus(q) === 'SET').length;
    const total = questions.length;

    return (
        <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
            <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50">
                    <ListChecks size={20} className="text-primary-500" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body font-medium text-neutral-800">
                        {t('criteria.title')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {query.isLoading
                            ? t('criteria.loading')
                            : query.isError
                              ? t('criteria.loadFailed')
                              : total === 0
                                ? t('criteria.noQuestions')
                                : t('criteria.summary', { set, total })}
                    </span>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    disabled={disabled || !assessmentId}
                    onClick={() => setOpen(true)}
                >
                    {set > 0 ? t('criteria.review') : t('criteria.addOpen')}
                </MyButton>
            </div>
            {total > 0 && (
                <Progress
                    value={Math.round((set / total) * 100)}
                    className="h-1.5 bg-neutral-100 [&>div]:bg-success-500"
                />
            )}
            <CopyCheckCriteriaDialog
                open={open}
                onOpenChange={setOpen}
                assessmentId={assessmentId}
                subject={subject}
            />
        </div>
    );
};

export default CopyCheckCriteriaPanel;
