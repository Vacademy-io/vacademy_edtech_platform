import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle, Info } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { quizQuestionAnalysisQueryOptions } from '../../-services/quiz-results-services';
import type { QuizQuestionStat } from '../../-types/quiz-results-types';
import {
    DifficultyChip,
    QuizResultsMessage,
    difficultyTone,
    formatPercent,
    questionTypeLabel,
} from './quiz-results-shared';

/**
 * Which questions the batch actually got wrong, and which wrong option pulled them there.
 * This is the part a teacher re-teaches from, so the default order is worst-first rather
 * than the order the questions appear in the quiz.
 */
export default function QuizQuestionsPanel({
    batchId,
    slideId,
}: {
    batchId: string;
    slideId: string;
}) {
    const { t } = useTranslation('studyLibraryQuizQuestionsPanel');
    const [worstFirst, setWorstFirst] = useState(true);
    const { data, isLoading, error, refetch } = useQuery(
        quizQuestionAnalysisQueryOptions(batchId, slideId, true)
    );

    const questions = useMemo(() => {
        const rows = data?.questions ?? [];
        if (!worstFirst) return [...rows].sort((a, b) => a.order - b.order);
        return [...rows].sort((a, b) => (a.accuracyPercent ?? 101) - (b.accuracyPercent ?? 101));
    }, [data, worstFirst]);

    if (isLoading) {
        return (
            <div className="flex justify-center py-10">
                <DashboardLoader size={24} />
            </div>
        );
    }

    if (error) {
        return (
            <QuizResultsMessage
                tone="danger"
                title={t('loadErrorTitle')}
                action={
                    <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                        {t('retry')}
                    </MyButton>
                }
            />
        );
    }

    if (questions.length === 0) {
        return (
            <QuizResultsMessage
                title={t('noQuestionsTitle')}
                subtitle={t('noQuestionsSubtitle')}
            />
        );
    }

    const attempted = data?.attemptedLearners ?? 0;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-neutral-500">
                    {t('accuracyMeasuredAgainst', { count: attempted })}
                </p>
                <MyButton
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setWorstFirst((previous) => !previous)}
                >
                    {worstFirst ? t('showInQuizOrder') : t('showWeakestFirst')}
                </MyButton>
            </div>

            <ol className="flex flex-col gap-3">
                {questions.map((question) => (
                    <QuestionCard
                        key={question.questionId}
                        question={question}
                        attemptedLearners={attempted}
                    />
                ))}
            </ol>
        </div>
    );
}

const ACCURACY_FILL: Record<string, string> = {
    strong: 'bg-success-600',
    fair: 'bg-warning-600',
    weak: 'bg-danger-600',
    neutral: 'bg-info-500',
    none: 'bg-neutral-300',
};

function QuestionCard({
    question,
    attemptedLearners,
}: {
    question: QuizQuestionStat;
    attemptedLearners: number;
}) {
    const { t } = useTranslation('studyLibraryQuizQuestionsPanel');
    const accuracy = question.accuracyPercent;
    const width = Math.max(0, Math.min(100, accuracy ?? 0));

    return (
        <li className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-caption font-semibold text-neutral-600">
                        {question.order}
                    </span>
                    <div className="min-w-0">
                        <p className="text-body text-neutral-700">
                            {question.questionText || t('untitledQuestion')}
                        </p>
                        <p className="mt-0.5 text-caption text-neutral-400">
                            {t('marksCount', { count: question.marks })}
                            {question.questionType
                                ? ` · ${questionTypeLabel(question.questionType)}`
                                : ''}
                        </p>
                    </div>
                </div>
                <DifficultyChip difficulty={question.difficulty} />
            </div>

            {/* Accuracy meter. The fill takes the difficulty's tone so a weak question is
                spottable while scrolling; the chip above spells the same thing out in
                words, so nothing here rests on colour alone. */}
            <div className="mt-3 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                        className={cn(
                            'h-full rounded-full',
                            ACCURACY_FILL[difficultyTone(question.difficulty)]
                        )}
                        /* Bar length is the datum. */
                        style={{ width: `${width}%` }}
                    />
                </div>
                <span className="w-16 shrink-0 text-right text-body font-semibold tabular-nums text-neutral-700">
                    {formatPercent(accuracy)}
                </span>
            </div>

            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-caption tabular-nums">
                <span className="text-success-700">
                    {t('correctCount', { count: question.correctCount })}
                </span>
                <span className="text-danger-600">
                    {t('wrongCount', { count: question.wrongCount })}
                </span>
                {question.skippedCount > 0 && (
                    <span className="text-neutral-500">
                        {t('skippedCount', { count: question.skippedCount })}
                    </span>
                )}
                {question.unansweredCount > 0 && (
                    <span className="text-neutral-400">
                        {t('unansweredCount', { count: question.unansweredCount })}
                    </span>
                )}
                {question.ungradedCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-neutral-400">
                        <Info className="size-3.5" aria-hidden="true" />
                        {t('ungradedCount', { count: question.ungradedCount })}
                    </span>
                )}
            </div>

            {question.options.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-neutral-100 pt-3">
                    {question.options.map((option) => {
                        const share = Math.max(0, Math.min(100, option.selectedPercent ?? 0));
                        return (
                            <li key={option.optionId} className="flex items-center gap-2">
                                {option.correct ? (
                                    <CheckCircle
                                        className="size-4 shrink-0 text-success-600"
                                        weight="fill"
                                        aria-label={t('correctAnswer')}
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
                                            : 'text-neutral-600'
                                    )}
                                    title={option.text}
                                >
                                    {option.text || t('untitledOption')}
                                </span>
                                <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-neutral-100">
                                    <div
                                        className={cn(
                                            'h-full rounded-full',
                                            option.correct ? 'bg-success-600' : 'bg-neutral-400'
                                        )}
                                        /* Share of respondents — data-driven width. */
                                        style={{ width: `${share}%` }}
                                    />
                                </div>
                                <span className="w-20 shrink-0 text-right text-caption tabular-nums text-neutral-500">
                                    {option.selectedCount} ({formatPercent(option.selectedPercent)})
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            {question.explanation && (
                <p className="mt-3 rounded-md bg-neutral-50 p-2 text-caption text-neutral-600">
                    <span className="font-semibold">{t('explanationLabel')} </span>
                    {question.explanation}
                </p>
            )}

            {attemptedLearners === 0 && (
                <p className="mt-2 text-caption text-neutral-400">{t('noAttemptsYet')}</p>
            )}
        </li>
    );
}
