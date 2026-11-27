import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CheckCircle, Circle, Clock, RadioButton } from '@phosphor-icons/react';
import { StatusChips } from '@/components/design-system/chips';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatMark } from '@/services/submission-review/marks';
import { RichContentRenderer } from '@/routes/assessment/assessment-list/offline-entry/$assessmentId/-components/RichContentRenderer';
import {
    optionLetter,
    type PaperQuestion,
} from '@/routes/assessment/submission/$attemptId/-utils/paper';
import type { ReportQuestion } from '@/types/assessments/assessment-data-report';
import { CodingAnswerReview } from './coding-answer-review';
import { CbeAnswerReview } from './cbe-answer-review';
import {
    durationParts,
    parseCorrectAnswer,
    parseStudentAnswer,
    reviewStatusOf,
    type ReportAnswer,
    type ReviewStatus,
} from './report-answer';

/** "24 sec", "1 min 12 sec", "1 hr 5 min". */
export const formatDuration = (t: TFunction, totalSeconds: number | null | undefined): string => {
    const { hours, minutes, seconds } = durationParts(totalSeconds);
    if (hours > 0) return t('duration.hoursMinutes', { hours, minutes });
    if (minutes > 0) {
        return seconds > 0
            ? t('duration.minutesSeconds', { minutes, seconds })
            : t('duration.minutes', { minutes });
    }
    return t('duration.seconds', { value: seconds });
};

/** "+4", "+1.33", "0", "-1". */
export const signedMark = (marks: number | null | undefined): string => {
    const value = Number(marks) || 0;
    return value > 0 ? `+${formatMark(value)}` : formatMark(value);
};

const isCodeOrCbe = (type: string | null | undefined) =>
    type === 'CODING' || type === 'CBE_RESPONSE';

/** CODING / CBE responses are not option or text answers; any stored response counts. */
const hasRawResponse = (raw: unknown) =>
    typeof raw === 'string' ? raw.trim().length > 2 : raw != null;

export const reviewStatusOfQuestion = (question: ReportQuestion): ReviewStatus => {
    const answered = isCodeOrCbe(question.question_type)
        ? hasRawResponse(question.student_response_options)
        : parseStudentAnswer(question.student_response_options).kind !== 'NONE';
    return reviewStatusOf(question.answer_status, answered);
};

const STATUS_CHIP: Record<
    ReviewStatus,
    'active' | 'pending' | 'error' | 'evaluating' | 'inactive'
> = {
    CORRECT: 'active',
    PARTIAL: 'pending',
    WRONG: 'error',
    PENDING: 'evaluating',
    SKIPPED: 'inactive',
};

const STATUS_ACCENT: Record<ReviewStatus, string> = {
    CORRECT: 'border-l-success-400',
    PARTIAL: 'border-l-warning-400',
    WRONG: 'border-l-danger-400',
    PENDING: 'border-l-warning-200',
    SKIPPED: 'border-l-neutral-200',
};

export const STATUS_LABEL_KEY: Record<ReviewStatus, string> = {
    CORRECT: 'status.correct',
    PARTIAL: 'status.partial',
    WRONG: 'status.wrong',
    PENDING: 'status.pending',
    SKIPPED: 'status.skipped',
};

const Label = ({ children }: { children: ReactNode }) => (
    <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-neutral-500">
        {children}
    </p>
);

const RICH = 'text-body text-neutral-800 [&_img]:max-w-full [&_p]:my-0';

/** The paper's options with the learner's choice and the correct one marked. */
const OptionsReview = ({
    paper,
    paperLoading,
    chosen,
    correct,
}: {
    paper: PaperQuestion | null;
    paperLoading: boolean;
    chosen: string[];
    correct: string[];
}) => {
    const { t } = useTranslation('manageStudentsTestReportDialog');
    const options = paper?.options_with_explanation ?? [];
    if (options.length === 0) {
        if (paperLoading) {
            return (
                <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            );
        }
        return <p className="text-caption text-neutral-500">{t('answer.optionsUnavailable')}</p>;
    }
    const chosenSet = new Set(chosen);
    const correctSet = new Set(correct);
    // A choice is "wrong" only against a key; without one it is just the choice.
    const hasKey = correctSet.size > 0;
    // The question was edited after the test: the chosen option is gone from the paper.
    const listed = new Set(options.map((option) => option.id));
    const choiceMissing = chosen.some((id) => !listed.has(id));
    return (
        <div>
            <ul className="flex flex-col gap-1.5">
                {options.map((option, index) => {
                    const isChosen = chosenSet.has(option.id);
                    const isCorrect = correctSet.has(option.id);
                    return (
                        <li
                            key={option.id}
                            className={cn(
                                'flex items-start gap-2 rounded-md border px-3 py-2',
                                isCorrect
                                    ? 'border-success-200 bg-success-50'
                                    : isChosen && hasKey
                                      ? 'border-danger-200 bg-danger-50'
                                      : isChosen
                                        ? 'border-primary-200 bg-primary-50'
                                        : 'border-neutral-200'
                            )}
                        >
                            <span className="mt-0.5 shrink-0 text-neutral-500">
                                {isChosen ? (
                                    <RadioButton size={16} weight="fill" />
                                ) : (
                                    <Circle size={16} />
                                )}
                            </span>
                            <span className="w-5 shrink-0 font-semibold text-neutral-600">
                                {optionLetter(index)}
                            </span>
                            <RichContentRenderer
                                html={option.text?.content ?? ''}
                                className={cn('min-w-0 flex-1', RICH)}
                            />
                            <span className="flex shrink-0 flex-col items-end gap-0.5 text-caption">
                                {isChosen && (
                                    <span
                                        className={cn(
                                            'font-medium',
                                            isCorrect || !hasKey
                                                ? 'text-neutral-700'
                                                : 'text-danger-600'
                                        )}
                                    >
                                        {t('answer.learnerChoice')}
                                    </span>
                                )}
                                {isCorrect && (
                                    <span className="inline-flex items-center gap-1 font-medium text-success-700">
                                        <CheckCircle size={12} weight="fill" />
                                        {t('answer.correct')}
                                    </span>
                                )}
                            </span>
                        </li>
                    );
                })}
            </ul>
            {chosen.length === 0 && (
                <p className="mt-2 text-caption text-neutral-500">{t('answer.noOptionChosen')}</p>
            )}
            {choiceMissing && (
                <p className="mt-2 text-caption text-warning-700">{t('answer.choiceNotOnPaper')}</p>
            )}
        </div>
    );
};

const AnswerBox = ({
    title,
    answer,
    tone,
}: {
    title: string;
    answer: ReportAnswer;
    tone: 'success' | 'danger' | 'neutral';
}) => {
    const { t } = useTranslation('manageStudentsTestReportDialog');
    return (
        <div
            className={cn(
                'rounded-md border px-3 py-2.5',
                tone === 'success'
                    ? 'border-success-200 bg-success-50'
                    : tone === 'danger'
                      ? 'border-danger-200 bg-danger-50'
                      : 'border-neutral-200 bg-neutral-50'
            )}
        >
            <Label>{title}</Label>
            {answer.kind === 'VALUES' ? (
                <p className="text-body font-semibold text-neutral-800">
                    {answer.values.join(' / ')}
                </p>
            ) : answer.kind === 'TEXT' ? (
                <RichContentRenderer html={answer.text} className={RICH} />
            ) : answer.kind === 'OPTION_TEXTS' ? (
                <div className="flex flex-col gap-1">
                    {answer.texts.map((text, index) => (
                        <RichContentRenderer key={index} html={text} className={RICH} />
                    ))}
                </div>
            ) : (
                <p className="text-body text-neutral-500">{t('review.noResponse')}</p>
            )}
        </div>
    );
};

const AnswerBody = ({
    question,
    status,
    paper,
    paperLoading,
}: {
    question: ReportQuestion;
    status: ReviewStatus;
    paper: PaperQuestion | null;
    paperLoading: boolean;
}) => {
    const { t } = useTranslation('manageStudentsTestReportDialog');
    if (question.question_type === 'CODING') {
        return (
            <CodingAnswerReview
                studentResponse={question.student_response_options}
                correctOptions={question.correct_options}
            />
        );
    }
    if (question.question_type === 'CBE_RESPONSE') {
        return (
            <CbeAnswerReview
                studentResponse={question.student_response_options}
                correctOptions={question.correct_options}
            />
        );
    }
    const student = parseStudentAnswer(question.student_response_options);
    const correct = parseCorrectAnswer(question.correct_options);
    const hasPaperOptions = (paper?.options_with_explanation?.length ?? 0) > 0;
    if (
        student.kind === 'OPTIONS' ||
        correct.kind === 'OPTIONS' ||
        (student.kind === 'NONE' && hasPaperOptions)
    ) {
        return (
            <OptionsReview
                paper={paper}
                paperLoading={paperLoading}
                chosen={student.kind === 'OPTIONS' ? student.optionIds : []}
                correct={correct.kind === 'OPTIONS' ? correct.optionIds : []}
            />
        );
    }
    const showCorrect = correct.kind !== 'NONE' && status !== 'CORRECT';
    return (
        <div className={cn('grid gap-3', showCorrect && 'sm:grid-cols-2')}>
            <AnswerBox
                title={t('answer.learnerAnswer')}
                answer={student}
                tone={status === 'CORRECT' ? 'success' : status === 'WRONG' ? 'danger' : 'neutral'}
            />
            {showCorrect && (
                <AnswerBox title={t('answer.correctAnswer')} answer={correct} tone="success" />
            )}
        </div>
    );
};

/** One question of the answer review: result, marks, time, the answer and its key. */
export const ReportQuestionCard = ({
    question,
    number,
    paper,
    paperLoading,
}: {
    question: ReportQuestion;
    number: number;
    paper: PaperQuestion | null;
    paperLoading: boolean;
}) => {
    const { t } = useTranslation('manageStudentsTestReportDialog');
    const status = reviewStatusOfQuestion(question);
    const mark = Number(question.mark) || 0;
    return (
        <article
            className={cn(
                'flex flex-col gap-4 rounded-lg border border-l-4 border-neutral-200 bg-white p-5',
                STATUS_ACCENT[status]
            )}
        >
            <header className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-caption font-semibold text-neutral-700">
                    {t('answer.questionShort', { number })}
                </span>
                <StatusChips status={STATUS_CHIP[status]}>
                    {t(STATUS_LABEL_KEY[status])}
                </StatusChips>
                <span className="ms-auto flex items-center gap-4 text-caption text-neutral-500">
                    <span
                        className={cn(
                            'text-body font-semibold',
                            mark > 0
                                ? 'text-success-600'
                                : mark < 0
                                  ? 'text-danger-600'
                                  : 'text-neutral-500'
                        )}
                    >
                        {t('answer.marks', { marks: signedMark(mark) })}
                    </span>
                    <span className="flex items-center gap-1">
                        <Clock size={14} />
                        {formatDuration(t, question.time_taken_in_seconds)}
                    </span>
                </span>
            </header>

            {question.question_name && (
                <RichContentRenderer
                    html={question.question_name}
                    className="text-subtitle text-neutral-800 [&_img]:max-w-full [&_p]:my-0"
                />
            )}

            <AnswerBody
                question={question}
                status={status}
                paper={paper}
                paperLoading={paperLoading}
            />

            {question.evaluator_feedback && (
                <div className="rounded-md border border-primary-100 bg-primary-50 px-3 py-2.5">
                    <Label>{t('answer.teacherRemark')}</Label>
                    <p className="whitespace-pre-wrap text-body text-neutral-800">
                        {question.evaluator_feedback}
                    </p>
                </div>
            )}
            {question.ai_feedback && (
                <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                    <Label>{t('answer.aiFeedback')}</Label>
                    <p className="whitespace-pre-wrap text-body text-neutral-800">
                        {question.ai_feedback}
                    </p>
                </div>
            )}
            {question.explanation && (
                <div className="rounded-md bg-neutral-50 px-3 py-2.5">
                    <Label>{t('answer.explanation')}</Label>
                    <RichContentRenderer html={question.explanation} className={RICH} />
                </div>
            )}
        </article>
    );
};
