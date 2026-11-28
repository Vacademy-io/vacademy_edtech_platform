import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    CaretDown,
    CaretUp,
    ListChecks,
    PencilSimple,
    Sparkle,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Skeleton } from '@/components/ui/skeleton';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { MathHtml } from '@/routes/knowledge-base/-components/paper/MathHtml';
import { AssessmentQuestionEditDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AssessmentQuestionEditDialog';
import { QuestionOptionsList } from '@/components/common/assessment/question-options-list';
import { useSaveCopyCheckCriteria } from '@/components/common/ai-copy-check/CopyCheckCriteriaPanel';
import { AddEditCriteriaDialog } from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-components/StepComponents/-components/AddEditCriteriaDialog';
import {
    COPY_CHECK_CRITERIA_KEY,
    criteriaStatus,
    criteriaToCopyCheckRubric,
    getCopyCheckCriteria,
    toEditableCriteria,
    toRubric,
    type CopyCheckCriteriaQuestion,
    type CriteriaStatus,
} from '@/services/copy-check-criteria';
import type { QuestionDataObject } from '@/types/assessments/assessment-steps';
import {
    buildPaperSections,
    type PaperQuestion,
    type PaperSection,
    type PaperSectionView,
} from '../-lib/paper-questions';
import { EditMarksDialog } from './EditMarksDialog';

const STATUS_CHIP: Record<CriteriaStatus, StatusType> = {
    SET: 'SUCCESS',
    FROM_QUESTION: 'WARNING',
    AI: 'INFO',
};

/** A long paper fills in as the teacher goes down it. */
const PAGE_SIZE = 20;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const QuestionCriteria = ({
    question,
    onEdit,
    disabled,
}: {
    question: CopyCheckCriteriaQuestion;
    onEdit: () => void;
    disabled: boolean;
}) => {
    const { t } = useTranslation('assessmentCopyIntake');
    const { t: tApp } = useTranslation('evalezy');
    const status = criteriaStatus(question);
    const items =
        (question.rubric ?? toRubric(question.question_criteria, question.max_marks))?.rubric ?? [];
    // The check scales saved criteria to the question's marks; say so when they differ.
    const itemsTotal = items.reduce((sum, item) => sum + (Number(item.max_marks) || 0), 0);
    const scaled = status === 'SET' && Math.abs(itemsTotal - question.max_marks) > 0.01;
    return (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-caption font-semibold text-neutral-700">
                    {t('criteria.title')}
                </span>
                <StatusChip
                    status={STATUS_CHIP[status]}
                    showIcon={status !== 'AI'}
                    textSize="text-caption"
                    text={t(`criteria.status.${status}`)}
                />
            </div>
            {items.length > 0 ? (
                <ul className="flex flex-col gap-2">
                    {items.map((item, index) => (
                        <li key={index} className="flex flex-col gap-1">
                            <div className="flex items-start justify-between gap-2 text-body text-neutral-800">
                                <span className="min-w-0 break-words">{item.criteria_name}</span>
                                <span className="shrink-0 font-medium">
                                    {fmt(Number(item.max_marks) || 0)}
                                </span>
                            </div>
                            {item.evaluation_guidelines && (
                                <p className="break-words text-caption text-neutral-500">
                                    {item.evaluation_guidelines}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="flex items-start gap-1 text-caption text-neutral-500">
                    <Sparkle size={14} className="mt-px shrink-0 text-primary-400" />
                    {t('criteria.aiWillWrite')}
                </p>
            )}
            {scaled && (
                <p className="text-caption text-warning-700">
                    {tApp('paper.criteriaScaled', {
                        total: fmt(itemsTotal),
                        marks: fmt(question.max_marks),
                    })}
                </p>
            )}
            <MyButton
                type="button"
                buttonType="secondary"
                scale="small"
                className="h-9 w-full sm:w-fit"
                disabled={disabled}
                onClick={onEdit}
            >
                <PencilSimple size={16} />
                {status === 'AI' ? t('criteria.add') : t('criteria.edit')}
            </MyButton>
        </div>
    );
};

const QuestionRow = ({
    assessmentId,
    question,
    criteriaLoading,
    savePending,
    onEdit,
    onEditMarks,
}: {
    assessmentId: string;
    question: PaperQuestion;
    criteriaLoading: boolean;
    savePending: boolean;
    onEdit: (question: CopyCheckCriteriaQuestion) => void;
    onEditMarks: (question: PaperQuestion) => void;
}) => {
    const { t } = useTranslation('evalezy');
    const { t: tIntake } = useTranslation('assessmentCopyIntake');
    const { criteria } = question;
    return (
        <li className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-caption font-semibold text-primary-600">
                    Q{question.number}
                </span>
                <span className="text-caption font-medium text-neutral-700">
                    {tIntake('criteria.marks', {
                        marks: fmt(question.marks),
                        count: question.marks,
                    })}
                </span>
                {question.negativeMarks > 0 && (
                    <span className="text-caption text-danger-600">
                        {t('paper.negative', { marks: fmt(question.negativeMarks) })}
                    </span>
                )}
            </div>
            <div className="min-w-0 overflow-x-auto text-body text-neutral-800">
                <MathHtml
                    html={sanitizeRichHtml(question.html)}
                    className="custom-html-content [&_img]:h-auto [&_img]:max-w-full"
                />
                <QuestionOptionsList options={question.options} typesetMath />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <AssessmentQuestionEditDialog
                    assessmentId={assessmentId}
                    sectionId={question.sectionId}
                    questionId={question.id}
                    examType="EXAM"
                    answerKeyOptional
                    triggerLabel={t('paper.editQuestion')}
                    triggerClassName="h-9 w-full"
                />
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    className="h-9 w-full"
                    disabled={savePending}
                    onClick={() => onEditMarks(question)}
                >
                    <PencilSimple size={16} />
                    {t('paper.editMarks')}
                </MyButton>
            </div>
            {criteriaLoading && <Skeleton className="h-20 w-full rounded-md" />}
            {criteria && (
                <QuestionCriteria
                    question={criteria}
                    disabled={savePending}
                    onEdit={() => onEdit(criteria)}
                />
            )}
        </li>
    );
};

/**
 * The question paper on the assessment page: every question with its marks and the
 * criteria the AI checks it by, editable right there. Closed by default so "Add copies"
 * stays in reach on a phone.
 */
export const PaperQuestionsCard = ({
    assessmentId,
    sections,
    questionsBySection,
    loading,
    failed,
    onRetry,
    paperTotalMarks,
    subject,
    disabled,
}: {
    assessmentId: string;
    sections: PaperSection[];
    questionsBySection: QuestionDataObject | undefined;
    loading: boolean;
    failed: boolean;
    onRetry: () => void;
    /** Sum of the sections' marks: the paper's out-of, which "answer any N" keeps right. */
    paperTotalMarks: number;
    subject?: string;
    disabled?: boolean;
}) => {
    const { t } = useTranslation('evalezy');
    const { t: tIntake } = useTranslation('assessmentCopyIntake');
    const [open, setOpen] = useState(false);
    const [visible, setVisible] = useState(PAGE_SIZE);
    const [editing, setEditing] = useState<CopyCheckCriteriaQuestion | null>(null);
    const [editingMarksId, setEditingMarksId] = useState<string | null>(null);

    const criteriaQuery = useQuery({
        queryKey: [COPY_CHECK_CRITERIA_KEY, assessmentId],
        queryFn: () => getCopyCheckCriteria(assessmentId),
        enabled: Boolean(assessmentId),
        staleTime: 30 * 1000,
    });
    const save = useSaveCopyCheckCriteria(assessmentId, criteriaQuery.data?.rubric_version);

    const paper = useMemo(
        () => buildPaperSections(sections, questionsBySection, criteriaQuery.data?.questions),
        [sections, questionsBySection, criteriaQuery.data]
    );
    const questions = paper.flatMap((section) => section.questions);
    const total = questions.length;
    const totalMarks =
        paperTotalMarks > 0 ? paperTotalMarks : questions.reduce((sum, q) => sum + q.marks, 0);
    const marksQuestion = questions.find((q) => q.id === editingMarksId) ?? null;
    const marksSection: PaperSectionView | null =
        paper.find((section) => section.id === marksQuestion?.sectionId) ?? null;
    const criteriaSet = questions.filter(
        (q) => q.criteria && criteriaStatus(q.criteria) === 'SET'
    ).length;

    if (failed) {
        return (
            <section className="flex items-start gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4">
                <WarningCircle size={20} className="mt-px shrink-0 text-danger-600" />
                <div className="flex flex-1 flex-col gap-2">
                    <p className="text-body text-danger-700">{t('paper.loadError')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        className="h-9 w-fit"
                        onClick={onRetry}
                    >
                        <ArrowClockwise size={16} />
                        {t('common.retry')}
                    </MyButton>
                </div>
            </section>
        );
    }
    if (loading) return <Skeleton className="h-20 w-full rounded-lg" />;
    if (total === 0) return null;

    let shown = 0;
    return (
        <section className="flex flex-col rounded-lg border border-neutral-200 bg-white">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center gap-3 p-4 text-start"
            >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-50">
                    <ListChecks size={20} className="text-primary-500" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-subtitle font-semibold text-neutral-800">
                        {t('paper.title')}
                    </span>
                    <span className="text-caption text-neutral-500">
                        {t('assessment.questions', { count: total })}
                        {' · '}
                        {tIntake('criteria.marks', {
                            marks: fmt(totalMarks),
                            count: totalMarks,
                        })}
                        {criteriaQuery.isSuccess &&
                            ` · ${t('paper.criteriaCount', { set: criteriaSet, total })}`}
                    </span>
                </span>
                {open ? (
                    <CaretUp size={16} className="shrink-0 text-neutral-500" />
                ) : (
                    <CaretDown size={16} className="shrink-0 text-neutral-500" />
                )}
            </button>

            {open && (
                <div className="flex flex-col gap-4 border-t border-neutral-200 p-4">
                    {criteriaQuery.isError && (
                        <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                            <WarningCircle size={18} className="mt-px shrink-0 text-warning-600" />
                            <div className="flex flex-1 flex-col gap-2">
                                <p className="text-body text-warning-700">
                                    {tIntake('criteria.loadFailed')}
                                </p>
                                <MyButton
                                    type="button"
                                    buttonType="secondary"
                                    scale="small"
                                    className="h-9 w-fit"
                                    onClick={() => void criteriaQuery.refetch()}
                                >
                                    <ArrowClockwise size={16} />
                                    {tIntake('criteria.retry')}
                                </MyButton>
                            </div>
                        </div>
                    )}

                    {paper.map((section) => {
                        const room = visible - shown;
                        if (room <= 0) return null;
                        const rows = section.questions.slice(0, room);
                        shown += rows.length;
                        return (
                            <div key={section.id} className="flex flex-col gap-3">
                                {paper.length > 1 && section.name && (
                                    <h3 className="text-body font-semibold text-neutral-700">
                                        {section.name}
                                    </h3>
                                )}
                                <ul className="flex flex-col gap-3">
                                    {rows.map((question) => (
                                        <QuestionRow
                                            key={question.id}
                                            assessmentId={assessmentId}
                                            question={question}
                                            criteriaLoading={criteriaQuery.isLoading}
                                            savePending={save.isPending || Boolean(disabled)}
                                            onEdit={setEditing}
                                            onEditMarks={(q) => setEditingMarksId(q.id)}
                                        />
                                    ))}
                                </ul>
                            </div>
                        );
                    })}

                    {visible < total && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            className="w-full"
                            onClick={() => setVisible((v) => v + PAGE_SIZE)}
                        >
                            {t('paper.showMore', { count: total - visible })}
                        </MyButton>
                    )}
                </div>
            )}

            {marksQuestion && marksSection && (
                <EditMarksDialog
                    assessmentId={assessmentId}
                    question={marksQuestion}
                    section={marksSection}
                    onClose={() => setEditingMarksId(null)}
                />
            )}

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
                    onSave={(criteria) =>
                        save.mutateAsync({
                            [editing.question_id]: criteriaToCopyCheckRubric(
                                criteria,
                                editing.max_marks,
                                editing.rubric
                            ),
                        })
                    }
                    onClose={() => setEditing(null)}
                />
            )}
        </section>
    );
};
