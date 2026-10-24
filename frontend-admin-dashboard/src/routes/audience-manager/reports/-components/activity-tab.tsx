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
                    <DailyActivityStrip points={daily} />
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

// ── Daily activity strip (data-driven bars; no chart library) ──────────
// Same data-driven-width idiom as the Funnel tab's stage bars — one bar per
// day, height scaled to the busiest day, native-title tooltip per bar.

function DailyActivityStrip({ points }: { points: ActivityDayPoint[] }) {
    const { t } = useTranslation('audienceManagerActivityTab');
    const max = Math.max(1, ...points.map((p) => p.total));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-32 items-end gap-0.5 overflow-x-auto">
                {points.map((p) => {
                    const pct = Math.max(2, Math.round((p.total / max) * 100));
                    return (
                        <div
                            key={p.date}
                            title={t('dailyActivity.barTooltip', {
                                date: p.date,
                                count: p.total,
                            })}
                            // A per-bar minimum width keeps long ranges legible (horizontal
                            // scroll kicks in past the container). Layout sizing, not a
                            // color/spacing/type token — set inline, isolated to this rule.
                            className="flex flex-1 items-end"
                            style={{ minWidth: 6 }}
                        >
                            {/* Height is data-driven; colour comes from a Tailwind utility class. */}
                            <div
                                className={cn(
                                    'w-full rounded-sm transition-colors',
                                    p.total > 0
                                        ? 'bg-primary-400 hover:bg-primary-500'
                                        : 'bg-neutral-100'
                                )}
                                style={{ height: `${pct}%` }}
                            />
                        </div>
                    );
                })}
            </div>
            {/* Axis: first · midpoint · last date label, mirroring the Calling chart ticks. */}
            <div className="flex justify-between text-xs text-neutral-400">
                <span>{points[0]?.date.slice(5)}</span>
                {points.length > 2 && (
                    <span>{points[Math.floor(points.length / 2)]?.date.slice(5)}</span>
                )}
                <span>{points[points.length - 1]?.date.slice(5)}</span>
            </div>
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
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
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
                            <td className="py-2.5 pr-3 font-medium text-neutral-900">
                                {r.name ?? (
                                    <span className="text-neutral-400">
                                        {t('counsellorActivity.unknownCounsellor')}
                                    </span>
                                )}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.notes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.calls)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.status_changes)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.followups_created)}
                            </td>
                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                {fmtNumber(r.followups_closed)}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-semibold text-neutral-900">
                                {fmtNumber(r.total)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
