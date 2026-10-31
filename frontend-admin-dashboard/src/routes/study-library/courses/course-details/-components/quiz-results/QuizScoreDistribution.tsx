import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { QuizScoreBucket } from '../../-types/quiz-results-types';

/**
 * Score spread over fixed 10% bands.
 *
 * A histogram, not a pie or a stack: the data is a magnitude across ordered bins, and the
 * question it answers ("is the class bunched at the top, or split?") is a shape question.
 * The bands are fixed rather than data-fitted so two quizzes can be compared by eye.
 *
 * One hue for every bar. Colouring bands by pass/fail would put the design system's danger
 * and warning steps next to each other, which are 5.5 ΔE apart under deuteranopia — the
 * pass mark is drawn as a labelled reference line instead, which everyone can see.
 */
export default function QuizScoreDistribution({
    buckets,
    passPercentage,
    totalLearners,
}: {
    buckets: QuizScoreBucket[];
    passPercentage: number | null;
    totalLearners: number;
}) {
    const { t } = useTranslation('studyLibraryQuizScoreDistribution');
    const peak = Math.max(1, ...buckets.map((bucket) => bucket.learners));
    // The line sits on the boundary between bands, so it is placed by percentage of width.
    const passLeft = passPercentage != null ? Math.max(0, Math.min(100, passPercentage)) : null;

    if (totalLearners === 0) {
        return <p className="text-caption text-neutral-400">{t('noAttemptsYet')}</p>;
    }

    return (
        <figure className="flex flex-col gap-2">
            <figcaption className="flex items-baseline justify-between gap-2">
                <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                    {t('scoreSpread')}
                </span>
                <span className="text-caption text-neutral-400">
                    {t('learnersCount', { count: totalLearners })}
                </span>
            </figcaption>

            {/* pt-5 reserves a lane at the top for the pass-mark label, which used to
                land on top of a bar's value when the pass mark fell on a tall band. */}
            <div className="relative pt-5">
                <div className="flex h-24 items-end gap-1">
                    {buckets.map((bucket) => {
                        const height = (bucket.learners / peak) * 100;
                        return (
                            <div
                                key={bucket.from}
                                className="group flex h-full flex-1 flex-col justify-end"
                                title={t('bucketTitle', {
                                    from: bucket.from,
                                    to: bucket.to,
                                    count: bucket.learners,
                                })}
                            >
                                {/* The white halo lets the pass-mark line pass behind the
                                    count instead of striking through it. */}
                                <span
                                    className={cn(
                                        'relative z-10 mx-auto mb-1 rounded-sm bg-white px-1 text-center text-caption tabular-nums',
                                        bucket.learners > 0
                                            ? 'text-neutral-500'
                                            : 'text-transparent'
                                    )}
                                >
                                    {bucket.learners || 0}
                                </span>
                                <div
                                    className={cn(
                                        'w-full rounded-t-sm transition-colors duration-200',
                                        bucket.learners > 0
                                            ? 'bg-primary-400 group-hover:bg-primary-500'
                                            : 'bg-neutral-100'
                                    )}
                                    /* Bar height is the datum itself — no token can express it. */
                                    style={{
                                        height: `${Math.max(bucket.learners > 0 ? 6 : 2, height)}%`,
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>

                {passLeft !== null && (
                    <div
                        className="pointer-events-none absolute inset-y-0 top-5 border-l-2 border-dashed border-success-600"
                        /* Reference line position is data-driven. */
                        style={{ left: `${passLeft}%` }}
                        aria-hidden="true"
                    >
                        <span
                            className={cn(
                                'absolute -top-5 whitespace-nowrap text-caption font-medium text-success-700',
                                // Flip the label inside the plot when the pass mark sits
                                // near the right edge, so it cannot overflow the card.
                                passLeft > 80 ? 'right-1' : 'left-1'
                            )}
                        >
                            {t('passMark', { percentage: passPercentage })}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex gap-1 text-caption text-neutral-400" aria-hidden="true">
                {buckets.map((bucket) => (
                    <span key={bucket.from} className="flex-1 text-center tabular-nums">
                        {bucket.from}
                    </span>
                ))}
            </div>
            {/* Ticks label each band's START, so no trailing 100 — adding one would
                shrink the flex columns and pull every tick off its bar. */}
            <p className="text-caption text-neutral-400">{t('axisCaption')}</p>
        </figure>
    );
}
