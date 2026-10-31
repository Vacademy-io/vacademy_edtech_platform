/**
 * Reports Center — Counsellors tab.
 *
 * The counsellor performance table, moved out of the old Overview into its
 * own full-width tab. Same data source (GET /v1/reports/counselor-performance),
 * same sortable columns and colour-coded rate cells, and the row drill-through
 * to that counsellor's Recent Leads list.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretRight, Trophy, Users, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchCounselorPerformance,
    type CounselorPerformance,
    type CounselorRow,
} from '../-services/get-lead-reports';
import {
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    avatarPalette,
    convRateClass,
    fmtMinutes,
    fmtPct,
    tatMetClass,
    type ReportTabProps,
} from './report-shared';

/** Where the row drill-through lands. */
const RECENT_LEADS_ROUTE = '/audience-manager/recent-leads' as const;

export function CounsellorsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const navigate = useNavigate();
    const { t } = useTranslation('audienceManagerCounsellorsTab');

    const counsellorQuery = useQuery({
        queryKey: [
            'counselor-performance',
            instituteId,
            fromDate,
            toDate,
            teamId,
            counsellorUserId,
            audienceId,
        ],
        queryFn: () =>
            fetchCounselorPerformance(
                instituteId,
                fromDate,
                toDate,
                teamId,
                counsellorUserId,
                audienceId
            ),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    if (counsellorQuery.isLoading) return <ReportTabSkeleton />;
    if (counsellorQuery.isError) {
        return (
            <ReportErrorState
                error={counsellorQuery.error}
                onRetry={() => counsellorQuery.refetch()}
            />
        );
    }

    const performance = counsellorQuery.data;


    return (
        <ReportSection
            title={t('title')}
            icon={<Users size={18} />}
            actions={
                <div className="flex flex-wrap items-center gap-3">
                    {performance && (
                        <span className="text-xs text-neutral-500">
                            {t('summary.counsellorCount', {
                                count: performance.summary.total_counselors,
                            })}
                            {performance.summary.avg_response_minutes != null && (
                                <>
                                    {' '}
                                    · {t('summary.avgResponse')}{' '}
                                    <strong className="text-neutral-700">
                                        {fmtMinutes(performance.summary.avg_response_minutes)}
                                    </strong>
                                </>
                            )}
                            {performance.summary.avg_conversion_rate != null && (
                                <>
                                    {' '}
                                    · {t('summary.avgConversion')}{' '}
                                    <strong className="text-neutral-700">
                                        {fmtPct(performance.summary.avg_conversion_rate)}
                                    </strong>
                                </>
                            )}
                        </span>
                    )}
                    <ExportWithColumnPickerButton
                        filename={`counsellor-performance_${fromDate}_${toDate}.csv`}
                        disabled={!performance || performance.rows.length === 0}
                        getHeadersAndRows={() => ({
                            headers: [
                                t('csv.headers.counsellor'),
                                t('csv.headers.assigned'),
                                t('csv.headers.responded'),
                                t('csv.headers.conversions'),
                                t('csv.headers.convRate'),
                                t('csv.headers.avgResponse'),
                                t('csv.headers.tatMet'),
                                t('csv.headers.open'),
                                t('csv.headers.overdue'),
                            ],
                            rows: (performance?.rows ?? []).map((r) => [
                                r.counselor_name,
                                r.leads_assigned,
                                r.leads_responded,
                                r.conversions,
                                r.conversion_rate,
                                r.avg_response_minutes,
                                r.tat_met_rate,
                                r.open_leads,
                                r.overdue_leads,
                            ]),
                        })}
                    />
                </div>
            }
        >
            <CounsellorTable
                performance={performance}
                loading={false}
                onRowClick={(counselorId) =>
                    navigate({
                        to: RECENT_LEADS_ROUTE,
                        search: { counsellor: counselorId },
                    })
                }
            />
        </ReportSection>
    );
}

// ── Sortable counsellor performance table ──────────────────────────────

type SortKey =
    | 'counselor_name'
    | 'leads_assigned'
    | 'leads_responded'
    | 'conversions'
    | 'conversion_rate'
    | 'avg_response_minutes'
    | 'tat_met_rate'
    | 'open_leads'
    | 'overdue_leads';

interface CounsellorTableProps {
    performance: CounselorPerformance | undefined;
    loading: boolean;
    /** Drill-through — row click opens that counsellor's Recent Leads. */
    onRowClick?: (counselorId: string) => void;
}
function CounsellorTable({ performance, loading, onRowClick }: CounsellorTableProps) {
    const { t } = useTranslation('audienceManagerCounsellorsTab');
    const [sortKey, setSortKey] = useState<SortKey>('leads_assigned');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const sortedRows: CounselorRow[] = useMemo(() => {
        if (!performance) return [];
        const rows = [...performance.rows];
        rows.sort((a, b) => {
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
        return rows;
    }, [performance, sortKey, sortDir]);

    // Top performer = highest conversions (then highest conv. rate); only highlighted when ≥ 2 rows.
    const topRow = useMemo(() => {
        if (!performance || performance.rows.length < 2) return null;
        return [...performance.rows].sort((a, b) => {
            if (b.conversions !== a.conversions) return b.conversions - a.conversions;
            return (b.conversion_rate ?? 0) - (a.conversion_rate ?? 0);
        })[0];
    }, [performance]);

    if (loading) {
        return (
            <div className="py-8 text-center text-sm text-neutral-400">
                {t('table.loading')}
            </div>
        );
    }
    if (!performance || performance.rows.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-neutral-400">
                <Users size={28} />
                {t('table.empty')}
            </div>
        );
    }

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'counselor_name' ? 'asc' : 'desc');
        }
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                        <SortableHeader
                            label={t('table.headers.counsellor')}
                            sortKey="counselor_name"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                            align="left"
                        />
                        <SortableHeader
                            label={t('table.headers.assigned')}
                            sortKey="leads_assigned"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.responded')}
                            sortKey="leads_responded"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.conversions')}
                            sortKey="conversions"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.convRate')}
                            sortKey="conversion_rate"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.avgResponse')}
                            sortKey="avg_response_minutes"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.tatMet')}
                            sortKey="tat_met_rate"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.open')}
                            sortKey="open_leads"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                        <SortableHeader
                            label={t('table.headers.overdue')}
                            sortKey="overdue_leads"
                            current={sortKey}
                            dir={sortDir}
                            onClick={toggleSort}
                        />
                    </tr>
                </thead>
                <tbody>
                    {sortedRows.map((r) => {
                        const isTop =
                            topRow != null &&
                            r.counselor_id === topRow.counselor_id &&
                            r.conversions > 0;
                        return (
                            <tr
                                key={r.counselor_id}
                                className={cn(
                                    'group border-b border-neutral-100 last:border-0 hover:bg-neutral-50',
                                    isTop && 'bg-amber-50/40',
                                    onRowClick && 'cursor-pointer'
                                )}
                                onClick={onRowClick ? () => onRowClick(r.counselor_id) : undefined}
                            >
                                <td className="py-2.5 pr-3">
                                    <div className="flex items-center gap-2">
                                        <div
                                            className={cn(
                                                'flex size-8 items-center justify-center rounded-full text-xs font-semibold',
                                                avatarPalette(r.counselor_name)
                                            )}
                                        >
                                            {(r.counselor_name || '?').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex flex-col gap-0.5">
                                            <span className="flex items-center gap-1 font-medium text-neutral-900">
                                                {r.counselor_name}
                                                {onRowClick && (
                                                    <CaretRight
                                                        size={12}
                                                        className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                                                    />
                                                )}
                                            </span>
                                            {isTop && (
                                                <span className="flex items-center gap-1 text-xs text-amber-700">
                                                    <Trophy size={11} weight="fill" />
                                                    {t('table.topPerformer')}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                    {r.leads_assigned}
                                </td>
                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                    {r.leads_responded}
                                </td>
                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                    {r.conversions}
                                </td>
                                <td
                                    className={cn(
                                        'py-2.5 pr-3 text-right',
                                        convRateClass(r.conversion_rate)
                                    )}
                                >
                                    {fmtPct(r.conversion_rate)}
                                </td>
                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                    {fmtMinutes(r.avg_response_minutes)}
                                </td>
                                <td
                                    className={cn(
                                        'py-2.5 pr-3 text-right',
                                        tatMetClass(r.tat_met_rate)
                                    )}
                                >
                                    {fmtPct(r.tat_met_rate)}
                                </td>
                                <td className="py-2.5 pr-3 text-right text-neutral-800">
                                    {r.open_leads}
                                </td>
                                <td className="py-2.5 pr-3 text-right">
                                    {r.overdue_leads > 0 ? (
                                        <span className="inline-flex items-center gap-1 font-medium text-red-600">
                                            <WarningCircle size={12} weight="fill" />
                                            {r.overdue_leads}
                                        </span>
                                    ) : (
                                        <span className="text-neutral-400">0</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
