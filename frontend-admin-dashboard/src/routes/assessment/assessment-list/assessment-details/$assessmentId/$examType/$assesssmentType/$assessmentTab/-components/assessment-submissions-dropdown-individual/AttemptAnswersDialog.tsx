import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, Clock, PencilSimple, WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { sanitizeRichHtml } from '@/lib/sanitize-html';
import { optionsFromQuestionData } from '@/components/common/assessment/question-options-list';
import { CbeEvaluationView } from '@/components/common/cbe-review';
import {
    getAssessmentDetails,
    getQuestionDataForSection,
} from '@/routes/assessment/create-assessment/$assessmentId/$examtype/-services/assessment-services';
import { CodingAnswerReview } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-test-records/coding-answer-review';
import { CbeAnswerReview } from '@/routes/manage-students/students-list/-components/students-list/student-side-view/student-test-records/cbe-answer-review';
import type { QuestionData } from '@/types/assessments/assessment-steps';
import type { Steps } from '@/types/assessments/assessment-data-type';
import {
    overrideQuestionMarks,
    viewStudentReport,
} from '../../-services/assessment-details-services';
import {
    type AttemptAnswerRow,
    clampMarks,
    fullMarksOf,
    isChoiceQuestion,
    marksSourceKind,
    parseCriteria,
    parseKeyText,
    parseSavedAnswer,
    sortByPaperOrder,
} from '../../-utils/attempt-answers';
import { requestSubmissionsRefresh } from '../../-utils/submissions-refresh';

interface ReportDetail {
    all_sections?: Record<string, AttemptAnswerRow[]>;
    question_overall_detail_dto?: {
        achievedMarks?: number | null;
        correctAttempt?: number | null;
        partialCorrectAttempt?: number | null;
        wrongAttempt?: number | null;
        skippedCount?: number | null;
    } | null;
}

interface SectionInfo {
    id: string;
    name: string;
    order: number;
    totalMarks: number;
}

/** One question of the paper with this learner's marks row (absent when never reached). */
interface AnswerItem {
    questionId: string;
    sectionId: string;
    paper?: QuestionData;
    row?: AttemptAnswerRow;
}

const STATUS_CHIP: Record<string, StatusType> = {
    CORRECT: 'SUCCESS',
    PARTIAL_CORRECT: 'WARNING',
    INCORRECT: 'DANGER',
    PENDING: 'INFO',
};

const formatMarks = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? '0' : String(Math.round(value * 100) / 100);

const RichHtml = ({ html, className }: { html?: string | null; className?: string }) => (
    <div
        className={cn('custom-html-content min-w-0 break-words [&>p]:m-0', className)}
        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(html ?? '') }}
    />
);

/**
 * Submissions → ⋮ → View Submission for an online test: every question of the paper
 * with what the learner answered, the key, the marks and where they came from, and an
 * "Edit marks" control on each question (any type) for corrections or a bonus.
 */
export const AttemptAnswersDialog = ({
    open,
    onOpenChange,
    assessmentId,
    instituteId,
    attemptId,
    studentName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    assessmentId: string;
    instituteId: string | undefined;
    attemptId: string;
    studentName: string;
}) => {
    const { t } = useTranslation('assessmentAttemptAnswers');

    // The submissions table is reloaded only when this dialog closes: its rows are keyed
    // by position, so reloading while open (a re-sorted score column) could hand this
    // still-open dialog to another learner's row.
    const marksChangedRef = useRef(false);
    const handleOpenChange = (next: boolean) => {
        if (!next && marksChangedRef.current) {
            marksChangedRef.current = false;
            requestSubmissionsRefresh();
        }
        onOpenChange(next);
    };

    // The row menu caches this report under the same key (without the institute, which
    // is fixed for the session), so a saved mark refreshes both.
    const reportQuery = useQuery({
        // eslint-disable-next-line @tanstack/query/exhaustive-deps
        queryKey: ['GET_STUDENT_REPORT_DETAIL', assessmentId, attemptId],
        queryFn: () =>
            viewStudentReport(assessmentId, attemptId, instituteId) as Promise<ReportDetail>,
        enabled: open,
        refetchOnMount: 'always',
    });
    // Same key as the row menu's suspense query, so this is normally a cache hit.
    const detailsQuery = useQuery({
        ...getAssessmentDetails({ assessmentId, instituteId, type: 'EXAM' }),
        enabled: open && !!assessmentId,
    });

    const sections: SectionInfo[] = useMemo(() => {
        const steps = detailsQuery.data as Steps | undefined;
        const raw = steps?.[1]?.saved_data?.sections ?? [];
        return [...raw]
            .map((s, idx) => ({
                id: s.id,
                name: s.name,
                order: s.section_order ?? idx,
                totalMarks: Number(s.total_marks) || 0,
            }))
            .sort((a, b) => a.order - b.order);
    }, [detailsQuery.data]);

    const sectionIds = sections.map((s) => s.id).join(',');
    const questionsQuery = useQuery({
        ...getQuestionDataForSection({ assessmentId, sectionIds }),
        enabled: open && sectionIds.length > 0,
    });

    const itemsBySection = useMemo(() => {
        const report = reportQuery.data?.all_sections ?? {};
        const paper = (questionsQuery.data ?? {}) as Record<string, QuestionData[]>;
        const ids = sections.length ? sections.map((s) => s.id) : Object.keys(report);
        const out: Record<string, AnswerItem[]> = {};
        for (const sectionId of ids) {
            const rows = sortByPaperOrder(report[sectionId] ?? []);
            const rowById = new Map(rows.map((r) => [r.question_id, r] as const));
            const paperQuestions = [...(paper[sectionId] ?? [])].sort(
                (a, b) => (a.question_order ?? 0) - (b.question_order ?? 0)
            );
            const items: AnswerItem[] = paperQuestions.map((q) => ({
                questionId: q.question_id,
                sectionId,
                paper: q,
                row: rowById.get(q.question_id),
            }));
            // Rows whose question is no longer on the paper still carry marks.
            const onPaper = new Set(paperQuestions.map((q) => q.question_id));
            rows.filter((r) => !onPaper.has(r.question_id)).forEach((r) =>
                items.push({ questionId: r.question_id, sectionId, row: r })
            );
            out[sectionId] = items;
        }
        return out;
    }, [reportQuery.data, questionsQuery.data, sections]);

    const sectionTabs = sections.length
        ? sections
        : Object.keys(itemsBySection).map((id, idx) => ({
              id,
              name: '',
              order: idx,
              totalMarks: 0,
          }));
    const [selectedSection, setSelectedSection] = useState<string>('');
    const activeSection = sectionTabs.some((s) => s.id === selectedSection)
        ? selectedSection
        : sectionTabs[0]?.id ?? '';
    const activeItems = itemsBySection[activeSection] ?? [];

    const overall = reportQuery.data?.question_overall_detail_dto;
    const paperTotal = useMemo(() => {
        const fromSections = sections.reduce((sum, s) => sum + s.totalMarks, 0);
        if (fromSections > 0) return fromSections;
        const paper = (questionsQuery.data ?? {}) as Record<string, QuestionData[]>;
        return Object.values(paper)
            .flat()
            .reduce((sum, q) => sum + (fullMarksOf(q.marking_json) ?? 0), 0);
    }, [sections, questionsQuery.data]);

    const isLoading = reportQuery.isLoading || detailsQuery.isLoading || questionsQuery.isLoading;
    const isError = reportQuery.isError;

    return (
        <MyDialog
            heading={t('title', { name: studentName })}
            open={open}
            onOpenChange={handleOpenChange}
            dialogWidth="max-w-5xl"
        >
            {isLoading ? (
                <div className="flex flex-col items-center gap-2 py-10">
                    <DashboardLoader />
                    <p className="text-body text-neutral-500">{t('loading')}</p>
                </div>
            ) : isError ? (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <WarningCircle size={28} className="text-danger-600" />
                    <p className="text-body text-neutral-600">{t('loadError')}</p>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => reportQuery.refetch()}
                    >
                        {t('retry')}
                    </MyButton>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-caption text-neutral-500">{t('summary.marks')}</p>
                            <p className="text-h3 font-semibold text-neutral-800">
                                {formatMarks(overall?.achievedMarks)}
                                {paperTotal > 0 && (
                                    <span className="text-subtitle font-regular text-neutral-500">
                                        {' '}
                                        / {formatMarks(paperTotal)}
                                    </span>
                                )}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <StatusChip
                                status="SUCCESS"
                                showIcon={false}
                                textSize="text-caption"
                                text={`${t('summary.correct')}: ${overall?.correctAttempt ?? 0}`}
                            />
                            <StatusChip
                                status="WARNING"
                                showIcon={false}
                                textSize="text-caption"
                                text={`${t('summary.partial')}: ${overall?.partialCorrectAttempt ?? 0}`}
                            />
                            <StatusChip
                                status="DANGER"
                                showIcon={false}
                                textSize="text-caption"
                                text={`${t('summary.wrong')}: ${overall?.wrongAttempt ?? 0}`}
                            />
                            <StatusChip
                                status="INFO"
                                showIcon={false}
                                textSize="text-caption"
                                text={`${t('summary.skipped')}: ${overall?.skippedCount ?? 0}`}
                            />
                        </div>
                    </div>
                    <p className="text-caption text-neutral-500">{t('summary.note')}</p>

                    {sectionTabs.length > 1 && (
                        <Tabs value={activeSection} onValueChange={setSelectedSection}>
                            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-neutral-100 p-1">
                                {sectionTabs.map((s, idx) => (
                                    <TabsTrigger key={s.id} value={s.id}>
                                        {s.name || t('sectionFallback', { number: idx + 1 })}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                    )}

                    {activeItems.length === 0 ? (
                        <p className="py-8 text-center text-body text-neutral-500">{t('empty')}</p>
                    ) : (
                        <div className="flex flex-col gap-3">
                            {activeItems.map((item, idx) => (
                                <AnswerCard
                                    key={`${item.sectionId}:${item.questionId}`}
                                    number={idx + 1}
                                    item={item}
                                    assessmentId={assessmentId}
                                    instituteId={instituteId}
                                    attemptId={attemptId}
                                    onSaved={() => {
                                        marksChangedRef.current = true;
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </MyDialog>
    );
};

const AnswerCard = ({
    number,
    item,
    assessmentId,
    instituteId,
    attemptId,
    onSaved,
}: {
    number: number;
    item: AnswerItem;
    assessmentId: string;
    instituteId: string | undefined;
    attemptId: string;
    onSaved: () => void;
}) => {
    const { t } = useTranslation('assessmentAttemptAnswers');
    const queryClient = useQueryClient();
    const { paper, row } = item;

    const questionType = (paper?.question_type ?? row?.question_type ?? '').toUpperCase();
    const questionHtml = paper?.question?.content ?? row?.question_name ?? '';
    const keyJson = paper?.evaluation_json ?? row?.correct_options;
    const fullMarks = fullMarksOf(paper?.marking_json);
    const marks = row?.mark ?? 0;
    const status = (row?.answer_status ?? 'PENDING').toUpperCase();
    const source = marksSourceKind(row?.evaluation_source);
    const saved = parseSavedAnswer(row?.student_response_options);
    const criteria = parseCriteria(row?.ai_criteria_breakdown);

    const [editing, setEditing] = useState(false);
    const [marksInput, setMarksInput] = useState('');
    const [remark, setRemark] = useState('');
    const [inputError, setInputError] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: (value: number) =>
            overrideQuestionMarks(assessmentId, instituteId, attemptId, {
                section_id: item.sectionId,
                question_id: item.questionId,
                marks: value,
                // Empty box: '' clears a saved remark; undefined leaves an absent one alone.
                feedback: remark.trim() || (row?.evaluator_feedback ? '' : undefined),
            }),
        onSuccess: (result) => {
            toast.success(
                result?.attempt_total_marks != null
                    ? t('edit.saved', { total: formatMarks(result.attempt_total_marks) })
                    : t('edit.savedNoTotal')
            );
            setEditing(false);
            queryClient.invalidateQueries({
                queryKey: ['GET_STUDENT_REPORT_DETAIL', assessmentId, attemptId],
            });
            onSaved();
        },
        onError: (error: unknown) => {
            // The server's own reason (learner still writing, AI still checking, result
            // locked) says what to do; the generic text is only the fallback.
            const data = (error as { response?: { data?: { ex?: unknown; message?: unknown } } })
                ?.response?.data;
            const reason =
                typeof data?.ex === 'string'
                    ? data.ex
                    : typeof data?.message === 'string'
                      ? data.message
                      : null;
            toast.error(reason || t('edit.error'));
        },
    });

    const startEditing = () => {
        setMarksInput(formatMarks(marks));
        setRemark(row?.evaluator_feedback ?? '');
        setInputError(null);
        setEditing(true);
    };

    const save = () => {
        const value = Number(marksInput);
        if (
            marksInput.trim() === '' ||
            !Number.isFinite(value) ||
            value < 0 ||
            (fullMarks != null && fullMarks > 0 && value > fullMarks)
        ) {
            setInputError(
                fullMarks != null && fullMarks > 0
                    ? t('edit.invalid', { max: formatMarks(fullMarks) })
                    : t('edit.invalidNoMax')
            );
            return;
        }
        setInputError(null);
        mutation.mutate(clampMarks(value, fullMarks));
    };

    const options = paper ? optionsFromQuestionData(paper) : [];
    const picked = new Set(saved.optionIds);
    const keyText = parseKeyText(keyJson);
    const hasAnswer =
        saved.optionIds.length > 0 ||
        saved.text != null ||
        saved.numeric != null ||
        questionType === 'CODING' ||
        questionType === 'CBE_RESPONSE';

    return (
        <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-subtitle font-semibold text-neutral-800">
                        {t('question.label', { number })}
                    </span>
                    {questionType && (
                        <Badge variant="outline">
                            {t(`type.${questionType}`, { defaultValue: questionType })}
                        </Badge>
                    )}
                    <Badge variant={source === 'teacher' ? 'default' : 'secondary'}>
                        {t(`source.${source}`)}
                    </Badge>
                    {row?.time_taken_in_seconds != null && row.time_taken_in_seconds > 0 && (
                        <span className="flex items-center gap-1 text-caption text-neutral-500">
                            <Clock size={14} />
                            {t('question.time', { count: row.time_taken_in_seconds })}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <StatusChip
                        status={STATUS_CHIP[status] ?? 'INFO'}
                        showIcon={false}
                        textSize="text-caption"
                        text={t(`status.${status}`, { defaultValue: status })}
                    />
                    <span className="text-subtitle font-semibold text-neutral-800">
                        {fullMarks != null
                            ? t('question.outOf', {
                                  marks: formatMarks(marks),
                                  max: formatMarks(fullMarks),
                              })
                            : formatMarks(marks)}
                    </span>
                </div>
            </div>

            <RichHtml html={questionHtml} className="text-body text-neutral-700" />

            {questionType === 'CODING' ? (
                <CodingAnswerReview
                    studentResponse={row?.student_response_options}
                    correctOptions={keyJson}
                />
            ) : questionType === 'CBE_RESPONSE' ? (
                <CbeAnswerReview
                    studentResponse={row?.student_response_options}
                    correctOptions={keyJson}
                />
            ) : isChoiceQuestion(questionType) && options.length > 0 ? (
                <ol className="flex flex-col gap-1 text-body">
                    {options.map((opt, idx) => {
                        const isPicked = opt.id != null && picked.has(String(opt.id));
                        return (
                            <li
                                key={opt.id ?? idx}
                                className={cn(
                                    'flex items-start gap-2 rounded-md border px-3 py-2',
                                    isPicked && opt.isCorrect && 'border-success-300 bg-success-50',
                                    isPicked && !opt.isCorrect && 'border-danger-300 bg-danger-50',
                                    !isPicked && opt.isCorrect && 'border-success-200 bg-white',
                                    !isPicked &&
                                        !opt.isCorrect &&
                                        'border-neutral-200 bg-neutral-50'
                                )}
                            >
                                <span className="shrink-0 text-caption font-semibold text-neutral-600">
                                    ({String.fromCharCode(97 + idx)})
                                </span>
                                <RichHtml html={opt.name} className="flex-1 text-neutral-700" />
                                {isPicked && (
                                    <Badge variant="outline" className="shrink-0">
                                        {t('question.picked')}
                                    </Badge>
                                )}
                                {opt.isCorrect && (
                                    <CheckCircle
                                        size={16}
                                        weight="fill"
                                        className="mt-0.5 shrink-0 text-success-600"
                                        aria-label={t('question.correctAnswer')}
                                    />
                                )}
                            </li>
                        );
                    })}
                    {saved.optionIds.length === 0 && (
                        <li className="text-caption text-neutral-500">
                            {t('question.notAnswered')}
                        </li>
                    )}
                </ol>
            ) : (
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-caption font-semibold text-neutral-500">
                            {t('question.studentAnswer')}
                        </span>
                        {!hasAnswer ? (
                            <span className="text-body text-neutral-500">
                                {t('question.notAnswered')}
                            </span>
                        ) : saved.numeric != null ? (
                            <span className="text-body text-neutral-800">{saved.numeric}</span>
                        ) : saved.text != null ? (
                            <RichHtml
                                html={saved.text}
                                className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-3 text-body text-neutral-800"
                            />
                        ) : (
                            renderOptionIds(saved.optionIds)
                        )}
                    </div>
                    {keyText && (
                        <div className="flex flex-col gap-1">
                            <span className="text-caption font-semibold text-neutral-500">
                                {questionType === 'LONG_ANSWER'
                                    ? t('question.modelAnswer')
                                    : t('question.correctAnswer')}
                            </span>
                            <RichHtml
                                html={keyText}
                                className="rounded-md border border-success-200 bg-success-50 p-3 text-body text-neutral-800"
                            />
                        </div>
                    )}
                </div>
            )}

            {/* The AI's own marking, line by line (CBT parts, long answers): what it gave
                and why, so a teacher can decide before changing the marks. */}
            {criteria.length > 0 && (
                <div className="flex flex-col gap-2">
                    <span className="text-caption font-semibold text-neutral-500">
                        {t('question.aiMarking')}
                    </span>
                    <CbeEvaluationView
                        evaluation={{
                            marks_awarded: criteria.reduce((sum, c) => sum + (c.marks ?? 0), 0),
                            max_marks: fullMarks,
                            feedback: row?.ai_feedback ?? null,
                            criteria_breakdown: criteria,
                        }}
                    />
                </div>
            )}

            {(row?.evaluator_feedback || (row?.ai_feedback && criteria.length === 0)) &&
                !editing && (
                    <div className="flex flex-col gap-1 rounded-md bg-neutral-50 p-3 text-body text-neutral-700">
                        {row?.evaluator_feedback && (
                            <p>
                                <span className="font-semibold">{t('question.remark')}: </span>
                                {row.evaluator_feedback}
                            </p>
                        )}
                        {row?.ai_feedback &&
                            criteria.length === 0 &&
                            row.ai_feedback !== row.evaluator_feedback && (
                                <p>
                                    <span className="font-semibold">
                                        {t('question.aiFeedback')}:{' '}
                                    </span>
                                    {row.ai_feedback}
                                </p>
                            )}
                    </div>
                )}

            {editing ? (
                <div className="flex flex-col gap-3 rounded-md border border-primary-200 bg-primary-50 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <MyInput
                            inputType="number"
                            label={
                                fullMarks != null && fullMarks > 0
                                    ? t('edit.marksLabel', { max: formatMarks(fullMarks) })
                                    : t('edit.marksLabelNoMax')
                            }
                            input={marksInput}
                            onChangeFunction={(e) => setMarksInput(e.target.value)}
                            min={0}
                            max={fullMarks ?? undefined}
                            step="0.25"
                            size="medium"
                            error={inputError ?? undefined}
                            disabled={mutation.isPending}
                        />
                        <div className="flex flex-1 flex-col gap-1">
                            <span className="text-subtitle font-regular">
                                {t('edit.remarkLabel')}
                            </span>
                            <Textarea
                                value={remark}
                                onChange={(e) => setRemark(e.target.value)}
                                placeholder={t('edit.remarkPlaceholder')}
                                rows={2}
                                disabled={mutation.isPending}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setEditing(false)}
                            disabled={mutation.isPending}
                        >
                            {t('edit.cancel')}
                        </MyButton>
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="small"
                            onClick={save}
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending ? t('edit.saving') : t('edit.save')}
                        </MyButton>
                    </div>
                </div>
            ) : row ? (
                <div className="flex justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={startEditing}
                    >
                        <PencilSimple size={16} />
                        {t('edit.button')}
                    </MyButton>
                </div>
            ) : (
                // No marks row: the question was not in this learner's paper (added
                // later) or the submit's marking has not run yet. The server refuses
                // marks for it, so no edit is offered.
                <p className="text-right text-caption text-neutral-500">
                    {t('question.noMarksRow')}
                </p>
            )}
        </div>
    );
};

/** Choice answers on a question the paper no longer lists: show the raw ids. */
const renderOptionIds = (ids: string[]) =>
    ids.length > 0 ? <span className="text-body text-neutral-800">{ids.join(', ')}</span> : null;
