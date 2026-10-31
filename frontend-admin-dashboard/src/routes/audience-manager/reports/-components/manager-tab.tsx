/**
 * Reports Center — Manager (team-rollup) tab.
 *
 * Team-comparison rollup from GET /v1/reports/team-rollup: one row per team
 * (Team · Head · Counsellors · Leads · Responded · Conversions · Conv % · Open
 * · Overdue · Avg response · Target · Attainment %), sortable by any numeric
 * column, with a pinned Totals row, a conversion-rate comparison bar across
 * teams, and a client-side CSV export of the rows already loaded.
 *
 * No per-team drill-through: Recent Leads has no team filter param, so team
 * rows are read-only here (see followups).
 *
 * RBAC-scoped + aggregated server-side in the institute's report timezone; the
 * tab just renders the rows. Mirrors funnel-tab.tsx's data/render contract.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChartBar, Users, UsersThree } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchTeamRollup,
    teamRollupQueryKey,
    type ManagerReportParams,
    type TeamRollupRow,
} from './manager-reports-service';
import {
    BreakdownCard,
    BreakdownBar,
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    convRateClass,
    fmtMinutes,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

// ── Sort model ─────────────────────────────────────────────────────────

/** Sortable columns — string label ("name") plus every numeric/percent metric. */
type SortKey =
    | 'name'
    | 'counsellors'
    | 'leads'
    | 'responded'
    | 'conversions'
    | 'conversion_rate'
    | 'open'
    | 'overdue'
    | 'avg_response_minutes'
    | 'target'
    | 'attainment_pct';

/** Display label for a team row, with stable fallbacks. */
function teamLabel(row: TeamRollupRow, t: TFunction): string {
    return row.team_name || row.team_id || t('unassigned');
}

/** Sort accessor — "name" maps to the team label, every other key reads the metric. */
function sortValue(row: TeamRollupRow, key: SortKey, t: TFunction): string | number | null {
    if (key === 'name') return teamLabel(row, t);
    return row[key];
}

// ── Main component (mirrors funnel-tab.tsx contract) ───────────────────

export function ManagerTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerManagerTab');

    const params: ManagerReportParams = {
        instituteId,
        fromDate,
        toDate,
        teamId,
        counsellorUserId,
        audienceId,
    };

    const query = useQuery({
        queryKey: teamRollupQueryKey(params),
        queryFn: () => fetchTeamRollup(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const [sortKey, setSortKey] = useState<SortKey>('conversions');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const teams = useMemo(() => query.data?.teams ?? [], [query.data]);
    const totals = query.data?.totals ?? null;

    const sortedTeams = useMemo(() => {
        const copy = [...teams];
        copy.sort((a, b) => {
            const av = sortValue(a, sortKey, t);
            const bv = sortValue(b, sortKey, t);
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
        return copy;
    }, [teams, sortKey, sortDir, t]);

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'name' ? 'asc' : 'desc');
        }
    };

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    // Conversion-rate comparison uses the team with the most leads as the bar baseline.
    const maxLeads = Math.max(1, ...teams.map((row) => row.leads));


    return (
        <div className="flex flex-col gap-6">
            <ReportSection
                title={t('sectionTitle')}
                icon={<UsersThree size={18} />}
                actions={
                    <div className="flex items-center gap-2">
                        {teams.length > 0 && (
                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                                {t('teamsBadge', { count: teams.length })}
                            </span>
                        )}
                        <ExportWithColumnPickerButton
                            filename={`team-rollup_${fromDate}_${toDate}.csv`}
                            disabled={teams.length === 0}
                            getHeadersAndRows={() => ({
                                headers: [
                                    t('csv.team'),
                                    t('csv.head'),
                                    t('csv.counsellors'),
                                    t('csv.leads'),
                                    t('csv.responded'),
                                    t('csv.conversions'),
                                    t('csv.conversionRatePct'),
                                    t('csv.open'),
                                    t('csv.overdue'),
                                    t('csv.avgResponseMinutes'),
                                    t('csv.target'),
                                    t('csv.attainmentPct'),
                                ],
                                rows: [...sortedTeams, ...(totals ? [totals] : [])].map((row) => [
                                    row === totals ? teamLabel(row, t) || t('total') : teamLabel(row, t),
                                    row.head_name ?? '',
                                    row.counsellors,
                                    row.leads,
                                    row.responded,
                                    row.conversions,
                                    row.conversion_rate != null ? row.conversion_rate.toFixed(1) : '',
                                    row.open,
                                    row.overdue,
                                    row.avg_response_minutes != null
                                        ? Math.round(row.avg_response_minutes)
                                        : '',
                                    row.target ?? '',
                                    row.attainment_pct != null ? row.attainment_pct.toFixed(1) : '',
                                ]),
                            })}
                        />
                    </div>
                }
            >
                {teams.length === 0 ? (
                    <EmptyHint message={t('emptyHint')} />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                    <SortableHeader
                                        label={t('table.team')}
                                        sortKey="name"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                        align="left"
                                    />
                                    <th className="py-2 pe-3 text-start">{t('table.head')}</th>
                                    <SortableHeader
                                        label={t('table.counsellors')}
                                        sortKey="counsellors"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.leads')}
                                        sortKey="leads"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.responded')}
                                        sortKey="responded"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.conversions')}
                                        sortKey="conversions"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.convRate')}
                                        sortKey="conversion_rate"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.open')}
                                        sortKey="open"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.overdue')}
                                        sortKey="overdue"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.avgResponse')}
                                        sortKey="avg_response_minutes"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.target')}
                                        sortKey="target"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('table.attainmentPct')}
                                        sortKey="attainment_pct"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedTeams.map((row) => (
                                    <TeamRow key={row.team_id ?? teamLabel(row, t)} row={row} />
                                ))}
                            </tbody>
                            {totals && (
                                <tfoot>
                                    <TeamRow row={totals} pinned />
                                </tfoot>
                            )}
                        </table>
                    </div>
                )}
            </ReportSection>

            {/* Conversion-rate comparison across teams. */}
            {teams.length > 0 && (
                <BreakdownCard title={t('breakdownTitle')} icon={<ChartBar size={18} />}>
                    {sortedTeams.map((row) => (
                        <BreakdownBar
                            key={`bar-${row.team_id ?? teamLabel(row, t)}`}
                            label={`${teamLabel(row, t)} · ${fmtPct(row.conversion_rate)}`}
                            count={row.leads}
                            total={maxLeads}
                            converted={row.conversions}
                        />
                    ))}
                </BreakdownCard>
            )}

            <p className="text-xs text-neutral-400">{t('footnote')}</p>
        </div>
    );
}

// ── Team row (shared by body + pinned totals) ──────────────────────────

function TeamRow({ row, pinned = false }: { row: TeamRollupRow; pinned?: boolean }) {
    const { t } = useTranslation('audienceManagerManagerTab');
    const numCell = 'py-2.5 pr-3 text-right text-neutral-800';
    return (
        <tr
            className={cn(
                'border-b border-neutral-100 last:border-0',
                pinned
                    ? 'border-t border-neutral-200 bg-neutral-50 font-medium'
                    : 'hover:bg-neutral-50'
            )}
        >
            <td className="py-2.5 pr-3">
                <span className="flex items-center gap-2 font-medium text-neutral-900">
                    <Users size={14} className="shrink-0 text-neutral-400" />
                    {pinned ? teamLabel(row, t) || t('total') : teamLabel(row, t)}
                </span>
            </td>
            <td className="py-2.5 pr-3 text-left text-neutral-700">
                {row.head_name ?? <span className="text-neutral-400">—</span>}
            </td>
            <td className={numCell}>{fmtNumber(row.counsellors)}</td>
            <td className={numCell}>{fmtNumber(row.leads)}</td>
            <td className={numCell}>{fmtNumber(row.responded)}</td>
            <td className={numCell}>{fmtNumber(row.conversions)}</td>
            <td className={cn('py-2.5 pr-3 text-right', convRateClass(row.conversion_rate))}>
                {fmtPct(row.conversion_rate)}
            </td>
            <td className={numCell}>{fmtNumber(row.open)}</td>
            <td className="py-2.5 pr-3 text-right">
                {row.overdue > 0 ? (
                    <span className="font-medium text-red-600">{fmtNumber(row.overdue)}</span>
                ) : (
                    <span className="text-neutral-400">0</span>
                )}
            </td>
            <td className={numCell}>{fmtMinutes(row.avg_response_minutes)}</td>
            <td className={numCell}>
                {row.target != null ? fmtNumber(row.target) : <span className="text-neutral-400">—</span>}
            </td>
            <td className={cn('py-2.5 pr-3 text-right', convRateClass(row.attainment_pct))}>
                {row.attainment_pct != null ? fmtPct(row.attainment_pct) : '—'}
            </td>
        </tr>
    );
}
