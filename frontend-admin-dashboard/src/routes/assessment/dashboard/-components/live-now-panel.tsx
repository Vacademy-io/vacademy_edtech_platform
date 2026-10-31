import { ArrowRight, Clock, Exam } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { Card } from '@/components/ui/card';
import { LiveDot } from '@/routes/study-library/live-session/-components/dashboard/live-now-panel';
import { formatCount } from '@/routes/study-library/live-session/-utils/dashboard-format';
import type { AssessmentDashboardRow } from '../-services/assessment-dashboard';
import { playModeKey } from '../-utils/assessment-dashboard-utils';

/**
 * Where the cohort stands, as a ring: submitted (solid) and writing (lighter),
 * against everyone who was set the test. SVG attributes, not styles.
 */
function ProgressRing({ row }: { row: AssessmentDashboardRow }) {
    const r = 22;
    const circumference = 2 * Math.PI * r;
    const expected = row.expected;
    const done = expected > 0 ? Math.min(1, row.attempted / expected) : 0;
    const writing = expected > 0 ? Math.min(1 - done, row.in_progress / expected) : 0;
    return (
        <div className="relative size-14 shrink-0">
            <svg viewBox="0 0 56 56" className="size-14 -rotate-90" aria-hidden>
                <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    className="stroke-neutral-100"
                />
                <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * (done + writing)} ${circumference}`}
                    className="stroke-warning-300"
                />
                <circle
                    cx="28"
                    cy="28"
                    r={r}
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * done} ${circumference}`}
                    className="stroke-success-500"
                />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-caption font-semibold tabular-nums text-neutral-800">
                {expected > 0 ? `${Math.round(done * 100)}%` : formatCount(row.attempted)}
            </span>
        </div>
    );
}

const endsAt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : format(d, 'h:mm a');
};

/**
 * Scheduled tests whose window is open right now, whatever the selected range.
 * Counts move as learners start and submit because the dashboard re-polls
 * every minute.
 */
export function LiveNowPanel({
    rows,
    onOpen,
}: {
    rows: AssessmentDashboardRow[];
    onOpen: (row: AssessmentDashboardRow) => void;
}) {
    const { t } = useTranslation('assessmentDashboard');

    if (rows.length === 0) {
        return (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-neutral-200 bg-card px-4 py-3 text-body text-neutral-500">
                <Exam size={20} className="shrink-0 text-neutral-400" />
                {t('liveNow.none')}
            </div>
        );
    }

    return (
        <section
            className="flex flex-col gap-3 rounded-xl border border-success-100 bg-gradient-to-br from-success-50 via-white to-white p-4 sm:p-5"
            aria-label={t('liveNow.title')}
        >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex items-center gap-2">
                    <LiveDot />
                    <h2 className="whitespace-nowrap text-subtitle font-semibold text-neutral-900">
                        {t('liveNow.title')}
                    </h2>
                    <span className="rounded-full bg-danger-500 px-2 py-0.5 text-caption font-semibold text-white">
                        {rows.length}
                    </span>
                </div>
                <span className="text-caption text-neutral-500">{t('liveNow.autoRefresh')}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((row) => (
                    <Card
                        key={row.assessment_id}
                        className="flex flex-col gap-3 rounded-xl border-neutral-200 bg-card p-4 shadow-sm"
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex min-w-0 flex-1 flex-col gap-1">
                                <p
                                    className="truncate text-body font-semibold text-neutral-900"
                                    title={row.name}
                                >
                                    {row.name || t('table.untitled')}
                                </p>
                                <p className="flex items-center gap-1.5 text-caption text-neutral-500">
                                    <Clock size={13} className="shrink-0" />
                                    {[
                                        t('liveNow.endsAt', { time: endsAt(row.end_time) ?? '—' }),
                                        t(`playModes.${playModeKey(row.play_mode)}`),
                                    ].join(' · ')}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
                                    <span className="flex items-center gap-1 text-success-700">
                                        <span
                                            className="size-2 rounded-full bg-success-500"
                                            aria-hidden
                                        />
                                        {t('liveNow.submitted', { n: formatCount(row.attempted) })}
                                    </span>
                                    <span className="flex items-center gap-1 text-warning-700">
                                        <span
                                            className="size-2 rounded-full bg-warning-300"
                                            aria-hidden
                                        />
                                        {t('liveNow.writing', { n: formatCount(row.in_progress) })}
                                    </span>
                                    <span className="flex items-center gap-1 text-neutral-500">
                                        <span
                                            className="size-2 rounded-full bg-neutral-200"
                                            aria-hidden
                                        />
                                        {t('liveNow.notStarted', {
                                            n: formatCount(row.not_attempted),
                                        })}
                                    </span>
                                </div>
                            </div>
                            <ProgressRing row={row} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-caption text-neutral-600">
                                {row.expected > 0
                                    ? t('liveNow.ofExpected', { n: formatCount(row.expected) })
                                    : null}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                className="gap-1.5 sm:min-w-0"
                                onClick={() => onOpen(row)}
                            >
                                {t('liveNow.open')}
                                <ArrowRight size={14} />
                            </MyButton>
                        </div>
                    </Card>
                ))}
            </div>
        </section>
    );
}
