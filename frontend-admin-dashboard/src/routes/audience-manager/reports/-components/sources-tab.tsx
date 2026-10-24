/**
 * Reports Center — Sources tab.
 *
 * Per-source lead quality table from GET /v1/reports/source-performance:
 * Source · Leads · Connected · Interested · Won · Conv % plus the Wave-2/3
 * Spend / CPL / ROI columns (rendered as an em-dash with a "coming with spend
 * tracking" tooltip while the backend returns null). Rows drill through to
 * Recent Leads pre-filtered by ?source=<type>.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CaretRight, Megaphone } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
    fetchSourcePerformance,
    sourcePerformanceQueryKey,
    type SourcePerformanceRow,
} from '../-services/get-crm-reports';
import {
    EmptyHint,
    ExportWithColumnPickerButton,
    ReportErrorState,
    ReportSection,
    ReportTabSkeleton,
    SortableHeader,
    convRateClass,
    fmtCurrency,
    fmtNumber,
    fmtPct,
    type ReportTabProps,
} from './report-shared';

/** Where the row drill-through lands. */
const RECENT_LEADS_ROUTE = '/audience-manager/recent-leads' as const;

type SortKey =
    | 'source_type'
    | 'leads'
    | 'connected_leads'
    | 'interested'
    | 'won'
    | 'conversion_rate'
    | 'revenue';

export function SourcesTab({
    instituteId,
    fromDate,
    toDate,
    teamId,
    counsellorUserId,
    audienceId,
}: ReportTabProps) {
    const { t } = useTranslation('audienceManagerSourcesTab');
    const navigate = useNavigate();
    const params = { instituteId, fromDate, toDate, teamId, counsellorUserId, audienceId };

    const query = useQuery({
        queryKey: sourcePerformanceQueryKey(params),
        queryFn: () => fetchSourcePerformance(params),
        enabled: !!instituteId,
        staleTime: 60_000,
        retry: false,
    });

    const [sortKey, setSortKey] = useState<SortKey>('leads');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const rows = useMemo(() => {
        const list = [...(query.data?.rows ?? [])];
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

    const totals = query.data?.totals ?? null;

    const toggleSort = (k: SortKey) => {
        if (sortKey === k) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        } else {
            setSortKey(k);
            setSortDir(k === 'source_type' ? 'asc' : 'desc');
        }
    };


    return (
        <ReportSection
            title={t('title')}
            icon={<Megaphone size={18} />}
            actions={
                <ExportWithColumnPickerButton
                    filename={`source-performance_${fromDate}_${toDate}.csv`}
                    disabled={rows.length === 0}
                    getHeadersAndRows={() => {
                        const exportable = totals ? [...rows, totals] : rows;
                        return {
                            headers: [
                                t('columns.source'),
                                t('columns.leads'),
                                t('columns.connected'),
                                t('columns.interested'),
                                t('columns.won'),
                                t('columns.convRate'),
                                t('columns.revenue'),
                                t('columns.spend'),
                                t('columns.cpl'),
                                t('columns.roi'),
                            ],
                            rows: exportable.map((r) => [
                                r.source_type ?? t('csvTotalRow'),
                                r.leads,
                                r.connected_leads,
                                r.interested,
                                r.won,
                                r.conversion_rate,
                                r.revenue,
                                r.spend,
                                r.cpl,
                                r.roi,
                            ]),
                        };
                    }}
                />
            }
        >
            {rows.length === 0 ? (
                <EmptyHint message={t('emptyMessage')} />
            ) : (
                <TooltipProvider delayDuration={150}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                                    <SortableHeader
                                        label={t('columns.source')}
                                        sortKey="source_type"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                        align="left"
                                    />
                                    <SortableHeader
                                        label={t('columns.leads')}
                                        sortKey="leads"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('columns.connected')}
                                        sortKey="connected_leads"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('columns.interested')}
                                        sortKey="interested"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('columns.won')}
                                        sortKey="won"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('columns.convRate')}
                                        sortKey="conversion_rate"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <SortableHeader
                                        label={t('columns.revenue')}
                                        sortKey="revenue"
                                        current={sortKey}
                                        dir={sortDir}
                                        onClick={toggleSort}
                                    />
                                    <th className="py-2 pe-3 text-end">{t('columns.spend')}</th>
                                    <th className="py-2 pe-3 text-end">{t('columns.cpl')}</th>
                                    <th className="py-2 pe-3 text-end">{t('columns.roi')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr
                                        key={r.source_type ?? 'UNKNOWN'}
                                        className="group cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                                        onClick={() =>
                                            navigate({
                                                to: RECENT_LEADS_ROUTE,
                                                search: { source: r.source_type ?? undefined },
                                            })
                                        }
                                    >
                                        <td className="py-2.5 pr-3">
                                            <span className="flex items-center gap-1 font-medium text-neutral-900">
                                                {r.source_type ?? t('unknownSource')}
                                                <CaretRight
                                                    size={12}
                                                    className="text-neutral-300 transition-colors group-hover:text-neutral-500"
                                                />
                                            </span>
                                        </td>
                                        <td className="py-2.5 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.leads)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.connected_leads)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.interested)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right text-neutral-800">
                                            {fmtNumber(r.won)}
                                        </td>
                                        <td
                                            className={cn(
                                                'py-2.5 pr-3 text-right',
                                                convRateClass(r.conversion_rate)
                                            )}
                                        >
                                            {fmtPct(r.conversion_rate)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right font-medium text-green-700">
                                            {r.revenue ? fmtCurrency(r.revenue) : '—'}
                                        </td>
                                        <WaveTwoCell value={r.spend} />
                                        <WaveTwoCell value={r.cpl} />
                                        <WaveTwoCell value={r.roi} />
                                    </tr>
                                ))}
                            </tbody>
                            {totals && (
                                <tfoot>
                                    <tr className="border-t border-neutral-200 bg-neutral-50/60 font-semibold text-neutral-900">
                                        <td className="py-2.5 pe-3">{t('footerTotal')}</td>
                                        <td className="py-2.5 pr-3 text-right">
                                            {fmtNumber(totals.leads)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right">
                                            {fmtNumber(totals.connected_leads)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right">
                                            {fmtNumber(totals.interested)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right">
                                            {fmtNumber(totals.won)}
                                        </td>
                                        <td
                                            className={cn(
                                                'py-2.5 pr-3 text-right',
                                                convRateClass(totals.conversion_rate)
                                            )}
                                        >
                                            {fmtPct(totals.conversion_rate)}
                                        </td>
                                        <td className="py-2.5 pr-3 text-right text-green-700">
                                            {totals.revenue ? fmtCurrency(totals.revenue) : '—'}
                                        </td>
                                        <WaveTwoCell value={totals.spend} />
                                        <WaveTwoCell value={totals.cpl} />
                                        <WaveTwoCell value={totals.roi} />
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                    </div>
                </TooltipProvider>
            )}
            <p className="text-xs text-neutral-400">
                {t('footnote.connected')} {t('footnote.interested')}
            </p>
        </ReportSection>
    );
}

/**
 * Spend / CPL / ROI cell — these arrive once ad-spend tracking ships (Wave 2/3).
 * Until then the backend sends null and we render a subtle em-dash + tooltip.
 */
function WaveTwoCell({ value }: { value: SourcePerformanceRow['spend'] }) {
    const { t } = useTranslation('audienceManagerSourcesTab');
    if (value != null) {
        return (
            <td className="py-2.5 pr-3 text-right text-neutral-800">{value.toLocaleString()}</td>
        );
    }
    return (
        <td className="py-2.5 pr-3 text-right">
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="cursor-default text-neutral-300">—</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                    {t('waveTwoCell.comingSoon')}
                </TooltipContent>
            </Tooltip>
        </td>
    );
}
