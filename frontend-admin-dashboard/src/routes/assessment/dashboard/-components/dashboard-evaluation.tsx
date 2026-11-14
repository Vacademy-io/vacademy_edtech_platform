import { CheckSquareOffset } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { Avatar } from '@/routes/study-library/live-session/-components/dashboard/dashboard-highlights';
import {
    formatCount,
    formatRate,
} from '@/routes/study-library/live-session/-utils/dashboard-format';
import type {
    AssessmentDashboardSummary,
    AssessmentEvaluatorStats,
} from '../-services/assessment-dashboard';

/** How each submission ended up checked, in the order the bar draws them. */
const SEGMENTS = [
    { key: 'teacher', bar: 'bg-success-500' },
    { key: 'ai', bar: 'bg-info-500' },
    { key: 'auto', bar: 'bg-primary-300' },
    { key: 'other', bar: 'bg-neutral-300' },
    { key: 'waiting', bar: 'bg-warning-400' },
] as const;

type SegmentKey = (typeof SEGMENTS)[number]['key'];

const segmentValue = (summary: AssessmentDashboardSummary, key: SegmentKey): number => {
    switch (key) {
        case 'teacher':
            return summary.checked_by_teacher;
        case 'ai':
            return summary.checked_by_ai;
        case 'auto':
            return summary.auto_graded;
        case 'other':
            return summary.evaluated_other;
        default:
            return summary.awaiting_evaluation;
    }
};

const formatDay = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : format(d, 'dd MMM');
};

/** The display name of a teacher, falling back to email and then the id. */
export const evaluatorName = (e: Pick<AssessmentEvaluatorStats, 'name' | 'email' | 'user_id'>) =>
    e.name || e.email || e.user_id;

/**
 * Copy checking: how every submission in the range was checked (teachers, AI,
 * auto-graded, entered without the checking tool) or is still waiting, and which
 * teacher checked how many copies.
 */
export function CopyCheckingCard({
    summary,
    evaluators,
}: {
    summary: AssessmentDashboardSummary;
    evaluators: AssessmentEvaluatorStats[];
}) {
    const { t } = useTranslation('assessmentDashboard');
    const total = summary.submissions;
    const max = Math.max(1, ...evaluators.map((e) => e.copies_checked));

    return (
        <SectionCard
            icon={CheckSquareOffset}
            title={t('copyCheck.title')}
            subtitle={
                total > 0
                    ? t('copyCheck.subtitle', {
                          checked: formatCount(summary.evaluated),
                          total: formatCount(total),
                          waiting: formatCount(summary.awaiting_evaluation),
                      })
                    : undefined
            }
            className="xl:col-span-2"
        >
            {total === 0 ? (
                <EmptyChart text={t('empty.noSubmissions')} />
            ) : (
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-3">
                        <div
                            className="flex h-3 w-full overflow-hidden rounded-full bg-neutral-100"
                            aria-hidden
                        >
                            {SEGMENTS.map((seg) => {
                                const value = segmentValue(summary, seg.key);
                                return value > 0 ? (
                                    <span
                                        key={seg.key}
                                        className={cn('h-full', seg.bar)}
                                        style={{ width: `${(value / total) * 100}%` }} // design-lint-ignore: data-driven segment width
                                    />
                                ) : null;
                            })}
                        </div>
                        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-neutral-600">
                            {SEGMENTS.map((seg) => {
                                const value = segmentValue(summary, seg.key);
                                if (value === 0 && seg.key !== 'waiting') return null;
                                return (
                                    <li key={seg.key} className="flex items-center gap-1.5">
                                        <span
                                            className={cn('size-2.5 rounded-sm', seg.bar)}
                                            aria-hidden
                                        />
                                        {t(`copyCheck.segments.${seg.key}`)}
                                        <span className="font-semibold tabular-nums text-neutral-800">
                                            {formatCount(value)}
                                        </span>
                                        <span className="text-neutral-400">
                                            {formatRate(value / total)}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="flex flex-col gap-2">
                        <h4 className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                            {t('copyCheck.teachersTitle')}
                        </h4>
                        {evaluators.length === 0 ? (
                            <EmptyChart className="h-24" text={t('copyCheck.noTeachers')} />
                        ) : (
                            <ol className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
                                {evaluators.map((e) => {
                                    const last = formatDay(e.last_checked_at);
                                    return (
                                        <li
                                            key={e.user_id}
                                            className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50"
                                        >
                                            <Avatar id={e.user_id} name={evaluatorName(e)} />
                                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                                <div className="flex items-center justify-between gap-3">
                                                    <span className="truncate text-body font-semibold text-neutral-900">
                                                        {evaluatorName(e)}
                                                    </span>
                                                    <span className="shrink-0 text-body font-semibold tabular-nums text-success-700">
                                                        {t('copyCheck.copies', {
                                                            n: formatCount(e.copies_checked),
                                                        })}
                                                    </span>
                                                </div>
                                                <Progress
                                                    value={(e.copies_checked / max) * 100}
                                                    className="h-1.5 !bg-neutral-100 [&>div]:bg-success-500"
                                                    aria-hidden
                                                />
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                                                    <span>
                                                        {t('copyCheck.tests', { count: e.tests })}
                                                    </span>
                                                    {e.avg_minutes_per_copy !== null && (
                                                        <span>
                                                            {t('copyCheck.perCopy', {
                                                                minutes: Math.max(
                                                                    1,
                                                                    Math.round(
                                                                        e.avg_minutes_per_copy
                                                                    )
                                                                ),
                                                            })}
                                                        </span>
                                                    )}
                                                    {last && (
                                                        <span>
                                                            {t('copyCheck.lastChecked', {
                                                                date: last,
                                                            })}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}
                    </div>
                </div>
            )}
        </SectionCard>
    );
}
