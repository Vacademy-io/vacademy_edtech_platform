import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Books,
    CheckCircle,
    Clock,
    Exam,
    Brain,
    MinusCircle,
    UsersThree,
    XCircle,
    type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    DEFAULT_TIMELINE,
    ReportTimelineFilter,
    resolveTimeline,
    type TimelineValue,
} from '@/components/common/report-timeline-filter';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import {
    getBatchSummaryReportQuery,
    type BatchSummaryReport,
    type BatchSummaryRequest,
} from '@/services/batch-summary-report';
import { useBatchOptions } from '../batchMultiSelect';
import { GenerateBatchReportDialog } from './generateBatchReportDialog';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 10) / 10}%`);

const minutes = (v: number | null | undefined) => {
    if (v == null) return '—';
    const m = Math.round(v);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

const Tile = ({
    label,
    value,
    hint,
    icon: Icon,
}: {
    label: string;
    value: string;
    hint?: string;
    icon: PhosphorIcon;
}) => (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-4">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500">
            <Icon className="size-4" />
            {label}
        </span>
        <span className="text-2xl font-semibold text-neutral-800">{value}</span>
        {hint && <span className="text-xs text-neutral-500">{hint}</span>}
    </div>
);

/** Passed / failed / not attempted as one 100% bar, each status with an icon and a count. */
const ResultsBar = ({ r }: { r: BatchSummaryReport }) => {
    const total = Math.max(r.enrolled_learners, 1);
    const parts = [
        {
            key: 'passed',
            label: 'Passed',
            count: r.passed_learners,
            bar: 'bg-success-600',
            text: 'text-success-700',
            icon: CheckCircle,
        },
        {
            key: 'failed',
            label: 'Failed',
            count: r.failed_learners,
            bar: 'bg-danger-600',
            text: 'text-danger-700',
            icon: XCircle,
        },
        {
            key: 'na',
            label: 'Not attempted',
            count: r.not_attempted_learners,
            bar: 'bg-neutral-300',
            text: 'text-neutral-600',
            icon: MinusCircle,
        },
    ];
    return (
        <div className="flex flex-col gap-3">
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-neutral-100">
                {parts.map((p) =>
                    p.count > 0 ? (
                        <div
                            key={p.key}
                            className={p.bar}
                            // Width is data, not a design token.
                            style={{ width: `${(p.count / total) * 100}%` }}
                            title={`${p.label}: ${p.count}`}
                        />
                    ) : null
                )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
                {parts.map((p) => (
                    <span key={p.key} className={cn('flex items-center gap-1.5 text-sm', p.text)}>
                        <p.icon className="size-4" weight="fill" />
                        {p.label}: <strong>{p.count}</strong>
                        <span className="text-neutral-500">({pct((p.count / total) * 100)})</span>
                    </span>
                ))}
            </div>
        </div>
    );
};

export default function BatchOverviewReport({
    fixedPackageSessionId,
}: {
    /** Course Details → Reports: the batch is implied by the page. */
    fixedPackageSessionId?: string;
}) {
    const batchOptions = useBatchOptions();
    const [picked, setPicked] = useState<string>('');
    const [timeline, setTimeline] = useState<TimelineValue>(DEFAULT_TIMELINE);
    const range = resolveTimeline(timeline);
    const batchId = fixedPackageSessionId ?? picked;
    const batchLabel = batchOptions.find((b) => b.value === batchId)?.label;
    const batchTerm = getTerminology(ContentTerms.Batch, SystemTerms.Batch);

    const request: BatchSummaryRequest | null = useMemo(
        () =>
            batchId && range
                ? {
                      package_session_id: batchId,
                      batch_name: batchLabel,
                      start_date: range.start,
                      end_date: range.end,
                  }
                : null,
        [batchId, batchLabel, range?.start, range?.end]
    );

    const { data, isLoading, isError } = useQuery({
        ...getBatchSummaryReportQuery(
            request ?? { package_session_id: '', start_date: '', end_date: '' }
        ),
    });

    const needsAttention = useMemo(
        () =>
            (data?.learners ?? [])
                .filter((l) => l.status !== 'PASSED')
                .sort((a, b) => {
                    if (a.status !== b.status) return a.status === 'FAILED' ? -1 : 1;
                    return (a.avg_score_percent ?? 0) - (b.avg_score_percent ?? 0);
                })
                .slice(0, 5),
        [data]
    );

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 md:flex-row md:items-end">
                {!fixedPackageSessionId && (
                    <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                        {batchTerm}
                        <Select value={picked} onValueChange={setPicked}>
                            <SelectTrigger className="h-9 w-full text-sm">
                                <SelectValue placeholder={`Select a ${batchTerm.toLowerCase()}`} />
                            </SelectTrigger>
                            <SelectContent>
                                {batchOptions.map((b) => (
                                    <SelectItem key={b.value} value={b.value}>
                                        {b.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                )}
                <div className="flex flex-1 flex-col gap-1 text-xs font-medium text-neutral-600">
                    Timeline
                    <ReportTimelineFilter value={timeline} onChange={setTimeline} />
                </div>
                <div className="md:ml-auto">
                    <GenerateBatchReportDialog request={request} disabled={!data} />
                </div>
            </div>

            {!batchId ? (
                <p className="py-10 text-center text-sm text-neutral-500">
                    Select a {batchTerm.toLowerCase()} to see its report.
                </p>
            ) : !range ? (
                <p className="py-10 text-center text-sm text-neutral-500">
                    Pick a start and end date.
                </p>
            ) : isLoading ? (
                <DashboardLoader />
            ) : isError || !data ? (
                <p className="py-10 text-center text-sm text-danger-600">
                    Couldn&apos;t load this report.
                </p>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                        <Tile
                            label="Learners"
                            value={String(data.enrolled_learners)}
                            icon={UsersThree as PhosphorIcon}
                        />
                        <Tile
                            label="Passed"
                            value={pct(data.pass_rate)}
                            hint={`${data.passed_learners} of ${data.enrolled_learners} · pass mark ${data.pass_percentage}%`}
                            icon={CheckCircle as PhosphorIcon}
                        />
                        <Tile
                            label="Avg quiz score"
                            value={pct(data.avg_quiz_score)}
                            hint={`${data.quizzes_in_course} quiz${data.quizzes_in_course === 1 ? '' : 'zes'} in course`}
                            icon={Exam as PhosphorIcon}
                        />
                        <Tile
                            label="Course completion"
                            value={pct(data.avg_course_completion)}
                            icon={Books as PhosphorIcon}
                        />
                        <Tile
                            label="Avg time"
                            value={minutes(data.avg_time_spent_minutes)}
                            icon={Clock as PhosphorIcon}
                        />
                        <Tile
                            label="Concentration"
                            value={pct(data.avg_concentration)}
                            icon={Brain as PhosphorIcon}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-neutral-700">Results</h3>
                            {data.enrolled_learners === 0 ? (
                                <p className="text-sm text-neutral-500">
                                    No learners in this batch.
                                </p>
                            ) : (
                                <ResultsBar r={data} />
                            )}
                            {needsAttention.length > 0 && (
                                <div className="flex flex-col gap-1 border-t border-neutral-100 pt-3">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                                        Needs attention
                                    </span>
                                    {needsAttention.map((l) => (
                                        <div
                                            key={l.user_id}
                                            className="flex justify-between text-sm"
                                        >
                                            <span className="truncate text-neutral-700">
                                                {l.full_name}
                                            </span>
                                            <span
                                                className={
                                                    l.status === 'FAILED'
                                                        ? 'text-danger-700'
                                                        : 'text-neutral-500'
                                                }
                                            >
                                                {l.status === 'FAILED'
                                                    ? pct(l.avg_score_percent)
                                                    : 'Not attempted'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-neutral-700">
                                Subject progress
                            </h3>
                            {data.subjects.length === 0 ? (
                                <p className="text-sm text-neutral-500">No subject progress yet.</p>
                            ) : (
                                data.subjects.map((s) => (
                                    <div key={s.subject_name} className="flex flex-col gap-1">
                                        <div className="flex justify-between text-sm">
                                            <span className="truncate text-neutral-700">
                                                {s.subject_name}
                                            </span>
                                            <span className="text-neutral-600">
                                                {pct(s.avg_completion)} ·{' '}
                                                {minutes(s.avg_time_minutes)}
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                                            <div
                                                className="h-full rounded-full bg-primary-500"
                                                // Width is data, not a design token.
                                                style={{
                                                    width: `${Math.min(100, s.avg_completion ?? 0)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))
                            )}
                        </section>
                    </div>

                    <p className="text-xs text-neutral-500">
                        Passed means an average quiz score of at least {data.pass_percentage}%
                        across every quiz attempt to date (change the pass mark in Settings → Batch
                        reports). Completion, time and concentration are for the selected dates.
                        {data.learners_truncated &&
                            ' Large batch: only the first learners are counted.'}
                    </p>
                </>
            )}
        </div>
    );
}
