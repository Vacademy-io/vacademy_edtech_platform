/**
 * Reports Center — Follow-ups tab.
 *
 * Point-in-time aging of OPEN follow-ups from GET /v1/reports/followup-aging:
 * bucket KPI tiles (Due today · Overdue 1–3d · 3–7d · 7+d · Upcoming), a
 * per-counsellor aging table (sortable, defaults to most 7+d overdue first),
 * and the trailing-30-day closure-reasons list. Counsellor rows drill through
 * to /audience-manager/follow-ups?counsellor=<id>.
 *
 * Note: aging is point-in-time (open follow-ups right now), so the shell's
 * date range does not bound the buckets — team/counsellor scoping still applies.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { PerLeadExports } from './per-lead-exports';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Alarm,
    CalendarCheck,
    CaretRight,
    ClipboardText,
    Users,
    WarningCircle,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchFollowupAging,
    followupAgingQueryKey,
    type FollowupAgingBucketKey,
} from '../-services/get-crm-reports';
import {
    BreakdownBar,
    EmptyHint,
    ExportWithColumnPickerButton,
    KpiCard,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    avatarPalette,
    fmtNumber,
    type ReportTabProps,
} from './report-shared';

/** Where counsellor rows drill through to. */
const FOLLOW_UPS_ROUTE = '/audience-manager/follow-ups' as const;

const BUCKET_ORDER: FollowupAgingBucketKey[] = [
    'DUE_TODAY',
    'OVERDUE_1_3',
    'OVERDUE_3_7',
    'OVERDUE_7_PLUS',
    'UPCOMING',
];

/** Bucket display labels — built with `t` so they re-localize on language change. */
function buildBucketMeta(
    t: TFunction
): Record<
    FollowupAgingBucketKey,
    { label: string; tone: 'warning' | 'danger' | 'info' | 'primary' | 'default' }
> {
    return {
        DUE_TODAY: { label: t('buckets.dueToday'), tone: 'warning' },
        OVERDUE_1_3: { label: t('buckets.overdue1to3'), tone: 'danger' },
        OVERDUE_3_7: { label: t('buckets.overdue3to7'), tone: 'danger' },
        OVERDUE_7_PLUS: { label: t('buckets.overdue7plus'), tone: 'danger' },
        UPCOMING: { label: t('buckets.upcoming'), tone: 'info' },
    };
}

type SortKey =
    | 'name'
    | 'due_today'
    | 'overdue_1_3'
    | 'overdue_3_7'
    | 'overdue_7_plus'
    | 'upcoming'
    | 'oldest_overdue_days';

export function FollowupsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('audienceManagerFollowupsTab');
    const BUCKET_META = useMemo(() => buildBucketMeta(t), [t]);
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId };

    const query = useQuery({
        queryKey: followupAgingQueryKey(params),
        queryFn: () => fetchFollowupAging(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    // Default sort: deepest 7+d overdue first — the triage order.
    const [sortKey, setSortKey] = useState<SortKey>('overdue_7_plus');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const rows = useMemo(() => {
        const list = [...(query.data?.by_counsellor ?? [])];
        list.sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            // Nulls sink to the bottom regardless of direction.
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') {
                return sortDir === 'asc' ? av - bv : bv - av;
            }
            const s = String(av).localeCompare(String(bv));
            return sortDir === 'asc' ? s : -s;
        });
        return list;
    }, [query.data, sortKey, sortDir]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const report = query.data;
    const bucketCount = (key: FollowupAgingBucketKey) =>
        report?.buckets.find((b) => b.key === key)?.count ?? 0;
    const totalClosureCount = (report?.closure_reasons ?? []).reduce((s, r) => s + r.count, 0);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'name' ? 'asc' : 'desc');
        }
    };

    const drill = (userId: string) =>
        navigate({ to: FOLLOW_UPS_ROUTE, search: { counsellor: userId } });


    return (
        <div className="flex flex-col gap-6">
            {/* Per-lead overdue export — only for institutes that turned it on. */}
            <PerLeadExports
                kinds={['overdue']}
                instituteId={instituteId}
                fromDate={fromDate}
                toDate={toDate}
                teamId={teamId}
                counsellorUserId={counsellorUserId}
                audienceId={audienceId}
            />
            {/* Aging bucket tiles */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {BUCKET_ORDER.map((key) => (
                    <KpiCard
                        key={key}
                        label={BUCKET_META[key].label}
                        value={fmtNumber(bucketCount(key))}
                        tone={bucketCount(key) > 0 ? BUCKET_META[key].tone : 'default'}
                        icon={
                            key === 'UPCOMING' ? (
                                <CalendarCheck size={20} weight="bold" />
                            ) : key === 'DUE_TODAY' ? (
                                <Alarm size={20} weight="bold" />
                            ) : (
                                <WarningCircle size={20} weight="bold" />
                            )
                        }
                    />
                ))}
            </div>

            {/* Per-counsellor aging table */}
            <ReportSection
                title={t('section.agingByCounsellor')}
                icon={<Users size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`followup-aging_${new Date().toISOString().slice(0, 10)}.csv`}
                        disabled={rows.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('csv.headers.counsellor'),
                                t('csv.headers.dueToday'),
                                t('csv.headers.overdue1to3'),
                                t('csv.headers.overdue3to7'),
                                t('csv.headers.overdue7plus'),
                                t('csv.headers.upcoming'),
                                t('csv.headers.oldestOverdueDays'),
                            ],
                            rows: rows.map((r) => [
                                r.name ?? r.user_id,
                                r.due_today,
                                r.overdue_1_3,
                                r.overdue_3_7,
                                r.overdue_7_plus,
                                r.upcoming,
                                r.oldest_overdue_days,
                            ]),
                        })}
                    />
                }
            >
                {rows.length === 0 ? (
                    <EmptyHint message={t('empty.noOpenFollowups')} />
                ) : (
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
                                        label={t('table.headers.dueToday')}
                                        sortKey="due_today"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.headers.days1to3')}
                                        sortKey="overdue_1_3"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.headers.days3to7')}
                                        sortKey="overdue_3_7"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.headers.days7plus')}
                                        sortKey="overdue_7_plus"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.headers.upcoming')}
                                        sortKey="upcoming"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.headers.oldestOverdue')}
                                        sortKey="oldest_overdue_days"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const name = r.name ?? r.user_id;
                                    return (
                                        <tr
                                            key={r.user_id}
                                            className="group cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                            onClick={() => drill(r.user_id)}
                                        >
                                            <td className="py-2.5 pr-3">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className={cn(
                                                            'flex size-8 items-center justify-center rounded-full text-xs font-semibold',
                                                            avatarPalette(name)
                                                        )}
                                                    >
                                                        {(name || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                    <span className="flex items-center gap-1 font-medium text-neutral-900">
                                                        {name}
                                                        <CaretRight
                                                            size={12}
                                                            className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                                                        />
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                {r.due_today > 0 ? (
                                                    <span className="font-medium text-amber-700">
                                                        {r.due_today}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-400">0</span>
                                                )}
                                            </td>
                                            <OverdueCell value={r.overdue_1_3} />
                                            <OverdueCell value={r.overdue_3_7} />
                                            <OverdueCell value={r.overdue_7_plus} strong />
                                            <td className="py-2.5 pr-3 text-right text-neutral-800">
                                                {r.upcoming}
                                            </td>
                                            <td className="py-2.5 pr-3 text-right">
                                                {r.oldest_overdue_days != null ? (
                                                    <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                                        <WarningCircle size={12} weight="fill" />
                                                        {t('table.oldestOverdueValue', {
                                                            count: r.oldest_overdue_days,
                                                        })}
                                                    </span>
                                                ) : (
                                                    <span className="text-neutral-400">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </ReportSection>

            {/* Closure reasons */}
            <ReportSection title={t('section.closureReasons')} icon={<ClipboardText size={18} />}>
                {(report?.closure_reasons ?? []).length === 0 ? (
                    <EmptyHint message={t('empty.noClosures')} />
                ) : (
                    <div className="flex flex-col gap-3">
                        {(report?.closure_reasons ?? []).map((r) => (
                            <BreakdownBar
                                key={r.reason}
                                label={r.reason}
                                count={r.count}
                                total={totalClosureCount}
                                colorClass="bg-primary-500"
                            />
                        ))}
                    </div>
                )}
            </ReportSection>
        </div>
    );
}

/** Overdue count cell — red when non-zero, muted zero otherwise. */
function OverdueCell({ value, strong }: { value: number; strong?: boolean }) {
    return (
        <td className="py-2.5 pr-3 text-right">
            {value > 0 ? (
                <span className={cn('text-red-600', strong ? 'font-semibold' : 'font-medium')}>
                    {value}
                </span>
            ) : (
                <span className="text-neutral-400">0</span>
            )}
        </td>
    );
}
