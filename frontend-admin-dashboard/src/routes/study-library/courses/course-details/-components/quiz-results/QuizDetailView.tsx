import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery } from '@tanstack/react-query';
import { ArrowClockwise, ArrowLeft, Info } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { cn } from '@/lib/utils';
import { quizLearnerResultsQueryOptions } from '../../-services/quiz-results-services';
import QuizLearnersPanel from './QuizLearnersPanel';
import QuizQuestionsPanel from './QuizQuestionsPanel';
import QuizScoreDistribution from './QuizScoreDistribution';
import {
    QuizResultsMessage,
    StatTile,
    formatDuration,
    formatNumber,
    formatPercent,
} from './quiz-results-shared';

type DetailView = 'LEARNERS' | 'QUESTIONS';

const buildViews = (t: TFunction): { value: DetailView; label: string }[] => [
    { value: 'LEARNERS', label: t('views.learners') },
    { value: 'QUESTIONS', label: t('views.questionAnalysis') },
];

/** One quiz: its headline numbers, the score spread, and the two drill-downs. */
export default function QuizDetailView({
    batchId,
    slideId,
    onBack,
}: {
    batchId: string;
    slideId: string;
    onBack: () => void;
}) {
    const { t } = useTranslation('studyLibraryQuizResultsDetailView');
    const [view, setView] = useState<DetailView>('LEARNERS');
    const { data, isLoading, isFetching, error, refetch } = useQuery(
        quizLearnerResultsQueryOptions(batchId, slideId)
    );
    const VIEWS = buildViews(t);

    if (isLoading) {
        return (
            <div className="flex justify-center py-16">
                <DashboardLoader size={28} />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="flex flex-col gap-3">
                <BackLink onBack={onBack} t={t} />
                <QuizResultsMessage
                    tone="danger"
                    title={t('loadErrorTitle')}
                    subtitle={t('loadErrorSubtitle')}
                    action={
                        <MyButton buttonType="secondary" scale="medium" onClick={() => refetch()}>
                            {t('retry')}
                        </MyButton>
                    }
                />
            </div>
        );
    }

    const { quiz, distribution, learners, truncated } = data;
    const path = [quiz.subjectName, quiz.moduleName, quiz.chapterName].filter(Boolean).join(' › ');

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <BackLink onBack={onBack} t={t} />
                    <h2 className="mt-1 truncate text-h3-semibold text-neutral-700">
                        {quiz.title || t('untitledQuiz')}
                    </h2>
                    <p className="truncate text-caption text-neutral-400">
                        {path || t('notMappedToChapter')}
                        {quiz.timeLimitInMinutes
                            ? ` · ${t('timeLimitSuffix', { count: quiz.timeLimitInMinutes })}`
                            : ''}
                        {quiz.reAttemptCount
                            ? ` · ${t('reAttemptsSuffix', { count: quiz.reAttemptCount })}`
                            : ''}
                    </p>
                </div>
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="icon"
                    aria-label={t('refreshAriaLabel')}
                    onClick={() => refetch()}
                    disable={isFetching}
                >
                    <ArrowClockwise className={cn('size-4', isFetching && 'animate-spin')} />
                </MyButton>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                    label={t('stats.attempted')}
                    value={`${quiz.attemptedLearners} / ${quiz.enrolledLearners}`}
                    hint={t('stats.attemptsInTotal', { count: quiz.totalAttempts })}
                    accent="bg-info-500"
                />
                <StatTile
                    label={t('stats.averageScore')}
                    value={formatPercent(quiz.avgScorePercent)}
                    hint={t('stats.medianOutOfMarks', {
                        median: formatPercent(quiz.medianScorePercent),
                        total: quiz.totalMarks,
                    })}
                    accent="bg-primary-500"
                />
                <StatTile
                    label={quiz.passPercentage != null ? t('stats.passed') : t('stats.scoreRange')}
                    value={
                        quiz.passPercentage != null
                            ? `${formatNumber(quiz.passedLearners)} / ${quiz.attemptedLearners}`
                            : `${formatPercent(quiz.lowestScorePercent)} – ${formatPercent(
                                  quiz.highestScorePercent
                              )}`
                    }
                    hint={
                        quiz.passPercentage != null
                            ? t('stats.passMark', { percent: quiz.passPercentage })
                            : t('stats.noPassMark')
                    }
                    accent="bg-success-500"
                />
                <StatTile
                    label={t('stats.averageTime')}
                    value={formatDuration(quiz.avgTimeSeconds)}
                    hint={t('stats.perLearnerLatestAttempt')}
                    accent="bg-neutral-400"
                />
            </div>

            <div className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
                <QuizScoreDistribution
                    buckets={distribution?.buckets ?? []}
                    passPercentage={quiz.passPercentage}
                    totalLearners={quiz.attemptedLearners}
                />
            </div>

            {quiz.ungradedResponses > 0 && (
                <p className="flex items-start gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-caption text-neutral-600">
                    <Info className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden="true" />
                    <span>{t('ungradedNotice', { count: quiz.ungradedResponses })}</span>
                </p>
            )}

            <div
                className="inline-flex w-fit gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1"
                role="tablist"
                aria-label={t('resultViewsAriaLabel')}
            >
                {VIEWS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        role="tab"
                        id={`quiz-results-tab-${option.value}`}
                        aria-selected={view === option.value}
                        aria-controls="quiz-results-panel"
                        onClick={() => setView(option.value)}
                        className={cn(
                            'cursor-pointer rounded-md px-3.5 py-1.5 text-body transition-colors duration-200',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                            view === option.value
                                ? 'bg-white font-semibold text-neutral-800 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div
                id="quiz-results-panel"
                role="tabpanel"
                aria-labelledby={`quiz-results-tab-${view}`}
            >
                {view === 'LEARNERS' ? (
                    <QuizLearnersPanel quiz={quiz} learners={learners} truncated={truncated} />
                ) : (
                    /* Mounted only when opened, so the list view never pays for this query. */
                    <QuizQuestionsPanel batchId={batchId} slideId={slideId} />
                )}
            </div>
        </div>
    );
}

function BackLink({ onBack, t }: { onBack: () => void; t: TFunction }) {
    return (
        <button
            type="button"
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-caption text-neutral-500 transition-colors duration-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('allQuizzes')}
        </button>
    );
}
