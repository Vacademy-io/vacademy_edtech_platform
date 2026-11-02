/**
 * Reports Center — Activity tab (Counsellor Activity Timeline).
 *
 * Throughput of CRM work per counsellor over the window, from
 * GET /v1/reports/activity-timeline: notes added, calls logged, status
 * changes, and follow-ups created / closed — counted off timeline_event rows,
 * RBAC-scoped server-side to the caller's leads subtree.
 *
 * Sections (top to bottom):
 *   1. Daily activity strip — a simple bar-per-day strip from the `daily`
 *      total series (institute-TZ buckets; same data-driven width idiom as the
 *      Funnel tab's stage bars).
 *   2. Per-counsellor table — sortable (Counsellor · Notes · Calls · Status
 *      changes · Follow-ups created · Follow-ups closed · Total), default sort
 *      Total desc, with client-side CSV export.
 *
 * Read-only; renders the canonical loading / empty / error states.
 */
import { useMemo, useState } from 'react';
import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChartBar, ListChecks } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    activityTimelineQueryKey,
    fetchActivityTimeline,
    isReportEndpointMissing,
    type ActivityByCounsellorRow,
    type ActivityDayPoint,
    type ActivityReportParams,
} from './activity-reports-service';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    fmtNumber,
    type ReportTabProps,
    fmtDay,
    fmtDayShort,
} from './report-shared';

export function ActivityTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerActivityTab');
    const params: ActivityReportParams = {
        instituteId,
        fromDate,
        toDate,
        teamId,
        counsellorUserId,
        audienceId,
    };

    const query = useQuery({
        queryKey: activityTimelineQueryKey(params),
        queryFn: () => fetchActivityTimeline(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        // Don't burn retries on an endpoint that isn't deployed yet.
        retry: (failureCount, error) => !isReportEndpointMissing(error) && failureCount < 2,
    });

    const daily = useMemo(() => query.data?.daily ?? [], [query.data]);
    const rows = useMemo(() => query.data?.by_counsellor ?? [], [query.data]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const dailyTotal = daily.reduce((s, d) => s + d.total, 0);


    return (
        <div className="flex flex-col gap-6">
            {/* 1 — Daily activity strip */}
            <ReportSection
                title={t('dailyActivity.title')}
                icon={<ChartBar size={18} />}
                actions={
                    <span className="text-xs text-neutral-500">
                        {t('dailyActivity.summary', { count: dailyTotal })}
                    </span>
                }
            >
                {daily.length === 0 ? (
                    <EmptyHint message={t('dailyActivity.empty')} />
                ) : (
                    <DailyActivityStrip points={daily} fromDate={fromDate} toDate={toDate} />
                )}
            </ReportSection>

            {/* 2 — Per-counsellor table */}
            <ReportSection
                title={t('counsellorActivity.title')}
                icon={<ListChecks size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`activity-timeline-${fromDate}-to-${toDate}.csv`}
                        disabled={rows.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('csv.headers.counsellor'),
                                t('csv.headers.notes'),
                                t('csv.headers.calls'),
                                t('csv.headers.statusChanges'),
                                t('csv.headers.followupsCreated'),
                                t('csv.headers.followupsClosed'),
                                t('csv.headers.total'),
                            ],
                            rows: rows.map((r) => [
                                r.name ?? r.user_id,
                                r.notes,
                                r.calls,
                                r.status_changes,
                                r.followups_created,
                                r.followups_closed,
                                r.total,
                            ]),
                        })}
                    />
                }
            >
                {rows.length === 0 ? (
                    <EmptyHint message={t('counsellorActivity.empty')} />
                ) : (
                    <CounsellorActivityTable rows={rows} />
                )}
            </ReportSection>
        </div>
    );
}

// ── Daily activity chart (data-driven bars; no chart library) ──────────
// The API returns only days that HAD activity, so the series is zero-filled over
// the selected range first: one bar per calendar day, so the axis dates line up
// with the bars and a quiet day shows as a gap instead of silently disappearing.

/** Round a max up to 1 / 2 / 5 × 10^n so the y-axis reads cleanly. */
function niceCeil(n: number): number {
    if (n <= 5) return 5;
    const pow = 10 ** Math.floor(Math.log10(n));
    const f = n / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

/** Every yyyy-MM-dd from `from` to `to` (inclusive), each with its count or 0. */
function fillDays(points: ActivityDayPoint[], from?: string, to?: string): ActivityDayPoint[] {
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const start = from || sorted[0]?.date;
    const end = to || sorted[sorted.length - 1]?.date;
    if (!start || !end || start > end) return sorted;
    const byDay = new Map(sorted.map((p) => [p.date.slice(0, 10), p.total]));
    return eachDayOfInterval({ start: parseISO(start), end: parseISO(end) }).map((d) => {
        const key = format(d, 'yyyy-MM-dd');
        return { date: key, total: byDay.get(key) ?? 0 };
    });
}

function DailyActivityStrip({
    points,
    fromDate,
    toDate,
}: {
    points: ActivityDayPoint[];
    fromDate?: string;
    toDate?: string;
}) {
    const { t } = useTranslation('audienceManagerActivityTab');
    const days = useMemo(() => fillDays(points, fromDate, toDate), [points, fromDate, toDate]);
    const [hovered, setHovered] = useState<number | null>(null);

    const total = days.reduce((s, d) => s + d.total, 0);
    const peak = days.reduce<ActivityDayPoint | null>(
        (best, d) => (best == null || d.total > best.total ? d : best),
        null
    );
    const idleDays = days.filter((d) => d.total === 0).length;
    const avg = days.length > 0 ? Math.round(total / days.length) : 0;
    const yMax = niceCeil(peak?.total ?? 0);
    // ~6 date labels whatever the range length.
    const tickEvery = Math.max(1, Math.ceil(days.length / 6));
    const active = hovered != null ? days[hovered] : null;

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StripStat label={t('dailyActivity.average')} value={fmtNumber(avg)} />
                <StripStat
                    label={t('dailyActivity.busiest')}
                    value={peak && peak.total > 0 ? fmtNumber(peak.total) : '—'}
                    sub={peak && peak.total > 0 ? fmtDay(peak.date) : undefined}
                />
                <StripStat
                    label={t('dailyActivity.idleDays')}
                    value={fmtNumber(idleDays)}
                    sub={t('dailyActivity.idleOf', { count: days.length })}
                />
            </div>

            {/* What the pointer is on — a fixed line, so the chart never jumps. */}
            <p className="text-sm text-neutral-600">
                {active ? (
                    <>
                        <span className="font-semibold text-neutral-900">
                            {fmtDay(active.date)}
                        </span>
                        {' · '}
                        {t('dailyActivity.dayCount', { count: active.total })}
                    </>
                ) : (
                    t('dailyActivity.hoverHint')
                )}
            </p>

            <div className="flex gap-2">
                {/* Y axis */}
                <div className="flex h-44 flex-col justify-between text-right text-xs tabular-nums text-neutral-500">
                    <span>{fmtNumber(yMax)}</span>
                    <span>{fmtNumber(yMax / 2)}</span>
                    <span>0</span>
                </div>
                <div className="min-w-0 flex-1 overflow-x-auto">
                    <div className="relative h-44">
                        {/* Gridlines at max / half / zero. */}
                        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-neutral-200" />
                        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-neutral-200" />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-neutral-300" />
                        <div
                            className="relative flex h-full items-end gap-0.5"
                            onMouseLeave={() => setHovered(null)}
                        >
                            {days.map((d, i) => {
                                const pct = d.total > 0 ? Math.max(2, (d.total / yMax) * 100) : 0;
                                return (
                                    <div
                                        key={d.date}
                                        title={t('dailyActivity.barTooltip', {
                                            date: fmtDay(d.date),
                                            count: d.total,
                                        })}
                                        onMouseEnter={() => setHovered(i)}
                                        // A per-bar minimum width keeps long ranges legible (horizontal
                                        // scroll kicks in past the container). Layout sizing, not a
                                        // color/spacing/type token — set inline, isolated to this rule.
                                        className={cn(
                                            'flex h-full flex-1 cursor-default items-end rounded-sm',
                                            hovered === i && 'bg-neutral-100'
                                        )}
                                        style={{ minWidth: 6 }}
                                    >
                                        {/* Height is data-driven; colour comes from a Tailwind utility class. */}
                                        <div
                                            className={cn(
                                                'w-full rounded-t-sm transition-colors duration-150',
                                                hovered === i ? 'bg-primary-600' : 'bg-primary-400'
                                            )}
                                            style={{ height: `${pct}%` }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    {/* X axis — one cell per day so each label sits under its own bar. */}
                    <div className="flex gap-0.5 pt-2 text-xs text-neutral-500">
                        {days.map((d, i) => (
                            <div key={d.date} className="relative h-4 flex-1" style={{ minWidth: 6 }}>
                                {(i % tickEvery === 0 || i === days.length - 1) && (
                                    <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap">
                                        {fmtDayShort(d.date)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StripStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="flex flex-col gap-0.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
            <span className="text-xs text-neutral-600">{label}</span>
            <span className="flex items-baseline gap-2">
                <span className="text-lg font-semibold tabular-nums text-neutral-900">{value}</span>
                {sub && <span className="text-xs text-neutral-500">{sub}</span>}
            </span>
        </div>
    );
}

// ── Sortable per-counsellor table ──────────────────────────────────────

type SortKey =
    | 'name'
    | 'notes'
    | 'calls'
    | 'status_changes'
    | 'followups_created'
    | 'followups_closed'
    | 'total';

function CounsellorActivityTable({ rows }: { rows: ActivityByCounsellorRow[] }) {
    const { t } = useTranslation('audienceManagerActivityTab');
    const [sortKey, setSortKey] = useState<SortKey>('total');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sortedRows = useMemo(() => {
        const copy = [...rows];
        copy.sort((a, b) => {
            if (sortKey === 'name') {
                const s = String(a.name ?? a.user_id).localeCompare(String(b.name ?? b.user_id));
                return sortDir === 'asc' ? s : -s;
            }
            const av = a[sortKey];
            const bv = b[sortKey];
            return sortDir === 'asc' ? av - bv : bv - av;
        });
        return copy;
    }, [rows, sortKey, sortDir]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'name' ? 'asc' : 'desc');
        }
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs font-semibold uppercase tracking-wide text-neutral-600 whitespace-nowrap">
                        <SortableHeader
                            label={t('table.headers.counsellor')}
                            sortKey="name"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                            align="left"
                        />
                        <SortableHeader
                            label={t('table.headers.notes')}
                            sortKey="notes"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.calls')}
                            sortKey="calls"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.statusChanges')}
                            sortKey="status_changes"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.followupsCreated')}
                            sortKey="followups_created"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.followupsClosed')}
                            sortKey="followups_closed"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.total')}
                            sortKey="total"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                    </tr>
                </thead>
                <tbody>
                    {sortedRows.map((r) => (
                        <tr
                            key={r.user_id}
                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                        >
                            <td className="py-3 pr-3 font-medium text-neutral-900">
                                {r.name ?? (
                                    <span className="text-neutral-400">
                                        {t('counsellorActivity.unknownCounsellor')}
                                    </span>
                                )}
                            </td>
                            <td className="py-3 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.notes)}
                            </td>
                            <td className="py-3 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.calls)}
                            </td>
                            <td className="py-3 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.status_changes)}
                            </td>
                            <td className="py-3 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.followups_created)}
                            </td>
                            <td className="py-3 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.followups_closed)}
                            </td>
                            <td className="py-3 pr-3 text-right font-semibold text-neutral-900">
                                {fmtNumber(r.total)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
