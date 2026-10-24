/**
 * Reports Center — Dispositions tab.
 *
 * Post-call disposition reporting from GET /v1/reports/dispositions, in three
 * matrices keyed by actor (counsellor / the synthetic SYSTEM workflow):
 *
 *   1. Current status by counsellor — rows = counsellors (plus "Unassigned"
 *      for admins), columns = the active status catalog, cells = the leads
 *      RECEIVED in the date range that CURRENTLY hold that status ("of this
 *      month's leads: 10 New, 5 Converted"). Trailing "No status" + Total.
 *   2. Status changes by counsellor — rows = actors (sorted by total changes
 *      desc), columns = the active status catalog (colour-chip headers from
 *      the per-institute colours), cells = transition counts into each status
 *      (0 dimmed), plus a trailing Total column.
 *   3. Call outcomes by counsellor — rows = actors, columns = the distinct
 *      CALL_STATUS outcomes present across the window, cells = call counts.
 *
 * Read-only; all matrices export the rows already loaded to CSV.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowsLeftRight, ChartBarHorizontal, Phone } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    fetchDispositions,
    dispositionsQueryKey,
    type DispositionActorRow,
    type DispositionCallOutcomeRow,
    type DispositionCurrentStatusRow,
    type DispositionStatusMeta,
} from '../-services/get-crm-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    fmtNumber,
    type ReportTabProps,
} from './report-shared';

export function DispositionsTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerDispositionsTab');
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId };

    const query = useQuery({
        queryKey: dispositionsQueryKey(params),
        queryFn: () => fetchDispositions(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    // Active status catalog = the stable column set for the status matrix.
    const statuses = query.data?.statuses ?? [];

    // Actors sorted by total status changes desc (name tiebreaker).
    const statusRows = useMemo(() => {
        const rows = [...(query.data?.rows ?? [])];
        rows.sort((a, b) => {
            if (b.total_changes !== a.total_changes) return b.total_changes - a.total_changes;
            return actorName(a).localeCompare(actorName(b));
        });
        return rows;
    }, [query.data]);

    // Distinct CALL_STATUS keys present across all actors, stable-sorted, form
    // the call-outcome matrix columns.
    const outcomeKeys = useMemo(() => {
        const set = new Set<string>();
        for (const row of query.data?.call_outcomes ?? []) {
            for (const key of Object.keys(row.outcomes)) set.add(key);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }, [query.data]);

    const outcomeRows = useMemo(() => {
        const rows = [...(query.data?.call_outcomes ?? [])];
        rows.sort((a, b) => outcomeTotal(b) - outcomeTotal(a) || actorName(a).localeCompare(actorName(b)));
        return rows;
    }, [query.data]);

    // In-window leads per counsellor × current status, biggest book first.
    const currentStatusRows = useMemo(() => {
        const rows = [...(query.data?.current_status_rows ?? [])];
        rows.sort((a, b) => b.total_leads - a.total_leads || actorName(a).localeCompare(actorName(b)));
        return rows;
    }, [query.data]);

    if (query.isLoading) return <ReportTabSkeleton />;
    if (query.isError) {
        return <ReportErrorState error={query.error} onRetry={() => query.refetch()} />;
    }

    const getStatusExportData = () => {
        const dataRows = statusRows.map((r) => {
            const cols = statuses.map((s) => r.changes[s.status_key] ?? 0);
            const total = cols.reduce((sum, n) => sum + n, 0);
            return [actorName(r), ...cols, total, r.pending_count ?? 0];
        });
        const footerCols = statuses.map((_, si) =>
            dataRows.reduce((sum, row) => sum + ((row[si + 1] as number) ?? 0), 0)
        );
        const footerTotal = footerCols.reduce((sum, n) => sum + n, 0);
        const footerPending = dataRows.reduce(
            (sum, row) => sum + ((row[row.length - 1] as number) ?? 0),
            0
        );
        return {
            headers: [
                t('table.counsellor'),
                ...statuses.map((s) => s.label || s.status_key),
                t('table.total'),
                t('table.pending'),
            ],
            rows: [
                ...dataRows,
                [t('table.totalRowLabel'), ...footerCols, footerTotal, footerPending],
            ],
        };
    };

    const getCurrentStatusExportData = () => {
        const dataRows = currentStatusRows.map((r) => [
            actorName(r),
            ...statuses.map((s) => r.statuses[s.status_key] ?? 0),
            r.no_status_count ?? 0,
            r.total_leads,
        ]);
        const footerCols = statuses.map((_, si) =>
            dataRows.reduce((sum, row) => sum + ((row[si + 1] as number) ?? 0), 0)
        );
        const footerNoStatus = dataRows.reduce(
            (sum, row) => sum + ((row[row.length - 2] as number) ?? 0),
            0
        );
        const footerTotal = dataRows.reduce(
            (sum, row) => sum + ((row[row.length - 1] as number) ?? 0),
            0
        );
        return {
            headers: [
                t('table.counsellor'),
                ...statuses.map((s) => s.label || s.status_key),
                t('table.noStatus'),
                t('table.totalLeads'),
            ],
            rows: [
                ...dataRows,
                [t('table.totalRowLabel'), ...footerCols, footerNoStatus, footerTotal],
            ],
        };
    };

    const getOutcomeExportData = () => {
        const dataRows = outcomeRows.map((r) => [
            actorName(r),
            ...outcomeKeys.map((k) => r.outcomes[k] ?? 0),
            outcomeTotal(r),
        ]);
        const footerCols = outcomeKeys.map((_, ki) =>
            dataRows.reduce((sum, row) => sum + ((row[ki + 1] as number) ?? 0), 0)
        );
        const footerTotal = footerCols.reduce((sum, n) => sum + n, 0);
        return {
            headers: [t('table.counsellor'), ...outcomeKeys.map(outcomeLabel), t('table.total')],
            rows: [...dataRows, [t('table.totalRowLabel'), ...footerCols, footerTotal]],
        };
    };

    return (
        <div className="flex flex-col gap-6">
            {/* ── Current status by counsellor (in-window cohort) ─────────── */}
            <ReportSection
                title={t('sections.currentStatus.title')}
                icon={<ChartBarHorizontal size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`dispositions-current-status_${fromDate}_${toDate}.csv`}
                        disabled={currentStatusRows.length === 0 || statuses.length === 0}
                        getHeadersAndRows={getCurrentStatusExportData}
                    />
                }
            >
                {currentStatusRows.length === 0 || statuses.length === 0 ? (
                    <EmptyHint message={t('sections.currentStatus.emptyHint')} />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left">
                                            {t('table.counsellor')}
                                        </th>
                                        {statuses.map((s) => (
                                            <StatusHeaderCell key={s.status_key} status={s} />
                                        ))}
                                        <th className="py-2 pl-3 text-right text-warning-600">
                                            {t('table.noStatus')}
                                        </th>
                                        <th className="py-2 ps-3 text-end">{t('table.total')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {currentStatusRows.map((r) => (
                                        <tr
                                            key={r.user_id}
                                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                        >
                                            <td className="sticky left-0 z-10 bg-white py-2.5 pr-3 font-medium text-neutral-900">
                                                {actorName(r)}
                                            </td>
                                            {statuses.map((s) => (
                                                <CountCell
                                                    key={s.status_key}
                                                    value={r.statuses[s.status_key] ?? 0}
                                                />
                                            ))}
                                            <td
                                                className={cn(
                                                    'py-2.5 pl-3 text-right tabular-nums font-semibold',
                                                    (r.no_status_count ?? 0) > 0
                                                        ? 'text-warning-600'
                                                        : 'text-neutral-300'
                                                )}
                                            >
                                                {r.no_status_count ?? 0}
                                            </td>
                                            <td className="py-2.5 pl-3 text-right font-semibold text-neutral-900">
                                                {fmtNumber(r.total_leads)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-neutral-400">
                            {t('sections.currentStatus.description')}
                        </p>
                    </>
                )}
            </ReportSection>

            {/* ── Status changes by counsellor ────────────────────────────── */}
            <ReportSection
                title={t('sections.statusChanges.title')}
                icon={<ArrowsLeftRight size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`dispositions-status-changes_${fromDate}_${toDate}.csv`}
                        disabled={statusRows.length === 0 || statuses.length === 0}
                        getHeadersAndRows={getStatusExportData}
                    />
                }
            >
                {statusRows.length === 0 || statuses.length === 0 ? (
                    <EmptyHint message={t('sections.statusChanges.emptyHint')} />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left">
                                            {t('table.counsellor')}
                                        </th>
                                        {statuses.map((s) => (
                                            <StatusHeaderCell key={s.status_key} status={s} />
                                        ))}
                                        <th className="py-2 ps-3 text-end">{t('table.total')}</th>
                                        <th className="py-2 pl-3 text-right text-warning-600">
                                            {t('table.pending')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {statusRows.map((r) => (
                                        <tr
                                            key={r.user_id}
                                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                        >
                                            <td className="sticky left-0 z-10 bg-white py-2.5 pr-3 font-medium text-neutral-900">
                                                {actorName(r)}
                                            </td>
                                            {statuses.map((s) => (
                                                <CountCell
                                                    key={s.status_key}
                                                    value={r.changes[s.status_key] ?? 0}
                                                />
                                            ))}
                                            <td className="py-2.5 pl-3 text-right font-semibold text-neutral-900">
                                                {fmtNumber(r.total_changes)}
                                            </td>
                                            <td
                                                className={cn(
                                                    'py-2.5 pl-3 text-right tabular-nums font-semibold',
                                                    (r.pending_count ?? 0) > 0
                                                        ? 'text-warning-600'
                                                        : 'text-neutral-300'
                                                )}
                                            >
                                                {r.pending_count ?? 0}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-neutral-400">
                            {t('sections.statusChanges.description')}
                        </p>
                    </>
                )}
            </ReportSection>

            {/* ── Call outcomes by counsellor ─────────────────────────────── */}
            <ReportSection
                title={t('sections.callOutcomes.title')}
                icon={<Phone size={18} />}
                actions={
                    <ExportWithColumnPickerButton
                        filename={`dispositions-call-outcomes_${fromDate}_${toDate}.csv`}
                        disabled={outcomeRows.length === 0 || outcomeKeys.length === 0}
                        getHeadersAndRows={getOutcomeExportData}
                    />
                }
            >
                {outcomeRows.length === 0 || outcomeKeys.length === 0 ? (
                    <EmptyHint message={t('sections.callOutcomes.emptyHint')} />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                        <th className="sticky left-0 z-10 bg-white py-2 pr-3 text-left">
                                            {t('table.counsellor')}
                                        </th>
                                        {outcomeKeys.map((k) => (
                                            <th key={k} className="py-2 pl-3 text-right">
                                                {outcomeLabel(k)}
                                            </th>
                                        ))}
                                        <th className="py-2 ps-3 text-end">{t('table.total')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {outcomeRows.map((r) => (
                                        <tr
                                            key={r.user_id}
                                            className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                        >
                                            <td className="sticky left-0 z-10 bg-white py-2.5 pr-3 font-medium text-neutral-900">
                                                {actorName(r)}
                                            </td>
                                            {outcomeKeys.map((k) => (
                                                <CountCell key={k} value={r.outcomes[k] ?? 0} />
                                            ))}
                                            <td className="py-2.5 pl-3 text-right font-semibold text-neutral-900">
                                                {fmtNumber(outcomeTotal(r))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-neutral-400">
                            {t('sections.callOutcomes.description')}
                        </p>
                    </>
                )}
            </ReportSection>
        </div>
    );
}

// ── Cells ──────────────────────────────────────────────────────────────

/** Colour-chip status header for the status matrix — catalog colour from API. */
function StatusHeaderCell({ status }: { status: DispositionStatusMeta }) {
    return (
        <th className="py-2 pl-3 text-right font-medium normal-case text-neutral-500">
            <span className="inline-flex items-center justify-end gap-1.5">
                {/* Catalog colour from API — isolated dynamic style. */}
                <span
                    className={cn('size-2.5 shrink-0 rounded-sm', !status.color && 'bg-primary-500')}
                    style={status.color ? { backgroundColor: status.color } : undefined}
                />
                <span className="text-neutral-700">{status.label || status.status_key}</span>
            </span>
        </th>
    );
}

/** A numeric matrix cell — zero is dimmed so non-zero counts pop. */
function CountCell({ value }: { value: number }) {
    return (
        <td
            className={cn(
                'py-2.5 pl-3 text-right tabular-nums',
                value > 0 ? 'text-neutral-800' : 'text-neutral-300'
            )}
        >
            {value > 0 ? fmtNumber(value) : 0}
        </td>
    );
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Resolved actor name, falling back to the raw user id when hydration fails. */
function actorName(
    row: DispositionActorRow | DispositionCallOutcomeRow | DispositionCurrentStatusRow
): string {
    return row.name ?? row.user_id;
}

/** Sum of all outcome counts for an actor row. */
function outcomeTotal(row: DispositionCallOutcomeRow): number {
    return Object.values(row.outcomes).reduce((sum, n) => sum + n, 0);
}

/**
 * Humanize a CALL_STATUS enum key for display — these are raw enum NAMES from
 * the timeline (e.g. CONNECTED, NO_ANSWER), so render them title-cased.
 */
function outcomeLabel(key: string): string {
    return key
        .toLowerCase()
        .split('_')
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
}
