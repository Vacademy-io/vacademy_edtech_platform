import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, CheckCircle, Circle, Info, XCircle } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import {
    learnerQuizAnswersQueryOptions,
    learnerQuizDetailQueryOptions,
} from '../../-services/quiz-results-services';
import type {
    AnswerVerdict,
    LearnerAnswer,
    LearnerQuizAttempt,
    LearnerQuizDetailRow,
} from '../../-types/quiz-results-types';
import {
    LearnerStatusChip,
    QuizResultsMessage,
    ScoreMeter,
    formatDateTime,
    formatDuration,
    formatPercent,
    initialsOf,
    scoreToneOf,
} from './quiz-results-shared';

/**
 * One learner's full quiz history, in a right-hand side panel.
 *
 * Three levels, each loaded only when opened: their totals and quiz list, then one quiz's
 * attempts, then the answers on one attempt. A learner with 100 quizzes would otherwise
 * pull every answer they have ever given just to show a summary.
 */
export default function LearnerQuizSideView({
    batchId,
    userId,
    onClose,
}: {
    batchId: string;
    userId: string | null;
    onClose: () => void;
}) {
    const { t } = useTranslation('studyLibraryLearnerQuizSideView');
    const { data, isLoading, error, refetch } = useQuery(
        learnerQuizDetailQueryOptions(batchId, userId)
    );

    return (
        <Sheet open={!!userId} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
                side="right"
                className="flex size-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
            >
                {isLoading && (
                    <div className="flex flex-1 items-center justify-center">
                        <DashboardLoader size={28} />
                    </div>
                )}

                {error && (
                    <div className="p-6">
                        <QuizResultsMessage
                            tone="danger"
                            title={t('errors.couldNotLoad')}
                            action={
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => refetch()}
                                >
                                    {t('actions.retry')}
                                </MyButton>
                            }
                        />
                    </div>
                )}

                {data && !isLoading && (
                    <>
                        <header className="shrink-0 border-b border-neutral-200 px-5 py-4">
                            <div className="flex items-center gap-3">
                                <span
                                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-50 text-subtitle font-semibold text-primary-600"
                                    aria-hidden="true"
                                >
                                    {initialsOf(data.learner.fullName)}
                                </span>
                                <div className="min-w-0">
                                    <h2 className="truncate text-title font-semibold text-neutral-700">
                                        {data.learner.fullName || t('unnamedLearner')}
                                    </h2>
                                    <p className="truncate text-caption text-neutral-400">
                                        {data.learner.email || data.learner.mobileNumber || ''}
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <HeaderStat
                                    label={t('header.quizzesDone')}
                                    value={`${data.learner.quizzesAttempted} / ${data.learner.quizzesInCourse}`}
                                />
                                <HeaderStat
                                    label={t('header.average')}
                                    value={formatPercent(data.learner.avgScorePercent)}
                                />
                                <HeaderStat
                                    label={t('header.marksSoFar')}
                                    value={`${data.learner.marksObtained ?? 0} / ${
                                        data.learner.attemptedMaxMarks ?? 0
                                    }`}
                                    hint={t('header.outOfAcrossAllQuizzes', {
                                        total: data.learner.courseMaxMarks ?? 0,
                                    })}
                                />
                                <HeaderStat
                                    label={t('header.attempts')}
                                    value={String(data.learner.totalAttempts)}
                                    hint={
                                        data.learner.quizzesWithPassMark > 0
                                            ? t('header.passedFraction', {
                                                  passed: data.learner.passedQuizzes,
                                                  total: data.learner.quizzesWithPassMark,
                                              })
                                            : undefined
                                    }
                                />
                            </div>
                        </header>

                        <div className="flex-1 overflow-y-auto px-5 py-4">
                            {data.quizzes.length === 0 ? (
                                <QuizResultsMessage
                                    title={t('empty.noQuizzesTitle')}
                                    subtitle={t('empty.noQuizzesSubtitle')}
                                />
                            ) : (
                                <ol className="flex flex-col gap-2">
                                    {data.quizzes.map((quiz) => (
                                        <QuizRow
                                            key={quiz.slideId}
                                            quiz={quiz}
                                            batchId={batchId}
                                            userId={userId as string}
                                            t={t}
                                        />
                                    ))}
                                </ol>
                            )}
                        </div>
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}

function HeaderStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
            <p className="truncate text-caption uppercase tracking-wide text-neutral-500">
                {label}
            </p>
            <p className="mt-0.5 text-subtitle font-semibold tabular-nums text-neutral-700">
                {value}
            </p>
            {hint && <p className="truncate text-caption text-neutral-400">{hint}</p>}
        </div>
    );
}

/** One quiz in the learner's list; expands to their attempts and answers. */
function QuizRow({
    quiz,
    batchId,
    userId,
    t,
}: {
    quiz: LearnerQuizDetailRow;
    batchId: string;
    userId: string;
    t: TFunction;
}) {
    const [open, setOpen] = useState(false);
    const attempted = quiz.status !== 'NOT_ATTEMPTED';

    return (
        <li className="overflow-hidden rounded-md border border-neutral-200 bg-white">
            <button
                type="button"
                onClick={() => attempted && setOpen((previous) => !previous)}
                aria-expanded={open}
                disabled={!attempted}
                className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-start transition-colors duration-200',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                    attempted ? 'cursor-pointer hover:bg-neutral-50' : 'cursor-default'
                )}
            >
                <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-neutral-700">
                        {quiz.title || t('untitledQuiz')}
                    </p>
                    <p className="truncate text-caption text-neutral-400">
                        {[quiz.moduleName, quiz.chapterName].filter(Boolean).join(' › ') ||
                            t('notMappedToChapter')}
                    </p>
                </div>

                {attempted ? (
                    <div className="w-28 shrink-0">
                        <ScoreMeter
                            percent={quiz.scorePercent}
                            tone={scoreToneOf(quiz.scorePercent, quiz.passPercentage)}
                            subLabel={`${quiz.marksObtained ?? 0}/${quiz.totalMarks ?? 0}`}
                        />
                    </div>
                ) : (
                    <span className="w-28 shrink-0 text-end text-caption text-neutral-400">
                        {t('notAttempted')}
                    </span>
                )}

                <div className="hidden w-24 shrink-0 sm:block">
                    <LearnerStatusChip status={quiz.status} />
                </div>

                <span className="w-16 shrink-0 text-end text-caption tabular-nums text-neutral-500">
                    {attempted ? t('tries', { count: quiz.attemptCount }) : '—'}
                </span>

                <CaretDown
                    className={cn(
                        'size-4 shrink-0 text-neutral-400 transition-transform duration-200',
                        open && 'rotate-180',
                        !attempted && 'invisible'
                    )}
                    aria-hidden="true"
                />
            </button>

            {open && attempted && (
                <QuizAttempts batchId={batchId} slideId={quiz.slideId} userId={userId} t={t} />
            )}
        </li>
    );
}

/** All of the learner's attempts at one quiz, newest first, each expandable to its answers. */
function QuizAttempts({
    batchId,
    slideId,
    userId,
    t,
}: {
    batchId: string;
    slideId: string;
    userId: string;
    t: TFunction;
}) {
    const { data, isLoading, error } = useQuery(
        learnerQuizAnswersQueryOptions(batchId, slideId, userId)
    );
    const [openAttempt, setOpenAttempt] = useState<number | null>(null);

    if (isLoading) {
        return (
            <div className="flex justify-center border-t border-neutral-100 py-6">
                <DashboardLoader size={20} />
            </div>
        );
    }
    if (error || !data) {
        return (
            <p className="border-t border-neutral-100 p-3 text-caption text-danger-600">
                {t('couldNotLoadAnswers')}
            </p>
        );
    }

    // Newest first: the latest attempt is the one that counts, so it leads.
    const attempts = [...data.attempts].reverse();

    return (
        <div className="border-t border-neutral-100 bg-neutral-50 px-3 py-2">
            {attempts.length === 0 ? (
                <p className="py-2 text-caption text-neutral-500">{t('noRecordedAttempts')}</p>
            ) : (
                <ul className="flex flex-col gap-1.5">
                    {attempts.map((attempt) => (
                        <AttemptRow
                            key={attempt.activityId}
                            attempt={attempt}
                            totalAttempts={data.attempts.length}
                            totalMarks={data.totalMarks}
                            open={openAttempt === attempt.attemptNumber}
                            onToggle={() =>
                                setOpenAttempt((previous) =>
                                    previous === attempt.attemptNumber
                                        ? null
                                        : attempt.attemptNumber
                                )
                            }
                            t={t}
                        />
                    ))}
                </ul>
            )}
        </div>
    );
}

function AttemptRow({
    attempt,
    totalAttempts,
    totalMarks,
    open,
    onToggle,
    t,
}: {
    attempt: LearnerQuizAttempt;
    totalAttempts: number;
    totalMarks: number | null;
    open: boolean;
    onToggle: () => void;
    t: TFunction;
}) {
    return (
        <li className="overflow-hidden rounded-md border border-neutral-200 bg-white">
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-start transition-colors duration-200 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
                <span className="shrink-0 text-caption font-semibold text-neutral-700">
                    {t('attemptNumber', { number: attempt.attemptNumber })}
                    <span className="font-regular text-neutral-400">
                        {' '}
                        {t('ofTotal', { total: totalAttempts })}
                    </span>
                </span>
                {attempt.latest && (
                    <span
                        className="shrink-0 rounded-sm border border-info-200 bg-info-50 px-1.5 text-caption text-info-600"
                        title={t('countsAsScoreTitle')}
                    >
                        {t('countsAsScore')}
                    </span>
                )}
                <span className="min-w-0 flex-1 truncate text-caption text-neutral-400">
                    {formatDateTime(attempt.attemptedAtEpochMillis)}
                    {attempt.timeSpentSeconds
                        ? ` · ${formatDuration(attempt.timeSpentSeconds)}`
                        : ''}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-neutral-600">
                    {attempt.marksObtained ?? 0}/{totalMarks ?? 0}
                </span>
                <span className="w-12 shrink-0 text-end text-body font-semibold tabular-nums text-neutral-700">
                    {formatPercent(attempt.scorePercent)}
                </span>
                <CaretDown
                    className={cn(
                        'size-4 shrink-0 text-neutral-400 transition-transform duration-200',
                        open && 'rotate-180'
                    )}
                    aria-hidden="true"
                />
            </button>

            {open && (
                <div className="border-t border-neutral-100 px-3 py-2">
                    <p className="mb-2 flex flex-wrap gap-x-3 gap-y-0.5 text-caption tabular-nums">
                        <span className="text-success-700">
                            {t('correctCount', { count: attempt.correctCount })}
                        </span>
                        {attempt.wrongCount > 0 && (
                            <span className="text-danger-600">
                                {t('wrongCount', { count: attempt.wrongCount })}
                            </span>
                        )}
                        {attempt.skippedCount > 0 && (
                            <span className="text-neutral-500">
                                {t('skippedCount', { count: attempt.skippedCount })}
                            </span>
                        )}
                        {attempt.unansweredCount > 0 && (
                            <span className="text-neutral-400">
                                {t('notAnsweredCount', { count: attempt.unansweredCount })}
                            </span>
                        )}
                        {attempt.ungradedCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-neutral-400">
                                <Info className="size-3.5" aria-hidden="true" />
                                {t('needManualMarkingCount', { count: attempt.ungradedCount })}
                            </span>
                        )}
                    </p>
                    <ol className="flex flex-col gap-2">
                        {attempt.answers.map((answer) => (
                            <AnswerRow key={answer.questionId} answer={answer} t={t} />
                        ))}
                    </ol>
                </div>
            )}
        </li>
    );
}

const verdictLabelKey: Record<AnswerVerdict, string> = {
    CORRECT: 'verdict.correct',
    PARTIAL: 'verdict.partial',
    WRONG: 'verdict.wrong',
    SKIPPED: 'verdict.skipped',
    UNGRADED: 'verdict.needsMarking',
    NOT_ANSWERED: 'verdict.notAnswered',
};

const VERDICT_CLASS: Record<AnswerVerdict, string> = {
    CORRECT: 'border-success-400 bg-success-50 text-success-700',
    PARTIAL: 'border-warning-400 bg-warning-50 text-warning-700',
    WRONG: 'border-danger-400 bg-danger-50 text-danger-600',
    SKIPPED: 'border-neutral-300 bg-neutral-50 text-neutral-600',
    UNGRADED: 'border-neutral-300 bg-neutral-50 text-neutral-500',
    NOT_ANSWERED: 'border-neutral-300 bg-neutral-50 text-neutral-500',
};

/** One question on one attempt: what they picked, what was right, what it earned. */
function AnswerRow({ answer, t }: { answer: LearnerAnswer; t: TFunction }) {
    return (
        <li className="rounded-md border border-neutral-200 bg-white p-2.5">
            <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-caption text-neutral-700">
                    <span className="me-1.5 font-semibold text-neutral-500">
                        {t('questionNumber', { number: answer.order })}
                    </span>
                    {answer.questionText || t('untitledQuestion')}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                    <span
                        className={cn(
                            'rounded-md border px-1.5 py-0.5 text-caption font-medium',
                            VERDICT_CLASS[answer.verdict] ?? VERDICT_CLASS.NOT_ANSWERED
                        )}
                    >
                        {t(verdictLabelKey[answer.verdict] ?? verdictLabelKey.NOT_ANSWERED)}
                    </span>
                    <span className="text-caption tabular-nums text-neutral-500">
                        {answer.marksAwarded}/{answer.marks}
                    </span>
                </div>
            </div>

            {answer.options.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                    {answer.options.map((option) => (
                        <li key={option.optionId} className="flex items-center gap-2">
                            {option.correct ? (
                                <CheckCircle
                                    className="size-4 shrink-0 text-success-600"
                                    weight="fill"
                                    aria-label={t('correctAnswerAriaLabel')}
                                />
                            ) : option.selected ? (
                                <XCircle
                                    className="size-4 shrink-0 text-danger-600"
                                    weight="fill"
                                    aria-label={t('learnerAnswerAriaLabel')}
                                />
                            ) : (
                                <Circle
                                    className="size-4 shrink-0 text-neutral-300"
                                    aria-hidden="true"
                                />
                            )}
                            <span
                                className={cn(
                                    'min-w-0 flex-1 truncate text-caption',
                                    option.correct
                                        ? 'font-medium text-success-700'
                                        : option.selected
                                          ? 'text-danger-600'
                                          : 'text-neutral-600'
                                )}
                            >
                                {option.text || t('untitledOption')}
                            </span>
                            {option.selected && (
                                <span className="shrink-0 rounded-sm bg-neutral-100 px-1.5 text-caption text-neutral-600">
                                    {t('theirAnswer')}
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                /* Free-text / numeric questions have no options to tick. */
                <div className="mt-2 flex flex-col gap-0.5 text-caption">
                    <span className="text-neutral-600">
                        <span className="text-neutral-400">{t('answeredLabel')} </span>
                        {answer.learnerAnswer || '—'}
                    </span>
                    {answer.correctAnswer && (
                        <span className="text-success-700">
                            <span className="text-neutral-400">{t('expectedLabel')} </span>
                            {answer.correctAnswer}
                        </span>
                    )}
                </div>
            )}
        </li>
    );
}
