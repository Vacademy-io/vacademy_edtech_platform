import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Student, ClipboardText } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import LearnerQuizOverview from './LearnerQuizOverview';
import LearnerQuizSideView from './LearnerQuizSideView';
import QuizDetailView from './QuizDetailView';
import QuizResultsOverview from './QuizResultsOverview';
import { QuizResultsMessage } from './quiz-results-shared';

type ResultsView = 'LEARNER_WISE' | 'QUIZ_WISE';

const buildViews = (
    t: TFunction
): {
    value: ResultsView;
    label: string;
    /** Shown under the switch, not only on hover — a hover tooltip is invisible on touch
        and to anyone who does not think to hover, which is most first-time users. */
    caption: string;
    icon: typeof Student;
}[] => [
    {
        value: 'LEARNER_WISE',
        label: t('byLearner'),
        caption: t('byLearnerCaption'),
        icon: Student,
    },
    {
        value: 'QUIZ_WISE',
        label: t('byQuiz'),
        caption: t('byQuizCaption'),
        icon: ClipboardText,
    },
];

const STORAGE_KEY = 'quiz-results-view';

/**
 * Course-details → Quiz Results.
 *
 * The same graded data, two ways in:
 *  - Learner-wise: the roster, opening into one learner's whole quiz history — their
 *    attempts, answers and running totals. Answers "who is falling behind".
 *  - Quiz-wise: the quiz list, opening into one quiz's learners and question breakdown.
 *    Answers "which quiz is landing badly".
 *
 * Which view you were on is remembered, because a teacher tends to live in one of them.
 * The drill-down selections are local state rather than route params so the surrounding
 * course-details tab strip (which owns the URL) is left alone.
 */
export default function QuizResultsTab({ packageSessionId }: { packageSessionId: string }) {
    const { t } = useTranslation('studyLibraryQuizResultsTab');
    const VIEWS = buildViews(t);
    // The course page can hand over a comma-joined list when several batches share the
    // course; results are per batch, so take the first — same rule the Pulse tab uses.
    const batchId = (packageSessionId ?? '').split(',')[0] ?? '';

    const [view, setView] = useState<ResultsView>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored === 'QUIZ_WISE' || stored === 'LEARNER_WISE' ? stored : 'LEARNER_WISE';
        } catch {
            // Private browsing / storage disabled — the default is fine.
            return 'LEARNER_WISE';
        }
    });
    const [openSlideId, setOpenSlideId] = useState<string | null>(null);
    const [openUserId, setOpenUserId] = useState<string | null>(null);

    const selectView = (next: ResultsView) => {
        setView(next);
        setOpenSlideId(null);
        setOpenUserId(null);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // Not being able to remember the choice is not worth failing the render for.
        }
    };

    if (!batchId) {
        return (
            <QuizResultsMessage
                title={t('selectBatchTitle')}
                subtitle={t('selectBatchSubtitle')}
            />
        );
    }

    return (
        <div className="flex flex-col gap-4 p-1">
            {/* Hidden while drilled into one quiz: that screen has its own back link, and
                two competing ways out of it reads as a dead end. */}
            {!openSlideId && (
                <div
                    className="inline-flex w-fit gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1"
                    role="tablist"
                    aria-label={t('quizResultViewsAriaLabel')}
                >
                    {VIEWS.map((option) => {
                        const Icon = option.icon;
                        const isActive = view === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="tab"
                                id={`quiz-results-view-${option.value}`}
                                aria-selected={isActive}
                                aria-controls="quiz-results-view-panel"
                                onClick={() => selectView(option.value)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-1.5 rounded-md px-3.5 py-1.5 text-body transition-colors duration-200',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                                    isActive
                                        ? 'bg-white font-semibold text-neutral-800 shadow-sm'
                                        : 'text-neutral-500 hover:text-neutral-700'
                                )}
                            >
                                <Icon className="size-4" aria-hidden="true" />
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            )}

            {!openSlideId && (
                <p className="-mt-2 text-caption text-neutral-500">
                    {VIEWS.find((option) => option.value === view)?.caption}
                </p>
            )}

            <div
                id="quiz-results-view-panel"
                role="tabpanel"
                aria-labelledby={`quiz-results-view-${view}`}
            >
                {view === 'QUIZ_WISE' ? (
                    openSlideId ? (
                        <QuizDetailView
                            batchId={batchId}
                            slideId={openSlideId}
                            onBack={() => setOpenSlideId(null)}
                        />
                    ) : (
                        <QuizResultsOverview batchId={batchId} onOpenQuiz={setOpenSlideId} />
                    )
                ) : (
                    <LearnerQuizOverview batchId={batchId} onOpenLearner={setOpenUserId} />
                )}
            </div>

            {/* A side panel rather than a page swap: the teacher keeps their place in the
                roster while reading one learner's history. */}
            <LearnerQuizSideView
                batchId={batchId}
                userId={openUserId}
                onClose={() => setOpenUserId(null)}
            />
        </div>
    );
}
